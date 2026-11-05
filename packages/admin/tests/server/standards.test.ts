// The members' preview of the live standards copy (DAO-OS L8, Task 14): GET /api/standards, and readsFor. Each test
// writes a fresh temporary directory (the route reads files; nothing here needs git). No network: a fake fetch answers.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Hono } from 'hono'
// @ts-expect-error js-yaml ships no types here; the CLI's parser, used to prove the server reads the same
import yamlJs from 'js-yaml'
import { stringify } from 'yaml'
import { SystemReader } from '../../server/systems/reader.ts'
import type { Driver, FetchLike } from '../../server/systems/driver.ts'
import { mountStandards, serverYaml } from '../../server/standards/routes.ts'
import { readsFor } from '../../server/standards/reads.ts'
import { loadStandardsInput } from '../../lib/standards/load.mjs'
import { buildStandards } from '../../lib/standards/index.mjs'
import { fixtureInput, fixtureReads } from '../standards/fixtures.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function write(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
}

/** The standards fixture as an instance directory: federation, visibility, and the registries readsFor and the builder use. */
function instance(opts: { daoURI?: boolean } = {}): string {
  const input = fixtureInput()
  const root = mkdtempSync(join(tmpdir(), 'l8-route-'))
  dirs.push(root)
  const systems = (input.records.systems as Record<string, unknown>[]).map(s =>
    s.id === 'grants' ? { ...s, grant_pool: { mechanism: 'Conviction Voting', usd: { amount: 1000, as_of: '2026-10-29T00:00:00Z' } } } : s)
  write(root, {
    'federation.yaml': stringify({ identity: { name: 'Test DAO', type: 'DAO', description: input.identity.description,
      ...(opts.daoURI === false ? {} : { daoURI: input.identity.daoURI }) } }),
    'data/visibility.yaml': stringify({ visibility: input.policy }),
    'data/members.yaml': stringify({ members: input.records.members }),
    'data/systems.yaml': stringify({ systems }),
    'data/proposals.yaml': stringify({ proposals: input.records.proposals }),
    'data/governance.yaml': stringify({ governance: input.records.governance }),
  })
  return root
}

/** Drivers that answer from the L8 fixture reads, one request each to a fake host; the fetch records every URL. */
function readerFor(root: string) {
  const urls: string[] = []
  const fetch: FetchLike = async url => { urls.push(url); return { ok: true, status: 200, json: async () => ({}) } }
  const reads = fixtureReads()
  const driver = (name: string): Driver => ({
    name, hosts: ['api.example.org'],
    async read(system, ctx) { await ctx.fetchJson(`https://api.example.org/${String(system.id)}`); return reads[String(system.id)]! },
  })
  const drivers = ['safe', 'hats-tree', 'snapshot-space', 'gardens-pool'].map(driver)
  return { urls, reader: new SystemReader({ repo: root, fetch, drivers, now: () => new Date('2026-10-29T09:00:00Z') }) }
}

const listing = (root: string): string[] => {
  const out: string[] = []
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(`${p.slice(root.length)}:${readFileSync(p, 'utf8').length}`) } }
  walk(root)
  return out
}

describe('GET /api/standards', () => {
  it('200 with the live copy: applications.json present, contracts carry thresholds', async () => {
    const root = instance()
    const { reader } = readerFor(root)
    const app = new Hono(); mountStandards(app, { repo: root, systems: reader })
    const res = await app.request('/api/standards')
    expect(res.status).toBe(200)
    const body = await res.json() as { files: Record<string, any>; problems: unknown[]; withheld: unknown[]; reads: { system: string }[] }
    expect(Object.keys(body.files)).toContain('applications.json')
    expect(JSON.stringify(body.files['contracts.json'])).toContain('org-os.threshold')
    expect(body.reads.map(r => r.system)).toEqual(['grants', 'roles', 'treasury', 'votes'])
    expect(Array.isArray(body.problems)).toBe(true)
  })

  it('a members-level System is never read: no request goes to its host, no read is made for it', async () => {
    const root = instance()
    const { reader, urls } = readerFor(root)
    const app = new Hono(); mountStandards(app, { repo: root, systems: reader })
    await app.request('/api/standards')
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.some(u => u.endsWith('/ops-safe'))).toBe(false)
    expect(urls.some(u => u.endsWith('/forum'))).toBe(false)   // a System with no driver is not read either
  })

  it('readsFor reads a System public by the R1 synonym `level: public` (I4)', async () => {
    const root = instance()
    write(root, { 'data/visibility.yaml': 'collections:\n  systems: { level: public }\n' })
    const { input } = loadStandardsInput(root, { parseYaml: serverYaml })
    const { reader } = readerFor(root)
    const reads = await readsFor(reader, input!)
    expect(Object.keys(reads).sort()).toEqual(['grants', 'roles', 'treasury', 'votes'])   // ops-safe is members-level by its own key
  })

  it('readsFor never reads a public System with a withheld field (C1)', async () => {
    const root = instance()
    write(root, { 'data/visibility.yaml': 'collections:\n  systems: { default: public, fields: { address: members } }\n' })
    const { input } = loadStandardsInput(root, { parseYaml: serverYaml })
    const { reader, urls } = readerFor(root)
    const reads = await readsFor(reader, input!)
    expect(Object.keys(reads).sort()).toEqual(['votes'])   // the only driven System without an address
    expect(urls.every(u => u.endsWith('/votes'))).toBe(true)
  })

  it('readsFor reads only public Systems that have a driver; a failed read passes through as it is', async () => {
    const root = instance()
    const { input } = loadStandardsInput(root, { parseYaml: serverYaml })
    const urls: string[] = []
    const fetch: FetchLike = async url => { urls.push(url); throw new Error('down') }
    const driver: Driver = { name: 'safe', hosts: ['api.example.org'], async read(_s, ctx) { await ctx.fetchJson('https://api.example.org/x'); throw new Error('unreachable') } }
    const reader = new SystemReader({ repo: root, fetch, drivers: [driver] })
    const reads = await readsFor(reader, input!)
    expect(Object.keys(reads).sort()).toEqual(['grants', 'roles', 'treasury', 'votes'])
    expect(reads.treasury).toMatchObject({ ok: false })
    expect(urls.length).toBeGreaterThan(0)
  })

  it('no daoURI: 409 with the sentence', async () => {
    const root = instance({ daoURI: false })
    const { reader } = readerFor(root)
    const app = new Hono(); mountStandards(app, { repo: root, systems: reader })
    const res = await app.request('/api/standards')
    expect(res.status).toBe(409)
    expect((await res.json() as { error: string }).error).toMatch(/identity\.daoURI is not set/)
  })

  it('writes nothing: the directory is the same after', async () => {
    const root = instance()
    const before = listing(root)
    const { reader } = readerFor(root)
    const app = new Hono(); mountStandards(app, { repo: root, systems: reader })
    await app.request('/api/standards')
    expect(listing(root)).toEqual(before)
  })

  it('withheld is in the answer and in no file', async () => {
    const root = instance()
    const { reader } = readerFor(root)
    const app = new Hono(); mountStandards(app, { repo: root, systems: reader })
    const body = await (await app.request('/api/standards')).json() as { files: Record<string, unknown>; withheld: { collection: string }[] }
    expect(body.withheld.length).toBeGreaterThan(0)
    const text = JSON.stringify(body.files)
    expect(text).not.toMatch(/WITHHELD-/)
    expect(text).not.toContain('"withheld"')
  })
})

describe('the server reads YAML as the CLI does', () => {
  it('the git copy is the same from the server parser and from js-yaml (core schema, no timestamps)', () => {
    const root = instance()
    // an unquoted date stays a string in both
    write(root, { 'data/finances.yaml': 'finances:\n  as_of: 2026-10-29\n  balance: 1\n' })
    const NO_DATES = yamlJs.CORE_SCHEMA.extend({
      implicit: [yamlJs.types.merge], explicit: [yamlJs.types.binary, yamlJs.types.omap, yamlJs.types.pairs, yamlJs.types.set],
    })
    const cli = loadStandardsInput(root, { parseYaml: t => yamlJs.load(t, { schema: NO_DATES }) })
    const server = loadStandardsInput(root, { parseYaml: serverYaml })
    expect(server.input!.records).toEqual(cli.input!.records)
    const a = buildStandards({ ...cli.input!, reads: null }), b = buildStandards({ ...server.input!, reads: null })
    expect(b.files).toEqual(a.files)
    expect(Object.keys(a.files).length).toBeGreaterThan(3)
    expect(typeof (server.input!.records.finances as any).as_of).toBe('string')
  })
})
