import { useId } from 'react'
import { Link, useLocation } from 'wouter'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { useFrame } from '../design/Shell.tsx'
import { ViewAsControl } from '../viewAs/ViewAs.tsx'
import { pathOf } from './path.ts'

/** Notifications (§5.5): the comment glyph, with a moss dot when unread mentions exist. Conversation is L6;
 *  in L4 the dot is drawn from fixtures and the button opens nothing yet. */
function Notifications({ unread }: { unread: boolean }) {
  const id = useId()
  return (
    <button type="button" className="btn ghost icon tb-bell" aria-label="Notifications" aria-describedby={unread ? id : undefined}>
      <Icon name="comment" size="sm" />
      {unread && <><span className="tb-dot" aria-hidden="true" /><span id={id} className="sr-only">Unread mentions</span></>}
    </button>
  )
}

/** The top bar (§5.5): the rail toggle, then the path — ancestors as links in mute, a `/` between, the current
 *  item last in ink 500 — and, trailing, View as and the notifications button. `names` names the ids in the path
 *  (a record's or a proposal's title). */
export function TopBar({ names = {}, unread = false }: { names?: Record<string, string>; unread?: boolean }) {
  const [location] = useLocation()
  const frame = useFrame()
  const crumbs = pathOf(location, names)
  return (
    <div className="tb">
      <Button ref={frame.toggleRef} variant="ghost" icon="sidebar" iconOnly label={frame.toggleLabel} expanded={frame.expanded}
        controls={frame.sideId} onClick={frame.toggle} />
      <nav className="crumbs" aria-label="Path">
        <ol>
          {crumbs.map((c, i) => (
            <li key={c.href}>
              {i < crumbs.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <div className="tb-tools">
        <ViewAsControl />
        <Notifications unread={unread} />
      </div>
    </div>
  )
}
