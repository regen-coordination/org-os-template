import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { buttonClass } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import type { OrgMark } from '../frame/sections.ts'

export interface DoorNavItem { id: string; name: string }

/** The members' sign-in on the Hub at `origin` ("" is this one); null when the door has no members' side. */
export const membersHref = (origin: string | null | undefined): string | null =>
  origin === null || origin === undefined ? null : `${origin.replace(/\/+$/, '')}/sign-in`

/** The door's top (§12.1), 76px: the wordmark (the org's mark on a 26px solid square, else the neutral seal, and the
 *  name in Fraunces 500 19), the sections as plain links in Sans 13 mute, then Members (a secondary button to the
 *  Hub's sign-in), left out when the door has no members' side. Under 900px of the viewport (door.css) the links
 *  fold into Menu, a disclosure whose sheet lists them; Members stays in the bar. Menu is a native `<details>`, so it
 *  opens without script on a door served as plain HTML; with script its state is the page's, and Esc and a followed
 *  link close it, Esc handing focus back to Menu. There is no theme toggle: the door follows the reader's system (C-29). */
export function DoorTop({ org, nav, members }: { org: OrgMark; nav: DoorNavItem[]; members: string | null }) {
  const [open, setOpen] = useState(false)
  const summary = useRef<HTMLElement>(null)
  const close = (refocus: boolean) => { setOpen(false); if (refocus) summary.current?.focus() }
  const links = nav.map(n => <a key={n.id} className="door-nav-a" href={`#${n.id}`}>{n.name}</a>)
  return (
    <header className="door-top">
      <span className="door-mark">
        <span className="door-seal" aria-hidden="true">{org.mark ? <img src={org.mark} alt="" /> : <Icon name="seal" size="sm" />}</span>
        <span className="door-name">{org.name}</span>
      </span>
      <nav className="door-nav" aria-label="The door">
        {links}
        {members !== null && <a className={`${buttonClass({ variant: 'secondary' })} door-members`} href={members}>Members</a>}
        {nav.length > 0 && (
          <details className="door-menu" open={open} onToggle={e => setOpen(e.currentTarget.open)}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(true) } }}>
            <summary ref={summary} className={buttonClass({ variant: 'ghost', iconOnly: true })} aria-label="Menu"
              onClick={e => { e.preventDefault(); setOpen(o => !o) }}>
              <Icon name="menu" />
            </summary>
            <div className="door-sheet" onClick={(e: MouseEvent) => { if ((e.target as HTMLElement).closest('a')) close(false) }}>
              {nav.map(n => <a key={n.id} className="door-sheet-a" href={`#${n.id}`}>{n.name}</a>)}
            </div>
          </details>
        )}
      </nav>
    </header>
  )
}
