import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface ListboxOption {
  key: string
  /** The option's content: its glyph or monogram, its name, a trailing faint word. */
  content: ReactNode
  /** Why it cannot be picked (drawn faint, `aria-disabled`); it can still be reached, so its reason is heard. */
  disabled?: boolean
  onPick(): void
}

/** The pop listbox the slash menu and the mention picker share (§10.1, §10.4): an eyebrow head that names it, then
 *  its options as menu items. It is one tab stop: the active option is `aria-activedescendant`, so an editor that
 *  keeps the caret can forward its keys here (L6). ↓ ↑ move and hold at the ends, Home and End jump, Enter picks;
 *  a click picks; the pointer makes the option under it active. A disabled option is reached but never picked.
 *  With no option, `empty` is said instead. */
export function Listbox({ head, options, empty, className }: { head: string; options: ListboxOption[]; empty: string; className?: string }) {
  const id = useId()
  const [active, setActive] = useState(0)
  // A query that narrows the list keeps the active option inside it.
  useEffect(() => { setActive(a => Math.min(a, Math.max(options.length - 1, 0))) }, [options.length])
  const pick = (i: number) => { const o = options[i]; if (o && !o.disabled) o.onPick() }
  const onKey = (e: KeyboardEvent) => {
    const last = options.length - 1
    const to = e.key === 'ArrowDown' ? Math.min(active + 1, last) : e.key === 'ArrowUp' ? Math.max(active - 1, 0)
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (to !== null && last >= 0) { e.preventDefault(); setActive(to); return }
    if (e.key === 'Enter') { e.preventDefault(); pick(active) }
  }
  return (
    <div className={['menu', className].filter(Boolean).join(' ')}>
      <div className="mh" id={`${id}-h`}>{head}</div>
      {options.length === 0
        ? <p className="ed-pop-empty">{empty}</p>
        : (
          <ul className="ed-pop-l" role="listbox" tabIndex={0} aria-labelledby={`${id}-h`} aria-activedescendant={`${id}-${active}`} onKeyDown={onKey}>
            {options.map((o, i) => (
              <li key={o.key} id={`${id}-${i}`} role="option" className={i === active ? 'mi on' : 'mi'} aria-selected={i === active}
                aria-disabled={o.disabled || undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
                {o.content}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
