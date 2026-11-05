import { checksumAddress, isAddress } from '../../lib/caip.mjs'

/** The Safe's transfers (rulings Q59, E-85): a read-only GET of the Safe Transaction Service's transfers of one Safe on
 *  one chain, in the last TRANSFER_WINDOW_DAYS days, newest first, at most TRANSFER_PAGES pages of TRANSFER_PAGE_SIZE.
 *  It is made by the Safe driver after the Safe's own reads, on its host, through its guard and its gap, never retried
 *  (C12 review I-3). It never posts and never touches a key. What moves value is kept: the chain's native unit
 *  (`ETHER_TRANSFER`), and ERC-20 tokens the service marks trusted, with their decimals. A zero-value row (the shape of
 *  address poisoning), an untrusted token (spam, a look-alike "USDC"), an NFT, and a row older than the window are left
 *  out: an amount is never guessed, and nothing a stranger can send is drawn as money moved (C12 review I-2). A window
 *  the pages do not hold whole is not read (I-1): the caller says so, never "the last 90 days" of part of them. */
export const TRANSFER_WINDOW_DAYS = 90
export const TRANSFER_PAGE_SIZE = 100
export const TRANSFER_PAGES = 2

/** Chains whose native unit is also an ERC-20 contract: a native movement there may be indexed twice, as an
 *  `ETHER_TRANSFER` and as that contract's `ERC20_TRANSFER`. Celo's CELO is GoldToken. */
export const NATIVE_TOKEN: Readonly<Record<string, string>> = Object.freeze({ 'eip155:42220': '0x471EcE3750Da237f93B8E339c536989b8978a438' })

/** One transfer in or out of the Safe: `value` in base units of `unit` (`decimals` places), `token` the ERC-20 contract
 *  it moved (checksummed) or null for the native unit, `at` its execution time, `from` and `to` checksummed 0x
 *  addresses on `chain` (CAIP-2). Sums key on `token`; `unit` is for display only. */
export interface Transfer { chain: string; from: string; to: string; value: string; unit: string; decimals: number; token: string | null; at: string; txHash: string }

interface ServiceTransfer {
  type?: string; executionDate?: string | null; transactionHash?: string | null; from?: string | null; to?: string | null
  value?: string | null; tokenAddress?: string | null; tokenInfo?: { symbol?: string | null; decimals?: number | null; trusted?: boolean | null } | null
}
interface Page { next?: string | null; results?: ServiceTransfer[] }

/** A window the pages did not hold whole: the service still had a `next` after the last page. */
export class TransfersIncomplete extends Error {}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const DAY_MS = 86_400_000

/** The first instant of the window, as the service's filter takes it: an ISO time to the second. */
export function windowStart(now: Date): string {
  return new Date(now.getTime() - TRANSFER_WINDOW_DAYS * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The service's transfers list of `address` since `since`, one page at `offset`. */
export function transfersUrl(api: string, address: string, since: string, offset = 0): string {
  const q = new URLSearchParams({ limit: String(TRANSFER_PAGE_SIZE), execution_date__gte: since })
  if (offset > 0) q.set('offset', String(offset))
  return `${api}/v1/safes/${address}/transfers/?${q.toString()}`
}

/** One answer row as a Transfer, or null for one that moves no value the Hub can say exactly, or that a stranger could
 *  have sent: zero, an untrusted token, an NFT. `viaToken`: a native movement read through the chain's native token
 *  contract (NATIVE_TOKEN), to be dropped when the same movement is also an `ETHER_TRANSFER`. */
export function transferOf(t: ServiceTransfer, chain: string, native: string): (Transfer & { viaToken?: true }) | null {
  if (typeof t !== 'object' || t === null) return null
  const value = typeof t.value === 'string' && /^\d+$/.test(t.value) && BigInt(t.value) > 0n ? t.value : null
  const at = typeof t.executionDate === 'string' && !Number.isNaN(Date.parse(t.executionDate)) ? t.executionDate : null
  const txHash = typeof t.transactionHash === 'string' && TX_HASH.test(t.transactionHash) ? t.transactionHash : null
  if (value === null || at === null || txHash === null || !isAddress(t.from ?? '') || !isAddress(t.to ?? '')) return null
  const ends = { chain, from: checksumAddress(t.from!), to: checksumAddress(t.to!), value, at, txHash }
  if (t.type === 'ETHER_TRANSFER') return { ...ends, unit: native, decimals: 18, token: null }
  if (t.type !== 'ERC20_TRANSFER' || !isAddress(t.tokenAddress ?? '')) return null
  const token = checksumAddress(t.tokenAddress!)
  if (NATIVE_TOKEN[chain] !== undefined && NATIVE_TOKEN[chain]!.toLowerCase() === token.toLowerCase()) {
    return { ...ends, unit: native, decimals: 18, token: null, viaToken: true }
  }
  if (t.tokenInfo?.trusted !== true) return null
  const d = t.tokenInfo.decimals
  if (typeof d !== 'number' || !Number.isSafeInteger(d) || d < 0) return null
  const symbol = typeof t.tokenInfo.symbol === 'string' ? t.tokenInfo.symbol.trim() : ''
  return { ...ends, unit: symbol || `${token.slice(0, 6)}…${token.slice(-4)}`, decimals: d, token }
}

/**
 * The transfers of the Safe `address` on `chain` in the window ending `now`, newest first. `get` is the Safe driver's
 * paced getter (one that does not retry); `timeLeftMs`, the read's time left, stops before a page that could not finish
 * in it. Throws when a page cannot be read, and `TransfersIncomplete` when the service still has more after the last
 * page: either way the driver says the transfers were not read. Rows before the window are dropped here too, whatever
 * the service's filter did.
 */
export async function readTransfers(get: (url: string) => Promise<unknown>, at: { api: string; address: string; chain: string; native: string },
  now: Date, timeLeftMs: () => number, needMs: number): Promise<Transfer[]> {
  const since = windowStart(now)
  const from = Date.parse(since)
  const out: (Transfer & { viaToken?: true })[] = []
  for (let page = 0; ; page++) {
    if (page === TRANSFER_PAGES) throw new TransfersIncomplete(`more than ${TRANSFER_PAGES * TRANSFER_PAGE_SIZE} transfers in the window`)
    if (timeLeftMs() < needMs) throw new Error('no time was left in this read for the transfers')
    const answer = (await get(transfersUrl(at.api, at.address, since, page * TRANSFER_PAGE_SIZE))) as Page
    if (typeof answer !== 'object' || answer === null || !Array.isArray(answer.results)) throw new Error('the transfers were answered in a shape the Hub does not read')
    for (const row of answer.results) {
      const t = transferOf(row, at.chain, at.native)
      if (t && Date.parse(t.at) >= from) out.push(t)
    }
    if (!answer.next) break
  }
  // a native movement read both ways is one movement: keep the ETHER_TRANSFER
  const same = (t: Transfer) => [t.txHash.toLowerCase(), t.from, t.to, t.value].join(' ')
  const direct = new Set(out.filter(t => !t.viaToken).map(same))
  return out.filter(t => !(t.viaToken && direct.has(same(t)))).map(({ viaToken: _, ...t }) => t)
}

/** Several chains' transfers as one list, newest first. */
export const newestFirst = (ts: Transfer[]): Transfer[] => [...ts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
