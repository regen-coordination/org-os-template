// Who can see a page, in plain words, and the page's Hub address (coordinator, try-it scope): the line beside Copy link.
import type { Visibility, VisibilitySource } from '../viewAs/visibility.ts'

/** The page's Hub address: what Copy link copies. */
export const pageHref = (id: string): string => `/p/${encodeURIComponent(id)}`
export const pageAddress = (id: string, origin: string = window.location.origin): string => `${origin}${pageHref(id)}`

/** "Who can see this: Public" · "…: Members" · "…: Ops and the hats above it (Council, Top)" — a hat's wearers and the
 *  wearers of the hats above it (CONTEXT "Visibility"); a hat with none above is named alone. */
export function whoCanSee(v: Visibility, source: VisibilitySource): string {
  if (v.level === 'public') return 'Who can see this: Public'
  if (v.level === 'members') return 'Who can see this: Members'
  const names = new Map(source.hats().map(h => [h.hat, h.name]))
  const above = source.hatsAbove(v.hat).map(h => names.get(h) ?? h)
  return above.length === 0
    ? `Who can see this: ${v.name}`
    : `Who can see this: ${v.name} and the hats above it (${above.join(', ')})`
}

/** A level token as an item the visibility source reads: the gate's `visibility` (the Hub's source) and the fixtures'
 *  `facts.visibility` (FIXTURE_SOURCE, used until GET /api/visibility answers), so both read it alike. */
export const levelItem = (token: string): { visibility: string; facts: { visibility: string } } => ({ visibility: token, facts: { visibility: token } })
