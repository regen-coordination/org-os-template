// packages/admin/tests/lib/deploy.encode.test.ts
//
// Selectors are the cited signatures' keccak-256 prefixes:
//   createProxyWithNonce(address,bytes,uint256) = 0x1688f0b9 (SafeProxyFactory 1.4.1), enableModule(address) = 0x610b5925,
//   setGuard(address) = 0xe19a9dd9 (Safe 1.4.1 ModuleManager / GuardManager).
// SetupParams: hats-zodiac v2.0.0 src/interfaces/IHatsSignerGate.sol (there is no src/lib/HSGLib.sol at that tag):
//   https://github.com/Hats-Protocol/hats-zodiac/blob/v2.0.0/src/interfaces/IHatsSignerGate.sol
import { describe, it, expect } from 'vitest'
import {
  safeInitializer, createSafeCall, mintTopHatCall, createHatsCall, mintHatsCall,
  gateInitializer, deployGateCall, wireGateCall, claimSignersCall,
} from '../../lib/deploy/encode.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { HATS_V1 } from '../../lib/hats.mjs'
import { selector, decodeResult } from '../../lib/abi.mjs'

const CHAIN = 'eip155:11155111'
const D = DEPLOYMENTS[CHAIN]
const a1 = '0x00000000000000000000000000000000000000a1'
const a2 = '0x00000000000000000000000000000000000000a2'
const SAFE = '0x0000000000000000000000000000000000005afe'
const GATE = '0x00000000000000000000000000000000000000a9'
const lower = (xs: unknown) => (xs as string[]).map((x) => x.toLowerCase())
const body = (data: string) => '0x' + data.slice(10)
const HAT = '0x0000000100000000000000000000000000000000000000000000000000000000'
const HAT2 = '0x0000000100010000000000000000000000000000000000000000000000000000'

describe('the Hats address', () => {
  it('DEPLOYMENTS and lib/hats.mjs agree on Sepolia (P11)', () => { expect(D.hats.address).toBe(HATS_V1) })
})

describe('safeInitializer / createSafeCall', () => {
  it('encodes setup(address[],uint256,address,bytes,address,address,uint256,address)', () => {
    const init = safeInitializer([a1, a2], 2, D.safe.fallbackHandler)
    expect(init.slice(0, 10)).toBe(selector('setup(address[],uint256,address,bytes,address,address,uint256,address)'))
    const r = decodeResult(['address[]', 'uint256', 'address', 'bytes', 'address', 'address', 'uint256', 'address'], body(init))
    expect(lower(r[0])).toEqual([a1, a2])
    expect(r[1]).toBe('2')
    expect(r[2]).toBe('0x0000000000000000000000000000000000000000') // `to`: no setup delegatecall
    expect(r[3]).toBe('0x')
    expect(r[4]).toBe(D.safe.fallbackHandler) // fallbackHandler is the fifth argument
    expect(r[5]).toBe('0x0000000000000000000000000000000000000000')
    expect(r[6]).toBe('0')
    expect(r[7]).toBe('0x0000000000000000000000000000000000000000')
  })
  it('reproduces the initializer bytes of a real Sepolia Safe 1.4.1 (tx 0x8c10d1f5ab10e9d6e9a7e907e3dba38e9fa841fd938f2f202a2d50d40c76c170, https://eth-sepolia.blockscout.com/tx/0x8c10d1f5ab10e9d6e9a7e907e3dba38e9fa841fd938f2f202a2d50d40c76c170)', () => {
    expect(safeInitializer(['0x3bb655A54cC4D66aebCd8d0F71Cf59c2aA15339F'], 1, D.safe.fallbackHandler)).toBe('0xb63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec9900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000003bb655a54cc4d66aebcd8d0f71cf59c2aa15339f0000000000000000000000000000000000000000000000000000000000000000')
  })
  it('createProxyWithNonce(singletonL2, initializer, salt) goes to the proxy factory as a call', () => {
    const c = createSafeCall(CHAIN, [a1, a2], 2, '7')
    expect(c.to).toBe(`${CHAIN}:${D.safe.proxyFactory}`)
    expect(c.value).toBe('0')
    expect(c.operation).toBe(0)
    expect(c.data.slice(0, 10)).toBe('0x1688f0b9')
    const r = decodeResult(['address', 'bytes', 'uint256'], body(c.data))
    expect(r[0]).toBe(D.safe.singletonL2)
    expect(r[1]).toBe(safeInitializer([a1, a2], 2, D.safe.fallbackHandler))
    expect(r[2]).toBe('7')
  })
  it('refuses a threshold outside 1..owners', () => {
    expect(() => safeInitializer([a1], 2, D.safe.fallbackHandler)).toThrow(/threshold/)
    expect(() => safeInitializer([a1], 0, D.safe.fallbackHandler)).toThrow(/threshold/)
  })
})

describe('Hats calls', () => {
  it('mintTopHatCall', () => {
    const c = mintTopHatCall(CHAIN, SAFE, 'ipfs://d', 'ipfs://i')
    expect(c.to).toBe(`${CHAIN}:${D.hats.address}`)
    expect(c.data.slice(0, 10)).toBe(selector('mintTopHat(address,string,string)'))
    expect(decodeResult(['address', 'string', 'string'], body(c.data)).map((x, i) => (i ? x : String(x).toLowerCase()))).toEqual([SAFE, 'ipfs://d', 'ipfs://i'])
    expect(c.operation).toBe(0)
    expect(c.value).toBe('0')
  })
  it('createHatsCall encodes batchCreateHats in the signature order', () => {
    const c = createHatsCall(CHAIN, [
      { admin: HAT, details: 'd1', maxSupply: 3, eligibility: SAFE, toggle: SAFE, mutable: true, image: 'i1' },
      { admin: HAT2, details: 'd2', maxSupply: 1, eligibility: SAFE, toggle: SAFE, mutable: false, image: '' },
    ])
    expect(c.data.slice(0, 10)).toBe(selector('batchCreateHats(uint256[],string[],uint32[],address[],address[],bool[],string[])'))
    const r = decodeResult(['uint256[]', 'string[]', 'uint32[]', 'address[]', 'address[]', 'bool[]', 'string[]'], body(c.data))
    expect(r[0]).toEqual([BigInt(HAT).toString(), BigInt(HAT2).toString()])
    expect(r[1]).toEqual(['d1', 'd2'])
    expect(r[2]).toEqual(['3', '1'])
    expect(lower(r[3])).toEqual([SAFE, SAFE])
    expect(lower(r[4])).toEqual([SAFE, SAFE])
    expect(r[5]).toEqual([true, false])
    expect(r[6]).toEqual(['i1', ''])
  })
  it('mintHatsCall encodes batchMintHats', () => {
    const c = mintHatsCall(CHAIN, [{ hat: HAT2, wearer: a1 }, { hat: HAT2, wearer: a2 }])
    expect(c.data.slice(0, 10)).toBe(selector('batchMintHats(uint256[],address[])'))
    const r = decodeResult(['uint256[]', 'address[]'], body(c.data))
    expect(r[0]).toEqual([BigInt(HAT2).toString(), BigInt(HAT2).toString()])
    expect(lower(r[1])).toEqual([a1, a2])
  })
})

describe('gateInitializer / deployGateCall', () => {
  const P = { ownerHat: HAT, signerHats: [HAT2], safe: SAFE, threshold: { type: 'proportional' as const, min: 1, target: 6667 }, locked: false as const, claimableFor: true }
  const SETUP = '(uint256,uint256[],address,(uint8,uint120,uint120),bool,bool,address,address,address[])'
  it('encodes setUp(bytes) around SetupParams in the struct field order of hats-zodiac v2.0.0', () => {
    const init = gateInitializer(P)
    expect(init.slice(0, 10)).toBe(selector('setUp(bytes)'))
    const [inner] = decodeResult(['bytes'], body(init))
    const [t] = decodeResult([SETUP], inner as string) as unknown[][]
    expect(t[0]).toBe(BigInt(HAT).toString())
    expect(t[1]).toEqual([BigInt(HAT2).toString()])
    expect((t[2] as string).toLowerCase()).toBe(SAFE)
    expect(t[3]).toEqual(['1', '1', '6667'])
    expect(t[4]).toBe(false)
    expect(t[5]).toBe(true)
    expect(t[6]).toBe(D.hsg.implementation)
    expect(t[7]).toBe('0x0000000000000000000000000000000000000000')
    expect(t[8]).toEqual([])
  })
  it('an absolute threshold is type 0', () => {
    const [inner] = decodeResult(['bytes'], body(gateInitializer({ ...P, threshold: { type: 'absolute', min: 2, target: 3 } })))
    const [t] = decodeResult([SETUP], inner as string) as unknown[][]
    expect(t[3]).toEqual(['0', '2', '3'])
  })
  it('deployGateCall is ModuleProxyFactory.deployModule(implementation, initializer, salt)', () => {
    const init = gateInitializer(P)
    const c = deployGateCall(CHAIN, init, '9')
    expect(c.to).toBe(`${CHAIN}:${D.hsg.moduleProxyFactory}`)
    expect(c.data.slice(0, 10)).toBe(selector('deployModule(address,bytes,uint256)'))
    const r = decodeResult(['address', 'bytes', 'uint256'], body(c.data))
    expect(r).toEqual([D.hsg.implementation, init, '9'])
  })
})

describe('wireGateCall', () => {
  it('selectors', () => {
    expect(selector('enableModule(address)')).toBe('0x610b5925')
    expect(selector('setGuard(address)')).toBe('0xe19a9dd9')
  })
  it('is operation 1 to MultiSendCallOnly, with inner calls (operation 0) to the Safe', () => {
    const c = wireGateCall(CHAIN, SAFE, GATE)
    expect(c.operation).toBe(1)
    expect(c.to).toBe(`${CHAIN}:${D.safe.multiSendCallOnly}`)
    expect(c.value).toBe('0')
    expect(c.data.slice(0, 10)).toBe('0x8d80ff0a')
    const [packed] = decodeResult(['bytes'], body(c.data)) as string[]
    const hex = packed.slice(2)
    const pad = (s: string) => s.padStart(64, '0')
    const enable = '610b5925' + pad(GATE.slice(2))
    const guard = 'e19a9dd9' + pad(GATE.slice(2))
    const one = (d: string) => '00' + SAFE.slice(2) + pad('0') + pad((d.length / 2).toString(16)) + d
    expect(hex).toBe(one(enable) + one(guard))
  })
  it('asserts every inner transaction is operation 0 when the target is MultiSendCallOnly', async () => {
    const { assertCallOnlyInner } = await import('../../lib/deploy/encode.mjs')
    expect(() => assertCallOnlyInner([{ operation: 1, to: SAFE, value: '0', data: '0x' }])).toThrow(/MultiSendCallOnly/)
    expect(() => assertCallOnlyInner([{ operation: 0, to: SAFE, value: '0', data: '0x' }])).not.toThrow()
  })
})

describe('claimSignersCall', () => {
  it('encodes claimSignersFor(uint256[],address[]) at the gate', () => {
    const c = claimSignersCall(CHAIN, GATE, [HAT2, HAT2], [a1, a2])
    expect(c.to.toLowerCase()).toBe(`${CHAIN}:${GATE}`)
    expect(c.data.slice(0, 10)).toBe(selector('claimSignersFor(uint256[],address[])'))
    const r = decodeResult(['uint256[]', 'address[]'], body(c.data))
    expect(r[0]).toEqual([BigInt(HAT2).toString(), BigInt(HAT2).toString()])
    expect(lower(r[1])).toEqual([a1, a2])
  })
  it('refuses unequal lists', () => {
    expect(() => claimSignersCall(CHAIN, GATE, [HAT2], [a1, a2])).toThrow(/same length/)
  })
})

describe('Sepolia only', () => {
  const OTHER = 'eip155:1'
  const S = 'Deploying is built for Sepolia (eip155:11155111) only.'
  it('every chain-taking encoder refuses another chain', () => {
    expect(() => createSafeCall(OTHER, [a1], 1, '1')).toThrow(S)
    expect(() => mintTopHatCall(OTHER, SAFE, '', '')).toThrow(S)
    expect(() => createHatsCall(OTHER, [])).toThrow(S)
    expect(() => mintHatsCall(OTHER, [])).toThrow(S)
    expect(() => deployGateCall(OTHER, '0x', '1')).toThrow(S)
    expect(() => wireGateCall(OTHER, SAFE, GATE)).toThrow(S)
    expect(() => claimSignersCall(OTHER, GATE, [], [])).toThrow(S)
  })
})
