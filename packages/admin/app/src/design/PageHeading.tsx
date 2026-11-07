import { createContext, useContext, type ReactNode } from 'react'

/** The level an element's page heading is drawn at: 1 on a page; a gallery card (/parts) holds it at 3, under its own
 *  cap (h2), so a group page keeps one h1 (walk 2026-11-04). */
const Level = createContext<1 | 2 | 3>(1)

/** A gallery's specimens: each element's page heading under the card's cap (3), or, for a specimen drawn on the group
 *  page with no card around it, under the page's h1 (2). */
export function SpecimenHeadings({ level = 3, children }: { level?: 2 | 3; children: ReactNode }) {
  return <Level.Provider value={level}>{children}</Level.Provider>
}

/** An element's page heading (a page's title, the door's line, the sign-in title): the page's h1, or the level a
 *  gallery holds it at. The class carries its look, so every level draws alike. */
export function PageHeading({ className, id, children }: { className?: string; id?: string; children: ReactNode }) {
  const level = useContext(Level)
  const H = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
  return <H className={className} id={id}>{children}</H>
}
