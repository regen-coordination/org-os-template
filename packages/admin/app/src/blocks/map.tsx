import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { api, type Board, type BoardView, type Positions, type Resource } from '../api.ts'
import { useResources, useSystemsRead } from '../queries.ts'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { restrictedHat, restrictedOf } from '../record/restricted.ts'
import { layoutBoard } from '../map/layout.ts'
import { HouseMap } from '../map/HouseMap.tsx'
import { daoMapOf, mapItemOf, mapLinksOf, mapNodesOf, portalNode } from '../map/fromRecords.ts'
import { withNeeds } from '../map/valueFlow.ts'
import { recordHref, selectHref } from '../hrefs.ts'
import type { Mark } from '../../../lib/machines/run.mjs'
import { marksOf } from '../parts/marks.ts'
import { RecordsMap } from './RecordsMap.tsx'
import { useNeeds } from './needs.tsx'
import { runQuery, systemsWait } from './query.ts'
import { entryKinds, useEntryOf, type EntryOf } from './entries.ts'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData, FrameView, RecordSource } from './types.ts'

type MapSource = { map: Board } | RecordSource
/** `select: false` keeps the map on its page (/parts): a click selects nothing and goes nowhere, a
 *  portal links nowhere, and a move or auto-layout is not saved. */
type MapView = FrameView & { map?: Board; mapKey?: string; select?: boolean }
interface FullMap { full: true; board: Board; graph: BoardView; saved: Positions | undefined; layoutReady: boolean; entryOf: EntryOf }
interface SomeRecords { full: false; rows: Resource[] }

const isFull = (s: MapSource): s is { map: Board } => typeof (s as { map?: unknown }).map === 'string'
const MAP_NAME: Record<Board, string> = { organization: 'Organization map', systems: 'Systems map' }

function useMapData(cfg: BlockCfg): BlockData {
  const source = (cfg.source ?? {}) as MapSource
  const full = isFull(source) ? source.map : null
  const graph = useQuery({ queryKey: ['graph', full], queryFn: () => api.graph(full!), enabled: full !== null })
  const saved = useQuery({ queryKey: ['layout', full], queryFn: () => api.layout(full!), enabled: full === 'organization' })
  const resources = useResources()
  const systemsRead = useSystemsRead()
  const systems = systemsRead.entries
  const key = JSON.stringify(source)
  // A full map's records are the graph's own: the kinds it holds are read from their registries, so `entryOf` answers for
  // every node — the gate's `restricted` marker lives there (rule 3, E-70). The map waits for those reads, like a
  // collection's, so a restricted name or status never prints raw before its mask arrives.
  const kinds = full ? [...new Set((graph.data?.nodes ?? []).map(r => r.kind))] : entryKinds(source as RecordSource)
  const entries = useEntryOf(kinds)
  const rows = useMemo(() => (full ? [] : runQuery(source as RecordSource, resources.data ?? [], systems, entries.entryOf)), [resources.data, systems, key, entries.entryOf])
  if (full) {
    if (graph.error) return { state: 'error', error: graph.error.message }
    // the Systems map's main Safe is the one data/systems.yaml places in the treasury: its failed read is the map's (I-2)
    if (full === 'systems' && systemsRead.error) return { state: 'error', error: systemsRead.error.message }
    if (graph.isPending || entries.pending || (full === 'systems' && systemsRead.pending)) return { state: 'loading' }
    const g = graph.data!
    if (g.nodes.length === 0 && g.portals.length === 0) return { state: 'empty', count: 0 }
    return { state: 'ready', count: g.nodes.length, data: { full: true, board: full, graph: g, saved: saved.data, layoutReady: saved.isSuccess, entryOf: entries.entryOf } satisfies FullMap }
  }
  if (resources.error) return { state: 'error', error: resources.error.message }
  // a section that sorts systems by their data/systems.yaml entry waits for it, and says its failed read (I-2)
  const waiting = systemsWait(source as RecordSource, systemsRead)
  if (waiting?.state === 'error') return waiting
  if (resources.isPending || entries.pending || waiting) return { state: 'loading' }
  return rows.length === 0 ? { state: 'empty', count: 0 } : { state: 'ready', count: rows.length, data: { full: false, rows } satisfies SomeRecords }
}

/** One of the two full maps (P1 spec §6.9), drawn with the house's nodes and edges (E-42, spec §8): the Systems map
 *  laid out by authority (§8.2, the main Safe big), the Organization map in its own graph layout and the saved
 *  positions (§14.2), a node dragged there kept — never before the saved layout has loaded, so a move cannot save a
 *  layout of one node over it. Each 0.6 portal is a linked node, "on <map>", that opens the other map at its
 *  records. A `?select=` in the address selects into the inspector; a selection is kept there. Attention comes from
 *  Needs you's items the viewer may see (E-35). */
function FullMapBody({ d, title, ctx, marks, live }: { d: FullMap; title: string; ctx: BlockCtx; marks: (r: Resource) => Mark[]; live: boolean }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const select = new URLSearchParams(useSearch()).get('select')
  const inspector = useInspector()
  const canWrite = useCanWrite()
  const { sees } = useViewer()
  const visibility = useVisibilitySource()
  const needs = useNeeds(ctx.now)
  // a ?select= that came from a click on the map is already open, with what the click handed it (its need, Move)
  useEffect(() => { if (select && live && inspector.id !== select) inspector.open(select) }, [select])
  const kept = d.board === 'organization'
  // every node's own file entry, whatever its kind: the gate's marker masks a name or status the viewer is not
  // admitted to (rule 3, E-70), as it does on a collection's map.
  const entryOf = useCallback((r: Resource): Record<string, unknown> | null => d.entryOf(r) ?? null, [d.entryOf])
  // a name the viewer is not admitted to reads "<hat> only" on its node (rule 3, E-70)
  const hatOf = (level: string) => restrictedHat(level, visibility)
  const map = useMemo(() => (kept
    ? { items: d.graph.nodes.map(r => mapItemOf(r, entryOf(r), hatOf)), links: mapLinksOf(d.graph.edges, { resources: d.graph.nodes, entryOf }) }
    : daoMapOf(d.graph.nodes, entryOf, d.graph.edges, hatOf)), [d.graph, entryOf, kept, visibility])
  const portals = useMemo(() => new Map(d.graph.portals.map(p => [p.id, p])), [d.graph.portals])
  const byId = useMemo(() => new Map(d.graph.nodes.map(r => [r.id, r])), [d.graph.nodes])
  const nodes = useMemo(() => withNeeds([
    ...mapNodesOf(map.items, d.graph.nodes, ctx.now, { staged: id => { const r = byId.get(id); return r !== undefined && marks(r).includes('staged') },
      restricted: r => restrictedOf(entryOf(r)), hatOf }),
    ...d.graph.portals.map(portalNode),
  ], needs.items ?? []), [map, d.graph, ctx.now, marks, needs.items])
  const positions = useMemo(() => (kept ? layoutBoard(d.graph.nodes, d.graph.edges, d.graph.portals, d.saved ?? {}) : undefined), [kept, d.graph, d.saved])
  const go = (id: string): boolean => {
    const p = portals.get(id)
    if (p && live) navigate(selectHref(p.toBoard, p.targets))
    return p !== undefined
  }
  // the canvas's name counts only what is drawn for this viewer (§6.3): not the records they may not see, nor portals
  const counted = nodes.filter(n => !portals.has(n.item.id) && sees(n.item)).length
  // a move or Auto-layout writes the layout: not while previewing (C-23), and not before the saved layout loaded
  const writes = kept && live && canWrite
  return (
    <HouseMap items={nodes} links={map.links} variant="members" selected={inspector.id} positions={positions} caption={!kept}
      label={kept ? `${title}, ${counted} ${counted === 1 ? 'record' : 'records'}` : undefined}
      onSelect={(id, act) => {
        if (!live || go(id)) return
        inspector.open(id, act)
        navigate(selectHref(d.board, [id]), { replace: true })
      }}
      onInspect={(id, act) => { if (live && !go(id)) inspector.open(id, act) }}
      onOpen={id => { if (live && !go(id) && byId.has(id)) navigate(recordHref(id)) }}
      onMove={writes && d.layoutReady ? (id, pos) => {
        // Read the cache, not this render's copy: several nodes may move in one batch.
        const next = { ...(qc.getQueryData<Positions>(['layout', d.board]) ?? {}), [id]: pos }
        qc.setQueryData(['layout', d.board], next)
        void api.saveLayout(d.board, next)
      } : undefined}
      onReset={writes ? () => { void api.resetLayout(d.board).then(() => qc.invalidateQueries({ queryKey: ['layout', d.board] })) } : undefined} />
  )
}

function MapBody({ cfg, data, ctx }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const d = data as FullMap | SomeRecords
  const view = (cfg.view ?? {}) as MapView
  const title = cfg.title ?? (d.full ? MAP_NAME[d.board] : 'Map')
  // One function per marks context, not per render: the clock re-renders the block every second.
  const marks = useCallback((r: Resource) => marksOf(r, ctx.marks), [ctx.marks])
  if (d.full) return <FullMapBody d={d} title={title} ctx={ctx} marks={marks} live={view.select !== false} />
  return <RecordsMap label={`${title} map`} rows={d.rows} map={view.map ?? 'organization'} positionsKey={view.mapKey ?? title} empty={view.empty ?? ''} marks={marks} now={ctx.now} />
}

/** The records graph as a block (spec §4.3, §8): a full map, or the records a source names on theirs. */
export const mapBlock = defineBlock<BlockCfg>({
  type: 'map', label: 'Map',
  config: [
    { key: 'title', label: 'title', input: 'text' },
    { key: 'source.map', label: 'map', input: 'select', options: ['organization', 'systems'] },
    { key: 'source.kind', label: 'kind', input: 'kind' },
    { key: 'source.where', label: 'where', input: 'yaml' },
  ],
  title: cfg => cfg.title ?? 'Map',
  useData: cfg => useMapData(cfg),
  Body: MapBody,
})
