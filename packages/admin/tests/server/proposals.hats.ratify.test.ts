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
import { readLedger } from '../../server/proposals/ledger.ts'
import { ratify } from '../../server/proposals/ratify.ts'
import { checkProposals } from '../../lib/proposals.mjs'
import { observationsOf } from '../../lib/hat-readings.mjs'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'
import type { WearerRefusal } from '../../server/systems/reader.ts'

// DAO-OS L5 spec §7.4 (deciding with fresh readings; operator Q1/Q49: an approval counts at the decision only if the
// approver still wears the hat), §7.2 (`closed.checked`), §5.2 (a read that fails refuses the act), §7.3 ("wearer list
// partial", Review Focus 5). Fresh repositories under the temp directory (makeChangeRepo), a private store in a temp
// folder of its own, and a fake Hats reader whose answers each test sets: no network (S13).

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
// EIP-55 of …a1 … …a3, computed apart from lib/caip.mjs (keccak-256 of the lowercase hex, @noble/hashes).
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000A2`
const A3 = `${CELO}:0x00000000000000000000000000000000000000A3`
const T0 = new Date('2026-10-29T10:00:00.000Z')
const READ_AT = T0.toISOString()
const UNREADABLE = 'The Hats tree could not be read, so it is not known that you still wear council. Nothing was written.'

const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const APPROVE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: council, method: approve, count: 2 } }
  decisions: []
`
/** Records decided by the maintainer role (data/members.yaml), members by the council (a hat). */
const MIXED = `schema_version: "2.0"
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
/** steward-a commits here (admin-test@local); `wallets` gives a member id the wallet it lists. */
const MEMBERS = (wallets: Record<string, string> = {}) => `schema_version: "2.0"
members:
${['steward-a', 'steward-b', 'steward-c'].map(id => `  - id: "${id}"
    name: "${id}"
    kind: "person"${id === 'steward-a' || wallets[id] ? `
    handles:${id === 'steward-a' ? '\n      git: ["admin-test@local"]' : ''}${wallets[id] ? `\n      wallet: ["${wallets[id]}"]` : ''}` : ''}`).join('\n')}
  - id: "ana"
    name: "Ana Silva"
    kind: "person"
`
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

type WearerAnswer = (account: string) => WearerReading | WearerRefusal
type WearersAnswer = (hat: string) => WearersReading | WearerRefusal
const wearing = (worn: Record<string, string[]>, block = 100): WearerAnswer => account =>
  ({ ok: true, system: 'hats-main', chain: CELO, account, hats: worn[account] ?? [], block, readAt: READ_AT })
const listing = (list: string[], complete = true, block = 100): WearersAnswer => hat =>
  ({ ok: true, system: 'hats-main', hat, wearers: list, holders: list, complete, block, readAt: READ_AT })
const down = (who: string, then: WearerAnswer): WearerAnswer => account =>
  (account === who ? { ok: false, failed: true, error: 'the tree could not be read: rpc down' } : then(account))
const COUNCIL_WEARS = { [A1]: [COUNCIL], [A2]: [COUNCIL], [A3]: [COUNCIL] }

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function house(o: { governance?: string; members?: string } = {}) {
  const repo = makeChangeRepo(o.governance ?? APPROVE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), o.members ?? MEMBERS())
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  const dir = mkdtempSync(join(tmpdir(), 'hats-ratify-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const state: { wearer: WearerAnswer; wearers: WearersAnswer } = { wearer: wearing(COUNCIL_WEARS), wearers: listing([A1, A2, A3]) }
  const now = () => T0
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => state.wearer(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => state.wearers(hat)),
  }
  const membership = new Membership({ repo, reader, now })
  const app = createApp(repo, (a, ctx) => {
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now })
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

async function propose(app: Hono, cookie?: string, ops: unknown[] = [PROJECT]): Promise<string> {
  const staged = await call(app, 'POST', '/api/changes/ops', { body: { ops }, cookie })
  expect([staged.status, staged.status === 200 ? '' : await staged.text()]).toEqual([200, ''])
  const res = await call(app, 'POST', '/api/proposals', { body: { title: 'Move one project' }, cookie })
  expect([res.status, res.status === 201 ? '' : await res.text()]).toEqual([201, ''])
  return String((await res.json()).id)
}
async function approve(app: Hono, id: string, cookie?: string): Promise<void> {
  const res = await call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie })
  expect([res.status, res.status === 200 ? '' : await res.text()]).toEqual([200, ''])
}
const ratifyCall = (app: Hono, id: string, cookie?: string) => call(app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie })
/** The accounts the reader was asked for since `from` calls. */
const askedSince = (reader: { wearer: { mock: { calls: unknown[][] } } }, from: number) => reader.wearer.mock.calls.slice(from).map(c => c[1])

describe('a decision counts only the hats still worn when it is made (L5 spec §7.4, Q1)', () => {
  it('ratify reads every counted approver again and records closed.checked; a ratify by an address writes closed.as', async () => {
    const { app, repo, state, reader, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A2))
    await approve(app, id, await signIn(A3))
    const cookie = await signIn(A1)
    // The tree has moved on: readings are now at block 130.
    state.wearer = wearing(COUNCIL_WEARS, 130)
    state.wearers = listing([A1, A2, A3], true, 130)
    const from = reader.wearer.mock.calls.length
    const res = await ratifyCall(app, id, cookie)
    expect([res.status, res.status === 200 ? '' : await res.text()]).toEqual([200, ''])
    expect(askedSince(reader, from)).toEqual(expect.arrayContaining([A2, A3]))
    const entry = entryOf(repo)
    expect(entry.state).toBe('ratified')
    expect(entry.closed).toMatchObject({
      by: A1,
      as: { hat: COUNCIL, account: A1, block: 130, readAt: READ_AT, wearers: [A1, A2, A3], complete: true },
    })
    // One row per counted approver (the two events share a second, so their order is the evaluator's, not the test's).
    const checked = (entry.closed as { checked: unknown[] }).checked
    expect(checked).toHaveLength(2)
    expect(checked).toEqual(expect.arrayContaining([
      { account: A2, hat: COUNCIL, wears: true, block: 130, readAt: READ_AT },
      { account: A3, hat: COUNCIL, wears: true, block: 130, readAt: READ_AT },
    ]))
    // The rows are observations of the ledger (§7.3), and the closed ledger is valid.
    expect(observationsOf(entry).slice(-2)).toEqual(expect.arrayContaining([
      { hat: COUNCIL, account: A2, wears: true, block: 130, at: READ_AT },
      { hat: COUNCIL, account: A3, wears: true, block: 130, at: READ_AT },
    ]))
    expect(checkProposals(readLedger(repo).entries, { members: [{ id: 'steward-a', kind: 'person' }] })).toEqual([])
  })

  it('an approver who no longer wears Council is not counted, and ratify refuses in words, writing nothing', async () => {
    const { app, repo, state, signIn } = await house({ members: MEMBERS({ 'steward-c': A3 }) })
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A2))
    await approve(app, id, await signIn(A3)) // steward-c, by their wallet …A3
    expect(entryOf(repo).events.at(-1)).toMatchObject({ kind: 'approve', by: 'steward-c' })
    const cookie = await signIn(A1)
    // steward-c's council hat was taken off on chain.
    state.wearer = wearing({ ...COUNCIL_WEARS, [A3]: [OPS] }, 130)
    state.wearers = listing([A1, A2], true, 130)
    const before = head(repo)
    const res = await ratifyCall(app, id, cookie)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('NO_LONGER_WORN')
    expect(body.error).toBe('Not ratified: steward-c no longer wears Council; 1 of 2 approvals remain. Nothing was written.')
    expect(body.evaluation.parts[0].evaluation.tally.for).toEqual([A2])
    expect(head(repo)).toBe(before)
    expect(git(repo, 'status --porcelain')).toBe('')
    expect(entryOf(repo).state).toBe('open')
  })

  it('a CAIP-10 approver who no longer wears Council is named by the short address', async () => {
    const { app, repo, state, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A2))
    await approve(app, id, await signIn(A3))
    const cookie = await signIn(A1)
    state.wearer = wearing({ ...COUNCIL_WEARS, [A3]: [OPS] }, 130)
    state.wearers = listing([A1, A2], true, 130)
    const before = head(repo)
    const res = await ratifyCall(app, id, cookie)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Not ratified: 0x0000…00A3 no longer wears Council; 1 of 2 approvals remain. Nothing was written.')
    expect(head(repo)).toBe(before)
  })

  it('a read that fails refuses ratify with the §5.2 sentence and writes nothing', async () => {
    const { app, repo, state, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A2))
    await approve(app, id, await signIn(A3))
    const cookie = await signIn(A1)
    state.wearer = down(A3, wearing(COUNCIL_WEARS, 130))
    const before = head(repo)
    const branches = git(repo, 'branch --list')
    const res = await ratifyCall(app, id, cookie)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: UNREADABLE, code: 'HATS_UNREADABLE' })
    expect(head(repo)).toBe(before)
    expect(git(repo, 'branch --list')).toBe(branches)
    expect(git(repo, 'status --porcelain')).toBe('')
    expect(entryOf(repo).state).toBe('open')
  })

  it('a counted approver the readings do not cover (an act came in meanwhile) refuses the ratify', async () => {
    const { app, repo, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    await approve(app, id, await signIn(A2))
    await approve(app, id, await signIn(A3))
    const before = head(repo)
    const only = [{ account: A2, hat: COUNCIL, wears: true, block: 130, readAt: READ_AT }]
    const author = { id: A1, name: 'council · 0x0000…00A1', kind: 'person' as const, via: 'siwe' as const, account: A1, hats: [COUNCIL], reading: { block: 130, readAt: READ_AT } }
    await expect(ratify(repo, author, id, { now: () => T0, startBranch: 'main', checked: only }))
      .rejects.toMatchObject({
        status: 409,
        body: { code: 'NOT_CHECKED', error: 'Not ratified: whether 0x0000…00A3 still wears Council was not read again for this ratify (an act came in while the deciders were read). Try again. Nothing was written.' },
      })
    expect(head(repo)).toBe(before)
  })
})

describe('an approval admitted without a reading (R-L5-8.10) is settled by the ratify re-check', () => {
  /** steward-a (wallet …A3) approves while the tree cannot read …A3: the approval counts for the maintainer's rule, and
   *  in the lock never for the council's. Read from the ledger alone, the opened list (…A1, …A2, …A3) would count it. */
  async function admitted() {
    const h = await house({ governance: MIXED, members: MEMBERS({ 'steward-a': A3 }) })
    const id = await propose(h.app, await h.signIn(A1), [PROJECT, { op: 'update', record: 'members:steward-b', set: { name: 'Steward B.' } }])
    h.state.wearer = down(A3, wearing(COUNCIL_WEARS))
    await approve(h.app, id) // steward-a, at the machine
    expect('as' in entryOf(h.repo).events.at(-1)!).toBe(false)
    return { ...h, id, cookie: await h.signIn(A1) }
  }

  it('while …A3 still cannot be read, ratify refuses with §5.2 and does not count it on the recorded list', async () => {
    const { app, repo, id, cookie } = await admitted()
    const before = head(repo)
    const res = await ratifyCall(app, id, cookie)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: UNREADABLE, code: 'HATS_UNREADABLE' })
    expect(head(repo)).toBe(before)
  })

  it('read again and no longer wearing Council, it is not counted: "steward-a no longer wears Council; 0 of 1 approvals remain."', async () => {
    const { app, repo, state, id, cookie } = await admitted()
    state.wearer = wearing({ ...COUNCIL_WEARS, [A3]: [OPS] }, 130)
    state.wearers = listing([A1, A2], true, 130)
    const before = head(repo)
    const res = await ratifyCall(app, id, cookie)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Not ratified: steward-a no longer wears Council; 0 of 1 approvals remain. Nothing was written.')
    expect(head(repo)).toBe(before)
  })

  it('read again and still wearing Council, it counts at the decision (Q1), and the reading is recorded', async () => {
    const { app, repo, state, id, cookie } = await admitted()
    state.wearer = wearing(COUNCIL_WEARS, 130)
    const res = await ratifyCall(app, id, cookie)
    expect([res.status, res.status === 200 ? '' : await res.text()]).toEqual([200, ''])
    expect(entryOf(repo).closed).toMatchObject({ checked: [{ account: A3, hat: COUNCIL, wears: true, block: 130, readAt: READ_AT }] })
  })
})

describe('the view says "wearer list partial" when a standing list is incomplete (L5 spec §7.3, Review Focus 5)', () => {
  it('partial while the latest list read for the deciding hat is incomplete; not before, and not once a whole list is read', async () => {
    const { app, state, signIn } = await house()
    const id = await propose(app, await signIn(A1))
    const view = async () => (await call(app, 'GET', `/api/proposals/${id}`)).json()
    expect('partial' in (await view())).toBe(false)
    // …A2 approves on a list read whole only partly (a tree off Celo, Ethereum and Sepolia).
    state.wearer = wearing(COUNCIL_WEARS, 200)
    state.wearers = listing([A2], false, 200)
    await approve(app, id, await signIn(A2))
    const partial = await view()
    expect(partial.partial).toBe(true)
    expect((await (await call(app, 'GET', '/api/proposals')).json())[0].partial).toBe(true)
    // A later list read whole stands over it.
    state.wearer = wearing(COUNCIL_WEARS, 300)
    state.wearers = listing([A1, A2, A3], true, 300)
    await approve(app, id, await signIn(A3))
    expect('partial' in (await view())).toBe(false)
  })

  it('a proposal decided by a role written with members is never partial', async () => {
    const gov = APPROVE.replace('council: { hat', 'maintainer: { members: [steward-b] }\n    council: { hat').replace('decide: { by: council', 'decide: { by: maintainer').replace('count: 2', 'count: 1')
    const { app, state, signIn } = await house({ governance: gov })
    state.wearers = listing([A1], false)
    const id = await propose(app, await signIn(A1))
    expect('partial' in (await (await call(app, 'GET', `/api/proposals/${id}`)).json())).toBe(false)
  })

  it('names the rules whose deciding hat\'s list is partial, so a rule written with members is never said to be (Task 9 M3)', async () => {
    const { app, state, signIn } = await house({ governance: MIXED, members: MEMBERS() })
    state.wearers = listing([A1], false)
    const id = await propose(app, await signIn(A1), [PROJECT, { op: 'update', record: 'members:steward-b', set: { name: 'Steward B.' } }])
    const view = await (await call(app, 'GET', `/api/proposals/${id}`)).json()
    expect([view.partial, view.partialRules]).toEqual([true, ['people']])
  })
})
