// packages/admin/lib/create2.mjs
//
// CREATE2 address prediction (EIP-1014) and the two factories the compose deployment uses: Safe's
// SafeProxyFactory 1.4.1 and Zodiac's ModuleProxyFactory. Pure: imports only ./keccak.mjs and ./caip.mjs.
import { keccak256 } from './keccak.mjs'
import { checksumAddress } from './caip.mjs'

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
/** @param {string} hex 0x-prefixed, even length @param {string} what @returns {Uint8Array} */
function bytesOf(hex, what) {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`${what} is not 0x hex bytes`)
  const out = new Uint8Array((hex.length - 2) / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16)
  return out
}
/** @param {string} hex @param {number} n @param {string} what @returns {Uint8Array} exactly n bytes */
function fixed(hex, n, what) {
  const b = bytesOf(hex, what)
  if (b.length !== n) throw new Error(`${what} needs ${n} bytes, got ${b.length}`)
  return b
}
/** @param {string|number|bigint} v @param {string} what @returns {string} 64 hex digits */
function uint256Hex(v, what) {
  let n
  if (typeof v === 'bigint') n = v
  else if (typeof v === 'number' && Number.isSafeInteger(v)) n = BigInt(v)
  else if (typeof v === 'string' && /^\d+$/.test(v)) n = BigInt(v)
  else if (typeof v === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(v)) n = BigInt(v)
  else throw new Error(`${what} must be a uint256 (decimal string, 0x hex, safe integer or bigint)`)
  if (n < 0n || n >= 1n << 256n) throw new Error(`${what} is out of range for uint256`)
  return n.toString(16).padStart(64, '0')
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** EIP-1014: the last 20 bytes of keccak256(0xff ‖ deployer ‖ salt ‖ keccak256(init_code)).
 * @param {string} deployer 0x + 40 hex @param {string} salt 0x + 64 hex @param {string} initCodeHash 0x + 64 hex
 * @returns {string} EIP-55 checksummed */
export function create2Address(deployer, salt, initCodeHash) {
  const d = fixed(deployer, 20, 'deployer')
  const s = fixed(salt, 32, 'salt')
  const h = fixed(initCodeHash, 32, 'initCodeHash')
  const digest = keccak256(concat(Uint8Array.of(0xff), d, s, h))
  return checksumAddress('0x' + hexOf(digest.subarray(12)))
}

/** The salt both factories use: keccak256(keccak256(initializer) ‖ uint256 saltNonce).
 * @param {string} initializer @param {string|number|bigint} saltNonce @returns {string} 0x + 64 hex */
function nonceSalt(initializer, saltNonce) {
  const ih = keccak256(bytesOf(initializer, 'initializer'))
  return '0x' + hexOf(keccak256(concat(ih, bytesOf('0x' + uint256Hex(saltNonce, 'saltNonce'), 'saltNonce'))))
}

/** The address SafeProxyFactory 1.4.1 `createProxyWithNonce(singleton, initializer, saltNonce)` deploys to:
 * CREATE2 from the factory, salt keccak256(keccak256(initializer) ‖ saltNonce), init code
 * `proxyCreationCode() ‖ uint256(singleton)`.
 * @param {{ factory: string, singleton: string, initializer: string, saltNonce: string|number|bigint, proxyCreationCode: string }} p
 * @returns {string} checksummed */
export function safeProxyAddress(p) {
  const singleton = fixed(p.singleton, 20, 'singleton')
  const initCode = concat(bytesOf(p.proxyCreationCode, 'proxyCreationCode'), new Uint8Array(12), singleton)
  return create2Address(p.factory, nonceSalt(p.initializer, p.saltNonce), '0x' + hexOf(keccak256(initCode)))
}

/** The address Zodiac's ModuleProxyFactory `deployModule(masterCopy, initializer, saltNonce)` deploys to:
 * CREATE2 from the factory, the same salt, init code the 45-byte EIP-1167 minimal proxy of `masterCopy`
 * (`602d8060093d393df3363d3d373d3d3d363d73 ‖ masterCopy ‖ 5af43d82803e903d91602b57fd5bf3`).
 * @param {{ factory: string, masterCopy: string, initializer: string, saltNonce: string|number|bigint }} p
 * @returns {string} checksummed */
export function zodiacModuleAddress(p) {
  const master = '0x' + hexOf(fixed(p.masterCopy, 20, 'masterCopy'))
  const initCode = bytesOf('0x602d8060093d393df3363d3d373d3d3d363d73' + master.slice(2) + '5af43d82803e903d91602b57fd5bf3', 'initCode')
  return create2Address(p.factory, nonceSalt(p.initializer, p.saltNonce), '0x' + hexOf(keccak256(initCode)))
}
