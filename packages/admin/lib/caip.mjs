// packages/admin/lib/caip.mjs
//
// CAIP-2 chain ids, CAIP-10 account ids (eip155 only) and EIP-55 checksum addresses.
// Pure: imports only ./keccak.mjs. Inputs accept all-lowercase or valid-checksum addresses
// (the eip155 CAIP-10 profile's Postel rule); outputs always carry the EIP-55 case.
import { keccak256 } from './keccak.mjs'

const CAIP2 = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/
const HEX40 = /^0x[0-9a-fA-F]{40}$/

/** @param {unknown} value @returns {{ namespace: string, reference: string } | null} */
export function parseCaip2(value) {
  if (typeof value !== 'string') return null
  const m = CAIP2.exec(value)
  return m ? { namespace: m[1], reference: m[2] } : null
}

/** EIP-55 checksum case of an address.
 * @param {string} address @returns {string} */
export function checksumAddress(address) {
  if (typeof address !== 'string' || !HEX40.test(address)) throw new Error(`${String(address)} is not an address (0x and 40 hex digits)`)
  const lower = address.slice(2).toLowerCase()
  const hash = keccak256(new TextEncoder().encode(lower))
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
  let out = '0x'
  for (let i = 0; i < 40; i++) out += parseInt(hex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
  return out
}

/** 0x + 40 hex, and lowercase or a valid checksum.
 * @param {unknown} value @returns {boolean} */
export function isAddress(value) {
  if (typeof value !== 'string' || !HEX40.test(value)) return false
  const body = value.slice(2)
  if (body === body.toLowerCase()) return true
  return checksumAddress(value) === value
}

/** @param {unknown} value @returns {{ chain: string, address: string } | null} */
export function parseCaip10(value) {
  if (typeof value !== 'string') return null
  const parts = value.split(':')
  if (parts.length !== 3 || parts[0] !== 'eip155') return null
  const chain = `${parts[0]}:${parts[1]}`
  if (!parseCaip2(chain) || !isAddress(parts[2])) return null
  return { chain, address: checksumAddress(parts[2]) }
}

/** @param {string} chain @param {string} address @returns {string} */
export function caip10(chain, address) {
  if (!parseCaip2(chain)) throw new Error(`${String(chain)} is not a CAIP-2 chain id`)
  if (!isAddress(address)) throw new Error(`${String(address)} is not an address (0x and 40 hex digits)`)
  return `${chain}:${checksumAddress(address)}`
}

/** The 0x address of a bare address or a CAIP-10 account, checksummed.
 * @param {string} value @returns {string} */
export function addressOf(value) {
  if (isAddress(value)) return checksumAddress(value)
  const p = parseCaip10(value)
  if (p) return p.address
  throw new Error(`${String(value)} is neither an address nor a CAIP-10 account`)
}

/** @param {string} a @param {string} b @returns {boolean} */
export function sameAccount(a, b) {
  const pa = parseCaip10(a)
  const pb = parseCaip10(b)
  const addrA = pa ? pa.address : isAddress(a) ? checksumAddress(a) : null
  const addrB = pb ? pb.address : isAddress(b) ? checksumAddress(b) : null
  if (!addrA || !addrB) return false
  if (addrA.toLowerCase() !== addrB.toLowerCase()) return false
  return !(pa && pb && pa.chain !== pb.chain)
}
