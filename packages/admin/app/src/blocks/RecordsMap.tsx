import { useMemo, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Mark } from '../../../lib/machines/run.mjs'
import { api, type Board, type Positions, type Resource } from '../api.ts'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { HouseMap } from '../map/HouseMap.tsx'
import { layoutBoard } from '../map/layout.ts'
import { sectionGraph } from '../map/flow.ts'
import { mapItemOf, mapLinksOf, mapNodesOf } from '../map/fromRecords.ts'
import { recallPositions, rememberPositions } from '../storage.ts'
import { EmptyWhen } from '../design/Empty.tsx'
import { Note } from '../design/Note.tsx'
import { useSystemEntries } from '../queries.ts'
import { useEntryOf } from './entries.ts'
import { useCanWrite, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { restrictedHat, restrictedOf } from '../record/restricted.ts'

/** Some records as a map (§8.1, every collection's Map): them, their direct edges, their neighbours dimmed, drawn
 *  with the house's nodes and edges (E-42), each edge in plain words. The collection keeps its graph layout: its
 *  positions are kept in this browser under `positionsKey` (C-1: the layout routes are the two full maps'), a drag
 *  keeps a node where it was dropped, and Auto-layout forgets them. A click selects into the inspector. */
export function RecordsMap({ label, rows, map, positionsKey, empty, marks, now = new Date() }:
  { label: string; rows: Resource[]; map: Board; positionsKey: string; empty: string; marks?: (r: Resource) => Mark[]; now?: Date }) {
  const view = useQuery({ queryKey: ['graph', map], queryFn: () => api.graph(map) })
  const entries = useSystemEntries()
  // The records' own file entries (the gate's `restricted` marker lives there): a name the viewer is not admitted to
  // reads "<hat> only" on its node (rule 3, E-70).
  const { entryOf } = useEntryOf([...new Set(rows.map(r => r.kind))])
  const visibility = useVisibilitySource()
  const hatOf = useCallback((level: string) => restrictedHat(level, visibility), [visibility])
  const [saved, setSaved] = useState(() => recallPositions(positionsKey))
  const latest = useRef(saved)
  const keep = (next: Positions) => { latest.current = next; setSaved(next); rememberPositions(positionsKey, next) }
  const inspector = useInspector()
  const canWrite = useCanWrite()
  const g = useMemo(() => (view.data ? sectionGraph(rows, view.data) : null), [rows, view.data])
  const positions = useMemo(() => (g ? layoutBoard(g.nodes, g.edges, [], saved) : {}), [g, saved])
  const nodes = useMemo(() => {
    if (!g) return []
    const byId = new Map(g.nodes.map(r => [r.id, r]))
    const items = g.nodes.map(r => mapItemOf(r, entryOf(r) ?? (r.source?.entityId ? entries.get(r.source.entityId) ?? null : null), hatOf))
    return mapNodesOf(items, g.nodes, now, { faint: g.faint, restricted: r => restrictedOf(entryOf(r)), hatOf,
      staged: id => (marks?.(byId.get(id)!) ?? []).includes('staged') })
  }, [g, entries, entryOf, hatOf, marks, now])
  const links = useMemo(() => (g ? mapLinksOf(g.edges) : []), [g])
  if (view.error) return <Note state="error">{view.error.message}</Note>
  if (!g) return <EmptyWhen query={view}>{empty}</EmptyWhen>
  return (
    <HouseMap items={nodes} links={links} variant="members" positions={positions} label={label} selected={inspector.id}
      onSelect={(id, act) => inspector.open(id, act)} onInspect={(id, act) => inspector.open(id, act)}
      // moving a node and Auto-layout are writes (of this browser's positions): not while previewing (C-23)
      onMove={canWrite ? (id, pos) => keep({ ...latest.current, [id]: pos }) : undefined}
      onReset={canWrite ? () => { latest.current = {}; setSaved({}); rememberPositions(positionsKey, null) } : undefined} />
  )
}
