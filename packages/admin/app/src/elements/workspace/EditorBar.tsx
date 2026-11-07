import { Link } from 'wouter'
import { Icon } from '../../design/Icon.tsx'
import { useCanWrite } from '../../viewAs/ViewAs.tsx'
import { VisibilityControl, VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import type { Visibility } from '../../viewAs/visibility.ts'
import { Presence } from '../atoms/Presence.tsx'
import { SaveState, type Save } from './SaveState.tsx'

export interface EditorBarProps {
  /** The page's ancestors, then the page itself (the last, current). */
  path: { label: string; href: string }[]
  save: Save
  /** "Someone saved a newer version": Compare opens 0.6's conflict path. */
  onCompare?(): void
  /** Who else has the page open — only people who may see it (§7.12). */
  presence: { handle: string; role: string; editing?: boolean }[]
  visibility: Visibility
  /** Given, the level is a control (§7.10): a choice that narrows applies now, one that widens is proposed. The
   *  caller decides who may change it (Q77; L5 Task 20 wires `effectiveRule(...).direct || .proposable`). */
  onVisibility?(v: Visibility, how: 'applies' | 'propose'): void
  /** A widening in flight ("Members → Public, proposed"), and the parent's level for the menu's header. */
  proposed?: Visibility
  parent?: Visibility
  /** The thread's open comments, on the toggle. */
  comments: number
  onComments(): void
  /** Whether the thread is open, and its id, for the toggle's state. */
  commentsOpen?: boolean
  commentsId?: string
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
        <SaveState state={p.save} onCompare={p.onCompare} />
        <Presence people={p.presence} />
        {canWrite && p.onVisibility
          ? <VisibilityControl value={p.visibility} parent={p.parent} proposed={p.proposed} onChoose={p.onVisibility} />
          : <VisibilityMarker value={p.visibility} proposed={p.proposed} />}
        <button type="button" className="btn ghost ed-cmts" aria-label={`Comments, ${p.comments}`} aria-expanded={p.commentsOpen ?? false}
          aria-controls={p.commentsId} onClick={p.onComments}>
          <Icon name="comment" size="sm" /><span className="ed-cmts-n" aria-hidden="true">{p.comments}</span>
        </button>
      </div>
    </div>
  )
}
