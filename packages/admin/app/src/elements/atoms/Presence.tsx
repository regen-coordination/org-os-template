import { Icon } from '../../design/Icon.tsx'

/** Two letters from who someone is, upper case (§7.12): the first letter of the first two words of their one display name
 *  (walk fix wave 4, G9: the server's `displayNames`, so a person has the same letters everywhere), or the first two
 *  letters of a one-word name. Of a hat's name and a short address ("Council · 0x00C0…0C01"), the hat's ("CO").
 *  Monograms, never pictures or identicons (C-22). */
export function monogram(name: string): string {
  const named = name.split(' · ')[0] ?? name
  const words = named.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters = words.length > 1 ? words[0]!.charAt(0) + words[1]!.charAt(0) : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase()
}

/** How many monograms a stack draws before it says "+N". */
const SHOWN = 3

/** Who else has this open (§7.12): 24px monograms on --wash-strong with a --paper ring, overlapping, first on top;
 *  more than three ends in an outlined "+N"; someone editing carries a pen badge. One element, named for everyone
 *  ("Ops lead is editing; Steward B is reading"). The caller passes only people who may see the thing. `small` is the
 *  20px stack a row ends in (a page others have open, in a list). */
export function Presence({ people, small = false }: { people: { handle: string; role: string; editing?: boolean }[]; small?: boolean }) {
  if (people.length === 0) return null
  const name = people.map(p => `${p.role} is ${p.editing ? 'editing' : 'reading'}`).join('; ')
  const more = people.length - SHOWN
  return (
    <span className={small ? 'pres pres-sm' : 'pres'} role="img" aria-label={name}>
      {people.slice(0, SHOWN).map(p => (
        <span className="av" key={p.handle}>
          {monogram(p.role)}
          {p.editing && <span className="av-pen"><Icon name="pencil" size="xs" /></span>}
        </span>
      ))}
      {more > 0 && <span className="av av-more">+{more}</span>}
    </span>
  )
}
