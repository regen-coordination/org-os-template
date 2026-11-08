// The emailed-link sign-in's routes (Lane 3 Tasks 7 and 8; I3, I5, I6). `POST /api/session/email` answers every address
// alike: the same status and sentence whether or not it is on the org's records, rate limited or not, so the answer
// tells nobody who is on them; a link goes out only to a known person within the limits. The answer is made before the
// store is asked anything (S10-0, closing S7-4): the lookup, the link and the mail run after it, one path for every
// address, so its time says nothing either. The address is held in this
// request's memory only: the house keeps its key (I3), never the address, and nothing here logs it.
// `POST /api/session/link` spends a link once and answers the I5 cookie. A POST, so a mail scanner that opens the
// link's page never spends it.
import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { emailKey, newSessionClaims, sessionCookie, signSession } from '../../lib/session-token.mjs'
import { safeReturn } from '../../lib/return-url.mjs'
import { orgName } from '../resources/util.ts'
import type { PrivateStore } from '../private/store.ts'
import type { HostedConfig } from '../hosted/config.ts'
import { Buckets, clientAddress } from '../hosted/limits.ts'
import type { SignInConfig } from './config.ts'
import type { Mailer } from './mail.ts'
import { personSessionHash, tokenHash } from './sessions.ts'

/** How long an emailed link works (I6): 15 minutes, once. */
export const LINK_TTL_MS = 15 * 60_000
/** The limits on asking (Task 7): per email key 3, per client 10, in any 15 minutes. */
export const PER_KEY = 3
export const PER_CLIENT = 10
export const LIMIT_WINDOW_MIN = 15

/** I6's answer, the same for every address: the org's name is the repository's. */
export const linkOnItsWay = (org: string): string => `If this address is on ${org}'s records, a link is on its way.`
export const EMAIL_OFF = 'Sign-in by email is not offered here.'
const NO_STORE = 'Sign-in is not available: the private store, where sign-ins are kept, could not be opened. Home says why.'
/** Task 8: a link that is not known, was used, or has expired, or whose person is no longer on the records. */
export const LINK_REFUSED = 'This sign-in link has expired or was already used.'
export const NEW_LINK = 'Ask for a new link: enter your email address again on the sign-in page.'
const SEND_TOKEN = 'Send { token }: the token of the emailed link.'
const SEND_EMAIL = 'Send { email }: the address to send the sign-in link to, and optionally { return }: where to go after.'

/** An address's shape, enough to send to: one `@`, something on each side, no space, at most 254 characters. */
const ADDRESS = /^[^\s@]+@[^\s@]+$/

export interface EmailSignInDeps {
  repo: string
  /** The one private store; null when it could not be opened (then nobody signs in, as with the wallet). */
  store: PrivateStore | null
  /** What the email method needs (`readSignInConfig`); null when it is not offered (hosted with none of its variables). */
  config: SignInConfig | null
  mailer: Mailer
  /** The hosted binding, when hosted: the Hub's origin (links and returns are built on it, never on the request's Host)
   *  and whether `X-Real-IP` is trusted for the per-client limit. */
  hosted?: HostedConfig
  now?: () => Date
}

/** What mounting gives back: `settled()` resolves once every link asked for so far has been looked up, written and
 *  handed to the mailer (the answer never waits for that; tests and a stopping server may). */
export interface EmailSignIn { settled(): Promise<void> }

/** `POST /api/session/email` (Task 7). Mounted beside `mountSession`, after the request middleware. */
export function mountEmailSignIn(app: Hono, d: EmailSignInDeps): EmailSignIn {
  const pending = new Set<Promise<void>>()
  const now = d.now ?? (() => new Date())
  const clock = { now: () => now().getTime() }
  const perMin = (n: number) => n / LIMIT_WINDOW_MIN
  const byKey = new Buckets({ ratePerMin: perMin(PER_KEY), burst: PER_KEY, ...clock })
  const byClient = new Buckets({ ratePerMin: perMin(PER_CLIENT), burst: PER_CLIENT, ...clock })
  const trustProxy = d.hosted?.trustProxy ?? false
  /** The Hub's origin: the configured one when hosted (behind the proxy the request says `http:`); else the request's. */
  const hubOf = (c: Context) => {
    if (d.hosted) return d.hosted.origin
    const url = new URL(c.req.url)
    return `${url.protocol}//${c.req.header('host') ?? url.host}`
  }

  app.post('/api/session/email', async c => {
    const body = await bodyOf(c)
    const raw = body?.email
    const given = typeof raw === 'string' ? raw.trim() : ''
    if (given === '' || given.length > 254 || !ADDRESS.test(given) || (body?.return !== undefined && body.return !== null && typeof body.return !== 'string')) {
      return c.json({ error: SEND_EMAIL }, 400)
    }
    if (!d.config) return c.json({ error: EMAIL_OFF, code: 'EMAIL_OFF' }, 409)
    if (!d.store) return c.json({ error: NO_STORE, code: 'NO_STORE' }, 503)
    const answer = () => c.json({ sent: true, sentence: linkOnItsWay(orgName(d.repo)) }, 202)

    // 1. The key, every time.
    const key = emailKey(given, d.config.pepper)
    // 2. The limits, every time and both of them, before anyone is looked up: a limited ask is answered as any other.
    const client = byClient.take(`c:${clientAddress(c, trustProxy)}`).ok
    const own = byKey.take(`k:${key}`).ok
    if (!client || !own) return answer()
    // 3–4. Off the response path, for every address alike (S7-4 closed, S10-0): the answer is made before the store is
    // asked anything, so neither the lookup nor a known person's link writes can lengthen it.
    const ret = typeof body?.return === 'string' ? body.return : null
    const hub = hubOf(c)
    const at = now()
    later(() => sendLink(given, key, ret, hub, at))
    return answer()
  })

  /** The lookup, a known person's link (32 random bytes, kept only as their hash, the return judged by I6 now and again
   *  by the client) and the mail. Runs after the answer. Its failures name no address. */
  async function sendLink(given: string, key: string, ret: string | null, hub: string, at: Date): Promise<void> {
    const store = d.store, config = d.config
    if (!store || !config) return
    const person = store.personByEmailKey(key)
    if (!person) return
    const token = randomBytes(32).toString('base64url')
    await store.deleteLinksExpired(at)
    await store.putLink({
      tokenHash: tokenHash(token), personId: person.id,
      returnTo: safeReturn(ret, hub, config.cookie.domain),
      created: at.toISOString(), expires: new Date(at.getTime() + LINK_TTL_MS).toISOString(),
    })
    const link = `${hub}/sign-in/link?token=${token}`
    // Not awaited either: nothing waits on the provider. Its failure names no address.
    void d.mailer.send(given, link, orgName(d.repo)).catch(err => {
      console.error(`org-os admin: ${err instanceof Error ? err.message : 'a sign-in mail was not sent.'}`)
    })
  }

  /** Runs `work` after this turn of the event loop (so after the handler has answered), and keeps it until it settles. */
  function later(work: () => Promise<void>): void {
    const run = new Promise<void>(resolve => setImmediate(resolve)).then(work).catch(() => {
      console.error('org-os admin: a sign-in link could not be made: the private store refused the write. Home says why.')
    })
    pending.add(run)
    void run.finally(() => pending.delete(run))
  }

  app.post('/api/session/link', async c => {
    const body = await bodyOf(c)
    const token = body?.token
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return c.json({ error: SEND_TOKEN }, 400)
    if (!d.config) return c.json({ error: EMAIL_OFF, code: 'EMAIL_OFF' }, 409)
    if (!d.store) return c.json({ error: NO_STORE, code: 'NO_STORE' }, 503)
    const refused = () => c.json({ error: LINK_REFUSED, hint: NEW_LINK, code: 'LINK_REFUSED' }, 401)
    const at = now()
    // 1. Spent now, once, whatever follows.
    const link = await d.store.takeLink(tokenHash(token), at)
    if (typeof link === 'string') return refused()
    // 2. The person as the Roles are now: one removed since the link was sent does not sign in.
    const person = d.store.person(link.personId)
    if (!person) return refused()
    // 3–4. The I5 claims, and the row by which the house ends the session (sign-out, a removed person).
    const claims = newSessionClaims({ iss: d.config.issuer, sub: person.id, roles: person.roles, nodes: person.nodes }, at)
    await d.store.deleteSessionsExpired(at.toISOString())
    await d.store.putSession({
      tokenHash: personSessionHash(claims.jti), account: person.id,
      created: new Date(claims.iat * 1000).toISOString(), expires: new Date(claims.exp * 1000).toISOString(),
    })
    // 5–6. The cookie, and where to go.
    c.header('set-cookie', sessionCookie(signSession(claims, d.config.privateJwk), d.config.cookie))
    return c.json({ signedIn: true, return: link.returnTo })
  })

  return { settled: async () => { while (pending.size > 0) await Promise.all([...pending]) } }
}

async function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch { return null }
}
