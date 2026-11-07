import type { ReactNode } from 'react'
import { TableView, sortRows, type Column } from '../elements/views/TableView.tsx'
import { useViewer } from '../viewAs/ViewAs.tsx'

export { sortRows, type Column }

interface RowsProps<T> {
  label: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  head?: boolean
  selected?: string | null
  onSelect?: (key: string) => void
  onOpen?: (key: string) => void
  empty?: ReactNode
}

/** 0.6's ruled table, kept by name for its callers (L4-R4) and drawn as the house's table view (§10.2): sorting by a
 *  column head, a row chosen by a click or by the arrows, Enter to open it. With no row the viewer may see it is its
 *  `empty` line (nothing, without one). New callers use `TableView`, which takes the collection's empty words and its filters. */
export function Rows<T>({ label, rows, columns, rowKey, head = true, selected = null, onSelect, onOpen, empty }: RowsProps<T>) {
  const { visible } = useViewer()
  if (visible(rows).length === 0) return <>{empty ?? null}</>
  return <TableView label={label} rows={rows} columns={columns} rowKey={rowKey} head={head} empty={{ title: 'Nothing here yet.' }}
    selected={selected} onSelect={onSelect} onOpen={onOpen} />
}
