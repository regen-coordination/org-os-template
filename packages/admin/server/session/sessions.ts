import { createHash, randomBytes } from 'node:crypto'
import type { PrivateStore, SessionRow } from '../private/store.ts'

/** A session lasts 24 h from sign-in, absolute, not sliding (L5 spec §4.4). */
export const SESSION_TTL_MS = 86_400_000
/** The cookie that carries the session token. */
export const SESSION_COOKIE = 'house_session'

/** A session as the private store keeps it: the SHA-256 of the token, never the token (§4.4). */
export type Session = SessionRow

/** The hex SHA-256 of a token: what the store keeps in its place. */
export const tokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

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

/** The `house_session` value of a Cookie header, or ''. */
export function sessionToken(header: string | undefined): string {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim()
  }
  return ''
}

/** The session a Cookie header carries: the HTTP routes and the WebSocket upgrade read it the same way (§4.4). */
export function sessionFromCookie(store: PrivateStore, header: string | undefined, now: () => Date): Session | null {
  return findSession(store, sessionToken(header), now)
}

/** The Set-Cookie value for a session: `HttpOnly; SameSite=Strict; Path=/`, plus `Secure` whenever hosted (§3,
 *  controller ruling P14); never Secure locally. A browser session cookie: the server holds the 24 h itself. */
export function sessionCookie(token: string, hosted: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${hosted ? '; Secure' : ''}`
}

/** The Set-Cookie value that clears it. */
export function clearedCookie(hosted: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${hosted ? '; Secure' : ''}`
}
