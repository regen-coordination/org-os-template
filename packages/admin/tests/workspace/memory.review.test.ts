import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import type { WearerReading } from '../../server/systems/hats.ts'
import { COLLECTION_ENTRIES_STAY } from '../../server/workspace/memory.ts'

// DAO-OS L6 Task 15 review (I-1): a private op is judged at its own targets wherever it is written, as an import's private
// part is: a record at `workspace:<collection>`, a private page at its tree, and Council memory at `workspace:agent` too;
// and a `council-memory` record written by a route other than POST /api/memory keeps the collection's level, so no entry is
// hidden from whoever reads the collection. Every test builds a fresh temporary repository (makeChangeRepo) and keeps its
// store in a temp folder of its own; nothing reaches this worktree or the network. Placeholders only. git's identity is
// steward-a (wallet A1, wearing Council, which is above Ops); steward-b (A2) wears Ops; steward-c wears nothing.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d00010001${'0'.repeat(48)}` // a child of Council: Council is above Ops
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const HATS: Record<string, string[]> = { a1: [COUNCIL], a2: [OPS] }
const AT_OPS = `hat:${OPS}`
const AT_COUNCIL = `hat:${COUNCIL}`
const PAGE = 'p-0000000000a1'

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
/** A rule raising `target`: proposed by any member, approved by two maintainers (so steward-a never decides it alone). */
const raised = (target: string) => `    - { id: raised, applies_to: ["${target}"], propose: member, decide: { by: maintainer, method: approve, count: 2 } }\n`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"], wallet: "${A2}" } }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const POLICY = `visibility:
  collections:
    pages: { default: members }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono }

async function world(rules = '', narrowing = false): Promise<World> {
  const repo = makeChangeRepo(governance(rules))
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), POLICY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, the policy"')
  const dir = mkdtempSync(join(tmpdir(), 'memory-review-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: HATS[account.toLowerCase().slice(-2)] ?? [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  await membership.forAct(A1); await membership.forAct(A2)
  // Task 20 review I4: with `narrowing`, POST /api/visibility/narrow is mounted too.
  const mount = narrowing
    ? (a: Hono, ctx: { withLock: <T>(fn: () => Promise<T>) => Promise<T>; privateStore: () => PrivateStore }) => mountVisibility(a, { repo, membership, withLock: ctx.withLock, privateStore: ctx.privateStore })
    : undefined
  const app = createApp(repo, mount as never, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  return { repo, store, app }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; text: string; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  let body = null
  try { body = text === '' ? null : JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, text, body }
}
const entry = (over: Record<string, unknown> = {}) => ({ level: AT_OPS, date: '2026-10-30', title: 'Payroll talk', body: 'Placeholder body.\n', ...over })
const create = (record: string, value: Record<string, unknown>) => ({ ops: [{ op: 'create', record, value }] })
const as = (repo: string, email: string) => git(repo, `config user.email ${email}`)
const councilAtOps = (w: World) => w.store.putCollection({ id: 'council-memory', visibility: AT_OPS, definition: { name: 'Council memory' } }, 'steward-a')
const notesAtOps = (w: World) => w.store.putCollection({ id: 'steward-notes', visibility: AT_OPS,
  definition: { name: 'Steward notes', fields: [{ id: 'title', type: 'text' }] } }, 'steward-a')

describe('a private op is judged at its own targets (Task 15 review I-1)', () => {
  it('P1: under a raised workspace:council-memory or workspace:agent, the records route and the tray refuse a Council entry 403 RAISED, as the memory route does; nothing is written or staged', async () => {
    for (const target of ['workspace:council-memory', 'workspace:agent']) {
      const w = await world(raised(target))
      await councilAtOps(w)
      const viaMemory = await call(w.app, '/api/memory', json('POST', entry()))
      expect([target, viaMemory.status, viaMemory.body?.code]).toEqual([target, 403, 'RAISED'])
      const viaRecords = await call(w.app, '/api/workspace/records', json('POST', create('council-memory:2026-10-30-1', { date: '2026-10-30', title: 'Bypass', body: 'x' })))
      expect([target, viaRecords.status, viaRecords.body?.code]).toEqual([target, 403, 'RAISED'])
      const viaTray = await call(w.app, '/api/changes/ops', json('POST', create('council-memory:2026-10-30-7', { date: '2026-10-30', title: 'Via the tray', body: 'x' })))
      expect([target, viaTray.status, viaTray.body?.code]).toEqual([target, 403, 'RAISED'])
      expect(w.store.records('council-memory')).toEqual([])
      const tray = await call(w.app, '/api/changes')
      expect(tray.body.private).toBeUndefined()
      expect(tray.text).not.toContain('Via the tray')
    }
  })

  it('a private collection under a raised workspace:<collection> rule is held: the records route stages it, the tray needs a decision for it, and the store holds nothing', async () => {
    const w = await world(raised('workspace:steward-notes'))
    await notesAtOps(w)
    const r = await call(w.app, '/api/workspace/records', json('POST', create('steward-notes:n-1', { title: 'Held' })))
    expect([r.status, r.body]).toEqual([200, { save: 'staged' }])
    expect(w.store.records('steward-notes')).toEqual([])
    const tray = await call(w.app, '/api/changes')
    expect(tray.body.private).toHaveLength(1)
    expect(tray.body.rule.direct).toBe(false)
    const applied = await call(w.app, '/api/changes/apply', json('POST', {}))
    expect(applied.status).toBe(403)
    expect(w.store.records('steward-notes')).toEqual([])

    // Staged through the tray itself: the same judgement.
    expect((await call(w.app, '/api/changes', { method: 'DELETE' })).status).toBe(204)
    expect((await call(w.app, '/api/changes/ops', json('POST', create('steward-notes:n-2', { title: 'Held too' })))).status).toBe(200)
    expect((await call(w.app, '/api/changes')).body.rule.direct).toBe(false)
    expect((await call(w.app, '/api/changes/apply', json('POST', {}))).status).toBe(403)
    expect(w.store.records('steward-notes')).toEqual([])
  })

  it('a private page is judged at its tree: its move under a raised tree rule needs a decision in the tray', async () => {
    // The maintainer publishes alone, so only the tree's rule can hold the move.
    const publish = '    - { id: publish, applies_to: [publication], propose: member, decide: { by: maintainer, method: direct } }\n'
    const w = await world(publish + raised(`workspace:tree-${PAGE}`))
    await w.store.putRecord({ collection: 'pages', id: PAGE, visibility: AT_OPS, body: { title: 'Plans', parent: null, order: 1000, markdown: 'Plans.\n' }, rev: '' }, 'steward-a', null)
    const staged = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: `pages:${PAGE}`, set: { visibility: 'members' } }] }))
    expect(staged.status, staged.text).toBe(200)
    const tray = await call(w.app, '/api/changes')
    expect(tray.body.private).toHaveLength(1)
    expect(tray.body.rule.direct).toBe(false)
  })

  it('P2: a council-memory record written by the records route or the tray keeps the collection\'s level, so whoever reads the collection reads every entry', async () => {
    const w = await world()
    expect((await call(w.app, '/api/memory', json('POST', entry()))).body.id).toBe('2026-10-30-1')
    // Stricter, looser or not ordered with it: refused as the memory route refuses it, and nothing is written.
    for (const visibility of [AT_COUNCIL, 'role:maintainer']) {
      const r = await call(w.app, '/api/workspace/records', json('POST', create('council-memory:2026-10-30-2', { date: '2026-10-30', title: 'Council only', body: 'y', visibility })))
      expect([visibility, r.status, r.body?.code]).toEqual([visibility, 409, 'LEVEL'])
      const t = await call(w.app, '/api/changes/ops', json('POST', create('council-memory:2026-10-30-2', { date: '2026-10-30', title: 'Council only', body: 'y', visibility })))
      expect([visibility, t.status, t.body?.code]).toEqual([visibility, 409, 'LEVEL'])
    }
    const narrowed = await call(w.app, '/api/workspace/records', json('POST', { ops: [{ op: 'update', record: 'council-memory:2026-10-30-1', set: { visibility: AT_COUNCIL } }] }))
    expect([narrowed.status, narrowed.body?.code]).toEqual([409, 'LEVEL'])
    expect(w.store.records('council-memory').map(r => `${r.id}@${r.visibility}`)).toEqual([`2026-10-30-1@${AT_OPS}`])
    expect((await call(w.app, '/api/changes')).body.private).toBeUndefined()

    // At the collection's level (said, or left to it) it is written, and the memory route's next entry counts nothing hidden.
    const kept = await call(w.app, '/api/workspace/records', json('POST', create('council-memory:2026-10-30-2', { date: '2026-10-30', title: 'Kept', body: 'z' })))
    expect([kept.status, kept.body]).toEqual([200, { save: 'direct' }])
    expect((await call(w.app, '/api/memory', json('POST', entry({ title: 'Third' })))).body.id).toBe('2026-10-30-3')
    as(w.repo, 'steward-b@example.test')
    const ops = await call(w.app, '/api/memory?date=2026-10-30')
    expect(ops.body.entries.map((e: { id: string }) => e.id)).toEqual(['2026-10-30-1', '2026-10-30-2', '2026-10-30-3'])
  })
})

describe('the first writer never fixes a level every member reads, and a LEVEL refusal never invites widening (Task 15 review I-2)', () => {
  const EVERY = (level: string) => `Council memory is never kept at a level every member reads, and ${level} is one: what every member may read is org memory, written in memory/ in the repository. Nothing was written.`
  const NOT_HERE = (level: string) => `Council memory cannot keep this entry at ${level}, and nothing was written: keep it out of memory/ and ask a steward where it should be kept.`

  it('P4: a member writing first at role:member (a role every member holds) is refused 409, nothing is made; the Council entry after it makes the collection at its own level', async () => {
    const w = await world()
    as(w.repo, 'steward-c@example.test')
    const squat = await call(w.app, '/api/memory', json('POST', entry({ level: 'role:member', title: 'squat' })))
    expect([squat.status, squat.body?.code, squat.body?.error]).toEqual([409, 'EVERY_MEMBER', EVERY('role:member')])
    expect(w.store.collections()).toEqual([])
    as(w.repo, 'admin-test@local')
    const first = await call(w.app, '/api/memory', json('POST', entry()))
    expect([first.status, first.body?.visibility]).toEqual([201, AT_OPS])
  })

  it('a collection made at a level every member reads by another route keeps no entry, through any route', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'council-memory', visibility: 'role:member', definition: { name: 'Council memory' } }, 'steward-c')
    const viaMemory = await call(w.app, '/api/memory', json('POST', entry({ level: 'role:member' })))
    expect([viaMemory.status, viaMemory.body?.code]).toEqual([409, 'EVERY_MEMBER'])
    const viaRecords = await call(w.app, '/api/workspace/records', json('POST', create('council-memory:2026-10-30-1', { date: '2026-10-30', title: 'x', body: 'y' })))
    expect([viaRecords.status, viaRecords.body?.code]).toEqual([409, 'EVERY_MEMBER'])
    expect(w.store.records('council-memory')).toEqual([])
  })

  it('Council at a collection kept at Ops is told it cannot be kept here and to ask a steward, never to write at Ops; only a wider entry is told the collection\'s level', async () => {
    const w = await world()
    expect((await call(w.app, '/api/memory', json('POST', entry()))).status).toBe(201)
    const stricter = await call(w.app, '/api/memory', json('POST', entry({ level: AT_COUNCIL })))
    expect([stricter.status, stricter.body?.code, stricter.body?.error]).toEqual([409, 'LEVEL', NOT_HERE(AT_COUNCIL)])
    expect(stricter.text).not.toContain(OPS)
    // Not ordered with it (a role beside a hat): not invited to widen either.
    const beside = await call(w.app, '/api/memory', json('POST', entry({ level: 'role:maintainer' })))
    expect([beside.status, beside.body?.error]).toEqual([409, NOT_HERE('role:maintainer')])
    // The records route answers the same.
    const viaRecords = await call(w.app, '/api/workspace/records', json('POST', create('council-memory:2026-10-30-2', { date: '2026-10-30', title: 'x', body: 'y', visibility: AT_COUNCIL })))
    expect([viaRecords.status, viaRecords.body?.error]).toEqual([409, NOT_HERE(AT_COUNCIL)])
    expect(w.store.records('council-memory').map(r => r.id)).toEqual(['2026-10-30-1'])

    // A collection kept at Council: an Ops entry is wider, and is told to write at the collection's level.
    const v = await world()
    expect((await call(v.app, '/api/memory', json('POST', entry({ level: AT_COUNCIL })))).status).toBe(201)
    const wider = await call(v.app, '/api/memory', json('POST', entry()))
    expect([wider.status, wider.body?.error]).toEqual([409, `Council memory is kept at ${AT_COUNCIL}: write its entries at that level. Nothing was written.`])
  })
})

// DAO-OS L6 Task 20 review I4 (PF-R99): POST /api/visibility/narrow held a Council entry to nothing: an entry narrowed alone
// left a gap in `<date>-<n>` for the collection's readers. It is refused 409 LEVEL (an entry keeps the collection's level),
// after it is judged as the memory route judges a write (at once, at its targets and the agent layer's).
describe('a Council memory entry is never narrowed alone (I4)', () => {
  const seed = async (w: World) => {
    await councilAtOps(w)
    await w.store.putRecord({ collection: 'council-memory', id: '2026-10-30-1', visibility: AT_OPS,
      body: { date: '2026-10-30', title: 'Payroll talk', body: 'Placeholder body.\n' }, rev: '' }, 'steward-a', null)
  }

  it('an admitted member narrowing an entry is refused 409 LEVEL; nothing is changed', async () => {
    const w = await world('', true)
    await seed(w)
    const before = Number(git(w.repo, 'rev-list --count HEAD').trim())
    const r = await call(w.app, '/api/visibility/narrow', json('POST', { target: { registry: 'council-memory', id: '2026-10-30-1' }, level: AT_COUNCIL }))
    expect(r.status, r.text).toBe(409)
    expect(r.body).toEqual({ code: 'LEVEL', error: "A Council memory entry keeps its collection's level, so it is never narrowed alone. Nothing was written." })
    expect(w.store.record('council-memory', '2026-10-30-1')?.visibility).toBe(AT_OPS)
    expect(Number(git(w.repo, 'rev-list --count HEAD').trim())).toBe(before)
  })

  it('under a raised workspace:council-memory, a member who may only propose is refused 403 RAISED; nothing is changed', async () => {
    const w = await world(raised('workspace:council-memory'), true)
    await seed(w)
    const r = await call(w.app, '/api/visibility/narrow', json('POST', { target: { registry: 'council-memory', id: '2026-10-30-1' }, level: AT_COUNCIL }))
    expect(r.status, r.text).toBe(403)
    expect(r.body.code).toBe('RAISED')
    expect(w.store.record('council-memory', '2026-10-30-1')?.visibility).toBe(AT_OPS)
  })

  it('under a raised workspace:agent too, as the memory route judges it', async () => {
    const w = await world(raised('workspace:agent'), true)
    await seed(w)
    const r = await call(w.app, '/api/visibility/narrow', json('POST', { target: { registry: 'council-memory', id: '2026-10-30-1' }, level: AT_COUNCIL }))
    expect(r.status, r.text).toBe(403)
    expect(w.store.record('council-memory', '2026-10-30-1')?.visibility).toBe(AT_OPS)
  })

  it('a viewer the collection does not admit is told there is no such record, before any of it', async () => {
    const w = await world(raised('workspace:council-memory'), true)
    await seed(w)
    as(w.repo, 'steward-c@example.test')
    const r = await call(w.app, '/api/visibility/narrow', json('POST', { target: { registry: 'council-memory', id: '2026-10-30-1' }, level: AT_COUNCIL }))
    expect(r.status, r.text).toBe(404)
  })
})

// L6 carries K2: narrowing Council memory's collection (`{ collection: 'council-memory' }`) was judged by `mayWrite` at its
// definition file's targets and left every entry at the level it had, wider than the collection (PF-R60's one level). It
// is judged as a Council write (at once, at the collection's targets and `workspace:agent`, PF-R68/R99), and every entry
// moves with the collection, or nothing is narrowed.
describe("narrowing Council memory's collection takes its entries with it (K2)", () => {
  const seed = async (w: World, second = AT_OPS) => {
    await councilAtOps(w)
    await w.store.putRecord({ collection: 'council-memory', id: '2026-10-30-1', visibility: AT_OPS,
      body: { date: '2026-10-30', title: 'Payroll talk', body: 'Placeholder body.\n' }, rev: '' }, 'steward-a', null)
    await w.store.putRecord({ collection: 'council-memory', id: '2026-10-30-2', visibility: second,
      body: { date: '2026-10-30', title: 'Budget talk', body: 'Placeholder body.\n' }, rev: '' }, 'steward-a', null)
  }
  const narrowIt = (w: World) => call(w.app, '/api/visibility/narrow', json('POST', { target: { collection: 'council-memory' }, level: AT_COUNCIL }))
  const levels = (w: World) => [w.store.collections().find(c => c.id === 'council-memory')?.visibility,
    ...w.store.records('council-memory').map(r => `${r.id}=${r.visibility}`).sort()]

  it('an admitted member narrows it: the collection and every entry are at the new level', async () => {
    const w = await world('', true)
    await seed(w)
    const r = await narrowIt(w)
    expect(r.status, r.text).toBe(200)
    expect(levels(w)).toEqual([AT_COUNCIL, `2026-10-30-1=${AT_COUNCIL}`, `2026-10-30-2=${AT_COUNCIL}`])
  })

  it('under a raised workspace:council-memory, a member who may only propose is refused 403 RAISED; nothing is changed', async () => {
    const w = await world(raised('workspace:council-memory'), true)
    await seed(w)
    const r = await narrowIt(w)
    expect([r.status, r.body?.code], r.text).toEqual([403, 'RAISED'])
    expect(levels(w)).toEqual([AT_OPS, `2026-10-30-1=${AT_OPS}`, `2026-10-30-2=${AT_OPS}`])
  })

  it('under a raised workspace:agent too, as the memory route judges a write', async () => {
    const w = await world(raised('workspace:agent'), true)
    await seed(w)
    const r = await narrowIt(w)
    expect([r.status, r.body?.code], r.text).toEqual([403, 'RAISED'])
    expect(levels(w)).toEqual([AT_OPS, `2026-10-30-1=${AT_OPS}`, `2026-10-30-2=${AT_OPS}`])
  })

  it('an entry the new level does not narrow (kept apart by hand) refuses the narrowing 409 LEVEL; nothing is changed', async () => {
    const w = await world('', true)
    await seed(w, 'role:maintainer')
    const r = await narrowIt(w)
    expect([r.status, r.body], r.text).toEqual([409, { code: 'LEVEL', error: COLLECTION_ENTRIES_STAY }])
    expect(levels(w)).toEqual([AT_OPS, `2026-10-30-1=${AT_OPS}`, '2026-10-30-2=role:maintainer'])
  })
})
