// packages/admin/tests/lib/multisend.test.ts
//
// Format: safe-smart-account contracts/libraries/MultiSendCallOnly.sol at v1.4.1 (read 2026-10-30),
// https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/libraries/MultiSendCallOnly.sol
//   "Each transaction is encoded as a packed bytes of operation (1 byte), to (20 bytes), value (32 bytes),
//    data length (32 bytes), data", wrapped in multiSend(bytes) whose selector is 0x8d80ff0a.
import { describe, it, expect } from 'vitest'
import { decodeMultiSend, encodeMultiSend } from '../../lib/multisend.mjs'
import { encodeCall, selector } from '../../lib/abi.mjs'

const A1 = '0x00000000000000000000000000000000000000a1'
const A2 = '0x00000000000000000000000000000000000000a2'
const w = (n: number) => n.toString(16).padStart(64, '0')

describe('encodeMultiSend', () => {
  it('uses the selector multiSend(bytes) = 0x8d80ff0a', () => { expect(selector('multiSend(bytes)')).toBe('0x8d80ff0a') })
  it('packs two calls as operation ‖ to ‖ value ‖ dataLength ‖ data and wraps them in multiSend(bytes)', () => {
    const tx1 = '00' + A1.slice(2) + w(0) + w(4) + 'deadbeef'
    const tx2 = '00' + A2.slice(2) + w(1000) + w(0)
    const packed = tx1 + tx2
    const bytes = packed.length / 2
    const padded = packed + '00'.repeat((32 - (bytes % 32)) % 32)
    expect(encodeMultiSend([
      { operation: 0, to: A1, value: '0', data: '0xdeadbeef' },
      { operation: 0, to: A2, value: '1000', data: '0x' },
    ])).toBe('0x8d80ff0a' + w(32) + w(bytes) + padded)
  })
  it('encodes a delegatecall as operation 01 (MultiSend accepts it; MultiSendCallOnly reverts on it)', () => {
    const out = encodeMultiSend([{ operation: 1, to: A1, value: '0', data: '0x' }])
    expect(out.slice(10 + 128, 10 + 130)).toBe('01')
  })
  it('encodes an empty batch and refuses malformed transactions', () => {
    expect(encodeMultiSend([])).toBe('0x8d80ff0a' + w(32) + w(0))
    expect(() => encodeMultiSend([{ operation: 2 as 0, to: A1, value: '0', data: '0x' }])).toThrow(/operation/)
    expect(() => encodeMultiSend([{ operation: 0, to: 'nope', value: '0', data: '0x' }])).toThrow(/address/)
    expect(() => encodeMultiSend([{ operation: 0, to: A1, value: '-1', data: '0x' }])).toThrow(/value/)
    expect(() => encodeMultiSend([{ operation: 0, to: A1, value: '0', data: '0xabc' }])).toThrow(/data/)
  })
})

// L7 gap B2: an add-role's bundle is read back at check time.
describe('decodeMultiSend', () => {
  it('reads back what encodeMultiSend packed, each transaction whole', () => {
    const txs = [
      { operation: 0 as const, to: A1, value: '0', data: '0xdeadbeef' },
      { operation: 1 as const, to: A2, value: '250000000000000000', data: '0x' },
    ]
    const back = decodeMultiSend(encodeMultiSend(txs))
    expect(back.map(t => ({ ...t, to: t.to.toLowerCase() }))).toEqual(txs)
  })

  it('refuses what is not multiSend(bytes), a cut transaction, a bad operation and an empty bundle', () => {
    expect(() => decodeMultiSend('0x12345678')).toThrow(/not a multiSend\(bytes\) call/)
    const one = '00' + A1.slice(2) + '0'.repeat(64) + (4).toString(16).padStart(64, '0') + 'dead'
    expect(() => decodeMultiSend(encodeCall('multiSend(bytes)', ['0x' + one]))).toThrow(/cut short/)
    const two = '02' + A1.slice(2) + '0'.repeat(64) + '0'.repeat(64)
    expect(() => decodeMultiSend(encodeCall('multiSend(bytes)', ['0x' + two]))).toThrow(/operation 2/)
    expect(() => decodeMultiSend(encodeCall('multiSend(bytes)', ['0x']))).toThrow(/nothing is packed/)
  })
})
