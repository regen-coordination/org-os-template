import { Link } from 'wouter'
import type { Mark } from '../../../lib/machines/run.mjs'
import type { Resource } from '../api.ts'
import type { Column } from '../design/Rows.tsx'
import { Mark as Attn } from '../design/Mark.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import { recordHref } from '../hrefs.ts'
import { FACT_COLUMNS, kindLabel } from '../kinds.ts'
import { ago } from '../time.ts'

export interface ColumnOptions {
  marks: (r: Resource) => Mark[]; entry: (r: Resource) => Record<string, unknown> | undefined; now: Date
  /** The fields of a record the viewer is not admitted to, each with the level that keeps them out (the gate's
   *  `restricted` marker, R-L5-14.5), and the name that level is read as ("Ops"): such a cell reads "Ops only" and
   *  never its value (rule 3, E-70). */
  restricted?: (r: Resource) => Record<string, string>
  hatOf?: (level: string) => string
  /** A field's value in words: a reference field names the records it holds (record/refNames.ts); else its text. */
  fieldText?: (kind: string, field: string, text: string) => string
}

/** The marks a lead cell spells out beside the name: what is staged, stale or running on the record. Needs is the
 *  needs column's. */
const WORDED: ReadonlySet<Mark> = new Set<Mark>(['stale', 'staged', 'running'])

/** The table's lead cell (§10.2, CC-4): the record's name as a link to its page (an absence, which has none, as
 *  text), and its staged, stale or running mark. Faint dims it. A `name` the viewer is not admitted to never prints
 *  its value (rule 3, E-70): the cell reads "<hat> only", in place of the name but still inside the link, with the mark
 *  beside it — the link is the row's pointer path to the record, and a masked row must keep it (R6). */
function Lead({ r, marks, kept }: { r: Resource; marks: Mark[]; kept?: string }) {
  return (
    <span className={marks.includes('faint') ? 'tv-lead o-dim' : 'tv-lead'}>
      {kept === undefined
        ? (r.kind === 'absent' ? <span title={r.name}>{r.name}</span> : <Link href={recordHref(r.id)} title={r.name}>{r.name}</Link>)
        : r.kind === 'absent' ? <RestrictedValue hat={kept} /> : <Link href={recordHref(r.id)}><RestrictedValue hat={kept} /></Link>}
      {marks.filter(m => WORDED.has(m)).map(m => <StatusMark key={m} mark={m} />)}
    </span>
  )
}

const lead = (r: Resource, o: ColumnOptions) => {
  const level = o.restricted?.(r).name
  return <Lead r={r} marks={o.marks(r)} kept={level === undefined ? undefined : o.hatOf?.(level) ?? level} />
}

/** A column by id (P4c's `view.columns` names them): the library below, else the fact column of
 *  that label for each record's own kind (empty where its kind has none). */
export function column(id: string, o: ColumnOptions): Column<Resource> | null {
  switch (id) {
    case 'kind': return { key: 'kind', label: 'kind', kind: true, sort: r => r.kind, cell: r => kindLabel(r.kind) }
    case 'name': return { key: 'name', label: 'name', sort: r => (o.restricted?.(r).name === undefined ? r.name.toLowerCase() : ''), cell: r => lead(r, o) }
    case 'markedName': return { key: 'name', label: 'name', cell: r => (r.attention ? <Attn level={r.attention.level}>{lead(r, o)}</Attn> : lead(r, o)) }
    case 'status': return { key: 'status', label: 'status', mono: true, sort: r => r.status ?? '', cell: r => r.status ?? '' }
    case 'stage': return { key: 'stage', label: 'stage', mono: true, cell: r => r.status ?? '' }
    case 'needs': return { key: 'needs', label: 'needs', sort: r => (r.attention ? (r.attention.level === 'alert' ? 0 : 1) : 2),
      cell: r => (r.attention ? <Attn level={r.attention.level}>{r.attention.text}</Attn> : '') }
    case 'needsText': return { key: 'text', label: 'needs', cell: r => <span className={r.attention?.level === 'alert' ? 'att brk' : 'brk'}>{r.attention?.text ?? ''}</span> }
    case 'age': return { key: 'age', label: 'age', mono: true, cell: r => (r.changed ? ago(r.changed.at, o.now) : '') }
    case 'changed': return { key: 'changed', label: 'changed', mono: true, sort: r => r.changed?.at ?? '', cell: r => (r.changed ? `${ago(r.changed.at, o.now)} · ${r.changed.by}` : '') }
    case 'seatState': return { key: 'state', label: 'state', mono: true, cell: r => {
      const state = typeof r.facts.state === 'string' ? r.facts.state : (r.status ?? '')
      const text = r.changed ? `${state} · ${ago(r.changed.at, o.now)}` : state
      return <span className={r.attention?.level === 'alert' ? 'att' : undefined}>{text}</span>
    } }
    default: {
      const of = (r: Resource) => (FACT_COLUMNS[r.kind] ?? []).find(c => c.label === id)
      // a field the viewer is not admitted to: its level, from the gate's marker on the record's entry
      const kept = (r: Resource) => { const f = of(r)?.field; return f !== undefined ? o.restricted?.(r)[f] : undefined }
      return { key: `fact:${id}`, label: id, mono: true, sort: r => (kept(r) ? '' : of(r)?.value(r, o.entry(r)) ?? ''),
        cell: r => {
          const level = kept(r)
          if (level) return <RestrictedValue hat={o.hatOf?.(level) ?? level} />
          const col = of(r)
          const text = col?.value(r, o.entry(r)) ?? ''
          return col?.field !== undefined && o.fieldText ? o.fieldText(r.kind, col.field, text) : text
        } }
    }
  }
}

/** A records list's default columns (P1's section lists): kind when the kinds are mixed, name,
 *  status, needs, the one kind's facts, changed. */
export function listColumns(kinds: string[], o: ColumnOptions): Column<Resource>[] {
  const ids = [...(kinds.length === 1 ? [] : ['kind']), 'name', 'status', 'needs',
    ...(kinds.length === 1 ? (FACT_COLUMNS[kinds[0]!] ?? []).map(c => c.label) : []), 'changed']
  return ids.map(id => column(id, o)!).map((c, i) => (c.key.startsWith('fact:') ? { ...c, key: `fact${i}` } : c))
}
