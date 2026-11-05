// packages/admin/tests/lib/keccak.test.ts
//
// Task 12a: Keccak-256 written in the repository, held to values it did not compute itself.
// Sources (the tests never touch the network):
//  - Keccak team known-answer tests, original Keccak padding (not FIPS-202), Keccak[r=1088,c=512]:
//    https://keccak.team/obsolete/KeccakKAT-3.zip, files KeccakKAT/ShortMsgKAT_256.txt (empty message,
//    Len = 0; Len = 24; Len = 1080, 1088, 1096 bits = 135, 136, 137 bytes) and
//    KeccakKAT/LongMsgKAT_256.txt (Len = 2048 bits = 256 bytes, longer than the 136-byte block).
//  - "abc": go-ethereum crypto/crypto_test.go, TestKeccak256Hash:
//    https://github.com/ethereum/go-ethereum/blob/master/crypto/crypto_test.go
//  - transfer(address,uint256) selector 0xa9059cbb:
//    https://docs.arbitrum.io/stylus-by-example/basic_examples/function_selector
//  - Safe constants DOMAIN_SEPARATOR_TYPEHASH and SAFE_TX_TYPEHASH (v1.4.1, contracts/Safe.sol):
//    https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { keccak256 } from '../../lib/keccak.mjs'

const enc = (s: string) => new TextEncoder().encode(s)
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16))

describe('keccak256 against published vectors', () => {
  it('the empty message (Keccak team KAT, Len = 0)', () => {
    expect(hex(keccak256(new Uint8Array(0)))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
  })
  it('"abc" (go-ethereum)', () => {
    expect(hex(keccak256(enc('abc')))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
  })
  it('a 3-byte message (Keccak team KAT, Len = 24)', () => {
    expect(hex(keccak256(bytes('1f877c')))).toBe('627d7bc1491b2ab127282827b8de2d276b13d7d70fb4c5957fdf20655bc7ac30')
  })
  it('transfer(address,uint256) has the selector a9059cbb', () => {
    expect(hex(keccak256(enc('transfer(address,uint256)'))).slice(0, 8)).toBe('a9059cbb')
  })
  it('the Safe typehashes, recomputed from their type strings', () => {
    expect(hex(keccak256(enc('EIP712Domain(uint256 chainId,address verifyingContract)')))).toBe(
      '47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218')
    expect(hex(keccak256(enc('SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)')))).toBe(
      'bb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8')
  })
  // The block is 136 bytes: 135 gets the single pad byte 0x81, 136 a whole extra block, 137 spills one byte.
  it('135 bytes (Keccak team KAT, Len = 1080)', () => {
    const m = bytes('b771d5cef5d1a41a93d15643d7181d2a2ef0a8e84d91812f20ed21f147bef732bf3a60ef4067c3734b85bc8cd471780f10dc9e8291b58339a677b960218f71e793f2797aea349406512829065d37bb55ea796fa4f56fd8896b49b2cd19b43215ad967c712b24e5032d065232e02c127409d2ed4146b9d75d763d52db98d949d3b0fed6a8052fbb')
    expect(m.length).toBe(135)
    expect(hex(keccak256(m))).toBe('bd6f5492582a7c1b116304de28314df9fffe95b0da11af52fe9440a717a34859')
  })
  it('136 bytes (Keccak team KAT, Len = 1088)', () => {
    const m = bytes('b32d95b0b9aad2a8816de6d06d1f86008505bd8c14124f6e9a163b5a2ade55f835d0ec3880ef50700d3b25e42cc0af050ccd1be5e555b23087e04d7bf9813622780c7313a1954f8740b6ee2d3f71f768dd417f520482bd3a08d4f222b4ee9dbd015447b33507dd50f3ab4247c5de9a8abd62a8decea01e3b87c8b927f5b08beb37674c6f8e380c04')
    expect(m.length).toBe(136)
    expect(hex(keccak256(m))).toBe('e717a7769448abbe5fef8187954a88ac56ded1d22e63940ab80d029585a21921')
  })
  it('137 bytes (Keccak team KAT, Len = 1096)', () => {
    const m = bytes('04410e31082a47584b406f051398a6abe74e4da59bb6f85e6b49e8a1f7f2ca00dfba5462c2cd2bfde8b64fb21d70c083f11318b56a52d03b81cac5eec29eb31bd0078b6156786da3d6d8c33098c5c47bb67ac64db14165af65b44544d806dde5f487d5373c7f9792c299e9686b7e5821e7c8e2458315b996b5677d926dac57b3f22da873c601016a0d')
    expect(m.length).toBe(137)
    expect(hex(keccak256(m))).toBe('a95d50b50b4545f0947441df74a1e9d74622eb3baa49c1bbfc3a0cce6619c1aa')
  })
  it('256 bytes, longer than one block (Keccak team LongMsgKAT, Len = 2048)', () => {
    const m = bytes('724627916c50338643e6996f07877eafd96bdf01da7e991d4155b9be1295ea7d21c9391f4c4a41c75f77e5d27389253393725f1427f57914b273ab862b9e31dabce506e558720520d33352d119f699e784f9e548ff91bc35ca147042128709820d69a8287ea3257857615eb0321270e94b84f446942765ce882b191faee7e1c87e0f0bd4e0cd8a927703524b559b769ca4ece1f6dbf313fdcf67c572ec4185c1a88e86ec11b6454b371980020f19633b6b95bd280e4fbcb0161e1a82470320cec6ecfa25ac73d09f1536f286d3f9dacafb2cd1d0ce72d64d197f5c7520b3ccb2fd74eb72664ba93853ef41eabf52f015dd591500d018dd162815cc993595b195')
    expect(m.length).toBe(256)
    expect(hex(keccak256(m))).toBe('ea0e416c0f7b4f11e3f00479fddf954f2539e5e557753bd546f69ee375a5de29')
  })
  it('returns 32 bytes', () => {
    const d = keccak256(enc('x'))
    expect(d).toBeInstanceOf(Uint8Array)
    expect(d.length).toBe(32)
  })
})

describe('why this file exists', () => {
  it('node:crypto sha3-256 of the empty input differs from keccak256 (the padding byte)', () => {
    const sha3 = createHash('sha3-256').update('').digest('hex')
    expect(sha3).not.toBe(hex(keccak256(new Uint8Array(0))))
  })
  it('node:crypto has no keccak256', () => {
    expect(() => createHash('keccak256')).toThrow()
  })
  it('the module imports nothing from node:*', () => {
    const src = readFileSync(new URL('../../lib/keccak.mjs', import.meta.url), 'utf8')
    expect(src).not.toMatch(/node:/)
    expect(src).not.toMatch(/^\s*import\s/m)
  })
})
