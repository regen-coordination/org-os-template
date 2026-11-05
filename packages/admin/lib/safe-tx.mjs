// packages/admin/lib/safe-tx.mjs
//
// The Safe's transaction hash (0.6 P2 spec §3.11, M-d): the contract's own `getTransactionHash`, an EIP-712 digest,
// Keccak-256 of 0x19 0x01, the domain separator and the struct hash. The domain separator is Keccak-256 of the ABI
// encoding of DOMAIN_SEPARATOR_TYPEHASH, the chain id and the Safe's address (Safe 1.3.0 and later; older Safes have no
// chain id in their domain, and are not hashed here). The struct hash is Keccak-256 of SAFE_TX_TYPEHASH, `to`, `value`,
// Keccak-256 of `data`, `operation`, `safeTxGas`, `baseGas`, `gasPrice`, `gasToken`, `refundReceiver` and `nonce`,
// each one 32-byte word. Pure, no import but lib/keccak.mjs and no node:*, so the server and the root validator run
// the same function.

import { keccak256 } from './keccak.mjs'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
/** The first Safe version whose domain holds the chain id. */
export const SAFE_MIN_VERSION = '1.3.0'
/** LOW-6: what a reading says when another transaction took the prepared one's nonce, so it can never execute. The
 *  server's Safe driver writes it; the prepared card reads it as `replaced` (DAO-OS L7 §11.3). */
export const NONCE_MOVED = "the Safe's nonce changed; revise the proposal to prepare again"

const ascii = s => new TextEncoder().encode(s)
const toHex = bytes => `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
const fromHex = hex => Uint8Array.from(hex.slice(2).match(/../g) ?? [], b => parseInt(b, 16))

const DOMAIN_TYPEHASH = keccak256(ascii('EIP712Domain(uint256 chainId,address verifyingContract)'))
const SAFE_TX_TYPEHASH = keccak256(ascii('SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'))
const UINT256_MAX = (1n << 256n) - 1n

/** @param {string} name @param {unknown} value @returns {Uint8Array} the address as one word */
function address(name, value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name}: ${JSON.stringify(value)} is not an address (0x and 40 hex digits)`)
  const word = new Uint8Array(32)
  word.set(fromHex(value.toLowerCase()), 12)
  return word
}

/** @param {string} name @param {unknown} value @param {bigint} [max] @returns {Uint8Array} the integer as one word */
function uint(name, value, max = UINT256_MAX) {
  let n
  if (typeof value === 'bigint') n = value
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value)
  else if (typeof value === 'string' && /^\d+$/.test(value)) n = BigInt(value)
  else throw new Error(`${name}: ${JSON.stringify(typeof value === 'bigint' ? String(value) : value)} is not a whole number written in decimal`)
  if (n < 0n || n > max) throw new Error(`${name}: ${n} is out of range`)
  const word = new Uint8Array(32)
  for (let i = 31; i >= 0 && n > 0n; i--) { word[i] = Number(n & 0xffn); n >>= 8n }
  return word
}

/** @param {...Uint8Array} parts */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** The bytes of `data` (`0x`, or 0x and an even number of hex digits); null or absent is no data.
 *  @param {unknown} data @returns {Uint8Array} */
function dataBytes(data) {
  if (data === null || data === undefined) return new Uint8Array()
  if (typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Error(`data: ${JSON.stringify(data)} is not hex bytes (0x and an even number of hex digits)`)
  return fromHex(data)
}

/** Keccak-256 of a transaction's data, as 0x and 64 hex digits: what the struct hash holds, and what an `attach` stores.
 *  @param {string | null | undefined} data @returns {string} */
export function dataHash(data) {
  return toHex(keccak256(dataBytes(data)))
}

/** The chain id of a CAIP-2 `eip155:<n>` chain, or null for any other.
 *  @param {unknown} caip @returns {number | null} */
export function chainIdOf(caip) {
  const m = typeof caip === 'string' ? /^eip155:(\d{1,15})$/.exec(caip) : null
  return m ? Number(m[1]) : null
}

/** Whether a Safe of this version (`1.4.1`, `1.3.0+L2`) has the chain id in its domain; false when it cannot be read.
 *  @param {unknown} version @returns {boolean} */
export function hashableVersion(version) {
  const m = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(version) : null
  if (!m) return false
  const [major, minor] = [Number(m[1]), Number(m[2])]
  return major > 1 || (major === 1 && minor >= 3)
}

/**
 * @typedef {object} SafeTxFields
 * @property {number | string | bigint} chainId
 * @property {string} safe the Safe's address, the domain's verifyingContract
 * @property {string} to
 * @property {string | number | bigint} value in base units, decimal
 * @property {string | null} [data] the call data; give this or `dataHash`
 * @property {string} [dataHash] Keccak-256 of the data, 0x and 64 hex digits
 * @property {number} operation 0 call, 1 delegatecall
 * @property {string | number | bigint} [safeTxGas] default 0
 * @property {string | number | bigint} [baseGas] default 0
 * @property {string | number | bigint} [gasPrice] default 0
 * @property {string} [gasToken] default the zero address
 * @property {string} [refundReceiver] default the zero address
 * @property {string | number | bigint} nonce the Safe's nonce the transaction is for
 */

/**
 * The Safe transaction hash (`safeTxHash`) of a transaction on a Safe 1.3.0 or later, as 0x and 64 lower-case hex
 * digits. Throws a sentence for an input that is not a transaction.
 * @param {SafeTxFields} tx @returns {string}
 */
export function safeTxHash(tx) {
  if (tx.operation !== 0 && tx.operation !== 1) throw new Error(`operation: ${JSON.stringify(tx.operation)} is not 0 (call) or 1 (delegatecall)`)
  let hashOfData
  if (tx.dataHash !== undefined) {
    if (typeof tx.dataHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx.dataHash)) throw new Error(`data_hash: ${JSON.stringify(tx.dataHash)} is not a Keccak-256 hash (0x and 64 hex digits)`)
    hashOfData = fromHex(tx.dataHash.toLowerCase())
  } else hashOfData = keccak256(dataBytes(tx.data))
  const domain = keccak256(concat(DOMAIN_TYPEHASH, uint('chainId', tx.chainId), address('safe', tx.safe)))
  const struct = keccak256(concat(
    SAFE_TX_TYPEHASH,
    address('to', tx.to),
    uint('value', tx.value),
    hashOfData,
    uint('operation', tx.operation, 255n),
    uint('safeTxGas', tx.safeTxGas ?? 0),
    uint('baseGas', tx.baseGas ?? 0),
    uint('gasPrice', tx.gasPrice ?? 0),
    address('gasToken', tx.gasToken ?? ZERO_ADDRESS),
    address('refundReceiver', tx.refundReceiver ?? ZERO_ADDRESS),
    uint('nonce', tx.nonce),
  ))
  return toHex(keccak256(concat(Uint8Array.of(0x19, 0x01), domain, struct)))
}
