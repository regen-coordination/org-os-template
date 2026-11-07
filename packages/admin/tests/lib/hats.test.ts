// packages/admin/tests/lib/hats.test.ts
//
// Hat ids, hat and tree refs and Hats v1 calls, held to published vectors (no network).
//  Hats Protocol README, "Displaying Hat Ids",
//   https://github.com/Hats-Protocol/hats-protocol/blob/cccb71a061cdb9095af7d11dfdb47026993d8c4e/README.md#displaying-hat-ids
//  Hats v1 deployment table (same address on Celo, Sepolia and the others), https://github.com/Hats-Protocol/hats-protocol/releases/tag/v1
//  Signatures, https://github.com/Hats-Protocol/hats-protocol/blob/cccb71a061cdb9095af7d11dfdb47026993d8c4e/src/Interfaces/IHats.sol
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { encodeCall } from '../../lib/abi.mjs'
import { HATS_V1, HATS_SIGNATURES, VIEW_HAT_TYPES, treeIdOf, topHatId, hatLevel, adminOf, childHatId, prettyHatId, normalHatId, hatRef, parseHatRef, treeRef, parseTreeRef, inTree, hatsCall } from '../../lib/hats.mjs'

const README_DEC = '26960769438260605603848134863118277618512635038780455604427388092416'
const README_HEX = '0x0000000100020003000000000000000000000000000000000000000000000000'
const Z = (n: number) => '0'.repeat(n)

describe('hats', () => {
  it('reads the README\'s example id', () => {
    expect(normalHatId(README_DEC)).toBe(README_HEX)
    expect(hatLevel(README_HEX)).toBe(2)
    expect(adminOf(README_HEX)).toBe('0x0000000100020000000000000000000000000000000000000000000000000000')
    expect(prettyHatId(README_HEX)).toBe('0x00000001.0002.0003')
    expect(normalHatId('0x00000001.0002.0003')).toBe(README_HEX)
    expect(normalHatId(README_HEX.toUpperCase().replace('0X', '0x'))).toBe(README_HEX)
    expect(normalHatId('nope')).toBeNull()
    expect(normalHatId('0x1234')).toBeNull()
  })
  it('builds a tree\'s ids', () => {
    expect(topHatId(13)).toBe('0x0000000d' + Z(56)); expect(treeIdOf('0x0000000d')).toBe(13); expect(treeIdOf('13')).toBe(13)
    expect(treeIdOf('0xd')).toBe(13); expect(treeIdOf(13)).toBe(13)
    expect(childHatId(topHatId(13), 1)).toBe('0x0000000d0001' + Z(52)); expect(adminOf(topHatId(13))).toBeNull()
    expect(inTree(childHatId(topHatId(13), 3), 13)).toBe(true); expect(inTree(topHatId(14), 13)).toBe(false)
    for (const bad of [0, '0', 'x', '0x1000000000', -1, 4294967296]) expect(treeIdOf(bad)).toBeNull()
    expect(treeIdOf(4294967295)).toBe(4294967295)
    expect(prettyHatId(topHatId(13))).toBe('0x0000000d')
    expect(prettyHatId(childHatId(childHatId(topHatId(13), 1), 2))).toBe('0x0000000d.0001.0002')
    expect(() => childHatId(topHatId(13), 0)).toThrow(); expect(() => childHatId(topHatId(13), 65536)).toThrow()
  })
  it('reaches level 14 and no further', () => {
    let id = topHatId(1)
    for (let i = 1; i <= 14; i++) id = childHatId(id, i)
    expect(hatLevel(id)).toBe(14)
    expect(id).toBe('0x00000001' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => n.toString(16).padStart(4, '0')).join('') )
    expect(adminOf(id)).toBe('0x00000001' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => n.toString(16).padStart(4, '0')).join('') + '0000')
    expect(() => childHatId(id, 1)).toThrow('level 14')
  })
  it('publishes the v1 address and the signatures', () => {
    expect(HATS_V1).toBe('0x3bc1A0Ad72417f2d411118085256fC53CBdDd137')
    expect(HATS_SIGNATURES.mintHat).toBe('mintHat(uint256,address)')
    expect(Object.keys(HATS_SIGNATURES)).toHaveLength(9)
    expect(VIEW_HAT_TYPES).toHaveLength(9)
  })
  it('builds Hats calls to the v1 contract', () => {
    const c = hatsCall('eip155:42220', 'mintHat', [childHatId(topHatId(13), 1), '0x00000000000000000000000000000000000000a1'], 'mint')
    expect(c).toMatchObject({ chain: 'eip155:42220', to: 'eip155:42220:0x3bc1A0Ad72417f2d411118085256fC53CBdDd137', value: '0', operation: 0, summary: 'mint' })
    expect(c.data.slice(0, 10)).toBe('0x641f776e')
    expect(() => hatsCall('eip155:42220', 'burnHat' as never, [], 'x')).toThrow()
  })
  it('converts ids by the signature\'s uint256 positions only', () => {
    const A1 = '0x00000000000000000000000000000000000000a1'
    const full = '0x0000000d0001' + Z(52)
    const want = encodeCall('mintHat(uint256,address)', [BigInt(full), A1])
    const dec = BigInt(full).toString()
    for (const form of [full, full.toUpperCase().replace('0X', '0x'), '0x0000000d.0001', dec, 'eip155:42220:' + full]) {
      expect(hatsCall('eip155:42220', 'mintHat', [form, A1], 'm').data).toBe(want)
    }
    const hash = '0x' + 'ab'.repeat(32)
    expect(hatsCall('eip155:42220', 'changeHatDetails', [full, hash], 'd').data).toBe(encodeCall('changeHatDetails(uint256,string)', [BigInt(full), hash]))
    expect(() => hatsCall('eip155:42220', 'mintHat', ['eip155:1:' + full, A1], 'm')).toThrow('eip155:1')
    expect(() => hatsCall('eip155:42220', 'mintHat', ['nope', A1], 'm')).toThrow('not a hat id')
  })
  it('refuses ids that are malformed or have no tree', () => {
    expect(normalHatId('0x' + 'a'.repeat(65))).toBeNull()
    expect(normalHatId('-5')).toBeNull()
    expect(normalHatId('-0x1')).toBeNull()
    let id = topHatId(1)
    for (let i = 1; i <= 14; i++) id = childHatId(id, i)
    expect(prettyHatId(id)).toBe('0x00000001.' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => n.toString(16).padStart(4, '0')).join('.'))
    expect(() => hatRef('eip155:42220', '13')).toThrow('no tree id')
    expect(parseHatRef('eip155:42220:0x' + Z(64))).toBeNull()
  })
  it('hat refs', () => {
    const upper = '0x0000000D0001' + Z(52)
    const ref = hatRef('eip155:42220', upper)
    expect(ref).toBe('eip155:42220:0x0000000d0001' + Z(52))
    expect(parseHatRef(ref)).toEqual({ chain: 'eip155:42220', hatId: '0x0000000d0001' + Z(52) })
    expect(parseHatRef('eip155:42220:' + upper)?.hatId).toBe('0x0000000d0001' + Z(52))
    expect(parseHatRef('nope:42220:' + upper)).toBeNull()
    expect(parseHatRef('eip155:42220:0x0000000d0001' + Z(51))).toBeNull() // 63 digits
    expect(parseHatRef('eip155:42220:0x0000000d0001' + Z(53))).toBeNull() // 65 digits
    expect(() => hatRef('42220', upper)).toThrow()
    expect(() => hatRef('eip155:42220', '0x12')).toThrow()
    expect(parseHatRef(5)).toBeNull()
  })
  it('tree refs', () => {
    expect(treeRef('eip155:42220', 13)).toBe('eip155:42220:13')
    expect(treeRef('eip155:42220', '0x0000000d')).toBe('eip155:42220:13')
    expect(() => treeRef('42220', 13)).toThrow('CAIP-2')
    expect(() => treeRef('eip155:42220', 0)).toThrow('tree id')
    expect(parseTreeRef('eip155:42220:13')).toEqual({ chain: 'eip155:42220', treeId: 13 })
    expect(parseTreeRef('eip155:42220:0x0000000d')).toEqual({ chain: 'eip155:42220', treeId: 13 })
    for (const bad of ['eip155:42220', 'eip155:42220:0', 'eip155:42220:x', '42220:13', 'eip155:42220:0xd', 'eip155:42220:4294967296', 7, null]) expect(parseTreeRef(bad)).toBeNull()
  })
  it('imports nothing from node:', () => { expect(readFileSync(new URL('../../lib/hats.mjs', import.meta.url), 'utf8')).not.toMatch(/from 'node:/) })
})
