import { useId, type ReactNode } from 'react'
import { SpecimenHeadings } from '../../design/PageHeading.tsx'

/** One spec card, as the gallery draws them: an eyebrow caption, then the element in its states. */
export function Card({ cap, children }: { cap: string; children: ReactNode }) {
  const id = useId()
  return <section className="pg-card" aria-labelledby={id}><h2 className="pg-cap" id={id}>{cap}</h2><SpecimenHeadings>{children}</SpecimenHeadings></section>
}

/** A row of a state column: the state's name, then the element drawn in that state. */
export function State({ name, children }: { name: string; children: ReactNode }) {
  return <div className="pg-state"><span className="pg-cap">{name}</span>{children}</div>
}
