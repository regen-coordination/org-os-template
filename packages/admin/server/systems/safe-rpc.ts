import { addressOf, checksumAddress, isAddress } from '../../lib/caip.mjs'
import { decodeResult, encodeCall } from '../../lib/abi.mjs'
import { chainInfo } from './chains.ts'
import type { DriverContext } from './driver.ts'

/** A Safe read from the chain by `eth_call` (L7-D15), for when the Safe Transaction Service cannot answer: a Safe it has
 *  not indexed (404, a fork included), or its keyless quota (403, 429). Only eth_blockNumber, eth_getCode and eth_call
 *  go out, in one JSON-RPC batch; the Safe's storage is read through its own `getStorageAt` view (StorageAccessible). */

/** GuardManager's GUARD_STORAGE_SLOT: keccak256("guard_manager.guard.address") (safe-smart-account v1.4.1). */
export const GUARD_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8'
/** FallbackManager's FALLBACK_HANDLER_STORAGE_SLOT: keccak256("fallback_manager.handler.address") (safe-smart-account v1.4.1). */
export const FALLBACK_HANDLER_SLOT = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5'
/** ModuleManager's SENTINEL_MODULES: where the modules list starts. */
const SENTINEL_MODULES = '0x0000000000000000000000000000000000000001'
/** Modules asked for in the one page read. */
export const MODULES_PAGE = 10

export interface SafeOnChainRead {
  chain: string; address: string; owners: string[]; threshold: number; nonce: number; version: string
  /** null: not known (an older Safe without getModulesPaginated); then also named in `unknown`. */
  modules: string[] | null
  /** null: none set, or not known when `unknown` names it (an older Safe without getStorageAt). */
  guard: string | null; fallbackHandler: string | null; singleton: string | null; block: number
  /** The optional views the Safe did not answer, so their fields are not known. Absent when every view answered. */
  unknown?: ('modules' | 'guard' | 'fallbackHandler' | 'singleton')[]
}

/** What a read from the chain could not take for a Safe. `missing`: no code at the address, which the chain says for
 *  certain; otherwise the contract there does not answer a Safe's own views. */
export type NotASafe = { ok: false; error: string; missing?: true }

/** The Safe's views read, each with what it answers. The first four every Safe has: one that does not answer them is
 *  not a Safe. The rest an older Safe may lack (getModulesPaginated from 1.1.0, getStorageAt from 1.1.0); their field
 *  is then not known. Slot 0 holds the singleton (the proxy's `masterCopy`). */
const VIEWS = [
  { name: 'getOwners()', data: encodeCall('getOwners()', []), types: ['address[]'] },
  { name: 'getThreshold()', data: encodeCall('getThreshold()', []), types: ['uint256'] },
  { name: 'nonce()', data: encodeCall('nonce()', []), types: ['uint256'] },
  { name: 'VERSION()', data: encodeCall('VERSION()', []), types: ['string'] },
  { name: 'getModulesPaginated(address,uint256)', field: 'modules', data: encodeCall('getModulesPaginated(address,uint256)', [SENTINEL_MODULES, BigInt(MODULES_PAGE)]), types: ['address[]', 'address'] },
  { name: 'getStorageAt(guard)', field: 'guard', data: encodeCall('getStorageAt(uint256,uint256)', [BigInt(GUARD_SLOT), 1n]), types: ['bytes'] },
  { name: 'getStorageAt(fallback handler)', field: 'fallbackHandler', data: encodeCall('getStorageAt(uint256,uint256)', [BigInt(FALLBACK_HANDLER_SLOT), 1n]), types: ['bytes'] },
  { name: 'getStorageAt(singleton)', field: 'singleton', data: encodeCall('getStorageAt(uint256,uint256)', [0n, 1n]), types: ['bytes'] },
] as const

type RpcAnswer = { id?: unknown; result?: unknown; error?: { message?: unknown } }

/** The address in one storage word (`getStorageAt(slot, 1)`'s 32 bytes); null for zero. Throws for a word that is not 32
 *  bytes (the caller reads that as not known). */
function slotAddress(word: unknown): string | null {
  if (typeof word !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(word)) throw new Error('a storage word is not 32 bytes')
  const address = `0x${word.slice(-40)}`
  return /^0x0{40}$/.test(address) ? null : checksumAddress(address)
}

/**
 * The Safe at `address` on `chain`, read from the chain: owners, threshold, nonce, version, modules (the first page),
 * guard, fallback handler and singleton, at one block. No code at the address is `ok: false` "no Safe at this address on
 * <chain>"; a contract that does not answer a Safe's views is `ok: false` too. A node that cannot be reached or gives no
 * answer throws. Reads only; nothing is signed or sent.
 */
export async function readSafeOnChain(ctx: DriverContext, chain: string, address: string): Promise<SafeOnChainRead | NotASafe> {
  const name = chainInfo(chain)?.name ?? chain
  if (!isAddress(address)) throw new Error(`"${address}" is not a Safe address`)
  const url = ctx.rpcUrl?.(chain) ?? null
  if (!url) throw new Error(`no RPC host is known for chain ${chain}`)
  if (!ctx.postJson) throw new Error('this reader was given no network access')
  const host = new URL(url).host
  const to = checksumAddress(address)
  const batch = [
    { jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] },
    { jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [to, 'latest'] },
    ...VIEWS.map((v, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'eth_call', params: [{ to, data: v.data }, 'latest'] })),
  ]
  const answer = await ctx.postJson(url, batch)
  if (!Array.isArray(answer)) throw new Error(`${host} did not answer a JSON-RPC batch`)
  const byId = new Map<unknown, RpcAnswer>()
  for (const a of answer as RpcAnswer[]) if (a && typeof a === 'object') byId.set(a.id, a)
  const result = (id: number, what: string): string => {
    const a = byId.get(id)
    if (!a || a.error || typeof a.result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(a.result)) throw new Error(`${host} gave no answer for ${what}`)
    return a.result
  }
  const block = Number(BigInt(result(0, 'the block number')))
  if (/^0x0*$/.test(result(1, 'the code at the address'))) return { ok: false, error: `no Safe at this address on ${name}`, missing: true }

  /** One view's decoded answer; null when it reverted or its answer cannot be read. */
  const decoded: (unknown[] | null)[] = VIEWS.map((view, i) => {
    const a = byId.get(i + 2)
    if (!a) throw new Error(`${host} gave no answer for ${view.name}`)
    if (a.error || typeof a.result !== 'string' || a.result === '0x') return null
    try { return decodeResult([...view.types], a.result) } catch { return null }
  })
  const required = VIEWS.findIndex((view, i) => !('field' in view) && decoded[i] === null)
  if (required >= 0) return { ok: false, error: `the contract at this address on ${name} is not a Safe the Hub can read (${VIEWS[required]!.name} reverted)` }
  const [[owners], [threshold], [nonce], [version]] = decoded as [[string[]], [string], [string], [string]]
  const unknown: NonNullable<SafeOnChainRead['unknown']> = []
  /** An optional view's field: its value, or null and named in `unknown` when the Safe did not answer it. */
  const optional = <T>(i: number, field: NonNullable<SafeOnChainRead['unknown']>[number], read: (answer: unknown[]) => T): T | null => {
    const answer = decoded[i]
    if (answer !== null) { try { return read(answer) } catch { /* not known */ } }
    unknown.push(field)
    return null
  }
  const modules = optional(4, 'modules', a => (a[0] as string[]).map(m => addressOf(m)))
  const guard = optional(5, 'guard', a => slotAddress(a[0]))
  const fallbackHandler = optional(6, 'fallbackHandler', a => slotAddress(a[0]))
  const singleton = optional(7, 'singleton', a => slotAddress(a[0]))
  return {
    chain, address: to, owners: owners.map(o => addressOf(o)), threshold: Number(threshold), nonce: Number(nonce), version,
    modules, guard, fallbackHandler, singleton, block, ...(unknown.length > 0 ? { unknown } : {}),
  }
}

/** Whether a read from the chain found a Safe. */
export const isSafeRead = (r: SafeOnChainRead | NotASafe): r is SafeOnChainRead => !('ok' in r)
