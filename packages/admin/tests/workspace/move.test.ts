import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { mountSession } from '../../server/session/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { openPrivateStore, type PrivateStore, type PrivateTransaction } from '../../server/private/store.ts'
import { PRIVATE_STALE, reconcilePrivate } from '../../server/private/proposals.ts'
import { MOVE_CHANGED, MOVE_PROPOSED } from '../../server/private/ops.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { HAS_CONVERSATION, ID_TAKEN, MOVES, PRIVATE_COLLECTION_STAYS, MOVE_ALONE } from '../../server/workspace/move.ts'
import { LOOSER_THAN_PARENT } from '../../lib/workspace/pages.mjs'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

// DAO-OS L6 §12 (L5 Task 16 I3), Task 11: a private record or page moved into git by a publication decision. The staged op
// `move-to-git` is judged as R-L5-16.8 judges a widening: applied where the rule for `publication` lets the actor decide
// alone, otherwise proposed; until decided the ledger holds its placeholder only (rule 8). Applying (direct, ratify or the
// reconcile at start) writes the record's git part in the one commit, keeps the fields the policy restricts in the store
// as `fields` rows and deletes the store's record with a history row. Rule 4 holds throughout: L5's sentinel scan, over
// every object of the repository, finds no restricted value and nothing of the record from before the decision.
//
// Every test builds a fresh temporary repository (makeChangeRepo) and keeps its private store in a temp folder of its own:
// nothing is written inside this worktree, nothing touches the network. Locally, git's identity is steward-a, whose wallet
// is A1 (Ops). A2 wears Council (a sibling of Ops, so not admitted to it) and decides publications.

const T0 = new Date('2026-11-05T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const SENTINEL = 'sentinel-7f3a-'
const AT_OPS = `hat:${OPS}`

const SOLO = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
/** Workspace writes are direct (the implied workspace/direct); a publication is proposed by Ops, approved by Council. */
const CONSENT = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  rules:
    - { id: publish, applies_to: [publication], propose: ops, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
`
const TASKS = `tasks:
  - { id: t-1, title: Write the brief, status: todo }
`
/** A task's budget is kept at Ops, wherever the task is. */
const POLICY = `visibility:
  collections:
    tasks: { default: members, fields: { budget: "hat:${OPS}" } }
    pages: { default: members }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; signIn: (account: string) => Promise<string> }

async function world(governance = SOLO): Promise<World> {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), POLICY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, a task, the policy"')
  const dir = mkdtempSync(join(tmpdir(), 'move-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => T0
  const worn: Record<string, string[]> = { [A1]: [OPS], [A2]: [COUNCIL] }
  const hatsOf = (account: string) => Object.entries(worn).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? []
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, hats: hatsOf(account), block: 100, readAt: T0.toISOString() })
  const list = (hat: string): WearersReading => {
    const wearers = Object.entries(worn).filter(([, h]) => h.includes(hat)).map(([a]) => a)
    return { ok: true, system: 'hats-main', hat, wearers, holders: wearers, complete: true, block: 100, readAt: T0.toISOString() }
  }
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => list(hat)),
  }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, (a, ctx) => {
    mountSession(a, { repo, store, membership, hosted: false, now })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    return `house_session=${(await createSession(store, account, now)).token}`
  }
  return { repo, store, app, signIn }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
async function ok(res: Response, status = 200): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text()
  expect([res.status, res.status === status ? '' : text]).toEqual([status, ''])
  return JSON.parse(text)
}
async function refused(res: Response): Promise<[number, any]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return [res.status, await res.json()]
}
const stage = async (w: World, ops: unknown[], cookie?: string) => ok(await call(w.app, 'POST', '/api/changes/ops', { body: { ops }, cookie }))
const moveOf = (record: string, level = 'members') => [{ op: 'update', record, set: { visibility: level } }]
const apply = async (w: World, cookie?: string) => ok(await call(w.app, 'POST', '/api/changes/apply', { body: {}, cookie }))
const propose = async (w: World, title: string, cookie?: string): Promise<string> =>
  String((await ok(await call(w.app, 'POST', '/api/proposals', { body: { title }, cookie }), 201)).id)
const approve = async (w: World, id: string, cookie: string) => ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie }))
const ratify = async (w: World, id: string, cookie: string) => ok(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie }))
const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const fileAt = (repo: string, rel: string, rev = 'HEAD') => git(repo, `show ${rev}:${rel}`)
const tasksOf = (repo: string) => parse(fileAt(repo, 'data/tasks.yaml')).tasks as Record<string, unknown>[]
const entryOf = (repo: string, id: string) => readLedger(repo).entries.find(e => String(e.id) === id)! as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** L5's sentinel scan (§10.5): every object in the repository's object store, reachable or not, read whole. */
function scan(repo: string, needles: string[]): string[] {
  const all = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8')
  return needles.filter(n => all.includes(n))
}

/** A private task kept at Ops: its title and its budget (restricted by the policy) carry sentinels; an earlier title it had
 *  in the store, too. */
async function privateTask(w: World, id = 't-secret'): Promise<void> {
  await w.store.putRecord({ collection: 'tasks', id, visibility: AT_OPS, body: { id, title: `${SENTINEL}old-title`, status: 'todo' }, rev: '' }, 'steward-a', null)
  await w.store.putRecord({ collection: 'tasks', id, visibility: AT_OPS, body: { id, title: 'Review the grant', status: 'todo', budget: `${SENTINEL}budget` }, rev: '' }, 'steward-a', null)
}

describe('A private record moved into git (L6 §12)', () => {
  it('under the solo default a private task moves into data/tasks.yaml in one apply; its restricted fields stay in the store as fields rows', async () => {
    const w = await world()
    await privateTask(w)
    const before = head(w.repo)
    const view = await stage(w, moveOf('tasks:t-secret'))
    expect(view.classes).toEqual(expect.arrayContaining(['workspace', 'publication']))
    expect(view.private).toEqual([{ ref: expect.stringMatching(/^stg-\d+$/), class: 'workspace', op: { op: 'move-to-git', collection: 'tasks', id: 't-secret', level: 'members' } }])
    const out = await apply(w)
    expect(out.commit).toBe(head(w.repo))
    expect(git(w.repo, `rev-list --count ${before}..HEAD`).trim()).toBe('1')
    expect(tasksOf(w.repo).find(t => t.id === 't-secret')).toEqual({ id: 't-secret', title: 'Review the grant', status: 'todo', visibility: 'members' })
    expect(fileAt(w.repo, 'data/tasks.yaml')).not.toContain(SENTINEL)
    expect(w.store.record('tasks', 't-secret')).toBeNull()
    expect(w.store.fields('tasks', 't-secret')).toEqual([{ registry: 'tasks', record: 't-secret', field: 'budget', visibility: AT_OPS, value: `${SENTINEL}budget` }])
    const gone = w.store.history('tasks/t-secret').at(-1)!
    expect(gone).toMatchObject({ by: 'steward-a', after: null, change: expect.stringMatching(/./) })
    // Read through the gate as an Ops wearer: the task, with its budget from the store.
    const read = await ok(await call(w.app, 'GET', '/api/registries/tasks'))
    expect(read.entries.find((e: { id: string }) => e.id === 't-secret')).toMatchObject({ title: 'Review the grant', budget: `${SENTINEL}budget` })
    expect(scan(w.repo, [`${SENTINEL}budget`, `${SENTINEL}old-title`])).toEqual([])
  })

  it('level public writes visibility: public', async () => {
    const w = await world()
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret', 'public'))
    await apply(w)
    expect(tasksOf(w.repo).find(t => t.id === 't-secret')).toMatchObject({ visibility: 'public' })
  })

  it('an id git holds is refused at stage with ID_TAKEN', async () => {
    const w = await world()
    await w.store.putRecord({ collection: 'tasks', id: 't-1', visibility: AT_OPS, body: { id: 't-1', title: 'Kept apart', status: 'todo' }, rev: '' }, 'steward-a', null)
    // To public: git's t-1 is members, so the level is no echo of the record git holds (gate.ts withoutEchoOp).
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: moveOf('tasks:t-1', 'public') } }))
    expect(status).toBe(422)
    expect(body.errors[0].message).toBe(ID_TAKEN('tasks', 't-1'))
    expect(ID_TAKEN('tasks', 't-1')).toBe('tasks already has a record t-1 in the repository, so this private record cannot move there under that id. Nothing was staged.')
  })

  it('a private collection\'s record is refused at stage with PRIVATE_COLLECTION_STAYS', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: AT_OPS, definition: { title: 'Grants' } }, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: AT_OPS, body: { id: 'g-1', title: 'A grant' }, rev: '' }, 'steward-a', null)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: moveOf('grants-private:g-1') } }))
    expect(status).toBe(422)
    expect(body.errors[0].message).toBe(PRIVATE_COLLECTION_STAYS)
    expect(PRIVATE_COLLECTION_STAYS).toBe('Records of a private collection stay in the private store: copy it into a collection in the repository instead. Nothing was staged.')
  })

  it('a move is staged alone: other changes to the same record are refused beside it', async () => {
    const w = await world()
    await privateTask(w)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'tasks:t-secret', set: { visibility: 'members', title: 'Renamed' } }] } }))
    expect([status, body.errors[0].message]).toEqual([422, MOVE_ALONE('tasks:t-secret')])
    await stage(w, [{ op: 'update', record: 'tasks:t-secret', set: { title: 'Renamed' } }])
    const [s2, b2] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: moveOf('tasks:t-secret') } }))
    expect([s2, b2.errors[0].message]).toEqual([422, MOVE_ALONE('tasks:t-secret')])
  })
})

describe('A record with comments written while private (R-L6-T11-3)', () => {
  it('does not move until they are deleted; its conversation stays with it once it moves', async () => {
    const w = await world()
    await privateTask(w)
    const comment = { id: 'c-1', target: 'record:tasks:t-secret', parent: null, anchor: null, by: 'steward-a', body: `${SENTINEL}comment`,
      created: T0.toISOString(), edited: null, resolvedBy: null, resolvedAt: null, deleted: null, writtenLevel: AT_OPS }
    await w.store.writeConversation({ comments: [comment] })
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: moveOf('tasks:t-secret') } }))
    expect([status, body.errors[0].message]).toEqual([422, HAS_CONVERSATION('Review the grant')])
    // Deleted (the row stays, its deletion marked): the move goes ahead, and the row is not purged with the record.
    await w.store.writeConversation({ comments: [{ ...comment, body: '', deleted: T0.toISOString() }] })
    await stage(w, moveOf('tasks:t-secret'))
    await apply(w)
    expect(w.store.record('tasks', 't-secret')).toBeNull()
    expect(w.store.comments('record:tasks:t-secret').map(c => c.id)).toEqual(['c-1'])
    expect(scan(w.repo, [`${SENTINEL}comment`])).toEqual([])
  })

  // PR7-R45: talk the mover may not read does not hold the move (it is not theirs to see, nor to delete): it keeps the level
  // it was written at wherever the record goes, so nobody that level did not admit reads it after the move either.
  it('a comment the mover may not read (written at Council) does not hold the move, and keeps its level after it', async () => {
    const w = await world()
    await privateTask(w)
    await w.store.writeConversation({ comments: [{ id: 'c-council', target: 'record:tasks:t-secret', parent: null, anchor: null, by: 'steward-b',
      body: `${SENTINEL}council`, created: T0.toISOString(), edited: null, resolvedBy: null, resolvedAt: null, deleted: null, writtenLevel: `hat:${COUNCIL}` }] })
    await stage(w, moveOf('tasks:t-secret'))
    await apply(w)
    expect(w.store.record('tasks', 't-secret')).toBeNull()
    expect(w.store.comment('c-council')).toMatchObject({ writtenLevel: `hat:${COUNCIL}`, deleted: null })
    expect(scan(w.repo, [`${SENTINEL}council`])).toEqual([])
  })
})

describe('A move under a publication rule is a proposal (rule 8 until decided)', () => {
  it('under a publication consent rule it is proposed; the ledger holds a placeholder only; an admitted viewer reads MOVES, another "A change to a restricted collection"', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {} }))
    expect([status, body.code]).toEqual([409, 'WIDENS'])
    expect(w.store.record('tasks', 't-secret')).not.toBeNull()
    const id = await propose(w, 'A task goes to the members')
    const entry = entryOf(w.repo, id)
    expect(entry.classes).toEqual(expect.arrayContaining(['workspace', 'publication']))
    expect(entry.ops).toEqual([{ op: 'private', ref: expect.stringMatching(/^prv_[0-9a-f]{16}$/), class: 'workspace', digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }])
    expect(fileAt(w.repo, 'data/proposals.yaml')).not.toContain('Review the grant')
    expect(fileAt(w.repo, 'data/tasks.yaml')).not.toContain('t-secret')
    // Admitted (an Ops wearer): the op, and what it does in words.
    const seen = await ok(await call(w.app, 'GET', `/api/proposals/${id}`))
    expect(seen.private).toEqual([expect.objectContaining({ class: 'workspace', says: MOVES('Review the grant', 'members'), op: { op: 'move-to-git', collection: 'tasks', id: 't-secret', level: 'members' } })])
    expect(MOVES('Review the grant', 'members')).toBe('Moves Review the grant into the repository, readable by members.')
    // Not admitted (Council, a sibling of Ops): the restricted subject, no op.
    const council = await w.signIn(A2)
    const unseen = await ok(await call(w.app, 'GET', `/api/proposals/${id}`, { cookie: council }))
    expect([unseen.title, unseen.ops, unseen.private]).toEqual(['A change to a restricted collection', [], undefined])
    expect(JSON.stringify(unseen)).not.toContain('Review the grant')
    expect(scan(w.repo, ['Review the grant', `${SENTINEL}budget`, `${SENTINEL}old-title`])).toEqual([])
  })

  it('ratify writes the record in its merge commit and deletes the store record with a history row naming the decision', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const id = await propose(w, 'A task goes to the members')
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const out = await ratify(w, id, council)
    const merge = head(w.repo)
    expect(out.commit).toBe(merge)
    expect(git(w.repo, `rev-list --parents -n 1 ${merge}`).trim().split(' ')).toHaveLength(3)
    expect(git(w.repo, `diff --name-only ${merge}^1 ${merge}`).trim().split('\n')).toContain('data/tasks.yaml')
    expect(tasksOf(w.repo).find(t => t.id === 't-secret')).toEqual({ id: 't-secret', title: 'Review the grant', status: 'todo', visibility: 'members' })
    expect(w.store.record('tasks', 't-secret')).toBeNull()
    expect(w.store.fields('tasks', 't-secret').map(f => [f.field, f.value])).toEqual([['budget', `${SENTINEL}budget`]])
    expect(w.store.history('tasks/t-secret').at(-1)).toMatchObject({ after: null, decision: entryOf(w.repo, id).closed.decision })
    expect(w.store.pending(id)).toEqual([])
    expect(w.store.applied(id)).toMatchObject({ proposal: id, commit: merge })
    // Rule 4: L5's sentinel scan finds no restricted value, and nothing of the record from before the decision.
    expect(scan(w.repo, [`${SENTINEL}budget`, `${SENTINEL}old-title`])).toEqual([])
    expect(scan(w.repo, ['Review the grant'])).toEqual(['Review the grant']) // the control: what was decided is there
  })

  it('a crash between the merge commit and the store commit is reconciled at start', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const id = await propose(w, 'A task goes to the members')
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const store = w.store
    store.within = (async (fn: (t: PrivateTransaction) => Promise<unknown>) => {
      const t = await store.begin()
      try { await fn(t) } catch (err) { t.rollback(); throw err }
      t.rollback()
      throw new Error('database disk image is malformed')
    }) as never
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })
    const body = await res.json()
    expect([res.status, body.code, body.commit]).toEqual([503, 'PRIVATE_STORE', head(w.repo)])
    expect(entryOf(w.repo, id).state).toBe('ratified')
    expect(tasksOf(w.repo).map(t => t.id)).toContain('t-secret')
    expect(w.store.record('tasks', 't-secret')).not.toBeNull()
    delete (store as { within?: unknown }).within

    expect(await reconcilePrivate(w.repo, w.store)).toEqual([id])
    expect(w.store.record('tasks', 't-secret')).toBeNull()
    expect(w.store.fields('tasks', 't-secret').map(f => f.value)).toEqual([`${SENTINEL}budget`])
    expect(w.store.history('tasks/t-secret').at(-1)).toMatchObject({ after: null, decision: entryOf(w.repo, id).closed.decision })
    expect(await reconcilePrivate(w.repo, w.store)).toEqual([])
    expect(scan(w.repo, [`${SENTINEL}budget`, `${SENTINEL}old-title`])).toEqual([])
  })
})

describe('A private page moved into git (L6 §12, Q12)', () => {
  const PARENT = 'p-0000000000a1'
  const CHILD = 'p-0000000000b2'
  async function pages(w: World): Promise<void> {
    await w.store.putRecord({ collection: 'pages', id: PARENT, visibility: AT_OPS,
      body: { title: 'Plans', parent: null, order: 1000, markdown: `See [${SENTINEL}child-title](./${CHILD}.md).\n` }, rev: '' }, 'steward-a', null)
    await w.store.putRecord({ collection: 'pages', id: CHILD, visibility: AT_OPS,
      body: { title: `${SENTINEL}child-title`, parent: PARENT, order: 1000, markdown: `${SENTINEL}child-body\n` }, rev: '' }, 'steward-a', null)
  }

  it('a private page moves to pages/<id>.md and its subpages stay private', async () => {
    const w = await world()
    await pages(w)
    await stage(w, moveOf(`pages:${PARENT}`))
    await apply(w)
    const text = fileAt(w.repo, `pages/${PARENT}.md`)
    expect(text).toMatch(/^---\nid: p-0000000000a1\ntitle: Plans\nparent: null\norder: 1000\nvisibility: members\n---\n/)
    // §4.5: its link to the stricter subpage carries ↗, so the subpage's title never enters the repository.
    expect(text).toContain(`[↗](./${CHILD}.md)`)
    expect(w.store.record('pages', PARENT)).toBeNull()
    expect(w.store.record('pages', CHILD)).toMatchObject({ visibility: AT_OPS })
    expect(existsSync(join(w.repo, 'pages', `${CHILD}.md`))).toBe(false)
    expect(scan(w.repo, [`${SENTINEL}child-title`, `${SENTINEL}child-body`])).toEqual([])
  })

  it('a page whose parent is stricter than the level is refused with LOOSER_THAN_PARENT', async () => {
    const w = await world()
    await pages(w)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: moveOf(`pages:${CHILD}`) } }))
    expect([status, body.errors[0].message]).toEqual([422, LOOSER_THAN_PARENT(AT_OPS)])
  })

  it('under a publication consent rule a private page is proposed, and its ratify writes pages/<id>.md in the merge', async () => {
    const w = await world(CONSENT)
    await pages(w)
    await stage(w, moveOf(`pages:${PARENT}`))
    const id = await propose(w, 'The plans go to the members')
    expect(existsSync(join(w.repo, 'pages', `${PARENT}.md`))).toBe(false)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    await ratify(w, id, council)
    expect(git(w.repo, `diff --name-only HEAD^1 HEAD`).trim().split('\n')).toContain(`pages/${PARENT}.md`)
    expect(fileAt(w.repo, `pages/${PARENT}.md`)).toContain(`[↗](./${CHILD}.md)`)
    expect(w.store.record('pages', PARENT)).toBeNull()
    expect(w.store.record('pages', CHILD)).not.toBeNull()
    expect(scan(w.repo, [`${SENTINEL}child-title`, `${SENTINEL}child-body`])).toEqual([])
  })

  it('level public writes visibility: public on the page', async () => {
    const w = await world()
    await pages(w)
    await stage(w, moveOf(`pages:${PARENT}`, 'public'))
    await apply(w)
    expect(fileAt(w.repo, `pages/${PARENT}.md`)).toContain('\nvisibility: public\n')
  })
})

// The scoped review of Task 11 (platform full, at 1f8419af) and its fix wave: each finding's test, kept red before its fix.
describe('Task 11 review: a move publishes exactly what was staged (I-1)', () => {
  it('an edit after Propose makes the ratify PRIVATE_STALE, naming nothing; nothing of the edit reaches any object', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const id = await propose(w, 'A task goes to the members')
    // Edited in the store after the decision was asked: a new title and a field the policy does not restrict. The Hub
    // refuses such an edit while the proposal holds the move (L6 carries K5, below); the ratify's digest is the backstop.
    const kept = w.store.record('tasks', 't-secret')!
    await w.store.putRecord({ ...kept, body: { ...kept.body, title: `${SENTINEL}written-after-propose`, notes: `${SENTINEL}notes-after` } }, 'steward-a', null)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council }))
    expect([status, body.code, body.error]).toEqual([409, 'PRIVATE_STALE', PRIVATE_STALE])
    expect(head(w.repo)).toBe(before)
    expect(w.store.record('tasks', 't-secret')).toMatchObject({ body: { title: `${SENTINEL}written-after-propose` } })
    expect(scan(w.repo, [`${SENTINEL}written-after-propose`, `${SENTINEL}notes-after`, `${SENTINEL}budget`])).toEqual([])
  })

  it('a record changed between staging and a direct apply is refused with MOVE_CHANGED; nothing is written', async () => {
    const w = await world()
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    await w.store.putRecord({ collection: 'tasks', id: 't-secret', visibility: AT_OPS,
      body: { id: 't-secret', title: `${SENTINEL}renamed`, status: 'todo', budget: `${SENTINEL}budget` }, rev: '' }, 'steward-b', null)
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {} }))
    expect([status, body.error]).toEqual([409, MOVE_CHANGED('tasks:t-secret')])
    expect(MOVE_CHANGED('tasks:t-secret')).toBe('tasks:t-secret changed since this move was staged; stage the move again. Nothing was written.')
    expect(head(w.repo)).toBe(before)
    expect(w.store.record('tasks', 't-secret')).not.toBeNull()
    expect(scan(w.repo, [`${SENTINEL}renamed`, `${SENTINEL}budget`])).toEqual([])
  })
})

describe('Task 11 review: a move is judged where it lands at Revise and at ratify (I-2, M-5)', () => {
  const A = 'p-0000000000a1'
  const B = 'p-0000000000b2'
  /** Two private pages: A at the root, B under the handbook, a git page; `raised` gives the handbook's tree a rule of its own. */
  async function handbook(raised: boolean): Promise<World> {
    const RAISED = CONSENT.replace('  decisions: []', '    - { id: handbook, applies_to: ["workspace:tree-handbook-3f2a"], propose: ops, decide: { by: council, method: approve, count: 2 } }\n  decisions: []')
    const w = await world(raised ? RAISED : CONSENT)
    mkdirSync(join(w.repo, 'pages'), { recursive: true })
    writeFileSync(join(w.repo, 'pages', 'handbook-3f2a.md'), '---\nid: handbook-3f2a\ntitle: Handbook\nparent: null\norder: 1000\nvisibility: members\n---\nThe handbook.\n')
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a git page"')
    await w.store.putRecord({ collection: 'pages', id: A, visibility: AT_OPS, body: { title: 'Loose', parent: null, order: 1000, markdown: 'a\n' }, rev: '' }, 'steward-a', null)
    await w.store.putRecord({ collection: 'pages', id: B, visibility: AT_OPS, body: { title: 'Under the handbook', parent: 'handbook-3f2a', order: 1000, markdown: 'b\n' }, rev: '' }, 'steward-a', null)
    return w
  }

  it('Revise refuses (409 CLASSES) a move added under a raised tree the proposal was not opened under', async () => {
    const w = await handbook(true)
    await stage(w, moveOf(`pages:${A}`))
    const id = await propose(w, 'A goes to the members')
    expect(entryOf(w.repo, id).rules.map((r: { id: string }) => r.id)).toEqual(['publish'])
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
    await stage(w, moveOf(`pages:${B}`))
    const [status, body] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops: [] } }))
    expect([status, body.code]).toEqual([409, 'CLASSES'])
    expect(body.error).toContain('rule "handbook"')
    expect(entryOf(w.repo, id).ops).toHaveLength(1)
  })

  it('a ratify judges a move where it lands now: under a tree raised since Propose it is PRIVATE_STALE, naming nothing (M-5)', async () => {
    const w = await handbook(false)
    await stage(w, moveOf(`pages:${B}`))
    const id = await propose(w, 'B goes to the members')
    expect(entryOf(w.repo, id).rules.map((r: { id: string }) => r.id)).toEqual(['publish'])
    // The trunk raises the handbook's tree after the proposal opened.
    const raised = CONSENT.replace('  decisions: []', '    - { id: handbook, applies_to: ["workspace:tree-handbook-3f2a"], propose: ops, decide: { by: council, method: approve, count: 2 } }\n  decisions: []')
    writeFileSync(join(w.repo, 'data', 'governance.yaml'), fileAt(w.repo, 'data/governance.yaml').replace('  decisions:', raised.slice(raised.indexOf('    - { id: handbook')).replace('  decisions: []\n', '') + '  decisions:'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: the handbook raised"')
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council }))
    expect([status, body.code, body.error]).toEqual([409, 'PRIVATE_STALE', PRIVATE_STALE])
    expect(JSON.stringify(body)).not.toContain(B)
    expect(head(w.repo)).toBe(before)
    expect(existsSync(join(w.repo, 'pages', `${B}.md`))).toBe(false)
    expect(w.store.record('pages', B)).not.toBeNull()
  })
})

describe('Task 11 review: a narrowing in the same change is judged on the safe side (I-4)', () => {
  /** data/visibility.yaml narrowing `notes` to Ops beside the budget, staged whole as a file op. */
  const NARROWED = POLICY.replace(`fields: { budget: "hat:${OPS}" }`, `fields: { notes: "hat:${OPS}", budget: "hat:${OPS}" }`)

  it('P3: a move beside the narrowing keeps the narrowed field in the store as a fields row; it is in no object', async () => {
    const w = await world()
    await w.store.putRecord({ collection: 'tasks', id: 't-secret', visibility: AT_OPS,
      body: { id: 't-secret', title: 'Review the grant', status: 'todo', notes: `${SENTINEL}notes`, budget: `${SENTINEL}budget` }, rev: '' }, 'steward-a', null)
    expect(NARROWED).not.toBe(POLICY)
    await stage(w, [{ op: 'file', path: 'data/visibility.yaml', text: NARROWED }])
    await stage(w, moveOf('tasks:t-secret'))
    await apply(w)
    expect(fileAt(w.repo, 'data/visibility.yaml')).toBe(NARROWED)
    expect(tasksOf(w.repo).find(t => t.id === 't-secret')).toEqual({ id: 't-secret', title: 'Review the grant', status: 'todo', visibility: 'members' })
    expect(w.store.fields('tasks', 't-secret').map(f => [f.field, f.visibility, f.value]).sort()).toEqual([
      ['budget', AT_OPS, `${SENTINEL}budget`], ['notes', AT_OPS, `${SENTINEL}notes`],
    ])
    expect(scan(w.repo, [`${SENTINEL}notes`, `${SENTINEL}budget`])).toEqual([])
  })

  it('P5: a plain update typing the narrowed field beside the narrowing is refused 422 in gitSafetyProblems\' words; nothing is committed', async () => {
    const w = await world()
    await stage(w, [{ op: 'file', path: 'data/visibility.yaml', text: NARROWED }])
    await stage(w, [{ op: 'update', record: 'tasks:t-1', set: { notes: `${SENTINEL}typed` } }])
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {} }))
    expect(status).toBe(422)
    expect(body.errors).toEqual([{ record: 'tasks:t-1', field: 'notes',
      message: `Not applied: data/tasks.yaml would hold the notes of t-1, which data/visibility.yaml restricts to ${AT_OPS}; it belongs in the private store, `
        + 'and this change narrows it. Stage the narrowing on its own first, then the value: it then goes to the private store. Nothing was written.' }])
    expect(head(w.repo)).toBe(before)
    expect(fileAt(w.repo, 'data/visibility.yaml')).toBe(POLICY)
    expect(scan(w.repo, [`${SENTINEL}typed`])).toEqual([])
  })

  // L6 carries K1 (PF-R15 at Propose and Revise): the value never sits in a ledger op.
  const narrowedHere = (verb: string) => `${verb}: data/tasks.yaml would hold the notes of t-1, which data/visibility.yaml restricts to ${AT_OPS}; `
    + 'it belongs in the private store, and this change narrows it. Stage the narrowing on its own first, then the value: it then goes to the private store. Nothing was written.'

  it('K1: Propose refuses 422 a value typed beside a narrowing of its field in the same change; no ledger entry holds it', async () => {
    const w = await world(CONSENT)
    await stage(w, [{ op: 'file', path: 'data/visibility.yaml', text: NARROWED }])
    await stage(w, [{ op: 'update', record: 'tasks:t-1', set: { notes: `${SENTINEL}typed` } }])
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/proposals', { body: { title: 'Narrow the notes' } }))
    expect([status, body.errors]).toEqual([422, [{ record: 'tasks:t-1', field: 'notes', message: narrowedHere('Not proposed') }]])
    expect(head(w.repo)).toBe(before)
    expect(readLedger(w.repo).entries).toEqual([])
    expect(scan(w.repo, [`${SENTINEL}typed`])).toEqual([])
  })

  it('K1: Revise refuses 422 the same; the proposal keeps its ops', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const id = await propose(w, 'A task goes to the members')
    const held = entryOf(w.repo, id).ops
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
    const before = head(w.repo)
    const ops = [{ op: 'file', path: 'data/visibility.yaml', text: NARROWED, base: null },
      { op: 'update', record: 'tasks:t-1', set: { notes: `${SENTINEL}typed` }, base: null }]
    const [status, body] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops } }))
    expect([status, body.errors]).toEqual([422, [{ record: 'tasks:t-1', field: 'notes', message: narrowedHere('Not revised') }]])
    expect(head(w.repo)).toBe(before)
    expect(entryOf(w.repo, id).ops).toEqual(held)
    expect(scan(w.repo, [`${SENTINEL}typed`])).toEqual([])
  })
})

// L6 carries K5 (the M4 tail): while an open proposal holds a move of a record, an edit of it would leave the move stale
// (its digest pins the record), so the Hub refuses it in the move's words; withdrawn, the record is editable again.
describe('a move held by an open proposal (K5)', () => {
  it('the tray refuses an edit of the record 422 with MOVE_PROPOSED; the record is as it was; once withdrawn it stages', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const id = await propose(w, 'A task goes to the members')
    const kept = w.store.record('tasks', 't-secret')
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'tasks:t-secret', set: { title: 'Renamed' } }] } }))
    expect([status, body.errors]).toEqual([422, [{ record: 'tasks:t-secret', field: '', message: MOVE_PROPOSED('record', id) }]])
    expect(MOVE_PROPOSED('record', id)).toBe(`A move of this record into the repository is proposed in ${id}: an edit now would leave the move stale. `
      + 'Decide or withdraw the proposal first. Nothing was written.')
    expect(w.store.record('tasks', 't-secret')).toEqual(kept)
    const tray = await ok(await call(w.app, 'GET', '/api/changes'))
    expect(JSON.stringify(tray)).not.toContain('Renamed')
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'withdraw' } }))
    await stage(w, [{ op: 'update', record: 'tasks:t-secret', set: { title: 'Renamed' } }])
  })

  it('an edit staged before the move was proposed is refused at apply in the same words; nothing is written', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, [{ op: 'update', record: 'tasks:t-secret', set: { title: 'Renamed' } }])
    // Another tray's move of the record, proposed since (its pending row, as Propose writes it).
    const kept = w.store.record('tasks', 't-secret')!
    await w.store.tx(t => t.putPending({ ref: 'prv-1', proposal: 'P-2026-11-05-001', salt: 'salt', digest: 'sha256:held',
      ops: [{ op: 'move-to-git', collection: 'tasks', id: 't-secret', level: 'members', digest: 'sha256:held' }] }))
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {} }))
    expect([status, body.errors]).toEqual([422, [{ record: 'tasks:t-secret', field: '', message: MOVE_PROPOSED('record', 'P-2026-11-05-001') }]])
    expect(head(w.repo)).toBe(before)
    expect(w.store.record('tasks', 't-secret')).toEqual(kept)
  })
})

describe('Task 11 review: the store\'s side of a move checks its conversation in its transaction (M-3)', () => {
  it('a comment written between the plan and the write refuses the apply; nothing is moved or committed', async () => {
    const w = await world()
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const store = w.store
    const within = store.within.bind(store)
    // Written after applyAs planned the move, before its transaction begins (the one await between them).
    store.within = (async (fn: (t: PrivateTransaction) => Promise<unknown>) => {
      await store.writeConversation({ comments: [{ id: 'c-late', target: 'record:tasks:t-secret', parent: null, anchor: null, by: 'steward-b',
        body: `${SENTINEL}late-comment`, created: T0.toISOString(), edited: null, resolvedBy: null, resolvedAt: null, deleted: null, writtenLevel: AT_OPS }] })
      return within(fn as never)
    }) as never
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {} }))
    expect([status, body.code, body.error]).toEqual([409, 'PRIVATE_CONFLICT', MOVE_CHANGED('tasks:t-secret')])
    expect(head(w.repo)).toBe(before)
    expect(w.store.record('tasks', 't-secret')).not.toBeNull()
    expect(scan(w.repo, [`${SENTINEL}late-comment`, `${SENTINEL}budget`])).toEqual([])
  })
})

describe('Task 11 review: the reconcile keeps what git does not hold (M-2)', () => {
  it('a narrowing between the merge and the restart keeps its value in the store; a field git lacks is kept; no row is overwritten', async () => {
    const w = await world(CONSENT)
    await privateTask(w)
    await stage(w, moveOf('tasks:t-secret'))
    const id = await propose(w, 'A task goes to the members')
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const store = w.store
    store.within = (async (fn: (t: PrivateTransaction) => Promise<unknown>) => {
      const t = await store.begin()
      try { await fn(t) } catch (err) { t.rollback(); throw err }
      t.rollback()
      throw new Error('database disk image is malformed')
    }) as never
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })).status).toBe(503)
    delete (store as { within?: unknown }).within
    // Between the merge and the restart: status narrowed to Ops (git's value, edited to "done" since, moved to the store as
    // the narrow control does), and the budget's own level dropped from the policy.
    expect(tasksOf(w.repo).find(t => t.id === 't-secret')).toEqual({ id: 't-secret', title: 'Review the grant', status: 'todo', visibility: 'members' })
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), `${TASKS}  - { id: t-secret, title: Review the grant, visibility: members }\n`)
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), `visibility:\n  collections:\n    tasks: { default: members, fields: { status: "hat:${OPS}" } }\n    pages: { default: members }\n`)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: status narrowed, the budget no longer restricted"')
    expect(tasksOf(w.repo).find(t => t.id === 't-secret')).toEqual({ id: 't-secret', title: 'Review the grant', visibility: 'members' })
    await w.store.putField({ registry: 'tasks', record: 't-secret', field: 'status', visibility: AT_OPS, value: 'done' }, 'steward-a', null)

    expect(await reconcilePrivate(w.repo, w.store)).toEqual([id])
    expect(w.store.record('tasks', 't-secret')).toBeNull()
    expect(w.store.fields('tasks', 't-secret').map(f => [f.field, f.visibility, f.value]).sort()).toEqual([
      ['budget', AT_OPS, `${SENTINEL}budget`], ['status', AT_OPS, 'done'],
    ])
    expect(scan(w.repo, [`${SENTINEL}budget`, `${SENTINEL}old-title`])).toEqual([])
  })
})
