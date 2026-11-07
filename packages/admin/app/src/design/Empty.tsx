import type { ReactNode } from 'react'
import { Note } from './Note.tsx'

/** One faint sentence saying why there is nothing: never a blank area. */
export function Empty({ children }: { children: ReactNode }) {
  return <Note state="empty">{children}</Note>
}

/** The `empty` line of a list fed by a query: "Loading…" until the first answer, nothing after a
 *  failure (the page shows the error), and the empty sentence only once data has arrived. */
export function EmptyWhen({ query, children }: { query: { isPending: boolean; error: unknown }; children: ReactNode }) {
  if (query.error) return null
  if (query.isPending) return <Note state="loading">Loading…</Note>
  return <Empty>{children}</Empty>
}
