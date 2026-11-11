import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore } from '../../server/private/store.ts'
import { COUNCIL_MEMORY, MEMORY_IN_GIT } from '../../server/workspace/memory.ts'
import type { WearerReading } from '../../server/systems/hats.ts'

// DAO-OS L6 §14 (Q76), §16, Task 15: Council memory, the private collection `council-memory`, written only through the
// running Hub (`POST /api/memory`), so the gate applies: created on first use at the level given, one record per entry
// { date, session, title, body }, id <date>-<n>; `members` is org memory, written in memory/<date>.md, and answered 409.
// Every test builds a fresh temporary repository (makeChangeRepo) and keeps its store in a folder of its own under the
// temp directory: nothing is written inside this worktree, and nothing reaches git. Locally, git's identity is steward-a,
// whose wallet A1 wears Ops; steward-c wears nothing. Placeholders only; nothing calls a network (the one listening server
// is on this machine's loopback, for the command's own test).

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const HATS: Record<string, string[]> = { [A1]: [OPS] }
const AT_OPS = `hat:${OPS}`
const AT_COUNCIL = `hat:${COUNCIL}`
const SCRIPT = fileURLToPath(new URL('../../../../scripts/memory.mjs', import.meta.url))

const governance = (rules = '') => `schema_version: "2.0"
governance:
  model: "${rules ? 'consensus' : 'solo-maintainer'}"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
${rules ? `  rules:\n${rules}` : ''}  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of closers.splice(0)) await c()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; pub: Hono; appWith: (access: () => PrivateStore) => Hono }

async function world(opts: { rules?: string } = {}): Promise<World> {
  const repo = makeChangeRepo(governance(opts.rules))
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  mkdirSync(join(repo, 'memory'), { recursive: true })
  writeFileSync(join(repo, 'memory', '2026-10-30.md'), '# 2026-10-30\n\n## Session — 09:00\n\nOrg memory.\n')
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, a day of org memory"')
  const dir = mkdtempSync(join(tmpdir(), 'memory-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: Object.entries(HATS).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  await membership.forAct(A1)
  const appWith = (access: () => PrivateStore) => createApp(repo, undefined, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: access })
  const pub = createApp(repo, undefined, { request: withRequest({ repo, hosted: true, membership: null }), privateStore: () => store })
  return { repo, store, app: appWith(() => store), pub, appWith }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; text: string; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, text, body: text === '' ? null : JSON.parse(text) }
}
const entry = (over: Record<string, unknown> = {}) => ({ level: AT_OPS, date: '2026-10-30', title: 'Payroll talk', body: 'Steward B asked about the payout.\n', ...over })
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
/** steward-c is git's identity: a member with no wallet, so no hats. */
const asStewardC = (repo: string) => git(repo, 'config user.email steward-c@example.test')
const asStewardA = (repo: string) => git(repo, 'config user.email admin-test@local')
/** Nothing of a Council entry is in the repository: not its title, not its body, not in any commit. */
function nothingInGit(repo: string, ...values: string[]): void {
  expect(git(repo, 'status --porcelain').trim()).toBe('')
  const history = git(repo, 'log -p --all')
  for (const v of values) expect(history).not.toContain(v)
}

describe('POST /api/memory (L6 §14, §16)', () => {
  it('members answers 409 with the spec\'s sentence, and nothing is written', async () => {
    const w = await world()
    const before = commits(w.repo)
    const r = await call(w.app, '/api/memory', json('POST', entry({ level: 'members' })))
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('Org memory is written in memory/2026-10-30.md, in the repository: write it there.')
    expect(r.body.error).toBe(MEMORY_IN_GIT('2026-10-30'))
    expect(commits(w.repo)).toBe(before)
    expect(w.store.collections()).toEqual([])
  })

  it('a hat level writes a record of council-memory, made on first use at that level: readable by Ops only, nothing in git', async () => {
    const w = await world()
    const before = commits(w.repo)
    const r = await call(w.app, '/api/memory', json('POST', entry({ session: 'ses-1' })))
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ id: '2026-10-30-1', collection: COUNCIL_MEMORY, visibility: AT_OPS })
    // The collection is made at the level given; the entry is its record, at that level, with the spec's shape.
    expect(w.store.collections()).toEqual([expect.objectContaining({ id: 'council-memory', visibility: AT_OPS })])
    expect(w.store.record('council-memory', '2026-10-30-1')).toMatchObject({
      visibility: AT_OPS, body: { date: '2026-10-30', session: 'ses-1', title: 'Payroll talk', body: 'Steward B asked about the payout.\n' },
    })
    expect(commits(w.repo)).toBe(before)
    nothingInGit(w.repo, 'Payroll talk', 'asked about the payout')

    // Ops reads it, by day; the next entry of the day is <date>-2.
    const second = await call(w.app, '/api/memory', json('POST', entry({ title: 'Grant terms' })))
    expect(second.body.id).toBe('2026-10-30-2')
    const ops = await call(w.app, '/api/memory?date=2026-10-30')
    expect(ops.status).toBe(200)
    expect(ops.body.entries.map((e: { id: string; title: string }) => [e.id, e.title])).toEqual([['2026-10-30-1', 'Payroll talk'], ['2026-10-30-2', 'Grant terms']])
    expect(ops.body.entries[0]).toEqual({ id: '2026-10-30-1', date: '2026-10-30', session: 'ses-1', title: 'Payroll talk', body: 'Steward B asked about the payout.\n', visibility: AT_OPS })
    expect((await call(w.app, '/api/memory?date=2026-10-31')).body.entries).toEqual([])

    // A member who does not wear Ops finds no word of it: no entry, no collection, no record (rule 7).
    asStewardC(w.repo)
    const c = await call(w.app, '/api/memory?date=2026-10-30')
    expect(c.status).toBe(200)
    expect(c.body).toEqual({ entries: [] })
    const listed = await call(w.app, '/api/collections')
    expect(listed.text).not.toContain('council-memory')
    const registry = await call(w.app, '/api/registries/council-memory')
    expect(registry.text).not.toContain('Payroll talk')
    expect(registry.text).not.toContain('2026-10-30-1')
    // The public is refused before any route.
    expect((await call(w.pub, '/api/memory?date=2026-10-30')).status).toBe(401)
    expect((await call(w.pub, '/api/memory', json('POST', entry()))).status).toBe(401)
  })

  it('an entry at a level the writer is not admitted to is refused, and nothing is made', async () => {
    const w = await world()
    asStewardC(w.repo)
    const r = await call(w.app, '/api/memory', json('POST', entry()))
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('NOT_ADMITTED')
    expect(w.store.collections()).toEqual([])
  })

  it('once made, every entry is kept at the collection\'s level: another is refused, naming it only to who may read it', async () => {
    const w = await world()
    expect((await call(w.app, '/api/memory', json('POST', entry()))).status).toBe(201)
    // steward-a wears Ops, and Ops is not above Council: a Council level is not admitted, so it is refused as not admitted.
    const council = await call(w.app, '/api/memory', json('POST', entry({ level: AT_COUNCIL })))
    expect(council.status).toBe(403)
    // A role level steward-a holds is not the collection's, nor ordered with it: refused in words that never invite a
    // wider level (Task 15 review I-2).
    const role = await call(w.app, '/api/memory', json('POST', entry({ level: 'role:maintainer' })))
    expect(role.status).toBe(409)
    expect(role.body.code).toBe('LEVEL')
    expect(role.body.error).toBe('Council memory cannot keep this entry at role:maintainer, and nothing was written: keep it out of memory/ and ask a steward where it should be kept.')
    expect(w.store.records('council-memory').map(r => r.id)).toEqual(['2026-10-30-1'])
    // steward-c may not read the collection: told it cannot be written here, its level never named.
    asStewardC(w.repo)
    const c = await call(w.app, '/api/memory', json('POST', entry({ level: 'role:member' })))
    expect(c.status).toBe(403)
    expect(c.text).not.toContain(OPS)
    expect(c.body.error).toBe('Council memory is kept at a level you are not admitted to, so you cannot write it here. Nothing was written.')
  })

  it('a raised workspace rule refuses it at its targets (PF-R21, PF-R33): council-memory, and the agent layer', async () => {
    for (const target of ['workspace:council-memory', 'workspace:agent']) {
      const w = await world({ rules: `    - { id: raised, applies_to: ["${target}"], propose: member, decide: { by: maintainer, method: approve, count: 2 } }\n` })
      const r = await call(w.app, '/api/memory', json('POST', entry()))
      expect(r.status, target).toBe(403)
      expect(r.body.code).toBe('RAISED')
      expect(w.store.collections()).toEqual([])
    }
    // The collection's first making is judged at workspace:collections too.
    const w = await world({ rules: '    - { id: raised, applies_to: ["workspace:collections"], propose: member, decide: { by: maintainer, method: approve, count: 2 } }\n' })
    expect((await call(w.app, '/api/memory', json('POST', entry()))).status).toBe(403)
    expect(w.store.collections()).toEqual([])
  })

  it('council-memory in git is not Council memory: refused, nothing written', async () => {
    const w = await world()
    writeFileSync(join(w.repo, 'data', 'collections.yaml'), 'collections:\n  - { id: council-memory, name: In git, fields: [{ id: title, type: text }] }\n')
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a git collection by that name"')
    const r = await call(w.app, '/api/memory', json('POST', entry()))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('IN_GIT')
    expect(w.store.collections()).toEqual([])
  })

  it('the body is checked: a date, a title, a body, a level; public is not a level for it', async () => {
    const w = await world()
    for (const bad of [entry({ date: '30/10/2026' }), entry({ date: '2026-02-30' }), entry({ title: '' }), entry({ title: 'x'.repeat(201) }),
      entry({ body: 7 }), entry({ level: 'hat:' }), entry({ level: undefined }), entry({ session: 3 })]) {
      const r = await call(w.app, '/api/memory', json('POST', bad))
      expect(r.status, JSON.stringify(bad).slice(0, 80)).toBe(400)
    }
    // A body past PAGE_MAX_BYTES, as a page's.
    expect((await call(w.app, '/api/memory', json('POST', entry({ body: 'x'.repeat(524289) })))).status).toBe(413)
    const pub = await call(w.app, '/api/memory', json('POST', entry({ level: 'public' })))
    expect(pub.status).toBe(409)
    expect(pub.body.error).toBe('Council memory is never public: org memory is written in memory/2026-10-30.md, in the repository, and published by a decision. Nothing was written.')
    expect(w.store.collections()).toEqual([])
  })

  it('the store down: refused in L5\'s words, and git as it was', async () => {
    const w = await world()
    const down = w.appWith(() => { throw new StoreUnavailable('The private store at /tmp/x could not be opened: test') })
    const before = commits(w.repo)
    const r = await call(down, '/api/memory', json('POST', entry()))
    expect(r.status).toBe(503)
    expect(commits(w.repo)).toBe(before)
    expect((await call(down, '/api/memory?date=2026-10-30')).status).toBe(503)
  })
})

describe('npm run memory against a running Hub (L6 §14, Q76)', () => {
  /** The command, run as a child process while this process serves the Hub. */
  const runMemory = (args: string[], input: string) => new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    const child = execFile('node', [SCRIPT, ...args], { env: { ...process.env, ORG_OS_HUB_URL: '' } }, (err, stdout, stderr) => {
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
    child.stdin?.end(input)
  })

  it('writes a Council entry through the Hub, readable by Ops only; with no Hub it refuses, and git is never written', async () => {
    const w = await world()
    let server!: ReturnType<typeof serve>
    await new Promise<void>(r => { server = serve({ fetch: w.app.fetch, hostname: '127.0.0.1', port: 0 }, () => r()) })
    const { port } = server.address() as AddressInfo
    closers.push(() => new Promise(r => server.close(() => r())))
    const hub = `http://localhost:${port}`
    const before = commits(w.repo)

    const add = await runMemory(['add', '--dir', w.repo, '--hub', hub, '--level', AT_OPS, '--date', '2026-10-30', '--title', 'Payroll talk', '-'], 'Steward B asked about the payout.\n')
    expect(add.code, add.stderr).toBe(0)
    expect(add.stdout).toContain('2026-10-30-1')
    expect(w.store.record('council-memory', '2026-10-30-1')).toMatchObject({ visibility: AT_OPS, body: { title: 'Payroll talk' } })
    expect(commits(w.repo)).toBe(before)
    nothingInGit(w.repo, 'Payroll talk', 'asked about the payout')

    // list: both parts, the store's as the Hub answers the actor.
    const list = await runMemory(['list', '--dir', w.repo, '--hub', hub, '--date', '2026-10-30'], '')
    expect(list.code, list.stderr).toBe(0)
    expect(list.stdout).toContain('members · memory/2026-10-30.md · Session — 09:00')
    expect(list.stdout).toContain('2026-10-30-1 · Payroll talk')
    asStewardC(w.repo)
    const asC = await runMemory(['list', '--dir', w.repo, '--hub', hub, '--date', '2026-10-30'], '')
    expect(asC.stdout).toContain('Session — 09:00')
    expect(asC.stdout).not.toContain('Payroll talk')
    asStewardA(w.repo)

    // The Hub stopped: refused in the spec's words; nothing reaches memory/ or the store.
    await closers.pop()!()
    const refused = await runMemory(['add', '--dir', w.repo, '--hub', hub, '--level', AT_OPS, '--date', '2026-10-30', '--title', 'Grant terms', '-'], 'Kept quiet.\n')
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Council memory is written through the Hub, so it can be read only by those it is for: start it (npm start), then run this again.')
    expect(w.store.records('council-memory').map(r => r.id)).toEqual(['2026-10-30-1'])
    nothingInGit(w.repo, 'Grant terms', 'Kept quiet')
    expect(existsSync(join(w.repo, 'memory', '2026-10-31.md'))).toBe(false)
  })
})
