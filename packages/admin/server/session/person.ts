// The person an emailed-link session (I5) names, on every request (Lane 3 Task 9). The cookie must verify (EdDSA, this
// house's key and issuer, not expired), its session row must be live, and the person must be in the Roles table now.
// The house reads the Roles from the table, never from the claims, so a Role removed at a reload stops here at once;
// the org's other sites read the claims, for at most 24 h, and a re-issue under 12 h carries the Roles as they are now.
import type { PrivateStore, RolesPerson } from '../private/store.ts'
import type { PersonActor } from '../actor.ts'
import type { SignInConfig } from './config.ts'
import { personSessionHash } from './sessions.ts'
import {
  clearedSessionCookie, REISSUE_UNDER_S, sessionCookie, signSession, verifySession, SESSION_TTL_S, type SessionClaims,
} from '../../lib/session-token.mjs'

export type { PersonActor }

/** The viewer's roles for a person (I2's Roles and the governance roles they hold), sorted, each once. */
export function viewerRoles(person: RolesPerson, governanceRoles: string[]): string[] {
  return [...new Set([...person.roles, ...governanceRoles])].sort()
}

/** What an I5 cookie reads as: the person, signed in; a session the house ended (signed out, or its row gone with the
 *  store); or a person no longer on the records. Null: no cookie of this house's name, or one that does not verify. */
export type PersonCookie =
  | { kind: 'person'; person: RolesPerson; claims: SessionClaims }
  | { kind: 'ended'; claims: SessionClaims }
  | { kind: 'removed'; claims: SessionClaims }

/** The value of the cookie `name` in a Cookie header, or ''. */
export function cookieValue(header: string | undefined, name: string): string {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return ''
}

/** Reads the I5 cookie of `header` against the store now. Throws only when the store cannot be read. */
export function readPersonCookie(store: PrivateStore, cfg: SignInConfig, header: string | undefined, now: () => Date): PersonCookie | null {
  const token = cookieValue(header, cfg.cookie.name)
  if (token === '') return null
  const at = now()
  const claims = verifySession(token, cfg.publicJwk, at, { iss: cfg.issuer })
  if (!claims) return null
  const row = store.session(personSessionHash(claims.jti))
  if (!row || row.account !== claims.sub || Date.parse(row.expires) <= at.getTime()) return { kind: 'ended', claims }
  const person = store.person(claims.sub)
  return person ? { kind: 'person', person, claims } : { kind: 'removed', claims }
}

/** The signed-in person an I5 cookie names, or null (Task 9's signature). */
export function personFromCookie(store: PrivateStore, cfg: SignInConfig, header: string | undefined, now: () => Date): { person: RolesPerson; claims: SessionClaims } | null {
  const read = readPersonCookie(store, cfg, header, now)
  return read?.kind === 'person' ? { person: read.person, claims: read.claims } : null
}

/** The actor a signed-in person acts as. */
export function personActor(person: RolesPerson): PersonActor {
  return { id: person.id, name: person.name.trim() !== '' ? person.name : person.id, kind: 'person', via: 'email', roles: [...person.roles], nodes: [...person.nodes] }
}

/** True when the token has less than 12 h left at `now` (I5's re-issue). */
export function needsReissue(claims: SessionClaims, now: Date): boolean {
  return claims.exp - Math.floor(now.getTime() / 1000) < REISSUE_UNDER_S
}

/** A fresh token for the same session (the same `jti`, so sign-out still ends it) with the person's Roles now and 24 h
 *  from `now`; its row's end is moved with it. The Set-Cookie value, or null when the row was ended meanwhile. */
export async function reissue(store: PrivateStore, cfg: SignInConfig, person: RolesPerson, claims: SessionClaims, now: Date): Promise<string | null> {
  const iat = Math.floor(now.getTime() / 1000)
  const fresh: SessionClaims = { iss: cfg.issuer, sub: person.id, roles: [...person.roles], nodes: [...person.nodes], iat, exp: iat + SESSION_TTL_S, jti: claims.jti }
  if (!await store.renewSession(personSessionHash(claims.jti), new Date(fresh.exp * 1000).toISOString())) return null
  return sessionCookie(signSession(fresh, cfg.privateJwk), cfg.cookie)
}

/** Ends the session an I5 cookie names, at the house (its row goes). The Set-Cookie value that clears the cookie. */
export async function endPersonSession(store: PrivateStore, cfg: SignInConfig, claims: SessionClaims): Promise<string> {
  await store.deleteSession(personSessionHash(claims.jti))
  return clearedSessionCookie(cfg.cookie)
}
