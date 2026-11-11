import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { createEntry, readLedger } from '../../server/proposals/ledger.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { safe } from '../../server/systems/safe.ts'
import { hatsTree } from '../../server/systems/hats.ts'
import type { FetchLike } from '../../server/systems/driver.ts'
import { revOf } from '../../lib/proposals.mjs'
import { topHatId, childHatId, hatRef, VIEW_HAT_TYPES } from '../../lib/hats.mjs'
import { encodeArgs, encodeCall, selector } from '../../lib/abi.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import { NOT_SEEN, dataHash, safeTxHash } from '../../lib/safe-tx.mjs'
import { encodeMultiSend } from '../../lib/multisend.mjs'
import { multiSendCallOnlyOn } from '../../lib/deployments.mjs'
import { keepWatch } from '../../server/proposals/watches.ts'

// POST /api/proposals/:id/prepare is conditioned (DAO-OS L7-D16): only an open proposal is prepared, and only an action
// on a system one of its rules waits on, directly or through the `via` Safe. Every test builds a fresh repository
// (makeChangeRepo) with placeholder members, a placeholder Safe 0x…5afe and the placeholder Hats tree 0x00000021 on Celo;
// the reader gets one fake fetch of recorded answers, so nothing touches the network.

const CELO = 'eip155:42220'
const HATS = '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137'
const SAFE = checksumAddress('0x0000000000000000000000000000000000005afe')
const ZERO = '0x0000000000000000000000000000000000000000'
const A = (n: number) => checksumAddress(`0x${'0'.repeat(38)}a${n}`)
const TOP = topHatId('0x00000021'), COUNCIL = childHatId(TOP, 1), CHILD = childHatId(COUNCIL, 1)
const SAFE_INFO = { address: SAFE, nonce: '4', threshold: 2, owners: [A(1), A(2), A(3)], masterCopy: `0x${'0'.repeat(38)}a0`, modules: [],
  fallbackHandler: `0x${'0'.repeat(38)}f0`, guard: ZERO, version: '1.4.1+L2' }

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: treasury-safe, kind: safe, name: Council Safe, chain: "${CELO}", address: "${SAFE}", driver: safe }
  - { id: council-tree, kind: hats-tree, name: Roles, chain: "${CELO}", address: "0x00000021", driver: hats-tree }
  - { id: dao-votes, kind: snapshot-space, name: Votes, url: "https://snapshot.box/#/s:test-dao.eth", driver: snapshot-space }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    member: { all: true }
  rules:
    - { id: council, applies_to: [governance], propose: member, decide: { by: system, system: treasury-safe } }
    - { id: roles, applies_to: [governance], propose: member, decide: { by: system, system: council-tree } }
    - { id: votes, applies_to: [records], propose: member, decide: { by: system, system: dao-votes, passes: { choice: "For" } } }
  decisions: []
`
const rule = (id: string, cls: string, system: string, extra: Record<string, unknown> = {}) =>
  ({ id, applies_to: [cls], propose: 'member', decide: { by: 'system', method: 'system', system, ...extra } })
const COUNCIL_RULE = rule('council', 'governance', 'treasury-safe')
const ROLES_RULE = rule('roles', 'governance', 'council-tree')
const VOTES_RULE = rule('votes', 'records', 'dao-votes', { passes: { choice: 'For' } })
const NOW = new Date('2026-10-30T12:00:00Z')
const P1 = 'p-2026-10-30-001', P2 = 'p-2026-10-30-002', P3 = 'p-2026-10-30-003', P4 = 'p-2026-10-30-004', P5 = 'p-2026-10-30-005'

let repo: string
let app: Hono
let clock: Date
let seen: string[]
/** The council hat's lastHatId as the recorded tree answers it: 0, until a test makes another hat under it. */
let lastHat: number
/** The predicted child hat as the recorded tree answers it: not created (null), until a test makes one (M-2). */
let child: { details: string; worn: boolean } | null
/** The Safe Transaction Service's recorded answers, by URL (L7 gap B2): a transaction it has seen. */
let txs: Record<string, unknown>

const word = (data: string, i: number) => data.slice(10 + 64 * i, 74 + 64 * i)
const yes = (b: boolean) => '0x' + (b ? '1' : '0').padStart(64, '0')
function hatsAnswer(data: string): string | null {
  const sel = data.slice(0, 10)
  const id = (i: number) => '0x' + word(data, i), addr = (i: number) => '0x' + word(data, i).slice(24)
  if (sel === selector('viewHat(uint256)')) {
    return id(0) === COUNCIL
      ? encodeArgs(VIEW_HAT_TYPES, ['Council', 1, 1, `0x${'0'.repeat(38)}70`, `0x${'0'.repeat(38)}71`, '', lastHat, true, true])
      : id(0) === CHILD && child
        ? encodeArgs(VIEW_HAT_TYPES, [child.details, 2, child.worn ? 2 : 0, `0x${'0'.repeat(38)}a7`, `0x${'0'.repeat(38)}a8`, '', 0, true, true])
        : encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, ZERO, ZERO, '', 0, false, false])
  }
  if (sel === selector('isWearerOfHat(address,uint256)')) return yes(id(1) === CHILD && child !== null && child.worn)
  if (sel === selector('isEligible(address,uint256)')) return yes(true)
  if (sel === selector('isAdminOfHat(address,uint256)')) return yes(addr(0) === SAFE.toLowerCase() && id(1) === CHILD)
  return null
}
const fetch: FetchLike = async (url, init) => {
  seen.push(url)
  if (init.method === 'GET') {
    if (Object.hasOwn(txs, url)) return { ok: true, status: 200, json: async () => txs[url] }
    return url === `https://api.safe.global/tx-service/celo/api/v1/safes/${SAFE}/`
      ? { ok: true, status: 200, json: async () => SAFE_INFO } : { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) }
  }
  const body = JSON.parse(init.body!) as { id: number; method: string; params: [{ to: string; data: string }] }[]
  const replies = body.map(r => {
    if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
    const hit = r.params[0].to.toLowerCase() === HATS.toLowerCase() ? hatsAnswer(r.params[0].data) : null
    return hit === null ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: hit }
  })
  return { ok: true, status: 200, json: async () => replies }
}

async function open(id: string, rules: ReturnType<typeof rule>[], closed: { state: string } | null = null) {
  const at = clock.toISOString().replace('.000Z', 'Z')
  await createEntry(repo, {
    id, title: 'Add a role', author: 'steward-a', classes: rules.map(r => r.applies_to[0]), rules, state: closed?.state ?? 'open',
    opened: at, rev: revOf([]), base: null, branch: null, ops: [], events: [], closed: closed ? { at, by: 'steward-b', decision: null } : null,
  }, { actor: 'steward-a', rule: `${rules[0]!.id}/system` }, { now: () => clock, startBranch: 'main' })
}

beforeEach(() => {
  clock = new Date(NOW); seen = []; lastHat = 0; child = null; txs = {}
  repo = makeChangeRepo(GOVERNANCE)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: placeholder members, a Safe, a Hats tree and a Snapshot space"')
  const systems = new SystemReader({ repo, fetch, now: () => clock, sleep: async () => {}, outcomeTtlMs: 0,
    drivers: [{ ...safe, minGapMs: 0 }, { ...hatsTree, minGapMs: 0 }] })
  app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems }))
})
afterEach(() => { removeFixtureRepo(repo) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const prepare = (id: string, body: unknown) => { as('steward-a'); return app.request(`/api/proposals/${id}/prepare`, json(body)) }
const attach = (id: string, ref: unknown) => { as('steward-a'); return app.request(`/api/proposals/${id}/events`, json({ kind: 'attach', ref })) }
const ADD_ROLE = { system: 'council-tree', action: 'add-role',
  params: { admin: '0x00000021.0001', details: 'Stewards', maxSupply: 2, wearers: [A(1), A(2)], eligibility: A(7), toggle: A(8) } }
const TX = { to: '0x00000000000000000000000000000000000a11ce', value: '1', operation: 0 }

describe('prepare is conditioned (L7-D16)', () => {
  it('a proposal that is not open is not prepared, an action or a transaction, and nothing is read', async () => {
    await open(P2, [COUNCIL_RULE], { state: 'ratified' })
    for (const body of [{ ...ADD_ROLE, via: 'treasury-safe' }, TX]) {
      const res = await prepare(P2, body)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ code: 'NOT_PREPARED', error: `Not prepared: proposal ${P2} is ratified; only an open proposal is prepared.` })
    }
    expect(seen).toEqual([])
  })

  it('an action on a system no rule waits on, without a via Safe one does, is not prepared', async () => {
    await open(P1, [COUNCIL_RULE])
    const res = await prepare(P1, ADD_ROLE)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'NOT_PREPARED', error: `Not prepared: proposal ${P1} waits on treasury-safe; attaching council-tree would be refused.` })
    expect(seen).toEqual([])
  })

  it('the sentence names every system the rules wait on', async () => {
    await open(P3, [COUNCIL_RULE, VOTES_RULE])
    const res = await prepare(P3, ADD_ROLE)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(`Not prepared: proposal ${P3} waits on treasury-safe, dao-votes; attaching council-tree would be refused.`)
  })

  // OQ-1 (PF-R192): add-role via a Safe is one Safe transaction (MultiSendCallOnly), so the attach names one hash.
  it('with via the Safe the rules wait on: prepared, and the attach is the Safe\'s one transaction, which attach accepts', async () => {
    await open(P1, [COUNCIL_RULE])
    const res = await prepare(P1, { ...ADD_ROLE, via: 'treasury-safe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.steps.map((s: { safe: { payload: { nonce: number; operation: number } } }) => [s.safe.payload.nonce, s.safe.payload.operation])).toEqual([[4, 1]])
    expect(body.attach).toMatchObject({ system: 'treasury-safe', id: body.steps[0].safe.ref.id })
    expect(body.attach.also).toBeUndefined()
    expect((await attach(P1, body.attach)).status).toBe(200)
  })

  it('on the tree its rules wait on: prepared, and the hats-role ref is what attach accepts', async () => {
    await open(P4, [ROLES_RULE])
    const res = await prepare(P4, { ...ADD_ROLE, via: 'treasury-safe' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attach).toEqual({ system: 'council-tree', id: hatRef(CELO, CHILD),
      payload: { kind: 'hats-role', details: 'Stewards', wearers: [`${CELO}:${A(1)}`, `${CELO}:${A(2)}`] } })
    expect((await attach(P4, body.attach)).status).toBe(200)
  })
})

describe('ATTACHED_ELSEWHERE keys a hats-role by its system and hat id', () => {
  it('a second proposal attaching the same new hat, even with other wearers, is refused', async () => {
    await open(P4, [ROLES_RULE])
    await open(P5, [ROLES_RULE])
    const role = (wearers: string[]) => ({ system: 'council-tree', id: hatRef(CELO, CHILD), payload: { kind: 'hats-role', details: 'Stewards', wearers: wearers.map(a => `${CELO}:${a}`) } })
    expect((await attach(P4, role([A(1), A(2)]))).status).toBe(200)
    const res = await attach(P5, role([A(3)]))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(`already attached to proposal ${P4}`) })
  })
})

// PF-R205 (PF-R201's gap): when the rules wait on the via Safe, the attach is the Safe transaction and its outcome is the
// Safe's; the add-role's hats-role ref rides beside it (`watch`), and a check reads the tree too, so a hat made under the
// admin since prepare reads as a mismatch (PF-R200's sentence) before anyone executes.
describe('an add-role attached through the via Safe also reads the tree (PF-R205)', () => {
  const ROLE = { system: 'council-tree', id: hatRef(CELO, CHILD), payload: { kind: 'hats-role', details: 'Stewards', wearers: [`${CELO}:${A(1)}`, `${CELO}:${A(2)}`] } }
  const check = (id: string) => { as('steward-a'); return app.request(`/api/proposals/${id}/check`, json({})) }
  const viaSafe = async (id: string) => {
    await open(id, [COUNCIL_RULE])
    const body = await (await prepare(id, { ...ADD_ROLE, via: 'treasury-safe' })).json()
    return body.attach as { system: string; id: string; watch?: unknown }
  }

  it('the attach carries the hats-role ref beside the Safe transaction, and attach keeps it in the ledger', async () => {
    const ref = await viaSafe(P1)
    expect(ref).toMatchObject({ system: 'treasury-safe', watch: ROLE })
    expect((await attach(P1, ref)).status).toBe(200)
    const held = readLedger(repo).entries.find(e => String(e.id) === P1)!.events.filter(e => e.kind === 'attach').at(-1)!
    expect((held.ref as Record<string, unknown>).watch).toEqual(ROLE)
  })

  it('while the Safe transaction waits, a hat made under the admin since prepare reads as a mismatch', async () => {
    const ref = await viaSafe(P1)
    expect((await attach(P1, ref)).status).toBe(200)
    lastHat = 1
    const res = await check(P1)
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.reading).toMatchObject({ ok: true, outcome: 'mismatch',
      detail: 'Another hat was created under the admin since this was prepared: prepare it again.' })
    // the Safe service has not seen the transaction (its 404): answered, never recorded, so it locks nothing
    expect(out.appended).toBe(false)
  })

  // Fix I-1: an unrecorded mismatch is shown, to the one who checks and to every member who visits.
  it('a mismatch the Safe service has not seen is the check\'s attention and the view\'s, in words, and nothing is recorded', async () => {
    const ref = await viaSafe(P1)
    expect((await attach(P1, ref)).status).toBe(200)
    lastHat = 1
    const said = 'treasury-safe read a different transaction: Another hat was created under the admin since this was prepared: prepare it again. ' +
      `${NOT_SEEN}`
    const out = await (await check(P1)).json()
    expect(out.attention).toEqual({ level: 'warn', text: said, mismatch: 'Another hat was created under the admin since this was prepared: prepare it again.' })
    as('steward-b')
    const view = await (await app.request(`/api/proposals/${P1}`)).json()
    expect(view.attention).toEqual({ level: 'warn', text: said, mismatch: 'Another hat was created under the admin since this was prepared: prepare it again.' })
    expect(view.events.filter((e: { kind: string }) => e.kind === 'system')).toEqual([])
    // one who is no member reads nothing, and is told of what a member's read found
    git(repo, 'config user.email someone@example.invalid')
    const seenBefore = seen.length
    const theirs = await (await app.request(`/api/proposals/${P1}`)).json()
    expect(theirs.attention).toEqual({ level: 'warn', text: said, mismatch: 'Another hat was created under the admin since this was prepared: prepare it again.' })
    expect(seen.length).toBe(seenBefore)
  })

  // Fix M-2: while the Safe transaction is not executed, nothing can exist at the id it creates: a hat there is another's.
  it('while the Safe transaction is not executed, any hat at the predicted id is a mismatch, its details the same or not', async () => {
    const ref = await viaSafe(P1)
    expect((await attach(P1, ref)).status).toBe(200)
    lastHat = 1
    for (const made of [{ details: 'Stewards', worn: true }, { details: 'Stewards', worn: false }, { details: 'Other', worn: false }]) {
      child = made
      const out = await (await check(P1)).json()
      expect(out.reading, JSON.stringify(made)).toMatchObject({ ok: true, outcome: 'mismatch' })
    }
    child = { details: 'Stewards', worn: true }
    expect((await (await check(P1)).json()).reading.detail)
      .toBe('A hat already exists at the id this transaction creates, and the transaction is not executed: another hat took this id; prepare it again.')
  })

  it('unmoved, the reading is the Safe\'s', async () => {
    const ref = await viaSafe(P1)
    expect((await attach(P1, ref)).status).toBe(200)
    const res = await check(P1)
    expect(res.status).toBe(200)
    expect((await res.json()).reading).toMatchObject({ ok: true, outcome: 'pending', submitted: false })
  })

  it('an attach whose watch is not a hats-role ref of a Hats tree is refused, and nothing is written', async () => {
    const ref = await viaSafe(P1)
    for (const watch of [
      { ...ROLE, system: 'treasury-safe' },
      { ...ROLE, payload: { kind: 'hats-hat', details: 'Stewards' } },
      { ...ROLE, system: 'nowhere' },
      'council-tree',
    ]) {
      const res = await attach(P1, { ...ref, watch })
      expect([400, 409]).toContain(res.status)
    }
    expect(readLedger(repo).entries.find(e => String(e.id) === P1)!.events.filter(e => e.kind === 'attach')).toEqual([])
  })

  it('a second proposal holding the same new hat, as a watch or as the tree\'s ref, is ATTACHED_ELSEWHERE', async () => {
    const ref = await viaSafe(P1)
    expect((await attach(P1, ref)).status).toBe(200)
    await open(P4, [ROLES_RULE])
    const res = await attach(P4, ROLE)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACHED_ELSEWHERE', error: expect.stringContaining(`already attached to proposal ${P1}`) })
  })
})

// Fix M-1 (L7 Task 18 review): the watch is the transaction's. Prepare keeps, for an add-role bundle, its data_hash and
// the hats-role ref read beside it; an attach of that transaction must carry exactly that watch, and a watch is never
// taken from the client for a transaction prepare did not make as an add-role.
describe('the watch is tied to the transaction prepare made (M-1)', () => {
  const OTHER = { system: 'council-tree', id: hatRef(CELO, childHatId(COUNCIL, 9)), payload: { kind: 'hats-role', details: 'Squatted', wearers: [`${CELO}:${A(3)}`] } }
  const viaSafe = async (id: string, details = 'Stewards') => {
    await open(id, [COUNCIL_RULE])
    const body = await (await prepare(id, { ...ADD_ROLE, via: 'treasury-safe', params: { ...ADD_ROLE.params, details } })).json()
    return body.attach as { system: string; id: string; watch?: unknown }
  }
  const attaches = (id: string) => readLedger(repo).entries.find(e => String(e.id) === id)!.events.filter(e => e.kind === 'attach')

  it('an add-role\'s Safe transaction attached without its watch is refused, and nothing is written', async () => {
    const { watch: _dropped, ...bare } = await viaSafe(P1)
    const res = await attach(P1, bare)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining(`its new hat ${hatRef(CELO, CHILD)} is read beside it`) })
    expect(attaches(P1)).toEqual([])
  })

  it('a watch naming another hat than the one the transaction creates is refused; the squat cannot hold that hat', async () => {
    const ref = await viaSafe(P3, 'Third')
    const res = await attach(P3, { ...ref, watch: OTHER })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining(`this transaction creates ${hatRef(CELO, CHILD)}`) })
    expect(attaches(P3)).toEqual([])
    // the proposal that really adds that hat attaches it: no ATTACHED_ELSEWHERE from a forged watch
    await open(P4, [ROLES_RULE])
    expect((await attach(P4, { ...OTHER, payload: { ...OTHER.payload, details: 'Real role' } })).status).toBe(200)
  })

  it('the right hat with other details or wearers than prepare gave is refused too', async () => {
    const ref = await viaSafe(P1) as { watch: { payload: Record<string, unknown> } } & Record<string, unknown>
    for (const payload of [{ ...ref.watch.payload, details: 'Other' }, { ...ref.watch.payload, wearers: [`${CELO}:${A(3)}`] }]) {
      const res = await attach(P1, { ...ref, watch: { ...ref.watch, payload } })
      expect(res.status).toBe(409)
    }
    expect(attaches(P1)).toEqual([])
  })

  it('a watch whose tree is on another chain than the Safe transaction is refused', async () => {
    writeFileSync(join(repo, 'data', 'systems.yaml'), `${SYSTEMS}  - { id: mainnet-tree, kind: hats-tree, name: Elsewhere, chain: "eip155:1", address: "0x00000022", driver: hats-tree }\n`)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a second placeholder tree, on another chain"')
    const ref = await viaSafe(P1)
    const far = topHatId('0x00000022')
    const watch = { system: 'mainnet-tree', id: hatRef('eip155:1', childHatId(childHatId(far, 1), 1)), payload: { kind: 'hats-role', details: 'Stewards', wearers: [`eip155:1:${A(1)}`] } }
    const res = await attach(P1, { ...ref, watch })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ATTACH', error: expect.stringContaining('is on eip155:1, and the Safe transaction on eip155:42220') })
    expect(attaches(P1)).toEqual([])
  })
})

// L7 gap B2 (PF-R225 closed by PF-R234): an add-role's Safe transaction attached without its watch (prepare's memory lost
// it: evicted, or the server restarted) is decoded at check time from the Safe Transaction Service's reading of it (the
// transaction's own data, checked against the attached hash), its watch rebuilt (the hat id batchMintHats names under the
// admin createHat makes it under, and the wearers it mints to) and the tree read beside it as with a watch. A bundle that
// does not decode cleanly is a mismatch with a sentence, never executed. Recorded answers only: no network.
describe('an add-role attached without its watch is decoded at check (B2)', () => {
  const CALL_ONLY = multiSendCallOnlyOn(CELO)!
  const check = (id: string) => { as('steward-a'); return app.request(`/api/proposals/${id}/check`, json({})) }
  const multisig = (id: string) => `https://api.safe.global/tx-service/celo/api/v1/multisig-transactions/${id}/`
  /** The Safe service's answer for a prepared payload: seen after the proposal opened, unsigned, or executed. */
  const answerFor = (id: string, payload: { to: string; value: string; data: string; operation: number; nonce: number }, executed = false) => {
    txs[multisig(id)] = {
      safeTxHash: id, to: payload.to, value: payload.value, data: payload.data, operation: payload.operation, safeTxGas: '0', baseGas: '0', gasPrice: '0',
      gasToken: ZERO, refundReceiver: ZERO, nonce: payload.nonce, submissionDate: '2026-10-30T13:00:00Z', confirmations: [], confirmationsRequired: 2,
      ...(executed ? { isExecuted: true, isSuccessful: true, executionDate: '2026-10-30T14:00:00Z' } : { isExecuted: false }),
    }
  }
  /** Prepare memory forgets: 512 other add-roles prepared since push this one out (PF-R214's eviction). */
  const evict = () => {
    for (let i = 0; i < 512; i++) keepWatch(repo, `0x${i.toString(16).padStart(64, '0')}`, { system: 'council-tree', id: hatRef(CELO, CHILD), payload: { kind: 'hats-role', details: 'x', wearers: [] } })
  }
  /** An add-role prepared through the via Safe, its watch evicted, attached as a plain Safe transaction. */
  const attachedBare = async (id: string, executed = false) => {
    await open(id, [COUNCIL_RULE])
    const body = await (await prepare(id, { ...ADD_ROLE, via: 'treasury-safe' })).json()
    const { watch: _lost, ...bare } = body.attach as { id: string; watch?: unknown }
    evict()
    const res = await attach(id, bare)
    expect(res.status, await res.clone().text()).toBe(200)
    answerFor(bare.id, body.steps[0].safe.payload, executed)
    return bare
  }

  it('evicted: the transaction is decoded, its new hat read on the tree, and executed with its wearers it reads executed', async () => {
    await attachedBare(P1, true)
    child = { details: 'Stewards', worn: true }
    lastHat = 1
    const before = seen.length
    const out = await (await check(P1)).json()
    expect(out.reading).toMatchObject({ ok: true, outcome: 'executed' })
    expect(out.reading).not.toHaveProperty('tx')
    // the tree was read beside the Safe (an RPC call), as with a watch
    expect(seen.slice(before).some(u => !u.includes('api.safe.global'))).toBe(true)
  })

  it('evicted, executed, and the hat at its id holds other details: the decoded watch reads it as a mismatch', async () => {
    await attachedBare(P1, true)
    child = { details: 'Other', worn: true }
    lastHat = 1
    expect((await (await check(P1)).json()).reading).toMatchObject({ ok: true, outcome: 'mismatch', detail: 'another hat took this id; prepare again' })
  })

  it('evicted, unsigned, and another hat created under the admin since prepare: "Doesn\'t match", as with a watch', async () => {
    await attachedBare(P1)
    lastHat = 1
    const out = await (await check(P1)).json()
    expect(out.reading).toMatchObject({ ok: true, outcome: 'mismatch', detail: 'Another hat was created under the admin since this was prepared: prepare it again.' })
  })

  it('evicted, unsigned and unmoved: the reading is the Safe\'s', async () => {
    await attachedBare(P1)
    expect((await (await check(P1)).json()).reading).toMatchObject({ ok: true, outcome: 'pending', detail: '0 of 2 signatures' })
  })

  /** A Safe transaction to MultiSendCallOnly with these inner calls, attached by hand to a fresh proposal. */
  const attachedBundle = async (id: string, inner: { operation: 0 | 1; to: string; value: string; data: string }[], executed = true) => {
    await open(id, [COUNCIL_RULE])
    const payload = { to: CALL_ONLY, value: '0', data: encodeMultiSend(inner), operation: 1, nonce: 4 }
    const ref = { system: 'treasury-safe', id: safeTxHash({ chainId: 42220, safe: SAFE, ...payload }),
      payload: { to: payload.to, value: payload.value, data_hash: dataHash(payload.data), operation: payload.operation, nonce: payload.nonce } }
    const res = await attach(id, ref)
    expect(res.status, await res.clone().text()).toBe(200)
    answerFor(ref.id, payload, executed)
  }
  const createHat = (admin: string) => encodeCall('createHat(uint256,string,uint32,address,address,bool,string)', [BigInt(admin).toString(), 'Stewards', 2, A(7), A(8), true, ''])
  const mint = (ids: string[], wearers: string[]) => encodeCall('batchMintHats(uint256[],address[])', [ids.map(i => BigInt(i).toString()), wearers])

  it('a bundle whose createHat does not decode is a mismatch with a sentence, never executed', async () => {
    await attachedBundle(P1, [
      { operation: 0, to: HATS, value: '0', data: selector('createHat(uint256,string,uint32,address,address,bool,string)') + 'deadbeef' },
      { operation: 0, to: HATS, value: '0', data: mint([CHILD], [A(1)]) },
    ])
    const out = await (await check(P1)).json()
    expect(out.reading).toMatchObject({ ok: true, outcome: 'mismatch' })
    expect(out.reading.detail).toMatch(/^The Safe transaction may change hats, and the Hub cannot read it as one new role: /)
  })

  it('a bundle that mints another hat than createHat makes, or creates one and mints nothing, is a mismatch too', async () => {
    await attachedBundle(P1, [
      { operation: 0, to: HATS, value: '0', data: createHat(COUNCIL) },
      { operation: 0, to: HATS, value: '0', data: mint([childHatId(CHILD, 1)], [A(1)]) },
    ])
    expect((await (await check(P1)).json()).reading).toMatchObject({ ok: true, outcome: 'mismatch' })
    await attachedBundle(P2, [{ operation: 0, to: HATS, value: '0', data: createHat(COUNCIL) }])
    expect((await (await check(P2)).json()).reading).toMatchObject({ ok: true, outcome: 'mismatch' })
  })

  // The gaps review's M-1 (replaces B2's "a bundle that touches no createHat is a plain Safe transaction"): a bundle that
  // calls Hats at all and is not the add-role is a mismatch; one that never calls Hats is the Safe's reading.
  it('a bundle that mints a hat beside a transfer is a mismatch; one that never calls Hats is read as the Safe reads it', async () => {
    await attachedBundle(P1, [
      { operation: 0, to: A(5), value: '1', data: '0x' },
      { operation: 0, to: HATS, value: '0', data: mint([COUNCIL], [A(1)]) },
    ])
    expect((await (await check(P1)).json()).reading).toMatchObject({ ok: true, outcome: 'mismatch' })
    await attachedBundle(P2, [{ operation: 0, to: A(5), value: '1', data: '0x' }, { operation: 0, to: A(6), value: '1', data: '0x' }])
    expect((await (await check(P2)).json()).reading).toMatchObject({ ok: true, outcome: 'executed' })
  })

  // The gaps review's M-2: the hat the bundle mints must be the one its createHat makes, the admin's newest child as the
  // check reads it; an existing sibling minted beside a createHat of the same details is not.
  it('a bundle that creates one hat and mints the existing sibling "Council" is a mismatch, executed or not', async () => {
    const createCouncil = encodeCall('createHat(uint256,string,uint32,address,address,bool,string)', [BigInt(TOP).toString(), 'Council', 2, A(7), A(8), true, ''])
    await attachedBundle(P1, [
      { operation: 0, to: HATS, value: '0', data: createCouncil },
      { operation: 0, to: HATS, value: '0', data: mint([COUNCIL], [A(1)]) },
    ])
    const out = await (await check(P1)).json()
    expect(out.reading).toMatchObject({ ok: true, outcome: 'mismatch' })
    expect(out.reading.detail).toMatch(/the Hub cannot read it as one new role: /)
  })
})
