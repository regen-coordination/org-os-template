// packages/admin/server/request.ts
//
// The actor comes with the request (L5 spec §6.2, §6.5): one middleware, mounted by createApp before every route under
// /api/, sets `c.var.actor` and `c.var.viewer` once per request; routes ask `actorOf(c)`, `knownActorOf(c)` and
// `viewerOf(c)`, never `resolveActor(repo)`. In order:
//   0. a valid emailed-link session (the I5 cookie, Lane 3 Task 9) → the person, with their Roles read from the Roles
//      table now; with no Role, the public's view (their own Profile, `GET /api/actor`, is theirs) and no act;
//   1. a valid session (its cookie read here, from the private store: app.ts's own routes come before mountSession's
//      middleware, R-L5-6.3) → the signed-in member, as `actorIdOf` names them (§6.3);
//   2. no session, local → git's identity, exactly as `resolveActor` (its address read again only when the config file
//      changes); a member listing `handles.wallet` has that address on the tree's chain read like a signed-in member's (§6.2);
//   3. no session, hosted → nobody: the viewer is public, and every write is 401 "Sign in to change anything here."
// A read never waits on the network: it uses the last good reading (`Membership.forRead`). An act (a write) reads now
// (`Membership.forAct`): a signed-in member who wears no hat of the tree now, or whose hats cannot be read, is refused
// before any route runs, so nothing is written (§5.2, Review Focus 2). A signed-in session reads as the public past the
// grace, with no reading and older than the grace (after a restart), or with a reading that shows no hat (L9 §5.8).

import type { Context, MiddlewareHandler } from 'hono'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { isKnown, actorForEmail, actorTrailer, lowestHat, walletOf, withWallet, type Actor, type KnownActor, type PersonActor, type SiweActor } from './actor.ts'
import { configuredEmail } from './git.ts'
import { Refusal } from './changes/apply.ts'
import { effectiveRule, readRuleContext } from './governance/effective.ts'
import { readRegistryOrEmptyCached } from './registry.ts'
import { shortAddress } from './systems/safe.ts'
import { accountOn, actUnreadable, readsAsPublic, TREE_UNREADABLE, type Membership } from './session/membership.ts'
import { sessionFromCookie, type Session } from './session/sessions.ts'
import { endPersonSession, needsReissue, personActor, readPersonCookie, reissue, viewerRoles, type PersonCookie } from './session/person.ts'
import type { SignInConfig } from './session/config.ts'
import type { RolesPerson } from './private/store.ts'
import type { PrivateStore } from './private/store.ts'
import type { HostedConfig } from './hosted/config.ts'
import { actorIdOf, walletsOf, type HatAct } from '../lib/hat-readings.mjs'
import { parseCaip10 } from '../lib/caip.mjs'
import { resolveRoles, rolesOf } from '../lib/rules.mjs'
import type { Viewer } from '../lib/visibility.mjs'

declare module 'hono' {
  interface ContextVariableMap {
    /** The request's actor (L5 spec §6.2); null in hosted mode with no session. */
    actor: Actor | null
    /** The request's viewer (L5 spec §9.4). */
    viewer: Viewer
  }
}

/** §3, §13: a write with no actor in hosted mode. */
export const SIGN_IN = 'Sign in to change anything here.'
/** An act by a person signed in with an emailed link who holds no Role (Review Focus 2: their Profile only). */
export const NO_ROLE = 'You hold no Role here, so your sign-in shows your Profile only and you cannot change anything. Nothing was written.'
/** An act by a signed-in member whose fresh reading shows no hat of the membership tree (§5.2: acts are refused at once). */
export const notWorn = (block: number) =>
  `You no longer wear a hat of this organisation's Hats tree (read at block ${block}), so you cannot change anything here. Nothing was written.`

export interface RequestDeps {
  repo: string
  /** Hosted mode (L5 spec §3): no session is nobody. */
  hosted: boolean
  /** Membership from the Hats tree (Task 6); null when the server has none (then there is no signed-in actor). */
  membership: Membership | null
  /** Where sessions are kept; null or absent: no request carries one. */
  store?: PrivateStore | null
  /** The hosted binding (L9 §5.1), when hosted: the session is read from the `__Host-` cookie alone (§5.8). */
  config?: HostedConfig
  /** The emailed-link sign-in (Lane 3): its cookie is read first. Absent or null: no request carries one. */
  signIn?: SignInConfig | null
  now?: () => Date
}

/** A Hats reading the request's actor is judged on: for an act, read now; for a read, the last good one. */
interface Reading { account: string; hats: string[]; block: number; readAt: string; stale: boolean }

/** The repository each request's middleware ran for. The actor and the viewer themselves are kept in `c.var` only. */
const repos = new WeakMap<Context, string>()
/** The Membership each request's middleware read hats with (null: none, no hats are read). */
const memberships = new WeakMap<Context, Membership | null>()
/** The I5 cookie each request carried, as read (null: none, or one that does not verify). */
const persons = new WeakMap<Context, PersonCookie | null>()
const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Sign-in, its nonce and sign-out: writes that need no actor and no hats. */
const isSessionPath = (path: string) => path === '/api/session' || path.startsWith('/api/session/')

/** The middleware that sets the request's actor and viewer (L5 spec §6.5). createApp mounts it on /api/*. */
export function withRequest(d: RequestDeps): MiddlewareHandler {
  const now = d.now ?? (() => new Date())
  const email = emailReader(d.repo)
  const hostCookie = d.hosted && d.config !== undefined
  return async (c, next) => {
    const act = !READS.has(c.req.method) && !isSessionPath(c.req.path)
    // A session route's write (sign-in, sign-out, a link) sets its own cookies: nothing is re-issued or cleared after it.
    const sessionWrite = !READS.has(c.req.method) && isSessionPath(c.req.path)
    let person: PersonCookie | null = null
    try { person = d.store && d.signIn ? readPersonCookie(d.store, d.signIn, c.req.header('cookie'), now) : null } catch (err) {
      console.error(`org-os admin: a sign-in could not be read from the private store: ${err instanceof Error ? err.message : String(err)}`)
    }
    let session: Session | null = null
    if (person?.kind !== 'person') {
      try { session = d.store && d.membership ? sessionFromCookie(d.store, c.req.header('cookie'), now, hostCookie) : null } catch (err) {
        // A store that fails to answer is no session, never a 500 for every route (as mountSession's middleware).
        console.error(`org-os admin: a session could not be read from the private store: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    let who: { actor: Actor | null; viewer: Viewer }
    if (person?.kind === 'person') {
      if (act && person.person.roles.length === 0) return c.json({ error: NO_ROLE, reason: NO_ROLE, code: 'NO_ROLE' }, 403)
      who = personWho(d.repo, person.person)
    } else if (session && d.membership) {
      const signed = await signedIn(d.repo, d.membership, session, act, now())
      if ('refusal' in signed) return c.json(signed.refusal.body, signed.refusal.status)
      who = signed
    } else if (d.hosted) {
      if (act) return c.json({ error: SIGN_IN, code: 'SIGN_IN' }, 401)
      who = { actor: null, viewer: { kind: 'public' } }
    } else {
      who = await byGit(d.repo, d.membership, act, email)
    }
    repos.set(c, d.repo)
    memberships.set(c, d.membership)
    persons.set(c, person)
    c.set('actor', who.actor)
    c.set('viewer', who.viewer)
    await next()
    // I5's re-issue: under 12 h left, a fresh cookie with the Roles as they are now. A person no longer on the records,
    // or a session the house ended: the row goes and the cookie is cleared.
    if (person && d.store && d.signIn && !sessionWrite) {
      try {
        const cookie = person.kind === 'person'
          ? (needsReissue(person.claims, now()) ? await reissue(d.store, d.signIn, person.person, person.claims, now()) : null)
          : await endPersonSession(d.store, d.signIn, person.claims)
        if (cookie) c.res.headers.append('set-cookie', cookie)
      } catch (err) {
        console.error(`org-os admin: a sign-in could not be renewed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}

/** The I5 cookie the request carried, as the request middleware read it (null: none, or one that does not verify). */
export function personOf(c: Context): PersonCookie | null {
  return persons.get(c) ?? null
}

/** The repository the middleware ran for; it throws when it did not run, so a route mounted before it is found at once. */
function repoOf(c: Context): string {
  const repo = repos.get(c)
  if (repo === undefined) throw new Error(`No actor for ${c.req.method} ${c.req.path}: the request middleware (withRequest) did not run before this route.`)
  return repo
}

/** The request's actor: a signed-in member, git's identity locally, or null in hosted mode with no session. */
export function actorOf(c: Context): Actor | null {
  repoOf(c)
  return c.get('actor')
}

/** The request's actor when it may act: 401 `SIGN_IN` in hosted mode with no session; 403 with 0.6's sentence for a git
 *  identity no member holds. */
export function knownActorOf(c: Context): KnownActor {
  const repo = repoOf(c)
  const actor = c.get('actor')
  if (actor === null) throw new Refusal(401, { error: SIGN_IN, code: 'SIGN_IN' })
  if (isKnown(actor)) return actor
  const reason = effectiveRule(readRuleContext(repo, actor), []).sentence
  throw new Refusal(403, { reason, error: reason })
}

/** The request's actor for a read: a hosted request with no session reads as git's unknown, which may write nothing. */
export function readerOf(c: Context): Actor {
  return actorOf(c) ?? { unknown: '' }
}

/** The request's viewer (L5 spec §9.4). */
export function viewerOf(c: Context): Viewer {
  repoOf(c)
  return c.get('viewer')
}

/** Reads an account's hats now through the request's Membership (`forAct`, §5.2), for a ratify's re-check of every counted
 *  actor (§7.4); null when the server reads no hats. */
export function wearerReadOf(c: Context): ((account: string) => ReturnType<Membership['forAct']>) | null {
  repoOf(c)
  const m = memberships.get(c) ?? null
  return m ? account => m.forAct(account) : null
}

// ── an act under a hat (§7.2) ───────────────────────────────────────────────────────────────────────

/** Whether the act may be made without any Hats reading of the actor: judged by the book with no reading of theirs. */
export type WithoutReading = () => boolean

/** Refuses an act that may be made under one of `hats` when the actor has a wallet whose hats could not be read now (a
 *  git member with `handles.wallet`; a signed-in member's failed read is refused by the middleware), unless the act is
 *  permitted without that reading (`permitted`: a comment, an approval under a role written with `members`): 502 with
 *  §5.2's sentence, writing nothing. With no such hats, no wallet, or a reading in hand, nothing is refused. An outage of
 *  the tree never takes away what a member may do by data/members.yaml (R-L5-7.3, §6.2). */
export function requireReading(c: Context, hats: readonly string[], permitted: WithoutReading): void {
  const actor = actorOf(c)
  const m = memberships.get(c) ?? null
  const wallet = actor ? walletOf(actor) : null
  if (!m || !wallet || wallet.read || hats.length === 0 || permitted()) return
  const sentence = actUnreadable(m.hatName(hats[0]!))
  throw new Refusal(502, { error: sentence, code: 'HATS_UNREADABLE' })
}

/**
 * What an act that may be made under one of `hats` (the hats of the roles sourced from a hat that the act is judged by, in
 * the order they are asked) records beside it (L5 spec §7.2), read now through `Membership.actFor`: the first of `hats`
 * the actor wears. An actor who acts as their CAIP-10 id records an act whatever they do: when they wear none of `hats`,
 * under the lowest hat they wear, and the rules then judge (and refuse) it. Null for an act under no hat: an actor with no
 * wallet, a member who wears none of `hats`, or a member whose wallet could not be read and whose act is `permitted`
 * without it. Refused, writing nothing, before any lock is taken: the tree unreadable (502, §5.2's sentence), the hat no
 * longer worn (403).
 */
export async function hatActOf(c: Context, hats: readonly string[], permitted: WithoutReading): Promise<HatAct | null> {
  const actor = actorOf(c)
  const m = memberships.get(c) ?? null
  const wallet = actor && isKnown(actor) ? walletOf(actor) : null
  if (!actor || !isKnown(actor) || !m || !wallet) return null
  requireReading(c, hats, permitted)
  const worn = wallet.read?.hats ?? []
  const hat = hats.find(h => worn.includes(h)) ?? (actor.id === wallet.account ? lowestHat(worn) : null)
  if (!hat) return null
  const act = await m.actFor(wallet.account, hat)
  if ('ok' in act) {
    throw new Refusal(act.code === 'HATS_UNREADABLE' ? 502 : 403,
      act.code === 'HATS_UNREADABLE' ? { error: act.error, code: act.code } : { reason: act.error, error: act.error, code: act.code })
  }
  return act
}

// ── the signed-in member (§6.3) ─────────────────────────────────────────────────────────────────────

async function signedIn(repo: string, m: Membership, session: Session, act: boolean, at: Date): Promise<{ actor: SiweActor; viewer: Viewer } | { refusal: Refusal }> {
  const members = membersOf(repo)
  const account = session.account
  const id = actorIdOf(account, members)
  const kept = m.forRead(account)
  let read: Reading | null = kept ? { account, ...kept } : null
  if (act) {
    const now = await m.forAct(account)
    if (!now.ok) {
      if (now.error !== TREE_UNREADABLE) return { refusal: new Refusal(403, { reason: now.error, error: now.error, code: 'NO_TREE' }) }
      const lowest = lowestHat(kept?.hats ?? [])
      const sentence = actUnreadable(lowest ? m.hatName(lowest) : 'a hat of this organisation\'s Hats tree')
      return { refusal: new Refusal(502, { error: sentence, code: 'HATS_UNREADABLE' }) }
    }
    if (now.hats.length === 0) {
      const sentence = notWorn(now.block)
      return { refusal: new Refusal(403, { reason: sentence, error: sentence, code: 'NOT_WORN' }) }
    }
    read = { account, hats: now.hats, block: now.block, readAt: now.readAt, stale: false }
  }
  const hats = read && !read.stale ? read.hats : []
  const member = members.find(e => String(e.id) === id)
  const name = member ? nameOf(member, id) : addressName(m, account, hats)
  const actor: SiweActor = {
    id, name, kind: 'person', via: 'siwe', account, hats,
    reading: { block: read?.block ?? 0, readAt: read?.readAt ?? '' }, // no reading yet: after a restart, until the first lands
  }
  // Past the grace (§5.2), with no reading and older than the grace (after a restart, carry 3), or wearing no hat (a
  // member whose hats were taken off, L9 §5.8): the session reads as public until a reading with a hat lands.
  const viewer: Viewer = readsAsPublic(read, session.created, at) ? { kind: 'public' } : { kind: 'member', id, hats, roles: rolesFor(repo, actor, read) }
  return { actor, viewer }
}

// ── the person signed in with an emailed link (Lane 3 Task 9) ───────────────────────────────────────

/** The person's actor and viewer: with no Role, the public's view (Review Focus 2); otherwise a member whose roles are
 *  their Roles and the governance roles the members list gives their id (a steward listed in a role's `members` holds it). */
function personWho(repo: string, p: RolesPerson): { actor: PersonActor; viewer: Viewer } {
  const actor = personActor(p)
  if (p.roles.length === 0) return { actor, viewer: { kind: 'public' } }
  return { actor, viewer: { kind: 'member', id: p.id, hats: [], roles: viewerRoles(p, rolesFor(repo, actor, null)) } }
}

/** A CAIP-10 actor's name (§6.3): the name of the lowest hat worn and the short address ("Council · 0x0000…00A1"). The
 *  hat is named by its role id, written as a name (Task 7, R-L5-21.3): its first letter capital, `-` and `_` as spaces. */
function addressName(m: Membership, account: string, hats: string[]): string {
  const address = parseCaip10(account)?.address ?? account
  const lowest = lowestHat(hats)
  return lowest ? `${asName(m.hatName(lowest))} · ${shortAddress(address)}` : shortAddress(address)
}
const asName = (id: string) => (/^[a-z]/.test(id) ? `${id[0]!.toUpperCase()}${id.slice(1).replace(/[-_]+/g, ' ')}` : id)


// ── git's identity, locally (§6.2) ──────────────────────────────────────────────────────────────────

async function byGit(repo: string, m: Membership | null, act: boolean, email: () => Promise<string>): Promise<{ actor: Actor; viewer: Viewer }> {
  let actor: Actor
  try { actor = actorForEmail(repo, await email()) } catch { actor = { unknown: '' } }
  // The person at the machine reads what git holds, as in 0.6, whoever git says they are.
  if (!isKnown(actor)) return { actor, viewer: { kind: 'member', id: actorTrailer(actor), hats: [], roles: [] } }
  const wallet = m ? await walletReading(m, membersOf(repo).find(e => String(e.id) === actor.id), act) : null
  const read = wallet?.read ?? null
  // The actor keeps the reading for this request (`walletOf`): a role sourced from a hat they wear holds them (§6.2).
  if (wallet) withWallet(actor, { account: wallet.account, read: read && !read.stale ? { hats: read.hats, block: read.block, readAt: read.readAt } : null })
  return { actor, viewer: { kind: 'member', id: actor.id, hats: read && !read.stale ? read.hats : [], roles: rolesFor(repo, actor, read) } }
}

/** The account of a git member's `handles.wallet` on the tree's chain (the first listed there), and its reading: read now
 *  for an act, the last good one for a read. A read that fails gives no reading and refuses nothing here: an act under a
 *  hat asks `hatActOf`, which refuses it then with §5.2's sentence. */
async function walletReading(m: Membership, member: Record<string, unknown> | undefined, act: boolean): Promise<{ account: string; read: Reading | null } | null> {
  const tree = m.tree()
  if (!tree || !member) return null
  const account = walletsOf(member).map(w => accountOn(tree.chain, w)).find((a): a is string => a !== null)
  if (!account) return null
  if (!act) {
    const kept = m.forRead(account)
    return { account, read: kept ? { account, ...kept } : null }
  }
  const now = await m.forAct(account)
  return { account, read: now.ok ? { account, hats: now.hats, block: now.block, readAt: now.readAt, stale: false } : null }
}

/** `git config user.email` here, read once and again only when the repository's own config file changes (another inode,
 *  time or size: `git config` writes a new file), so a request does not start a git process to learn who is asking. A
 *  change made only to the global configuration is seen when this process starts again. A repository whose config is
 *  not at `.git/config` (a linked worktree) is asked each time, as `resolveActor` does. */
function emailReader(repo: string): () => Promise<string> {
  let kept: { key: string; email: string } | null = null
  return async () => {
    let key: string | null = null
    try { const st = statSync(join(repo, '.git', 'config')); key = `${st.ino}:${st.mtimeMs}:${st.size}` } catch { key = null }
    if (key !== null && kept?.key === key) return kept.email
    const email = (await configuredEmail(repo)) ?? ''
    kept = key === null ? null : { key, email }
    return email
  }
}

// ── shared ──────────────────────────────────────────────────────────────────────────────────────────

/** The governance roles `actor` holds, its hat-sourced ones from `read` (exactly the hat, §5.3). */
function rolesFor(repo: string, actor: KnownActor, read: Reading | null): string[] {
  const rc = readRuleContext(repo, actor)
  const observations = read && !read.stale
    ? read.hats.map(hat => ({ hat, account: read.account, wears: true, block: read.block, at: read.readAt }))
    : []
  return rolesOf(resolveRoles(rc.governance, rc.members ?? [], observations).roles, actor.id)
}

function nameOf(member: Record<string, unknown>, id: string): string {
  return typeof member.name === 'string' && member.name.trim() !== '' ? member.name : id
}

/** The members registry, through the repository's read cache (L9 §7.6): parsed again only when the file changes. A missing
 *  file, or one that cannot be read, is no members. Frozen: every request shares it. */
function membersOf(repo: string): Record<string, unknown>[] {
  try { return (readRegistryOrEmptyCached(repo, 'members').entries ?? []) as Record<string, unknown>[] } catch { return [] }
}
