import { useEffect, useRef, type RefObject } from 'react'
import { keyStep, pressOf } from './keys.ts'

/** A row of a roving list: what `useRoving` moves between. */
export const ROW = '[data-row]'

/** A control inside a row that answers Enter or Space itself. */
const CONTROL = 'a[href], button, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="tab"]'

/** Every list is a roving-tabindex composite (§5.8): one tab stop — the row last reached, the first to begin with —
 *  and ↓ / j, ↑ / k move between its rows (`[data-row]` inside `list`), holding at the ends. Enter opens the row
 *  (`onOpen`, else the row's own Enter), Space previews it in the inspector (`onPreview`) — on the row itself (or
 *  plain text in it): a button or a link inside a row keeps its own Enter and Space. Keys typed in a field inside a
 *  row stay in the field. Rows may come and go: the tab stop is placed again after every draw. */
export function useRoving<T extends HTMLElement>(list: RefObject<T | null>, opts: { onOpen?(i: number): void; onPreview?(i: number): void } = {}): void {
  const at = useRef(0)
  const latest = useRef(opts)
  latest.current = opts
  const rows = () => (list.current ? [...list.current.querySelectorAll<HTMLElement>(ROW)] : [])
  const place = () => {
    const all = rows()
    if (all.length === 0) return
    at.current = Math.min(at.current, all.length - 1)
    all.forEach((r, i) => { r.tabIndex = i === at.current ? 0 : -1 })
  }
  useEffect(place)

  useEffect(() => {
    const el = list.current
    if (!el) return
    const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(ROW) : null)
    const onFocus = (e: FocusEvent) => {
      const i = rows().indexOf(rowOf(e.target)!)
      if (i >= 0 && i !== at.current) { at.current = i; place() }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      const all = rows()
      const i = all.indexOf(rowOf(e.target)!)
      const press = pressOf(e)
      if (i < 0 || press.inField || press.meta || press.ctrl) return
      const { onOpen, onPreview } = latest.current
      const control = (e.target as Element).closest(CONTROL)
      const onRow = control === null || control === all[i] || !all[i]!.contains(control)
      if (e.key === 'Enter' && onOpen && onRow) { e.preventDefault(); onOpen(i); return }
      if (e.key === ' ' && onPreview && onRow) { e.preventDefault(); onPreview(i); return }
      const a = keyStep({ pendingG: null }, press, 0).action
      if (a === null || !('move' in a)) return
      e.preventDefault()
      at.current = Math.min(Math.max(i + a.move, 0), all.length - 1)
      place()
      all[at.current]!.focus()
    }
    el.addEventListener('focusin', onFocus)
    el.addEventListener('keydown', onKey)
    return () => { el.removeEventListener('focusin', onFocus); el.removeEventListener('keydown', onKey) }
  }, [list])
}
