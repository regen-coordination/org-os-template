import type { ClipboardEvent } from 'react'
import { formatAmount } from './chain.ts'

const NBSP = ' '

/** An amount (§7.7): Mono 500, tabular, a slashed zero; the value then its unit in 400 mute after a no-break
 *  space (`1,271.00 USDGLO`). `value` is the exact decimal string, shown to `decimals` places in the viewer's
 *  locale, a true minus for what goes out; copying what is shown copies that exact string. `body` is 14 (cards,
 *  transaction calls), `large` is Fraunces 32 (the members' side treasury). From an aged read it is mute; a
 *  value not read yet (`null`) is "—" and "not read yet". */
export function Amount({ value, unit, decimals, size = 'row', aged = false }:
  { value: string | null; unit: string; decimals: number; size?: 'row' | 'body' | 'large'; aged?: boolean }) {
  const cls = ['amt', size === 'body' && 'amt-body', size === 'large' && 'amt-display', aged && 'amt-aged', value === null && 'amt-none']
    .filter(Boolean).join(' ')
  if (value === null) return <span className={cls}>—<span className="amt-u">{NBSP}not read yet</span></span>
  const shown = formatAmount(value, decimals)
  const exact = (e: ClipboardEvent<HTMLSpanElement>) => {
    if (!(window.getSelection()?.toString() ?? '').includes(shown)) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', value)
  }
  // "< 0.01" keeps its order under dir="rtl": isolated, the sign stays before the step (E-45).
  const below = shown.includes('< ')
  return <span className={cls} onCopy={exact}><span className="amt-v">{below ? <bdi>{shown}</bdi> : shown}</span><span className="amt-u">{NBSP}{unit}</span></span>
}
