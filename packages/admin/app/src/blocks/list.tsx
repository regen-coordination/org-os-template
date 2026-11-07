import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'wouter'
import { api, type Board, type JobRecord, type Resource, type StageOp } from '../api.ts'
import { useResources, useSystemEntries, useSystemsRead } from '../queries.ts'
import { REGISTRY_OF_KIND } from '../kinds.ts'
import { unaddressable } from '../record/addressing.ts'
import { Mark } from '../design/Mark.tsx'
import { jobColumns } from '../pages/jobs.tsx'
import RegistryList from '../pages/RegistryList.tsx'
import { SECTION_IDS } from '../../../lib/board-query.mjs'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { sectionById } from '../sections.ts'
import { changeKeyOf, recordHref } from '../hrefs.ts'
import { recallView, rememberView, type View } from '../storage.ts'
import { Rows } from '../design/Rows.tsx'
import { useViewToggle } from '../keys/useViewToggle.ts'
import { refusalErrors } from '../record/useEditor.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { restrictedHat, restrictedOf, shownName } from '../record/restricted.ts'
import { Note } from '../design/Note.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import type { From } from '../elements/atoms/FromMark.tsx'
import { ViewHeader } from '../elements/views/ViewHeader.tsx'
import { TableView, ViewEmpty, type Column } from '../elements/views/TableView.tsx'
import { applyFilters, filterText, type Filter } from '../elements/views/filters.ts'
import { marksOf } from '../parts/marks.ts'
import { announce } from '../parts/live.tsx'
import { stagedValue } from './kanban.tsx'
import { column, listColumns, type ColumnOptions } from './columns.tsx'
import { RecordsMap } from './RecordsMap.tsx'
import { FilteredPlate } from '../design/Plate.tsx'
import { LiveSectionPlate, hiddenWords, useAddHref } from './plate.tsx'
import { runQuery } from './query.ts'
import { entryKinds, useEntryOf } from './entries.ts'
import { defineBlock } from './registry.ts'
import type { BlockCfg, BlockCtx, BlockData, BlockState, FrameView, RecordSource } from './types.ts'
import { useRecordNames } from '../record/refNames.ts'

export type ListView = FrameView & {
  columns?: string[]; head?: boolean; select?: boolean; switch?: boolean; filter?: boolean
  absent?: string            // an adapter key: its absence explains an empty list
  map?: Board; mapKey?: string // the map the List · Map switch draws on, and where its positions are kept
  new?: boolean              // a section's New and its unaddressable-entries line (boards; P4c)
}

/** Substring match over name, status and attention (P1 spec §6.2). */
export function filterRows(rows: Resource[], query: string): Resource[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(r => [r.name, r.status ?? '', r.attention?.text ?? ''].some(s => s.toLowerCase().includes(q)))
}

const sourceOf = (cfg: BlockCfg) => (cfg.source ?? {}) as RecordSource
const viewOf = (cfg: BlockCfg) => (cfg.view ?? {}) as ListView
/** Home's Recent operations as a source (P4-C9): jobs are not records, so they are read apart. */
export type JobsSource = { jobs: 'recent'; limit?: number }
export const isJobsSource = (s: unknown): s is JobsSource => typeof s === 'object' && s !== null && (s as { jobs?: unknown }).jobs === 'recent'
type ListJobs = { jobs: JobRecord[] }
type ListRegistry = { registry: string; label: string; empty: string; section: string }

/** The file a list reads, for its from mark (Q70, E-77): a registry-only section's, else the one registry its one
 *  kind is kept in; none for a list of several kinds or of every kind. */
function fileOf(s: RecordSource): string | undefined {
  const def = s.section !== undefined ? sectionById(s.section) : undefined
  if (def?.registry) return `data/${def.registry}.yaml`
  const kinds = kindsOf(s)
  const registry = kinds.length === 1 ? REGISTRY_OF_KIND[kinds[0]!] : undefined
  return registry ? `data/${registry}.yaml` : undefined
}

const kindsOf = (s: RecordSource): string[] => {
  if (s.section !== undefined) return sectionById(s.section)?.kinds ?? []
  const named = s.kind === undefined ? [] : Array.isArray(s.kind) ? s.kind : [s.kind]
  return named.includes('*') ? [] : named
}

function useListData(cfg: BlockCfg): BlockData {
  const resources = useResources()
  const systemsRead = useSystemsRead()
  const systems = systemsRead.entries
  const jobsSource = isJobsSource(cfg.source) ? cfg.source : null
  const jobs = useQuery({ queryKey: ['jobs', 'recent'], queryFn: () => api.jobs(), enabled: jobsSource !== null })
  const source = sourceOf(cfg)
  const key = JSON.stringify(source)
  const entries = useEntryOf(jobsSource ? [] : entryKinds(source))
  // What the viewer may not see is not drawn and not counted (§6.3, E-6): the frame's count and its empty state
  // come from what is left.
  // `visible` is new each draw; the viewer and the source it reads are what it changes with
  const { viewer, visible } = useViewer()
  const visibility = useVisibilitySource()
  const rows = useMemo(() => (jobsSource ? [] : visible(runQuery(source, resources.data ?? [], systems, entries.entryOf))), [resources.data, systems, key, entries.entryOf, viewer, visibility])
  if (jobsSource) {
    if (jobs.error) return { state: 'error', error: jobs.error.message }
    if (jobs.isPending) return { state: 'loading' }
    const list = jobs.data.slice(0, jobsSource.limit ?? 8)
    return list.length === 0 ? { state: 'empty', count: 0 } : { state: 'ready', data: { jobs: list } satisfies ListJobs, count: list.length }
  }
  // A registry-only section (Meetings) is its file's list, read by RegistryList itself.
  const def = source.section !== undefined ? sectionById(source.section) : undefined
  if (def?.registry) return { state: 'ready', data: { registry: def.registry, label: def.label, empty: def.empty, section: def.id } satisfies ListRegistry }
  if (resources.error) return { state: 'error', error: resources.error.message }
  // a section that sorts systems by their data/systems.yaml entry (Treasury, Outside systems, Sources) waits for it, and
  // says its failed read: without it every system would fall out of the section and read as nothing connected (I-2)
  if (def?.systems && systemsRead.error) return { state: 'error', error: systemsRead.error.message }
  if (resources.isPending || entries.pending || (def?.systems && systemsRead.pending)) return { state: 'loading' }
  const view = viewOf(cfg)
  const absent = view.absent ? resources.data!.find(r => r.id === `absent:${view.absent}`) : undefined
  if (rows.length === 0) return absent ? { state: 'unavailable', error: absent.attention?.text ?? why(absent) ?? view.empty } : { state: 'empty', count: 0 }
  return { state: 'ready', data: rows, count: rows.length }
}

/** Why a source is not here, when it is quiet about it (an absent card that asks nothing of the person). */
const why = (r: Resource) => (typeof r.facts.why === 'string' ? r.facts.why : undefined)

const labelOf = (cfg: BlockCfg) => cfg.title ?? 'Records'
const keyOf = (cfg: BlockCfg) => viewOf(cfg).mapKey ?? labelOf(cfg)

/** What a record's filter reads for each field the header offers: its name, status and need, else a fact. */
const FIELDS = [{ id: 'name', label: 'Name' }, { id: 'status', label: 'Status' }, { id: 'needs', label: 'Needs' }] as const
export function readRecord(r: Resource, field: string): unknown {
  if (field === 'name') return r.name
  if (field === 'status') return r.status
  if (field === 'needs') return r.attention?.text
  return r.facts[field]
}

/** What a filter reads of a record, as its viewer is shown it (rule 3, E-70): a field the gate's marker names reads as
 *  its restricted state ("Ops only") and never as a value the record may still carry in `facts` or `status` — the
 *  resources route gates whole records, not fields (server/visibility/gate.ts `gateGraph`), so a filter on the value
 *  would reveal it by the rows it leaves. */
export function seenRecord(restricted: (r: Resource) => Record<string, string>, hatOf: (level: string) => string) {
  return (r: Resource, field: string): unknown => {
    const level = field === 'needs' ? undefined : restricted(r)[field]
    return level !== undefined ? `${hatOf(level)} only` : readRecord(r, field)
  }
}

/** The two ways a list with a map is seen (List · Map); `v` turns between them. */
const LIST_MAP = [{ id: 'list', label: 'List' }, { id: 'map', label: 'Map' }]
const LIST = [{ id: 'list', label: 'List' }]

/** What the header sets, read by the body: the view (list or map) and the filters. */
interface Tools { mode: View; filters: Filter[]; setFilters(f: Filter[]): void; bare: boolean }
const ToolsCtx = createContext<Tools>({ mode: 'list', filters: [], setFilters: () => {}, bare: false })

/** The collection's view header (§10.2), around the body: List · Map in every state when the list has a map (P1: it
 *  sat in the page head, there whatever the records said; `v` turns it while focus is in the list), and the filters,
 *  only when there are records to filter. The choice of view is kept per list in this browser. */
function ListTools({ cfg, ctx, state, bare = false, children }: { cfg: BlockCfg; ctx: BlockCtx; state: BlockState; bare?: boolean; children: ReactNode }) {
  const configured = viewOf(cfg)
  // a registry-only section (Meetings) is drawn by RegistryList, which reads neither the view nor the filters: its
  // header offers neither (walk 2026-11-04), whatever the board says
  const section = isJobsSource(cfg.source) ? undefined : sourceOf(cfg).section
  const registryOnly = section !== undefined && sectionById(section)?.registry !== undefined
  const view = registryOnly ? { ...configured, switch: false, filter: false } : configured
  const key = keyOf(cfg)
  const resources = useResources()
  const file = isJobsSource(cfg.source) ? undefined : fileOf(sourceOf(cfg))
  // where the collection was read from, and when (E-77): the records' read, or the file's for a registry-only section
  const from: From | undefined = file ? { file, readAt: resources.dataUpdatedAt > 0 ? new Date(resources.dataUpdatedAt).toISOString() : null } : undefined
  const stands = newSectionOf(cfg)
  // a lone list's Add is the page head's primary (design pass 2026-11-04): the view header keeps it only inside a board
  const addHref = useAddHref(stands)
  const newHref = bare ? undefined : addHref
  const wrap = useRef<HTMLDivElement>(null)
  const [initial] = useState<View>(() => (view.switch ? recallView(key) : 'list'))
  const [mode, setMode] = useViewToggle(initial, view.switch ? wrap : undefined)
  const [filters, setFilters] = useState<Filter[]>([])
  const kept = useRef(initial)
  useEffect(() => { if (view.switch && mode !== kept.current) { kept.current = mode; rememberView(key, mode) } }, [mode])
  const filtering = view.filter === true && state === 'ready'
  const value = useMemo(() => ({ mode, filters: filtering ? filters : [], setFilters, bare }), [mode, filters, filtering, bare])
  return (
    <ToolsCtx.Provider value={value}>
      <div ref={wrap} className="vlist">
        {(view.switch || filtering || stands !== undefined) && (
          <ViewHeader label={labelOf(cfg)} views={view.switch ? LIST_MAP : LIST} value={mode} onView={v => setMode(v === 'map' ? 'map' : 'list')}
            filters={value.filters} onFilters={setFilters} fields={filtering ? FIELDS : undefined} from={from} now={ctx.now}
            primary={newHref !== undefined ? { label: 'New', href: newHref } : undefined} />
        )}
        {children}
      </div>
    </ToolsCtx.Provider>
  )
}

/** May this record's status be changed in place: a record of a file the house edits, with an id to stage against. */
const editableRecord = (r: Resource) => r.source?.editable === true && changeKeyOf(r) !== null

function RecordsBody({ cfg, data, ctx }: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const rows = data as Resource[]
  const view = viewOf(cfg)
  const systems = useSystemEntries()
  const inspector = useInspector()
  const [, navigate] = useLocation()
  const label = labelOf(cfg)
  const key = keyOf(cfg)
  const { mode, filters, setFilters, bare } = useContext(ToolsCtx)
  // The entries of the records' own file, for the gate's `restricted` marker (R-L5-14.5): a field the viewer is not
  // admitted to reads "<hat> only" in its cell (rule 3, E-70), the hat named by the house's visibility source.
  const entries = useEntryOf(kindsOf(sourceOf(cfg)))
  const visibility = useVisibilitySource()
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const restrictedOfRow = useCallback((r: Resource) => restrictedOf(entries.entryOf(r)), [entries.entryOf])
  const hatOf = useCallback((level: string) => restrictedHat(level, visibility), [visibility])
  const shown = useMemo(() => applyFilters(rows, filters, seenRecord(restrictedOfRow, hatOf)), [rows, filters, restrictedOfRow, hatOf])
  const marks = useCallback((r: Resource) => marksOf(r, ctx.marks), [ctx.marks]) // stable across ticks: a map rebuilds on a new one
  const { fieldText } = useRecordNames()
  const o: ColumnOptions = { marks, entry: r => (r.source?.entityId ? systems.get(r.source.entityId) : undefined), now: ctx.now,
    restricted: restrictedOfRow, hatOf, fieldText }
  const base = view.columns ? view.columns.flatMap(id => column(id, o) ?? []) : listColumns(kindsOf(sourceOf(cfg)), o)
  // Every 0.6 collection is governed (E-5): a status changed in its cell is staged, one op through the tray, and the
  // cell shows the value your change leaves until it is applied.
  const statusOf = (r: Resource) => String(stagedValue(r, 'status', ctx.marks.change) ?? r.status ?? '')
  // A status the viewer is not admitted to reads "<hat> only", is never sorted by its value, and is not edited (rule 3).
  const keptStatus = (r: Resource) => restrictedOfRow(r).status
  const columns: Column<Resource>[] = base.map(c => (c.key === 'status'
    ? { ...c, card: 'status',
        sort: r => (keptStatus(r) !== undefined ? '' : statusOf(r)),
        cell: r => { const level = keptStatus(r); return level !== undefined ? <RestrictedValue hat={hatOf(level)} /> : statusOf(r) },
        edit: r => (editableRecord(r) && keptStatus(r) === undefined ? statusOf(r) : null) }
    : c))
  const stage = async (r: Resource, value: string) => {
    const ops: StageOp[] = [{ op: 'update', record: changeKeyOf(r)!, set: { status: value } }]
    setSaving(s => new Set(s).add(r.id))
    try {
      await ctx.stage(ops)
      // the record named as its lead cell names it: "<hat> only" when the gate keeps its name (D-12, E-70)
      announce(`${shownName(r, entries.entryOf(r), visibility)}: status ${value}, staged. It is in your changes.`)
    } catch (err) {
      announce(`Not staged: ${refusalErrors(err, ops[0]!.record).map(e => e.message).join(' ')}`)
    } finally {
      setSaving(s => { const next = new Set(s); next.delete(r.id); return next })
    }
  }
  const staged = (r: Resource, col: string) => (col !== 'status' ? null
    : saving.has(r.id) ? 'saving' : stagedValue(r, 'status', ctx.marks.change) !== undefined ? 'staged' : null)
  const select = view.select ?? true
  const empty = { title: view.empty ?? 'Nothing here yet.' }
  const filtered = filters.length > 0
  const clear = () => setFilters([])
  // The cells mask from these entries, so nothing is drawn before they answer: a name or status the gate keeps never
  // prints raw first (D-12, E-70).
  if (entries.pending) return <Skeleton rows={3} shape="row" label={label} />
  // filtered to nothing: what the filters hid, by the status each hidden row reads as its viewer is shown it (rule 3)
  if (filtered && shown.length === 0) {
    const words = sectionById(sourceOf(cfg).section ?? '')?.words
    const seen = (r: Resource) => { const level = keptStatus(r); return level !== undefined ? `${hatOf(level)} only` : statusOf(r) }
    const named = filters.map(f => filterText(f, FIELDS.find(x => x.id === f.field)?.label)).join(', ')
    return <FilteredPlate nouns={words?.nouns ?? label.toLowerCase()} filters={named} hidden={hiddenWords(rows.map(seen))} onClear={clear} level={bare ? 2 : 3} />
  }
  if (mode === 'map') {
    return shown.length > 0
      ? <RecordsMap label={`${label} map`} rows={shown} map={view.map ?? 'organization'} positionsKey={key} empty={view.empty ?? ''} marks={marks} now={ctx.now} />
      : <ViewEmpty label={label} filtered={filtered} empty={empty} onClearFilters={clear} />
  }
  return (
    <TableView label={label} head={view.head ?? true} rows={shown} columns={columns} rowKey={r => r.id} empty={empty} filtered={filtered} onClearFilters={clear}
      staged={staged} onEdit={(r, col, value) => { if (col === 'status') void stage(r, value) }}
      selected={select ? inspector.id : null} onSelect={select ? inspector.open : undefined} onOpen={select ? id => navigate(recordHref(id)) : undefined} />
  )
}

function JobsBody({ cfg, jobs }: { cfg: BlockCfg; jobs: JobRecord[] }) {
  const resources = useResources()
  const byId = useMemo(() => new Map((resources.data ?? []).map(r => [r.id, r])), [resources.data])
  return <Rows label={cfg.title ?? 'Recent operations'} head={false} rows={jobs} rowKey={j => j.id} columns={jobColumns(byId, false)} empty={null} />
}

function ListBody(props: { cfg: BlockCfg; data: unknown; ctx: BlockCtx }) {
  const d = props.data as Resource[] | ListJobs | ListRegistry
  if (!Array.isArray(d) && 'jobs' in d) return <JobsBody cfg={props.cfg} jobs={d.jobs} />
  if (!Array.isArray(d)) return <RegistryList registry={d.registry} title={d.label} empty={d.empty} section={sectionById(d.section)} bare />
  return <RecordsBody {...props} />
}

/** The section a list with `view.new` stands for: its New and its unaddressable entries (P1 spec §6.2). */
const newSectionOf = (cfg: BlockCfg) => {
  const source = sourceOf(cfg)
  return viewOf(cfg).new && source.section !== undefined ? sectionById(source.section) : undefined
}

/** A section's unaddressable entries (P1 spec §6.2), which its page head carried until the section became a board: in
 *  the foot, so they show when the list is empty too. New is the view header's primary (§10.2, ruling I-1). */
function SectionFoot({ cfg }: { cfg: BlockCfg; ctx: BlockCtx }) {
  const def = newSectionOf(cfg)
  const backing = def && def.kinds.length === 1 ? REGISTRY_OF_KIND[def.kinds[0]!] : undefined
  const file = useQuery({ queryKey: ['registry', backing], queryFn: () => api.registry(backing!), enabled: backing !== undefined, retry: false })
  if (!def) return null
  const lost = unaddressable(file.data?.entries ?? [])
  return (
    <>
      {lost > 0 && backing && (
        <p className="problem"><Mark level="warn">
          {lost} entr{lost === 1 ? 'y' : 'ies'} in data/{backing}.yaml cannot be addressed (no id, or an id another entry shares), so {lost === 1 ? 'it is' : 'they are'} read-only.{' '}
          <Link href={`/all/${encodeURIComponent(backing)}`}>see the file's list →</Link>
        </Mark></p>
      )}
    </>
  )
}

/** An empty list: a section's plate (design pass 2026-11-04) when the section has its words and the board gave no
 *  empty sentence of its own (the board's view wins, R-7); else the empty line. */
function ListEmpty({ cfg, bare }: { cfg: BlockCfg; ctx: BlockCtx; bare: boolean }) {
  const view = viewOf(cfg)
  const source = isJobsSource(cfg.source) ? undefined : sourceOf(cfg)
  const def = source?.section !== undefined ? sectionById(source.section) : undefined
  if (!source || !def?.words || view.empty !== undefined) return <Note state="empty">{view.empty ?? 'Nothing here yet.'}</Note>
  return <LiveSectionPlate def={{ ...def, words: def.words }} source={source} level={bare ? 2 : 3} />
}

/** Records in a collection's table view (spec §4.3, §10.2): the view header, Cards at `row`, chosen columns, the
 *  status changed in place and staged, and List · Map. */
export const listBlock = defineBlock<BlockCfg>({
  type: 'list', label: 'List',
  config: [
    { key: 'title', label: 'title', input: 'text' },
    { key: 'source.kind', label: 'kind', input: 'kind' },
    { key: 'source.where', label: 'where', input: 'yaml' },
    { key: 'source.sort', label: 'sort', input: 'text' },
    { key: 'source.limit', label: 'limit', input: 'number' },
    { key: 'view.columns', label: 'columns', input: 'fields' },
    { key: 'source.section', label: 'section', input: 'select', options: [...SECTION_IDS] },
  ],
  title: cfg => cfg.title ?? (isJobsSource(cfg.source) ? 'Recent operations' : 'Records'),
  useData: cfg => useListData(cfg),
  Body: ListBody,
  Tools: ListTools,
  Empty: ListEmpty,
  Foot: SectionFoot,
})
