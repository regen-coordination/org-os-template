/** The fund flow's pure parts (§9.8): each band's width and the sentence the chart says. */
import { formatAmount } from '../atoms/chain.ts'

/** One flow in the window: `value` is the exact decimal string in `unit`. Proposed and prepared flows have not moved yet. */
export interface Flow { from: string; to: string; value: string; unit: string; status: 'executed' | 'proposed' | 'prepared' }

/** The places an amount is written to in the chart and its list (§7.7). */
export const FLOW_PLACES = 2

const DECIMAL = /^(\d*)(?:\.(\d*))?$/
/** An unsigned decimal string as an integer scaled by 10^places, or 0 when it is not one (no float touches it). */
function scaled(value: string, places: number): bigint {
  const m = DECIMAL.exec(value.trim())
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return 0n
  return BigInt((m[1] || '0') + (m[2] ?? '').padEnd(places, '0').slice(0, places))
}
const placesOf = (value: string) => value.split('.')[1]?.length ?? 0

/** Each flow's band width, drawn as its stroke-width: 2 + 12 × its value ÷ the largest value, in one unit; a window
 *  that mixes units draws every band 8 (C-31). Rounded to hundredths. */
export function bandWidths(flows: Flow[]): number[] {
  if (new Set(flows.map(f => f.unit)).size > 1) return flows.map(() => 8)
  const places = Math.max(0, ...flows.map(f => placesOf(f.value)))
  const values = flows.map(f => scaled(f.value, places))
  const largest = values.reduce((a, b) => (b > a ? b : a), 0n)
  if (largest === 0n) return flows.map(() => 2)
  // the share in millionths, from integers: exact for any size of value
  return values.map(v => Math.round(2e2 + 12e2 * Number((v * 1_000_000n) / largest) / 1e6) / 1e2)
}

/** A flow's amount as the chart writes it: `1,271.00 USDGLO`. */
export const flowAmount = (f: Flow) => `${formatAmount(f.value, FLOW_PLACES)} ${f.unit}`

/** The chart's whole sentence, its `<title>`: every flow, its amount, where from and to, and its status. */
export function flowSentence(flows: Flow[], window: string): string {
  if (flows.length === 0) return `Nothing moved in ${window}.`
  return `In ${window}: ${flows.map(f => `${flowAmount(f)} from ${f.from} to ${f.to}, ${f.status}`).join('; ')}.`
}
