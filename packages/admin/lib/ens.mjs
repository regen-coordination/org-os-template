// packages/admin/lib/ens.mjs
//
// ENS names as the Universal Resolver takes them (DAO-OS L7 Task 14, L7-D13): `namehash` (ENSIP-1) and `dnsEncode`
// (ENSIP-10), and the signatures the daoURI registration reads and writes. Pure: imports only ./keccak.mjs and ./abi.mjs.
//
// Sources, read 2026-11-06:
//   - ENSIP-1, https://docs.ens.domains/ensip/1 — namehash, and its vectors (tests/lib/ens.test.ts).
//   - ENSIP-10, https://docs.ens.domains/ensip/10 — `dnsencode` is RFC 1035 §3.1 (each label behind its length octet, a
//     zero octet last); the empty name is a single zero octet; no limit on the whole length.
//   - https://docs.ens.domains/learn/deployments — Sepolia runs ENSv2; the Universal Resolver proxy
//     0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe (lib/deployments.mjs) is "UpgradableUniversalResolverProxy, ENSv2".
//   - ens-contracts IUniversalResolver at ebe0b84852134c6236727defc0704471215c23c0,
//     https://github.com/ensdomains/ens-contracts/blob/ebe0b84852134c6236727defc0704471215c23c0/contracts/universalResolver/IUniversalResolver.sol
//     — `findResolver(bytes name) returns (address resolver, bytes32 node, uint256 resolverOffset)` ("null if not
//     found"), `resolve(bytes name, bytes data) returns (bytes result, address resolver)`; AbstractUniversalResolver
//     decodes an extended resolver's answer and reverts `UnsupportedResolverProfile` on a profile the resolver lacks.
//   - contracts-v2 at 48b3e2d39513b9dd32ef1850877a29009bc807b9: UniversalResolverV2 is AbstractUniversalResolver and
//     overrides findResolver (LibRegistry); PermissionedResolver has `setText(bytes32 node, string key, string value)`
//     (guarded by ROLE_SET_TEXT on the node), `text(bytes32 node, string key)`, and supportsInterface answers
//     `type(ITextResolver).interfaceId`, the selector of text(bytes32,string): 0x59d1d43c.
//       https://github.com/ensdomains/contracts-v2/blob/48b3e2d39513b9dd32ef1850877a29009bc807b9/contracts/src/universalResolver/UniversalResolverV2.sol
//       https://github.com/ensdomains/contracts-v2/blob/48b3e2d39513b9dd32ef1850877a29009bc807b9/contracts/src/resolver/PermissionedResolver.sol
//
// Names are taken already normalised (ENSIP-15) and plain: lower-case ASCII letters, digits and hyphens, labels joined
// by dots. Anything else is refused in words rather than normalised here.
import { keccak256 } from './keccak.mjs'

export const ENS_SIGNATURES = /** @type {const} */ ({
  findResolver: 'findResolver(bytes)',
  resolve: 'resolve(bytes,bytes)',
  text: 'text(bytes32,string)',
  setText: 'setText(bytes32,string,string)',
  supportsInterface: 'supportsInterface(bytes4)',
})
/** ITextResolver's interface id: the selector of text(bytes32,string). */
export const TEXT_INTERFACE = '0x59d1d43c'
/** The text record a daoURI is registered under (L7-D13). */
export const DAOURI_KEY = 'daouri'

const enc = new TextEncoder()
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const toHex = (/** @type {Uint8Array} */ b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** The labels of `name`, checked. @param {string} name @returns {string[]} */
function labelsOf(name) {
  if (name === '') return []
  const labels = typeof name === 'string' ? name.split('.') : []
  if (labels.length === 0 || !labels.every(l => LABEL.test(l) && l.length <= 63)) {
    throw new Error(`${JSON.stringify(name)} is not an ENS name this Hub reads: lower-case letters, digits and hyphens, labels joined by dots.`)
  }
  return labels
}

/** ENSIP-1 namehash of `name`, 0x and 64 hex digits. @param {string} name @returns {string} */
export function namehash(name) {
  let node = new Uint8Array(32)
  for (const label of labelsOf(name).reverse()) {
    const both = new Uint8Array(64)
    both.set(node, 0)
    both.set(keccak256(enc.encode(label)), 32)
    node = keccak256(both)
  }
  return `0x${toHex(node)}`
}

/** ENSIP-10 DNS wire format of `name`, 0x hex. @param {string} name @returns {string} */
export function dnsEncode(name) {
  let out = ''
  for (const label of labelsOf(name)) {
    const bytes = enc.encode(label)
    out += bytes.length.toString(16).padStart(2, '0') + toHex(bytes)
  }
  return `0x${out}00`
}
