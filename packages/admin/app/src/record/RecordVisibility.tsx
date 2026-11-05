import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Op, type ProposalView, type StageOp } from '../api.ts'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { useVisibilityView } from '../session/houseSource.ts'
import { useCanWrite, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { VisibilityControl, VisibilityMarker } from '../viewAs/VisibilityMarker.tsx'
import { visibilityWord, type Visibility } from '../viewAs/visibility.ts'
import { LEAVES_GIT } from '../../../lib/narrow.mjs'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A level as the server writes it: `public`, `members`, `hat:<ref>`, or a role's own `role:<id>`. */
export function levelToken(v: Visibility): string {
  return v.level !== 'hat' ? v.level : v.hat.startsWith('role:') ? v.hat : `hat:${v.hat}`
}

/** The `visibility` an op gives `record`, if it gives one. */
function levelSetBy(op: StageOp | Op, record: string): string | null {
  if (op.record !== record) return null
  const said = op.op === 'update' ? op.set.visibility : op.op === 'replace' || op.op === 'create' ? op.value.visibility : undefined
  return typeof said === 'string' ? said : null
}

/** The level a change in flight gives the record: your staged one first, else an open proposal's (§11.4). */
function inFlight(record: string, staged: readonly (Op | StageOp)[], proposals: readonly ProposalView[]): string | null {
  for (const op of [...staged].reverse()) { const t = levelSetBy(op, record); if (t) return t }
  for (const p of proposals) {
    if (p.state !== 'open' || !Array.isArray(p.ops)) continue
    for (const op of p.ops as StageOp[]) { const t = isObj(op) ? levelSetBy(op, record) : null; if (t) return t }
  }
  return null
}

/** The level a change in flight gives the record — your staged one, else an open proposal's the viewer may see (the
 *  server answers only those) — when it differs from the record's own; undefined for none. For the header's marker, so a
 *  viewer who may not change the level still sees it coming (L5 §11.4; the same hook L6's merge M2 added). */
export function useProposedLevel(record: string | null, entry: unknown, staged: readonly (Op | StageOp)[]): Visibility | undefined {
  const source = useVisibilitySource()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, staleTime: 30_000, enabled: record !== null }).data ?? []
  if (record === null || entry === null || entry === undefined) return undefined
  const flight = inFlight(record, staged, proposals)
  return flight !== null && flight !== levelToken(source.visibilityOf(entry)) ? source.visibilityOf({ visibility: flight }) : undefined
}

/** What a refusal says: the server's sentence, else the error's. */
const sentenceOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * A record's visibility (L5 spec §9.7, §9.8, §11.4): the control for a member who may write its collection (GET
 * /api/visibility `writable`, the predicate the server judges a narrowing by: Q77) and is not previewing; the marker for
 * anyone else. A narrowing posts `POST /api/visibility/narrow` at once, after §9.7's question when the record leaves the
 * repository; a widening is staged through the tray as `visibility: <level>` (a publication, §9.7). A private record is
 * offered hats only: moving it into the repository is not built (R-L5-16.8). Nothing is drawn until the view is read.
 */
export function RecordVisibility({ registry, id, entry, staged, stage, onError }: {
  registry: string; id: string; entry: Record<string, unknown>
  /** This record's staged ops, and the tray's stage (the page's own change: no second reader of it here). */
  staged: readonly (Op | StageOp)[]; stage(ops: StageOp[]): Promise<void>
  onError(sentence: string | null): void
}) {
  const view = useVisibilityView()
  const source = useVisibilitySource()
  const canWrite = useCanWrite()
  const qc = useQueryClient()
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, staleTime: 30_000 }).data ?? []
  const [asking, setAsking] = useState<Visibility | null>(null)
  if (view === null) return null

  const record = `${registry}:${id}`
  const value = source.visibilityOf(entry)
  const flight = inFlight(record, staged, proposals)
  const proposed = flight !== null && flight !== levelToken(value) ? source.visibilityOf({ visibility: flight }) : undefined
  if (!canWrite || !view.writable.includes(registry)) return <VisibilityMarker value={value} proposed={proposed} />

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
    try { await stage([{ op: 'update', record, set: { visibility: levelToken(v) } }]) } catch (err) { onError(sentenceOf(err)) }
  }
  const choose = (v: Visibility, how: 'applies' | 'propose') => {
    if (how === 'propose') void widen(v)
    // A record in git (public or members) narrowed to a hat leaves the repository: asked first (§9.7).
    else if (value.level !== 'hat' && v.level === 'hat') setAsking(v)
    else void narrow(v)
  }
  return (
    <>
      <VisibilityControl value={value} proposed={proposed} onChoose={choose}
        offers={value.level === 'hat' ? v => v.level === 'hat' : undefined} />
      {asking && (
        <ConfirmDialog title={`Narrow to ${visibilityWord(asking)}?`} body={<p>{LEAVES_GIT}</p>} confirm={`Narrow to ${visibilityWord(asking)}`}
          onCancel={() => setAsking(null)} onConfirm={() => { const v = asking; setAsking(null); void narrow(v) }} />
      )}
    </>
  )
}
