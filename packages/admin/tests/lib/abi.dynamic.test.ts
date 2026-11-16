// packages/admin/tests/lib/abi.dynamic.test.ts
//
// Published: Solidity ABI spec v0.8.26, "Use of Dynamic Types" and "Examples" (read 2026-10-30),
// https://docs.soliditylang.org/en/v0.8.26/abi-spec.html#use-of-dynamic-types
//   f(uint256,uint32[],bytes10,bytes) with (0x123, [0x456, 0x789], "1234567890", "Hello, world!") -> selector 0x8be65246
//   g(uint256[][],string[]) with ([[1, 2], [3]], ["one", "two", "three"]) -> selector 0x2289b18c, the 20 words of its walk-through
import { describe, it, expect } from 'vitest'
import { encodeCall, encodeArgs, decodeResult } from '../../lib/abi.mjs'
import { checksumAddress } from '../../lib/caip.mjs'

const w = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0')
const pad = (hex: string) => hex.padEnd(64, '0')

describe('abi dynamic types', () => {
  it('encodes f(uint256,uint32[],bytes10,bytes) as the spec shows', () => {
    expect(encodeCall('f(uint256,uint32[],bytes10,bytes)', ['291', [0x456, 0x789], '0x31323334353637383930', '0x' + Buffer.from('Hello, world!').toString('hex')])).toBe('0x8be65246'
      + w('123') + w('80') + pad('31323334353637383930') + w('e0')
      + w('2') + w('456') + w('789')
      + w('d') + pad('48656c6c6f2c20776f726c6421'))
  })
  it('encodes g(uint256[][],string[]) as the spec shows (nested dynamic arrays)', () => {
    const words = [
      w('40'), w('140'),
      w('2'), w('40'), w('a0'), w('2'), w('1'), w('2'), w('1'), w('3'),
      w('3'), w('60'), w('a0'), w('e0'), w('3'), pad('6f6e65'), w('3'), pad('74776f'), w('5'), pad('7468726565'),
    ]
    // The walk-through lists the head's two offsets first, then the 18 words after them.
    expect(encodeCall('g(uint256[][],string[])', [[[1, 2], [3]], ['one', 'two', 'three']])).toBe('0x2289b18c' + words.join(''))
  })
  it('encodes string[] of one, two, three as the spec walk-through (offsets 0x60, 0xa0, 0xe0)', () => {
    expect(encodeArgs(['string[]'], [['one', 'two', 'three']])).toBe('0x' + [
      w('20'), w('3'), w('60'), w('a0'), w('e0'), w('3'), pad('6f6e65'), w('3'), pad('74776f'), w('5'), pad('7468726565'),
    ].join(''))
  })
  it('round-trips nested arrays and a string array through decodeResult', () => {
    const types = ['uint256[][]', 'string[]']
    const values = [[['1', '2'], ['3']], ['one', 'two', 'three']]
    expect(decodeResult(types, encodeArgs(types, values))).toEqual(values)
  })
  it('round-trips a dynamic tuple (the shape of a HatsSignerGate v2 SetupParams)', () => {
    const t = '(uint256,uint256[],address,(uint8,uint120,uint120),bool,bool,address,address,address[])'
    const a = (n: number) => checksumAddress('0x' + n.toString(16).padStart(40, '0'))
    const v = ['4', ['5', '6', '7'], a(0x5afe), ['1', '2', '3'], false, true, a(0xa1), a(0xa2), [a(0xa3), a(0xa4)]]
    // The tuple is dynamic, so the head is one offset (0x40), then the trailing uint8.
    const enc = encodeArgs([t, 'uint8'], [v, 9])
    expect(enc.slice(0, 2 + 64)).toBe('0x' + w('40'))
    expect(decodeResult([t, 'uint8'], enc)).toEqual([v, '9'])
    // an array of dynamic tuples works too
    const u = '(uint256,string)[]'
    const uv = [['1', 'one'], ['2', 'two']]
    expect(decodeResult([u], encodeArgs([u], [uv]))).toEqual([uv])
  })
})
