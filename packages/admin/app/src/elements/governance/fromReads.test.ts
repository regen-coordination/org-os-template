import { describe, it, expect } from 'vitest'
import type { DriverRead } from '../../api.ts'
import { TREASURY_READ } from '../../test/fixtures/house/systems.ts'
import { SAFE, fakeAddress } from '../../test/fixtures/house/org.ts'
import { flowsOf, transfersOf } from './fromReads.ts'
import type { PreparedView } from './prepared.ts'

const CELO = 'eip155:42220'
const NAMES: Record<string, string> = { [fakeAddress(81).toLowerCase()]: 'Ops wallet', [fakeAddress(72).toLowerCase()]: 'Network Projects' }
const names = { safe: 'Treasury', nameOf: (a: string) => NAMES[a.toLowerCase()] ?? null }
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const readWith = (transfers: unknown, over: Partial<DriverRead> = {}): DriverRead =>
  ({ ...TREASURY_READ, ...over, facts: { ...TREASURY_READ.facts, transfers } })
const USDGLO = fakeAddress(91)
const transfer = (from: string, to: string, value: string, unit = 'USDGLO', decimals = 18, token: string | null = USDGLO) =>
  ({ chain: CELO, from, to, value, unit, decimals, token, at: '2026-10-01T00:00:00Z', txHash: `0x${'1'.repeat(64)}` })
const prepared = (to: string, raw: string, state: PreparedView['state'] = 'partly-signed'): PreparedView => ({
  state, safe: { name: 'Treasury', address: SAFE, chain: CELO }, nonce: 18, signed: 1, of: 4,
  calls: [{ title: 'Pay the pool', from: `${CELO}:${SAFE}`, to: `${CELO}:${to}`, amount: { raw, unit: 'CELO', decimals: 18 } }],
  total: 'Total', payload: { to, value: raw, operation: 0, safeTxHash: `0x${'2'.repeat(64)}` }, openHref: '',
})

describe('flowsOf (§9.8, Q59)', () => {
  it("draws the Treasury's transfers: in from its sources, out to its destinations, named where the Hub knows them", () => {
    expect(flowsOf(TREASURY_READ, [], names)).toEqual([
      { from: 'Ops wallet', to: 'Treasury', value: '2500', unit: 'USDGLO', status: 'executed' },
      { from: 'Treasury', to: 'Network Projects', value: '1271', unit: 'USDGLO', status: 'executed' },
      { from: short(fakeAddress(61)), to: 'Treasury', value: '412', unit: 'USDGLO', status: 'executed' },
    ])
  })

  it('adds one counterparty\'s transfers up per unit, exactly, in base units', () => {
    const ops = fakeAddress(81)
    const flows = flowsOf(readWith([
      transfer(ops, SAFE, '1000000000000000001'), transfer(ops, SAFE, '2000000000000000002'), transfer(ops, SAFE, '5000000', 'USDC', 6, fakeAddress(92)),
    ]), [], names)
    expect(flows).toEqual([
      { from: 'Ops wallet', to: 'Treasury', value: '3.000000000000000003', unit: 'USDGLO', status: 'executed' },
      { from: 'Ops wallet', to: 'Treasury', value: '5', unit: 'USDC', status: 'executed' },
    ])
  })

  it('sums by address and token, never by a name or a symbol: a look-alike and a fake "USDGLO" stay apart (I-2)', () => {
    const real = fakeAddress(81)
    const lookAlike = `${real.slice(0, 6)}${'f'.repeat(32)}${real.slice(-4)}` // the same short address
    expect(short(lookAlike)).toBe(short(real))
    const flows = flowsOf(readWith([
      transfer(SAFE, fakeAddress(19), '1000000000000000000'), transfer(SAFE, `${fakeAddress(19).slice(0, 6)}${'e'.repeat(32)}${fakeAddress(19).slice(-4)}`, '1000000000000000000'),
      transfer(real, SAFE, '1000000000000000000'), transfer(real, SAFE, '9000000000000000000', 'USDGLO', 18, fakeAddress(93)),
      transfer(real, SAFE, '0'), // a zero amount is not a flow
    ]), [], names)
    expect(flows.map(f => [f.from, f.to, f.value, f.unit])).toEqual([
      ['Treasury', short(fakeAddress(19)), '1', 'USDGLO'], ['Treasury', short(fakeAddress(19)), '1', 'USDGLO'],
      ['Ops wallet', 'Treasury', '1', 'USDGLO'], ['Ops wallet', 'Treasury', '9', 'USDGLO'],
    ])
  })

  it('knows the Safe by its address in any case, and leaves out what is not its own flow', () => {
    const flows = flowsOf(readWith([
      transfer(fakeAddress(81), SAFE.toLowerCase(), '1000000000000000000'),
      transfer(fakeAddress(81), fakeAddress(72), '1000000000000000000'), // between two others
      transfer(SAFE, SAFE, '1000000000000000000'), // to itself
      { ...transfer(fakeAddress(81), SAFE, '1.5'), value: '1.5' }, // not base units
    ]), [], names)
    expect(flows).toEqual([{ from: 'Ops wallet', to: 'Treasury', value: '1', unit: 'USDGLO', status: 'executed' }])
  })

  it('adds the prepared calls that wait on signers, never an executed one or one that moves nothing', () => {
    const flows = flowsOf(readWith([]), [
      prepared(fakeAddress(72), '1271000000000000000000'), prepared(fakeAddress(72), '29000000000000000000'),
      prepared(fakeAddress(72), '5000000000000000000', 'executed'), prepared(fakeAddress(19), '0'),
    ], names)
    expect(flows).toEqual([{ from: 'Treasury', to: 'Network Projects', value: '1300', unit: 'CELO', status: 'prepared' }])
  })

  it('a read with no transfers, a failed read or none at all draws only what is prepared', () => {
    const waiting = [prepared(fakeAddress(19), '1000000000000000000')]
    const expected = [{ from: 'Treasury', to: short(fakeAddress(19)), value: '1', unit: 'CELO', status: 'prepared' }]
    expect(flowsOf(readWith(null), waiting, names)).toEqual(expected)
    expect(flowsOf({ ...TREASURY_READ, ok: false }, waiting, names)).toEqual(expected)
    expect(flowsOf(null, waiting, names)).toEqual(expected)
    expect(flowsOf(null, [])).toEqual([])
  })
})

describe('transfersOf', () => {
  it('is the read\'s list, [] for a quiet window, null when they were not read', () => {
    expect(transfersOf(TREASURY_READ)).toHaveLength(3)
    expect(transfersOf(readWith([]))).toEqual([])
    expect(transfersOf(readWith(null))).toBeNull()
    expect(transfersOf({ ...TREASURY_READ, ok: false })).toBeNull()
    expect(transfersOf(null)).toBeNull()
  })
})
