import { useId, useState, type ReactNode } from 'react'
import { Button } from '../../design/Button.tsx'
import { monogram } from '../atoms/Presence.tsx'

/** The comment composer (§10.3): the writer's monogram, then a box edged in --edge with the focus ring — the text,
 *  the hint "Only people who can see this page are offered." and the primary **Comment**. ⌘↵ (Ctrl+↵) sends, as the
 *  button does; Enter alone is a new line. What is sent is trimmed, and nothing empty is sent; the box empties once
 *  it is. `picker` is the mention picker, drawn under the box while an `@` is being typed (the caret is L6's). */
export function Composer({ me, onSend, label = 'Comment', picker, autoFocus = false }: {
  me: string; onSend(body: string): void; label?: string; picker?: ReactNode; autoFocus?: boolean
}) {
  const hint = useId()
  const [body, setBody] = useState('')
  const send = () => {
    const text = body.trim()
    if (text === '') return
    onSend(text)
    setBody('')
  }
  return (
    <div className="composer">
      <span className="av av-lg" aria-hidden="true">{monogram(me)}</span>
      <div className="composer-main">
        <div className="composer-box">
          <textarea className="composer-t" aria-label={label} aria-describedby={hint} aria-keyshortcuts="Meta+Enter Control+Enter" rows={2}
            value={body} autoFocus={autoFocus} onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
          <div className="composer-row">
            <span className="composer-hint" id={hint}>Only people who can see this page are offered.</span>
            <Button primary small onClick={send}>Comment</Button>
          </div>
        </div>
        {picker}
      </div>
    </div>
  )
}
