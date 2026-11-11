// Walk fix wave 6b, I8: an embedded view of a collection, drawn inside a page's editor (the block `::view[…]{collection
// view}`). The rows come through the reads the collection page uses (GET /api/collections, GET /api/registries/:name), so
// they are judged as the viewer by the server, View as included (`?as=`), and again by the viewer's filter. The view the
// embed names draws as its kind does here: a list as data rows, a calendar as data rows by date, a board as a table grouped
// by its field, a table (and a map, or a view the collection does not hold) as a compact table; its filters and sort hold.
// At most EMBED_LIMIT rows, then how many more, and "Open <collection>" to the view's page. Read-only (PF-R286).
//
// Rule 4: a collection the viewer may not read draws EMBED_ABSENT and nothing else, exactly as one that is not there: no
// title, no count, no id, no link (the block's own element names nothing either; editor/view.ts).
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api, type CollectionView } from '../api.ts'
import { Note } from '../design/Note.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { applyFilters, type Filter } from '../elements/views/filters.ts'
import { ListView } from '../elements/views/ListView.tsx'
import { TableView, type Column } from '../elements/views/TableView.tsx'
import { seenRecord } from '../blocks/list.tsx'
import { entryHref } from '../hrefs.ts'
import { restrictedHat, restrictedOf } from '../record/restricted.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import type { SavedView } from '../../../server/workspace/collections.ts'
import { BUILTIN_NAMES, boardFieldOf, cellText, dateFieldOf, fieldsOf, RECORD_WORD, titleFieldOf, type Row } from './collections.ts'

/** The most rows an embedded view draws; the rest are counted, and the collection's page has them. */
export const EMBED_LIMIT = 10
/** What a block draws for a collection the viewer may not read, and for one that is not there: the same words. */
export const EMBED_ABSENT = 'Nothing here you may see.'
/** A compact table's columns, when the view names none. */
const COMPACT_COLUMNS = 4
const KIND_WORD: Record<SavedView['kind'], string> = { table: 'Table', board: 'Board', calendar: 'Calendar', list: 'List', map: 'Map' }
const isKind = (v: string): v is SavedView['kind'] => Object.hasOwn(KIND_WORD, v)

export function EmbeddedView({ collection, view }: { collection: string; view: string }) {
  // The collection page's own reads and keys: one cache, and the same answers.
  const defs = useQuery({ queryKey: ['collections'], queryFn: api.collections, retry: false })
  const read = useQuery({ queryKey: ['registry', collection], queryFn: () => api.registry(collection), retry: false })
  const { visible } = useViewer()
  const source = useVisibilitySource()
  if (read.isPending || (defs.isPending && !read.isError)) return <Note state="loading">Loading…</Note>
  const def: CollectionView | undefined = defs.data?.collections.find(d => d.id === collection)
  const entries = visible((read.data?.entries ?? []) as Row[])
  // Rule 4: readable when the viewer's collections name it, or the read gives them a row; else as never there.
  if (read.isError || (def === undefined && entries.length === 0)) return <p className="embed-absent">{EMBED_ABSENT}</p>

  const label = def?.name ?? BUILTIN_NAMES[collection] ?? collection
  const saved = ((def?.views ?? []) as SavedView[]).find(v => v.id === view)
  const kind: SavedView['kind'] = saved?.kind ?? (isKind(view) ? view : 'table')
  const fields = fieldsOf(collection, def, entries)
  const title = titleFieldOf(fields)
  const restricted = (r: Row) => restrictedOf(r)
  const hatOf = (level: string) => restrictedHat(level, source)
  const seen = seenRecord(restricted, hatOf, (r: Row, f: string) => r[f])
  let rows = applyFilters(entries, (saved?.filters ?? []) as Filter[], seen)
  const sort = saved?.sort
  const dateField = dateFieldOf(fields, saved?.date)
  const boardField = boardFieldOf(fields, saved?.board?.field)
  const by = kind === 'calendar' && dateField ? { field: dateField, dir: 'asc' as const } : sort && fields.some(f => f.id === sort.field) ? sort : null
  if (by) {
    const v = (r: Row) => (restricted(r)[by.field] !== undefined ? '' : cellText(r[by.field]))
    rows = [...rows].sort((a, b) => v(a).localeCompare(v(b)))
    if (by.dir === 'desc') rows.reverse()
  }
  const more = rows.length - EMBED_LIMIT
  const shown = rows.slice(0, EMBED_LIMIT)

  // Rule 7, as the collection page: a record whose name is kept from the viewer is "<hat> only" and opens nowhere.
  const titleKept = (r: Row) => restricted(r)[title]
  const href = (r: Row) => (typeof r.id === 'string' && r.id !== '' && titleKept(r) === undefined ? entryHref(collection, r.id) : undefined)
  const nameOf = (r: Row) => { const kept = titleKept(r); return kept !== undefined ? `${hatOf(kept)} only` : cellText(r[title]) || String(r.id ?? '') }
  const empty = { title: `No ${label.toLowerCase()} here yet.` }

  let body: ReactNode
  if (kind === 'list' || kind === 'calendar') {
    const second = (r: Row) => [kind === 'calendar' && dateField ? cellText(r[dateField]) : '', boardField ? cellText(r[boardField]) : '',
      kind === 'list' && dateField ? cellText(r[dateField]) : ''].filter(Boolean).join(' · ') || undefined
    body = <ListView label={label} rows={shown} empty={empty}
      row={r => <DataRow key={String(r.id)} kind={RECORD_WORD[collection] ?? 'record'} title={nameOf(r)} href={href(r)} second={second(r)} marks={[]} />} />
  } else {
    const named = saved?.columns ? fields.filter(f => saved.columns!.includes(f.id)) : fields.slice(0, COMPACT_COLUMNS)
    const columns: Column<Row>[] = named.map((field, i) => ({
      key: field.id, label: field.label, mono: field.type === 'date' || field.type === 'number', right: field.type === 'number',
      card: i === 0 ? 'title' : field.id === boardField ? 'status' : 'meta',
      cell: (r: Row): ReactNode => {
        const level = restricted(r)[field.id]
        if (level !== undefined) return <RestrictedValue hat={hatOf(level)} />
        if (field.id === title) { const to = href(r); return to ? <Link href={to}>{nameOf(r)}</Link> : nameOf(r) }
        return cellText(r[field.id])
      },
    }))
    body = <TableView label={label} rows={shown} columns={columns} rowKey={r => String(r.id)} empty={empty}
      groupBy={kind === 'board' && boardField ? (r: Row) => (restricted(r)[boardField] !== undefined ? '—' : cellText(r[boardField]) || '—') : undefined} />
  }
  const to = `/c/${encodeURIComponent(collection)}/${encodeURIComponent(saved ? saved.id : kind)}`
  return (
    <div className="embed-v">
      <div className="embed-h">
        <span className="embed-t">{label}</span>
        <span className="embed-k">{saved?.name ?? KIND_WORD[kind]}</span>
        <Link className="embed-open" href={to}>Open {label}</Link>
      </div>
      {body}
      {more > 0 && <p className="embed-more">{more} more</p>}
    </div>
  )
}
