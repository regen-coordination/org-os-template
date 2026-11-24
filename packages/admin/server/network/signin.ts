// Sign-in with a Bluesky or Certified account (refi-dao-os network app spec §5.1, §5.3, §5.7; plan task B3): what the
// Hub does once B2's round-trip has proven the account. A DID linked to a person (§5.3) signs in as that person, with
// their Roles as the Roles table holds them now; any other DID is a Guest: `sub` guest:<did>, no Roles, kept by its DID
// and handle only (Q9, ADR-0002: never an e-mail, a name or a wallet). Both get the shared ReFi DAO cookie through the
// one issuing function the emailed link uses, so the org's other sites read it as they read that one.
import type { Context } from 'hono'
import type { PrivateStore } from '../private/store.ts'
import type { SignInConfig } from '../session/config.ts'
import type { AtprotoIdentity, IdentityHandler } from '../session/atproto.ts'
import { GUEST_PREFIX, issueSession } from '../session/person.ts'

/** Said when the Hub has no emailed-link sign-in configured: its keys sign the shared cookie, so there is none to issue. */
export const NO_SHARED_COOKIE = 'Sign-in is not available on this Hub yet: it has no session key to sign you in with. Nothing was kept.'

export function signInWithAccount(d: { store: PrivateStore; signIn: SignInConfig | null; now?: () => Date }): IdentityHandler {
  const now = d.now ?? (() => new Date())
  return async (c: Context, who: AtprotoIdentity) => {
    if (!d.signIn) return c.text(NO_SHARED_COOKIE, 503)
    const at = now()
    const link = d.store.accountLink(who.did)
    const person = link ? d.store.person(link.personId) : null
    let cookie: string
    if (person) {
      // A linked member: theirs, with the Roles as they are now. A Guest row of the same DID (from before the link) goes.
      cookie = await issueSession(d.store, d.signIn, { sub: person.id, roles: person.roles, nodes: person.nodes }, at)
      if (d.store.guest(who.did)) await d.store.deleteGuest(who.did)
    } else {
      await d.store.putGuest(who.did, who.handle, at)
      cookie = await issueSession(d.store, d.signIn, { sub: `${GUEST_PREFIX}${who.did}`, roles: [], nodes: [] }, at)
    }
    c.header('set-cookie', cookie, { append: true })
    return c.redirect('/', 303)
  }
}
