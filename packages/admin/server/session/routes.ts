import type { Context, Hono } from 'hono'
import { buildSiweMessage, newNonce, NONCE_TTL_MS, recoverAddress } from '../../lib/siwe.mjs'
import { checksumAddress, isAddress, parseCaip10 } from '../../lib/caip.mjs'
import { actorIdOf } from '../../lib/hat-readings.mjs'
import { orgName } from '../resources/util.ts'
import { readRegistry } from '../registry.ts'
import type { PrivateStore } from '../private/store.ts'
import type { HostedConfig } from '../hosted/config.ts'
import { GRACE_BAND, pastGrace, TREE_UNREADABLE, type Membership } from './membership.ts'
import { Nonces, TOO_MANY } from './nonces.ts'
import { clearedCookie, createSession, endSession, sessionCookie, sessionFromCookie, sessionToken, type Session } from './sessions.ts'
import { personOf, viewerOf } from '../request.ts'
import { endPersonSession } from './person.ts'
import { clearedSessionCookie } from '../../lib/session-token.mjs'
import type { SignInConfig } from './config.ts'

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
  /** The hosted binding (L9 §5.1), when hosted: the SIWE domain and URI come from it, never from the request (behind
   *  the TLS proxy the request says `http:`), the cookie is `__Host-`, and `GET /api/session` names the door. */
  config?: HostedConfig
  /** The emailed-link sign-in (Lane 3 Task 9), as `readSignInConfig` read it: null when it is not offered. Given (even
   *  null), `GET /api/session` also says which methods are offered and whether the instance is written to. */
  signIn?: SignInConfig | null
  /** `HOUSE_INSTANCE_WRITES` (Lane 3 Task 11), for `GET /api/session`; 'on' until that switch is wired. */
  instanceWrites?: 'on' | 'off'
  now?: () => Date
}

/** Sign-in with Ethereum and the house's sessions (L5 spec §4, §13): a middleware that reads the session cookie into
 *  `sessionOf(c)` for every route registered after it, and `GET|POST|DELETE /api/session`, `POST /api/session/nonce`.
 *  The server builds every message and signs nothing; the wallet signs. */
export function mountSession(app: Hono, d: SessionDeps): void {
  const now = d.now ?? (() => new Date())
  const nonces = new Nonces(now)
  const mode = d.hosted ? 'hosted' : 'local'
  const config = d.hosted ? d.config : undefined
  /** The `__Host-` cookie: only with the hosted binding (L5's hosted mode alone keeps the plain name, Secure). */
  const hostCookie = config !== undefined
  /** `door` in `GET /api/session` (§5.2): the door's origin, or null; answered only with the hosted binding. */
  const door = config ? { door: config.doorOrigin } : {}

  // Only the API carries sessions (the WebSocket upgrade reads its own, in serve.ts). A store that fails to answer is
  // no session, never a 500 for every route after it.
  app.use('/api/*', async (c, next) => {
    let s: Session | null = null
    try { s = d.store ? sessionFromCookie(d.store, c.req.header('cookie'), now, hostCookie) : null } catch (err) {
      console.error(`org-os admin: a session could not be read from the private store: ${err instanceof Error ? err.message : String(err)}`)
    }
    current.set(c, s)
    await next()
  })

  // Hosted, the configured host and origin (§5.2): the guard has made the request's Host the configured one, and the
  // scheme the request URL shows is the proxy's, never read. Locally, the request's own.
  const hostOf = (c: Context) => config ? config.host : c.req.header('host') ?? new URL(c.req.url).host
  const originOf = (c: Context) => config ? config.origin : `${new URL(c.req.url).protocol}//${hostOf(c)}`

  /** The answer for a live session (§13): its hats are the last good reading, never awaited; past the grace (a reading
   *  that old, or none and a session that old, L9 §5.8), none (`stale`), with the band. With no reading kept yet and a
   *  session younger than the grace (after a restart, until the first lands) the hats are not known: `unread`, with the
   *  band, so `hats: []` is never told as "wears no hat" (final review I1, Review Focus 3). */
  const signedIn = (s: Session) => {
    const read = d.membership.forRead(s.account)
    return {
      mode, signedIn: true, actor: actorIdOf(s.account, members(d.repo)), account: s.account,
      hats: (read?.hats ?? []).map(hat => ({ hat, name: d.membership.hatName(hat) })),
      expiresAt: s.expires,
      ...(pastGrace(read, s.created, now()) ? { stale: true, band: GRACE_BAND } : read === null ? { unread: true, band: GRACE_BAND } : {}),
    }
  }

  /** With the email method wired (`signIn` given): the methods offered — `email` when it is configured and the store is
   *  open, `wallet` when a tree is named too — and whether the instance is written to. Without it, L5's answer as it was. */
  const offered = (tree: unknown) => 'signIn' in d ? {
    methods: [...(d.signIn && d.store ? ['email'] : []), ...(tree ? ['wallet'] : [])],
    instanceWrites: d.instanceWrites ?? 'on',
  } : {}

  app.get('/api/session', c => {
    const tree = d.store ? d.membership.tree() : null
    const p = personOf(c)
    if (p?.kind === 'person') {
      const { person, claims } = p
      return c.json({
        mode, signedIn: true, via: 'email', actor: person.id,
        person: { id: person.id, name: person.name, roles: person.roles, nodes: person.nodes },
        viewer: viewerOf(c).kind, expiresAt: new Date(claims.exp * 1000).toISOString(),
        signIn: tree ? { chainId: tree.chain, tree: tree.ref } : null, ...offered(tree), ...door,
      })
    }
    const s = sessionOf(c)
    if (s) return c.json({ ...signedIn(s), ...offered(tree), ...door })
    return c.json({ mode, signIn: tree ? { chainId: tree.chain, tree: tree.ref } : null, signedIn: false, ...offered(tree), ...door })
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
    c.header('set-cookie', sessionCookie(token, hostCookie, d.hosted))
    return c.json(signedIn(session))
  })

  app.delete('/api/session', async c => {
    if (d.store) await endSession(d.store, sessionToken(c.req.header('cookie'), hostCookie))
    c.header('set-cookie', clearedCookie(hostCookie, d.hosted))
    // The emailed-link session too: its row goes (so the same cookie, replayed, is the public's), and its cookie is
    // cleared, whether or not this request carried one.
    if (d.signIn) {
      const p = personOf(c)
      const cleared = p && d.store ? await endPersonSession(d.store, d.signIn, p.claims) : clearedSessionCookie(d.signIn.cookie)
      c.header('set-cookie', cleared, { append: true })
    }
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
