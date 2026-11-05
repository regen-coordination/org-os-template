import type { ReactNode } from 'react'

/** A section head over its content (the gallery's "Needs you 3 · end link"): the label in Sans 600 14, its count in
 *  faint, and an end slot (a link, a segmented control). 0.6's `note` (sort, age) sits in the end slot, faint. The
 *  section is a region named by its label. */
export function Section({ label, count, end, note, id, children }:
  { label: string; count?: number; end?: ReactNode; note?: ReactNode; id?: string; children: ReactNode }) {
  const hasNote = note !== undefined && note !== null
  return (
    <section className="sect" id={id} aria-label={label}>
      <div className="sect-h">
        <h2 className="sect-t">{label}</h2>
        {count !== undefined && <span className="sect-n">{count}</span>}
        {(hasNote || end) && <span className="sect-end">{hasNote && <span className="sect-note">{note}</span>}{end}</span>}
      </div>
      {children}
    </section>
  )
}
