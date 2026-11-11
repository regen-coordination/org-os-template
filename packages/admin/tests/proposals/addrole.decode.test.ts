// The gaps review's M-1 (PF-R234 tightened): with no watch, a Safe transaction that calls Hats v1 at all (directly, or in
// any inner call, whatever the selector) and is not exactly the add-role bundle reads as a mismatch in words; so does a
// delegatecall to anything but MultiSendCallOnly 1.4.1, which could do the same out of sight. A transaction that calls
// neither is the Safe's reading (null). M-2: the bundle's createHat carries what prepare writes for add-role (non-zero
// eligibility and toggle, room for every first wearer). Pure: the repository is never read for these.
import { describe, it, expect } from 'vitest'
import { encodeCall, selector } from '../../lib/abi.mjs'
import { encodeMultiSend } from '../../lib/multisend.mjs'
import { HATS_SIGNATURES, HATS_V1, childHatId, topHatId } from '../../lib/hats.mjs'
import { multiSendCallOnlyOn } from '../../lib/deployments.mjs'
import { addRoleOf } from '../../server/proposals/watches.ts'

const SEPOLIA = 'eip155:11155111'
const CALL_ONLY = multiSendCallOnlyOn(SEPOLIA)!
const MULTI_SEND_141 = '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526'
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const TOP = topHatId('0x0000002a'), COUNCIL = childHatId(TOP, 1)
const createHat = (admin: string, o: { supply?: number; eligibility?: string; toggle?: string } = {}) =>
  encodeCall(HATS_SIGNATURES.createHat, [BigInt(admin), 'Stewards', o.supply ?? 2, o.eligibility ?? A(7), o.toggle ?? A(8), true, ''])
const mint = (ids: string[], wearers: string[]) => encodeCall(HATS_SIGNATURES.batchMintHats, [ids.map(i => BigInt(i)), wearers])
const bundle = (inner: { to: string; data: string }[]) =>
  ({ to: CALL_ONLY, operation: 1, data: encodeMultiSend(inner.map(c => ({ operation: 0, to: c.to, value: '0', data: c.data }))) })
const refused = (r: unknown) => expect(r).toMatchObject({ refused: expect.stringMatching(/the Hub cannot read it as one new role: /) })

describe('with no watch, any call to Hats that is not the add-role bundle is a mismatch (M-1)', () => {
  it('a direct createHat (probe P3)', () => {
    refused(addRoleOf('/nonexistent', SEPOLIA, { to: HATS_V1, operation: 0, data: createHat(COUNCIL) }))
  })
  it('a direct mintHat, and a direct call to Hats with no data', () => {
    refused(addRoleOf('/nonexistent', SEPOLIA, { to: HATS_V1, operation: 0, data: encodeCall(HATS_SIGNATURES.mintHat, [BigInt(COUNCIL), A(1)]) }))
    refused(addRoleOf('/nonexistent', SEPOLIA, { to: HATS_V1, operation: 0, data: null }))
  })
  it('batchCreateHats in a MultiSendCallOnly bundle (probe P3)', () => {
    refused(addRoleOf('/nonexistent', SEPOLIA, bundle([{ to: HATS_V1, data: selector(HATS_SIGNATURES.batchCreateHats) + '00'.repeat(32) }])))
  })
  it('a bundle that mints a hat beside a plain transfer', () => {
    refused(addRoleOf('/nonexistent', SEPOLIA, bundle([{ to: A(5), data: '0x' }, { to: HATS_V1, data: mint([COUNCIL], [A(1)]) }])))
  })
  it('a delegatecall to MultiSend 1.4.1 (not CallOnly), whatever it holds', () => {
    const inner = encodeMultiSend([{ operation: 0, to: A(5), value: '0', data: '0x' }])
    refused(addRoleOf('/nonexistent', SEPOLIA, { to: MULTI_SEND_141, operation: 1, data: inner }))
  })
  it('a plain call that is not to Hats, and a CallOnly bundle that never calls Hats, are the Safe\'s reading', () => {
    expect(addRoleOf('/nonexistent', SEPOLIA, { to: A(5), operation: 0, data: '0x' })).toBeNull()
    expect(addRoleOf('/nonexistent', SEPOLIA, bundle([{ to: A(5), data: '0x' }, { to: A(6), data: '0x' }]))).toBeNull()
  })
})

describe('the createHat carries what prepare writes for add-role (M-2)', () => {
  const child = childHatId(COUNCIL, 1)
  for (const [what, o, why] of [
    ['a zero eligibility', { eligibility: `0x${'0'.repeat(40)}` }, /names the zero address as a module/],
    ['a zero toggle', { toggle: `0x${'0'.repeat(40)}` }, /names the zero address as a module/],
    ['no room for every first wearer', { supply: 1 }, /makes room for 1, and it mints to 2/],
  ] as const) {
    it(what, () => {
      const r = addRoleOf('/nonexistent', SEPOLIA, bundle([{ to: HATS_V1, data: createHat(COUNCIL, o) }, { to: HATS_V1, data: mint([child, child], [A(1), A(2)]) }]))
      refused(r)
      expect((r as { refused: string }).refused).toMatch(why)
    })
  }
})
