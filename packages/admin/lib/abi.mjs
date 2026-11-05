// packages/admin/lib/abi.mjs
//
// A small Solidity ABI encoder/decoder for the calls drivers prepare and the answers they read.
// Supported types, and nothing else: address, bool, uint8..uint256 (multiples of 8), bytes1..bytes32,
// bytes, string, T[] for a static non-tuple T, and a static tuple (T1,...,Tn) of static types (inline).
// Pure: imports only ./keccak.mjs and ./caip.mjs.
import { keccak256 } from './keccak.mjs'
import { addressOf } from './caip.mjs'

/** @typedef {{ k: 'uint', bits: number } | { k: 'address' } | { k: 'bool' } | { k: 'bytesN', n: number }
 *   | { k: 'bytes' } | { k: 'string' } | { k: 'array', of: Type } | { k: 'tuple', items: Type[] }} Type */

const enc = new TextEncoder()
const dec = new TextDecoder()
const WORD = 32

const unsupported = (t) => new Error(`abi: type "${t}" is not supported`)

/** Split at top-level commas only (tuples nest).
 * @param {string} s @returns {string[]} */
function splitTop(s) {
  if (s === '') return []
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (depth !== 0) throw new Error(`abi: unbalanced parentheses in "${s}"`)
  out.push(cur)
  return out
}

/** @param {Type} t @returns {boolean} */
const isDynamic = (t) => t.k === 'bytes' || t.k === 'string' || t.k === 'array' || (t.k === 'tuple' && t.items.some(isDynamic))

/** @param {string} raw @returns {Type} */
function parseType(raw) {
  const t = String(raw).trim()
  if (t === 'address') return { k: 'address' }
  if (t === 'bool') return { k: 'bool' }
  if (t === 'bytes') return { k: 'bytes' }
  if (t === 'string') return { k: 'string' }
  let m = /^uint(\d+)$/.exec(t)
  if (m) {
    const bits = Number(m[1])
    if (bits < 8 || bits > 256 || bits % 8 !== 0) throw unsupported(t)
    return { k: 'uint', bits }
  }
  m = /^bytes(\d+)$/.exec(t)
  if (m) {
    const n = Number(m[1])
    if (n < 1 || n > 32) throw unsupported(t)
    return { k: 'bytesN', n }
  }
  if (t.endsWith('[]')) {
    const of = parseType(t.slice(0, -2))
    if (isDynamic(of) || of.k === 'tuple') throw unsupported(t)
    return { k: 'array', of }
  }
  if (t.startsWith('(') && t.endsWith(')')) {
    const items = splitTop(t.slice(1, -1)).map(parseType)
    if (items.length === 0 || items.some(isDynamic)) throw unsupported(t)
    return { k: 'tuple', items }
  }
  throw unsupported(t)
}

/** @param {string} signature @returns {{ name: string, args: string[] }} */
function parseSignature(signature) {
  const s = String(signature).replace(/\s+/g, '')
  const open = s.indexOf('(')
  if (open < 1 || !s.endsWith(')')) throw new Error(`abi: "${signature}" is not a function signature`)
  return { name: s.slice(0, open), args: splitTop(s.slice(open + 1, -1)) }
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
function fromHex(hex, what) {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`${what} is not 0x hex bytes`)
  const out = new Uint8Array((hex.length - 2) / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16)
  return out
}

/** @param {string} signature @returns {string} '0x' + 8 hex */
export function selector(signature) {
  const { name, args } = parseSignature(signature)
  return '0x' + toHex(keccak256(enc.encode(`${name}(${args.join(',')})`)).slice(0, 4))
}

const word = (n) => n.toString(16).padStart(64, '0')
const padRight = (bytes) => toHex(bytes) + '00'.repeat((WORD - (bytes.length % WORD)) % WORD)
const wordsOf = (t) => (t.k === 'tuple' ? t.items.reduce((n, it) => n + wordsOf(it), 0) : 1)

/** @param {Type} t @param {unknown} v @param {number} i @returns {string} hex of a static value (one or more words) */
function encodeStatic(t, v, i) {
  const bad = (why) => new Error(`abi: argument ${i}: ${why}`)
  switch (t.k) {
    case 'uint': {
      let n
      if (typeof v === 'bigint') n = v
      else if (typeof v === 'number' && Number.isSafeInteger(v)) n = BigInt(v)
      else if (typeof v === 'string' && /^\d+$/.test(v)) n = BigInt(v)
      else throw bad('a uint must be a decimal string, a safe integer or a bigint')
      if (n < 0n || n >= 1n << BigInt(t.bits)) throw bad(`${String(v)} is out of range for uint${t.bits}`)
      return word(n)
    }
    case 'address': {
      let a
      try { a = addressOf(/** @type {string} */ (v)) } catch { throw bad(`${String(v)} is not an address or CAIP-10 account`) }
      return a.slice(2).toLowerCase().padStart(64, '0')
    }
    case 'bool':
      if (typeof v !== 'boolean') throw bad('a bool must be true or false')
      return word(v ? 1n : 0n)
    case 'bytesN': {
      let b
      try { b = fromHex(v, 'value') } catch { throw bad('bytes must be 0x hex') }
      if (b.length !== t.n) throw bad(`bytes${t.n} needs ${t.n} bytes, got ${b.length}`)
      return padRight(b)
    }
    case 'tuple': {
      if (!Array.isArray(v) || v.length !== t.items.length) throw bad(`a tuple needs ${t.items.length} values`)
      return t.items.map((it, j) => encodeStatic(it, v[j], i)).join('')
    }
    default:
      throw bad('not a static type')
  }
}

/** @param {Type} t @param {unknown} v @param {number} i @returns {string} hex of a dynamic value's tail */
function encodeDynamic(t, v, i) {
  const bad = (why) => new Error(`abi: argument ${i}: ${why}`)
  if (t.k === 'string') {
    if (typeof v !== 'string') throw bad('a string must be text')
    const b = enc.encode(v)
    return word(BigInt(b.length)) + padRight(b)
  }
  if (t.k === 'bytes') {
    let b
    try { b = fromHex(v, 'value') } catch { throw bad('bytes must be 0x hex') }
    return word(BigInt(b.length)) + padRight(b)
  }
  if (t.k === 'array') {
    if (!Array.isArray(v)) throw bad('an array needs a list of values')
    return word(BigInt(v.length)) + v.map((x) => encodeStatic(t.of, x, i)).join('')
  }
  throw bad('not a dynamic type')
}

/** @param {string[]} types @param {unknown[]} values @returns {string} '0x…' without selector */
export function encodeArgs(types, values) {
  const ts = types.map(parseType)
  if (!Array.isArray(values) || values.length !== ts.length) throw new Error(`abi: ${ts.length} values expected, got ${Array.isArray(values) ? values.length : 'none'}`)
  const headSize = ts.reduce((n, t) => n + (isDynamic(t) ? 1 : wordsOf(t)), 0) * WORD
  let head = ''
  let tail = ''
  ts.forEach((t, i) => {
    if (isDynamic(t)) {
      head += word(BigInt(headSize + tail.length / 2))
      tail += encodeDynamic(t, values[i], i)
    } else head += encodeStatic(t, values[i], i)
  })
  return '0x' + head + tail
}

/** @param {string} signature @param {unknown[]} values @returns {string} selector + arguments */
export function encodeCall(signature, values) {
  const { args } = parseSignature(signature)
  return selector(signature) + encodeArgs(args, values).slice(2)
}

/** @param {Uint8Array} buf @param {number} pos */
function readWord(buf, pos) {
  if (pos < 0 || pos + WORD > buf.length) throw new Error(`abi: answer too short (needs bytes ${pos}..${pos + WORD}, has ${buf.length})`)
  return buf.subarray(pos, pos + WORD)
}
const wordBig = (w) => BigInt('0x' + toHex(w))
function readLen(buf, pos) {
  const n = wordBig(readWord(buf, pos))
  if (n > BigInt(buf.length)) throw new Error(`abi: answer too short (a length or offset of ${n} exceeds the ${buf.length} bytes given)`)
  return Number(n)
}

/** @param {Type} t @param {Uint8Array} buf @param {number} pos @returns {unknown} */
function decodeStatic(t, buf, pos) {
  switch (t.k) {
    case 'uint': {
      const n = wordBig(readWord(buf, pos))
      if (n >= 1n << BigInt(t.bits)) throw new Error(`abi: uint${t.bits} answer out of range`)
      return n.toString(10)
    }
    case 'address': {
      const w = readWord(buf, pos)
      if (w.subarray(0, 12).some((b) => b !== 0)) throw new Error('abi: address answer has non-zero high bytes')
      return addressOf('0x' + toHex(w.subarray(12)))
    }
    case 'bool': {
      const n = wordBig(readWord(buf, pos))
      if (n > 1n) throw new Error('abi: bool answer is neither 0 nor 1')
      return n === 1n
    }
    case 'bytesN':
      return '0x' + toHex(readWord(buf, pos).subarray(0, t.n))
    case 'tuple': {
      let p = pos
      return t.items.map((it) => { const r = decodeStatic(it, buf, p); p += wordsOf(it) * WORD; return r })
    }
    default:
      throw new Error('abi: not a static type')
  }
}

/** @param {Type} t @param {Uint8Array} buf @param {number} at @returns {unknown} */
function decodeDynamic(t, buf, at) {
  const len = readLen(buf, at)
  if (t.k === 'array') {
    const stride = wordsOf(t.of) * WORD
    if (at + WORD + len * stride > buf.length) throw new Error('abi: answer too short for its array')
    return Array.from({ length: len }, (_, j) => decodeStatic(t.of, buf, at + WORD + j * stride))
  }
  if (at + WORD + len > buf.length) throw new Error('abi: answer too short for its bytes')
  const data = buf.subarray(at + WORD, at + WORD + len)
  return t.k === 'string' ? dec.decode(data) : '0x' + toHex(data)
}

/** @param {string[]} types @param {string} data 0x hex @returns {unknown[]} */
export function decodeResult(types, data) {
  const ts = types.map(parseType)
  const buf = fromHex(data, 'answer')
  let pos = 0
  return ts.map((t) => {
    if (isDynamic(t)) {
      const off = readLen(buf, pos)
      pos += WORD
      return decodeDynamic(t, buf, off)
    }
    const r = decodeStatic(t, buf, pos)
    pos += wordsOf(t) * WORD
    return r
  })
}
