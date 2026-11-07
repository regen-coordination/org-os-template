import { Children, isValidElement, useRef, type ReactNode } from 'react'
import { Skeleton } from '../../design/Skeleton.tsx'
import { useRoving } from '../../keys/useRoving.ts'
import { useViewer } from '../../viewAs/ViewAs.tsx'

/** A list of data rows (§9.2) in a raised surface, radius 10, a hairline between rows. One tab stop; ↓/j and ↑/k
 *  move between the rows (`useRoving`). Its first load is `loading` skeleton rows of the row's own height, busy
 *  and named "Loading <label>". A child whose `item` the viewer may not see is dropped, with no placeholder (§6.3).
 *  The wrapper is the `rows` container: a Systems row lays itself out by its width. `head` is a column head drawn
 *  above the rows inside that container (the Systems list's Name · Chain · Where · State · Read): a picture for the
 *  eye, hidden from a screen reader, since each row says its own facts. */
export function DataList({ label, loading, head, children }: { label: string; loading?: number; head?: ReactNode; children: ReactNode }) {
  const list = useRef<HTMLUListElement>(null)
  useRoving(list)
  const { sees } = useViewer()
  if (loading !== undefined && loading > 0) {
    return <div className="dlist"><Skeleton rows={loading} shape="row" label={label} /></div>
  }
  const shown = Children.toArray(children).filter(c => {
    const item = isValidElement<{ item?: unknown }>(c) ? c.props.item : undefined
    return item === undefined || sees(item)
  })
  return (
    <div className="dlist">
      {head !== undefined && shown.length > 0 && <div className="dlist-head" aria-hidden="true">{head}</div>}
      <ul ref={list} className="dlist-ul" role="list" aria-label={label}>{shown}</ul>
    </div>
  )
}
