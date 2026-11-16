// The walk review's G2 and N1 (fail closed): a private store that is configured but cannot be reached, or that fails as
// it answers, is never read as holding nothing by a judgment. Any write touching a System answers the store's 503
// (PRIVATE_STORE, its own sentence) at stage, apply and ratify, nothing written; ratify judges what the chain holds on
// the whole (git and the store) before the branch is built (422); the deploy routes' "does the viewer read the whole
// composition" and the read-back's whole are the store's 503 too, never a plan made of git's part alone. A server with no
// store at all keeps judging on git alone. Every test builds a throwaway repository and private store; no network.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { stringify } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { git, makeChangeRepo, makeSyntheticRepo } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { CHAIN_HELD_AT_RATIFY } from '../../server/proposals/ratify.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore } from '../../server/private/store.ts'
import { STORE_FAILED } from '../../server/private/ops.ts'
import { CHAIN_HELD_SENTENCE } from '../../lib/chain-held.mjs'
import { STAGES } from './fixtures/readings.ts'
import { FAST, PART_HIDDEN, PART_HIDDEN_PLAN, SAFE_ID, TREE_ID, composedRepo, deployApp, grantOps, hideInStore, json, restrictInStore } from './fixtures/hub.ts'

const SEPOLIA = 'eip155:11155111'
const HAT = (n: number) => `${SEPOLIA}:0x0000002a000${n}${'0'.repeat(52)}`
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const TREE = {
  id: 'side-roles', kind: 'hats-tree', name: 'Side roles', chain: SEPOLIA, address: '42', driver: 'hats-tree',
  deployment: { status: 'deployed', read_back: '2026-11-05' },
  hats: [{ key: 'council', hat: HAT(1), role: 'decides', wearers: [`${SEPOLIA}:${A(1)}`] }],
}
const SAFE = {
  id: 'side-safe', kind: 'safe', name: 'Side Safe', chain: SEPOLIA, address: '0x1111111111111111111111111111111111111111', driver: 'safe',
  deployment: { status: 'deployed', read_back: '2026-11-05' },
}
const { deployment: _d, ...HAND_SAFE } = SAFE
const NEW_ADDRESS = '0x2222222222222222222222222222222222222222'
/** What a store that could not be opened says (serve.ts raises it as the store's attention, and every answer says it). */
const WHY = 'The private store could not be opened for this test.'
const DOWN = { error: WHY, code: 'PRIVATE_STORE' }
const held = (record: string, field: string) => ({ record, field, message: CHAIN_HELD_SENTENCE(field) })

let repo: string | undefined
let kept: { store: PrivateStore; done: () => void } | undefined
const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  kept?.done(); kept = undefined
  if (repo) removeFixtureRepo(repo); repo = undefined
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A way to the store that can be put down and up again: down, it throws as serve.ts's does for a store it could not open. */
function switchable(store: PrivateStore) {
  const s = { down: false, access: (): PrivateStore => { if (s.down) throw new StoreUnavailable(WHY); return store } }
  return s
}
function commitSystemsFile(r: string, systems: unknown[]): void {
  writeFileSync(join(r, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems }))
  git(r, 'add data/systems.yaml')
  git(r, 'commit -qm "fixture: Systems"')
}
async function call(app: Hono, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const res = await app.request(path, method === 'GET' ? undefined : json(method, body ?? {}))
  return { status: res.status, body: await res.json() }
}
const stageOps = (app: Hono, ops: unknown[]) => call(app, '/api/changes/ops', 'POST', { ops })
const ADDRESS_EDIT = { op: 'update', record: 'systems:side-safe', set: { address: NEW_ADDRESS } }
const NOTES_EDIT = { op: 'update', record: 'systems:side-safe', set: { notes: 'Kept for the side work.' } }

describe('stage: a store configured but down refuses any op touching a System (G2 a)', () => {
  it('`deployment` kept in the store, the store down: a hand edit of the Safe, and its notes, are the store\'s 503, nothing staged', async () => {
    repo = makeSyntheticRepo()
    commitSystemsFile(repo, [TREE, SAFE])
    grantOps(repo)
    kept = await restrictInStore(repo, ['deployment'])
    const sw = switchable(kept.store)
    const app = createApp(repo, undefined, { privateStore: sw.access })
    sw.down = true
    for (const op of [ADDRESS_EDIT, NOTES_EDIT]) {
      const r = await stageOps(app, [op])
      expect([r.status, r.body]).toEqual([503, DOWN])
    }
    // A write touching no System is not the store's to refuse: git's records stage as they did.
    const project = await stageOps(app, [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])
    expect(project.status, JSON.stringify(project.body)).toBe(200)
    expect(project.body.ops.map((o: { record: string }) => o.record)).toEqual(['projects:proj-001'])
    // Up again, the same edit is judged on the whole: the store holds the Safe as deployed.
    sw.down = false
    const up = await stageOps(app, [ADDRESS_EDIT])
    expect([up.status, up.body.errors]).toEqual([422, [held('systems:side-safe', 'address')]])
  })

  it('a store that fails as it answers (after it opened) is its 503 with STORE_FAILED, never read as holding nothing', async () => {
    repo = makeSyntheticRepo()
    commitSystemsFile(repo, [TREE, SAFE])
    grantOps(repo)
    kept = await restrictInStore(repo, ['deployment'])
    const store = kept.store
    const app = createApp(repo, undefined, { privateStore: () => store })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(store, 'fields').mockImplementation(() => { throw new Error('disk I/O error') })
    const r = await stageOps(app, [ADDRESS_EDIT])
    expect([r.status, r.body]).toEqual([503, { error: STORE_FAILED, code: 'PRIVATE_STORE' }])
    expect(JSON.stringify(r.body)).not.toContain('disk I/O')
    expect((await call(app, '/api/changes')).body.ops).toEqual([])
  })

  it('a server with no private store at all judges on git alone, as before', async () => {
    repo = makeSyntheticRepo()
    commitSystemsFile(repo, [TREE, SAFE, { ...HAND_SAFE, id: 'hand-safe' }])
    const app = createApp(repo)
    const refused = await stageOps(app, [ADDRESS_EDIT])
    expect([refused.status, refused.body.errors]).toEqual([422, [held('systems:side-safe', 'address')]])
    const hand = await stageOps(app, [{ op: 'update', record: 'systems:hand-safe', set: { address: NEW_ADDRESS } }])
    expect(hand.status, JSON.stringify(hand.body)).toBe(200)
  })
})

describe('apply: a store configured but down refuses a change touching a System (G2 a, carry-in 1)', () => {
  it('a git edit staged while the store was up is the store\'s 503 at Apply once it is down, nothing written', async () => {
    repo = makeSyntheticRepo()
    commitSystemsFile(repo, [TREE, HAND_SAFE])
    grantOps(repo)
    kept = await restrictInStore(repo, ['deployment'])
    const store = kept.store
    const sw = switchable(store)
    const app = createApp(repo, undefined, { privateStore: sw.access })
    const staged = await stageOps(app, [ADDRESS_EDIT])
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    // Another change, applied since, read the Safe back: the store now holds it as deployed. Then the store goes down.
    await store.putField({ registry: 'systems', record: 'side-safe', field: 'deployment', visibility: 'role:ops', value: { status: 'deployed', read_back: '2026-11-07' } }, 'test', null)
    sw.down = true
    const head = git(repo, 'rev-parse HEAD')
    const res = await call(app, '/api/changes/apply', 'POST')
    expect([res.status, res.body]).toEqual([503, DOWN])
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')).toContain(HAND_SAFE.address)
    // Up again, the whole is judged: 422.
    sw.down = false
    const up = await call(app, '/api/changes/apply', 'POST')
    expect([up.status, up.body.errors]).toEqual([422, [held('systems:side-safe', 'address')]])
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
  })
})

// Ratify (carry-in 2): ana proposes a hand edit of a Safe's address while it is not deployed; bruno, the maintainer,
// approves and ratifies. The store keeps `deployment` at role:maintainer.
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno] }
    member: { all: true }
  rules:
    - { id: systems, applies_to: [systems], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`

async function ratifyWorld() {
  const r = makeChangeRepo(GOVERNANCE)
  repo = r
  writeFileSync(join(r, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(r, 'data', 'systems.yaml'), stringify({ schema_version: '1.0', systems: [HAND_SAFE] }))
  writeFileSync(join(r, 'data', 'visibility.yaml'), 'visibility:\n  collections:\n    systems:\n      fields: { deployment: "role:maintainer" }\n')
  git(r, 'add -A'); git(r, 'commit -qm "fixture: two members, a Safe registered by hand, deployment kept in the store"')
  const dir = mkdtempSync(join(tmpdir(), 'store-down-')); dirs.push(dir)
  const store = await openPrivateStore(r, { dir })
  kept = { store, done: () => { try { store.close() } catch { /* closed */ } } }
  const sw = switchable(store)
  let clock = new Date(Math.floor(Date.now() / 1000) * 1000 - 120_000)
  const app = createApp(r, (a, ctx) => mountProposals(a, { repo: r, withLock: ctx.withLock, startBranch: 'main', now: () => clock, privateStore: ctx.privateStore }), { privateStore: sw.access })
  const as = (who: string) => git(r, `config user.email ${who}@example.test`)
  as('ana')
  expect((await stageOps(app, [ADDRESS_EDIT])).status).toBe(200)
  const proposed = await call(app, '/api/proposals', 'POST', { title: 'Move the side Safe' })
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201)
  const id = String(proposed.body.id)
  clock = new Date(clock.getTime() + 60_000)
  as('bruno')
  expect((await call(app, `/api/proposals/${id}/events`, 'POST', { kind: 'approve' })).status).toBe(200)
  const state = () => (readLedger(r).entries.find(e => String(e.id) === id) as { state: string }).state
  return { r, store, sw, app, id, state }
}

describe('ratify: the whole is judged before the build, and a store that is down refuses (G2 a, b)', () => {
  it('the store came to hold the Safe as deployed since it was proposed: 422, before anything is built', async () => {
    const w = await ratifyWorld()
    await w.store.putField({ registry: 'systems', record: 'side-safe', field: 'deployment', visibility: 'role:maintainer', value: { status: 'deployed', read_back: '2026-11-07' } }, 'test', null)
    const head = git(w.r, 'rev-parse HEAD')
    const res = await call(w.app, `/api/proposals/${w.id}/ratify`, 'POST', {})
    // Named nothing: whether the Safe is deployed is kept at role:maintainer (PF-R242).
    expect([res.status, res.body]).toEqual([422, { code: 'CHAIN_HELD', error: CHAIN_HELD_AT_RATIFY }])
    expect(git(w.r, 'rev-parse HEAD')).toBe(head)
    expect(w.state()).toBe('open')
  })

  it('the store down: the store\'s 503, nothing merged', async () => {
    const w = await ratifyWorld()
    w.sw.down = true
    const head = git(w.r, 'rev-parse HEAD')
    const res = await call(w.app, `/api/proposals/${w.id}/ratify`, 'POST', {})
    expect([res.status, res.body]).toEqual([503, DOWN])
    expect(git(w.r, 'rev-parse HEAD')).toBe(head)
    expect(w.state()).toBe('open')
    // Up again, nothing the store keeps stands in the way: ratified.
    w.sw.down = false
    const up = await call(w.app, `/api/proposals/${w.id}/ratify`, 'POST', {})
    expect(up.status, JSON.stringify(up.body)).toBe(200)
    expect(readFileSync(join(w.r, 'data', 'systems.yaml'), 'utf8')).toContain(NEW_ADDRESS)
  })
})

describe('the deploy routes under a store that is down (N1, G2 c): never a plan of git\'s part alone', () => {
  it('a viewer admitted to the tree the store keeps: planned and read back whole while it is up; the store\'s 503 when it is down', async () => {
    repo = await composedRepo()
    grantOps(repo)
    kept = await hideInStore(repo, [TREE_ID])
    const sw = switchable(kept.store)
    const { app, world } = deployApp(repo, STAGES.top.readings, FAST, { access: sw.access })
    const up = await call(app, '/api/deploy')
    expect(up.status, JSON.stringify(up.body)).toBe(200)
    expect(up.body.composed).toEqual([SAFE_ID, TREE_ID])
    sw.down = true
    world.methods.length = 0
    expect(await call(app, '/api/deploy')).toEqual({ status: 503, body: DOWN })
    expect(await call(app, '/api/deploy/read-back', 'POST', {})).toEqual({ status: 503, body: DOWN })
    expect(world.methods).toEqual([])
    expect((await call(app, '/api/changes')).body.ops).toEqual([])
  })

  it('a viewer not admitted to the tree: PART_HIDDEN while the store is up, the store\'s 503 when it is down; neither names the tree', async () => {
    repo = await composedRepo()
    kept = await hideInStore(repo, [TREE_ID])
    const sw = switchable(kept.store)
    const { app, world } = deployApp(repo, STAGES.top.readings, FAST, { access: sw.access })
    expect(await call(app, '/api/deploy')).toEqual({ status: 409, body: { code: 'PART_HIDDEN', error: PART_HIDDEN_PLAN } })
    expect(await call(app, '/api/deploy/read-back', 'POST', {})).toEqual({ status: 409, body: { code: 'PART_HIDDEN', error: PART_HIDDEN } })
    sw.down = true
    for (const [path, method] of [['/api/deploy', 'GET'], ['/api/deploy/read-back', 'POST']] as const) {
      const r = await call(app, path, method, {})
      expect(r).toEqual({ status: 503, body: DOWN })
      expect(JSON.stringify(r.body)).not.toContain(TREE_ID)
    }
    expect(world.methods).toEqual([])
  })
})
