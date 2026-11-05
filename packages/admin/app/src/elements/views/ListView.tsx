import type { ReactNode } from 'react'
import { Note } from '../../design/Note.tsx'
import { useViewer } from '../../viewAs/ViewAs.tsx'
import { DataList } from '../rows/DataList.tsx'
import { ViewEmpty } from './TableView.tsx'

export interface ListViewProps<T> {
  label: string
  rows: T[]
  /** One row: a DataRow (§9.2), with its key. */
  row: (row: T) => ReactNode
  empty: { title: string; line?: string; action?: ReactNode }
  /** Filters are applied: no rows then is "No <label> match these filters.", with Clear filters. */
  filtered?: boolean
  onClearFilters?: () => void
  loading?: number
  error?: string
  onRetry?: () => void
}

/** A collection as a list (spec §10.2): data rows in a DataList, with the table's states — skeleton rows, a note
 *  with Try again, the empty state in the collection's words, and filtered-empty only when filters, not visibility,
 *  left nothing. Rows the viewer may not see are not drawn or counted. Its narrow form is itself. */
export function ListView<T>(p: ListViewProps<T>) {
  const { visible } = useViewer()
  if (p.loading !== undefined && p.loading > 0) return <DataList label={p.label} loading={p.loading}>{null}</DataList>
  if (p.error !== undefined) {
    return <Note state="error" action={p.onRetry && <button type="button" onClick={p.onRetry}>Try again</button>}>Couldn’t load {p.label}: {p.error}</Note>
  }
  const seen = visible(p.rows)
  if (seen.length === 0) return <ViewEmpty label={p.label} filtered={p.filtered === true && p.rows.length === 0} empty={p.empty} onClearFilters={p.onClearFilters} />
  return <DataList label={p.label}>{seen.map(r => p.row(r))}</DataList>
}
