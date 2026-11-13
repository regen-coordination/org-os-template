import { useId, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { Icon, type IconName } from '../design/Icon.tsx'
import { Kbd } from '../design/Kbd.tsx'
import { Tooltip } from '../design/Tooltip.tsx'
import { OPEN_CHANGES } from '../keys/useHouseKeys.ts'
import { useFrame } from '../design/Shell.tsx'
import { Identity } from './Identity.tsx'
import { usePortalOrigin } from '../session/session.ts'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import { HOUSE_SECTIONS, countText, currentNavItem, isCurrent, sectionOf, type HouseCounts, type HouseSection, type Identity as Who, type NavLink, type OrgMark, type ResolvedNav, type SideLink as Place } from './sections.ts'

type Tone = 'attn' | 'accent'

/** One sidebar link: icon + label + trailing count; on the rail the icon alone, the label its name and its
 *  tooltip, the count a superscript. The name carries the whole count ("Needs you, 120") where the face reads
 *  99+. `current` is the page you are on (aria-current); `on` draws an ancestor of it the same way. An `empty`
 *  collection trails a dashed dot in place of a count, its name "Funding, empty" (design pass 2026-11-04). */
function SideLink({ href, label, icon, count = 0, tone, current, on = current, sub = false, rail, empty = false, onClick }:
  { href: string; label: string; icon?: IconName; count?: number; tone?: Tone; current: boolean; on?: boolean; sub?: boolean; rail: boolean
    empty?: boolean; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const text = countText(count)
  const name = text ? `${label}, ${count}` : empty ? `${label}, empty` : label
  const cls = ['side-a', sub ? 'side-sub' : null, on ? 'on' : null].filter(Boolean).join(' ')
  const link = (
    <Link href={href} className={cls} aria-current={current ? 'page' : undefined} aria-label={name} onClick={onClick}>
      {icon && <Icon name={icon} />}
      {!rail && <span className="side-l">{label}</span>}
      {/* a space between the label and the count, not drawn in the flex row: the visible words read "Needs you 3",
          as the name says them (2.5.3) */}
      {text && <>{' '}<span className={tone ? `n ${tone}` : 'n'}>{text}</span></>}
      {!text && empty && <span className="side-dot" aria-hidden="true" />}
    </Link>
  )
  return rail ? <Tooltip text={label}>{link}</Tooltip> : link
}

/** The Instance group (C-8): 0.6's org-os boards, a disclosure collapsed by default at the foot of the sections. */
function InstanceGroup({ links, path }: { links: Place[]; path: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="side-group">
      <button type="button" className="side-h" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="xs" />Instance
      </button>
      {open && <div id={id} className="side-group-in">
        {links.map(l => <SideLink key={l.href} href={l.href} label={l.label} current={isCurrent(path, l.href)} sub rail={false} />)}
      </div>}
    </div>
  )
}

/** An instance's group (house/nav.yaml): its label as a heading over its items, or, unlabelled, the items alone. */
function NavGroupBlock({ label, children }: { label: string | null; children: ReactNode }) {
  const id = useId()
  if (label === null) return <>{children}</>
  return (
    <div className="side-group" role="group" aria-labelledby={id}>
      <div className="side-h side-gl" id={id}>{label}</div>
      {children}
    </div>
  )
}

/** A link of an instance's nav to another site: it opens in a new tab and says so, as the Portal link does. */
function OutLink({ href, label, icon, rail }: { href: string; label: string; icon: IconName | null; rail: boolean }) {
  const link = (
    <a className="side-a" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>
      {icon && <Icon name={icon} />}
      {!rail && <><span className="side-l">{label}</span><Icon name="external" size="xs" /></>}
    </a>
  )
  return rail ? <Tooltip text={label}>{link}</Tooltip> : link
}

/** The house's sections an instance's nav did not name (house/nav.yaml): a disclosure at the foot of its groups,
 *  collapsed by default, each section with its count — so nothing of the house is out of reach. */
function MoreGroup({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="side-group">
      <button type="button" className="side-h" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="xs" />{label}
      </button>
      {open && <div id={id} className="side-group-in">{children}</div>}
    </div>
  )
}

/** Search or jump (§5.2 item 2): a field-shaped button with ⌘K; on the rail a 40px icon button. It asks the
 *  palette to open. */
function Search({ rail }: { rail: boolean }) {
  const ask = () => window.dispatchEvent(new Event('open-palette'))
  if (rail) {
    return <Tooltip text="Search or jump"><button type="button" className="side-search" aria-label="Search or jump" onClick={ask}><Icon name="search" /></button></Tooltip>
  }
  return <button type="button" className="side-search" onClick={ask}><Icon name="search" /><span className="side-l">Search or jump</span><Kbd>⌘K</Kbd></button>
}

const TONE: Partial<Record<keyof HouseCounts, Tone>> = { needs: 'attn', changes: 'accent' }

/** Changes, with something staged (§5.6, ruling R-28): a plain click opens the docked tray over the page you are on
 *  (`house:open-changes`) rather than leaving it; the link stays /changes, for a new tab, a modified click and the
 *  phone. With nothing staged (or previewing: nothing is counted) it is the page. */
const openTray = (e: MouseEvent<HTMLAnchorElement>) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  window.dispatchEvent(new Event(OPEN_CHANGES))
}

/** The sidebar (§5.2): the org switcher, Search or jump, the nine sections in a `nav` named Hub with their
 *  counts (of what the viewer may see: the caller counts with `visible`, rule 7), Workspace's collections under it
 *  while Workspace or one of them is current (or pinned open), the Instance group when it has anything, then the
 *  foot — Portal ↗ (only when the Hub has a portal origin, and to it: D-5) and the signed-in identity. On the rail (§5.3) it is icons alone. */
export function Sidebar({ org, counts, identity, collections = [], pinWorkspace = false, instance = [], nav = null }: {
  org: OrgMark; counts: HouseCounts; identity: Who; collections?: Place[]; pinWorkspace?: boolean; instance?: Place[]
  /** The instance's groups for this viewer (resolveNav): drawn in place of the nine sections when there are any. */
  nav?: ResolvedNav | null
}) {
  const [path] = useLocation()
  const { expanded } = useFrame()
  const rail = !expanded
  const at = sectionOf(path, collections)
  const child = collections.find(c => isCurrent(path, c.href))
  const showChildren = !rail && collections.length > 0 && (at === 'workspace' || pinWorkspace)
  const portal = usePortalOrigin()
  const navAt: NavLink | null = nav && nav.groups.length > 0 ? currentNavItem(path, nav, collections) : null
  /** One of the house's sections, with its count, its tone and (Workspace) its collections under it while open; on
   *  Changes with something staged, a click opens the tray. */
  const sectionLink = (s: HouseSection, label: string, { here, sub = false }: { here: boolean; sub?: boolean }) => {
    const key = s.id as keyof HouseCounts
    const count = key in counts ? counts[key] : 0
    return [
      <SideLink key={s.id} href={s.href} label={label} icon={sub ? undefined : s.icon} count={count} tone={TONE[key]}
        current={here && !(s.id === 'workspace' && child)} on={here} sub={sub} rail={rail}
        onClick={s.id === 'changes' && counts.changes > 0 ? openTray : undefined} />,
      ...(s.id === 'workspace' && showChildren
        ? collections.map(c => <SideLink key={c.href} href={c.href} label={c.label} current={c === child} sub rail={false} empty={c.empty} />)
        : []),
    ]
  }
  return (
    <div className={rail ? 'side side-rail' : 'side'}>
      <OrgSwitcher org={org} />
      <Search rail={rail} />
      <nav className="side-nav" aria-label="Hub">
        {nav && nav.groups.length > 0 ? <>
          {nav.groups.map((g, n) => (
            <NavGroupBlock key={`${n}:${g.label ?? ''}`} label={rail ? null : g.label}>
              {g.items.map(i => i.kind === 'section'
                ? sectionLink(i.section, i.label, { here: navAt === i })
                : i.external
                ? (rail && !i.icon ? null : <OutLink key={i.href} href={i.href} label={i.label} icon={i.icon} rail={rail} />)
                : (rail && !i.icon ? null : <SideLink key={i.href} href={i.href} label={i.label} icon={i.icon ?? undefined} current={navAt === i} rail={rail} />))}
            </NavGroupBlock>
          ))}
          {nav.more.sections.length > 0 && (rail
            ? nav.more.sections.map(s => sectionLink(s, s.label, { here: at === s.id && navAt === null }))
            : <MoreGroup label={nav.more.label}>{nav.more.sections.map(s => sectionLink(s, s.label, { here: at === s.id && navAt === null, sub: true }))}</MoreGroup>)}
        </> : HOUSE_SECTIONS.map(s => sectionLink(s, s.label, { here: at === s.id }))}
        {!rail && instance.length > 0 && <InstanceGroup links={instance} path={path} />}
      </nav>
      <div className="side-foot">
        {!rail && portal !== null && (
          <a className="side-a" href={portal} target="_blank" rel="noopener noreferrer">
            <Icon name="globe" /><span className="side-l">Portal</span><span className="sr-only"> (opens in a new tab)</span>
            <Icon name="external" size="xs" />
          </a>
        )}
        <Identity who={identity} />
      </div>
    </div>
  )
}
