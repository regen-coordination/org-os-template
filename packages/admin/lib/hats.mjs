// packages/admin/lib/hats.mjs
//
// Hats Protocol v1: hat-id arithmetic, hat and tree references, the contract address and call builders.
// A hat id is 256 bits: the top 32 bits are the tree id, then up to 14 levels of 16 bits each, the rest zero.
// Pure: imports only ./abi.mjs and ./caip.mjs. BigInt arithmetic throughout.
import { encodeCall } from './abi.mjs'
import { caip10, parseCaip2 } from './caip.mjs'

/** @typedef {{ chain: string, to: string, value: string, data: string, operation: 0 | 1, summary: string }} HatsCall */

export const HATS_V1 = '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137'

export const HATS_SIGNATURES = {
  mintTopHat: 'mintTopHat(address,string,string)',
  createHat: 'createHat(uint256,string,uint32,address,address,bool,string)',
  mintHat: 'mintHat(uint256,address)',
  transferHat: 'transferHat(uint256,address,address)',
  changeHatDetails: 'changeHatDetails(uint256,string)',
  viewHat: 'viewHat(uint256)',
  isWearerOfHat: 'isWearerOfHat(address,uint256)',
  isAdminOfHat: 'isAdminOfHat(address,uint256)',
  isEligible: 'isEligible(address,uint256)',
}

export const VIEW_HAT_TYPES = ['string', 'uint32', 'uint32', 'address', 'address', 'string', 'uint16', 'bool', 'bool']

const MAX_TREE = 0xffffffff
const MAX_LEVEL = 14
const MAX_UINT256 = (1n << 256n) - 1n
/** Bit position of the low end of level L (1..14); the tree id sits at 224. */
const shiftOf = (level) => BigInt(224 - 16 * level)

/** @param {bigint} n @returns {string} */
const toHex = (n) => '0x' + n.toString(16).padStart(64, '0')

/** @param {string} hatId @returns {bigint} */
function bigOf(hatId) {
  const id = normalHatId(hatId)
  if (id === null) throw new Error(`${String(hatId)} is not a hat id`)
  return BigInt(id)
}

/** A tree id: 13, "13", "0x0000000d" or "0xd"; 0 and anything above 2^32-1 are not one.
 * @param {unknown} value @returns {number | null} */
export function treeIdOf(value) {
  let n
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null
    n = BigInt(value)
  } else if (typeof value === 'string') {
    if (/^[0-9]+$/.test(value)) n = BigInt(value)
    else if (/^0x[0-9a-fA-F]{1,8}$/.test(value)) n = BigInt(value)
    else return null
  } else return null
  return n >= 1n && n <= BigInt(MAX_TREE) ? Number(n) : null
}

/** @param {number | string} treeId @returns {string} */
export function topHatId(treeId) {
  const t = treeIdOf(treeId)
  if (t === null) throw new Error(`${String(treeId)} is not a tree id (1 to 4294967295)`)
  return toHex(BigInt(t) << 224n)
}

/** @param {string} hatId @returns {number} */
export function hatLevel(hatId) {
  const n = bigOf(hatId)
  for (let l = MAX_LEVEL; l >= 1; l--) if ((n >> shiftOf(l)) & 0xffffn) return l
  return 0
}

/** The admin: the id with its own level zeroed; null for a top hat.
 * @param {string} hatId @returns {string | null} */
export function adminOf(hatId) {
  const level = hatLevel(hatId)
  if (level === 0) return null
  return toHex(bigOf(hatId) & ~(0xffffn << shiftOf(level)) & MAX_UINT256)
}

/** @param {string} adminId @param {number} index 1..65535 @returns {string} */
export function childHatId(adminId, index) {
  const level = hatLevel(adminId)
  if (level >= MAX_LEVEL) throw new Error('a hat at level 14 cannot have children')
  if (!Number.isInteger(index) || index < 1 || index > 0xffff) throw new Error(`${String(index)} is not a child index (1 to 65535)`)
  return toHex(bigOf(adminId) | (BigInt(index) << shiftOf(level + 1)))
}

/** '0x0000000d.0001.0002': the tree id, then each level, trailing zero levels dropped.
 * @param {string} hatId @returns {string} */
export function prettyHatId(hatId) {
  const hex = toHex(bigOf(hatId)).slice(2)
  const level = hatLevel(hatId)
  const parts = ['0x' + hex.slice(0, 8)]
  for (let l = 1; l <= level; l++) parts.push(hex.slice(8 + 4 * (l - 1), 12 + 4 * (l - 1)))
  return parts.join('.')
}

/** Full hex (any case), the pretty form, or a decimal string, as lowercase full hex; else null.
 * An all-digit string is a decimal hat id (the 256-bit number), not a tree id.
 * @param {unknown} value @returns {string | null} */
export function normalHatId(value) {
  if (typeof value !== 'string') return null
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase()
  if (/^[0-9]+$/.test(value)) {
    const n = BigInt(value)
    return n <= MAX_UINT256 ? toHex(n) : null
  }
  const m = /^0x([0-9a-fA-F]{8})((?:\.[0-9a-fA-F]{4}){0,14})$/.exec(value)
  if (m) {
    const levels = m[2] ? m[2].slice(1).split('.') : []
    return ('0x' + m[1] + levels.join('')).toLowerCase().padEnd(66, '0')
  }
  return null
}

/** @param {string} chain @param {string} hatId @returns {string} */
export function hatRef(chain, hatId) {
  if (!isEip155(chain)) throw new Error(`${String(chain)} is not an eip155 CAIP-2 chain id`)
  const id = normalHatId(hatId)
  if (id === null) throw new Error(`${String(hatId)} is not a hat id`)
  if (BigInt(id) >> 224n === 0n) throw new Error(`${String(hatId)} has no tree id (its top 32 bits are zero), so it is not a hat id`)
  return `${chain}:${id}`
}

/** @param {unknown} chain @returns {boolean} */
function isEip155(chain) {
  const p = parseCaip2(chain)
  return !!p && p.namespace === 'eip155' && /^[0-9]+$/.test(p.reference)
}

/** @param {unknown} value @returns {{ chain: string, hatId: string } | null} */
export function parseHatRef(value) {
  if (typeof value !== 'string') return null
  const m = /^(eip155:[0-9]+):(0x[0-9a-fA-F]{64})$/.exec(value)
  if (!m || BigInt(m[2]) >> 224n === 0n) return null
  return { chain: m[1], hatId: m[2].toLowerCase() }
}

/** @param {string} chain @param {number | string} treeId @returns {string} e.g. 'eip155:42220:13' */
export function treeRef(chain, treeId) {
  if (!isEip155(chain)) throw new Error(`${String(chain)} is not an eip155 CAIP-2 chain id`)
  const t = treeIdOf(treeId)
  if (t === null) throw new Error(`${String(treeId)} is not a tree id (1 to 4294967295)`)
  return `${chain}:${t}`
}

/** @param {unknown} value @returns {{ chain: string, treeId: number } | null} */
export function parseTreeRef(value) {
  if (typeof value !== 'string') return null
  const m = /^(eip155:[0-9]+):([0-9]+|0x[0-9a-fA-F]{8})$/.exec(value)
  if (!m) return null
  const treeId = treeIdOf(m[2])
  return treeId === null ? null : { chain: m[1], treeId }
}

/** @param {string} hatId @param {number | string} treeId @returns {boolean} */
export function inTree(hatId, treeId) {
  const t = treeIdOf(treeId)
  return t !== null && bigOf(hatId) >> 224n === BigInt(t)
}

/** A call to the Hats v1 contract, prepared and never sent. Only the signature's uint256 positions are converted:
 * there a hat id in any form normalHatId reads, or a hat ref of this call's chain, becomes the number it is.
 * Every other position passes through untouched.
 * @param {string} chain @param {keyof typeof HATS_SIGNATURES} name @param {unknown[]} args @param {string} summary
 * @returns {HatsCall} */
export function hatsCall(chain, name, args, summary) {
  const signature = HATS_SIGNATURES[name]
  if (!signature) throw new Error(`${String(name)} is not a Hats call`)
  const types = signature.slice(signature.indexOf('(') + 1, -1).split(',')
  const converted = args.map((a, i) => {
    if (types[i] !== 'uint256' || typeof a !== 'string') return a
    const ref = parseHatRef(a)
    if (ref) {
      if (ref.chain !== chain) throw new Error(`the hat ${a} is on ${ref.chain}, but this call is on ${chain}`)
      return BigInt(ref.hatId)
    }
    const id = normalHatId(a)
    if (id === null) throw new Error(`${a} is not a hat id (full hex, 0x00000001.0002 form, decimal or a hat ref)`)
    return BigInt(id)
  })
  return { chain, to: caip10(chain, HATS_V1), value: '0', data: encodeCall(signature, converted), operation: 0, summary }
}
