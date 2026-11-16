import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../../design/Button.tsx'
import { monogram } from '../atoms/Presence.tsx'
import { expandMentions, mentionQuery, type MentionPick } from './mentions.ts'

/** The keys an open mention picker takes from the box (its listbox is driven by its active descendant). */
const PICKER_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']

/** The comment composer (§10.3): the writer's monogram, then a box edged in --edge with the focus ring — the text,
 *  the hint "Only people who can see this page are offered." and the primary **Comment**. ⌘↵ (Ctrl+↵) sends, as the
 *  button does; Enter alone is a new line. What is sent is trimmed, and nothing empty is sent; the box empties once
 *  it is. `picker` is the mention picker, drawn under the box while an `@` is being typed (the caret is L6's).
 *
 *  DAO-OS L6 Task 18: `mention` draws the picker for what is typed after an `@` before the caret (`q`); its `pick`
 *  writes `@<label>` in the box, and the comment is sent with each picked `@<label>` as its mention's Markdown
 *  (`expandMentions`). While it is drawn, ↓ ↑ Home End and Enter go to its listbox, and Escape puts it away until the
 *  text changes. */
export function Composer({ me, name, onSend, label = 'Comment', picker, autoFocus = false, mention }: {
  /** `name`: who the viewer is (the one display name, walk fix wave 4 G9), the monogram's letters; else `me`. */
  me: string; name?: string; onSend(body: string): void; label?: string; picker?: ReactNode; autoFocus?: boolean
  mention?: (q: string, pick: (label: string, markdown: string) => void) => ReactNode
}) {
  const hint = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState('')
  const [caret, setCaret] = useState(0)
  const [away, setAway] = useState(false)
  const picks = useRef<MentionPick[]>([])
  const q = mention && !away ? mentionQuery(body, caret) : null
  const send = () => {
    const text = expandMentions(body, picks.current).trim()
    if (text === '') return
    onSend(text)
    setBody('')
    setCaret(0)
    picks.current = []
  }
  const pick = (name: string, markdown: string) => {
    if (q === null) return
    const at = caret - q.length - 1
    const written = `@${name} `
    picks.current = [...picks.current.filter(p => p.label !== name), { label: name, markdown }]
    setBody(body.slice(0, at) + written + body.slice(caret))
    setCaret(at + written.length)
    const t = box.current
    if (t) {
      t.focus()
      requestAnimationFrame(() => { try { t.setSelectionRange(at + written.length, at + written.length) } catch { /* gone */ } })
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return }
    if (q === null) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAway(true); return }
    const list = pop.current?.querySelector<HTMLElement>('.ed-pop-l')
    if (!list || !PICKER_KEYS.includes(e.key)) return
    e.preventDefault()
    list.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }))
  }
  return (
    <div className="composer">
      <span className="av av-lg" aria-hidden="true">{monogram(name ?? me)}</span>
      <div className="composer-main">
        <div className="composer-box">
          <textarea ref={box} className="composer-t" aria-label={label} aria-describedby={hint} aria-keyshortcuts="Meta+Enter Control+Enter" rows={2}
            value={body} autoFocus={autoFocus}
            onChange={e => { setBody(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setAway(false) }}
            onSelect={e => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown} />
          <div className="composer-row">
            <span className="composer-hint" id={hint}>Only people who can see this page are offered.</span>
            <Button primary small onClick={send}>Comment</Button>
          </div>
        </div>
        {picker}
        {q !== null && mention && <div ref={pop} className="composer-pop" onMouseDown={e => e.preventDefault()}>{mention(q, pick)}</div>}
      </div>
    </div>
  )
}
