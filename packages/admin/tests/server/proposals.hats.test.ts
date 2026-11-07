import { describe, it, expect, afterEach, vi } from 'vitest'
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
import { bookFor, readLedger } from '../../server/proposals/ledger.ts'
import { machineContext } from '../../server/proposals/events.ts'
import { withWallet } from '../../server/actor.ts'
import { checkProposals } from '../../lib/proposals.mjs'
import { observationsOf } from '../../lib/hat-readings.mjs'
import { parseTrailers } from '../../lib/trailers.mjs'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'
import type { WearerRefusal } from '../../server/systems/reader.ts'

// DAO-OS L5 spec §7.2 (what an act records), §7.3 (the book from what was recorded), §6.4 (Org-Hat), against fresh
// repositories under the temp directory (makeChangeRepo), a private store in a temp folder of its own and a fake Hats
// reader whose answers the test sets (no network, S13). Sessions are made with createSession, as a sign-in that passed
// makes them (Task 6 tests the sign-in itself).

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
// EIP-55 of …a1 … …a4, computed apart from lib/caip.mjs (keccak-256 of the lowercase hex, @noble/hashes): …a4 stays lower case.
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000A2`
const A3 = `${CELO}:0x00000000000000000000000000000000000000A3`
const A4 = `${CELO}:0x00000000000000000000000000000000000000a4`
const T0 = new Date('2026-10-29T10:00:00.000Z')
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
const DIRECT = governance('method: direct')
/** steward-a commits here (admin-test@local); `wallet` lists their address on the tree's chain, when given. ana is the
 *  fixture project's contributor. */
const MEMBERS = (wallet = '') => `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    kind: "person"
    handles:
      git: ["admin-test@local"]${wallet ? `\n      wallet: ["${wallet}"]` : ''}
  - id: "steward-b"
    name: "Steward B"
    kind: "person"
  - id: "ana"
    name: "Ana Silva"
    kind: "person"
`
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

type WearerAnswer = (account: string) => WearerReading | WearerRefusal
type WearersAnswer = (hat: string) => WearersReading | WearerRefusal
/** Each account wears the hats `worn` gives it, read at `block`. */
const wearing = (worn: Record<string, string[]>, block = 100): WearerAnswer => account =>
  ({ ok: true, system: 'hats-main', chain: CELO, account, hats: worn[account] ?? [], block, readAt: READ_AT })
/** Every hat's wearers are `list`, read at `block`; `complete` says whether the tree listed them whole. */
const listing = (list: string[], complete = true, block = 100): WearersAnswer => hat =>
  ({ ok: true, system: 'hats-main', hat, wearers: list, holders: list, complete, block, readAt: READ_AT })
const COUNCIL_WEARS = { [A1]: [COUNCIL], [A2]: [COUNCIL], [A3]: [COUNCIL], [A4]: [OPS] }

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A repository with the tree, the governance and the members committed; its own store; the app with the request
 *  middleware and the proposal routes. `state` holds the reader's answers, which a test changes between acts. */
async function house(o: { governance?: string; members?: string } = {}) {
  const repo = makeChangeRepo(o.governance ?? APPROVE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), o.members ?? MEMBERS())
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  const dir = mkdtempSync(join(tmpdir(), 'hats-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  // `clock` is the proposals' clock (an expiry needs time to run out); sessions and readings keep T0.
  const state: { wearer: WearerAnswer; wearers: WearersAnswer; clock: Date } = { wearer: wearing(COUNCIL_WEARS), wearers: listing([A1, A2, A3]), clock: T0 }
  const now = () => T0
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => state.wearer(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => state.wearers(hat)),
  }
  const membership = new Membership({ repo, reader, now })
  const app = createApp(repo, (a, ctx) => {
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => state.clock })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }) })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    const { token } = await createSession(store, account, now)
    return `house_session=${token}`
  }
  return { app, repo, state, reader, signIn }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const entryOf = (repo: string) => readLedger(repo).entries[0]!

/** `cookie`'s actor stages one change and proposes it; answers the proposal's id. */
async function propose(app: Hono, cookie?: string, ops: unknown[] = [PROJECT]): Promise<string> {
  const staged = await call(app, 'POST', '/api/changes/ops', { body: { ops }, cookie })
  expect([staged.status, staged.status === 200 ? '' : await staged.text()]).toEqual([200, ''])
  const res = await call(app, 'POST', '/api/proposals', { body: { title: 'Move one project' }, cookie })
  expect([res.status, res.status === 201 ? '' : await res.text()]).toEqual([201, ''])
  return String((await res.json()).id)
}
const approve = (app: Hono, id: string, cookie?: string) => call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie })

describe('every act under a hat records the reading it was judged on (L5 spec §7.2)', () => {
  it('a Council wearer with no member record proposes; the entry carries opened_as', async () => {
    const { app, repo, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    const entry = entryOf(repo)
    expect(entry.author).toBe(A1)
    expect(entry.opened_as).toEqual({ hat: COUNCIL, account: A1, block: 100, readAt: READ_AT, wearers: [A1, A2, A3], complete: true })
    // written beside `opened`, in the order the schema lists the fields
    const keys = Object.keys(entry)
    expect(keys.indexOf('opened_as')).toBe(keys.indexOf('opened') + 1)
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toMatchObject({ actor: A1, proposal: id })
  })

  it('two others approve as CAIP-10 ids; each event carries as with hat, account, block, readAt, wearers and complete', async () => {
    const { app, repo, state, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    expect((await approve(app, id, await signIn(A2))).status).toBe(200)
    state.wearer = wearing(COUNCIL_WEARS, 120)
    state.wearers = listing([A1, A2, A3], true, 120)
    const res = await approve(app, id, await signIn(A3))
    expect(res.status).toBe(200)
    const [first, second] = entryOf(repo).events
    expect(first).toMatchObject({ kind: 'approve', by: A2 })
    expect(first!.as).toEqual({ hat: COUNCIL, account: A2, block: 100, readAt: READ_AT, wearers: [A1, A2, A3], complete: true })
    expect(second).toMatchObject({ kind: 'approve', by: A3 })
    expect(second!.as).toEqual({ hat: COUNCIL, account: A3, block: 120, readAt: READ_AT, wearers: [A1, A2, A3], complete: true })
    expect((await res.json()).evaluation.state).toBe('met')
  })

  it('the proposal is met by the book built from its own observations, with no network', async () => {
    const { app, repo, state, reader, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A2))
    await approve(app, id, await signIn(A3))
    // From here the tree cannot be asked: any read throws.
    const calls = reader.wearer.mock.calls.length + reader.wearers.mock.calls.length
    state.wearer = () => { throw new Error('the network was asked') }
    state.wearers = () => { throw new Error('the network was asked') }
    const book = bookFor(repo, entryOf(repo))
    expect(book.roles.get('council')!.members).toEqual([A1, A2, A3])
    // The page, as the git actor (steward-a, no wallet): judged by what the ledger recorded.
    const view = await (await call(app, 'GET', `/api/proposals/${id}`)).json()
    expect(view.evaluation.state).toBe('met')
    expect(reader.wearer.mock.calls.length + reader.wearers.mock.calls.length).toBe(calls)
  })

  it('an address that wears no Council hat cannot approve; nothing is written', async () => {
    const { app, repo, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    const before = head(repo)
    const res = await approve(app, id, await signIn(A4))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(`"${A4}" does not hold the council role, which decides this proposal.`)
    expect(head(repo)).toBe(before)
  })

  it('an incomplete list adds no "wears: false" (Review Focus 5): an approver missing from it still counts', async () => {
    const { app, repo, state, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A3))
    // A later reading whose list is partial (a tree off Celo, Ethereum and Sepolia): A3 is not in it.
    state.wearer = wearing(COUNCIL_WEARS, 200)
    state.wearers = listing([A2], false, 200)
    const res = await approve(app, id, await signIn(A2))
    expect(res.status).toBe(200)
    const entry = entryOf(repo)
    expect(entry.events.at(-1)!.as).toMatchObject({ account: A2, block: 200, wearers: [A2], complete: false })
    const observed = observationsOf(entry)
    expect(observed.filter(o => !o.wears)).toEqual([])
    expect(bookFor(repo, entry).roles.get('council')!.members).toEqual([A1, A2, A3])
    expect((await res.json()).evaluation.state).toBe('met')
    // The same list read whole would say A3 no longer wears the hat (§7.3): the difference is `complete`.
    const whole = { ...entry, events: entry.events.map((e, i) => (i === entry.events.length - 1 ? { ...e, as: { ...e.as as object, complete: true } } : e)) }
    expect(observationsOf(whole).filter(o => !o.wears).map(o => o.account)).toEqual(expect.arrayContaining([A1, A3]))
  })

  it('a git actor\'s events carry no as (0.6 ledgers unchanged)', async () => {
    const { app, repo, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    const res = await call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'comment', text: 'Read, and fine.' } })
    expect(res.status).toBe(200)
    const event = entryOf(repo).events.at(-1)!
    expect(event).toMatchObject({ kind: 'comment', by: 'steward-a' })
    expect('as' in event).toBe(false)
  })

  it('a member acting under a role sourced from a hat records as, read for their wallet; a wallet that cannot be read refuses the act before anything is written', async () => {
    const { app, repo, state, signIn } = await house({ members: MEMBERS(A3) })
    const id = await propose(app, await signIn(A1))
    state.wearer = account => (account === A3 ? { ok: false, failed: true, error: 'the tree could not be read: rpc down' } : wearing(COUNCIL_WEARS)(account))
    const before = head(repo)
    const refused = await approve(app, id) // steward-a, at the machine, whose wallet is …A3
    expect(refused.status).toBe(502)
    expect(await refused.json()).toEqual({
      error: 'The Hats tree could not be read, so it is not known that you still wear council. Nothing was written.', code: 'HATS_UNREADABLE',
    })
    expect(head(repo)).toBe(before)
    state.wearer = wearing(COUNCIL_WEARS)
    expect((await approve(app, id)).status).toBe(200)
    expect(entryOf(repo).events.at(-1)).toMatchObject({ kind: 'approve', by: 'steward-a', as: { hat: COUNCIL, account: A3, block: 100 } })
  })

  it('a wallet that cannot be read does not take away what data/members.yaml allows: a comment, and an approval under a role written with members (R-L5-8.8)', async () => {
    // Two rules: records decided by the maintainer role (members), members decided by the council (a hat).
    const mixed = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    maintainer: { members: [steward-a] }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: maintainer, method: approve, count: 1 } }
    - { id: people, applies_to: [members], propose: council, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
    const { app, repo, state, signIn } = await house({ governance: mixed, members: MEMBERS(A3) })
    const id = await propose(app, await signIn(A1), [PROJECT, { op: 'update', record: 'members:steward-b', set: { name: 'Steward B.' } }])
    state.wearer = account => (account === A3 ? { ok: false, failed: true, error: 'the tree could not be read: rpc down' } : wearing(COUNCIL_WEARS)(account))
    const comment = await call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'comment', text: 'Read while the tree is down.' } })
    expect(comment.status).toBe(200)
    const approval = await approve(app, id) // steward-a, maintainer by data/members.yaml
    expect(approval.status).toBe(200)
    const [said, approved] = entryOf(repo).events
    expect(said).toMatchObject({ kind: 'comment', by: 'steward-a' })
    expect(approved).toMatchObject({ kind: 'approve', by: 'steward-a' })
    expect('as' in said! || 'as' in approved!).toBe(false)
    // Judged as the act was (no reading): the approval counts for the maintainer's rule, never for the council's on what
    // the proposal saw of …A3 when it was opened (R-L5-8.10).
    const unread = withWallet({ id: 'steward-a', name: 'Steward A', kind: 'person' }, { account: A3, read: null })
    const judged = machineContext(repo, unread, entryOf(repo), T0)
    expect(judged.context.book.roles.get('council')!.members).not.toContain('steward-a')
    expect(judged.evaluation.parts.map(p => [p.rule.id, p.evaluation.state])).toEqual([['records', 'met'], ['people', 'pending']])
    // Read from the ledger alone, the opened list would have counted it: the exclusion is what keeps it out.
    const recorded = machineContext(repo, { id: 'steward-a', name: 'Steward A', kind: 'person' }, entryOf(repo), T0)
    expect(recorded.context.book.roles.get('council')!.members).toContain('steward-a')
  })

  it('a hat taken off on chain stops the act, though the proposal listed the actor earlier (Review Focus 2)', async () => {
    const { app, repo, state, signIn } = await house({ members: MEMBERS(A2) })
    const id = await propose(app, await signIn(A1)) // the opened list says …A1, …A2 and …A3 wear the council hat
    // Now …A2 (steward-a's wallet) and …A3 wear only Ops: the council hat was taken off.
    state.wearer = wearing({ ...COUNCIL_WEARS, [A2]: [OPS], [A3]: [OPS] }, 120)
    const before = head(repo)
    const byAddress = await approve(app, id, await signIn(A3))
    expect(byAddress.status).toBe(409)
    expect((await byAddress.json()).error).toBe(`"${A3}" does not hold the council role, which decides this proposal.`)
    const byMember = await approve(app, id) // steward-a, at the machine, by their wallet …A2
    expect(byMember.status).toBe(409)
    expect((await byMember.json()).error).toBe('"steward-a" does not hold the council role, which decides this proposal.')
    expect(head(repo)).toBe(before)
  })

  it('a closing by an address carries closed.as: a withdraw, and an expiry', async () => {
    const { app, repo, state, signIn } = await house()
    const cookie = await signIn(A1)
    const first = await propose(app, cookie)
    const withdrawn = await call(app, 'POST', `/api/proposals/${first}/events`, { body: { kind: 'withdraw' }, cookie })
    expect(withdrawn.status).toBe(200)
    const closed = readLedger(repo).entries.find(e => e.id === first)!
    expect(closed.state).toBe('withdrawn')
    expect(closed.closed).toMatchObject({ by: A1, as: { hat: COUNCIL, account: A1, block: 100, readAt: READ_AT, wearers: [A1, A2, A3], complete: true } })
    expect(closed.events.at(-1)).toMatchObject({ kind: 'withdraw', by: A1 })
    expect('as' in closed.events.at(-1)!).toBe(false) // the closing's reading is on closed.as

    const second = await propose(app, cookie)
    state.clock = new Date(T0.getTime() + 31 * 864e5) // past the default expiry, 30 days
    const expired = await call(app, 'POST', `/api/proposals/${second}/close`, { body: { outcome: 'expired' }, cookie })
    expect([expired.status, expired.status === 200 ? '' : await expired.text()]).toEqual([200, ''])
    const out = readLedger(repo).entries.find(e => e.id === second)!
    expect(out.state).toBe('expired')
    expect(out.closed).toMatchObject({ by: A1, as: { hat: COUNCIL, account: A1, block: 100 } })
    expect(checkProposals(readLedger(repo).entries, { members: [{ id: 'steward-a', kind: 'person' }] })).toEqual([])
  })

  it('a direct apply under a role sourced from a hat carries Org-Hat: <hat ref> @<block>', async () => {
    const { app, repo, signIn } = await house({ governance: DIRECT })
    const cookie = await signIn(A1)
    expect((await call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] }, cookie })).status).toBe(200)
    const res = await call(app, 'POST', '/api/changes/apply', { cookie })
    expect(res.status).toBe(200)
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({
      actor: A1, change: expect.stringMatching(/^chg_/), rule: 'records/direct', hat: `${COUNCIL} @100`,
    })
  })
})

describe('Org-Hat names every hat the apply was let in by: the proposing role\'s and the deciding role\'s (Task 10 M1)', () => {
  it('a member who proposes under a hat and decides by data/members.yaml carries the proposing hat', async () => {
    const gov = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    maintainer: { members: [steward-a] }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: maintainer, method: direct } }
  decisions: []
`
    const { app, repo } = await house({ governance: gov, members: MEMBERS(A3) }) // steward-a, at the machine, wears council by …A3
    expect((await call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] } })).status).toBe(200)
    expect((await call(app, 'POST', '/api/changes/apply')).status).toBe(200)
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({
      actor: 'steward-a', change: expect.stringMatching(/^chg_/), rule: 'records/direct', hat: `${COUNCIL} @100`,
    })
  })
})

describe('checkProposals: an event by an address carries its reading', () => {
  const MEMBER_LIST = [{ id: 'steward-a', kind: 'person' }]
  const AS = { hat: COUNCIL, account: A2, block: 100, readAt: READ_AT, wearers: [A2], complete: true }
  const entry = (event: Record<string, unknown>) => ({
    id: 'p-2026-10-29-001', title: 'Move one project', author: 'steward-a', classes: ['records'],
    rules: [{ id: 'records', applies_to: ['records'], propose: 'council', decide: { by: 'council', method: 'approve', count: 2 } }],
    state: 'open', opened: READ_AT, rev: 'abc', ops: [PROJECT], events: [{ id: 'e-1', at: READ_AT, kind: 'approve', rev: 'abc', ...event }],
  })

  it('accepts a CAIP-10 `by` with `as`, and refuses one without', () => {
    expect(checkProposals([entry({ by: A2, as: AS })], { members: MEMBER_LIST })).toEqual([])
    expect(checkProposals([entry({ by: A2 })], { members: MEMBER_LIST }).map(p => p.message))
      .toEqual(['event e-1: an event by an address carries the hat it was read wearing (`as`)'])
  })

  it('a closing event by an address is answered by closed.as only when that closing is its own', () => {
    const closing = (by: string) => ({
      ...entry({ by: A1, as: { ...AS, account: A1 } }), state: 'withdrawn',
      closed: { at: READ_AT, by, decision: null, as: { ...AS, account: by } },
      events: [{ id: 'e-2', at: READ_AT, kind: 'withdraw', by: A2 }],
    })
    expect(checkProposals([closing(A2)], { members: MEMBER_LIST })).toEqual([])
    expect(checkProposals([closing(A3)], { members: MEMBER_LIST }).map(p => p.message))
      .toEqual(['event e-2: an event by an address carries the hat it was read wearing (`as`)'])
  })
})
