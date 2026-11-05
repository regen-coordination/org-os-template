/** The fund flow from what the Hub reads (§9.8; rulings Q59): the Safe's executed transfers in the window (the Safe
 *  driver's `facts.transfers`) and the prepared calls that still wait on signers, as the FundFlow element's flows. */
import type { DriverRead } from '../../api.ts'
import { list, num, str } from '../rows/systemState.ts'
import { shortAddress, unitsToDecimal } from '../atoms/chain.ts'
import type { Flow } from './fundflow.ts'
import type { PreparedView } from './prepared.ts'

/** How the flow names its ends: `safe`, the Safe's own name (the chart's centre); `nameOf`, a counterparty's name when
 *  the Hub knows it (another System at that address), else its short address. */
export interface FlowNames { safe: string; nameOf?: (address: string, chain: string) => string | null }

/** The transfers a Safe's read holds: `[]` when it read none in the window, null when they could not be read (or the
 *  read is not a Safe's). */
export function transfersOf(read: DriverRead | null): Record<string, unknown>[] | null {
  if (!read?.ok) return null
  const t = read.facts.transfers
  return Array.isArray(t) ? list(t) : null
}

const WHOLE = /^\d+$/

/** One running sum of a flow, exact: base units as a BigInt, in one unit at one count of decimals. */
interface Sum { from: string; to: string; unit: string; decimals: number; raw: bigint; status: Flow['status'] }

/**
 * The flows of a window: each counterparty's transfers in or out of the Safe, added up per asset (executed), then each
 * waiting prepared call that moves value, added up per destination and asset (prepared). A sum keys on the counterparty's
 * address and the asset's own identity (its chain and token contract, or the chain's native unit), never on a name or a
 * symbol: a look-alike address or a token calling itself "USDC" is never added to the real one (C12 review I-2); the
 * symbol is only how the amount is written. Amounts are added in base units and written as exact decimals
 * (`unitsToDecimal`), so nothing is lost to a float. A zero amount, a transfer between two other accounts, or from the
 * Safe to itself, is not a flow of this Safe. Executed prepared transactions are not added: they are in the transfers
 * once the chain has them.
 */
export function flowsOf(read: DriverRead | null, prepared: PreparedView[], names: FlowNames = { safe: 'Safe' }): Flow[] {
  const own = new Set<string>()
  const address = str(read?.facts.address)
  if (address) own.add(address.toLowerCase())
  for (const c of list(read?.facts.chains)) {
    const at = str(c.account)?.split(':').at(-1)
    if (at) own.add(at.toLowerCase())
  }
  const label = (account: string, chain: string) => names.nameOf?.(account, chain) ?? shortAddress(account)
  const sums = new Map<string, Sum>()
  /** `who`: the counterparty's address and the direction; `asset`: the chain and token (or `native`). */
  const add = (s: Omit<Sum, 'raw'>, who: string, asset: string, raw: bigint) => {
    const key = [s.status, who.toLowerCase(), asset.toLowerCase(), s.decimals].join('\u0000')
    const was = sums.get(key)
    sums.set(key, { ...s, raw: (was?.raw ?? 0n) + raw })
  }

  for (const t of transfersOf(read) ?? []) {
    const from = str(t.from), to = str(t.to), chain = str(t.chain) ?? '', unit = str(t.unit), decimals = num(t.decimals)
    const value = typeof t.value === 'string' && WHOLE.test(t.value) && BigInt(t.value) > 0n ? t.value : null
    if (!from || !to || !unit || decimals === null || value === null) continue
    const inbound = own.has(to.toLowerCase()), outbound = own.has(from.toLowerCase())
    if (inbound === outbound) continue
    const asset = `${chain}:${str(t.token) ?? 'native'}`
    add({ status: 'executed', from: inbound ? label(from, chain) : names.safe, to: inbound ? names.safe : label(to, chain), unit, decimals },
      inbound ? `in:${from}` : `out:${to}`, asset, BigInt(value))
  }

  for (const tx of prepared) {
    if (tx.state === 'executed') continue
    for (const call of tx.calls) {
      const amount = call.amount
      if (!amount || !WHOLE.test(amount.raw) || BigInt(amount.raw) === 0n) continue
      const to = call.to.split(':').at(-1) ?? call.to
      if (own.has(to.toLowerCase())) continue
      // the Hub prepared this amount itself (its chain's native unit today, preparedFromProposal): its unit is its own
      add({ status: 'prepared', from: names.safe, to: label(to, tx.safe.chain), unit: amount.unit, decimals: amount.decimals },
        `out:${to}`, `${tx.safe.chain}:${amount.unit}`, BigInt(amount.raw))
    }
  }

  return [...sums.values()].map(s => ({ from: s.from, to: s.to, value: unitsToDecimal(s.raw.toString(), s.decimals), unit: s.unit, status: s.status }))
}
