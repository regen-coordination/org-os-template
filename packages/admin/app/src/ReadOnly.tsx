import { Link } from 'wouter'
import { readOnlyReason, useActor } from './actor.ts'
import { Icon } from './design/Icon.tsx'
import { NO_HAT } from './api.ts'
import { useSessionView } from './session/session.ts'

/** Read only, said once at the top of every page when editing is off (§14.1, §6.5 "No actor"): the band (§5.9's
 *  style, --solid), "Read only: your git address is not a member’s. Claim your handle →". Git has an address and
 *  no member holds it: the claim wizard (W2a) is the way out, so the band links it; the address itself is the
 *  band's title. With no address, or no answer, the band says what to do instead. */
export default function ReadOnlyNotice() {
  const { actor, error } = useActor()
  const session = useSessionView()
  // A live session that reads as no member says why from the session: its hats not known (past the grace, §5.2, or not
  // read yet, I1) its band; a reading that shows no hat, the ruling's sentence (L9-O1). Neither is "the server could
  // not say who you are". Each is said in the same band (C9), as the session gives it: no "Read only:" before it.
  const hatsUnknown = session?.signedIn && (session.stale || session.unread)
  const said = hatsUnknown ? session.band : session?.signedIn && session.hats.length === 0 ? NO_HAT : undefined
  const unknown = actor !== null && 'unknown' in actor ? actor.unknown : null
  if (!said && !error && unknown === null) return null
  const claim = !said && !error && unknown !== null && unknown !== ''
  const rest = error || actor === null ? `the server could not say who you are (${error}).` : readOnlyReason(actor)
  return (
    <div className="band band-ro" role="status" title={claim ? `git: ${unknown}` : undefined}>
      <Icon name="lock" />
      <span className="band-t">
        {said ? said : <><b>Read only:</b> {rest}</>}
        {claim && <> <Link href="/wizards/claim-handle" className="band-a">Claim your handle<span aria-hidden="true"> →</span></Link></>}
      </span>
    </div>
  )
}
