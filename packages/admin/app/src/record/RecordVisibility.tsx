import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Op, type StageOp } from '../api.ts'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { useVisibilityView } from '../session/houseSource.ts'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { VisibilityControl, VisibilityMarker } from '../viewAs/VisibilityMarker.tsx'
import { visibilityWord, type Visibility } from '../viewAs/visibility.ts'
import { LEAVES_GIT } from '../../../lib/narrow.mjs'
import { fullLevel } from '../../../lib/visibility.mjs'
import { levelItem } from '../workspace/share.ts'
import { refusalErrors } from './useEditor.ts'
import { inFlightOf, type PrivateEntryLike } from './levelInFlight.ts'
import { MoveDialog, moveEntries, proposalEntry } from './MoveToGit.tsx'

/** A level as the server writes it: `public`, `members`, `hat:<ref>`, or a role's own `role:<id>`. */
export function levelToken(v: Visibility): string {
  return v.level !== 'hat' ? v.level : v.hat.startsWith('role:') ? v.hat : `hat:${v.hat}`
}

/** The level a change in flight gives the record — your staged one, else an open proposal's the viewer may see (the
 *  server answers only those) — when it differs from the record's own; undefined for none. For the header's marker, so a
 *  viewer who may not change the level still sees it coming (L5 §11.4; DAO-OS L6 Task 16, coordinator ruling on merge M2). */
export function useProposedLevel(record: string | null, entry: unknown, staged: readonly (Op | StageOp)[],
  pending?: readonly PrivateEntryLike[]): Visibility | undefined {
  const source = useVisibilitySource()
  const { previewing } = useViewer()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, staleTime: 30_000, enabled: record !== null }).data ?? []
  if (record === null || entry === null || entry === undefined) return undefined
  // M2: previewing, what your own tray stages is not the level in flight; M3: an op restating the level is passed over.
  const own = levelToken(source.visibilityOf(entry))
  const flight = inFlightOf({ record }, previewing ? [] : staged, previewing ? undefined : pending, proposals, own)
  return flight !== null && flight.level !== own ? source.visibilityOf(levelItem(flight.level)) : undefined
}

/** What a refusal says: the server's sentence, else the error's. */
const sentenceOf = (err: unknown) => (err instanceof Error ? err.message : String(err))
/** What a staging refusal says: its errors' sentences (a 422 `{ errors }`), else the server's sentence. */
const stageRefusal = (err: unknown, record: string) => refusalErrors(err, record).map(e => e.message).join(' ')
/** A level git does not hold: a hat or a role (a private collection's, or a private record's). */
const isStrict = (token: unknown) => typeof token === 'string' && token !== 'public' && token !== 'members'
/** Council memory's collection (server/private/targets.ts COUNCIL_MEMORY): every entry is kept at the collection's level
 *  (PF-R60, PF-R69), so an entry's level is never a choice: it reads the marker (DAO-OS L6 Task 20, R-L6-T20-9). */
export const COUNCIL_MEMORY = 'council-memory'

/**
 * A record's visibility (L5 spec §9.7, §9.8, §11.4): the control for a member who may write its collection (GET
 * /api/visibility `writable`, the predicate the server judges a narrowing by: Q77) and is not previewing; the marker for
 * anyone else. A narrowing posts `POST /api/visibility/narrow` at once, after §9.7's question when the record leaves the
 * repository; a widening is staged through the tray as `visibility: <level>` (a publication, §9.7). A private record is
 * offered hats as levels (R-L5-20.4) and, when its collection is in git, "Move into the repository…" (DAO-OS L6 §12, Task
 * 20): Members or Public, staged alone as the update the server makes `move-to-git`; while a move is in flight the menu names
 * the proposal holding it. A private collection's record is offered no move (its records stay in the store), nor is one
 * whose collection is not read yet. Nothing is drawn until the view is read.
 */
export function RecordVisibility({ registry, id, entry, staged, pending, stage, onError }: {
  registry: string; id: string; entry: Record<string, unknown>
  /** This record's staged ops, the change's private entries (a widening or a move kept in the store) and the tray's stage
   *  (the page's own change: no second reader of it here). */
  staged: readonly (Op | StageOp)[]; pending?: readonly PrivateEntryLike[]; stage(ops: StageOp[]): Promise<void>
  onError(sentence: string | null): void
}) {
  const view = useVisibilityView()
  const source = useVisibilitySource()
  const canWrite = useCanWrite()
  const { previewing } = useViewer()
  const qc = useQueryClient()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, staleTime: 30_000 }).data ?? []
  const [asking, setAsking] = useState<Visibility | null>(null)
  const [moving, setMoving] = useState(false)
  const value = source.visibilityOf(entry)
  // Whether the record's collection is a private one (its definition kept at a hat): read only for a private record.
  const collections = useQuery({ queryKey: ['collections'], queryFn: api.collections, retry: false, enabled: value.level === 'hat' }).data
  if (view === null) return null

  const record = `${registry}:${id}`
  // M2: previewing, your own tray is not drawn as the level in flight (an open proposal's still is).
  const flight = inFlightOf({ record }, previewing ? [] : staged, previewing ? undefined : pending, proposals, levelToken(value))
  const proposed = flight !== null && flight.level !== levelToken(value) ? source.visibilityOf(levelItem(flight.level)) : undefined
  if (!canWrite || !view.writable.includes(registry) || registry === COUNCIL_MEMORY) return <VisibilityMarker value={value} proposed={proposed} />
  const privateCollection = collections === undefined || collections.collections.some(c => c.id === registry && isStrict(c.visibility))
  const movable = value.level === 'hat' && !privateCollection
  // M6 (PF-R100): the move offers Public only where the collection is public (data/visibility.yaml as GET /api/visibility
  // reads it), as a page is offered it only under a public parent; Members wherever the move is offered.
  const moveLevels: ('members' | 'public')[] = fullLevel(view.config as never, registry, null).level === 'public' ? ['members', 'public'] : ['members']

  const narrow = async (v: Visibility) => {
    onError(null)
    try {
      await api.narrow({ registry, id }, levelToken(v))
      // The record, its lists and the ledger may all have changed: read them again.
      await qc.invalidateQueries()
    } catch (err) { onError(sentenceOf(err)) }
  }
  const widen = async (v: Visibility) => {
    onError(null)
    try { await stage([{ op: 'update', record, set: { visibility: levelToken(v) } }]) } catch (err) { onError(stageRefusal(err, record)) }
  }
  // §12: the move is staged alone (R-L6-T11-1), as an update giving the record a level git holds.
  const move = async (level: 'members' | 'public') => {
    onError(null)
    try { await stage([{ op: 'update', record, set: { visibility: level } }]) } catch (err) { onError(stageRefusal(err, record)) }
  }
  const more = value.level === 'hat'
    ? (movable ? moveEntries({ levels: moveLevels, flight, onMove: () => setMoving(true) }) : flight?.proposal ? [proposalEntry(flight.proposal)] : [])
    : flight?.proposal ? [proposalEntry(flight.proposal)] : []
  const choose = (v: Visibility, how: 'applies' | 'propose') => {
    if (how === 'propose') void widen(v)
    // A record in git (public or members) narrowed to a hat leaves the repository: asked first (§9.7).
    else if (value.level !== 'hat' && v.level === 'hat') setAsking(v)
    else void narrow(v)
  }
  return (
    <>
      <VisibilityControl value={value} proposed={proposed} onChoose={choose}
        offers={value.level === 'hat' ? v => v.level === 'hat' : undefined} more={more} />
      {asking && (
        <ConfirmDialog title={`Narrow to ${visibilityWord(asking)}?`} body={<p>{LEAVES_GIT}</p>} confirm={`Narrow to ${visibilityWord(asking)}`}
          onCancel={() => setAsking(null)} onConfirm={() => { const v = asking; setAsking(null); void narrow(v) }} />
      )}
      {moving && <MoveDialog levels={moveLevels} dao={(view?.tree.length ?? 0) > 0} onCancel={() => setMoving(false)} onMove={l => { setMoving(false); void move(l) }} />}
    </>
  )
}
