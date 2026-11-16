// DAO-OS L6 Task 17: a collection's reads and writes in the Hub (spec §6 "Records", §7.3, §16). The definitions
// (GET /api/collections), the records as the gate gives them to this viewer (GET /api/registries/:name: a field kept from
// them is absent, named in `restricted`), the member's own view state (GET/PUT /api/view-state/:collection), and the
// record writes: a workspace collection's through the batch (POST /api/workspace/records), any other's staged in the tray.
// A direct write is committed RECORD_IDLE_MS after the last one, so until the read holds it this tab keeps what it wrote
// (sessionStorage, per collection: a reload within those seconds shows it too) and lays it over the read.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CollectionView, type RecordOp } from '../api.ts'
import { useChanges } from '../changes/useChanges.ts'
import { isWorkspaceCollection, keepOps, pruneKept, withKept, type Kept, type Row } from './collections.ts'

/** The server's batch window (server/workspace/records.ts RECORD_IDLE_MS; the server module cannot load here). */
export const RECORD_IDLE_MS = 10000
/** How long a write is kept over the read at most: past it, the read is what is shown (a batch that could not be
 *  committed went to the tray, which says so). */
const KEPT_MS = 6 * RECORD_IDLE_MS
const keptKey = (collection: string) => `org-os-admin.records-kept.${collection}`

function readKept(collection: string): Kept {
  try {
    const raw = sessionStorage.getItem(keptKey(collection))
    const v: unknown = raw ? JSON.parse(raw) : null
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Kept : {}
  } catch { return {} }
}
function writeKept(collection: string, kept: Kept): void {
  try {
    if (Object.keys(kept).length === 0) sessionStorage.removeItem(keptKey(collection))
    else sessionStorage.setItem(keptKey(collection), JSON.stringify(kept))
  } catch { /* storage refused: kept in memory only */ }
}

/** What a view's state holds (§7.3: the member's current view and unsaved filters, theirs alone, never in git). */
export interface ViewState { view?: string; filters?: unknown[]; sort?: { field: string; dir: 'asc' | 'desc' } | null }

export function useCollection(collection: string) {
  const defs = useQuery({ queryKey: ['collections'], queryFn: api.collections, retry: false })
  const read = useQuery({ queryKey: ['registry', collection], queryFn: () => api.registry(collection), retry: false })
  // The store may be down, or the viewer the public: no state is a fresh view, never an error on the page.
  const state = useQuery({ queryKey: ['view-state', collection], queryFn: () => api.viewState(collection), retry: false, staleTime: Number.POSITIVE_INFINITY })
  const def: CollectionView | undefined = defs.data?.collections.find(d => d.id === collection)
  return {
    def, defs,
    read,
    entries: (read.data?.entries ?? []) as Row[],
    state: state.isPending ? undefined : ((state.data?.state ?? null) as ViewState | null),
    workspace: isWorkspaceCollection(collection, def),
  }
}

/** How long the view state waits after a change before it is sent. */
export const VIEW_STATE_DEBOUNCE_MS = 500

/** The view state kept for the member, a moment after it last changed; nothing while previewing, nothing the server
 *  already holds (`loaded`, as it gave it). A state not sent yet goes when the page is left: another page in the Hub,
 *  or the tab closed or reloaded (`pagehide`, sent with keepalive). */
export function useKeepViewState(collection: string, value: ViewState | null, enabled: boolean, loaded: ViewState | null | undefined): void {
  const qc = useQueryClient()
  const json = JSON.stringify(value)
  const held = useRef<string | null>(null)
  const pending = useRef<ViewState | null>(null)
  if (held.current === null && loaded !== undefined) held.current = JSON.stringify(loaded)
  const send = (v: ViewState, keepalive = false) => {
    pending.current = null
    held.current = JSON.stringify(v)
    qc.setQueryData(['view-state', collection], { collection, state: v })
    api.putViewState(collection, v, keepalive).catch(() => { /* the store is down or the viewer is the public: not kept, said nowhere */ })
  }
  useEffect(() => {
    if (!enabled || value === null || json === held.current) { pending.current = null; return }
    pending.current = value
    const t = setTimeout(() => send(value), VIEW_STATE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [collection, json, enabled])
  useEffect(() => {
    const leave = () => { if (pending.current) send(pending.current, true) }
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave); leave() }
  }, [collection])
}

/** The record writes of one collection, and the rows with what this tab wrote laid over the read. */
export function useRecordWrites(collection: string, workspace: boolean, entries: Row[]) {
  const qc = useQueryClient()
  const changes = useChanges()
  const [kept, setKept] = useState<Kept>(() => readKept(collection))
  const latest = useRef(kept)
  const keep = useCallback((next: Kept) => { latest.current = next; setKept(next); writeKept(collection, next) }, [collection])
  // The read now holds what was kept (or it is old): forgotten.
  useEffect(() => {
    const next = pruneKept(latest.current, entries, Date.now(), KEPT_MS)
    if (JSON.stringify(next) !== JSON.stringify(latest.current)) keep(next)
  }, [entries])
  // After a direct write, the read is taken again once the batch is due (the watcher's event usually comes first).
  useEffect(() => {
    if (Object.keys(kept).length === 0) return
    const t = setTimeout(() => { void qc.invalidateQueries({ queryKey: ['registry', collection] }) }, RECORD_IDLE_MS + 1500)
    return () => clearTimeout(t)
  }, [kept])

  /** Writes `ops`: 'direct' once the batch holds them, 'staged' when they went to the tray; throws the refusal. */
  const write = async (ops: RecordOp[]): Promise<'direct' | 'staged'> => {
    if (!workspace) { await changes.stage(ops); return 'staged' }
    const { save } = await api.workspaceRecords(ops)
    if (save === 'direct') keep(keepOps(latest.current, collection, ops, Date.now()))
    else void qc.invalidateQueries({ queryKey: ['changes'] })
    return save
  }
  const rows = useMemo(() => withKept(entries, kept), [entries, kept])
  return { rows, write, change: changes.view }
}
