// packages/admin/tests/lib/caip.test.ts
//
// CAIP-2, CAIP-10 (eip155) and EIP-55, held to published vectors (no network).
//  EIP-55 test cases, https://eips.ethereum.org/EIPS/eip-55 ("Test Cases": all caps, all lower, normal)
//  CAIP-10 eip155 test cases, https://github.com/ChainAgnostic/namespaces/blob/463bae5625aaa8c184ccc74f1db457da8a43e72b/eip155/caip10.md#test-cases
//  CAIP-2 test cases, https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md#test-cases
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checksumAddress, isAddress, parseCaip2, parseCaip10, caip10, addressOf, sameAccount } from '../../lib/caip.mjs'

describe('caip', () => {
  it('gives the EIP-55 checksum of every published test address', () => {
    for (const a of ['0x52908400098527886E0F7030069857D2E4169EE7', '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
      '0xde709f2102306220921060314715629080e2fb77', '0x27b1fdb04752bbc536007a920d24acb045561c26',
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) {
      expect(checksumAddress(a.toLowerCase())).toBe(a)
    }
  })
  it('parses the published CAIP-10 cases: checksummed and lowercase accepted, a failed checksum refused', () => {
    expect(parseCaip10('eip155:1:0x22227A31dd842196A246d8f3b775998560eAa61d')).toEqual({ chain: 'eip155:1', address: '0x22227A31dd842196A246d8f3b775998560eAa61d' })
    expect(parseCaip10('eip155:1:0x22227a31dd842196a246d8f3b775998560eaa61d')).toEqual({ chain: 'eip155:1', address: '0x22227A31dd842196A246d8f3b775998560eAa61d' })
    expect(parseCaip10('eip155:137:0x0495766cD136138Fc492Dd499B8DC87A92D6685b')?.chain).toBe('eip155:137')
    expect(parseCaip10('eip155:137:0x0495766CD136138FC492DD499B8DC87A92D6685B')).toBeNull()
    expect(parseCaip10('eip155:1:0x22227A31dd842196A246d8f3b775998560eAa61')).toBeNull() // 39 digits
    expect(parseCaip10('cosmos:cosmoshub-3:cosmos1abc')).toBeNull() // not eip155: not read here
  })
  it('parses the published CAIP-2 cases and refuses what is not one', () => {
    for (const c of ['eip155:1', 'bip122:000000000019d6689c085ae165831e93', 'cosmos:cosmoshub-3', 'cosmos:Binance-Chain-Tigris', 'starknet:SN_GOERLI']) expect(parseCaip2(c)).not.toBeNull()
    for (const c of ['eip155', 'EIP155:1', 'eip155:', 'constructor', '__proto__', 'e:1']) expect(parseCaip2(c)).toBeNull()
  })
  it('caip10 and sameAccount', () => {
    expect(caip10('eip155:42220', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('eip155:42220:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
    expect(() => caip10('celo', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toThrow('not a CAIP-2 chain id')
    expect(sameAccount('eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
    expect(sameAccount('eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'eip155:10:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false)
  })
  it('isAddress and addressOf', () => {
    expect(isAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
    expect(isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
    expect(isAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toBe(false)
    expect(isAddress('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(false)
    expect(addressOf('eip155:1:0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
    expect(addressOf('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
    expect(() => addressOf('nope')).toThrow()
    expect(() => checksumAddress('0x12')).toThrow('is not an address (0x and 40 hex digits)')
  })
  it('imports nothing from node:', () => { expect(readFileSync(new URL('../../lib/caip.mjs', import.meta.url), 'utf8')).not.toMatch(/from 'node:/) })
})
