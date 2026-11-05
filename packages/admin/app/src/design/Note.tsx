import { useEffect, useRef, type ReactNode } from 'react'
import { announce } from '../parts/live.tsx'
import { Icon, type IconName } from './Icon.tsx'
import { Spinner } from './Spinner.tsx'

export type NoteState = 'empty' | 'loading' | 'error' | 'notYet' | 'unavailable'

/** Each state's glyph (§7.4); loading turns the reading ring instead. */
const GLYPH: Record<NoteState, IconName | null> = { empty: 'dashed-circle', loading: null, error: 'alert', unavailable: 'clock', notYet: 'info' }

/** The one line every block and page shows in place of content (spec §6.2, §7.4): a glyph and a 13px
 *  sentence — faint for empty and not yet, mute for loading and unavailable, clay for an error. Unavailable
 *  and not yet are notes. An error is not an alert: role="alert" is the compose canvas's refused connection and the
 *  tray's failed Apply and Propose only (§13). It is said once through the page's one polite region when it appears
 *  and each time its words change (C11 ruling I-1); `quiet` where the page already says those words itself, so they
 *  are never said twice. The sentence is shown as given; nothing is prefixed. An action follows the sentence as an
 *  underlined ink link. */
export function Note({ state, children, action, quiet = false }: { state: NoteState; children: ReactNode; action?: ReactNode; quiet?: boolean }) {
  const role = state === 'unavailable' || state === 'notYet' ? 'note' : undefined
  const glyph = GLYPH[state]
  const words = useRef<HTMLSpanElement>(null)
  const said = useRef<string | null>(null)
  useEffect(() => {
    if (state !== 'error' || quiet) { said.current = null; return }
    // its sentence, without the action that follows it ("Try again" is a control, not words to say)
    const all = words.current?.textContent ?? '', act = words.current?.querySelector('.note-act')?.textContent ?? ''
    const text = (act !== '' && all.endsWith(act) ? all.slice(0, -act.length) : all).trim()
    if (text !== '' && text !== said.current) { said.current = text; announce(text) }
  })
  return (
    <p className={`note note-${state}`} role={role}>
      {glyph ? <Icon name={glyph} size="sm" /> : <Spinner />}
      <span className="note-t" ref={words}>{children}{action && <> <span className="note-act">{action}</span></>}</span>
    </p>
  )
}

/** The empty state of a whole section (§6.2): a dashed box with one ink line, one faint line of what fills
 *  it, and at most one action. `heading`: the ink line is the page's h1 (the not-found page, §14.1), so a route
 *  change lands on it (§5.11). */
export function NoteBlock({ title, line, action, heading = false }: { title: string; line?: ReactNode; action?: ReactNode; heading?: boolean }) {
  return (
    <div className="note-block">
      {heading ? <h1 className="note-block-t">{title}</h1> : <p className="note-block-t">{title}</p>}
      {line && <p className="note-block-l">{line}</p>}
      {action}
    </div>
  )
}
