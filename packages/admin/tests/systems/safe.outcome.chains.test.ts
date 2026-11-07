import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { createEntry, readLedger } from '../../server/proposals/ledger.ts'
import { safe } from '../../server/systems/safe.ts'
import { guardedFetch, type FetchLike, type OutcomeReading, type SystemRef } from '../../server/systems/driver.ts'
import { safeTxHash, dataHash, ZERO_ADDRESS } from '../../lib/safe-tx.mjs'
import { revOf } from '../../lib/proposals.mjs'

// L4b carries (L7 spec §11.1, §11.2): a Safe transaction executed whose success the service does not say yet reads
// `pending` with `executed: true` (the evaluator, which reads only the aggregate outcome, does not change), and an attach
// of one change on several chains reads `chains`, each chain's own reading with the block and transaction hash the
// service gives once executed (`blockNumber`, `transactionHash`). The service is a fake answering its own shapes
// (tests/server/fixtures/safe-outcome); the Safe, its owners and transactions are synthetic. Nothing touches the network.

const ADDR = '0x5afe000000000000000000000000000000005afe'
const A1 = '0x00000000000000000000000000000000000000a1'
const B2 = '0x00000000000000000000000000000000000000a2'
const CELO = 'eip155:42220', ETH = 'eip155:1', GNO = 'eip155:100'
const SLUG: Record<string, string> = { [CELO]: 'celo', [ETH]: 'eth', [GNO]: 'gno' }
const CHAIN_ID: Record<string, number> = { [CELO]: 42220, [ETH]: 1, [GNO]: 100 }
const NONCE: Record<string, number> = { [CELO]: 8, [ETH]: 4, [GNO]: 11 }
const TO = '0x00000000000000000000000000000000000a11ce'
const OPENED = '2026-10-30T09:00:00Z'
const NOW = new Date('2026-10-30T12:00:00Z')
const api = (chain: string) => `https://api.safe.global/tx-service/${SLUG[chain]}/api`

/** The prepared step on `chain`: its payload and the hash it commits to. */
function step(chain: string) {
  const payload = { to: TO, value: '0', data: '0x', operation: 0 as const, nonce: NONCE[chain]! }
  const id = safeTxHash({ chainId: CHAIN_ID[chain]!, safe: ADDR, ...payload, safeTxGas: 0, baseGas: 0, gasPrice: 0, gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS })
  return { chain, id, payload: { to: TO, value: '0', data_hash: dataHash('0x'), operation: 0, nonce: payload.nonce } }
}
/** The service's answer for the step on `chain`, waiting with one of two signatures unless `over` says otherwise. */
function txAnswer(chain: string, over: Record<string, unknown> = {}) {
  const s = step(chain)
  return {
    safe: ADDR, to: TO, value: '0', data: null, operation: 0, gasToken: ZERO_ADDRESS, safeTxGas: '0', baseGas: '0', gasPrice: '0',
    refundReceiver: ZERO_ADDRESS, nonce: s.payload.nonce, executionDate: null, submissionDate: '2026-10-30T10:00:00Z', safeTxHash: s.id,
    blockNumber: null, transactionHash: null, isExecuted: false, isSuccessful: null, confirmationsRequired: 2, confirmations: [{ owner: A1 }], ...over,
  }
}
const executed = (block: number, hash: string, isSuccessful: boolean | null = true) =>
  ({ isExecuted: true, isSuccessful, executionDate: '2026-10-30T11:00:00Z', blockNumber: block, transactionHash: hash, confirmations: [{ owner: A1 }, { owner: B2 }] })
const TX_CELO = `0x${'c'.repeat(64)}`, TX_ETH = `0x${'e'.repeat(64)}`

function service(answers: Record<string, Record<string, unknown> | null>) {
  const routes: Record<string, unknown> = {}
  for (const [chain, over] of Object.entries(answers)) {
    routes[`${api(chain)}/v1/safes/${ADDR}/`] = { address: ADDR, nonce: String(NONCE[chain]), threshold: 2, owners: [A1, B2], version: '1.4.1' }
    if (over !== null) routes[`${api(chain)}/v1/multisig-transactions/${step(chain).id}/`] = txAnswer(chain, over)
  }
  const fetch: FetchLike = async url => (url in routes ? { ok: true, status: 200, json: async () => routes[url] } : { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) })
  return fetch
}
const ctx = (fetch: FetchLike) => ({ fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: [], sleep: async () => {}, opened: OPENED })

const ONE = { id: 'treasury', kind: 'safe', name: 'Treasury', chain: CELO, address: ADDR, driver: 'safe' }
const THREE = { ...ONE, chains: [ETH, GNO] }
const refOne: SystemRef = { system: 'treasury', id: step(CELO).id, payload: step(CELO).payload }
const refThree: SystemRef = { ...refOne, also: [step(ETH), step(GNO)] }

describe('executed, success not known yet (§11.1)', () => {
  it('one chain: pending, with executed: true', async () => {
    const r = await safe.outcome!(ONE, refOne, ctx(service({ [CELO]: executed(100, TX_CELO, null) })))
    expect(r).toEqual({
      ok: true, outcome: 'pending', executed: true, confirmations: 2, required: 2,
      detail: 'executed on 2026-10-30T11:00:00Z; the Safe does not say yet whether it succeeded',
    })
  })

  it('every chain executed, one of them with success not known: the aggregate is pending, with executed: true', async () => {
    const r = await safe.outcome!(THREE, refThree, ctx(service({ [CELO]: executed(100, TX_CELO), [ETH]: executed(200, TX_ETH, null), [GNO]: executed(300, TX_ETH) })))
    expect(r).toMatchObject({ ok: true, outcome: 'pending', executed: true })
  })
})

describe('per-chain readings (§11.2)', () => {
  it('three chains read: `chains` holds each chain\'s own outcome, with the block and transaction hash once executed', async () => {
    const r = await safe.outcome!(THREE, refThree, ctx(service({ [CELO]: executed(100, TX_CELO), [ETH]: executed(200, TX_ETH, null), [GNO]: {} })))
    if (!r.ok) throw new Error(r.error)
    expect(r.outcome).toBe('pending')
    expect(r.executed).toBeUndefined() // Gnosis still waits on a signature
    expect(r.chains).toEqual([
      { chain: CELO, id: step(CELO).id, outcome: 'executed', detail: 'executed on 2026-10-30T11:00:00Z', confirmations: 2, required: 2, block: 100, txHash: TX_CELO },
      { chain: ETH, id: step(ETH).id, outcome: 'pending', executed: true, detail: 'executed on 2026-10-30T11:00:00Z; the Safe does not say yet whether it succeeded',
        confirmations: 2, required: 2, block: 200, txHash: TX_ETH },
      { chain: GNO, id: step(GNO).id, outcome: 'pending', detail: '1 of 2 signatures', confirmations: 1, required: 2 },
    ])
  })

  it('a step the service has not seen is in `chains` as pending, not submitted', async () => {
    const r = await safe.outcome!(THREE, refThree, ctx(service({ [CELO]: executed(100, TX_CELO), [ETH]: null, [GNO]: {} })))
    if (!r.ok) throw new Error(r.error)
    expect(r.chains!.map(c => [c.chain, c.outcome])).toEqual([[CELO, 'executed'], [ETH, 'pending'], [GNO, 'pending']])
  })
})

// The proposals route records what the driver gives: `chains` and `executed` beside the aggregate, in a throwaway
// repository (makeChangeRepo), with the placeholder members steward-a and steward-b.
describe('the system event records `chains` and `executed` (§11.2)', () => {
  const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
`
  const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: treasury, kind: safe, name: Treasury, chain: "${CELO}", address: "${ADDR}", driver: safe, chains: ["${ETH}", "${GNO}"] }
`
  const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    member: { all: true }
  rules:
    - { id: treasury, applies_to: [treasury], propose: member, decide: { by: system, system: treasury } }
  decisions: []
`
  const RULE = { id: 'treasury', applies_to: ['treasury'], propose: 'member', decide: { by: 'system', method: 'system', system: 'treasury' } }
  const ID = 'p-2026-10-30-001'
  let repo: string
  let app: Hono
  let next: OutcomeReading
  let clock = new Date(NOW)
  /** Readings a minute apart, as Check now makes them: the ledger orders events by time. */
  const tick = () => { clock = new Date(clock.getTime() + 60_000) }
  const systems = { async outcome(): Promise<OutcomeReading> { return next } }
  const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
  const events = () => readLedger(repo).entries.find(e => e.id === ID)!.events as Record<string, unknown>[]
  const check = async () => { tick(); as('steward-b'); return (await app.request(`/api/proposals/${ID}/check`, json({}))).json() }
  const chainsOf = (gno: 'pending' | 'executed', confirmations: number) => [
    { chain: CELO, id: step(CELO).id, outcome: 'executed' as const, detail: 'executed on 2026-10-30T11:00:00Z', confirmations: 2, required: 2, block: 100, txHash: TX_CELO },
    { chain: ETH, id: step(ETH).id, outcome: 'pending' as const, executed: true as const, detail: 'executed; not known', confirmations: 2, required: 2, block: 200, txHash: TX_ETH },
    { chain: GNO, id: step(GNO).id, outcome: gno, detail: `${confirmations} of 2 signatures`, confirmations, required: 2 },
  ]

  beforeEach(async () => {
    clock = new Date(NOW)
    repo = makeChangeRepo(GOVERNANCE)
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: placeholder members and a synthetic Safe"')
    app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems: systems as never }))
    const entry = {
      id: ID, title: 'Pay the venue', author: 'steward-a', classes: ['treasury'], rules: [RULE], state: 'open',
      opened: '2026-10-30T12:00:00Z', rev: revOf([]), base: null, branch: null, ops: [], events: [], closed: null,
    }
    await createEntry(repo, entry, { actor: 'steward-a', rule: 'treasury/system' }, { now: () => clock, startBranch: 'main' })
    as('steward-a')
    const res = await app.request(`/api/proposals/${ID}/events`, json({ kind: 'attach', ref: refThree }))
    expect(res.status).toBe(200)
  })
  afterEach(() => { removeFixtureRepo(repo) })

  it('records chains and executed beside the aggregate; the evaluator reads the aggregate only', async () => {
    next = { ok: true, outcome: 'pending', detail: 'waiting on Ethereum, Gnosis', chains: chainsOf('pending', 1) }
    const view = await check()
    expect(view, JSON.stringify(view)).toMatchObject({ appended: true })
    expect(view.evaluation.state).toBe('pending')
    expect(events().at(-1)).toMatchObject({ kind: 'system', outcome: 'pending', text: 'waiting on Ethereum, Gnosis', chains: chainsOf('pending', 1) })
    expect(events().at(-1)).not.toHaveProperty('executed')

    // Only one chain's count moved: the aggregate reads the same, and the reading is recorded again.
    next = { ok: true, outcome: 'pending', detail: 'waiting on Ethereum, Gnosis', chains: chainsOf('pending', 2) }
    expect((await check()).appended).toBe(true)
    expect(events().at(-1)!.chains).toEqual(chainsOf('pending', 2))
    expect((await check()).appended).toBe(false) // unchanged

    next = { ok: true, outcome: 'pending', executed: true, detail: 'executed on every chain; not yet known whether it succeeded on Ethereum', chains: chainsOf('executed', 2) }
    const after = await check()
    expect(after.appended).toBe(true)
    expect(after.evaluation.state).toBe('pending') // executed but not known: still pending to the evaluator
    expect(events().at(-1)).toMatchObject({ outcome: 'pending', executed: true })
  })

  it('a reading with no chains is recorded as before', async () => {
    next = { ok: true, outcome: 'pending', confirmations: 1, required: 2, detail: '1 of 2 signatures' }
    await check()
    expect(events().at(-1)).not.toHaveProperty('chains')
  })
})
