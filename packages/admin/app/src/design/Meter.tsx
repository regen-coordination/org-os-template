/** Up to this many, a meter is segments; past it, a bar (§7.13). */
const MOST_SEGMENTS = 12

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n)))

/** Each segment's class: done ones ink (`on`), yours moss (`you`, the approval or signature you gave — call C-12),
 *  the rest the track. Yours sit among the done ones, after the first, as the approved gallery draws them: the
 *  meter says that yours is in it, not when it came. */
export function segments(done: number, of: number, yours = 0): ('on' | 'you' | '')[] {
  const total = clamp(of, 0, MOST_SEGMENTS)
  const filled = clamp(done, 0, total)
  const mine = clamp(yours, 0, filled)
  const from = Math.min(1, filled - mine)
  return Array.from({ length: total }, (_, i) => (i >= filled ? '' : i >= from && i < from + mine ? 'you' : 'on'))
}

/** A meter (§7.13): approvals or signatures against what is needed, always followed by its words ("2 of 4
 *  approved", "3 of 4 · you approved"). Up to 12, 12×4 segments; over 12, a 96×4 bar with an ink fill. The meter
 *  itself is hidden from a screen reader: the words say it. */
export function Meter({ done, of, yours, words }: { done: number; of: number; yours?: number; words: string }) {
  const meter = of > MOST_SEGMENTS
    ? <span className="meter bar" aria-hidden="true"><b className="meter-fill" style={{ width: `${Math.round((clamp(done, 0, of) / of) * 100)}%` }} /></span>
    : <span className="meter" aria-hidden="true">{segments(done, of, yours).map((c, i) => <i key={i} className={c || undefined} />)}</span>
  return <span className="meter-w">{meter}<span className="meter-l">{words}</span></span>
}
