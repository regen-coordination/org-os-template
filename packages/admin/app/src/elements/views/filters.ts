/** A collection's views and filters (spec §10.2). A view never changes records: it chooses which rows are drawn,
 *  and how. Filters are plain data, so L6 can keep a saved view's filters in git as they are here. */

/** The five views every collection may be seen through, in the order the header draws their tabs. */
export type ViewKind = 'table' | 'board' | 'calendar' | 'list' | 'map'

/** One filter: a field, how it is compared, and the value it is compared with. */
export interface Filter { field: string; op: 'is' | 'is-not' | 'before' | 'after' | 'contains'; value: string }

/** What each comparison reads in a chip and in the filter form. */
export const OP_WORD: Record<Filter['op'], string> = { is: 'is', 'is-not': 'is not', before: 'is before', after: 'is after', contains: 'contains' }

/** A field id as a person reads it, in sentence case: "status" → "Status", "due-date" → "Due date". */
export function fieldWord(field: string): string {
  const words = field.replace(/[-_]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A filter as its chip reads it: "Status is not done". `label` is the field's own name where the collection
 *  gives one ("Owner" for `owner`); left out, the field id in sentence case. */
export function filterText(f: Filter, label?: string): string {
  return `${label ?? fieldWord(f.field)} ${OP_WORD[f.op]} ${f.value}`
}

/** A read value as text: a list is each of its items; nothing is no text at all. */
function texts(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (Array.isArray(v)) return v.flatMap(texts)
  return [String(v)]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const time = (s: string): number => (/^\d{4}-\d{2}-\d{2}/.test(s.trim()) ? Date.parse(s.trim()) : Number.NaN)

/** Does one row's value pass one filter? `is` matches the whole value, ignoring case (any item of a list);
 *  `is-not` is its opposite, so a row with no value passes it; `contains` finds the value inside the text;
 *  `before` and `after` compare ISO dates, and a value that is not a date passes neither. */
function passes(value: unknown, f: Filter): boolean {
  const vs = texts(value)
  switch (f.op) {
    case 'is': return vs.some(v => same(v, f.value))
    case 'is-not': return !vs.some(v => same(v, f.value))
    case 'contains': return f.value.trim() === '' || vs.some(v => v.toLowerCase().includes(f.value.trim().toLowerCase()))
    case 'before': case 'after': {
      const to = time(f.value)
      if (Number.isNaN(to)) return false
      return vs.some(v => { const at = time(v); return !Number.isNaN(at) && (f.op === 'before' ? at < to : at > to) })
    }
  }
}

/** The rows every filter lets through, in their order. `read` gives a row's value for a field. */
export function applyFilters<T>(rows: T[], filters: Filter[], read: (row: T, field: string) => unknown): T[] {
  if (filters.length === 0) return rows
  return rows.filter(r => filters.every(f => passes(read(r, f.field), f)))
}
