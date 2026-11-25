// Linking a member's own network account (refi-dao-os network app spec §5.3, §5.7; plan task B4). A person signed in
// with their emailed link starts a `link` round-trip (B2); once it proves the account, the Hub keeps the link (person id
// ↔ DID, and the handle to show it by) privately. Never matched in the background (an AT Proto sign-in shares no
// e-mail). Unlinking is one button. Linking shows nothing publicly: the links live only in the private store.
import type { Context, Hono } from 'hono'
import type { PrivateStore } from '../private/store.ts'
import type { AtprotoIdentity, IdentityHandler } from '../session/atproto.ts'
import { MEMBERS_ONLY } from '../visibility/gate.ts'

/** Where a member goes after linking: their links, with a word that it worked. */
export const LINKED_PAGE = '/account-links?linked=1'
export const LINK_SIGN_IN = 'Sign in with your emailed link first, then link your account from your page in the Hub. Nothing was linked.'
export const LINK_TAKEN = 'This account is already linked to someone else in this Hub. Nothing was linked; if it is yours, ask a steward.'
export const LINK_NODE = 'This is a node\'s own account on the ReFi DAO Network, and a node\'s account is never a person\'s. Nothing was linked.'

export interface LinkDeps {
  store: PrivateStore
  /** The person the request is signed in as (an emailed-link session), or null: a Guest, a wallet, nobody. */
  personOf: (c: Context) => string | null
  now?: () => Date
}

/** The `link` purpose's handler: the round-trip must have been started by a person, and the same person must be the
 *  one signed in when it comes back; the account must be no one else's and no node's live account. */
export function linkAccount(d: LinkDeps): IdentityHandler {
  const now = d.now ?? (() => new Date())
  return async (c: Context, who: AtprotoIdentity) => {
    const person = d.personOf(c)
    if (!who.by || person !== who.by) return c.text(LINK_SIGN_IN, 401)
    const held = d.store.accountLink(who.did)
    if (held && held.personId !== person) return c.text(LINK_TAKEN, 409)
    if (d.store.networkEntries('live').some(e => e.did === who.did)) return c.text(LINK_NODE, 409)
    if (!held) await d.store.putAccountLink({ did: who.did, personId: person, handle: who.handle, linked: now().toISOString() })
    if (d.store.guest(who.did)) await d.store.deleteGuest(who.did)
    return c.redirect(LINKED_PAGE, 303)
  }
}

/** `GET /api/session/atproto/links` (the signed-in person's own links) and `DELETE /api/session/atproto/links/:did`
 *  (unlink one of their own). Anyone else: the members-only refusal, or not found. */
export function mountAccountLinks(app: Hono, d: { store: PrivateStore; personOf: (c: Context) => string | null }): void {
  const refused = (c: Context) => c.json({ error: MEMBERS_ONLY, code: 'SIGN_IN' }, 401)
  app.get('/api/session/atproto/links', c => {
    const person = d.personOf(c)
    if (!person) return refused(c)
    return c.json({ links: d.store.accountLinksOf(person).map(l => ({ did: l.did, handle: l.handle, linked: l.linked })) })
  })
  app.delete('/api/session/atproto/links/:did', async c => {
    const person = d.personOf(c)
    if (!person) return refused(c)
    const did = c.req.param('did')
    const held = d.store.accountLink(did)
    if (!held || held.personId !== person) return c.json({ error: 'You have no linked account with that DID.' }, 404)
    await d.store.deleteAccountLink(did)
    return c.body(null, 204)
  })
}
