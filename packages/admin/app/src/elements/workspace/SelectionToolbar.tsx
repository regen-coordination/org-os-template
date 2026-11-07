import { useRef, useState, type KeyboardEvent } from 'react'
import { Icon, type IconName } from '../../design/Icon.tsx'

export type FormatMark = 'bold' | 'italic' | 'heading'

/** The toolbar's buttons, in order: the three toggles, then the three actions after a separator. */
const TOGGLES: { mark: FormatMark; label: string; icon: IconName }[] = [
  { mark: 'bold', label: 'Bold', icon: 'bold' }, { mark: 'italic', label: 'Italic', icon: 'italic' }, { mark: 'heading', label: 'Heading', icon: 'heading' },
]

/** The floating selection toolbar (§10.1): on --pop, radius 10 — bold, italic, heading (toggles, `aria-pressed`) ·
 *  link, mention, comment. One tab stop (the button last reached): ← → move along it and hold at the ends, Home and
 *  End jump. Where it floats, and what each does to the text, is the editor's (L6). */
export function SelectionToolbar({ marks, onToggle, onLink, onMention, onComment }: {
  marks: Record<FormatMark, boolean>; onToggle(m: FormatMark): void; onLink(): void; onMention(): void; onComment(): void
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const actions: { label: string; icon: IconName; act(): void }[] = [
    { label: 'Link', icon: 'link', act: onLink }, { label: 'Mention', icon: 'at', act: onMention }, { label: 'Comment', icon: 'comment', act: onComment },
  ]
  const count = TOGGLES.length + actions.length
  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' ? Math.min(at + 1, count - 1) : e.key === 'ArrowLeft' ? Math.max(at - 1, 0)
      : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null
    if (to === null) return
    e.preventDefault()
    setAt(to)
    bar.current?.querySelectorAll<HTMLButtonElement>('button')[to]?.focus()
  }
  const button = (i: number, label: string, icon: IconName, act: () => void, pressed?: boolean) => (
    <button key={label} type="button" className={pressed ? 'selbar-b on' : 'selbar-b'} aria-label={label} aria-pressed={pressed}
      tabIndex={i === at ? 0 : -1} onFocus={() => setAt(i)} onClick={act}>
      <Icon name={icon} size="sm" />
    </button>
  )
  return (
    <div ref={bar} className="selbar" role="toolbar" aria-label="Format" onKeyDown={onKey}>
      {TOGGLES.map((t, i) => button(i, t.label, t.icon, () => onToggle(t.mark), marks[t.mark]))}
      <span className="selbar-sep" aria-hidden="true" />
      {actions.map((a, i) => button(TOGGLES.length + i, a.label, a.icon, a.act))}
    </div>
  )
}
