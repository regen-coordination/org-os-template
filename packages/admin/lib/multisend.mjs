// packages/admin/lib/multisend.mjs
//
// Safe MultiSend / MultiSendCallOnly 1.4.1 calldata. Each transaction is packed as
// operation (1 byte) ‖ to (20) ‖ value (32) ‖ dataLength (32) ‖ data, concatenated, then wrapped in
// multiSend(bytes). Format: safe-smart-account contracts/libraries/MultiSendCallOnly.sol at v1.4.1.
// NOTE: MultiSendCallOnly reverts on operation 1 (delegatecall); only MultiSend accepts it.
// Pure: imports only ./abi.mjs and ./caip.mjs.
import { decodeResult, encodeCall, selector } from './abi.mjs'
import { addressOf } from './caip.mjs'

const hexOf = (n, digits) => n.toString(16).padStart(digits, '0')

/** @param {{ operation: 0 | 1, to: string, value: string, data: string }[]} txs
 * @returns {string} calldata of multiSend(bytes) */
export function encodeMultiSend(txs) {
  if (!Array.isArray(txs)) throw new Error('multisend: a list of transactions is required')
  let packed = '0x'
  txs.forEach((tx, i) => {
    const bad = (why) => new Error(`multisend: transaction ${i}: ${why}`)
    if (tx.operation !== 0 && tx.operation !== 1) throw bad('operation must be 0 (call) or 1 (delegatecall)')
    let to
    try { to = addressOf(tx.to) } catch { throw bad(`${String(tx.to)} is not an address`) }
    if (typeof tx.value !== 'string' || !/^\d+$/.test(tx.value)) throw bad('value must be a decimal string')
    const value = BigInt(tx.value)
    if (value >= 1n << 256n) throw bad('value is out of range for uint256')
    if (typeof tx.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data)) throw bad('data must be 0x hex bytes')
    const data = tx.data.slice(2)
    packed += hexOf(tx.operation, 2) + to.slice(2).toLowerCase() + hexOf(value, 64) + hexOf(BigInt(data.length / 2), 64) + data
  })
  return encodeCall('multiSend(bytes)', [packed])
}

/** The transactions packed in a multiSend(bytes) call's data (L7 gap B2: an add-role read at check time), each as
 * `encodeMultiSend` takes it. Throws a sentence when the data is not multiSend(bytes) or its packing does not read
 * cleanly (a short transaction, bytes left over, nothing packed).
 * @param {string} data @returns {{ operation: 0 | 1, to: string, value: string, data: string }[]} */
export function decodeMultiSend(data) {
  if (typeof data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) throw new Error('multisend: the data is not hex bytes')
  if (data.slice(0, 10).toLowerCase() !== selector('multiSend(bytes)')) throw new Error('multisend: the data is not a multiSend(bytes) call')
  const [packed] = /** @type {[string]} */ (decodeResult(['bytes'], '0x' + data.slice(10)))
  const hex = packed.slice(2)
  /** @type {{ operation: 0 | 1, to: string, value: string, data: string }[]} */
  const out = []
  let at = 0
  while (at < hex.length) {
    const i = out.length
    if (hex.length - at < 2 * (1 + 20 + 32 + 32)) throw new Error(`multisend: transaction ${i} is cut short`)
    const operation = Number.parseInt(hex.slice(at, at + 2), 16)
    if (operation !== 0 && operation !== 1) throw new Error(`multisend: transaction ${i} has operation ${operation}`)
    const to = addressOf('0x' + hex.slice(at + 2, at + 42))
    const value = BigInt('0x' + hex.slice(at + 42, at + 106)).toString(10)
    const length = BigInt('0x' + hex.slice(at + 106, at + 170))
    const start = at + 170
    if (BigInt(hex.length - start) < length * 2n) throw new Error(`multisend: transaction ${i}'s data is cut short`)
    const end = start + Number(length) * 2
    out.push({ operation, to, value, data: '0x' + hex.slice(start, end) })
    at = end
  }
  if (out.length === 0) throw new Error('multisend: nothing is packed')
  return out
}
