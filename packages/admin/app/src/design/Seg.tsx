import type { KeyboardEvent } from 'react'
import { Icon, type IconName } from './Icon.tsx'

/** The next button along, for an arrow key; right-to-left pages read the arrows the other way. */
export function stepOf(key: string, el: Element): -1 | 0 | 1 {
  const back = getComputedStyle(el).direction === 'rtl'
  if (key === 'ArrowRight' || key === 'ArrowDown') return back && key === 'ArrowRight' ? -1 : 1
  if (key === 'ArrowLeft' || key === 'ArrowUp') return back && key === 'ArrowLeft' ? 1 : -1
  return 0
}

/** The segmented control (§7.3): `List · Map`, Appearance. A labelled group of toggle buttons on a wash
 *  track, the pressed one raised; the arrows move between them. */
export function Seg<T extends string>({ label, options, value, onChange, icons, describedBy }:
  { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; icons?: Partial<Record<T, IconName>>
    /** The ids of what describes the choice (a form field's help and error). */
    describedBy?: string }) {
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    const step = stepOf(e.key, e.currentTarget)
    const buttons = [...e.currentTarget.querySelectorAll('button')]
    const at = buttons.indexOf(e.target as HTMLButtonElement)
    if (step === 0 || at < 0) return
    e.preventDefault()
    buttons[(at + step + buttons.length) % buttons.length]!.focus()
  }
  return (
    <span className="seg" role="group" aria-label={label} aria-describedby={describedBy} onKeyDown={onKeyDown}>
      {options.map(o => {
        const glyph = icons?.[o.value]
        return (
          <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {glyph && <Icon name={glyph} size="sm" />}{o.label}
          </button>
        )
      })}
    </span>
  )
}
