import type { Context, Hono } from 'hono'
import { buildSiweMessage, newNonce, NONCE_TTL_MS, recoverAddress } from '../../lib/siwe.mjs'
import { checksumAddress, isAddress, parseCaip10 } from '../../lib/caip.mjs'
import { actorIdOf } from '../../lib/hat-readings.mjs'
import { orgName } from '../resources/util.ts'
import { readRegistry } from '../registry.ts'
import type { PrivateStore } from '../private/store.ts'
import { GRACE_BAND, TREE_UNREADABLE, type Membership } from './membership.ts'
import { Nonces, TOO_MANY } from './nonces.ts'
import { clearedCookie, createSession, endSession, sessionCookie, sessionFromCookie, sessionToken, type Session } from './sessions.ts'

/** §4.3 step 3's refusal: the signature recovers to another address than the message's. */
export const OTHER_ADDRESS = 'The wallet signed with another address than the one it gave. Choose one address in the wallet and sign again.'
/** §18 Q5 (EOAs only): a signature that is not 65 bytes, as a contract account's (EIP-1271) is. */
export const EOA_ONLY = 'Only an address with its own key can sign in for now.'
/** §5.4: an org without a tree offers no sign-in. */
export const NO_TREE = 'Sign-in is not offered here: this organisation names no Hats tree for its membership.'
const NO_STORE = 'Sign-in is not available: the private store, where sessions are kept, could not be opened. Home says why.'
const UNKNOWN_NONCE = 'This sign-in message is not known here or was already used. Ask for a new one and sign again.'
const EXPIRED_NONCE = `This sign-in message is more than ${NONCE_TTL_MS / 60_000} minutes old. Ask for a new one and sign again.`
const UNREADABLE_SIGNATURE = 'The signature could not be read. Ask for a new message and sign again.'

/** The session each request carries, set once by `mountSession`'s middleware. */
const current = new WeakMap<Context, Session | null>()

/** The request's session; null when it carries none, it has expired, or the request did not pass `mountSession`'s
 *  middleware (a route registered before it). */
export function sessionOf(c: Context): Session | null {
  return current.get(c) ?? null
}

export interface SessionDeps {
  repo: string
  /** The one private store (Task 5); null when it could not be opened: then nobody signs in, and Home says why. */
  store: PrivateStore | null
  membership: Membership
  hosted: boolean
  now?: () => Date
}

/** Sign-in with Ethereum and the house's sessions (L5 spec §4, §13): a middleware that reads the session cookie into
 *  `sessionOf(c)` for every route registered after it, and `GET|POST|DELETE /api/session`, `POST /api/session/nonce`.
 *  The server builds every message and signs nothing; the wallet signs. */
export function mountSession(app: Hono, d: SessionDeps): void {
  const now = d.now ?? (() => new Date())
  const nonces = new Nonces(now)
  const mode = d.hosted ? 'hosted' : 'local'

  // Only the API carries sessions (the WebSocket upgrade reads its own, in serve.ts). A store that fails to answer is
  // no session, never a 500 for every route after it.
  app.use('/api/*', async (c, next) => {
    let s: Session | null = null
    try { s = d.store ? sessionFromCookie(d.store, c.req.header('cookie'), now) : null } catch (err) {
      console.error(`org-os admin: a session could not be read from the private store: ${err instanceof Error ? err.message : String(err)}`)
    }
    current.set(c, s)
    await next()
  })

  const hostOf = (c: Context) => c.req.header('host') ?? new URL(c.req.url).host
  const originOf = (c: Context) => `${new URL(c.req.url).protocol}//${hostOf(c)}`

  /** The answer for a live session (§13): its hats are the last good reading, never awaited; past the grace, none
   *  (`stale`). With no reading kept yet (after a restart, until the first lands; for as long as the tree cannot be
   *  read) the hats are not known: `unread`, with the band, so `hats: []` is never told as "wears no hat" (final review
   *  I1, Review Focus 3). */
  const signedIn = (s: Session) => {
    const read = d.membership.forRead(s.account)
    return {
      mode, signedIn: true, actor: actorIdOf(s.account, members(d.repo)), account: s.account,
      hats: (read?.hats ?? []).map(hat => ({ hat, name: d.membership.hatName(hat) })),
      expiresAt: s.expires,
      ...(read === null ? { unread: true, band: GRACE_BAND } : read.stale ? { stale: true, band: GRACE_BAND } : {}),
    }
  }

  app.get('/api/session', c => {
    const s = sessionOf(c)
    if (s) return c.json(signedIn(s))
    const tree = d.store ? d.membership.tree() : null
    return c.json({ mode, signIn: tree ? { chainId: tree.chain, tree: tree.ref } : null, signedIn: false })
  })

  app.post('/api/session/nonce', async c => {
    const body = await bodyOf(c)
    const given = body?.address
    const address = typeof given === 'string' ? (isAddress(given) ? checksumAddress(given) : parseCaip10(given)?.address ?? null) : null
    if (!address) {
      return c.json({ error: typeof given === 'string' ? `${given} is not an address (0x and 40 hex digits).` : 'Send { address }: the address the wallet gave (0x and 40 hex digits).' }, 400)
    }
    if (!d.store) return c.json({ error: NO_STORE, code: 'NO_STORE' }, 503)
    const tree = d.membership.tree()
    if (!tree) return c.json({ error: NO_TREE, code: 'NO_TREE' }, 409)
    const at = now()
    const nonce = newNonce()
    const fields = {
      domain: hostOf(c), address,
      statement: `Sign in to ${orgName(d.repo)}'s Hub. This proves you hold this address. Nothing is sent on chain and nothing is spent.`,
      uri: `${originOf(c)}/`, version: '1' as const, chainId: Number(tree.chain.slice(tree.chain.indexOf(':') + 1)), nonce,
      issuedAt: at.toISOString(), expirationTime: new Date(at.getTime() + NONCE_TTL_MS).toISOString(),
    }
    const message = buildSiweMessage(fields)
    if (!nonces.add(nonce, { message, fields, expires: at.getTime() + NONCE_TTL_MS })) return c.json({ error: TOO_MANY }, 429)
    return c.json({ nonce, message })
  })

  app.post('/api/session', async c => {
    const body = await bodyOf(c)
    if (typeof body?.nonce !== 'string' || body.nonce === '') return c.json({ error: 'Send { nonce, signature }: the nonce and the wallet\'s signature of its message.' }, 400)
    // Step 1: the nonce is spent now, whatever follows.
    const kept = nonces.take(body.nonce)
    if (kept === 'unknown') return c.json({ error: UNKNOWN_NONCE }, 401)
    if (kept === 'expired') return c.json({ error: EXPIRED_NONCE }, 401)
    // Step 2: the message was made for this address, as a wallet compares it with the page's origin.
    const host = hostOf(c)
    if (kept.fields.domain !== host) {
      return c.json({ error: `This sign-in message was made for ${kept.fields.domain}, and this request came to ${host}. Sign in from the address the message names.` }, 401)
    }
    if (kept.fields.uri !== `${originOf(c)}/`) {
      return c.json({ error: `This sign-in message was made for ${kept.fields.uri}, and this request came to ${originOf(c)}/. Sign in from the address the message names.` }, 401)
    }
    // Step 3: EIP-191 recovery of the exact kept text, by an externally owned account (65 bytes: r, s, v).
    const signature = body.signature
    if (typeof signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) return c.json({ error: UNREADABLE_SIGNATURE }, 401)
    if (signature.length !== 132) return c.json({ error: EOA_ONLY }, 401)
    const signer = recoverAddress(kept.message, signature)
    if (!signer) return c.json({ error: UNREADABLE_SIGNATURE }, 401)
    if (signer !== kept.fields.address) return c.json({ error: OTHER_ADDRESS }, 401)
    if (!d.store) return c.json({ error: NO_STORE, code: 'NO_STORE' }, 503)
    // Step 4: membership, read now. A tree that cannot be read is never "not a member".
    const tree = d.membership.tree()
    if (!tree) return c.json({ error: NO_TREE, code: 'NO_TREE' }, 409)
    const account = `${tree.chain}:${signer}`
    const read = await d.membership.forAct(account)
    if (!read.ok) return c.json({ error: read.error }, read.error === TREE_UNREADABLE ? 502 : 409)
    // Step 5: no hat in the tree, no session.
    if (read.hats.length === 0) return c.json({ signedIn: false, notMember: true })
    // Step 6.
    const { token, session } = await createSession(d.store, account, now)
    c.header('set-cookie', sessionCookie(token, d.hosted))
    return c.json(signedIn(session))
  })

  app.delete('/api/session', async c => {
    if (d.store) await endSession(d.store, sessionToken(c.req.header('cookie')))
    c.header('set-cookie', clearedCookie(d.hosted))
    return c.body(null, 204)
  })
}

async function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch { return null }
}

function members(repo: string): Record<string, unknown>[] {
  try { return (readRegistry(repo, 'members').entries ?? []) as Record<string, unknown>[] } catch { return [] }
}
