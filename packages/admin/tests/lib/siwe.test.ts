// packages/admin/tests/lib/siwe.test.ts
//
// EIP-4361 message and EIP-191 recovery, held to published vectors (no network).
//  EIP-4361 example message, https://eips.ethereum.org/EIPS/eip-4361 ("Example message")
//  hashMessage("Hello World") = 0xa1de9886...78f2, https://docs.ethers.org/v5/api/utils/hashing/#utils-hashMessage
//  secret key 1 -> 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf, the well-known first Ethereum test key
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { buildSiweMessage, parseSiweMessage, personalHash, recoverAddress, newNonce, NONCE_TTL_MS } from '../../lib/siwe.mjs'
import { keccak256 } from '../../lib/keccak.mjs'
import { checksumAddress } from '../../lib/caip.mjs'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const EXAMPLE = [
  'service.org wants you to sign in with your Ethereum account:',
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  '',
  'I accept the ServiceOrg Terms of Service: https://service.org/tos',
  '',
  'URI: https://service.org/login',
  'Version: 1',
  'Chain ID: 1',
  'Nonce: 32891756',
  'Issued At: 2021-09-30T16:25:24Z',
  'Resources:',
  '- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/',
  '- https://example.com/my-web2-claim.json',
].join('\n')
const FIELDS = {
  domain: 'service.org', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  statement: 'I accept the ServiceOrg Terms of Service: https://service.org/tos',
  uri: 'https://service.org/login', version: '1' as const, chainId: 1, nonce: '32891756', issuedAt: '2021-09-30T16:25:24Z',
  resources: ['ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/', 'https://example.com/my-web2-claim.json'],
}
const addressOfKey = (sk: Uint8Array) => checksumAddress('0x' + hex(keccak256(secp256k1.getPublicKey(sk, false).slice(1)).slice(12)))
const sign = (sk: Uint8Array, text: string, v = 27) => {
  const raw = secp256k1.sign(personalHash(text), sk, { prehash: false, format: 'recovered' }) // recovery byte first
  return '0x' + hex(raw.slice(1)) + (raw[0] + v).toString(16).padStart(2, '0')
}
const N = secp256k1.Point.Fn.ORDER

describe('siwe', () => {
  it('builds the EIP-4361 example message byte for byte', () => {
    expect(buildSiweMessage(FIELDS)).toBe(EXAMPLE)
  })
  it('puts Expiration Time after Issued At when given, and omits it otherwise', () => {
    const m = buildSiweMessage({ ...FIELDS, resources: undefined, expirationTime: '2021-09-30T16:35:24Z' })
    expect(m.endsWith('Issued At: 2021-09-30T16:25:24Z\nExpiration Time: 2021-09-30T16:35:24Z')).toBe(true)
    expect(buildSiweMessage({ ...FIELDS, resources: undefined }).endsWith('Issued At: 2021-09-30T16:25:24Z')).toBe(true)
  })
  it('parses what it builds', () => {
    expect(parseSiweMessage(EXAMPLE)).toEqual(FIELDS)
    const f = { ...FIELDS, resources: undefined, expirationTime: '2021-09-30T16:35:24Z' }
    expect(parseSiweMessage(buildSiweMessage(f))).toEqual({ ...f })
    expect(parseSiweMessage('nonsense')).toHaveProperty('error')
  })
  it('personalHash matches the published EIP-191 vector', () => {
    expect(hex(personalHash('Hello World'))).toBe('a1de988600a42c4b4ab089b619297c17d53cffae5d5120d82d8a92d0bb3b78f2')
  })
  it('derives the well-known address of secret key 1 (the address helper is independent of recoverAddress)', () => {
    const sk = new Uint8Array(32); sk[31] = 1
    expect(addressOfKey(sk)).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')
    expect(recoverAddress(EXAMPLE, sign(sk, EXAMPLE))).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')
  })
  it('recovers the signer of a signature made with a generated key, v 27/28 and 0/1', () => {
    const sk = secp256k1.utils.randomSecretKey()
    const want = addressOfKey(sk)
    expect(recoverAddress(EXAMPLE, sign(sk, EXAMPLE, 27))).toBe(want)
    expect(recoverAddress(EXAMPLE, sign(sk, EXAMPLE, 0))).toBe(want)
    expect(recoverAddress(EXAMPLE, sign(sk, EXAMPLE, 27).toUpperCase().replace('0X', '0x'))).toBe(want)
  })
  it('does not recover the signer for a different message', () => {
    const sk = secp256k1.utils.randomSecretKey()
    expect(recoverAddress(EXAMPLE + 'x', sign(sk, EXAMPLE))).not.toBe(addressOfKey(sk))
  })
  it('answers null for 64-byte, 66-byte, non-hex and bad-v signatures', () => {
    const sk = secp256k1.utils.randomSecretKey()
    const ok = sign(sk, EXAMPLE)
    expect(recoverAddress(EXAMPLE, ok.slice(0, 2 + 128))).toBeNull()
    expect(recoverAddress(EXAMPLE, ok + '00')).toBeNull()
    expect(recoverAddress(EXAMPLE, '0x' + 'zz'.repeat(65))).toBeNull()
    expect(recoverAddress(EXAMPLE, ok.slice(0, -2) + '1d')).toBeNull()
    expect(recoverAddress(EXAMPLE, ok.slice(2))).toBeNull()
  })
  it('answers null for a high-s signature (EIP-2)', () => {
    const sk = secp256k1.utils.randomSecretKey()
    const ok = sign(sk, EXAMPLE, 0)
    const s = BigInt('0x' + ok.slice(66, 130))
    const high = (N - s).toString(16).padStart(64, '0')
    const flipped = ok.slice(0, 66) + high + (1 - parseInt(ok.slice(130), 16)).toString(16).padStart(2, '0')
    expect(recoverAddress(EXAMPLE, flipped)).toBeNull()
  })
  it('newNonce is 22 alphanumeric characters and differs each call', () => {
    const a = newNonce(), b = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9]{22}$/)
    expect(a).not.toBe(b)
    expect(NONCE_TTL_MS).toBe(600_000)
  })
  it('imports nothing from node:*, so the client may import it (L5 Task 19)', () => {
    const text = readFileSync(fileURLToPath(new URL('../../lib/siwe.mjs', import.meta.url)), 'utf8')
    expect(text.match(/from\s+['"]node:[^'"]+['"]/g) ?? []).toEqual([])
    expect(text).not.toMatch(/require\(\s*['"]node:/)
  })
  it('newNonce draws its 16 bytes from globalThis.crypto.getRandomValues', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    try {
      expect(newNonce()).toMatch(/^[A-Za-z0-9]{22}$/)
      expect(spy).toHaveBeenCalledTimes(1)
      expect((spy.mock.calls[0]![0] as Uint8Array).length).toBe(16)
    } finally { spy.mockRestore() }
  })
})
