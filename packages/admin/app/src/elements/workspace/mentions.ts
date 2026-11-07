/** Who and what an `@` may name (§10.4): a person (their hat beside them), a role (how many wear it), or a record or
 *  a page. `canSee` is whether it may see the thing being written (for a person or a role) or whether the author may
 *  see it (for a record or a page) — the caller answers it from the visibility source; L6 wires it. */
export interface Mentionable {
  kind: 'person' | 'role' | 'record' | 'page'
  id: string
  label: string
  /** A person's hat, by name ("Ops"). */
  hat?: string
  /** A role's wearers, counted ("8 people"). */
  count?: number
  canSee: boolean
}

/** The words a name is matched on: its own words, lower case. */
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** What the picker offers for a query typed after `@` (the `@` itself is not part of it): those whose name has a
 *  word starting with it, or whose id does, whatever the case. A member who may not see the thing stays, after the
 *  rest, to be drawn disabled (C-21); a role, a record or a page that may not be seen is never offered (§6.3:
 *  absent, not disabled). The order given is kept within each part. */
export function mentionables(people: Mentionable[], query: string): Mentionable[] {
  const q = query.trim().replace(/^@/, '').trim().toLowerCase()
  const matches = (m: Mentionable) => q === '' || m.id.toLowerCase().startsWith(q) || m.label.toLowerCase().startsWith(q) || words(m.label).some(w => w.startsWith(q))
  const offered = people.filter(m => (m.canSee || m.kind === 'person') && matches(m))
  return [...offered.filter(m => m.canSee), ...offered.filter(m => !m.canSee)]
}
