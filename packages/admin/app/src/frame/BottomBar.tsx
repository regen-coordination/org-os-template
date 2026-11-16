import { useId, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Icon } from '../design/Icon.tsx'
import { MoreSheet, ON_BAR } from './MoreSheet.tsx'
import { HOUSE_SECTIONS, countText, currentNavItem, sectionOf, type HouseCounts, type Identity as Who, type ResolvedNav, type SectionId, type SideLink } from './sections.ts'

/** The bottom bar (§5.4, C-7): five equal items, a 20px icon over an 11px label — Home, Needs you (a clay badge
 *  with its count, `--on-accent` text; the name carries the whole count), Proposals, Workspace, More. The current
 *  one is ink and `aria-current`; on a page More holds (Systems, Roles, Treasury, Library, Changes) More is drawn
 *  current. More opens the More sheet. Counts are of what the viewer may see (the caller counts, rule 7). `shown`
 *  draws the sheet open in place, for /parts. With an instance's groups (`nav`, house/nav.yaml) the bar keeps its four
 *  sections, each with the instance's label for it, and the sheet draws the groups; a page of the groups that is not
 *  one of the four draws More current. */
export function BottomBar({ counts, identity, collections = [], shown = false, nav = null }:
  { counts: HouseCounts; identity: Who; collections?: SideLink[]; shown?: boolean; nav?: ResolvedNav | null }) {
  const [path] = useLocation()
  const [open, setOpen] = useState(shown)
  const more = useRef<HTMLButtonElement>(null)
  const sheet = useId()
  const at = sectionOf(path, collections)
  // With a nav, its current item decides: a link of the instance's (Decided at /governance/decisions) is More's, not the
  // section its path falls under (Proposals).
  const item = nav ? currentNavItem(path, nav, collections) : null
  const here = item?.kind === 'link' ? null : item?.kind === 'section' ? item.section.id : at
  const onBar = here !== null && ON_BAR.includes(here) ? here : null
  const underMore = onBar === null && (item !== null || at !== null)
  const named = (id: SectionId) => nav?.groups.flatMap(g => g.items).find(i => i.kind === 'section' && i.section.id === id)?.label
  return (
    <>
      <nav className="bbar" aria-label="Hub">
        {ON_BAR.map(id => {
          const s = HOUSE_SECTIONS.find(x => x.id === id)!
          const label = named(id) ?? s.label
          const n = id === 'needs' ? counts.needs : 0
          const text = countText(n)
          return (
            <Link key={id} href={s.href} className="bbar-a" aria-current={onBar === id ? 'page' : undefined} aria-label={text ? `${label}, ${n}` : undefined}>
              {/* the badge after the label in the text (it is drawn on the icon, absolutely): the visible words read
                  "Needs you 3", in the order the name says them (2.5.3) */}
              <Icon name={s.icon} size="lg" /><span className="bbar-l">{label}</span>{text && <>{' '}<span className="bbar-n" aria-hidden="true">{text}</span></>}
            </Link>
          )
        })}
        <button ref={more} type="button" className="bbar-a" aria-haspopup="dialog" aria-expanded={open} aria-controls={sheet}
          aria-current={underMore ? 'true' : undefined} onClick={() => { if (!shown) setOpen(o => !o) }}>
          <Icon name="menu" size="lg" /><span className="bbar-l">More</span>
        </button>
      </nav>
      <MoreSheet id={sheet} open={open} inline={shown} onClose={() => { if (!shown) setOpen(false) }} opener={more}
        counts={counts} identity={identity} current={at} nav={nav} navCurrent={item} />
    </>
  )
}
