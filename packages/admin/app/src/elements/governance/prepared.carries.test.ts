import { describe, it, expect } from 'vitest'
import type { ProposalView } from '../../api.ts'
import { TREASURY_SYSTEM } from '../../test/fixtures/house/systems.ts'
import { PAY_KIT, TX, daysFrom } from '../../test/fixtures/house/governance.ts'
import { NONCE_MOVED } from '../../../../lib/safe-tx.mjs'
import { preparedFromProposal } from './prepared.ts'

// L4b carries (L7 spec §11): the ledger's readings as the prepared cards read them. Executed with success not known yet
// is `executed`, never `ready` (§11.1); a reading with `chains` gives each card its own chain's reading (§11.2); an
// attach of an earlier revision is `stale`, and a transaction whose nonce another took is `replaced` (§11.3).

const CELO = 'eip155:42220'
const GNOSIS = 'eip155:100'
const GNOSIS_ID = `0x${'d'.repeat(64)}`
type Event = Record<string, unknown>
const events = (v: ProposalView) => v.events as unknown as Event[]
const ATTACH = events(PAY_KIT).find(e => e.kind === 'attach')!
const BEFORE = events(PAY_KIT).slice(0, events(PAY_KIT).indexOf(ATTACH))
const REF = { system: 'treasury', ...TX, also: [{ chain: GNOSIS, id: GNOSIS_ID, payload: { ...TX.payload, value: '0', nonce: 3 } }] }
let n = 40
const reading = (outcome: string, extra: Event = {}): Event => ({
  id: `p-2026-10-16-001-e${n++}`, at: daysFrom(-0.5), by: 'system:treasury', kind: 'system', rev: PAY_KIT.rev, outcome,
  ref: { system: 'treasury', ...TX }, text: `${outcome} reading`, ...extra,
})
/** PAY_KIT's events up to its attach (or `attach` in its place), then these readings. */
const kit = (readings: Event[], extra: Partial<ProposalView> = {}, attach: Event = ATTACH) =>
  ({ ...PAY_KIT, events: [...BEFORE, attach, ...readings], ...extra }) as unknown as ProposalView
const one = (r: Event, extra: Partial<ProposalView> = {}) => preparedFromProposal(kit([r], extra), TREASURY_SYSTEM)[0]!

describe('executed, success not known yet (§11.1)', () => {
  it('pending with executed: true is the state executed, outcome.known false, never ready, never failed', () => {
    const tx = one(reading('pending', { executed: true, confirmations: 4, required: 4 }))
    expect(tx.state).toBe('executed')
    expect(tx.outcome).toMatchObject({ known: false })
    expect(tx.outcome!.failed).toBeUndefined()
    // with fewer signatures counted than the threshold, still executed
    expect(one(reading('pending', { executed: true, confirmations: 1, required: 4 })).state).toBe('executed')
  })

  it('a reading that does not say executed keeps the count\'s state; executed and known has no `known`', () => {
    expect(one(reading('pending', { confirmations: 4, required: 4 })).state).toBe('ready')
    expect(one(reading('executed', { confirmations: 4, required: 4 })).outcome).not.toHaveProperty('known')
  })

  it('a failed read over an executed-unknown reading keeps it executed', () => {
    const tx = one(reading('pending', { executed: true, confirmations: 4, required: 4 }), { attention: { level: 'warn', text: 'read failed: timeout' } })
    expect(tx).toMatchObject({ state: 'executed', readFailed: true, outcome: { known: false } })
  })
})

describe('per-chain readings (§11.2)', () => {
  const attach = { ...ATTACH, ref: REF }
  const chains = [
    { chain: CELO, id: TX.id, outcome: 'executed', detail: 'executed on 2026-10-30T11:00:00Z', confirmations: 4, required: 4, block: 100, txHash: `0x${'c'.repeat(64)}` },
    { chain: GNOSIS, id: GNOSIS_ID, outcome: 'pending', detail: '1 of 4 signatures', confirmations: 1, required: 4 },
  ]

  it('each card shows its own chain\'s state, count, block and transaction hash', () => {
    const r = reading('pending', { text: 'waiting on Gnosis', chains })
    const [celo, gnosis] = preparedFromProposal(kit([r], {}, attach), TREASURY_SYSTEM)
    expect(celo).toMatchObject({ state: 'executed', signed: 4, of: 4, outcome: { block: '100', txHash: `0x${'c'.repeat(64)}` } })
    expect(gnosis).toMatchObject({ state: 'partly-signed', signed: 1, of: 4 })
    expect(gnosis!.outcome).toBeUndefined()
  })

  it('a chain executed with success not known is executed there, never ready', () => {
    const r = reading('pending', { chains: [chains[0], { ...chains[1], executed: true, confirmations: 4, block: 7, txHash: `0x${'e'.repeat(64)}` }] })
    const [, gnosis] = preparedFromProposal(kit([r], {}, attach), TREASURY_SYSTEM)
    expect(gnosis).toMatchObject({ state: 'executed', outcome: { known: false, block: '7' } })
  })

  it('a chain entry missing for a card falls back to the aggregate, as an L2 reading does', () => {
    const r = reading('pending', { confirmations: 2, required: 4, chains: [chains[0]] })
    const [celo, gnosis] = preparedFromProposal(kit([r], {}, attach), TREASURY_SYSTEM)
    expect(celo!.state).toBe('executed')
    expect(gnosis).toMatchObject({ state: 'partly-signed', signed: 2 })
  })
})

describe('replaced and stale (§11.3)', () => {
  it('a mismatch whose text is the nonce-moved sentence is replaced, with the sentence', () => {
    const tx = one(reading('mismatch', { text: NONCE_MOVED }))
    expect(tx.state).toBe('replaced')
    expect(tx.outcome).toMatchObject({ differs: ["The Safe's nonce changed; revise the proposal to prepare again."] })
    // the aggregate of several chains names the chain first
    expect(one(reading('mismatch', { text: `on Gnosis: ${NONCE_MOVED}` })).state).toBe('replaced')
    // another mismatch stays a mismatch
    expect(one(reading('mismatch', { text: 'this transaction is not the one the proposal prepared: its value differs' })).state).toBe('mismatch')
  })

  it('per chain: only the card whose chain reads the sentence is replaced', () => {
    const r = reading('mismatch', { text: `on Gnosis: ${NONCE_MOVED}`, chains: [
      { chain: CELO, id: TX.id, outcome: 'pending', detail: '2 of 4 signatures', confirmations: 2, required: 4 },
      { chain: GNOSIS, id: GNOSIS_ID, outcome: 'mismatch', detail: NONCE_MOVED },
    ] })
    const [celo, gnosis] = preparedFromProposal(kit([r], {}, { ...ATTACH, ref: REF }), TREASURY_SYSTEM)
    expect(celo!.state).toBe('partly-signed')
    expect(gnosis!.state).toBe('replaced')
  })

  it('an attach at rev 1 on a proposal at rev 2 is stale, saying both revisions; its last reading\'s count is kept', () => {
    const REV2 = 'c0ffee000000'
    const revise = { id: 'p-2026-10-16-001-e90', at: daysFrom(-0.2), by: 'treasury-steward', kind: 'revise', rev: REV2 }
    const v = kit([reading('pending', { confirmations: 2, required: 4 }), revise], { rev: REV2 })
    const [tx] = preparedFromProposal(v, TREASURY_SYSTEM)
    expect(tx).toMatchObject({ state: 'stale', rev: { current: 2, prepared: 1 }, signed: 2, of: 4, payload: { safeTxHash: TX.id } })
  })

  it('stale without the revision events to count: stale, with no revision numbers', () => {
    const [tx] = preparedFromProposal(kit([], { rev: 'c0ffee000000' }), TREASURY_SYSTEM)
    expect(tx!.state).toBe('stale')
    expect(tx!.rev).toBeUndefined()
  })

  it('an attach at the current rev is never stale, even with an older one before it', () => {
    const REV2 = 'c0ffee000000'
    const revise = { id: 'p-2026-10-16-001-e91', at: daysFrom(-0.2), by: 'treasury-steward', kind: 'revise', rev: REV2 }
    const again = { ...ATTACH, id: 'p-2026-10-16-001-e92', rev: REV2 }
    const [tx] = preparedFromProposal(kit([revise, again], { rev: REV2 }), TREASURY_SYSTEM)
    expect(tx!.state).toBe('unsigned')
    expect(tx!.rev).toBeUndefined()
  })
})
