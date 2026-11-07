import type { ReactNode } from 'react'

export type Level = 'warn' | 'alert'

/** 0.6's attention marker, drawn with the house's marks (§6.1): `warn` takes the needs shape (a clay dot) and
 *  keeps its text ink; `alert` takes the failed shape (a clay bar) and colours its text clay. The level is
 *  spoken, since the shape is not. */
export function Mark({ level, children, title }: { level: Level; children: ReactNode; title?: string }) {
  return (
    <span className={`mark ${level}`} title={title}>
      <span className="mark-shape" aria-hidden="true" />
      <span className="sr-only">{level === 'alert' ? 'Needs you: ' : 'Note: '}</span>
      <span className="mark-text">{children}</span>
    </span>
  )
}
