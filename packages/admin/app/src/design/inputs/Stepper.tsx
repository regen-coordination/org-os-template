import { useId } from 'react'
import { buttonClass } from '../Button.tsx'
import { Icon } from '../Icon.tsx'

/** A whole number within min..max (a threshold, §7.2): − the number + and "of N" after it, the input described by
 *  that "of N". Whatever is typed or stepped is held to the range. A step button at its end stays focusable and says
 *  why it stops ("No more than 8", aria-disabled): a disabled one would drop the focus of whoever pressed it to
 *  its end (L4a final review M-13). The two buttons are drawn here rather than with Button's `unavailable`, which
 *  wraps a button in its tooltip only while it is unavailable: the button would be drawn anew, and focus lost the same. */
export function Stepper({ value, min, max, of, label, onChange }:
  { value: number; min: number; max: number; of?: number; label: string; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))
  const id = useId()
  const step = (by: -1 | 1) => {
    const end = by < 0 ? value <= min : value >= max
    const why = `${id}-${by < 0 ? 'min' : 'max'}`
    const icon = by < 0 ? 'minus' : 'plus'
    return (
      <>
        <button type="button" className={buttonClass({ icon, iconOnly: true })} aria-label={by < 0 ? 'Fewer' : 'More'}
          aria-disabled={end || undefined} aria-describedby={end ? why : undefined}
          onClick={() => { if (!end) onChange(clamp(value + by)) }}>
          <Icon name={icon} size="sm" />
        </button>
        {end && <span id={why} className="sr-only">{by < 0 ? `No fewer than ${min}` : `No more than ${max}`}</span>}
      </>
    )
  }
  return (
    <span className="stepper" role="group" aria-label={label}>
      {step(-1)}
      <input className="input" type="number" inputMode="numeric" min={min} max={max} step={1} value={value} aria-label={label}
        aria-describedby={of !== undefined ? `${id}-of` : undefined}
        onChange={e => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(clamp(n)) }} />
      {step(1)}
      {of !== undefined && <span id={`${id}-of`} className="stepper-of">of {of}</span>}
    </span>
  )
}
