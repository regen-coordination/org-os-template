// DAO-OS L6 Task 17: a collection in the Hub (spec §7, §15: `/c/:collection` and `/c/:collection/:view`) — L4c's view
// header over one of the five views (Table, Board, Calendar, List, Map), then the collection's saved views as tabs. The
// filters and the sort are the member's view state (theirs alone, in the store) until they save them as a view (a
// workspace write to data/collections.yaml). A record edited in a cell, moved on the board or added with "+ New" is a
// workspace write through the batch (§6 "Records") — or, under a raised rule, staged in the tray; any other registry's
// is staged in the tray as 0.6 stages it. What the viewer may not see is absent (rule 7): the records come gated from
// the server, a field kept from them is absent from its row and reads "<hat> only", is never filtered or sorted by a
// value, never edited, and never moved on a board (the card says why).
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'wouter'
import { api, ApiError, type Positions, type RecordOp } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { Note, NoteBlock } from '../design/Note.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { BoardCard, BoardView, type BoardColumn } from '../elements/views/BoardView.tsx'
import { CalEvent, CalendarView } from '../elements/views/CalendarView.tsx'
import { dayHeading } from '../elements/views/calendar.ts'
import { applyFilters, type Filter, type ViewKind } from '../elements/views/filters.ts'
import { ListView } from '../elements/views/ListView.tsx'
import { TableView, ViewEmpty, type Column } from '../elements/views/TableView.tsx'
import { ViewHeader } from '../elements/views/ViewHeader.tsx'
import { SaveState, type Save } from '../elements/workspace/SaveState.tsx'
import { seenRecord } from '../blocks/list.tsx'
import { entryHref } from '../hrefs.ts'
import { HouseMap } from '../map/HouseMap.tsx'
import { layoutBoard } from '../map/layout.ts'
import { announce } from '../parts/live.tsx'
import { refusalErrors } from '../record/useEditor.ts'
import { restrictedHat, restrictedOf } from '../record/restricted.ts'
import { recallPositions, rememberPositions } from '../storage.ts'
import { useNow } from '../time.ts'
import { useCanWrite, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import {
  BUILTIN_NAMES, boardColumns, boardFieldOf, cellText, collectionGraph, columnValue, dateFieldOf, dayOf, fieldsOf, inColumnOrder, NONE,
  placeOps, RECORD_WORD, recordIdOf, titleFieldOf, viewIdOf, type Field, type Row,
} from './collections.ts'
import { useCollection, useKeepViewState, useRecordWrites, type ViewState } from './useCollection.ts'
import type { SavedView } from '../../../server/workspace/collections.ts'
import { useFromMarks } from './fromMarks.ts' // DAO-OS L6 Task 19

/** The five views, in the order the header draws their tabs. */
export const KINDS: readonly { id: ViewKind; label: string }[] = [
  { id: 'table', label: 'Table' }, { id: 'board', label: 'Board' }, { id: 'calendar', label: 'Calendar' }, { id: 'list', label: 'List' }, { id: 'map', label: 'Map' },
]
const isKind = (v: string): v is ViewKind => KINDS.some(k => k.id === v)
/** A saved view's tab (its id in the address is the view's own). */
const savedTab = (id: string) => `view:${id}`

// Copy (rulings log, Task 17).
export const NO_COLLECTION = (id: string) => `There is no collection ${id}.`
export const NO_VIEW = (view: string, label: string) => `There is no view ${view} of ${label}.`
export const VIEW_STAGED = 'The view is staged in your change: it needs approval.'
export const MEETING_STAGED = 'The meeting and its notes page are staged in your change: they need approval.'
/** The meta line under the title: how a record's change goes, and where the records are kept. */
export const WORKSPACE_WRITE = 'Workspace write'
export const TRAY_WRITE = 'Changes go to your tray'
const RESTRICTED_CARD = (label: string, hat: string) => `Its ${label.toLowerCase()} is kept at ${hat}: it cannot be moved here.`
const NO_ID_CARD = 'This record has no id in its file, so it cannot be moved here.'

type Sort = { field: string; dir: 'asc' | 'desc' }
interface Work { filters: Filter[]; sort: Sort | null }
const isFilter = (v: unknown): v is Filter => typeof v === 'object' && v !== null && typeof (v as Filter).field === 'string'
  && typeof (v as Filter).op === 'string' && typeof (v as Filter).value === 'string'
const workOf = (v: { filters?: unknown; sort?: unknown } | undefined | null): Work => ({
  filters: Array.isArray(v?.filters) ? v!.filters.filter(isFilter) : [],
  sort: v?.sort && typeof (v.sort as Sort).field === 'string' ? v.sort as Sort : null,
})
const sameWork = (a: Work, b: Work) => JSON.stringify(a) === JSON.stringify(b)

/** A row's value as filters and sorts read it. */
const readEntry = (r: Row, field: string): unknown => r[field]
const today = (now: Date) => now.toISOString().slice(0, 10)

/** A refusal's words, as one sentence: with `record` (any, '' too), its errors' own sentences where it has them. */
const said = (err: unknown, record?: string): string => (record !== undefined ? refusalErrors(err, record) : [{ message: err instanceof Error ? err.message : String(err) }])
  .map(e => e.message).join(' ')

export default function CollectionPage({ collection, view }: { collection: string; view?: string }) {
  const c = useCollection(collection)
  const [, navigate] = useLocation()
  const canWrite = useCanWrite()
  const now = useNow(false)
  const label = c.def?.name ?? BUILTIN_NAMES[collection] ?? collection
  const saved: SavedView[] = (c.def?.views ?? []) as SavedView[]
  const fields = useMemo(() => fieldsOf(collection, c.def, c.entries), [collection, c.def, c.entries])
  const writes = useRecordWrites(collection, c.workspace, c.entries)

  // The tab: the address's, else the member's view state's, else the first saved view, else Table.
  const ready = !c.defs.isPending && c.state !== undefined
  const validTab = (t: string | undefined): t is string => t !== undefined && (isKind(t) || saved.some(v => savedTab(v.id) === t))
  const asked = view === undefined ? undefined : isKind(view) ? view : saved.some(v => v.id === view) ? savedTab(view) : null
  const tab = asked ?? (validTab(c.state?.view) ? c.state!.view! : saved[0] ? savedTab(saved[0].id) : 'table')
  const savedOf = (t: string) => saved.find(v => savedTab(v.id) === t)
  const current = savedOf(tab)
  const kind: ViewKind = current?.kind ?? (isKind(tab) ? tab : 'table')

  // The filters and sort: the view state's for this tab, else its saved view's; kept per tab change.
  const [work, setWork] = useState<Work | null>(null)
  useEffect(() => {
    if (!ready || work !== null) return
    setWork(c.state && c.state.view === tab ? workOf(c.state) : workOf(current))
  }, [ready])
  useKeepViewState(collection, work === null ? null : { view: tab, filters: work.filters, sort: work.sort }, canWrite && ready && work !== null, c.state)
  // A saved view's tab, however it is reached (a click, or the browser's Back and Forward), brings its own filters and
  // sort; one of the five views keeps the ones on now. The first tab keeps what the view state gave it.
  const was = useRef<string | null>(null)
  useEffect(() => {
    if (work === null) return
    if (was.current === null || was.current === tab) { was.current = tab; return }
    was.current = tab
    const next = savedOf(tab)
    if (next) setWork(workOf(next))
  }, [tab, work === null])

  if (c.read.error) {
    return <><PageHead title={label} /><NoteBlock title={c.read.error instanceof ApiError && c.read.error.status === 404 ? NO_COLLECTION(collection) : c.read.error.message} /></>
  }
  if (!ready || work === null || c.read.isPending) {
    return <><PageHead title={label} /><Skeleton rows={4} shape="row-1" label={label} /></>
  }
  if (asked === null) return <><PageHead title={label} /><NoteBlock title={NO_VIEW(view!, label)} /></>

  const go = (t: string) => {
    const next = savedOf(t)
    navigate(`/c/${encodeURIComponent(collection)}/${encodeURIComponent(next ? next.id : t)}`)
  }
  return (
    <CollectionBody key={collection} collection={collection} label={label} fields={fields} saved={saved} tab={tab} kind={kind} current={current}
      work={work} setWork={setWork} onView={go} writes={writes} workspace={c.workspace} now={now} canWrite={canWrite}
      board={current?.board?.field} date={current?.date} order={current?.board?.order} private={c.def !== undefined && c.def.visibility !== 'members'} />
  )
}

interface BodyProps {
  collection: string; label: string; fields: Field[]; saved: SavedView[]; tab: string; kind: ViewKind; current: SavedView | undefined
  work: Work; setWork(w: Work): void; onView(t: string): void; writes: ReturnType<typeof useRecordWrites>; workspace: boolean
  now: Date; canWrite: boolean; board?: string; date?: string; order?: string[]
  /** A private collection's records are kept in the store, in no file. */
  private: boolean
}

function CollectionBody(p: BodyProps) {
  const { collection, label, fields, work, setWork, writes } = p
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const source = useVisibilitySource()
  const hatOf = (level: string) => restrictedHat(level, source)
  const [save, setSave] = useState<{ state: Save; reason?: string } | null>(null)
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState<{ column?: string } | null>(null)
  const [naming, setNaming] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const title = titleFieldOf(fields)
  const boardField = boardFieldOf(fields, p.board)
  const dateField = dateFieldOf(fields, p.date)
  const marks = useFromMarks(collection) // DAO-OS L6 Task 19 (§10): the collection's from mark, as the server sends it

  // What your change stages for this collection's records: their values shown, the cells marked.
  const stagedOps = (writes.change?.ops ?? []).filter((o): o is Extract<typeof o, { record: string }> => o.op !== 'file' && o.record.startsWith(`${collection}:`))
  const stagedSet = (id: string): Record<string, unknown> => {
    const op = stagedOps.find(o => o.record === `${collection}:${id}`)
    return !op ? {} : op.op === 'update' ? op.set : op.op === 'create' || op.op === 'replace' ? op.value : {}
  }
  const rows: Row[] = useMemo(() => {
    const out = writes.rows.map(r => ({ ...r, ...stagedSet(String(r.id)) }))
    for (const o of stagedOps) if (o.op === 'create' && !out.some(r => `${collection}:${r.id}` === o.record)) out.push(o.value as Row)
    return out
  }, [writes.rows, writes.change])
  const restricted = (r: Row) => restrictedOf(r)
  const seen = seenRecord(restricted, hatOf, readEntry)
  const shown = applyFilters(rows, work.filters, seen)
  const filtered = work.filters.length > 0
  const clear = () => setWork({ ...work, filters: [] })

  /** One write of `ops`, its save state said: Saving…, then Saved · direct or Staged · needs approval, or Not saved.
   *  `quiet` (a board's move, which says its own move and refusal): only where the write landed. */
  const write = async (ops: RecordOp[], cells: string[], quiet = false): Promise<true | string> => {
    setSaving(s => new Set([...s, ...cells]))
    if (!quiet) setSave({ state: 'saving' })
    try {
      const out = await writes.write(ops)
      setSave({ state: out })
      return true
    } catch (err) {
      const reason = said(err, ops[0]?.record)
      if (!quiet) setSave({ state: 'refused', reason })
      return reason
    } finally {
      setSaving(s => { const next = new Set(s); for (const k of cells) next.delete(k); return next })
    }
  }

  const fieldOf = (id: string) => fields.find(x => x.id === id)
  const editable = (field: Field, r: Row) => p.canWrite && typeof r.id === 'string' && r.id !== '' && restricted(r)[field.id] === undefined
    && !field.many && ['text', 'longtext', 'select', 'date', 'number', 'url', 'email', 'phone', 'person', 'relation', 'page'].includes(field.type)
  const valueOf = (field: Field, text: string): unknown => {
    const t = text.trim()
    if (t === '') return null
    if (field.type === 'number' && Number.isFinite(Number(t))) return Number(t)
    return t
  }
  const cellKey = (r: Row, field: string) => `${r.id}\u0000${field}`

  // Rule 7: a record whose name is kept from the viewer is called "<hat> only", never by its id (a new record's id is its
  // title's slug), and opens nowhere from here (its address holds the id).
  const titleKept = (r: Row) => restricted(r)[title]
  const href = (r: Row): string | undefined => (typeof r.id === 'string' && r.id !== '' && titleKept(r) === undefined ? entryHref(collection, r.id) : undefined)
  const nameOf = (r: Row) => { const kept = titleKept(r); return kept !== undefined ? `${hatOf(kept)} only` : cellText(r[title]) || String(r.id ?? '') }
  const cellOf = (field: Field) => (r: Row): ReactNode => {
    const level = restricted(r)[field.id]
    if (level !== undefined) return <RestrictedValue hat={hatOf(level)} />
    const text = cellText(r[field.id])
    if (field.id === title) {
      // a meeting's title opens its notes page; a record's, its record page
      const notes = collection === 'meetings' && typeof r.notes === 'string' ? `/p/${encodeURIComponent(r.notes)}` : href(r)
      return notes ? <Link href={notes}>{text || String(r.id)}</Link> : text
    }
    if (field.type === 'page' && text !== '') return <Link href={`/p/${encodeURIComponent(text)}`}>{text}</Link>
    return text
  }
  const visibleFields = p.current?.columns ? fields.filter(x => p.current!.columns!.includes(x.id)) : fields
  const columns: Column<Row>[] = visibleFields.map((field, i) => ({
    key: field.id, label: field.label, cell: cellOf(field),
    sort: r => (restricted(r)[field.id] !== undefined ? '' : typeof r[field.id] === 'number' ? r[field.id] as number : cellText(r[field.id])),
    mono: field.type === 'date' || field.type === 'number', right: field.type === 'number',
    edit: r => (editable(field, r) ? cellText(r[field.id]) : null),
    late: collection === 'tasks' && field.id === 'due' ? (r: Row) => overdue(r, p.now) : undefined,
    card: i === 0 ? 'title' : field.id === boardField ? 'status' : 'meta',
  }))
  const staged = (r: Row, col: string) => (saving.has(cellKey(r, col)) ? 'saving' : Object.hasOwn(stagedSet(String(r.id)), col) ? 'staged' : null)

  const onEdit = (r: Row, col: string, text: string) => {
    const field = fieldOf(col)
    if (!field) return
    const ops: RecordOp[] = [{ op: 'update', record: `${collection}:${r.id}`, set: { [col]: valueOf(field, text) } }]
    void write(ops, [cellKey(r, col)]).then(out => announce(out === true ? `${nameOf(r)}: ${field.label.toLowerCase()} saved.` : `Not saved: ${out}`))
  }

  // ── the five views ──────────────────────────────────────────────────────────────────────────────────
  const empty = { title: `No ${label.toLowerCase()} yet.`, line: p.canWrite ? 'Add one with New.' : undefined }
  let body: ReactNode
  if (p.kind === 'board') {
    body = boardField === null
      ? <NoteBlock title={`${label} has no field to group a board by.`} line="A board groups records by a select field, such as Status." />
      : <Board {...p} rows={shown} field={fieldOf(boardField)!} restricted={restricted} hatOf={hatOf} nameOf={nameOf} href={href}
          dateField={dateField} write={write} onNew={column => setAdding({ column })} />
  } else if (p.kind === 'calendar') {
    body = dateField === null
      ? <NoteBlock title={`${label} has no date to place on a calendar.`} line="A calendar places records by a date field." />
      : <Calendar {...p} rows={shown} field={dateField} nameOf={nameOf} href={href} stagedSet={stagedSet} />
  } else if (p.kind === 'list') {
    const listed = sorted(shown, work.sort, fields, restricted)
    body = <ListView label={label} rows={listed} empty={empty} filtered={filtered} onClearFilters={clear}
      row={r => <DataRow key={String(r.id)} kind={RECORD_WORD[collection] ?? 'record'} title={nameOf(r)} href={href(r)} item={r}
        second={[boardField && r[boardField] ? cellText(r[boardField]) : '', dateField && r[dateField] ? cellText(r[dateField]) : ''].filter(Boolean).join(' · ') || undefined}
        marks={Object.keys(stagedSet(String(r.id))).length > 0 ? ['staged'] : []} />} />
  } else if (p.kind === 'map') {
    body = <CollectionMap collection={collection} label={label} rows={shown} fields={fields} filtered={filtered} onClear={clear} nameOf={nameOf} />
  } else {
    body = <TableView label={label} rows={shown} columns={columns} rowKey={r => String(r.id)} empty={empty} filtered={filtered} onClearFilters={clear}
      staged={staged} onEdit={onEdit} sort={work.sort ?? undefined} onSort={s => setWork({ ...work, sort: s })}
      groupBy={p.current?.group ? (r: Row) => cellText(r[p.current!.group!]) || '—' : undefined} />
  }

  // ── the header, the saved view, the save state ───────────────────────────────────────────────────────
  const dirty = p.current !== undefined && !sameWork(work, { filters: p.current.filters ?? [], sort: p.current.sort ?? null })
  const primary = !p.canWrite ? undefined
    : collection === 'meetings' ? { label: 'Record a meeting', onClick: () => setAdding({}) }
    : p.workspace ? { label: `New ${RECORD_WORD[collection] ?? 'record'}`, onClick: () => setAdding({}) }
    : { label: 'New', href: `/new/${encodeURIComponent(collection)}` }
  const saveView = async (name: string, id: string) => {
    const base = p.current && p.current.id === id ? p.current : undefined
    const body: Record<string, unknown> = { ...(base ?? {}), name, kind: p.kind, filters: work.filters, ...(work.sort ? { sort: work.sort } : {}) }
    delete body.id
    if (!work.sort) delete body.sort
    if (p.kind === 'board' && boardField) body.board = { ...(base?.board ?? {}), field: boardField }
    if (p.kind === 'calendar' && dateField) body.date = dateField
    const out = await api.saveView(collection, id, body)
    await qc.invalidateQueries({ queryKey: ['collections'] })
    setNaming(false)
    if (out.staged) { setNote(VIEW_STAGED); return }
    announce(`Saved the view ${name}.`)
    navigate(`/c/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`)
  }
  const tabs = [...KINDS, ...p.saved.map(v => ({ id: savedTab(v.id), label: v.name }))]
  return (
    <>
      <PageHead title={label} meta={[p.workspace ? WORKSPACE_WRITE : TRAY_WRITE]} />
      <div className="vlist cl-page">
        <ViewHeader label={label} views={tabs} value={p.tab} onView={p.onView} filters={work.filters} onFilters={f => setWork({ ...work, filters: f })}
          sort={work.sort ?? undefined} onSort={s => setWork({ ...work, sort: s })} fields={fields.map(x => ({ id: x.id, label: x.label }))} primary={primary}
          from={marks.collection} now={p.now} />
        <div className="cl-tools">
          {save && <SaveState state={save.state} reason={save.reason} />}
          {p.canWrite && !naming && (dirty
            ? <><span className="meta">Unsaved changes to {p.current!.name}</span>
                <Button small onClick={() => void saveView(p.current!.name, p.current!.id).catch(err => setNote(said(err, '')))}>Save changes</Button>
                <Button small variant="ghost" onClick={() => setNaming(true)}>Save as a new view…</Button></>
            : <Button small variant="ghost" onClick={() => setNaming(true)}>Save view…</Button>)}
          {naming && <NameView taken={p.saved.map(v => v.id)} onSave={saveView} onDone={() => setNaming(false)} />}
        </div>
        {note && <Note state="notYet">{note}</Note>}
        {adding && (collection === 'meetings'
          ? <RecordMeeting now={p.now} onDone={() => setAdding(null)} onRecorded={out => {
              setAdding(null)
              if (out.staged) setNote(MEETING_STAGED)
              else navigate(`/p/${encodeURIComponent(out.page)}`)
            }} />
          : <NewRecord label={label} column={adding.column === undefined ? undefined : adding.column === NONE ? 'none' : adding.column}
              onDone={() => setAdding(null)} onAdd={async text => {
                const id = recordIdOf(text)
                const value: Record<string, unknown> = { id, [title]: text }
                if (adding.column !== undefined && adding.column !== NONE && boardField) value[boardField] = adding.column
                if (adding.column !== undefined && boardField) {
                  const col = inColumnOrder(rows.filter(r => columnValue(r, boardField) === adding.column))
                  const last = col.at(-1)
                  if (col.length === 0 || typeof last?.order === 'number') value.order = (typeof last?.order === 'number' ? last.order : 0) + 1000
                }
                const out = await write([{ op: 'create', record: `${collection}:${id}`, value }], [])
                if (out !== true) throw new Error(out)
                announce(`Added ${text}.`)
                setAdding(null)
              }} />)}
        {body}
      </div>
    </>
  )
}

/** A task is overdue: due before today, and not done. */
function overdue(r: Row, now: Date): boolean {
  const due = dayOf(r.due)
  return due !== null && due < today(now) && !/^(done|closed|cancel)/i.test(cellText(r.status))
}

/** Rows in the sort's order (the list's; the table sorts its own): a value kept from the viewer sorts as empty. */
function sorted(rows: Row[], sort: Sort | null, fields: Field[], restricted: (r: Row) => Record<string, string>): Row[] {
  if (!sort || !fields.some(f => f.id === sort.field)) return rows
  const v = (r: Row) => (restricted(r)[sort.field] !== undefined ? '' : cellText(r[sort.field]))
  const out = [...rows].sort((a, b) => v(a).localeCompare(v(b)))
  return sort.dir === 'desc' ? out.reverse() : out
}

// ── the board ─────────────────────────────────────────────────────────────────────────────────────────

function Board(p: BodyProps & {
  rows: Row[]; field: Field; restricted(r: Row): Record<string, string>; hatOf(level: string): string; nameOf(r: Row): string
  href(r: Row): string | undefined; dateField: string | null; write(ops: RecordOp[], cells: string[], quiet?: boolean): Promise<true | string>; onNew(column: string): void
}) {
  const { field } = p
  // A card whose column the viewer may not see is drawn in a locked column of its level's own ("Ops only"): never by a
  // value it does not hold.
  const levelOf = (r: Row) => p.restricted(r)[field.id]
  const free = p.rows.filter(r => levelOf(r) === undefined)
  const kept = [...new Set(p.rows.map(levelOf).filter((l): l is string => l !== undefined))]
  const columns: BoardColumn[] = [
    ...boardColumns(free, field, p.order),
    ...kept.map(l => ({ id: `@kept:${l}`, name: `${p.hatOf(l)} only`, locked: true })),
  ]
  const columnOf = (r: Row) => { const l = levelOf(r); return l !== undefined ? `@kept:${l}` : columnValue(r, field.id) }
  const cards = inColumnOrder(p.rows)
  const inColumn = (col: string, without: Row) => cards.filter(r => r !== without && columnOf(r) === col)
  const onPlace = async (r: Row, to: string, at: number): Promise<true | string> => {
    const set = to === columnOf(r) ? {} : { [field.id]: to === NONE ? null : to }
    return p.write(placeOps(p.collection, inColumn(to, r), r, at, set), [], true)
  }
  const stagedOf = (r: Row) => (p.writes.change?.ops ?? []).some(o => o.op === 'update' && o.record === `${p.collection}:${r.id}` && Object.hasOwn(o.set, field.id))
  return (
    <BoardView label={p.label} columns={columns} cards={cards} cardKey={r => String(r.id)} cardName={p.nameOf} columnOf={columnOf}
      card={r => <BoardCard title={p.nameOf(r)} href={p.href(r)}
        facts={[p.dateField && p.dateField !== field.id ? cellText(r[p.dateField]) : '', r.owner ? cellText(r.owner) : '']} />}
      onMove={(r, to) => onPlace(r, to, inColumn(to, r).length)} onPlace={onPlace} staged={stagedOf}
      fixed={r => { const l = levelOf(r); return l !== undefined ? RESTRICTED_CARD(field.label, p.hatOf(l)) : typeof r.id !== 'string' || r.id === '' ? NO_ID_CARD : undefined }}
      onNew={p.canWrite ? (col => { if (!col.startsWith('@kept:')) p.onNew(col) }) : undefined} />
  )
}

// ── the calendar ──────────────────────────────────────────────────────────────────────────────────────

function Calendar(p: BodyProps & { rows: Row[]; field: string; nameOf(r: Row): string; href(r: Row): string | undefined; stagedSet(id: string): Record<string, unknown> }) {
  const t = today(p.now)
  const [month, setMonth] = useState(() => ({ year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) }))
  const [day, setDay] = useState<string | null>(null)
  const events = p.rows.filter(r => dayOf(r[p.field]) !== null)
  const glyph = p.collection === 'meetings' ? 'people' as const : p.collection === 'tasks' ? 'check' as const : 'calendar' as const
  const late = (r: Row) => p.collection === 'tasks' && overdue(r, p.now)
  const row = (r: Row) => <DataRow key={String(r.id)} kind={RECORD_WORD[p.collection] ?? 'record'} title={p.nameOf(r)} href={p.href(r)} item={r}
    marks={Object.hasOwn(p.stagedSet(String(r.id)), p.field) ? ['staged'] : []} tone={late(r) ? 'attn' : undefined} />
  const onDay = events.filter(r => dayOf(r[p.field]) === day)
  return (
    <>
      <CalendarView label={p.label} year={month.year} month={month.month} today={t} volatile events={events} dateOf={r => dayOf(r[p.field])!}
        event={r => <CalEvent glyph={glyph} title={p.nameOf(r)} late={late(r)} staged={Object.hasOwn(p.stagedSet(String(r.id)), p.field)} />}
        row={row} onOpenDay={setDay} onMonth={(year, m) => setMonth({ year, month: m })}
        empty={{ title: `No ${p.label.toLowerCase()} in this month.` }} />
      {day !== null && (
        <section className="cl-day" aria-label={dayHeading(day, t)}>
          <div className="cl-day-h"><h3 className="cl-day-t">{dayHeading(day, t)}</h3><Button small variant="ghost" onClick={() => setDay(null)}>Close</Button></div>
          {onDay.length === 0 ? <p className="meta">Nothing on this day.</p> : <ListView label={dayHeading(day, t)} rows={onDay} row={row} empty={{ title: 'Nothing on this day.' }} />}
        </section>
      )}
    </>
  )
}

// ── the map (§7.6) ────────────────────────────────────────────────────────────────────────────────────

function CollectionMap({ collection, label, rows, fields, filtered, onClear, nameOf }: { collection: string; label: string; rows: Row[]; fields: Field[]; filtered: boolean; onClear(): void; nameOf(r: Row): string }) {
  const [, navigate] = useLocation()
  const canWrite = useCanWrite()
  const source = useVisibilitySource()
  const targets = [...new Set(fields.filter(f => f.type === 'relation' && f.to && f.to !== collection && f.to !== 'proposals').map(f => f.to!))]
  // The records a relation names, as the gate gives them to this viewer: an edge to one they may not see is dropped.
  const reads = useQueries({ queries: targets.map(t => ({ queryKey: ['registry', t], queryFn: () => api.registry(t), retry: false })) })
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals, enabled: fields.some(f => f.to === 'proposals') })
  const known = (to: string, id: string) => {
    if (to === 'proposals') { const pr = proposals.data?.find(x => x.id === id); return pr ? { name: cellText(pr.title) || id } : null }
    const i = targets.indexOf(to)
    const e = (reads[i]?.data?.entries ?? []).find(x => String(x.id) === id) as Row | undefined
    if (!e) return null
    // a linked record whose name is kept from the viewer is "<hat> only", never its id (rule 7)
    const kept = restrictedOf(e).title ?? restrictedOf(e).name
    const name = kept !== undefined ? `${restrictedHat(kept, source)} only` : cellText(e.title ?? e.name) || id
    return { name, ...(typeof e.visibility === 'string' ? { visibility: e.visibility } : {}) }
  }
  const g = collectionGraph(rows, { id: collection, fields: fields.map(f => ({ id: f.id, type: f.type, name: f.label, ...(f.to ? { to: f.to } : {}) })) }, known, nameOf)
  const key = `collection:${collection}`
  const [kept, setKept] = useState<Positions>(() => recallPositions(key))
  const positions = useMemo(() => layoutBoard(g.items.map(i => ({ id: i.id, kind: i.kind, name: i.name, attention: null })), g.links, [], kept), [JSON.stringify(g), kept])
  if (rows.length === 0) return <ViewEmpty label={label} filtered={filtered} empty={{ title: `No ${label.toLowerCase()} yet.` }} onClearFilters={onClear} />
  const open = (id: string) => {
    const at = id.indexOf(':')
    const [reg, rid] = [id.slice(0, at), id.slice(at + 1)]
    navigate(reg === 'proposals' ? `/governance/proposals/${encodeURIComponent(rid)}` : entryHref(reg, rid))
  }
  return (
    <HouseMap items={g.items.map(item => ({ item, facts: item.kind, states: [] }))} links={g.links} variant="members" positions={positions}
      label={`${label} map, ${rows.length} ${rows.length === 1 ? 'record' : 'records'}`} onOpen={open}
      onMove={canWrite ? (id, at) => { const next = { ...kept, [id]: at }; setKept(next); rememberPositions(key, next) } : undefined}
      onReset={canWrite ? () => { setKept({}); rememberPositions(key, null) } : undefined} />
  )
}

// ── the small forms ───────────────────────────────────────────────────────────────────────────────────

function NewRecord({ label, column, onAdd, onDone }: { label: string; column?: string; onAdd(title: string): Promise<void>; onDone(): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim() === '' || busy) return
    setBusy(true)
    onAdd(text.trim()).catch(err => { setError(said(err)); setBusy(false) })
  }
  return (
    <form className="vfilter cl-form" aria-label={column ? `New in ${column === 'none' ? 'the column with none' : column}` : `New in ${label}`} onSubmit={submit}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone() } }}>
      <label className="vfilter-f vfilter-v"><span className="vfilter-l">Title</span>
        <input className="input" value={text} autoFocus onChange={e => { setText(e.target.value); setError(null) }} />
      </label>
      <div className="vfilter-acts">
        <Button small primary type="submit" busy={busy ? 'Adding…' : undefined}>Add</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {error && <Note state="error">{error}</Note>}
    </form>
  )
}

function RecordMeeting({ now, onRecorded, onDone }: { now: Date; onRecorded(out: { page: string; staged?: true }): void; onDone(): void }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => today(now))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() === '' || busy) return
    setBusy(true)
    api.recordMeeting({ title: title.trim(), date }).then(onRecorded, err => { setError(said(err)); setBusy(false) })
  }
  return (
    <form className="vfilter cl-form" aria-label="Record a meeting" onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone() } }}>
      <label className="vfilter-f vfilter-v"><span className="vfilter-l">Title</span>
        <input className="input" value={title} autoFocus onChange={e => { setTitle(e.target.value); setError(null) }} />
      </label>
      <label className="vfilter-f"><span className="vfilter-l">Date</span>
        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
      </label>
      <div className="vfilter-acts">
        <Button small primary type="submit" busy={busy ? 'Recording…' : undefined}>Record</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {error && <Note state="error">{error}</Note>}
    </form>
  )
}

function NameView({ taken, onSave, onDone }: { taken: string[]; onSave(name: string, id: string): Promise<void>; onDone(): void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim() === '' || busy) return
    setBusy(true)
    // A refusal's own sentences (M-1, PF-R116: a view by a restricted field), not the count of its errors.
    onSave(name.trim(), viewIdOf(name.trim(), taken)).catch(err => { setError(said(err, '')); setBusy(false) })
  }
  return (
    <form className="vfilter cl-form" aria-label="Save this view" onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone() } }}>
      <label className="vfilter-f vfilter-v"><span className="vfilter-l">View name</span>
        <input className="input" value={name} autoFocus aria-describedby={error ? 'save-view-err' : undefined} onChange={e => { setName(e.target.value); setError(null) }} />
      </label>
      <div className="vfilter-acts">
        <Button small primary type="submit" busy={busy ? 'Saving…' : undefined}>Save view</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <p className="meta">A saved view is written to the repository: every member can read it.</p>
      {error && <div id="save-view-err"><Note state="error">{error}</Note></div>}
    </form>
  )
}
