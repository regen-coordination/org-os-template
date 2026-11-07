/** The people the house's fixtures draw (spec §17): the placeholder roles, by handle, with the monograms presence
 *  and mentions draw and a generated wallet each. Roles only — no fixture holds a real person's name. */
import { fakeAddress, ROLES } from './org.ts'

export interface FixturePerson { handle: string; name: string; monogram: string; wallet: string }

export const PEOPLE: readonly FixturePerson[] = ROLES.map((r, i) => ({ ...r, wallet: fakeAddress(100 + i) }))
