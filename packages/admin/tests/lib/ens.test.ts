// DAO-OS L7 Task 14: ENS names as the Universal Resolver takes them. namehash is ENSIP-1's, checked against its
// published vectors (https://docs.ens.domains/ensip/1, read 2026-11-06); dnsEncode is ENSIP-10's DNS wire format
// (https://docs.ens.domains/ensip/10: RFC 1035 §3.1, each label behind its length, a zero byte last; the empty name is a
// single zero byte).
import { describe, it, expect } from 'vitest'
import { ENS_SIGNATURES, TEXT_INTERFACE, dnsEncode, namehash } from '../../lib/ens.mjs'
import { selector } from '../../lib/abi.mjs'

describe('namehash (ENSIP-1)', () => {
  it('gives the published vectors', () => {
    expect(namehash('')).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
    expect(namehash('eth')).toBe('0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae')
    expect(namehash('foo.eth')).toBe('0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f')
  })
  it('takes only names already normalised as lower-case letters, digits and hyphens; anything else is refused in words', () => {
    expect(() => namehash('Test-DAO.eth')).toThrow('"Test-DAO.eth" is not an ENS name this Hub reads: lower-case letters, digits and hyphens, labels joined by dots.')
    expect(() => namehash('a..eth')).toThrow(/is not an ENS name/)
    expect(() => namehash('dao.eth.')).toThrow(/is not an ENS name/)
  })
})

describe('dnsEncode (ENSIP-10)', () => {
  it('writes each label behind its length and a zero byte last', () => {
    expect(dnsEncode('test-dao.eth')).toBe('0x08746573742d64616f0365746800')
    expect(dnsEncode('eth')).toBe('0x0365746800')
    expect(dnsEncode('')).toBe('0x00')
  })
})

describe('the selectors read and written', () => {
  it('text(bytes32,string) is the text resolver interface id, 0x59d1d43c', () => {
    expect(selector(ENS_SIGNATURES.text)).toBe(TEXT_INTERFACE)
    expect(TEXT_INTERFACE).toBe('0x59d1d43c')
    expect(ENS_SIGNATURES).toMatchObject({
      findResolver: 'findResolver(bytes)', resolve: 'resolve(bytes,bytes)', setText: 'setText(bytes32,string,string)', supportsInterface: 'supportsInterface(bytes4)',
    })
  })
})
