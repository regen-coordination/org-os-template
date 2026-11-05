import { Icon } from '../../design/Icon.tsx'

/** Two letters from a member's handle, upper case (§7.12): the first letter of its first two words, or the first two
 *  letters of a one-word handle. Monograms, never pictures or identicons (C-22). */
export function monogram(handle: string): string {
  const words = handle.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
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
          {monogram(p.handle)}
          {p.editing && <span className="av-pen"><Icon name="pencil" size="xs" /></span>}
        </span>
      ))}
      {more > 0 && <span className="av av-more">+{more}</span>}
    </span>
  )
}
