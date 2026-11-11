// The thread of a page or a record in the Hub (DAO-OS L6 Task 18, spec §8, §15): L4c's CommentThread on the conversation
// the server serves (useConversation), its composers' `@` answered by GET /api/mentionables (the picker draws a record's
// glyph from its `recordKind`), its bodies drawn in the inline subset (commentBody), Show the passage through the page's
// editor (`onShowPassage`), and the passage a new comment will be on (`quote`) over the composer.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type ServedMentionable } from '../api.ts'
import { Note } from '../design/Note.tsx'
import { CommentThread, type Comment, type ThreadForm } from '../elements/workspace/CommentThread.tsx'
import { CANNOT_READ_TALK, MentionPicker } from '../elements/workspace/MentionPicker.tsx'
import { mentionMarkdown, mentionables } from '../elements/workspace/mentions.ts'
import type { Visibility } from '../viewAs/visibility.ts'
import { commentBody } from './commentBody.tsx'
import type { Anchor, ShownAnchor } from './passage.ts'
import { useConversation, useMarkRead, type Conversation } from './useConversation.ts'
import type { ThreadSlot } from './PagePage.tsx'

/** The picker's choices for what is typed after `@`, as the server offers them on `target` (never what the author may
 *  not see; a member who may not see it, disabled; in a reply, `parent`, judged with the talk above it: T2e M4). The last
 *  answer stays drawn while the next is read. */
function MentionChoices({ target, q, pick, parent }: { target: string; q: string; pick(label: string, markdown: string): void; parent?: string }) {
  const served = useQuery({
    queryKey: ['mentionables', target, q, parent ?? null], queryFn: () => api.mentionables(target, q, parent), retry: false, staleTime: 10_000,
    placeholderData: keepPreviousData,
  }).data ?? []
  return (
    <MentionPicker items={mentionables(served as ServedMentionable[], q)} cannot={CANNOT_READ_TALK}
      onPick={m => pick(m.label, m.href ? mentionMarkdown({ label: m.label, href: m.href }) : `@${m.label}`)} />
  )
}

export function ConversationThread({ conversation: c, target, visibility, me, meName, id, form, onClose, quote, onDropQuote, onShowPassage }: {
  conversation: Conversation; target: string; visibility: Visibility; me?: string; meName?: string; id?: string; form?: ThreadForm; onClose?(): void
  /** The passage the next comment will be on, and how to drop it (it is dropped once that comment is sent). */
  quote?: Anchor | null; onDropQuote?(): void
  onShowPassage?(anchor: ShownAnchor): void
}) {
  if (c.error !== null) {
    return (
      <aside className={form === 'sheet' ? 'thread' : 'thread thread-panel'} aria-label="Comments" id={id}>
        <div className="thread-h"><h2 className="thread-t">Comments</h2></div>
        <Note state="notYet">{c.error}</Note>
      </aside>
    )
  }
  return (
    <CommentThread id={id} comments={c.comments} visibility={visibility} me={me} meName={meName} form={form} onClose={onClose}
      onSend={(body, replyTo) => {
        c.send(body, replyTo, replyTo ? undefined : quote ?? undefined)
        if (!replyTo && quote) onDropQuote?.()
      }}
      onRetry={c.retry} onDiscard={c.discard} onResolve={c.resolve} onReopen={c.reopen} onDelete={c.remove} onTask={c.task}
      renderBody={(x: Comment) => commentBody(x.body, me)}
      onShowPassage={onShowPassage}
      quote={quote && onDropQuote ? { text: quote.exact, onDrop: onDropQuote } : undefined}
      mention={(q, pick, replyTo) => <MentionChoices target={target} q={q} pick={pick} parent={replyTo} />} />
  )
}

/** PagePage's thread slot (Task 16's seam): the page's thread while it is open — a panel beside the page at 1200 of frame
 *  width and over (laid over the page where the editor would keep under 760 beside it, pages.css), a sheet below. */
export const pageThread: ThreadSlot = p => (p.open
  ? <ConversationThread conversation={p.conversation} target={p.target} visibility={p.visibility} me={p.me} meName={p.meName} id={p.id} onClose={p.close}
      quote={p.quote} onDropQuote={p.dropQuote} onShowPassage={p.showPassage} />
  : null)

/** A record's thread, in its page's aside (§8.2: records hold conversation too): always the panel form, since the aside
 *  is its column; opening the record marks its notifications read. `me`: the viewer, a known member (the record page has
 *  read who you are already; null draws nothing, as conversation is the members' side). */
export function RecordThread({ target, visibility, me }: { target: string; visibility: Visibility; me: { handle: string; role: string } | null }) {
  const conversation = useConversation(target, { enabled: me !== null, me })
  useMarkRead(target, me !== null)
  if (me === null) return null
  return <ConversationThread conversation={conversation} target={target} visibility={visibility} me={me.handle} meName={me.role} id={`thread-${target}`} form="panel" />
}
