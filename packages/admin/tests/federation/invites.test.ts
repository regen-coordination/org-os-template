// Invites (network N2 Task 11): make one, send the link, use it once. Every test runs in a fresh temp repository (a
// hub), with the fake network and a fake gh: nothing reaches GitHub, a real PDS or plc.directory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { createApp } from '../../server/app.ts'
import { mountFederation } from '../../server/federation/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { stateDir } from '../../server/state.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { INVITE_SENTENCES } from '../../server/federation/hub.ts'
import { remoteCache, wellKnownUrlOf } from '../../server/federation/remote.ts'
import { buildRequest, requestText } from '../../lib/federation/request.mjs'
import { loadStandardsInput } from '../../lib/standards/load.mjs'
import { buildStandards } from '../../lib/standards/index.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`
const TWO = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a, bruno] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [identity], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SELF = plcDid('mesh-hub')
const NODE = plcDid('mesa-node')
const NODE_URL = 'https://mesa-node.example.org'
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000 - 120_000)
const ID_A = '3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e31'
const ID_B = '9b1c7d2e-4a6f-4c3b-9d21-7e5f8a0b1c42'
const HUB_URL = 'https://mesh-hub.example.org'

let repo: string
let app: ReturnType<typeof createApp>
let net: FakeNetwork
let seed = 1

const write = (rel: string, text: string) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text) }
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg) }
const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const FED = (joinBlock: Record<string, unknown>, networks = '  - { name: Mesh, role: hub }\n  - { name: Other, role: hub }') => [
  'identity:', '  name: "Mesh Hub"', '  type: "Network"', `  url: ${HUB_URL}`, `  daoURI: ${HUB_URL}`, `  did: "${SELF}"`,
  'networks:', networks, `join: ${JSON.stringify(joinBlock)}`, 'peers: []', '',
].join('\n')
const JOIN = { policy: 'invite', asks: ['purpose'], where: 'https://github.com/mesh/hub' }

const setup = (governance: string | null) => {
  repo = makeChangeRepo(governance)
  write('data/members.yaml', MEMBERS)
  write('federation.yaml', FED(JOIN))
  write('kms.yaml', ['adapter: repo-data', 'target: "."', 'atproto:', `  did: "${SELF}"`, '  pds: "https://pds-one.example.com"', '  handle: "mesh-hub.example.org"', '  nsid_authority: "org.meshhub"', ''].join('\n'))
  commit('the hub: identity, members, kms')
  remoteCache(repo).put(wellKnownUrlOf(NODE_URL)!, { spec: 'org-os/federation/1', name: 'Mesa Node', type: 'LocalNode', did: NODE }, NOW)
  app = createApp(repo, (a, ctx) => {
    mountFederation(a, { repo, withLock: ctx.withLock, now: () => NOW, startBranch: 'main', random: n => Uint8Array.from({ length: n }, () => (seed = (seed * 48271 + 11) % 251) ) })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => NOW })
  })
}

beforeEach(() => { seed = 7; net = makeFakeNetwork({ hosts: {} }) })
afterEach(() => removeFixtureRepo(repo))

type Made = { id: string; link: string; text: string; expires: string; staged?: true; commit?: string }
const make = async (body: Record<string, unknown> = {}) => {
  const res = await post('/api/federation/invites', { name: 'Mesa Node', type: 'LocalNode', network: 'Mesh', ...body })
  return { res, body: await res.json() as Made & { error?: string } }
}
const tokenOf = (m: Made) => decodeURIComponent(m.link.split('#invite=')[1])
const request = (o: { id?: string; invite?: string; network?: string } = {}) => buildRequest({
  id: o.id ?? ID_A, from: { name: 'Mesa Node', type: 'LocalNode', url: NODE_URL }, hub: { name: 'Mesh Hub', url: HUB_URL },
  network: o.network ?? 'Mesh', answers: { purpose: 'we work on soil' }, ...(o.invite ? { invite: o.invite } : {}), now: '2026-11-22T10:00:00.000Z',
})
const send = async (o: Parameters<typeof request>[0]) => {
  const res = await post('/api/federation/requests/receive', { text: requestText(request(o)) })
  const body = await res.json() as { outcome: string; sentence: string }[]
  expect(res.status, JSON.stringify(body)).toBe(200)
  return body[0]
}
const invitesOnDisk = () => (parse(readFileSync(join(repo, 'data', 'invites.yaml'), 'utf8')) as { invites: Record<string, unknown>[] }).invites

/** Every file under a directory, as text. */
const filesUnder = (dir: string): string[] => {
  const out: string[] = []
  const walk = (d: string) => { for (const n of readdirSync(d)) { if (n === '.git') continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(readFileSync(p, 'utf8')) } }
  try { walk(dir) } catch { /* no such directory */ }
  return out
}

describe('making an invite', () => {
  it('commits one create of invites:<id> holding the hash and never the token, and answers the link once', async () => {
    setup(null)
    const { res, body } = await make({ days: 10 })
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(body.text).toBe("Copy this link now. It won't be shown again.")
    expect(body.text).toBe(INVITE_SENTENCES.copy)
    expect(body.link.startsWith(`${HUB_URL}/.well-known/federation.json#invite=`)).toBe(true)
    const token = tokenOf(body)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const [rec] = invitesOnDisk()
    expect(rec).toEqual({ id: body.id, name: 'Mesa Node', type: 'LocalNode', network: 'Mesh', expires: body.expires, token_sha256: sha256Hex(token), used_by: null })
    expect(body.expires).toBe(new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10))
    expect(JSON.stringify(rec)).not.toContain(token)
  })

  it('days is 1 to 90, default 30; the network must be the hub\'s own', async () => {
    setup(null)
    for (const days of [0, 91, 1.5, '5']) expect((await make({ days })).res.status).toBe(400)
    expect((await make({ network: 'Elsewhere' })).res.status).toBe(400)
    expect((await make({ name: '' })).res.status).toBe(400)
    expect((await make({ type: '' })).res.status).toBe(400)
    const { body } = await make()
    expect(body.expires).toBe(new Date(NOW.getTime() + 30 * 86_400_000).toISOString().slice(0, 10))
  })

  it('under a rule that raises identity changes, the create is staged and the invite matches nothing until applied', async () => {
    setup(TWO)
    const { res, body } = await make()
    expect(res.status).toBe(201)
    expect(body.staged).toBe(true)
    const staged = new ChangeStore(repo).load('steward-a')!.ops
    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({ op: 'create', record: `invites:${body.id}` })
    expect(staged[0]).toMatchObject({ value: { token_sha256: sha256Hex(tokenOf(body)) } })
    // not on the trunk: the hub's intake reads the trunk, so the staged invite is nothing
    const a = await send({ invite: tokenOf(body) })
    expect(a.outcome).toBe('refused')
    expect(a.sentence).toContain("This invite doesn't match.")
  })
})

describe('using an invite', () => {
  it('an applied invite admits once, marking used_by; a second use is refused', async () => {
    setup(null)
    const { body } = await make()
    const token = tokenOf(body)
    const first = await send({ invite: token })
    expect(first.outcome).toBe('accepted')
    expect(invitesOnDisk()[0].used_by).toBe(ID_A)
    const second = await send({ id: ID_B, invite: token })
    expect(second.outcome).toBe('refused')
    expect(second.sentence).toContain('This invite has been used.')
  })

  it('an invite for network A cannot admit into network B', async () => {
    setup(null)
    const { body } = await make({ network: 'Mesh' })
    const a = await send({ invite: tokenOf(body), network: 'Other' })
    expect(a.outcome).toBe('refused')
    expect(a.sentence).toContain('This invite is for another network.')
    expect(invitesOnDisk()[0].used_by).toBeNull()
  })

  it('an invite is for its type', async () => {
    setup(null)
    const { body } = await make({ type: 'DAO' })
    expect((await send({ invite: tokenOf(body) })).sentence).toContain('This invite is for a DAO.')
  })
})

describe('the token is shown once and is nowhere else', () => {
  it('not in git (any ref, any file, history), staged ops, state, or the public standards; its hash is in none of the public ones either', async () => {
    setup(null)
    const { body } = await make()
    const token = tokenOf(body)
    await send({ invite: token }) // used: the token was in the request, which the hub never stores
    expect(git('log', '-p', '--all')).not.toContain(token)
    for (const t of filesUnder(repo)) expect(t).not.toContain(token)
    for (const t of filesUnder(stateDir(repo))) expect(t).not.toContain(token)
    const loaded = loadStandardsInput(repo, { parseYaml: parse })
    const out = JSON.stringify(buildStandards({ ...loaded.input!, reads: null }))
    for (const s of [token, body.id, sha256Hex(token), 'token_sha256']) expect(out).not.toContain(s)
  })

  it('a staged invite carries no token in the change file or the state folder', async () => {
    setup(TWO)
    const { body } = await make()
    const token = tokenOf(body)
    for (const t of [...filesUnder(stateDir(repo)), ...filesUnder(repo)]) expect(t).not.toContain(token)
    expect(git('log', '-p', '--all')).not.toContain(token)
  })

  it('the invites board refuses by-hand edits of an invite and never reads it public', async () => {
    setup(null)
    const { body } = await make()
    for (const [method, path] of [['PUT', `/api/registries/invites/${body.id}`], ['DELETE', `/api/registries/invites/${body.id}`]] as const) {
      const res = await app.request(path, { method, body: method === 'PUT' ? JSON.stringify({ id: body.id }) : undefined, headers: { 'content-type': 'application/json' } })
      expect([400, 403, 404, 405, 409, 422]).toContain(res.status)
    }
    expect(invitesOnDisk()).toHaveLength(1)
  })
})
