import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type SyntheticEvent } from 'react'

/** How long the pointer or the focus rests before a tooltip shows (§7.3). */
export const TOOLTIP_DELAY_MS = 400

type Handler = (e: SyntheticEvent) => void
type Child = ReactElement<{ 'aria-describedby'?: string; onMouseEnter?: Handler; onMouseLeave?: Handler; onFocus?: Handler; onBlur?: Handler }>

/** A short ink pill above its trigger: after 400ms of hover or focus, gone on leave, blur or Escape. It is
 *  always in the page (hidden), so the trigger's aria-describedby names it even while it is not shown; it
 *  never holds the only copy of something a person needs. `shown` pins it open (for /parts). `off` keeps the
 *  wrapper and says nothing: no description, never shown — a trigger whose reason comes and goes keeps one shape
 *  in the tree, so it is never remounted and focus stays on it (E-57). */
export function Tooltip({ text, children, shown, off = false }: { text: string; children: Child; shown?: boolean; off?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null } }
  const later = () => { clear(); timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS) }
  const hide = () => { clear(); setOpen(false) }
  useEffect(() => clear, [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => { if (off) hide() }, [off])
  const own = children.props
  const trigger = cloneElement(children, {
    'aria-describedby': [own['aria-describedby'], off ? null : id].filter(Boolean).join(' ') || undefined,
    onMouseEnter: e => { own.onMouseEnter?.(e); if (!off) later() },
    onMouseLeave: e => { own.onMouseLeave?.(e); hide() },
    onFocus: e => { own.onFocus?.(e); if (!off) later() },
    onBlur: e => { own.onBlur?.(e); hide() },
  })
  return (
    <span className="tip-wrap">
      {trigger}
      <span role="tooltip" id={id} className="tip popover" hidden={off || !(shown ?? open)}>{off ? '' : text}</span>
    </span>
  )
}
