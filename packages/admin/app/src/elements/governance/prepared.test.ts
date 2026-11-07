import { describe, it, expect } from 'vitest'
import type { ProposalView } from '../../api.ts'
import type { PreparedStep } from '../../../../server/systems/driver.ts'
import { SAFE, fakeAddress } from '../../test/fixtures/house/org.ts'
import { COUNCIL_SAFE, TREASURY_SYSTEM } from '../../test/fixtures/house/systems.ts'
import { PAY_KIT, PREPARED_RETURN, RETURN_POOLS, TX, daysFrom } from '../../test/fixtures/house/governance.ts'
import { alsoSkipped, payloadJson, preparedFromProposal, preparedFromSteps, sentence, totalsOf } from './prepared.ts'

const CELO = 'eip155:42220'
const GNOSIS = 'eip155:100'
const KIT_TX_LINK = `https://app.safe.global/transactions/tx?safe=celo:${SAFE}&id=multisig_${SAFE}_${TX.id}`

type Event = Record<string, unknown>
const events = (v: ProposalView) => v.events as unknown as Event[]
/** PAY_KIT with its comment and attach, then these events in place of its two readings. */
function kit(readings: Event[], extra: Partial<ProposalView> = {}): ProposalView {
  return { ...PAY_KIT, events: [...events(PAY_KIT).slice(0, 2), ...readings], ...extra } as ProposalView
}
let n = 10
/** A `system` event of the Treasury at the current rev, reading the attached transaction. */
const reading = (outcome: string, extra: Event = {}): Event => ({
  id: `p-2026-10-16-001-e${n++}`, at: daysFrom(-0.5), by: 'system:treasury', kind: 'system', rev: PAY_KIT.rev, outcome,
  ref: { system: 'treasury', ...TX }, text: `${outcome} reading`, ...extra,
})

describe('preparedFromProposal (CC-9): the ledger attach, one card per chain', () => {
  it('maps the fixture proposal with an attached Safe ref: its latest reading, 2 of 4, partly signed', () => {
    expect(preparedFromProposal(PAY_KIT, TREASURY_SYSTEM)).toEqual([{
      state: 'partly-signed', safe: { name: 'Treasury', address: SAFE, chain: CELO }, nonce: 18, signed: 2, of: 4,
      calls: [{ title: 'Pay the local node kit grant', from: `${CELO}:${SAFE}`, to: `${CELO}:${fakeAddress(19)}`,
        amount: { raw: '1271000000000000000000', unit: 'CELO', decimals: 18 } }],
      total: 'Total',
      payload: { to: fakeAddress(19), value: '1271000000000000000000', operation: 0, dataHash: `0x${'0'.repeat(64)}`, safeTxHash: TX.id },
      openHref: KIT_TX_LINK,
    }])
  })

  it('returns [] for one without: no attach, or a ref that is not a Safe transaction', () => {
    expect(preparedFromProposal(RETURN_POOLS, TREASURY_SYSTEM)).toEqual([])
    // An attach of an earlier rev is drawn stale since L7 §11.3 (prepared.carries.test.ts), no longer left out.
    expect(preparedFromProposal(kit([], { rev: 'c0ffee000000' }), TREASURY_SYSTEM).map(t => t.state)).toEqual(['stale'])
    const foreign = { ...PAY_KIT, events: [{ id: 'x', at: daysFrom(-1), by: 'steward-a', kind: 'attach', rev: PAY_KIT.rev,
      ref: { system: 'votes', id: '0xabc', payload: { kind: 'snapshot-proposal', choice: 'For' } } }] } as unknown as ProposalView
    expect(preparedFromProposal(foreign, TREASURY_SYSTEM)).toEqual([])
  })

  it('no reading yet: unsigned, the threshold from the Safe\'s read of that chain', () => {
    const [tx] = preparedFromProposal(kit([]), TREASURY_SYSTEM)
    expect(tx).toMatchObject({ state: 'unsigned', signed: 0, of: 4 })
    expect(tx!.outcome).toBeUndefined()
  })

  it('pending: unsigned, partly signed or ready by the signatures it counts; a reading the service has not seen is unsigned', () => {
    const state = (r: Event) => preparedFromProposal(kit([r]), TREASURY_SYSTEM)[0]!
    expect(state(reading('pending', { confirmations: 0, required: 4 }))).toMatchObject({ state: 'unsigned', signed: 0, of: 4 })
    expect(state(reading('pending', { confirmations: 3, required: 4 }))).toMatchObject({ state: 'partly-signed', signed: 3, of: 4 })
    expect(state(reading('pending', { confirmations: 4, required: 4 }))).toMatchObject({ state: 'ready', signed: 4, of: 4 })
    expect(state(reading('pending', { submitted: false }))).toMatchObject({ state: 'unsigned', signed: 0, of: 4 })
  })

  it('executed: read back at the reading\'s time; failed is executed with the failure; mismatch carries the detail', () => {
    const at = daysFrom(-0.25)
    const one = (r: Event) => preparedFromProposal(kit([r]), TREASURY_SYSTEM)[0]!
    expect(one(reading('executed', { at, confirmations: 4, required: 4 }))).toMatchObject({ state: 'executed', signed: 4, of: 4, outcome: { readAt: at } })
    expect(one(reading('failed', { at, confirmations: 4, required: 4 }))).toMatchObject({ state: 'executed', outcome: { readAt: at, failed: true } })
    expect(one(reading('mismatch', { at, text: 'not the transaction the proposal prepared: its value differs' })))
      .toMatchObject({ state: 'mismatch', outcome: { readAt: at, differs: ['Not the transaction the proposal prepared: its value differs.'] } })
  })

  it('a failed read (the view\'s attention) keeps the last reading\'s state and count, marked failed, with the age of that reading', () => {
    const [tx] = preparedFromProposal({ ...PAY_KIT, attention: { level: 'warn', text: 'read failed: timeout' } }, TREASURY_SYSTEM)
    expect(tx).toMatchObject({ state: 'partly-signed', signed: 2, of: 4, readFailed: true, failedAge: events(PAY_KIT).at(-1)!.at })
  })

  it('a failed read after a mismatch, an execution or a ready count keeps that state and its outcome (fix I-1)', () => {
    const at = daysFrom(-0.25)
    const attention = { level: 'warn' as const, text: 'read failed: timeout' }
    const one = (r: Event) => preparedFromProposal(kit([r], { attention }), TREASURY_SYSTEM)[0]!
    expect(one(reading('mismatch', { at, text: 'not the transaction the proposal prepared: its data differs' }))).toMatchObject({
      state: 'mismatch', readFailed: true, failedAge: at, outcome: { readAt: at, differs: ['Not the transaction the proposal prepared: its data differs.'] } })
    expect(one(reading('executed', { at, confirmations: 4, required: 4 }))).toMatchObject({ state: 'executed', readFailed: true, failedAge: at, outcome: { readAt: at } })
    expect(one(reading('pending', { at, confirmations: 4, required: 4 }))).toMatchObject({ state: 'ready', signed: 4, readFailed: true, failedAge: at })
    expect(preparedFromProposal(kit([], { attention }), TREASURY_SYSTEM)[0]).toMatchObject({ state: 'unsigned', readFailed: true })
    expect(preparedFromProposal(kit([], { attention }), TREASURY_SYSTEM)[0]!.failedAge).toBeUndefined()
    expect(preparedFromProposal(kit([]), TREASURY_SYSTEM)[0]!.readFailed).toBeUndefined()
  })

  it('says a server\'s detail as a sentence', () => {
    expect(sentence('its value differs')).toBe('Its value differs.')
    expect(sentence('Already one.')).toBe('Already one.')
    expect(sentence('  ')).toBe('')
  })

  it('ignores a reading of another transaction, and one of an earlier rev', () => {
    const other = reading('executed', { ref: { system: 'treasury', ...TX, id: `0x${'c'.repeat(64)}` } })
    const old = reading('executed', { rev: 'c0ffee000000' })
    expect(preparedFromProposal(kit([other, old]), TREASURY_SYSTEM)[0]).toMatchObject({ state: 'unsigned', signed: 0 })
  })

  it('one card per chain: the attach and each of its `also`, each with that chain\'s threshold, nonce and Safe link', () => {
    const gnosisId = `0x${'d'.repeat(64)}`
    const ref = { system: 'treasury', ...TX, also: [{ chain: GNOSIS, id: gnosisId, payload: { ...TX.payload, value: '0', nonce: 3 } }] }
    const v = { ...PAY_KIT, events: [events(PAY_KIT)[0], { ...events(PAY_KIT)[1], ref }] } as unknown as ProposalView
    const txs = preparedFromProposal(v, TREASURY_SYSTEM)
    expect(txs.map(t => [t.safe.chain, t.nonce, t.of, t.payload.safeTxHash, t.openHref])).toEqual([
      [CELO, 18, 4, TX.id, KIT_TX_LINK],
      [GNOSIS, 3, 4, gnosisId, `https://app.safe.global/transactions/tx?safe=gno:${SAFE}&id=multisig_${SAFE}_${gnosisId}`],
    ])
    expect(txs[1]!.calls[0]!.amount).toBeUndefined() // nothing moves in the native unit
  })

  it('skips an `also` entry it cannot read (no payload, no nonce, no id, no chain), so the other cards still draw', () => {
    const gnosisId = `0x${'d'.repeat(64)}`
    const good = { chain: GNOSIS, id: gnosisId, payload: { ...TX.payload, value: '0', nonce: 3 } }
    const bad = [
      { chain: GNOSIS, id: gnosisId }, // no payload
      { chain: GNOSIS, id: gnosisId, payload: { ...TX.payload, nonce: 'three' } }, // no numeric nonce
      { chain: GNOSIS, payload: { ...TX.payload, nonce: 4 } }, // no id
      { id: gnosisId, payload: { ...TX.payload, nonce: 5 } }, // no chain
      null, 'nonsense',
    ]
    const ref = { system: 'treasury', ...TX, also: [...bad, good] }
    const v = { ...PAY_KIT, events: [events(PAY_KIT)[0], { ...events(PAY_KIT)[1], ref }] } as unknown as ProposalView
    expect(preparedFromProposal(v, TREASURY_SYSTEM).map(t => [t.safe.chain, t.nonce])).toEqual([[CELO, 18], [GNOSIS, 3]])
    // and says how many it left out, so the page can say so under the cards (E-53)
    expect(alsoSkipped(v)).toBe(6)
  })

  it('alsoSkipped is 0 when every chain is read, and when nothing is attached (E-53)', () => {
    const gnosisId = `0x${'d'.repeat(64)}`
    const ref = { system: 'treasury', ...TX, also: [{ chain: GNOSIS, id: gnosisId, payload: { ...TX.payload, nonce: 3 } }] }
    expect(alsoSkipped({ ...PAY_KIT, events: [events(PAY_KIT)[0], { ...events(PAY_KIT)[1], ref }] } as unknown as ProposalView)).toBe(0)
    expect(alsoSkipped(RETURN_POOLS)).toBe(0)
  })

  it('without the Safe\'s Resource: named by its id, no threshold, no link', () => {
    expect(preparedFromProposal(kit([]))[0]).toMatchObject({ safe: { name: 'treasury', address: '', chain: CELO }, of: 0, openHref: '' })
  })

  it('a one-chain Safe gives its threshold from its own facts', () => {
    const ref = { ...TX, system: 'council-safe' }
    const v = { ...PAY_KIT, events: [events(PAY_KIT)[0], { ...events(PAY_KIT)[1], ref }] } as unknown as ProposalView
    expect(preparedFromProposal(v, COUNCIL_SAFE)[0]).toMatchObject({ safe: { name: 'Council Safe', chain: CELO }, of: 3 })
  })
})

describe('preparedFromSteps (CC-9): L2\'s prepare reply, one card per Safe transaction', () => {
  const payload = { to: fakeAddress(72), value: '0', data: '0xabcdef', operation: 0 as const, safeTxGas: '0', baseGas: '0', gasPrice: '0',
    gasToken: `0x${'0'.repeat(40)}`, refundReceiver: `0x${'0'.repeat(40)}`, nonce: 18 }
  const hash = `0x${'e'.repeat(64)}`
  const safeStep: PreparedStep = {
    call: { chain: CELO, to: `${CELO}:${fakeAddress(72)}`, value: '0', data: '0xabcdef', operation: 0, summary: 'Return Network Projects to the Safe' },
    signer: { kind: 'safe', account: `${CELO}:${SAFE}` },
    safe: { payload, ref: { system: 'treasury', id: hash, payload: { to: payload.to, value: '0', data_hash: `0x${'1'.repeat(64)}`, operation: 0, nonce: 18 } }, link: 'https://app.safe.global/transactions/tx?safe=celo:x' },
  }

  it('draws each Safe-signed step: unsigned, 0 of the threshold, its call, the payload with its data, the step\'s link', () => {
    expect(preparedFromSteps([safeStep], TREASURY_SYSTEM)).toEqual([{
      state: 'unsigned', safe: { name: 'Treasury', address: SAFE, chain: CELO }, nonce: 18, signed: 0, of: 4,
      calls: [{ title: 'Return Network Projects to the Safe', from: `${CELO}:${SAFE}`, to: `${CELO}:${fakeAddress(72)}` }],
      total: 'Total',
      payload: { to: fakeAddress(72), value: '0', operation: 0, data: '0xabcdef', safeTxHash: hash },
      openHref: 'https://app.safe.global/transactions/tx?safe=celo:x',
    }])
  })

  it('a call that moves the native unit carries its amount; a step no Safe signs is not a card', () => {
    const moving = { ...safeStep, call: { ...safeStep.call, value: '2500000000000000000' } }
    const wearer: PreparedStep = { ...safeStep, signer: { kind: 'wearer', hat: 'eip155:42220:0x1' }, safe: null }
    const txs = preparedFromSteps([wearer, moving], { name: 'Treasury' })
    expect(txs).toHaveLength(1)
    expect(txs[0]!.calls[0]!.amount).toEqual({ raw: '2500000000000000000', unit: 'CELO', decimals: 18 })
    expect(txs[0]!.of).toBe(0) // given only a name, the threshold is not known
    expect(preparedFromSteps([wearer], { name: 'Treasury' })).toEqual([])
  })
})

describe('the card\'s sums and payload', () => {
  it('adds the calls\' amounts per unit, exactly, in base units', () => {
    expect(totalsOf(PREPARED_RETURN.calls)).toEqual([{ value: '3100', unit: 'USDGLO', decimals: 18 }])
    const mixed = [...PREPARED_RETURN.calls, { title: 'x', from: '', to: '', amount: { raw: '5', unit: 'CELO', decimals: 0 } }, { title: 'y', from: '', to: '' }]
    expect(totalsOf(mixed)).toEqual([{ value: '3100', unit: 'USDGLO', decimals: 18 }, { value: '5', unit: 'CELO', decimals: 0 }])
    expect(totalsOf([])).toEqual([])
  })

  it('writes the payload as JSON: to, value, data (or its hash), operation, nonce, safeTxHash', () => {
    expect(JSON.parse(payloadJson(PREPARED_RETURN))).toEqual({
      to: PREPARED_RETURN.payload.to, value: '0', data: PREPARED_RETURN.payload.data, operation: 1, nonce: 18, safeTxHash: PREPARED_RETURN.payload.safeTxHash,
    })
    const hashed = { ...PREPARED_RETURN, payload: { to: '0x1', value: '0', operation: 0 as const, dataHash: '0x2', safeTxHash: '0x3' } }
    expect(Object.keys(JSON.parse(payloadJson(hashed)))).toEqual(['to', 'value', 'dataHash', 'operation', 'nonce', 'safeTxHash'])
  })
})
