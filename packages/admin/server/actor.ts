import { existsSync } from 'node:fs'
import { configuredEmail, type GitIdent } from './git.ts'
import { readRegistry, registryPath, type Entity } from './registry.ts'
import { findMemberByEmail, memberKind } from '../lib/members.mjs'
import { HOUSE_IDENT } from '../lib/trailers.mjs'
import { hatLevel, parseHatRef } from '../lib/hats.mjs'
import type { HatObservation } from '../lib/hat-readings.mjs'

/** A member resolved from git's identity here (0.6). `via` is absent for 0.6 readers, and means `git`. */
export type GitActor = { id: string; name: string; kind: string; via?: 'git' }
/** A signed-in member (L5 spec §6.1): `id` is their member id when exactly one member lists `account` in
 *  `handles.wallet`, else `account` itself (CAIP-10, §6.3); `hats` and `reading` are the Hats reading the request is
 *  judged on. */
export type SiweActor = {
  id: string; name: string; kind: 'person'; via: 'siwe'; account: string
  hats: string[]; reading: { block: number; readAt: string }
}
/** Who a request is made by (architecture §4.2, L5 spec §6.1): a member by git's identity, a signed-in member, or the
 *  address git commits with here when no member holds it (read-only). */
export type Actor = GitActor | SiweActor | { unknown: string }
/** An actor who may act. */
export type KnownActor = GitActor | SiweActor

export const isKnown = (a: Actor): a is KnownActor => 'id' in a

/** The account an actor acts with on the membership tree's chain, and the Hats reading the request judges it on (L5
 *  spec §5.2, §6.2): a signed-in member's session account, or a local git member's `handles.wallet`. `read` is null when
 *  no good reading is in hand: none yet, one past the grace, or, for an act, a read that failed now. */
export interface ActorWallet { account: string; read: { hats: string[]; block: number; readAt: string } | null }

/** The wallet of a git actor, set by the request middleware for that request's actor object only: the actor's own
 *  fields (and so `GET /api/actor`) stay 0.6's. */
const gitWallets = new WeakMap<object, ActorWallet>()

/** Gives a git actor the wallet reading the request middleware made for it. */
export function withWallet<T extends KnownActor>(actor: T, wallet: ActorWallet): T {
  gitWallets.set(actor, wallet)
  return actor
}

/** The actor's wallet and its reading for this request, or null for an actor who acts with none. */
export function walletOf(actor: Actor): ActorWallet | null {
  if ('via' in actor && actor.via === 'siwe') {
    return { account: actor.account, read: actor.reading.readAt === '' ? null : { hats: actor.hats, block: actor.reading.block, readAt: actor.reading.readAt } }
  }
  return gitWallets.get(actor) ?? null
}

/** The actor's reading as observations (L5 spec §7.3): each hat worn, at the block read, and — a `wearer` reading being
 *  the whole of what that account wears (§5.3) — `wears: false` at that block for each of `roleHats` (the hats governance
 *  roles are sourced from) it does not list. A role book built with them holds the actor in every role sourced from a hat
 *  they wear now, and in none whose hat they took off since the proposal last saw them (Review Focus 2; for an act, a
 *  reading made now: §5.2). */
export function readingObservations(actor: Actor, roleHats: readonly string[] = []): HatObservation[] {
  const wallet = walletOf(actor)
  if (!wallet?.read) return []
  const { hats, block, readAt } = wallet.read
  const seen = { account: wallet.account, block, at: readAt }
  return [
    ...hats.map(hat => ({ ...seen, hat, wears: true })),
    ...[...new Set(roleHats)].filter(hat => !hats.includes(hat)).map(hat => ({ ...seen, hat, wears: false })),
  ]
}

/** The account whose recorded observations an act may not lean on: the actor's own, when they have a wallet that could not
 *  be read now (R-L5-8.10). An earlier reading never stands in for the one that failed (§5.2). Null otherwise. */
export function unreadAccount(actor: Actor): string | null {
  const wallet = walletOf(actor)
  return wallet && !wallet.read ? wallet.account : null
}

/** Who a commit made for `actor` is authored by (L5 spec §6.4): the house for a signed-in actor; for a git actor,
 *  nobody given, so git's own identity, as 0.6. */
export function commitIdent(actor: Actor): GitIdent | undefined {
  return 'via' in actor && actor.via === 'siwe' ? { name: HOUSE_IDENT.name, email: HOUSE_IDENT.email } : undefined
}

/** The member whose `handles.git` (or email) holds this repository's
 *  `git config user.email`. Never guessed from a name: no match, two matches, a
 *  members file that is absent or cannot be read, all leave the actor unknown. */
export async function resolveActor(repo: string): Promise<Actor> {
  return actorForEmail(repo, (await configuredEmail(repo)) ?? '')
}

/** `resolveActor` for an address already read: the member whose `handles.git` (or email) holds `email`. */
export function actorForEmail(repo: string, email: string): Actor {
  let members: Entity[] = []
  try {
    if (existsSync(registryPath(repo, 'members'))) members = readRegistry(repo, 'members').entries ?? []
  } catch { members = [] }
  const found = findMemberByEmail(members, email)
  if (!found || found.id === undefined || found.id === null || String(found.id) === '') return { unknown: email }
  const id = String(found.id)
  const name = typeof found.name === 'string' && found.name.trim() !== '' ? found.name : id
  return { id, name, kind: memberKind(found) }
}

/** The Org-Actor trailer: the member's id, or `unknown <email>`, git's own ident
 *  form (`unknown <>` when git has no email set). */
export function actorTrailer(actor: Actor): string {
  return isKnown(actor) ? actor.id : `unknown <${actor.unknown}>`
}

/** The hat lowest in the tree (the highest level); the first of equals. The hat a CAIP-10 actor is named by (R-L5-7.4),
 *  and acts under when no role asks a hat they wear (R-L5-8.2, 8.7). */
export function lowestHat(hats: readonly string[]): string | null {
  let best: string | null = null
  let level = -1
  for (const hat of hats) {
    const parsed = parseHatRef(hat)
    const l = parsed ? hatLevel(parsed.hatId) : -1
    if (l > level) { best = hat; level = l }
  }
  return best
}
