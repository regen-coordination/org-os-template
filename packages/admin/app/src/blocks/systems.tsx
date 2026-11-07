import { useMemo, useRef } from 'react'
import { useLocation } from 'wouter'
import type { Resource } from '../api.ts'
import type { SystemEntries } from '../sections.ts'
import { useResources, useSystemsRead } from '../queries.ts'
import { Skeleton } from '../design/Skeleton.tsx'
import { Note } from '../design/Note.tsx'
import { recordHref } from '../hrefs.ts'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { useViewToggle } from '../keys/useViewToggle.ts'
import { marksOf } from '../parts/marks.ts'
import { DataList } from '../elements/rows/DataList.tsx'
import { SystemRow } from '../elements/rows/SystemRow.tsx'
import { ViewHeader } from '../elements/views/ViewHeader.tsx'
import { ViewEmpty } from '../elements/views/TableView.tsx'
import type { From } from '../elements/atoms/from.ts'
import { HouseMap } from '../map/HouseMap.tsx'
import { daoMapOf, mapNodesOf, ownerOf } from '../map/fromRecords.ts'
import { withNeeds } from '../map/valueFlow.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { restrictedHat, restrictedOf } from '../record/restricted.ts'
import type { MarkContext } from '../parts/marks.ts'
import { useNeeds } from './needs.tsx'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData } from './types.ts'

const LIST_MAP = [{ id: 'list', label: 'List' }, { id: 'map', label: 'Map' }]

/** The Systems list's column head (the gallery's): Name, Chain, Where, State, Read — over the tile, the main and
 *  each trailing column of the Systems row. */
export const SYSTEMS_HEAD = (
  <div className="drow sysrow dlist-h"><span /><span>Name</span><span>Chain</span><span>Where</span><span>State</span><span className="sysrow-age">Read</span></div>
)

/** Every System as the DAO map draws it (§8.2): its items and links from the reads, each node's facts and states
 *  (E-46), attention from Needs you's items the viewer may see (E-35), the main Safe big. The main Safe (the one in the
 *  treasury) and a tree's hats come from data/systems.yaml's entries: the map is loading until that file answered, and
 *  says its error when it failed (review I-2). */
export function SystemsMap(props: { systems: Resource[]; now: Date; marks: MarkContext; label?: string }) {
  const read = useSystemsRead()
  if (read.error) return <Note state="error">{read.error.message}</Note>
  if (read.pending) return <Skeleton rows={3} shape="node" label={props.label ?? 'the map'} />
  return <DrawnSystemsMap {...props} entries={read.entries} />
}

function DrawnSystemsMap({ systems, now, marks, label, entries }: { systems: Resource[]; now: Date; marks: MarkContext; label?: string; entries: SystemEntries }) {
  const inspector = useInspector()
  const [, navigate] = useLocation()
  const needs = useNeeds(now)
  const visibility = useVisibilitySource()
  const entryOf = (r: Resource) => (r.source?.entityId ? entries.get(r.source.entityId) ?? null : null)
  // a name the viewer is not admitted to reads "<hat> only" on its node (rule 3, E-70), the hat named by the house's source
  const hatOf = useMemo(() => (level: string) => restrictedHat(level, visibility), [visibility])
  const map = useMemo(() => daoMapOf(systems, entryOf, [], hatOf), [systems, entries, hatOf])
  const byId = useMemo(() => new Map(systems.map(r => [r.id, r])), [systems])
  const staged = (id: string) => { const r = byId.get(id); return r !== undefined && marksOf(r, marks).includes('staged') }
  // needs come from useNeeds already filtered for the viewer: a need the viewer may not see titles no node (E-35)
  const nodes = useMemo(() => withNeeds(mapNodesOf(map.items, systems, now, { staged, restricted: r => restrictedOf(entryOf(r)), hatOf }), needs.items ?? []), [map, systems, now, needs.items, marks])
  return (
    // a node opens its record (a hat, its tree's), the inspector at the need it is lit for (E-46)
    <HouseMap items={nodes} links={map.links} variant="members" selected={inspector.id} caption label={label}
      onSelect={(id, act) => inspector.open(ownerOf(id, systems), act)} onInspect={(id, act) => inspector.open(ownerOf(id, systems), act)}
      onOpen={id => navigate(recordHref(ownerOf(id, systems)))} />
  )
}

/** The Systems as a list or the DAO map (§9.2, §8): the view header's List · Map (`v` turns it), each System a row that
 *  opens its record, Space previewing it in the inspector at the row (E-36), under the column head. What the viewer
 *  may not see is not drawn (the rows' `item`) and not counted (the caller's). */
export function SystemsView({ systems, now, marks, label = 'Systems', from }: { systems: Resource[]; now: Date; marks: MarkContext; label?: string; from?: From }) {
  const box = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useViewToggle('list', box)
  const inspector = useInspector()
  const empty = { title: 'No Systems here yet.', line: 'Add one from the Library, or give data/systems.yaml an entry.' }
  return (
    <div ref={box} className="vlist">
      <ViewHeader label={label} views={LIST_MAP} value={mode} onView={v => setMode(v === 'map' ? 'map' : 'list')} filters={[]} onFilters={() => {}}
        from={from} now={now} />
      {systems.length === 0 ? <ViewEmpty label={label} filtered={false} empty={empty} />
        : mode === 'map' ? <SystemsMap systems={systems} now={now} marks={marks} />
        : (
          <DataList label={label} head={SYSTEMS_HEAD}>
            {systems.map(r => (
              <SystemRow key={r.id} resource={r} now={now} href={recordHref(r.id)} selected={inspector.id === r.id}
                onPreview={() => inspector.open(r.id)} />
            ))}
          </DataList>
        )}
    </div>
  )
}

/** The Systems the viewer may see: every `system` record (outside systems, the sources' connectors, the treasury). */
export function useSystems(): { systems: Resource[] | null; error?: string } {
  const resources = useResources()
  const { viewer, visible } = useViewer()
  const source = useVisibilitySource()
  const systems = useMemo(() => (resources.data ? visible(resources.data.filter(r => r.kind === 'system')) : null), [resources.data, viewer, source])
  return { systems, error: resources.error?.message }
}

function useSystemsData(): BlockData {
  const { systems, error } = useSystems()
  if (error !== undefined) return { state: 'error', error }
  if (systems === null) return { state: 'loading' }
  // none the viewer may see is the view's own empty state, with no count (Review Focus 1)
  return { state: 'ready', count: systems.length > 0 ? systems.length : undefined, data: systems }
}

function SystemsBody({ cfg, data, ctx }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  return <SystemsView systems={data as Resource[]} now={ctx.now} marks={ctx.marks} label={cfg.title ?? 'Systems'} />
}

/** Every System as a block (Home's Systems): data rows with List · Map, the map the DAO map. It reads no source. */
export const systemsBlock = defineBlock<BlockCfg>({
  type: 'systems', label: 'Systems',
  config: [{ key: 'title', label: 'title', input: 'text' }],
  title: cfg => cfg.title ?? 'Systems',
  useData: () => useSystemsData(),
  Body: SystemsBody,
})
