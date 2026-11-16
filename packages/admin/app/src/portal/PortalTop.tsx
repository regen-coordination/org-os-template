import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { buttonClass } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import type { OrgMark } from '../frame/sections.ts'

export interface PortalNavItem { id: string; name: string }

/** The members' sign-in on the Hub at `origin` ("" is this one); null when the portal has no members' side. */
export const membersHref = (origin: string | null | undefined): string | null =>
  origin === null || origin === undefined ? null : `${origin.replace(/\/+$/, '')}/sign-in`

/** The portal's top (§12.1), 76px: the wordmark (the org's mark on a 26px solid square, else the neutral seal, and the
 *  name in Fraunces 500 19), the sections as plain links in Sans 13 mute, then Members (a secondary button to the
 *  Hub's sign-in), left out when the portal has no members' side. Under 900px of the viewport (portal.css) the links
 *  fold into Menu, a disclosure whose sheet lists them; Members stays in the bar. Menu is a native `<details>`, so it
 *  opens without script on a portal served as plain HTML; with script its state is the page's, and Esc and a followed
 *  link close it, Esc handing focus back to Menu. There is no theme toggle: the portal follows the reader's system (C-29). */
export function PortalTop({ org, nav, members }: { org: OrgMark; nav: PortalNavItem[]; members: string | null }) {
  const [open, setOpen] = useState(false)
  const summary = useRef<HTMLElement>(null)
  const close = (refocus: boolean) => { setOpen(false); if (refocus) summary.current?.focus() }
  const links = nav.map(n => <a key={n.id} className="portal-nav-a" href={`#${n.id}`}>{n.name}</a>)
  return (
    <header className="portal-top">
      <span className="portal-mark">
        <span className="portal-seal" aria-hidden="true">{org.mark ? <img src={org.mark} alt="" /> : <Icon name="seal" size="sm" />}</span>
        <span className="portal-name">{org.name}</span>
      </span>
      <nav className="portal-nav" aria-label="The portal">
        {links}
        {members !== null && <a className={`${buttonClass({ variant: 'secondary' })} portal-members`} href={members}>Members</a>}
        {nav.length > 0 && (
          <details className="portal-menu" open={open} onToggle={e => setOpen(e.currentTarget.open)}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(true) } }}>
            <summary ref={summary} className={buttonClass({ variant: 'ghost', iconOnly: true })} aria-label="Menu"
              onClick={e => { e.preventDefault(); setOpen(o => !o) }}>
              <Icon name="menu" />
            </summary>
            <div className="portal-sheet" onClick={(e: MouseEvent) => { if ((e.target as HTMLElement).closest('a')) close(false) }}>
              {nav.map(n => <a key={n.id} className="portal-sheet-a" href={`#${n.id}`}>{n.name}</a>)}
            </div>
          </details>
        )}
      </nav>
    </header>
  )
}
