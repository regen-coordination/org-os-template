import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Button } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { useFrame } from '../../design/Shell.tsx'
import { ageText } from '../../time.ts'
import { useCanConverse, useCanWrite } from '../../viewAs/ViewAs.tsx'
import { VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import type { Visibility } from '../../viewAs/visibility.ts'
import { monogram } from '../atoms/Presence.tsx'
import { Composer } from './Composer.tsx'

/** A comment (§10.3): conversation, not a write — it has no save state, only its own sending state. `at` is an ISO
 *  time. `anchor` is the passage of the page it is about: the page marks it (`Commented`), the comment quotes it. */
export interface Comment {
  id: string
  handle: string
  role: string
  at: string
  body: string
  state: 'sent' | 'sending' | 'not-sent'
  replies: Comment[]
  resolved?: { by: string }
  anchor?: { id: string; text: string }
  /** DAO-OS L6 (as the Hub serves a comment, §8.2): the passage it was on is no longer in the page — quoted, not a link. */
  unanchored?: { text: string; note: string }
  /** Deleted by its author: the body is gone and `note` ("Deleted") is said instead. */
  deleted?: { note: string }
  /** DAO-OS L6 Task 18: lines said under the comment — who was not told of a mention, the task it became (with its link),
   *  why it was not sent or an act on it was refused. */
  notes?: CommentNote[]
  /** DAO-OS L6 Task 18 fix round 1: the task it was turned into; Turn into a task is not offered again. */
  task?: string
}

/** A line under a comment (DAO-OS L6 Task 18), a link when `href` is given. */
export interface CommentNote { text: string; href?: string; link?: string; tone?: 'bad' }

/** The thread's two forms (§10.3), by the frame's own width: a panel beside the page at 1200 and over, a sheet
 *  below (CC-13: 1200 is one of FRAME_BREAKS). */
export type ThreadForm = 'panel' | 'sheet'
export const threadForm = (width: number): ThreadForm => (width >= 1200 ? 'panel' : 'sheet')

export interface CommentThreadProps {
  comments: Comment[]
  /** The level of the thing the comments are on: comments follow it (§10.3). */
  visibility: Visibility
  /** A new comment, or (with `replyTo`) a reply to one. */
  onSend(body: string, replyTo?: string): void
  onRetry(id: string): void
  onDiscard(id: string): void
  onResolve(id: string): void
  /** Turn into a task: a workspace write (§10.3). */
  onTask(id: string): void
  /** The viewer's handle: their comments say "You". */
  me?: string
  /** Who the viewer is (the one display name, walk fix wave 4 G9): the composer's monogram. */
  meName?: string
  now?: Date
  /** Left out, the frame's (`threadForm`); a /parts specimen names it. */
  form?: ThreadForm
  /** The sheet's ×, Esc and a tap on its scrim. */
  onClose?(): void
  /** A sheet drawn open in place, not modal: a /parts specimen. */
  inline?: boolean
  /** The thread's id, for the editor bar's toggle (`commentsId`). */
  id?: string
  // --- DAO-OS L6 Task 18: the thread wired to the Hub
  /** Show the passage an anchored comment is about, in the page's own editor (L4c C3's carry: the Hub wires this; left
   *  out, a /parts specimen's marked text is found). */
  onShowPassage?(anchor: { id: string; text: string }): void
  /** Draws a comment's body (the Hub's inline subset: mentions and links); left out, its text. */
  renderBody?(c: Comment): ReactNode
  /** Reopen a resolved comment; given, the resolved line offers it. */
  onReopen?(id: string): void
  /** Delete the viewer's own comment; given, their comments offer it. */
  onDelete?(id: string): void
  /** The passage the next comment will be on (the page's selection), drawn over the composer with a way to drop it. */
  quote?: { text: string; onDrop(): void }
  /** The composers' mention picker (Composer's `mention`). */
  mention?: (q: string, pick: (label: string, markdown: string) => void) => ReactNode
  // --- end L6 Task 18
}

/** Scroll the page to the passage a comment is about, and mark it as the one shown. */
function showPassage(anchor: string): void {
  const marks = [...document.querySelectorAll<HTMLElement>('mark[data-anchor]')]
  const target = marks.find(m => m.getAttribute('data-anchor') === anchor)
  if (!target) return
  for (const m of marks) m.classList.toggle('on', m === target)
  target.scrollIntoView({ block: 'center' })
}

const STATE_WORD = { sending: 'Sending…', 'not-sent': 'Not sent' } as const

/** One comment: the 28px monogram, who (13/500; "You" for the viewer), when (12 faint) or its sending state, the
 *  passage it is about, the body (14/1.5), and its actions. */
function CommentItem({ c, reply, me, now, acts, show, body }: {
  c: Comment; reply: boolean; me?: string; now: Date; acts: ReactNode
  show(anchor: { id: string; text: string }): void; body?(c: Comment): ReactNode
}) {
  const who = c.handle === me ? 'You' : c.role
  const age = ageText(c.at, now)
  return (
    <article className={`cmt cmt-${c.state}${reply ? ' cmt-reply' : ''}`} aria-label={`${who}, ${c.state === 'sent' ? age : STATE_WORD[c.state]}`}>
      <span className="av av-lg" aria-hidden="true">{monogram(c.role)}</span>
      <div className="cmt-main">
        <div className="cmt-h">
          <span className="cmt-who">{who}</span>
          {c.state === 'sent' && <time className="cmt-at" dateTime={c.at} title={c.at}>{age}</time>}
          {c.state === 'sending' && <span className="cmt-state">{STATE_WORD.sending}</span>}
          {c.state === 'not-sent' && <span className="cmt-state save-bad"><Icon name="alert" size="xs" />{STATE_WORD['not-sent']}</span>}
        </div>
        {c.anchor && (
          <button type="button" className="cmt-q" aria-label={`Show the passage: “${c.anchor.text}”`} onClick={() => show(c.anchor!)}>
            “{c.anchor.text}”
          </button>
        )}
        {c.unanchored && !c.anchor && <p className="cmt-q cmt-q-gone">“{c.unanchored.text}” <span className="cmt-note">{c.unanchored.note}</span></p>}
        {c.deleted ? <p className="cmt-b cmt-gone">{c.deleted.note}</p> : <p className="cmt-b">{body ? body(c) : c.body}</p>}
        {c.notes && c.notes.length > 0 && (
          <ul className="cmt-notes">
            {c.notes.map((n, i) => (
              <li key={i} className={n.tone === 'bad' ? 'cmt-note save-bad' : 'cmt-note'}>
                {n.text}{n.href && <>{' '}<Link href={n.href}>{n.link ?? 'Open'}</Link></>}
              </li>
            ))}
          </ul>
        )}
        {acts}
      </div>
    </article>
  )
}

/** The sheet the thread sits in under 1200 of frame width: a modal `<dialog>` from the bottom, over the scrim; Esc,
 *  its × and a tap on the scrim close it through `onClose`, and closing hands focus back to what opened it. */
function ThreadSheet({ inline, onClose, children }: { inline: boolean; onClose?(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d || inline) return
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '') }
    return () => { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open') }
  }, [inline])
  return (
    <dialog ref={ref} className={`thread-sheet${inline ? ' thread-sheet-inline' : ''}`} open={inline || undefined} aria-label="Comments"
      onCancel={e => { e.preventDefault(); onClose?.() }} onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      {children}
    </dialog>
  )
}

/** The comment thread (§10.3), beside a page or a record: a panel at ≥1200 of frame width, a sheet below. Head:
 *  "Comments · 2 open" and the thing's visibility marker (comments follow it). Each comment: Reply · Resolve · Turn
 *  into a task; replies indent 54 under it. Sending: the body mute, "Sending…". Not sent: clay "Not sent", Retry and
 *  Discard. Resolved: one line, "Resolved by Ops lead · 3 replies · Show". An anchored comment quotes its passage, and
 *  selecting the quote scrolls the page to it. The composer closes it. While previewing, every write — the actions,
 *  Retry and Discard, the composer — is not drawn (C-23); while the Hub's writes are off only Turn into a task is not
 *  (plan D-6). Conversation shows no save state (§10.6). */
export function CommentThread(p: CommentThreadProps) {
  // Conversation is what a read-only Hub still writes (plan D-6): drawn unless previewing. Turn into a task writes a
  // task, so it is drawn only when writes are on too.
  const canWrite = useCanConverse()
  const canTask = useCanWrite()
  const { width } = useFrame()
  const form = p.form ?? threadForm(width)
  const now = p.now ?? new Date()
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set())
  const [replying, setReplying] = useState<string | null>(null)
  const open = p.comments.filter(c => !c.resolved).length
  const toggle = (id: string) => setShown(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const actsFor = (c: Comment, reply: boolean): ReactNode => {
    if (!canWrite) return null
    if (c.state === 'not-sent') {
      return (
        <div className="cmt-f">
          <button type="button" className="cmt-a cmt-a-ink" onClick={() => p.onRetry(c.id)}>Retry</button>
          <button type="button" className="cmt-a" onClick={() => p.onDiscard(c.id)}>Discard</button>
        </div>
      )
    }
    if (c.state !== 'sent') return null
    // DAO-OS L6 Task 18: the author may delete their own comment, a reply too; a deleted one keeps only Reply.
    const del = p.onDelete && c.handle === p.me && !c.deleted
      ? <button type="button" className="cmt-a" onClick={() => p.onDelete!(c.id)}>Delete</button> : null
    if (reply) return del ? <div className="cmt-f">{del}</div> : null
    return (
      <div className="cmt-f">
        <button type="button" className="cmt-a" aria-expanded={replying === c.id} onClick={() => setReplying(r => (r === c.id ? null : c.id))}>Reply</button>
        {!c.resolved && !c.deleted && <button type="button" className="cmt-a" onClick={() => p.onResolve(c.id)}>Resolve</button>}
        {canTask && !c.deleted && !c.task && <button type="button" className="cmt-a" onClick={() => p.onTask(c.id)}>Turn into a task</button>}
        {del}
      </div>
    )
  }

  const show = (a: { id: string; text: string }) => (p.onShowPassage ? p.onShowPassage(a) : showPassage(a.id))
  const thread = (c: Comment) => (
    <>
      <CommentItem c={c} reply={false} me={p.me} now={now} acts={actsFor(c, false)} show={show} body={p.renderBody} />
      {c.replies.map(r => <CommentItem key={r.id} c={r} reply me={p.me} now={now} acts={actsFor(r, true)} show={show} body={p.renderBody} />)}
      {canWrite && replying === c.id && (
        <div className="cmt-reply cmt-reply-box">
          <Composer me={p.me ?? ''} name={p.meName} label={`Reply to ${c.handle === p.me ? 'yourself' : c.role}`} autoFocus mention={p.mention}
            onSend={body => { p.onSend(body, c.id); setReplying(null) }} />
        </div>
      )}
    </>
  )

  const panel = (
    <aside className={form === 'panel' ? 'thread thread-panel' : 'thread'} aria-label="Comments" id={p.id}>
      <div className="thread-h">
        <h2 className="thread-t">Comments{open > 0 && <span className="thread-n">{` · ${open} open`}</span>}</h2>
        <VisibilityMarker value={p.visibility} />
        {form === 'sheet' && p.onClose && <Button iconOnly icon="x" variant="ghost" label="Close comments" onClick={p.onClose}>Close comments</Button>}
      </div>
      {p.comments.length === 0 && <p className="thread-empty">No comments yet.</p>}
      <ol className="thread-l">
        {p.comments.map(c => (
          <li key={c.id} className="thread-i">
            {c.resolved && (
              <div className="cmt-resolved">
                <Icon name="check" size="xs" />
                <span>{`Resolved by ${c.resolved.by} · ${c.replies.length} ${c.replies.length === 1 ? 'reply' : 'replies'} · `}
                  <button type="button" className="cmt-a" aria-expanded={shown.has(c.id)} onClick={() => toggle(c.id)}>{shown.has(c.id) ? 'Hide' : 'Show'}</button>
                  {canWrite && p.onReopen && <>{' · '}<button type="button" className="cmt-a" onClick={() => p.onReopen!(c.id)}>Reopen</button></>}
                </span>
              </div>
            )}
            {(!c.resolved || shown.has(c.id)) && thread(c)}
          </li>
        ))}
      </ol>
      {canWrite && p.quote && (
        <div className="cmt-on">
          <span className="cmt-on-t">{`On “${p.quote.text}”`}</span>
          <button type="button" className="cmt-a" onClick={p.quote.onDrop}>Not on this passage</button>
        </div>
      )}
      {canWrite && <Composer me={p.me ?? ''} name={p.meName} onSend={body => p.onSend(body)} mention={p.mention} autoFocus={p.quote !== undefined} />}
    </aside>
  )
  return form === 'panel' ? panel : <ThreadSheet inline={p.inline ?? false} onClose={p.onClose}>{panel}</ThreadSheet>
}
