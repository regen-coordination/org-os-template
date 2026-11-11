// DAO-OS L6 Task 20 (spec §4.4, §12, §15): a page's level from its editor bar, as the server judges it. Drawn as the control
// only for a member who may write the page (`write.mode` is not 'none': Q77's predicate at the page's tree) and is not
// previewing, once GET /api/visibility is read; anyone else reads the marker. What it offers is what the server accepts:
// - a git page: Members (a narrowing that stays in git, at once); a hat (a narrowing that leaves the repository with its
//   git subpages: asked first, with their count and L5's LEAVES_GIT sentence); Public only where its parent is public or it
//   has none (a page is never more open than its parent), staged as a publication: a `file` op giving its front matter
//   `visibility: public`, over the text already staged for it if there is one.
// - a private page: a narrower hat (in the store, at once); "Move into the repository…" (§12), Members or Public as its
//   parent allows, staged alone as the update the server makes `move-to-git`. A wider hat is not offered: the server stages
//   no change of a private page's level but its move (Task 11).
// Before a narrowing out of the repository and before a move, the editing session is ended (its last text saved and
// committed), so nothing typed stays in a session over a file that is gone, and the move pins the page as typed.
import { useId, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ChangeView, type PageNode, type PageRead, type StageOp } from '../api.ts'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { Choice } from '../design/inputs/Choice.tsx'
import type { MenuEntry } from '../design/Menu.tsx'
import { useVisibilityView } from '../session/houseSource.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { readersWithin, visibilityWord, type Visibility } from '../viewAs/visibility.ts'
import { PAGE_LEAVES_GIT } from '../../../lib/narrow.mjs'
import { joinPage, splitPage } from '../../../lib/workspace/pages.mjs'
import { levelToken } from '../record/RecordVisibility.tsx'
import { inFlightOf, MOVE_PROPOSED, type PrivateEntryLike } from '../record/levelInFlight.ts'
import { MoveDialog, moveEntries, proposalEntry } from '../record/MoveToGit.tsx'
import { refusalErrors } from '../record/useEditor.ts'
import { levelItem } from './share.ts'

const isGit = (token: string) => token === 'public' || token === 'members'

/** The git pages below `id` in the tree the member reads: the subpages a narrowing out of the repository takes with it
 *  (a private page's children are private already, so the walk stops there). */
export function gitSubpageNodes(id: string, tree: readonly PageNode[]): PageNode[] {
  const seen = new Set([id])
  const out: PageNode[] = []
  const walk = (at: string) => {
    for (const c of tree) {
      if (c.parent !== at || seen.has(c.id) || !isGit(c.visibility)) continue
      seen.add(c.id)
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}
export const gitSubpages = (id: string, tree: readonly PageNode[]): number => gitSubpageNodes(id, tree).length

/** The server's words (narrow.ts, 409 STAGED; Task 20 review C1, PF-R95) for your own staged edit of the tree a narrowing
 *  would take out of the repository: said before anything is asked or posted. */
export const STAGED_HERE = 'Your changes stage an edit of this page: apply or discard it first. Nothing was changed.'
/** What a widening to public exposes, asked before it is staged (Task 20 review I2, PF-R97): the page, and the subpages
 *  that take its level, as the server counts them. */
export const WIDENS_PAGE = (title: string, n: number): string => n === 0
  ? `${title} becomes public, for anyone to read, once decided.`
  : `${title} and its ${n === 1 ? '1 subpage that takes' : `${n} subpages that take`} its level become public, for anyone to read, once decided.`
/** Task 20 review I3 (PF-R98, the brief's fallback): ending the session before a narrowing commits its text to git at the
 *  level it had, so with uncommitted text the dialog says so and narrows only when that is chosen. */
export const COMMITTED_FIRST = 'Your edits from this session are committed to the repository first, where members can read them.'
const COMMIT_HINT = 'They stay in its history after the page leaves.'
const KEEP_HINT = 'Nothing is committed or narrowed.'
/** M4: while a move of the page into the repository is staged, an edit would leave it stale (its digest pins the page). */
export const MOVE_STALE = 'A move of this page into the repository is staged: an edit now would leave the move stale. Apply or discard it first.'
export const stagedBelow = (title: string) => `Your changes stage an edit of ${title}, a subpage of this page: apply or discard it first. Nothing was changed.`

export interface PageVisibility {
  /** The bar's props: the control's choice, the levels offered, what follows them, and the level in flight. */
  onVisibility?(v: Visibility, how: 'applies' | 'propose'): void
  visibilityOffers?(v: Visibility): boolean
  visibilityMore?: MenuEntry[]
  proposed?: Visibility
  /** The question asked before a narrowing that leaves the repository, or the move's dialog. */
  dialog: ReactNode
  /** The server's sentence for a refused change, for an error note; null for none. */
  error: string | null
  /** Task 20 review M4, L6 carries K5: a move of the page into the repository is staged, or held by an open proposal: the
   *  editor holds still, as an edit would leave the move stale; `moveNote` says why (`MOVE_STALE`, `MOVE_PROPOSED`). */
  moveHeld: boolean
  moveNote: string | null
}

export function usePageVisibility({ page, editable, level, tree, changes, session }: {
  page: PageRead['page']; editable: boolean; level: Visibility; tree: readonly PageNode[] | undefined
  changes: { view: ChangeView | null; stage(ops: StageOp[]): Promise<void> }
  /** The page's session: ended before the page leaves or enters the repository, and opened again after. */
  session: { end(): Promise<void>; retry(): void; uncommitted(): boolean }
}): PageVisibility {
  const view = useVisibilityView()
  const source = useVisibilitySource()
  const qc = useQueryClient()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, staleTime: 30_000 }).data ?? []
  // `dirty`: the session holds uncommitted text, which ending it commits to git first (I3): the narrowing then waits for
  // `commit` to be chosen.
  const [asking, setAsking] = useState<{ v: Visibility; n: number; dirty: boolean; commit: boolean | null } | null>(null)
  const choiceName = useId()
  const [widening, setWidening] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const git = page.path !== null
  const record = `pages:${page.id}`
  // M2: previewing, what your own tray stages is not the level in flight (an open proposal's still is); M3: an op that
  // restates the page's level is passed over.
  const { previewing } = useViewer()
  const flight = inFlightOf({ page: page.id, path: page.path }, previewing ? [] : changes.view?.ops ?? [],
    previewing ? undefined : changes.view?.private as PrivateEntryLike[] | undefined, proposals, levelToken(level))
  const proposed = flight !== null && flight.level !== levelToken(level) ? source.visibilityOf(levelItem(flight.level)) : undefined
  // The parent's level, as the tree reads it: null at the root; undefined while the tree is not read, or when the parent is
  // not in it (then nothing that depends on it is offered).
  const parentNode = page.parent === null ? null : tree?.find(n => n.id === page.parent)
  const parent: Visibility | null | undefined = page.parent === null ? null : parentNode ? source.visibilityOf(levelItem(parentNode.visibility)) : undefined
  const mayBePublic = parent === null || parent?.level === 'public'
  const moveLevels: ('members' | 'public')[] = parent === undefined || parent?.level === 'hat' ? [] : mayBePublic ? ['members', 'public'] : ['members']

  const moveHeld = !git && flight !== null && flight.move
  const moveNote = !moveHeld ? null : flight!.proposal ? MOVE_PROPOSED('page', flight!.proposal.id) : MOVE_STALE
  if (!editable || view === null) return { proposed, dialog: null, error: null, moveHeld, moveNote }

  const said = (err: unknown) => setError(refusalErrors(err, record).map(e => e.message).join(' '))
  // C1: what your tray stages of the tree a narrowing out of the repository would take (the page, or a git subpage).
  const stagedIn = (): string | null => {
    const paths = new Map([[page.path, page.id], ...gitSubpageNodes(page.id, tree ?? []).map(n => [`pages/${n.id}.md`, n.title || n.id] as [string, string])])
    const op = (changes.view?.ops ?? []).find(o => o.op === 'file' && paths.has(o.path))
    if (!op || op.op !== 'file') return null
    return op.path === page.path ? STAGED_HERE : stagedBelow(paths.get(op.path)!)
  }
  const narrow = async (v: Visibility, leaves: boolean) => {
    setError(null)
    const staged = leaves ? stagedIn() : null
    if (staged !== null) { setError(staged); return }
    try {
      if (leaves) await session.end()
      await api.narrow({ page: page.id }, levelToken(v))
      // The page, the tree, its file and the ledger may all have changed: read them again.
      await qc.invalidateQueries()
    } catch (err) { said(err) } finally { if (leaves) session.retry() }
  }
  // Task 20 review I1 (PF-R96): the session ends first (its last text saved, then closed: committed on a direct page, staged
  // under a raised tree), so the widening is built over what the member typed, never over the file before it, which Keep
  // mine would then keep whole; then the tray and the file are read as they are after it, and the next session opens.
  const widen = async () => {
    setError(null)
    try {
      const path = page.path!
      await session.end()
      // Over the text your change stages for the page (a raised tree's save), so the widening keeps those edits; else over
      // the file as the repository holds it.
      const held = (await api.changes()).ops.find(o => o.op === 'file' && o.path === path)
      const from = held && held.op === 'file' && held.text !== null ? { text: held.text, base: held.base } : await api.file(path)
      if (from.text === null) throw new Error(`There is no page ${page.id}.`)
      const { front, body } = splitPage(from.text)
      await changes.stage([{ op: 'file', path, text: joinPage({ ...front, visibility: 'public' }, body, from.text), base: from.base }])
    } catch (err) { said(err) } finally { session.retry() }
  }
  const move = async (to: 'members' | 'public') => {
    setError(null)
    try {
      await session.end()
      await changes.stage([{ op: 'update', record, set: { visibility: to } }])
    } catch (err) { said(err) } finally { session.retry() }
  }

  const onVisibility = (v: Visibility, how: 'applies' | 'propose') => {
    if (git && v.level === 'public') { setError(null); setWidening(page.widens ?? gitSubpages(page.id, tree ?? [])) }
    else if (git && v.level === 'hat') {
      const staged = stagedIn()
      if (staged !== null) setError(staged)
      else { setError(null); setAsking({ v, n: gitSubpages(page.id, tree ?? []), dirty: session.uncommitted(), commit: null }) }
    }
    else if (how === 'applies') void narrow(v, false)
  }
  const visibilityOffers = (v: Visibility): boolean => {
    if (!git) return v.level === 'hat' && readersWithin(v, level, source)
    if (v.level === 'public') return mayBePublic
    return true
  }
  const visibilityMore: MenuEntry[] = !git
    ? moveEntries({ levels: moveLevels, flight, onMove: () => setMoving(true) })
    : flight?.proposal ? [proposalEntry(flight.proposal)] : []
  const word = asking ? visibilityWord(asking.v) : ''
  const dialog = (
    <>
      {asking && (
        <ConfirmDialog title={`Narrow to ${word}?`} confirm={`Narrow to ${word}`} disabled={asking.dirty && asking.commit !== true}
          body={(
            <>
              <p>{PAGE_LEAVES_GIT(asking.n)}</p>
              {asking.dirty && (
                <>
                  <p>{COMMITTED_FIRST}</p>
                  <div className="form-rows" role="radiogroup" aria-label="Your edits from this session">
                    <Choice type="card" name={choiceName} checked={asking.commit === true} label="Commit them, then narrow" hint={COMMIT_HINT}
                      onChange={() => setAsking(a => (a ? { ...a, commit: true } : a))} />
                    <Choice type="card" name={choiceName} checked={asking.commit === false} label="Keep them in the editor" hint={KEEP_HINT}
                      onChange={() => setAsking(a => (a ? { ...a, commit: false } : a))} />
                  </div>
                </>
              )}
            </>
          )}
          onCancel={() => setAsking(null)}
          onConfirm={() => { if (asking.dirty && asking.commit !== true) return; const v = asking.v; setAsking(null); void narrow(v, true) }} />
      )}
      {widening !== null && (
        <ConfirmDialog title="Widen to Public?" body={<p>{WIDENS_PAGE(page.title || page.id, widening)}</p>} confirm="Widen to Public"
          onCancel={() => setWidening(null)} onConfirm={() => { setWidening(null); void widen() }} />
      )}
      {moving && moveLevels.length > 0 && <MoveDialog levels={moveLevels} dao={(view?.tree.length ?? 0) > 0} onCancel={() => setMoving(false)} onMove={l => { setMoving(false); void move(l) }} />}
    </>
  )
  return { onVisibility, visibilityOffers, visibilityMore, proposed, dialog, error, moveHeld, moveNote }
}
