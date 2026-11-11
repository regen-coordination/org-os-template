import { Link } from 'wouter'
import { Button } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { useCanWrite } from '../../viewAs/ViewAs.tsx'
import { VisibilityControl, VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import type { MenuEntry } from '../../design/Menu.tsx'
import type { Visibility } from '../../viewAs/visibility.ts'
import { Presence } from '../atoms/Presence.tsx'
import { SaveState, type Save } from './SaveState.tsx'

export interface EditorBarProps {
  /** The page's ancestors, then the page itself (the last, current). */
  path: { label: string; href: string }[]
  /** None on a Hub whose writes are off (plan D-6): nothing there is saved, so no save state is drawn. */
  save?: Save
  /** L6 (R-16a): why the last save was refused, with the "Not saved" state. */
  saveReason?: string
  /** "Someone saved a newer version": Compare opens 0.6's conflict path. */
  onCompare?(): void
  /** Who else has the page open — only people who may see it (§7.12). */
  presence: { handle: string; role: string; editing?: boolean }[]
  visibility: Visibility
  /** Given, the level is a control (§7.10): a choice that narrows applies now, one that widens is proposed. The
   *  caller decides who may change it (Q77; L5 Task 20 wires `effectiveRule(...).direct || .proposable`). */
  onVisibility?(v: Visibility, how: 'applies' | 'propose'): void
  /** DAO-OS L6 Task 20: the levels the page can be given from here (the others are left out, not disabled), and what
   *  follows them in the menu (a private page's "Move into the repository…", or the proposal holding a move). */
  visibilityOffers?(v: Visibility): boolean
  visibilityMore?: MenuEntry[]
  /** A widening in flight ("Members → Public, proposed"), and the parent's level for the menu's header. */
  proposed?: Visibility
  parent?: Visibility
  /** The thread's open comments, on the toggle. */
  comments: number
  onComments(): void
  /** Whether the thread is open, and its id, for the toggle's state. */
  commentsOpen?: boolean
  commentsId?: string
  /** DAO-OS L6 Task 16b (R-L6-SUGGEST): given, Suggest — the edit proposed instead of saved; the caller offers it on a
   *  page in git its viewer may write (R-L6-SUGGEST-2: saved directly or needing approval). `suggestOpen`: its form is open. */
  onSuggest?(): void
  suggestOpen?: boolean
}

/** The page editor's bar (§10.1), 48px: the path (the middle ancestors give way first), then the save state,
 *  presence, the visibility control and the comments toggle with its count. The level is a control only when the
 *  caller passes `onVisibility` and the viewer is not previewing (C-23); otherwise it is the marker. Under 760px of
 *  the editor the path keeps its end and the save state its glyph (workspace.css). */
export function EditorBar(p: EditorBarProps) {
  const canWrite = useCanWrite()
  const last = p.path.length - 1
  return (
    <div className="ed-bar">
      <nav className="crumbs ed-crumbs" aria-label="Page path">
        <ol>
          {p.path.map((step, i) => (
            <li key={step.href}>
              {i === last ? <span aria-current="page">{step.label}</span> : <Link href={step.href}>{step.label}</Link>}
            </li>
          ))}
        </ol>
      </nav>
      <div className="ed-tools">
        {p.save && <SaveState state={p.save} onCompare={p.onCompare} reason={p.saveReason} />}
        <Presence people={p.presence} />
        {canWrite && p.onVisibility
          ? <VisibilityControl value={p.visibility} parent={p.parent} proposed={p.proposed} offers={p.visibilityOffers} more={p.visibilityMore} onChoose={p.onVisibility} />
          : <VisibilityMarker value={p.visibility} proposed={p.proposed} />}
        {canWrite && p.onSuggest && <Button small title="Suggest this edit" expanded={p.suggestOpen ?? false} onClick={p.onSuggest}>Suggest</Button>}
        <button type="button" className="btn ghost ed-cmts" aria-label={`Comments, ${p.comments}`} aria-expanded={p.commentsOpen ?? false}
          aria-controls={p.commentsId} onClick={p.onComments}>
          <Icon name="comment" size="sm" /><span className="ed-cmts-n" aria-hidden="true">{p.comments}</span>
        </button>
      </div>
    </div>
  )
}
