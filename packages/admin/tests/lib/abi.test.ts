// packages/admin/tests/lib/abi.test.ts
//
// Published: Solidity ABI spec, "Examples", https://docs.soliditylang.org/en/v0.8.28/abi-spec.html#examples
// Published selector: Gardens v2 CVAdminFacet, "// Sig: 0xd5b7cc54",
//   https://github.com/1Hive/gardens-v2/blob/68cd18d8ace3cec4a5715c6d00f9a85369816033/pkg/contracts/src/CVStrategy/facets/CVAdminFacet.sol#L62
// Recorded: eth_call viewHat(0x0000000d00…00) on the Hats v1 contract, https://forno.celo.org, block 81343851, 2026-10-29.
//   A public contract's answer; it holds no name. Its words were also decoded by hand when the plan was written.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { selector, encodeArgs, encodeCall, decodeResult } from '../../lib/abi.mjs'

const VIEW_HAT_13 = '0x0000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000042697066733a2f2f6261666b726569666a6e6f773533676764346763667371763632346d716e6b676b7163356f6c75656535636e63706462686b377870686c3474336d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042697066733a2f2f6261666b726569646b7870346d34676b703376706f7133723470653774647071696e6765776471646e786c706f6d373536717267767a6e69756675000000000000000000000000000000000000000000000000000000000000'

describe('abi', () => {
  it('encodes baz(uint32,bool) with 69, true as the spec shows', () => {
    expect(encodeCall('baz(uint32,bool)', [69, true])).toBe('0xcdcd77c0'
      + '0000000000000000000000000000000000000000000000000000000000000045'
      + '0000000000000000000000000000000000000000000000000000000000000001')
  })
  it('encodes sam(bytes,bool,uint256[]) with "dave", true, [1,2,3] as the spec shows', () => {
    expect(encodeCall('sam(bytes,bool,uint256[])', ['0x64617665', true, [1, 2, 3]])).toBe('0xa5643bf2'
      + '0000000000000000000000000000000000000000000000000000000000000060'
      + '0000000000000000000000000000000000000000000000000000000000000001'
      + '00000000000000000000000000000000000000000000000000000000000000a0'
      + '0000000000000000000000000000000000000000000000000000000000000004'
      + '6461766500000000000000000000000000000000000000000000000000000000'
      + '0000000000000000000000000000000000000000000000000000000000000003'
      + '0000000000000000000000000000000000000000000000000000000000000001'
      + '0000000000000000000000000000000000000000000000000000000000000002'
      + '0000000000000000000000000000000000000000000000000000000000000003')
  })
  it('gives the selector Gardens publishes for setPoolParams with two static tuples', () => {
    expect(selector('setPoolParams((address,address,uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256),uint256,address[],address[],address)')).toBe('0xd5b7cc54')
  })
  it('decodes a recorded viewHat answer', () => {
    expect(decodeResult(['string', 'uint32', 'uint32', 'address', 'address', 'string', 'uint16', 'bool', 'bool'], VIEW_HAT_13)).toEqual([
      'ipfs://bafkreifjnow53ggd4gcfsqv624mqnkgkqc5oluee5cncpdbhk7xphl4t3m', '1', '1',
      '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000',
      'ipfs://bafkreidkxp4m4gkp3vpoq3r4pe7tdpqingewdqdnxlpom756qrgvzniufu', '3', false, true])
  })
  it('round-trips address[] and a static tuple; refuses an unsupported type, a uint out of range and a short answer', () => {
    const a1 = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const a2 = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'
    expect(decodeResult(['address[]'], encodeArgs(['address[]'], [[a1, a2.toLowerCase()]]))).toEqual([[a1, a2]])
    expect(decodeResult(['(address,uint256)'], encodeArgs(['(address,uint256)'], [[a1, '12345678901234567890123']]))).toEqual([[a1, '12345678901234567890123']])
    expect(() => encodeArgs(['int256'], [1])).toThrow(/not supported/)
    expect(() => encodeArgs(['uint8'], [256])).toThrow(/argument 0/)
    expect(() => encodeArgs(['bool', 'uint8'], [true, 256])).toThrow(/argument 1/)
    expect(() => decodeResult(['uint256'], '0x12')).toThrow(/too short/)
  })
  it('imports nothing from node:', () => { expect(readFileSync(new URL('../../lib/abi.mjs', import.meta.url), 'utf8')).not.toMatch(/from 'node:/) })
})
