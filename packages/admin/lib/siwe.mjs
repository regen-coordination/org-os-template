// packages/admin/lib/siwe.mjs
//
// Sign-in with Ethereum: the EIP-4361 message (https://eips.ethereum.org/EIPS/eip-4361), the EIP-191
// personal_sign hash (https://eips.ethereum.org/EIPS/eip-191) and the address recovered from a signature.
// Pure: no import from node:*, so the client may import it (it reads the message back before the wallet signs).
// newNonce draws from globalThis.crypto (Web Crypto: the browser's, and Node's since 19).
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak256 } from './keccak.mjs'
import { checksumAddress } from './caip.mjs'

export const NONCE_TTL_MS = 600_000

/**
 * @typedef {{ domain: string, address: string, statement: string, uri: string, version: '1', chainId: number,
 *   nonce: string, issuedAt: string, expirationTime?: string, resources?: string[] }} SiweFields
 */

/** EIP-4361 text: LF line ends, no trailing newline.
 * @param {SiweFields} f @returns {string} */
export function buildSiweMessage(f) {
  const lines = [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address,
    '',
    f.statement,
    '',
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ]
  if (f.expirationTime !== undefined) lines.push(`Expiration Time: ${f.expirationTime}`)
  if (f.resources !== undefined) lines.push('Resources:', ...f.resources.map((r) => `- ${r}`))
  return lines.join('\n')
}

/** Reads back what buildSiweMessage writes (tests and echo checks only).
 * @param {string} text @returns {SiweFields | { error: string }} */
export function parseSiweMessage(text) {
  if (typeof text !== 'string') return { error: 'message is not text' }
  const lines = text.split('\n')
  const head = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? '')
  if (!head) return { error: 'first line is not the EIP-4361 header' }
  if (lines[2] !== '' || lines[4] !== '') return { error: 'statement is not set between blank lines' }
  const out = { domain: head[1], address: lines[1], statement: lines[3] }
  const take = (i, label) => {
    const line = lines[i] ?? ''
    return line.startsWith(`${label}: `) ? line.slice(label.length + 2) : null
  }
  const uri = take(5, 'URI')
  const version = take(6, 'Version')
  const chain = take(7, 'Chain ID')
  const nonce = take(8, 'Nonce')
  const issuedAt = take(9, 'Issued At')
  if (uri === null || version === null || chain === null || nonce === null || issuedAt === null) return { error: 'a required field is missing or out of order' }
  if (version !== '1') return { error: 'version is not 1' }
  if (!/^[0-9]+$/.test(chain)) return { error: 'chain id is not a number' }
  Object.assign(out, { uri, version: '1', chainId: Number(chain), nonce, issuedAt })
  let i = 10
  const exp = take(i, 'Expiration Time')
  if (exp !== null) { out.expirationTime = exp; i++ }
  if (lines[i] === 'Resources:') {
    const resources = []
    for (i++; i < lines.length; i++) {
      if (!lines[i].startsWith('- ')) return { error: 'a resource line does not start with "- "' }
      resources.push(lines[i].slice(2))
    }
    out.resources = resources
  } else if (i < lines.length) return { error: 'unexpected trailing line' }
  return /** @type {SiweFields} */ (out)
}

/** keccak256("\x19Ethereum Signed Message:\n" + byteLength + bytes).
 * @param {string} text @returns {Uint8Array} */
export function personalHash(text) {
  const body = new TextEncoder().encode(text)
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`)
  const all = new Uint8Array(prefix.length + body.length)
  all.set(prefix, 0)
  all.set(body, prefix.length)
  return keccak256(all)
}

/** The EIP-55 address that signed text, or null for a malformed or malleable (high-s) signature.
 * @param {string} text @param {string} signature 0x + 130 hex (r, s, v with v 27/28 or 0/1)
 * @returns {string | null} */
export function recoverAddress(text, signature) {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null
  try {
    const bytes = Uint8Array.from(signature.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16))
    let v = bytes[64]
    if (v === 27 || v === 28) v -= 27
    if (v !== 0 && v !== 1) return null
    const sig = secp256k1.Signature.fromBytes(bytes.slice(0, 64), 'compact')
    if (sig.hasHighS()) return null
    const point = sig.addRecoveryBit(v).recoverPublicKey(personalHash(text))
    const pub = point.toBytes(false) // 0x04 || X || Y
    const hash = keccak256(pub.slice(1))
    return checksumAddress('0x' + Array.from(hash.slice(12), (b) => b.toString(16).padStart(2, '0')).join(''))
  } catch {
    return null
  }
}

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 22 alphanumeric characters from 16 random bytes (128 bits, base62).
 * @returns {string} */
export function newNonce() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  let n = BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))
  let out = ''
  for (let i = 0; i < 22; i++) { out += ALPHANUM[Number(n % 62n)]; n /= 62n }
  return out
}
