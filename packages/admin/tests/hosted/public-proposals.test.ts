import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { mergeLedgers } from '../../lib/proposals.mjs'
import { listViews } from '../../server/proposals/view.ts'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { gateProposals, Levels, MEMBERS, PUBLIC, PUBLIC_NO_DIFF, PUBLIC_VIEWER, publicProjection } from '../../server/visibility/gate.ts'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

// L9 Task 12 (carry 11 of the L5 rulings log). 11a: the derived fields of the public proposal view (`evaluation`, `rules`,
// `can`, `cannot`, the tallies) were never audited; no `eip155:` account may appear in what the public is given, beyond an
// event's `by` (and `closed.by`, Ruling T13-1; and `author`, the opening act's `by`, Ruling T12-2), which the tallies only
// repeat. 11b: a proposal that ever touched a record that is not public stays members' — stricter by design, pinned here;
// the ops it was opened with are kept as its `touched`, since a revise event records only the new ones (Ruling T12-1). Two hosted houses on fresh repositories under the
// temp directory (makeChangeRepo), each with a private store in a temp folder of its own and a fake Hats reader (no
// network, S13): one decides records by approval, one by vote. Acts are made by CAIP-10 actors under the Council hat;
// the public is a hosted app with no session.

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
// EIP-55 of …a1 … …a3 (upper-case letters), as tests/server/proposals.hats.test.ts computed them apart from lib/caip.mjs.
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000A2`
const A3 = `${CELO}:0x00000000000000000000000000000000000000A3`
const T0 = new Date('2026-10-30T10:00:00.000Z')
const READ_AT = T0.toISOString()

const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const governance = (decide: string) => `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: council, ${decide} } }
  decisions: []
`
const APPROVE = governance('method: approve, count: 2')
const VOTE = governance('method: vote, window: P7D, quorum: 2, threshold: 0.5')
const MEMBERS_YAML = `schema_version: "2.0"
members:
  - { id: "steward-a", name: "steward-a", kind: "person", handles: { git: ["admin-test@local"] } }
  - { id: "steward-b", name: "steward-b", kind: "person" }
  - { id: "steward-c", name: "steward-c", kind: "person" }
`
/** Public projects, one per proposal, and one members' project (proj-mem) whose title is a sentinel. */
const PROJECTS_YAML = `schema_version: "2.0"
projects:
${['proj-001', 'proj-003', 'proj-004', 'proj-005', 'proj-006'].map(id => `  - { id: "${id}", title: "Project ${id}", status: "execute", type: "program", lead: "steward-a" }`).join('\n')}
  - { id: "proj-mem", title: "SENTINEL-members-project-1", status: "execute", type: "program", lead: "steward-a", visibility: "members" }
`
const VISIBILITY_YAML = `visibility:
  collections:
    projects: { default: public }
    proposals: { default: public }
`

/** A CAIP-10 account anywhere in a string, upper or lower case; a hat ref (64 hex digits) is not one. */
const ACCOUNT = /eip155:\d+:0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g
/** A bare address the fixture's accounts hold, in any case: an account written without its chain. */
const BARE = /0x0{38}a[1-4](?![0-9a-fA-F])/gi

type Json = unknown
/** Every account string found in `value`, with the path where it was found (`events[2].by`). */
function accountsIn(value: Json, path = ''): { path: string; account: string }[] {
  if (typeof value === 'string') {
    const found = [...value.matchAll(ACCOUNT)].map(m => m[0])
    const bare = [...value.replace(ACCOUNT, '').matchAll(BARE)].map(m => m[0])
    return [...found, ...bare].map(account => ({ path, account }))
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => accountsIn(v, `${path}[${i}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...accountsIn(k, `${path}{key}`),
      ...accountsIn(v, path === '' ? k : `${path}.${k}`),
    ])
  }
  return []
}

/** Where an account may stand in a public proposal: an event's `by`, the closing's `by` (Ruling T13-1), and the author,
 *  the opening act's `by`: the same exposure as an event's (Ruling T12-2, accepted, pinned below). Its hat reading
 *  (`opened_as`) is never given. */
const BY = /^(author|events\[\d+\]\.by|closed\.by)$/
/** A tally's list: it only repeats event `by`s (carry 11a; lib/evaluate.mjs). */
const TALLY = /^evaluation(\.parts\[\d+\]\.evaluation)?\.tally\.(for|against|abstain|objecting)\[\d+\]$/

const stores: PrivateStore[] = []
const cleanup: string[] = []

type House = Awaited<ReturnType<typeof house>>

async function house(decide: string) {
  const repo = makeChangeRepo(decide)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS_YAML)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS_YAML)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY_YAML)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, its members, public and members\' projects"')
  const dir = mkdtempSync(join(tmpdir(), 'public-proposals-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const state = { clock: T0 }
  const now = () => T0
  const worn: Record<string, string[]> = { [A1]: [COUNCIL], [A2]: [COUNCIL], [A3]: [COUNCIL] }
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string): Promise<WearerReading> =>
      ({ ok: true, system: 'hats-main', chain: CELO, account, hats: worn[account] ?? [], block: 100, readAt: READ_AT })),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string): Promise<WearersReading> =>
      ({ ok: true, system: 'hats-main', hat, wearers: [A1, A2, A3], holders: [A1, A2, A3], complete: true, block: 100, readAt: READ_AT })),
  }
  const membership = new Membership({ repo, reader, now })
  const mount = (a: Hono, ctx: { withLock: <T>(fn: () => Promise<T>) => Promise<T> }) =>
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => state.clock })
  // The acts: CAIP-10 sessions. The public: hosted, no session.
  const app = createApp(repo, mount, { request: withRequest({ repo, hosted: false, membership, store, now }) })
  const pub = createApp(repo, mount, { request: withRequest({ repo, hosted: true, membership: null }) })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    const { token } = await createSession(store, account, now)
    return `house_session=${token}`
  }
  return { repo, app, pub, state, signIn }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
async function ok(res: Response | Promise<Response>, status = 200): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await res
  const text = await r.text()
  expect([r.status, r.status === status ? '' : text]).toEqual([status, ''])
  return JSON.parse(text)
}
const event = (h: House, id: string, cookie: string, body: Record<string, unknown>) =>
  ok(call(h.app, 'POST', `/api/proposals/${id}/events`, { body, cookie }))

async function propose(h: House, cookie: string, ops: Record<string, unknown>[], title: string): Promise<string> {
  await ok(call(h.app, 'POST', '/api/changes/ops', { body: { ops }, cookie }))
  return String((await ok(call(h.app, 'POST', '/api/proposals', { body: { title }, cookie }), 201)).id)
}
const update = (id: string, set: Record<string, unknown>) => ({ op: 'update', record: `projects:${id}`, set })
const baseIn = (repo: string, id: string) =>
  baseOf(readRegistry(repo, 'projects').entries!.find(e => e.id === id)! as Record<string, unknown>)

let approving: House // records decided by approval
let voting: House // records decided by vote
const P: Record<'ratified' | 'revised' | 'expired' | 'touched' | 'voted', string> = { ratified: '', revised: '', expired: '', touched: '', voted: '' }

beforeAll(async () => {
  approving = await house(APPROVE)
  const [a1, a2, a3] = [await approving.signIn(A1), await approving.signIn(A2), await approving.signIn(A3)]
  // Approved by two, then ratified (below).
  P.ratified = await propose(approving, a1, [update('proj-001', { status: 'develop' })], 'Move project one')
  // Revised after an objection.
  P.revised = await propose(approving, a1, [update('proj-003', { status: 'develop' })], 'Move project three')
  await event(approving, P.revised, a2, { kind: 'approve' })
  await event(approving, P.revised, a3, { kind: 'object', text: 'Not this stage.' })
  await ok(call(approving.app, 'POST', `/api/proposals/${P.revised}/revise`, {
    cookie: a1, body: { ops: [{ ...update('proj-003', { status: 'idea' }), base: baseIn(approving.repo, 'proj-003') }] },
  }))
  await event(approving, P.revised, a2, { kind: 'comment', text: 'Better now.' })
  // 11b: opened on a public and a members' project, then revised to the public one alone.
  P.touched = await propose(approving, a1, [update('proj-005', { status: 'develop' }), update('proj-mem', { status: 'develop' })], 'Move two projects')
  await ok(call(approving.app, 'POST', `/api/proposals/${P.touched}/revise`, {
    cookie: a1, body: { ops: [{ ...update('proj-005', { status: 'idea' }), base: baseIn(approving.repo, 'proj-005') }] },
  }))
  P.expired = await propose(approving, a1, [update('proj-004', { status: 'develop' })], 'Move project four')
  await event(approving, P.expired, a2, { kind: 'approve' })
  // P.ratified: met by two approvals, ratified by a Council wearer.
  await event(approving, P.ratified, a2, { kind: 'approve' })
  await event(approving, P.ratified, a3, { kind: 'approve' })
  await ok(call(approving.app, 'POST', `/api/proposals/${P.ratified}/ratify`, { body: {}, cookie: a2 }))
  // Past the default expiry (30 days): closed `expired` by its author.
  approving.state.clock = new Date(T0.getTime() + 31 * 864e5)
  await ok(call(approving.app, 'POST', `/api/proposals/${P.expired}/close`, { body: { outcome: 'expired' }, cookie: a1 }))

  voting = await house(VOTE)
  const [v1, v2, v3] = [await voting.signIn(A1), await voting.signIn(A2), await voting.signIn(A3)]
  P.voted = await propose(voting, v1, [update('proj-006', { status: 'develop' })], 'Move project six')
  await event(voting, P.voted, v2, { kind: 'vote', vote: 'yes' })
  await event(voting, P.voted, v3, { kind: 'vote', vote: 'no' })
}, 120_000)

afterAll(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Each public answer of the proposal views, by where it comes from. */
async function publicAnswers(h: House): Promise<[string, Record<string, unknown>[]][]> {
  const listed = await ok(call(h.pub, 'GET', '/api/proposals')) as unknown as Record<string, unknown>[]
  const details: Record<string, unknown>[] = []
  for (const p of listed) details.push(await ok(call(h.pub, 'GET', `/api/proposals/${String(p.id)}`)))
  const projected = (await publicProjection(h.repo, { graph: async () => ({ nodes: [], edges: [] }), now: h.state.clock })).proposals
  const gated = gateProposals(PUBLIC_VIEWER, await listViews(h.repo, { unknown: '' }, h.state.clock), new Levels(h.repo))
  return [['GET /api/proposals', listed], ['GET /api/proposals/:id', details], ['publicProjection', projected], ['gateProposals', gated]] as [string, Record<string, unknown>[]][]
}

describe('the public proposal view names no account beyond event by (carry 11a)', () => {
  it('the fixture is what the audit needs: approved, objected to, revised, voted on, ratified and expired, by CAIP-10 actors under hats', () => {
    const entries = [...readLedger(approving.repo).entries, ...readLedger(voting.repo).entries]
    const kinds = new Set(entries.flatMap(e => e.events.map(ev => ev.kind)))
    for (const k of ['approve', 'object', 'revise', 'comment', 'vote', 'ratify', 'expire']) expect([k, kinds.has(k)]).toEqual([k, true])
    expect(entries.map(e => e.state).sort()).toEqual(['expired', 'open', 'open', 'open', 'ratified'])
    // Every act was by an account and recorded the hat reading it was judged on, so the gate has readings to drop.
    for (const e of entries) {
      expect(e.opened_as).toMatchObject({ hat: COUNCIL, account: e.author })
      for (const ev of e.events) expect([ev.kind, ev.by.startsWith(`${CELO}:0x`)]).toEqual([ev.kind, true])
    }
  })

  it('no eip155 account appears in a public proposal view outside event by (and closed.by, and the author by Ruling T12-2), which the tallies only repeat', async () => {
    let tallied = 0
    for (const h of [approving, voting]) {
      for (const [where, views] of await publicAnswers(h)) {
        expect([where, views.length > 0]).toEqual([where, true])
        for (const view of views) {
          const bys = new Set((view.events as { by: string }[]).map(e => e.by))
          for (const { path, account } of accountsIn(view)) {
            if (BY.test(path)) continue
            if (TALLY.test(path) && bys.has(account)) { tallied++; continue }
            expect.fail(`${where} ${String(view.id)}: ${path} holds the account ${account}`)
          }
          // The derived fields the audit names hold none at all.
          for (const field of ['rules', 'can', 'cannot', 'check', 'derived', 'stale', 'needsYou', 'branchState']) {
            expect([where, field, accountsIn(view[field])]).toEqual([where, field, []])
          }
          // No hat reading is given to the public (rule 9): it ties an account to a hat and lists wearers.
          expect(JSON.stringify(view)).not.toMatch(/"(opened_as|as|checked|wearers|holders)":/)
        }
      }
    }
    expect(tallied).toBeGreaterThan(0) // the tallies were walked, and they did name accounts: all event `by`s
  })

  it('the public is given the author\'s account, as an event\'s `by` (Ruling T12-2: accepted, deliberate), never its reading', async () => {
    const [, listed] = (await publicAnswers(approving))[0]!
    const ratified = listed.find(v => v.id === P.ratified)!
    expect(ratified.author).toBe(A1)
    // A1 opened it and did nothing else: the author is the one place the public reads A1 in it.
    expect((ratified.events as { by: string }[]).map(e => e.by)).not.toContain(A1)
    expect(ratified).not.toHaveProperty('opened_as')
  })
})

describe('a proposal that ever touched a non-public record stays members\' (carry 11b, stricter by design)', () => {
  it('is absent for the public, also after a revision removed that op', async () => {
    const entry = readLedger(approving.repo).entries.find(e => e.id === P.touched)!
    expect(entry.ops.map(op => op.record)).toEqual(['projects:proj-005']) // the revision removed the members' op
    expect(entry.events.flatMap(e => (e.ops ?? []) as { record: string }[]).map(op => op.record)).toEqual(['projects:proj-005'])
    expect(entry.touched).toBe('members') // what it was opened on is kept, and the revision did not lower it
    for (const [where, views] of await publicAnswers(approving)) {
      expect([where, views.map(v => v.id)]).toEqual([where, [P.ratified, P.revised, P.expired]])
    }
    const one = await call(approving.pub, 'GET', `/api/proposals/${P.touched}`)
    expect([one.status, await one.json()]).toEqual([404, { error: `The ledger has no proposal ${P.touched}.` }])
    // The ledger read as a registry hides it too (the same `Levels.proposal`).
    const registry = await ok(call(approving.pub, 'GET', '/api/registries/proposals'))
    expect((registry.entries as { id: string }[]).map(e => e.id)).toEqual([P.ratified, P.revised, P.expired])
    // A member still reads it.
    const member = await ok(call(approving.app, 'GET', '/api/proposals', { cookie: await approving.signIn(A2) })) as unknown as Record<string, unknown>[]
    expect(member.find(v => v.id === P.touched)).toMatchObject({ visibility: 'members' })
  })

  it('touched is written when a proposal opens, and a revision on public records keeps it public', () => {
    const touched = Object.fromEntries(readLedger(approving.repo).entries.map(e => [e.id, e.touched]))
    expect(touched).toEqual({ [P.ratified]: 'public', [P.revised]: 'public', [P.touched]: 'members', [P.expired]: 'public' })
    expect(readLedger(voting.repo).entries.map(e => e.touched)).toEqual(['public'])
  })

  it('an entry written before touched existed: unrevised, judged on its ops; revised, members\' (its opening is unknown)', () => {
    const levels = new Levels(approving.repo)
    const entry = readLedger(approving.repo).entries.find(e => e.id === P.revised)! as Record<string, unknown>
    const { touched: _t, ...legacy } = entry
    expect(levels.proposal(entry)).toEqual(PUBLIC)
    expect(levels.proposal(legacy)).toEqual(MEMBERS)
    const unrevised = readLedger(approving.repo).entries.find(e => e.id === P.ratified)! as Record<string, unknown>
    const { touched: _u, ...older } = unrevised
    expect(levels.proposal(older)).toEqual(PUBLIC)
    expect(levels.proposal({ ...unrevised, touched: 'members' })).toEqual(MEMBERS)
  })

  it('a sync keeps the stricter touched: a revision on one side that touched a members\' record is never lowered by the other', () => {
    const base = { id: 'p-2026-10-30-009', title: 'x', touched: 'public', events: [] }
    const ours = { ...base, touched: 'members' }
    const theirs = { ...base, touched: 'public', title: 'y' }
    for (const [a, b] of [[ours, theirs], [theirs, ours]]) {
      const merged = mergeLedgers([base], [a], [b])
      expect(merged).toMatchObject({ ok: true, entries: [{ touched: 'members' }] })
    }
    // Both sides raised it from a ledger written before touched: no refusal, the stricter stands.
    const legacy = { id: 'p-2026-10-30-009', title: 'x', events: [] }
    expect(mergeLedgers([legacy], [{ ...legacy, touched: 'public' }], [{ ...legacy, touched: 'members' }])).toMatchObject({ ok: true, entries: [{ touched: 'members' }] })
  })
})

describe('a replay\'s choice raises touched as a revision does (Task 12 fix round 1)', () => {
  // Opened public on two public projects; one is then narrowed to members on the trunk, its field changed there too; the
  // author's Take theirs drops that op. What the proposal touched stays: it must not read public again. A fresh repository
  // under the temp directory (makeChangeRepo); git's identity (steward-a) acts locally; the public is hosted, no session.
  const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
  it('Take theirs dropping the op on a record narrowed since leaves the proposal members\'', async () => {
    const repo = makeChangeRepo(GOV)
    cleanup.push(repo)
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS_YAML)
    writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY_YAML)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: public projects"')
    const NOW = new Date('2026-10-30T12:00:00Z')
    const mount = (a: Hono, ctx: { withLock: <T>(fn: () => Promise<T>) => Promise<T> }) =>
      mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => NOW })
    const local = createApp(repo, mount)
    const pub = createApp(repo, mount, { request: withRequest({ repo, hosted: true, membership: null }) })
    await ok(call(local, 'POST', '/api/changes/ops', { body: { ops: [update('proj-001', { status: 'develop' }), update('proj-003', { status: 'develop' })] } }))
    const id = String((await ok(call(local, 'POST', '/api/proposals', { body: { title: 'Move two projects' } }), 201)).id)
    expect(readLedger(repo).entries[0]!.touched).toBe('public')
    expect((await ok(call(pub, 'GET', '/api/proposals')) as unknown as { id: string }[]).map(v => v.id)).toEqual([id])

    // The trunk narrows proj-001 to members and changes the field the proposal sets: its op is stale.
    const narrowed = PROJECTS_YAML.replace('{ id: "proj-001", title: "Project proj-001", status: "execute",', '{ id: "proj-001", title: "Project proj-001", status: "idea", visibility: "members",')
    expect(narrowed).not.toBe(PROJECTS_YAML)
    writeFileSync(join(repo, 'data', 'projects.yaml'), narrowed)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: proj-001 narrowed to members, its status changed"')
    expect((await ok(call(pub, 'GET', '/api/proposals')) as unknown as unknown[])).toEqual([]) // its op touches a members' record now

    await ok(call(local, 'POST', `/api/proposals/${id}/replay`, { body: { choose: 'theirs' } }))
    const entry = readLedger(repo).entries[0]!
    expect(entry.ops.map(op => op.record)).toEqual(['projects:proj-003']) // Take theirs dropped the narrowed record's op
    expect(entry.events.at(-1)).toMatchObject({ kind: 'revise' })
    expect(entry.touched).toBe('members')
    expect((await ok(call(pub, 'GET', '/api/proposals')) as unknown as unknown[])).toEqual([])
    expect((await call(pub, 'GET', `/api/proposals/${id}`)).status).toBe(404)
  })
})

describe('the public detail answer has no diff', () => {
  it('diff is null with PUBLIC_NO_DIFF in its place, and nothing is built for the visit; a member gets the diff', async () => {
    const refs = git(approving.repo, 'for-each-ref')
    for (const id of [P.ratified, P.revised, P.expired]) {
      const res = await call(approving.pub, 'GET', `/api/proposals/${id}`)
      const text = await res.text()
      expect([id, res.status]).toEqual([id, 200])
      expect(JSON.parse(text)).toMatchObject({ id, diff: null, note: PUBLIC_NO_DIFF, visibility: 'public' })
      expect(text).not.toMatch(/diff --git|@@ /)
    }
    expect(git(approving.repo, 'for-each-ref')).toBe(refs)
    const member = await ok(call(approving.app, 'GET', `/api/proposals/${P.revised}`, { cookie: await approving.signIn(A2) }))
    expect(member.diff).toContain('diff --git')
  })
})
