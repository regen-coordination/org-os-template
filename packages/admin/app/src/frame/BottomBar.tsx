import { useId, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Icon } from '../design/Icon.tsx'
import { MoreSheet, UNDER_MORE } from './MoreSheet.tsx'
import { HOUSE_SECTIONS, countText, sectionOf, type HouseCounts, type Identity as Who, type SectionId, type SideLink } from './sections.ts'

/** The four sections the bottom bar holds before More (C-7). */
const ON_BAR: readonly SectionId[] = ['home', 'needs', 'proposals', 'workspace']

/** The bottom bar (§5.4, C-7): five equal items, a 20px icon over an 11px label — Home, Needs you (a clay badge
 *  with its count, `--on-accent` text; the name carries the whole count), Proposals, Workspace, More. The current
 *  one is ink and `aria-current`; on a page More holds (Systems, Roles, Treasury, Library, Changes) More is drawn
 *  current. More opens the More sheet. Counts are of what the viewer may see (the caller counts, rule 7). `shown`
 *  draws the sheet open in place, for /parts. */
export function BottomBar({ counts, identity, collections = [], shown = false }:
  { counts: HouseCounts; identity: Who; collections?: SideLink[]; shown?: boolean }) {
  const [path] = useLocation()
  const [open, setOpen] = useState(shown)
  const more = useRef<HTMLButtonElement>(null)
  const sheet = useId()
  const at = sectionOf(path, collections)
  const underMore = at !== null && UNDER_MORE.includes(at)
  return (
    <>
      <nav className="bbar" aria-label="Hub">
        {ON_BAR.map(id => {
          const s = HOUSE_SECTIONS.find(x => x.id === id)!
          const n = id === 'needs' ? counts.needs : 0
          const text = countText(n)
          return (
            <Link key={id} href={s.href} className="bbar-a" aria-current={at === id ? 'page' : undefined} aria-label={text ? `${s.label}, ${n}` : undefined}>
              {/* the badge after the label in the text (it is drawn on the icon, absolutely): the visible words read
                  "Needs you 3", in the order the name says them (2.5.3) */}
              <Icon name={s.icon} size="lg" /><span className="bbar-l">{s.label}</span>{text && <>{' '}<span className="bbar-n" aria-hidden="true">{text}</span></>}
            </Link>
          )
        })}
        <button ref={more} type="button" className="bbar-a" aria-haspopup="dialog" aria-expanded={open} aria-controls={sheet}
          aria-current={underMore ? 'true' : undefined} onClick={() => { if (!shown) setOpen(o => !o) }}>
          <Icon name="menu" size="lg" /><span className="bbar-l">More</span>
        </button>
      </nav>
      <MoreSheet id={sheet} open={open} inline={shown} onClose={() => { if (!shown) setOpen(false) }} opener={more}
        counts={counts} identity={identity} current={at} />
    </>
  )
}
