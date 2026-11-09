import { createHash, randomBytes } from 'node:crypto'
import type { PrivateStore, SessionRow } from '../private/store.ts'

/** A session lasts 24 h from sign-in, absolute, not sliding (L5 spec §4.4). */
export const SESSION_TTL_MS = 86_400_000
/** The cookie that carries the session token. */
export const SESSION_COOKIE = 'house_session'
/** Its name on a hosted Hub (L9 §5.8): `__Host-` makes the browser keep it to the members' host alone (Secure, `Path=/`,
 *  no `Domain`), so it never reaches the portal host or another subdomain. */
export const HOSTED_SESSION_COOKIE = '__Host-house_session'

/** The session cookie's name: `hosted` is the hosted binding (a `HostedConfig` was given), not L5's hosted flag alone. */
export function sessionCookieName(hosted: boolean): 'house_session' | '__Host-house_session' {
  return hosted ? HOSTED_SESSION_COOKIE : SESSION_COOKIE
}

/** A session as the private store keeps it: the SHA-256 of the token, never the token (§4.4). */
export type Session = SessionRow

/** The hex SHA-256 of a token: what the store keeps in its place. */
export const tokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

/** The key an emailed-link session (I5) is kept under in the same table: the SHA-256 of `person:` and its id (`jti`).
 *  Apart from a wallet session's key (the SHA-256 of the token alone), so an I5 session id, which its holder can read
 *  in the token, never opens a wallet session when sent as `house_session` (Lane 3 ruling S8-1). */
export const personSessionHash = (jti: string): string => tokenHash(`person:${jti}`)

/** Starts a session for `account` (CAIP-10): 32 random bytes as the token (base64url), its hash in the store. Sessions
 *  expired by now are removed first. The token is answered once, for the cookie, and kept nowhere. */
export async function createSession(store: PrivateStore, account: string, now: () => Date): Promise<{ token: string; session: Session }> {
  const at = now()
  await store.deleteSessionsExpired(at.toISOString())
  const token = randomBytes(32).toString('base64url')
  const session: Session = { tokenHash: tokenHash(token), account, created: at.toISOString(), expires: new Date(at.getTime() + SESSION_TTL_MS).toISOString() }
  await store.putSession(session)
  return { token, session }
}

/** The live session `token` names, or null. One that has expired is removed in the background and answers null. */
export function findSession(store: PrivateStore, token: string, now: () => Date): Session | null {
  if (token === '') return null
  const hash = tokenHash(token)
  const s = store.session(hash)
  if (!s) return null
  if (Date.parse(s.expires) <= now().getTime()) {
    void store.deleteSession(hash).catch(() => { /* removed at the next sign-in instead */ })
    return null
  }
  return s
}

/** Ends the session `token` names, at once (`DELETE /api/session`). */
export async function endSession(store: PrivateStore, token: string): Promise<void> {
  if (token !== '') await store.deleteSession(tokenHash(token))
}

/** The session cookie's value in a Cookie header, or '': `house_session`, or hosted `__Host-house_session` only (a
 *  `house_session` cookie is then not read, Review Focus 5). */
export function sessionToken(header: string | undefined, hosted = false): string {
  const name = sessionCookieName(hosted)
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return ''
}

/** The session a Cookie header carries: the HTTP routes and the WebSocket upgrade read it the same way (§4.4). */
export function sessionFromCookie(store: PrivateStore, header: string | undefined, now: () => Date, hosted = false): Session | null {
  return findSession(store, sessionToken(header, hosted), now)
}

/** The Set-Cookie value for a session: `HttpOnly; SameSite=Strict; Path=/`, with no `Domain`. `hosted` (the hosted
 *  binding, L9 §5.8): the `__Host-` name, and Secure. `secure`: Secure under the plain name, for L5's hosted mode with no
 *  binding (§3, controller ruling P14); never Secure locally. A browser session cookie: the server holds the 24 h itself. */
export function sessionCookie(token: string, hosted: boolean, secure = hosted): string {
  return `${sessionCookieName(hosted)}=${token}; HttpOnly; SameSite=Strict; Path=/${hosted || secure ? '; Secure' : ''}`
}

/** The Set-Cookie value that clears it (the same name and attributes). */
export function clearedCookie(hosted: boolean, secure = hosted): string {
  return `${sessionCookieName(hosted)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${hosted || secure ? '; Secure' : ''}`
}
