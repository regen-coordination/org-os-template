// Walk fix wave 6b, I9: "Move to…" — a page's new parent, or the top level, from a page tree row's menu or from the page
// itself; POST /api/pages/:id/move, which judges it as every page write is judged (server/workspace/pages.ts `move`: a page
// the member may not see is not there, into itself or a subpage is refused, a page never looser than its parent, a move
// that makes a page public is a publication, one under a private page leaves the repository as a narrowing does, and a
// raised tree stages it). What is offered is what the member may read and write: GET /api/pages?write, each page's own
// write mode; never the page, its subpages, or where it already is. The server's sentence is said when it refuses.
import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type PageNode } from '../api.ts'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { Note } from '../design/Note.tsx'
import { announce } from '../parts/live.tsx'
import { refusalErrors } from '../record/useEditor.ts'
import { PAGE_LEAVES_GIT } from '../../../lib/narrow.mjs'
import { gitSubpages } from './pageVisibility.tsx'
import { treeRows } from './PageTree.tsx'

/** The top level, as the place a page goes to. */
export const MOVE_TOP = 'The top level'
export const MOVE_STAGED = 'The move is staged in your change: it needs approval.'
export const MOVED = (title: string, under: string | null): string => `Moved ${title} ${under === null ? 'to the top level' : `under ${under}`}.`
/** Said before a move under a public page: whether it publishes is the server's to judge (the page's own level). */
export const MOVE_PUBLISHES = 'Under a public page, a page that takes its level from its parent becomes public: the move is decided as a publication.'
export const NO_PLACE = 'There is no other place you may move it to.'
/** The pages list Move to… reads (`?write`): its own key, under ['pages'] so every write that reads the tree again reads it. */
export const WRITABLE_PAGES = ['pages', 'write'] as const

const isGit = (level: string) => level === 'public' || level === 'members'

/** The pages `id` may be moved under, in the tree's reading order with their depth: those whose `write` is not 'none' (a
 *  list without `write` offers none), never `id`, its subpages, or its parent now. */
export function moveTargets(id: string, tree: readonly PageNode[]): { node: PageNode; depth: number }[] {
  const below = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const n of tree) if (n.parent !== null && below.has(n.parent) && !below.has(n.id)) { below.add(n.id); grew = true }
  }
  const parent = tree.find(n => n.id === id)?.parent ?? null
  return treeRows(tree, () => true).filter(({ node }) => !below.has(node.id) && node.id !== parent && node.write !== undefined && node.write !== 'none')
}

export interface MovePageProps {
  page: { id: string; title: string; parent: string | null; visibility: string }
  onCancel(): void
  /** After the move: `staged` when it waits for approval. */
  onMoved?(out: { staged: boolean }): void
  /** Before the move is asked: told whether the page leaves the repository (the page ends its session first). */
  before?(leaves: boolean): Promise<void>
  /** After the move is answered, whatever the answer. */
  after?(leaves: boolean): void
}

/** The dialog: "Move <title>", a select of the places offered ("Move under"), what the move does where it does more than
 *  move, and Move. A refusal stays in the dialog as an error note in the server's words. */
export function MovePageDialog({ page, onCancel, onMoved, before, after }: MovePageProps) {
  const qc = useQueryClient()
  const read = useQuery({ queryKey: WRITABLE_PAGES, queryFn: api.writablePages, retry: false })
  const tree = read.data ?? []
  const title = page.title || page.id
  const targets = moveTargets(page.id, tree)
  const places: { id: string | null; label: string; level: string | null }[] = [
    ...(page.parent !== null ? [{ id: null, label: MOVE_TOP, level: null }] : []),
    ...targets.map(({ node, depth }) => ({ id: node.id, label: `${' '.repeat(depth)}${node.title || node.id}`, level: node.visibility })),
  ]
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectId = useId()
  const at = places.find(p => p.id === (chosen === undefined ? places[0]?.id : chosen))
  const leaves = at !== undefined && at.level !== null && isGit(page.visibility) && !isGit(at.level)
  const publishes = at !== undefined && at.level === 'public' && page.visibility !== 'public'

  const move = async () => {
    if (!at || busy) return
    setBusy(true)
    setError(null)
    try {
      await before?.(leaves)
      const out = await api.movePage(page.id, { parent: at.id })
      await qc.invalidateQueries({ queryKey: ['pages'] })
      void qc.invalidateQueries({ queryKey: ['page', page.id] })
      const staged = out.staged === true
      announce(staged ? MOVE_STAGED : MOVED(title, at.id === null ? null : at.label.trim()))
      onMoved?.({ staged })
    } catch (err) {
      setError(refusalErrors(err, `pages:${page.id}`).map(e => e.message).join(' '))
    } finally {
      setBusy(false)
      after?.(leaves)
    }
  }

  const body = read.isPending ? <Note state="loading">Loading the pages…</Note>
    : read.error ? <Note state="error">{read.error.message}</Note>
    : places.length === 0 ? <Note state="empty">{NO_PLACE}</Note>
    : (
      <>
        <label className="vfilter-f vfilter-v" htmlFor={selectId}>
          <span className="vfilter-l">Move under</span>
          <select id={selectId} className="input" value={at?.id ?? ''} onChange={e => { setChosen(e.target.value === '' ? null : e.target.value); setError(null) }}>
            {places.map(p => <option key={p.id ?? ''} value={p.id ?? ''}>{p.label}</option>)}
          </select>
        </label>
        {leaves && <p>{PAGE_LEAVES_GIT(gitSubpages(page.id, tree))}</p>}
        {publishes && <p>{MOVE_PUBLISHES}</p>}
        {error && <Note state="error">{error}</Note>}
      </>
    )
  return (
    <ConfirmDialog title={`Move ${title}`} body={body} confirm="Move" busy={busy ? 'Moving…' : undefined} disabled={at === undefined}
      onCancel={onCancel} onConfirm={() => void move()} />
  )
}
