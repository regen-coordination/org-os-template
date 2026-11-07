import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { mountProposals, type ProposalRoutesDeps } from '../../server/proposals/routes.ts'
import { createEntry, readLedger } from '../../server/proposals/ledger.ts'
import { Refusal } from '../../server/changes/apply.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore, type PrivateTransaction } from '../../server/private/store.ts'
import { RESTRICTED_SUBJECT, STORE_FAILED } from '../../server/private/ops.ts'
import { reconcilePrivate } from '../../server/private/proposals.ts'
import { revOf, checkProposals } from '../../lib/proposals.mjs'
import { validateRepo } from '../../lib/data-validate.mjs'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

// L5 spec §9.6 (rule 8 in the ledger), §10.2 (`pending`, `applied`), §10.3 (Propose writes placeholders and the ops to
// `pending`; Ratify applies them around the merge commit; reconcile on start), §9.5 (a proposal touching data the viewer
// may not see shows only "A change to a restricted collection" and its rule). Task 15.
//
// Every test builds a fresh temporary repository (makeChangeRepo) and keeps its private store in a temp folder of its
// own: nothing is written inside this worktree, nothing touches the network. Locally, git's identity is steward-a, whose
// wallet is A1 (Ops: admitted to members.email); A2 signs in and wears Council (a sibling of Ops, so not admitted to it)
// and decides members' changes. steward-c is a member with no wallet and so no hats.

const T0 = new Date('2026-10-29T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const SENTINEL = 'sentinel-b-7f3a@example.invalid'
const SECOND = 'sentinel-b-second-91c2@example.invalid'

const APPROVE = '{ by: council, method: approve, count: 1 }'
const VOTE = '{ by: council, method: vote, window: PT1M, quorum: 1, threshold: 0.5 }'
const GOVERNANCE = (decide = APPROVE) => `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    member: { all: true }
  rules:
    - { id: people, applies_to: [members, records], propose: member, decide: ${decide} }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, role: Contributor }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const VISIBILITY = `visibility:
  collections:
    members: { default: members, fields: { email: "hat:${OPS}" } }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World {
  repo: string
  store: PrivateStore
  app: Hono
  /** An app over the same repository whose private store is `access`, with `deps` beside the world's. */
  appWith: (access: () => PrivateStore, deps?: Partial<ProposalRoutesDeps>) => Hono
  signIn: (account: string) => Promise<string>
  wear: (account: string, hats: string[]) => void
  tick: (ms: number) => void
}

async function world(decide = APPROVE, deps: Partial<ProposalRoutesDeps> = {}): Promise<World> {
  const repo = makeChangeRepo(GOVERNANCE(decide))
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, what is restricted"')
  const dir = mkdtempSync(join(tmpdir(), 'proposals-private-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  await store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants' } }, 'steward-a')
  let clock = T0
  const now = () => clock
  const worn: Record<string, string[]> = { [A1]: [OPS], [A2]: [COUNCIL] }
  const hatsOf = (account: string) => Object.entries(worn).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? []
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, hats: hatsOf(account), block: 100, readAt: clock.toISOString() })
  const list = (hat: string): WearersReading => {
    const wearers = Object.entries(worn).filter(([, h]) => h.includes(hat)).map(([a]) => a)
    return { ok: true, system: 'hats-main', hat, wearers, holders: wearers, complete: true, block: 100, readAt: clock.toISOString() }
  }
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => list(hat)),
  }
  const membership = new Membership({ repo, reader: reader as never, now })
  const appWith = (access: () => PrivateStore, more: Partial<ProposalRoutesDeps> = {}) =>
    createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore, ...deps, ...more }), {
      request: withRequest({ repo, hosted: false, membership, store, now }),
      privateStore: access,
    })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    return `house_session=${(await createSession(store, account, now)).token}`
  }
  return {
    repo, store, app: appWith(() => store), appWith, signIn,
    wear: (account, hats) => { worn[account] = hats },
    tick: ms => { clock = new Date(clock.getTime() + ms) },
  }
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
const stage = async (w: World, ops: unknown[], cookie?: string) => ok(await call(w.app, 'POST', '/api/changes/ops', { body: { ops }, cookie }))
async function propose(w: World, title = 'Steward B keeps the treasury', cookie?: string): Promise<string> {
  return String((await ok(await call(w.app, 'POST', '/api/proposals', { body: { title }, cookie }), 201)).id)
}
const approve = async (w: World, id: string, cookie: string) => ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie }))
const entryOf = (repo: string, id: string) => readLedger(repo).entries.find(e => String(e.id) === id)! as any // eslint-disable-line @typescript-eslint/no-explicit-any
const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const changeFile = (repo: string, actor = 'steward-a') => new ChangeStore(repo).file(actor)
const as = (repo: string, email: string) => { git(repo, `config user.email ${email}`) }

/** Every object in the repository's history, as text (L5 spec §10.5's sentinel check). */
const everyObject = (repo: string) => git(repo, 'rev-list --all --objects').split('\n').filter(Boolean)
  .map(line => git(repo, `cat-file -p ${line.split(' ')[0]}`)).join('\n')

/** Canonical JSON (keys sorted at every depth), written here apart from the code, for the digest. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const EMAIL_FIELD = (value: string) =>
  ({ op: 'put-field', field: { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value } })
const PLACEHOLDER = { op: 'private', ref: expect.stringMatching(/^prv_[0-9a-f]{16}$/), class: 'members', digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }

describe('Propose with a private part (§9.6, §10.3)', () => {
  it('proposing a private change writes placeholders to data/proposals.yaml and the ops to pending', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const change = JSON.parse(readFileSync(changeFile(w.repo), 'utf8'))
    const id = await propose(w)
    const entry = entryOf(w.repo, id)
    expect(entry.ops).toEqual([
      { op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' }, base: expect.any(String) },
      PLACEHOLDER,
    ])
    expect(entry.classes).toEqual(['members'])
    // rev covers what git holds, the placeholder with it: approvals bind to it.
    expect(entry.rev).toBe(revOf(entry.ops))
    expect(entry.rev).not.toBe(revOf(entry.ops.slice(0, 1)))
    const rows = w.store.pending(id)
    expect(rows).toEqual([{ ref: entry.ops[1].ref, proposal: id, salt: expect.stringMatching(/^[0-9a-f]{64}$/), ops: [EMAIL_FIELD(SENTINEL)], digest: entry.ops[1].digest }])
    // The digest is over the salt and the canonical JSON of the real ops, both kept in the store.
    expect(rows[0]!.digest).toBe(`sha256:${sha256(rows[0]!.salt + canonical(rows[0]!.ops))}`)
    // The staged rows moved to pending; the tray is empty.
    expect(w.store.staged(change.id)).toEqual([])
    expect(existsSync(changeFile(w.repo))).toBe(false)
    // Nothing restricted is in git, and the ledger is valid as validate:data and checkProposals read it.
    expect(everyObject(w.repo)).not.toContain(SENTINEL)
    expect(readFileSync(join(w.repo, 'data', 'proposals.yaml'), 'utf8')).not.toContain('email')
    expect(validateRepo(w.repo).filter((p: { level: string }) => p.level === 'error')).toEqual([])
    expect(checkProposals(readLedger(w.repo).entries, { classes: ['members', 'records'], classOf: () => 'members' })).toEqual([])
    // Its branch carries the git part alone.
    expect(git(w.repo, `show proposal/${id}:data/members.yaml`)).toContain('Treasurer')
    expect(git(w.repo, `show proposal/${id}:data/members.yaml`)).not.toContain(SENTINEL)
  })

  it('the digest differs for two proposals of the same value (salted)', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SENTINEL } }])
    const one = await propose(w, 'First')
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SENTINEL } }])
    const two = await propose(w, 'Second')
    const [a, b] = [entryOf(w.repo, one).ops, entryOf(w.repo, two).ops]
    expect([a, b]).toEqual([[PLACEHOLDER], [PLACEHOLDER]])
    expect(w.store.pending(one)[0]!.ops).toEqual(w.store.pending(two)[0]!.ops)
    expect(a[0].digest).not.toBe(b[0].digest)
    expect(a[0].ref).not.toBe(b[0].ref)
    expect(w.store.pending(one)[0]!.salt).not.toBe(w.store.pending(two)[0]!.salt)
  })

  it('the private part is judged for the proposer now: a hat taken off since staging refuses, writing nothing', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SENTINEL } }])
    w.wear(A1, [])
    const before = head(w.repo)
    const res = await call(w.app, 'POST', '/api/proposals', { body: { title: 'x' } })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('NOT_ADMITTED')
    expect(head(w.repo)).toBe(before)
    expect(w.store.pending('anything')).toEqual([])
    expect(existsSync(changeFile(w.repo))).toBe(true)
  })

  it('a store that cannot be reached refuses Propose before anything is written', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SENTINEL } }])
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    const before = head(w.repo)
    const res = await call(down, 'POST', '/api/proposals', { body: { title: 'x' } })
    expect([res.status, await res.json()]).toEqual([503, { error: 'The private store is down for this test.', code: 'PRIVATE_STORE' }])
    expect(head(w.repo)).toBe(before)
  })
})

describe('Revise with a private part', () => {
  it('a revision changes rev and the digest; one that leaves the private part as it was keeps the digest', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const first = entryOf(w.repo, id)
    // Revise: the proposal's ops into the author's tray, the private part with them (its real op, for its author).
    const tray = await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
    expect(tray.revises).toBe(id)
    expect(tray.private).toEqual([{ ref: expect.stringMatching(/^stg-\d+$/), class: 'members', op: EMAIL_FIELD(SENTINEL) }])
    // A new value for the restricted field, then Update proposal with the tray's git ops.
    const edited = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SECOND } }])
    const gitOps = edited.ops.map(({ before: _b, ...op }: Record<string, unknown>) => op)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops: gitOps } }))
    const second = entryOf(w.repo, id)
    expect(second.rev).not.toBe(first.rev)
    expect(second.rev).toBe(revOf(second.ops))
    expect(second.ops[1]).toEqual(PLACEHOLDER)
    expect(second.ops[1].digest).not.toBe(first.ops[1].digest)
    expect(w.store.pending(id)).toEqual([expect.objectContaining({ ref: second.ops[1].ref, ops: [EMAIL_FIELD(SECOND)] })])
    expect(second.events.at(-1)).toMatchObject({ kind: 'revise', rev: second.rev, ops: second.ops })
    expect(everyObject(w.repo)).not.toContain(SECOND)
    await call(w.app, 'DELETE', '/api/changes')

    // Again, changing the git part only: the private part stands as it was, its placeholder too.
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
    const role = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Steward' } }])
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops: role.ops.map(({ before: _b, ...op }: Record<string, unknown>) => op) } }))
    const third = entryOf(w.repo, id)
    expect(third.rev).not.toBe(second.rev)
    expect(third.ops[1]).toEqual(second.ops[1])
    expect(w.store.pending(id)).toEqual([expect.objectContaining({ ref: second.ops[1].ref, ops: [EMAIL_FIELD(SECOND)] })])
  })

  it('Update proposal with no tray revising it keeps the proposal\'s private part', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const first = entryOf(w.repo, id)
    const res = await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops: [{ ...first.ops[0], set: { role: 'Steward' } }] } })
    await ok(res)
    const next = entryOf(w.repo, id)
    expect(next.ops[1]).toEqual(first.ops[1])
    expect(next.rev).not.toBe(first.rev)
    expect(w.store.pending(id)).toEqual([expect.objectContaining({ ref: first.ops[1].ref, ops: [EMAIL_FIELD(SENTINEL)] })])
  })

  it('Revise is refused to an author no longer admitted to the private part, and their tray is untouched', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    w.wear(A1, [])
    const res = await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} })
    const text = await res.text()
    expect(res.status).toBe(409)
    expect(JSON.parse(text).code).toBe('NOT_ADMITTED')
    expect(text).not.toContain(SENTINEL)
    expect(existsSync(changeFile(w.repo))).toBe(false)
  })
})

describe('what a viewer sees of a proposal on restricted data (rule 8, §9.5)', () => {
  it('an admitted viewer sees the real ops; another sees "A change to a restricted collection" and the rule, and no op list', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const ref = entryOf(w.repo, id).ops[1].ref

    // steward-a wears Ops: the git op, and the private one merged from the store.
    const mine = await ok(await call(w.app, 'GET', `/api/proposals/${id}`))
    expect(mine.title).toBe('Steward B keeps the treasury')
    expect(mine.ops).toEqual([{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' }, base: expect.any(String) }])
    expect(mine.private).toEqual([{ ref, class: 'members', op: EMAIL_FIELD(SENTINEL) }])
    expect(mine.current).toHaveLength(1)

    // A2 wears Council, not Ops; steward-c wears nothing.
    const council = await w.signIn(A2)
    const listed = await ok(await call(w.app, 'GET', '/api/proposals', { cookie: council }))
    as(w.repo, 'steward-c@example.test')
    const plain = await call(w.app, 'GET', `/api/proposals/${id}`)
    as(w.repo, 'admin-test@local')
    for (const [res, list] of [[await call(w.app, 'GET', `/api/proposals/${id}`, { cookie: council }), false], [plain, false], [listed, true]] as const) {
      const text = list ? JSON.stringify(res) : await (res as Response).text()
      const body = list ? (res as any[]).find(p => p.id === id) : JSON.parse(text) // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(body.title).toBe(RESTRICTED_SUBJECT)
      expect(body.rules).toEqual([expect.objectContaining({ sentence: expect.any(String) })])
      expect(body.ops).toEqual([])
      expect(body.private).toBeUndefined()
      expect(body.restricted).toBe(true)
      if (!list) expect([body.diff, body.current]).toEqual([null, []])
      expect(text).not.toContain(SENTINEL)
      expect(text).not.toContain('Steward B keeps the treasury')
      expect(text).not.toContain('Treasurer')
    }
  })
})

describe('Ratify with a private part (§10.3)', () => {
  it('ratify applies pending and marks applied in the same act as the merge, by a ratifier not admitted to it', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council }))
    const entry = entryOf(w.repo, id)
    expect(entry.state).toBe('ratified')
    const merge = head(w.repo)
    expect(git(w.repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toHaveLength(3)
    expect(w.store.fields('members', 'steward-b')).toEqual([{ registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: SENTINEL }])
    expect(w.store.applied(id)).toEqual({ proposal: id, commit: merge, at: expect.any(String) })
    expect(w.store.pending(id)).toEqual([])
    // Written by the ratifier, under the decision row ratify wrote.
    expect(String(entry.closed.by).toLowerCase()).toBe(A2)
    expect(w.store.history('members/steward-b/email').at(-1)).toMatchObject({ by: entry.closed.by, change: null, decision: entry.closed.decision })
    expect(git(w.repo, 'show HEAD:data/members.yaml')).toContain('Treasurer')
    expect(everyObject(w.repo)).not.toContain(SENTINEL)
    expect(validateRepo(w.repo).filter((p: { level: string }) => p.level === 'error')).toEqual([])
  })

  it('a merge that fails rolls the store back: nothing private is written, pending stays, nothing is applied', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const failing = w.appWith(() => w.store, { ratifyGit: { commit: async () => { throw new Error('a hook refused it') } } })
    const before = head(w.repo)
    const res = await call(failing, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })
    expect(res.status).toBe(503)
    expect(head(w.repo)).toBe(before)
    expect(w.store.fields('members', 'steward-b')).toEqual([])
    expect(w.store.pending(id)).toHaveLength(1)
    expect(w.store.applied(id)).toBeNull()
  })

  it('a crash between the merge commit and the store commit is applied by reconcilePrivate at the next start, once', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    // The store's COMMIT fails after fn resolved (the merge made): its writes are rolled back, and it throws.
    const store = w.store
    store.within = (async (fn: (t: PrivateTransaction) => Promise<unknown>) => {
      const t = await store.begin()
      try { await fn(t) } catch (err) { t.rollback(); throw err }
      t.rollback()
      throw new Error('database disk image is malformed')
    }) as never
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })
    const text = await res.text()
    const body = JSON.parse(text)
    expect([res.status, body.code, body.commit]).toEqual([503, 'PRIVATE_STORE', head(w.repo)])
    expect(text).not.toContain('malformed')
    expect(entryOf(w.repo, id).state).toBe('ratified')
    expect(w.store.fields('members', 'steward-b')).toEqual([])
    expect(w.store.pending(id)).toHaveLength(1)
    delete (store as { within?: unknown }).within

    // The next start: applied once, then nothing more.
    const merge = head(w.repo)
    expect(await reconcilePrivate(w.repo, w.store)).toEqual([id])
    expect(w.store.fields('members', 'steward-b').map(f => f.value)).toEqual([SENTINEL])
    expect(w.store.applied(id)).toEqual({ proposal: id, commit: merge, at: expect.any(String) })
    expect(w.store.pending(id)).toEqual([])
    const rows = w.store.history('members/steward-b/email').length
    expect(await reconcilePrivate(w.repo, w.store)).toEqual([])
    expect(w.store.history('members/steward-b/email')).toHaveLength(rows)
  })

  it('a store that cannot be reached refuses the ratify before the merge; the registries still answer', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    const before = head(w.repo)
    const res = await call(down, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })
    expect([res.status, await res.json()]).toEqual([503, { error: 'The private store is down for this test.', code: 'PRIVATE_STORE' }])
    expect(head(w.repo)).toBe(before)
    expect(git(w.repo, 'status --porcelain')).toBe('')
    expect(entryOf(w.repo, id).state).toBe('open')
    expect(w.store.pending(id)).toHaveLength(1)
    expect((await call(down, 'GET', '/api/registries/members')).status).toBe(200)
  })

  it('a private part that no longer applies refuses the ratify in words that name nothing restricted', async () => {
    const w = await world()
    await stage(w, [{ op: 'create', record: 'grants-private:g-1', value: { id: 'g-1', title: SENTINEL } }])
    const id = await propose(w, 'A grant')
    expect(entryOf(w.repo, id).ops).toEqual([{ ...PLACEHOLDER, class: 'records' }])
    // Meanwhile the store got a record of that id.
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 'other' }, rev: '' }, 'steward-a', null)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    const before = head(w.repo)
    const res = await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })
    const text = await res.text()
    expect([res.status, JSON.parse(text).code]).toEqual([409, 'PRIVATE_STALE'])
    for (const word of ['g-1', 'grants-private', SENTINEL, 'other']) expect(text).not.toContain(word)
    expect(head(w.repo)).toBe(before)
    expect(w.store.pending(id)).toHaveLength(1)
  })

  it('a proposal with only a private part builds an empty branch commit and is ratified', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SENTINEL } }])
    const id = await propose(w)
    expect(git(w.repo, `log -1 --format=%s proposal/${id}`).trim()).toBe(`proposal ${id}: ${RESTRICTED_SUBJECT}`)
    const council = await w.signIn(A2)
    await approve(w, id, council)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council }))
    expect(entryOf(w.repo, id).state).toBe('ratified')
    expect(w.store.fields('members', 'steward-b').map(f => f.value)).toEqual([SENTINEL])
    expect(w.store.applied(id)?.commit).toBe(head(w.repo))
    expect(everyObject(w.repo)).not.toContain(SENTINEL)
  })
})

describe('closings drop pending', () => {
  it('withdraw drops pending', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'withdraw' } }))
    expect(entryOf(w.repo, id).state).toBe('withdrawn')
    expect(w.store.pending(id)).toEqual([])
    expect(w.store.fields('members', 'steward-b')).toEqual([])
  })

  it('reject drops pending', async () => {
    const w = await world(VOTE)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const council = await w.signIn(A2)
    w.tick(10_000)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'vote', vote: 'no' }, cookie: council }))
    w.tick(61_000)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/close`, { body: { outcome: 'rejected' }, cookie: await w.signIn(A2) }))
    expect(entryOf(w.repo, id).state).toBe('rejected')
    expect(w.store.pending(id)).toEqual([])
    expect(w.store.fields('members', 'steward-b')).toEqual([])
  })

  it('a closing made while the store is down leaves pending, and the next start drops it', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    await ok(await call(down, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'withdraw' } }))
    expect(w.store.pending(id)).toHaveLength(1)
    expect(await reconcilePrivate(w.repo, w.store)).toEqual([])
    expect(w.store.pending(id)).toEqual([])
  })
})

describe('fix round 1 (review I1, I2, M6)', () => {
  it('a proposal holding only a private part loads into the tray, and Update proposal carries the new value (I1)', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SENTINEL } }])
    const id = await propose(w)
    const first = entryOf(w.repo, id)
    const tray = await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
    expect([tray.ops, tray.private.length]).toEqual([[], 1])
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: SECOND } }])
    // The client sends the tray's git ops, none here.
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops: [] } }))
    const next = entryOf(w.repo, id)
    expect(next.ops).toEqual([PLACEHOLDER])
    expect(next.ops[0].digest).not.toBe(first.ops[0].digest)
    expect(next.rev).not.toBe(first.rev)
    expect(w.store.pending(id)).toEqual([expect.objectContaining({ ref: next.ops[0].ref, ops: [EMAIL_FIELD(SECOND)] })])
    // With nothing in the tray's private part and no git op, revise itself says there is nothing.
    await call(w.app, 'DELETE', '/api/changes')
    const empty = await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops: [] } })
    expect(empty.status).toBe(409) // no tray revises it: the proposal keeps its own part, so it is unchanged
    expect((await empty.json()).code).toBe('UNCHANGED')
  })

  it('a ledger already holding a legacy restricted op still takes a comment and an approval; a write adding one is refused (I2)', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' } }])
    const id = await propose(w)
    // The org restricts `role` by editing data/visibility.yaml in git: the open proposal's op now holds a restricted value.
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), `visibility:
  collections:
    members: { default: members, fields: { email: "hat:${OPS}", role: "hat:${OPS}" } }
`)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: role is restricted from now on"')
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'comment', text: 'Still wanted.' } }))
    await approve(w, id, await w.signIn(A2))
    expect(entryOf(w.repo, id).events.map((e: { kind: string }) => e.kind)).toEqual(['comment', 'approve'])
    // A new proposal holding such an op (written past the split, as a bug or a hand would) is refused, naming no value.
    const before = head(w.repo)
    const copy = { ...entryOf(w.repo, id), id: 'p-2026-10-29-009-abcd', branch: 'proposal/p-2026-10-29-009-abcd', events: [] }
    const err = await createEntry(w.repo, copy, { actor: 'steward-a', rule: 'people/approve' }, { now: () => T0, startBranch: 'main' }).catch(e => e)
    expect(err).toBeInstanceOf(Refusal)
    expect([err.status, err.body.code]).toEqual([500, 'RESTRICTED_IN_GIT'])
    expect(err.body.problems).toEqual([{ path: 'data/proposals.yaml', record: 'p-2026-10-29-009-abcd', field: 'role' }])
    expect(JSON.stringify(err.body)).not.toContain('Treasurer')
    expect(head(w.repo)).toBe(before)
  })

  it('a store that fails while Revise reads its levels is 503 PRIVATE_STORE, never a generic error (M6)', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: SENTINEL } }])
    const id = await propose(w)
    const fail = () => { throw new Error('database disk image is malformed') }
    w.store.fields = fail; w.store.record = fail; w.store.collections = fail
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} })
    const text = await res.text()
    expect([res.status, JSON.parse(text)]).toEqual([503, { error: STORE_FAILED, code: 'PRIVATE_STORE' }])
    expect(text).not.toContain('malformed')
    expect(existsSync(changeFile(w.repo))).toBe(false)
  })
})
