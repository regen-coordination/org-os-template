import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { Note, NoteBlock } from '../../design/Note.tsx'
import { Skeleton } from '../../design/Skeleton.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../../viewAs/ViewAs.tsx'
import { VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import { sameVisibility } from '../../viewAs/visibility.ts'

export interface Column<T> {
  key: string
  label: string
  cell: (row: T) => ReactNode
  sort?: (row: T) => string | number
  /** Mono: numbers, dates, ids. */
  mono?: boolean
  /** 0.6's kind column (a label face). */
  kind?: boolean
  /** End-aligned: numbers and dates. */
  right?: boolean
  /** The cell's value as its input edits it, or null where this row's cell cannot be edited. */
  edit?: (row: T) => string | null
  /** An overdue date: the cell is clay and says "overdue" — never colour alone. */
  late?: (row: T) => boolean
  /** Its place in the narrow form's card: the title, a fact of the "project · owner · due" line, the status at
   *  the end, or left out. The first column is the title and the rest are facts unless they say otherwise. */
  card?: 'title' | 'meta' | 'status' | 'none'
}

export type Sort = { key: string; dir: 'asc' | 'desc' } | null

/** The rows in a column's order; as given when nothing is sorted or the column cannot be. */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: Sort): T[] {
  const by = sort ? columns.find(c => c.key === sort.key)?.sort : undefined
  if (!sort || !by) return rows
  const out = [...rows].sort((a, b) => {
    const x = by(a), y = by(b)
    return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
  })
  return sort.dir === 'desc' ? out.reverse() : out
}

export interface TableViewProps<T> {
  label: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** Group rows (on --sunken, the group's name and count) in the order the groups first appear. */
  groupBy?: (row: T) => string
  /** A checkbox column: drawn on hover, and for every row once one is picked. */
  selectable?: boolean
  /** A cell's write in flight ("Saving") or staged ("Staged"): a moss underline and the word. */
  staged?: (row: T, col: string) => 'saving' | 'staged' | null
  /** An inline edit's new value (Enter edits, Esc cancels, Enter stages). Not drawn while previewing. */
  onEdit?: (row: T, col: string, value: string) => void
  /** The empty state, in the collection's own words (E-7). */
  empty: { title: string; line?: string; action?: ReactNode }
  /** Filters are applied: no rows then is "No <label> match these filters.", with Clear filters. */
  filtered?: boolean
  onClearFilters?: () => void
  /** Draw the column heads (0.6's lists without a head, Home's). */
  head?: boolean
  /** The sorted column: controlled with `onSort`, else the table keeps its own. */
  sort?: { field: string; dir: 'asc' | 'desc' }
  onSort?: (s: { field: string; dir: 'asc' | 'desc' } | null) => void
  /** The selected row (the inspector's), chosen by a click, and in a grid by moving to another row; Enter in a grid
   *  cell that is not edited opens its row. */
  selected?: string | null
  onSelect?: (key: string) => void
  onOpen?: (key: string) => void
  /** First load: this many skeleton rows. */
  loading?: number
  /** A failed read: a note with Try again. */
  error?: string
  onRetry?: () => void
}

const VIS = '@visibility'

/** Is a cell drawn? The narrow card form hides some (the checkbox, an empty fact): those are no keyboard stop. A
 *  browser without `checkVisibility` counts every cell as drawn. */
function rendered(el: HTMLElement): boolean {
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility
  return typeof check === 'function' ? check.call(el) : true
}

/** The rows in their groups, each group where its first row falls; one unnamed group without `groupBy`. */
function groupsOf<T>(rows: T[], groupBy?: (row: T) => string): { name: string | null; rows: T[] }[] {
  if (!groupBy) return [{ name: null, rows }]
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const name = groupBy(r)
    const into = out.get(name)
    if (into) into.push(r); else out.set(name, [r])
  }
  return [...out].map(([name, rows]) => ({ name, rows }))
}

function cls<T>(c: Column<T>, extra: (string | false | undefined)[] = []): string | undefined {
  return [c.mono && 'n', c.kind && 'k', c.right && 'r', ...extra].filter(Boolean).join(' ') || undefined
}

const cardOf = <T,>(c: Column<T>, i: number) => c.card ?? (i === 0 ? 'title' : 'meta')
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** A view with nothing to draw (§6.2): "No <label> match these filters." and Clear filters when the filters left
 *  nothing (`filtered`), else the collection's own empty state (E-7). Every view draws this one. */
export function ViewEmpty({ label, filtered, empty, onClearFilters }:
  { label: string; filtered: boolean; empty: { title: string; line?: string; action?: ReactNode }; onClearFilters?: () => void }) {
  return filtered
    ? <NoteBlock title={`No ${lower(label)} match these filters.`} action={onClearFilters && <Button small onClick={onClearFilters}>Clear filters</Button>} />
    : <NoteBlock title={empty.title} line={empty.line} action={empty.action} />
}

/** A collection's table (spec §10.2): a 36px sticky head (12/500 faint; the sorted column ink, with its chevron and
 *  `aria-sort`), 40px rows, Mono end-aligned numbers and dates, group rows, a checkbox column on hover or once a row
 *  is picked, and inline edits that stage, the cell then "Saving" or "Staged" over a moss underline. An overdue
 *  date is clay with its word. Rows the viewer may not see are not drawn or counted (§6.3); with none to draw the
 *  table is its empty state — filtered-empty only when filters, not visibility, left nothing. A Visibility column
 *  appears when the drawn rows hold more than one level (E-4).
 *
 *  A read-only table is a native `<table>` whose links stay in the Tab order. One with cells to edit, rows to pick or
 *  rows to select (`onSelect`) is `role="grid"` on the same native table (rows, heads and cells keep their native mapping; `aria-readonly` when
 *  no cell can be edited now): one tab stop, the arrows move between the drawn cells, Home and End go to a row's
 *  ends, Enter edits an editable cell and otherwise opens the row, Esc or leaving the cell cancels an edit — only
 *  Enter stages. Under 600px of its own width (the `tview` container) each row is
 *  a card — the title, its facts in one line, the status at the end — and the table never scrolls sideways. */
export function TableView<T>(p: TableViewProps<T>) {
  const { label, columns, rowKey } = p
  const { visible } = useViewer()
  const source = useVisibilitySource()
  const canWrite = useCanWrite()
  const [ownSort, setOwnSort] = useState<Sort>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [edit, setEdit] = useState<{ key: string; col: string; value: string } | null>(null)
  const table = useRef<HTMLTableElement>(null)
  const at = useRef({ r: 0, c: 0 })
  const refocus = useRef(false)
  const settled = useRef(false)

  const seen = visible(p.rows)
  const levels = seen.map(r => source.visibilityOf(r))
  const mixed = levels.some(l => !sameVisibility(l, levels[0]!))
  const cols: Column<T>[] = mixed
    ? [...columns, { key: VIS, label: 'Visibility', card: 'meta', cell: r => <VisibilityMarker value={source.visibilityOf(r)} /> }]
    : columns
  const sort: Sort = p.onSort ? (p.sort ? { key: p.sort.field, dir: p.sort.dir } : null) : ownSort
  const bodies = groupsOf(sortRows(seen, cols, sort), p.groupBy)
  const shown = bodies.flatMap(b => b.rows) // the drawn order, which the grid's row index follows
  const keys = shown.map(rowKey)
  const editing = p.onEdit !== undefined && canWrite
  const editable = (c: Column<T>, r: T) => editing && c.edit !== undefined && c.edit(r) !== null
  // Interactive — rows to pick or select, or cells to edit — is a grid: a row that opens by a click opens by Enter.
  const grid = p.selectable === true || p.onSelect !== undefined || (p.onEdit !== undefined && cols.some(c => c.edit !== undefined))

  const cellAt = (r: number, c: number) => table.current?.querySelector<HTMLElement>(`[data-cell][data-r="${r}"][data-c="${c}"]`) ?? null
  // One tab stop: the cell last reached, the first to begin with. A link or button inside a cell is reached through
  // its cell (Enter), so the grid stays one stop in the Tab order.
  useEffect(() => {
    const el = table.current
    if (!grid || !el) return
    const cells = [...el.querySelectorAll<HTMLElement>('[data-cell]')]
    if (cells.length === 0) return
    const now = cellAt(at.current.r, at.current.c)
    if (!now || !rendered(now)) {
      const first = cells.find(rendered) ?? cells[0]!
      at.current = { r: Number(first.dataset.r), c: Number(first.dataset.c) }
    }
    for (const cell of cells) {
      cell.tabIndex = Number(cell.dataset.r) === at.current.r && Number(cell.dataset.c) === at.current.c ? 0 : -1
      if (cell.tagName === 'TD') cell.querySelectorAll<HTMLElement>('a[href], button').forEach(x => { x.tabIndex = -1 })
    }
    if (refocus.current && edit === null) { refocus.current = false; cellAt(at.current.r, at.current.c)?.focus() }
  })

  if (p.loading !== undefined && p.loading > 0) {
    return <div className="tv"><Skeleton rows={p.loading} shape="row-1" label={label} /></div>
  }
  if (p.error !== undefined) {
    return (
      <div className="tv">
        <Note state="error" action={p.onRetry && <button type="button" onClick={p.onRetry}>Try again</button>}>Couldn’t load {label}: {p.error}</Note>
      </div>
    )
  }
  if (shown.length === 0) {
    // Filtered-empty only when the filters left nothing: rows the viewer may not see were never there (E-6).
    return <div className="tv"><ViewEmpty label={label} filtered={p.filtered === true && p.rows.length === 0} empty={p.empty} onClearFilters={p.onClearFilters} /></div>
  }

  const toggleSort = (key: string) => {
    const next: Sort = sort?.key === key ? (sort.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }
    if (p.onSort) p.onSort(next && { field: next.key, dir: next.dir })
    else setOwnSort(next)
  }
  const pick = (key: string, on: boolean) => setPicked(s => {
    const next = new Set(s)
    if (on) next.add(key); else next.delete(key)
    return next
  })
  const all = keys.length > 0 && keys.every(k => picked.has(k))
  const some = keys.some(k => picked.has(k))

  const begin = (row: T, c: Column<T>) => {
    settled.current = false
    setEdit({ key: rowKey(row), col: c.key, value: c.edit!(row) ?? '' })
  }
  /** Enter stages; Esc cancels and returns to the cell; leaving the cell (blur) cancels and leaves focus where it went. */
  const finish = (row: T, c: Column<T>, commit: boolean, back = true) => {
    if (settled.current || edit === null) return
    settled.current = true
    const was = c.edit!(row) ?? ''
    if (commit && edit.value !== was) p.onEdit!(row, c.key, edit.value)
    refocus.current = back
    setEdit(null)
  }

  /** The drawn cells of a row, in column order. */
  const drawn = (r: number) => [...table.current!.querySelectorAll<HTMLElement>(`[data-cell][data-r="${r}"]`)].filter(rendered)
  const colOf = (x: HTMLElement) => Number(x.dataset.c)
  /** Where a key goes from (r, c), over drawn cells only; null where there is nowhere to go. */
  const target = (key: string, r: number, c: number): HTMLElement | null => {
    if (key === 'ArrowLeft') return drawn(r).filter(x => colOf(x) < c).at(-1) ?? null
    if (key === 'ArrowRight') return drawn(r).find(x => colOf(x) > c) ?? null
    if (key === 'Home') return drawn(r)[0] ?? null
    if (key === 'End') return drawn(r).at(-1) ?? null
    for (let to = key === 'ArrowDown' ? r + 1 : r - 1; to >= 0 && to < keys.length; to += key === 'ArrowDown' ? 1 : -1) {
      const row = drawn(to)
      if (row.length > 0) return row.reduce((a, b) => (Math.abs(colOf(b) - c) < Math.abs(colOf(a) - c) ? b : a))
    }
    return null
  }
  const move = (cell: HTMLElement) => {
    const from = at.current
    const to = { r: Number(cell.dataset.r), c: colOf(cell) }
    at.current = to
    for (const x of table.current!.querySelectorAll<HTMLElement>('[data-cell]')) x.tabIndex = -1
    cell.tabIndex = 0
    cell.focus()
    if (p.onSelect && to.r !== from.r) p.onSelect(keys[to.r]!)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!grid || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    const t = e.target as HTMLElement
    if (t.closest('.tv-in')) return // the edit's own keys
    const cell = t.closest<HTMLElement>('[data-cell]')
    if (!cell) return
    if (t !== cell && (t.matches('input, select, textarea') || t.isContentEditable)) return // a field in a cell keeps its keys
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c)
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const to = target(e.key, r, c)
      if (to) move(to)
      return
    }
    if (e.key !== 'Enter' || cell.tagName === 'INPUT') return
    const row = shown[r]!
    const col = cols[c - (p.selectable ? 1 : 0)]
    e.preventDefault()
    at.current = { r, c }
    if (col && editable(col, row)) begin(row, col)
    else if (p.onOpen) p.onOpen(keys[r]!)
    else cell.querySelector<HTMLElement>('a[href], button')?.click()
  }

  const cellOf = (row: T, ri: number, c: Column<T>, ci: number) => {
    const k = rowKey(row)
    const gc = ci + (p.selectable ? 1 : 0)
    const st = p.staged?.(row, c.key) ?? null
    const late = c.late?.(row) ?? false
    const open = edit !== null && edit.key === k && edit.col === c.key
    const can = editable(c, row)
    return (
      <td key={c.key} className={cls(c, [st !== null && 'tv-staged', late && 'tv-late', open && 'tv-editing'])} data-card={cardOf(c, ci)}
        data-cell={grid ? '' : undefined} data-r={grid ? ri : undefined} data-c={grid ? gc : undefined}
        data-editable={can ? '' : undefined} onDoubleClick={can ? () => { at.current = { r: ri, c: gc }; begin(row, c) } : undefined}>
        {open
          ? <input className="input tv-in" aria-label={c.label} value={edit.value} autoFocus
              onChange={e => setEdit({ ...edit, value: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); finish(row, c, true) }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(row, c, false) }
              }}
              onBlur={() => finish(row, c, false, false)} />
          : <>
              {c.cell(row)}
              {late && <span className="tv-late-w"> overdue</span>}
              {st !== null && <span className="tv-st"><StatusMark mark="staged" label={st === 'saving' ? 'Saving' : 'Staged'} /></span>}
            </>}
      </td>
    )
  }

  const rowOf = (row: T, ri: number) => {
    const k = rowKey(row)
    const on = picked.has(k) || (p.selected !== undefined && p.selected !== null && k === p.selected)
    // A grid's rows say whether they are selected; a plain table's selected row is its current one.
    const ariaSelected = grid && (p.selectable || p.onSelect) ? on : undefined
    return (
      <tr key={k} className={on ? 'tv-sel' : undefined} aria-selected={ariaSelected} aria-current={!grid && on ? 'true' : undefined} onClick={p.onSelect ? () => p.onSelect!(k) : undefined}>
        {p.selectable && (
          <td className="tv-cb" data-card="none">
            <input type="checkbox" className="tv-check" aria-label="Select row" checked={picked.has(k)}
              data-cell={grid ? '' : undefined} data-r={ri} data-c={0}
              onClick={e => e.stopPropagation()} onChange={e => pick(k, e.target.checked)} />
          </td>
        )}
        {cols.map((c, ci) => cellOf(row, ri, c, ci))}
      </tr>
    )
  }

  const width = cols.length + (p.selectable ? 1 : 0)

  return (
    <div className="tv" data-picking={some ? '' : undefined}>
      <table ref={table} className="tv-table" aria-label={label} role={grid ? 'grid' : undefined}
        aria-readonly={grid && !shown.some(r => cols.some(c => editable(c, r))) ? true : undefined} onKeyDown={grid ? onKeyDown : undefined}
        onFocus={grid ? e => {
          const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
          if (cell) at.current = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) }
        } : undefined}>
        {p.head !== false && (
          <thead><tr>
            {p.selectable && (
              <th scope="col" className="tv-cb">
                <input type="checkbox" className="tv-check" aria-label="Select all rows" checked={all}
                  ref={el => { if (el) el.indeterminate = some && !all }}
                  onChange={e => setPicked(e.target.checked ? new Set(keys) : new Set())} />
              </th>
            )}
            {cols.map(c => {
              const on = sort?.key === c.key
              return (
                <th key={c.key} scope="col" className={cls(c, [on && 'tv-sorted'])}
                  aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sort
                    ? <button type="button" className="tv-sort" onClick={() => toggleSort(c.key)}>
                        {c.label}{on && <span className={sort!.dir === 'desc' ? 'tv-chev tv-desc' : 'tv-chev'}><Icon name="chevron-down" size="xs" /></span>}
                      </button>
                    : c.label}
                </th>
              )
            })}
          </tr></thead>
        )}
        {bodies.map((b, bi) => {
          const first = bodies.slice(0, bi).reduce((n, x) => n + x.rows.length, 0)
          return (
            <tbody key={b.name ?? bi}>
              {b.name !== null && (
                <tr className="tv-grp"><th scope="rowgroup" colSpan={width}>{b.name}<span className="tv-grp-c">{b.rows.length}</span></th></tr>
              )}
              {b.rows.map((row, i) => rowOf(row, first + i))}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}
