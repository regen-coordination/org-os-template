// The conversation on a page or a record (DAO-OS L6 Task 18, spec §8): its comments as the server serves them
// (`GET /api/comments?target=`, threaded, only for a target the viewer may see), with what this tab is sending — each
// "Sending…" until the server answers, then sent, or "Not sent" with Retry and Discard and the server's reason — and the
// acts: reply, resolve, reopen, delete own, Turn into a task. A mention of someone who may not see the target is said
// under the comment in the server's own words (`notTold`). What an act answers is put in place at once; others' acts
// arrive as the server's `conversation` event, which makes the thread stale (events.ts). Nothing is counted or named here but what the server sent
// (rule 7): the open count is of the comments it served. Opening a target marks its notifications read (§8.3).
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ServedComment } from '../api.ts'
import type { Comment, CommentNote } from '../elements/workspace/CommentThread.tsx'
import { entryHref } from '../hrefs.ts'
import type { Anchor } from './passage.ts'

export const TASK_MADE = (id: string) => `Turned into the task ${id}.`
export const TASK_STAGED = (id: string) => `Turned into the task ${id}, staged in your change: it needs approval.`
export const TASK_KEPT = (id: string) => `Turned into the task ${id}, kept at this page’s level, outside the repository.`
export const OPEN_TASK = 'Open the task'
const TASK_WORDS = 'Turned into the task '

/** A comment this tab is sending, or could not send. `key` stands for its id until the server gives one. */
interface Pending { key: string; body: string; parent?: string; anchor?: Anchor; state: 'sending' | 'not-sent'; at: string; error?: string }

export interface Conversation {
  /** The thread as CommentThread draws it: the server's comments, with this tab's sending ones in place. */
  comments: Comment[]
  /** The open comments the server served (not resolved, not deleted): the editor bar's count. */
  open: number
  /** The anchors of the open comments whose passage is still in the target (for the editor to mark). */
  anchors: (Anchor & { id: string })[]
  loading: boolean
  error: string | null
  send(body: string, parent?: string, anchor?: Anchor): void
  retry(key: string): void
  discard(key: string): void
  resolve(id: string): void
  reopen(id: string): void
  remove(id: string): void
  task(id: string): void
}

const said = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** `c` put into the thread: a root replaced or added at the end; a reply under the root its parent is in. */
function upsert(list: readonly ServedComment[], c: ServedComment): ServedComment[] {
  if (c.parent === null) {
    return list.some(x => x.id === c.id) ? list.map(x => (x.id === c.id ? c : x)) : [...list, c]
  }
  return list.map(root => {
    if (root.id !== c.parent && !root.replies.some(r => r.id === c.parent || r.id === c.id)) return root
    const replies = root.replies.some(r => r.id === c.id) ? root.replies.map(r => (r.id === c.id ? c : r)) : [...root.replies, c]
    return { ...root, replies }
  })
}

/** The root a reply to `parent` sits under, in the thread as served. */
const rootOf = (list: readonly ServedComment[], parent: string) =>
  list.find(r => r.id === parent || r.replies.some(x => x.id === parent))?.id ?? null

export function useConversation(target: string, opts: { enabled: boolean; me: { handle: string; role: string } | null }): Conversation {
  const qc = useQueryClient()
  const key = ['comments', target]
  const q = useQuery({ queryKey: key, queryFn: () => api.comments(target), enabled: opts.enabled, retry: false })
  const [pending, setPending] = useState<Pending[]>([])
  const [notes, setNotes] = useState<Record<string, CommentNote[]>>({})
  const seq = useRef(0)
  const served = q.data ?? []

  const put = (c: ServedComment) => qc.setQueryData<ServedComment[]>(key, old => upsert(old ?? [], c))
  const note = (id: string, n: CommentNote) => setNotes(all => ({ ...all, [id]: [...(all[id] ?? []).filter(x => x.text !== n.text), n] }))

  const post = async (p: Pending) => {
    setPending(ps => ps.map(x => (x.key === p.key ? { ...x, state: 'sending', error: undefined } : x)))
    try {
      const out = await api.comment({ target, body: p.body, ...(p.parent ? { parent: p.parent } : {}), ...(p.anchor ? { anchor: p.anchor } : {}) })
      put(out.comment)
      if (out.notTold.length > 0) setNotes(all => ({ ...all, [out.comment.id]: out.notTold.map(text => ({ text })) }))
      setPending(ps => ps.filter(x => x.key !== p.key))
    } catch (err) {
      setPending(ps => ps.map(x => (x.key === p.key ? { ...x, state: 'not-sent', error: said(err) } : x)))
    }
  }

  const act = (id: string, call: () => Promise<{ comment: ServedComment }>) => {
    call().then(out => { put(out.comment) }, err => note(id, { text: said(err), tone: 'bad' }))
  }

  // Fix round 1: the task a comment became is served on it (for everyone, after a reload too); the resolver is named as
  // authors are (the server's `role`, else the handle).
  const view = (c: ServedComment): Comment => {
    const own = notes[c.id] ?? []
    const made: CommentNote[] = c.task && !own.some(n => n.text.startsWith(TASK_WORDS)) ? [{ text: TASK_MADE(c.task), href: entryHref('tasks', c.task), link: OPEN_TASK }] : []
    const all = [...made, ...own]
    return {
      ...c, replies: c.replies.map(view), ...(all.length > 0 ? { notes: all } : { notes: undefined }),
      ...(c.resolved ? { resolved: { ...c.resolved, by: c.resolved.role ?? c.resolved.by } } : {}),
    }
  }
  const shown = (p: Pending): Comment => ({
    id: p.key, handle: opts.me?.handle ?? '', role: opts.me?.role ?? '', at: p.at, body: p.body, state: p.state, replies: [],
    ...(p.anchor ? { anchor: { id: p.key, text: p.anchor.exact } } : {}),
    ...(p.error ? { notes: [{ text: p.error, tone: 'bad' as const }] } : {}),
  })
  const comments = served.map(view)
  for (const p of pending) {
    const root = p.parent ? rootOf(served, p.parent) : null
    const at = root === null ? -1 : comments.findIndex(c => c.id === root)
    if (at < 0) comments.push(shown(p))
    else comments[at] = { ...comments[at]!, replies: [...comments[at]!.replies, shown(p)] }
  }

  return {
    comments,
    open: served.filter(c => !c.resolved && !c.deleted).length,
    anchors: served.flatMap(c => (!c.resolved && !c.deleted && c.anchor ? [{ id: c.id, exact: c.anchor.exact, prefix: c.anchor.prefix, suffix: c.anchor.suffix }] : [])),
    loading: q.isPending && opts.enabled,
    error: q.error ? q.error.message : null,
    send(body, parent, anchor) {
      const p: Pending = { key: `sending-${++seq.current}`, body, ...(parent ? { parent } : {}), ...(anchor ? { anchor } : {}), state: 'sending', at: new Date().toISOString() }
      setPending(ps => [...ps, p])
      void post(p)
    },
    retry(k) { const p = pending.find(x => x.key === k); if (p) void post(p) },
    discard(k) { setPending(ps => ps.filter(x => x.key !== k)) },
    resolve(id) { act(id, () => api.resolveComment(id)) },
    reopen(id) { act(id, () => api.reopenComment(id)) },
    remove(id) { act(id, () => api.deleteComment(id)) },
    task(id) {
      api.commentTask(id).then(out => {
        const text = 'commit' in out ? TASK_MADE(out.task) : 'staged' in out ? TASK_STAGED(out.task) : TASK_KEPT(out.task)
        note(id, { text, href: entryHref('tasks', out.task), link: OPEN_TASK })
        qc.setQueryData<ServedComment[]>(key, old => (old ?? []).map(function mark(c): ServedComment {
          return c.id === id ? { ...c, task: out.task } : { ...c, replies: c.replies.map(mark) }
        }))
        if ('staged' in out) void qc.invalidateQueries({ queryKey: ['changes'] })
        void qc.invalidateQueries({ queryKey: ['registry', 'tasks'] })
      }, err => note(id, { text: said(err), tone: 'bad' }))
    },
  }
}

/** Opening `target` marks its notifications read (§8.3); Needs you then reads them again. Once per opening, for a known
 *  member only (the public has none, and is never asked). Fix round 1: a mention that arrives while the target is open
 *  (the server's `conversation` event makes the notifications stale) is marked read as soon as it is read here. */
export function useMarkRead(target: string, enabled: boolean): void {
  const qc = useQueryClient()
  const unreadHere = useQuery({ queryKey: ['notifications'], queryFn: api.notifications, enabled, retry: false })
    .data?.some(n => !n.read && n.target === target) ?? false
  const mark = () => {
    api.markRead(target).then(r => { if (r.read > 0) void qc.invalidateQueries({ queryKey: ['notifications'] }) }, () => { /* nothing to mark, or the store is down */ })
  }
  useEffect(() => { if (enabled) mark() }, [target, enabled])
  // An unread row for this target while it is open: mark it (marking is idempotent; one the opening already marked reads 0).
  useEffect(() => { if (enabled && unreadHere) mark() }, [unreadHere, enabled])
}
