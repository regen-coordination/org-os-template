// packages/admin/server/session/names.ts
//
// Walk fix wave 4 (G9: W1, W2, W5, M13; PF-R258): who someone is, said one way everywhere a person is shown: history (from
// a commit's Org-Actor trailer, never git's author name), presence, comments, a proposal's author and its events. A member
// is their name; a CAIP-10 actor no member holds is the name of the lowest hat they wear and their short address
// ("Council · 0x57cB…E9c7", as a signed-in actor is named, request.ts); anyone else as the id says. Monograms are drawn
// from this name, so a person has the same two letters everywhere.
//
// Rule 4: a member's name is read from their record as the viewer may read it (the gate, `gateRecord`): a name the viewer
// may not read is not said, the id the ledger or the trailer already holds is. A hat is named as PF-R255 names it: the
// role sourced from it, else the tree read's details only when the caller passes them (a viewer who may read the tree),
// else its pretty id.

import { existsSync } from 'node:fs'
import { readRegistry, registryPath } from '../registry.ts'
import { accountOn, type Membership } from './membership.ts'
import { addressName } from './address-name.ts'
import { gateRecord, Levels } from '../visibility/gate.ts'
import { walletsOf } from '../../lib/hat-readings.mjs'
import { parseCaip10, sameAccount } from '../../lib/caip.mjs'
import type { Viewer } from '../../lib/visibility.mjs'

const nameOf = (record: Record<string, unknown> | null, id: string): string =>
  record && typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : id

/** The name a person signed in by an emailed link is shown by (R2, PF-R258): their member name when the members file
 *  holds their person id (as `displayNames` says it everywhere else, so the composer's monogram, the identity and their
 *  comments agree), else the Roles table's. Rule 4 (T2c minor 2): the members file is read as `viewer` may read it: a
 *  person with no Role reads as the public, and a name the public may not read is not said. T2e I1: when the members file
 *  holds their id (or cannot be read, so may), the Roles table's name never stands in for one `viewer` may not read: the id
 *  is said. Only `own` (their own session, telling them) falls back to it. */
export function personName(repo: string, person: { id: string; name: string }, viewer: Viewer, own = false): string {
  const said = displayNames(repo, null, { viewer })(person.id)
  if (said !== person.id) return said
  if (!own && membersHold(repo)(person.id)) return person.id
  return person.name.trim() !== '' ? person.name : person.id
}

/** T2e I1 (Rule 4): whether the members file holds `id`, read now. A file that is there but cannot be read may hold it, so
 *  it counts as holding: no other name (a session's, the Roles table's) stands in for a name the gate did not say. */
export function membersHold(repo: string): (id: string) => boolean {
  let ids: Set<string> | null
  try {
    ids = existsSync(registryPath(repo, 'members'))
      ? new Set((readRegistry(repo, 'members').entries ?? []).map(m => String((m as { id?: unknown }).id)))
      : new Set()
  } catch { ids = null }
  return id => ids === null || ids.has(id)
}

/** T2f 1 (Rule 4): the label a mention of a member is written with, in the picker and into any text (a comment, a page, a
 *  task's title; `relabelMembers`): their name as any member may read it (the gate, with the generic member viewer that
 *  `actorNames` uses), else their id. An id the members file does not hold, or one that cannot be read, is its id. */
export function memberLabels(repo: string): (id: string) => string {
  const said = displayNames(repo, null)
  let ids: Set<string>
  try {
    ids = existsSync(registryPath(repo, 'members'))
      ? new Set((readRegistry(repo, 'members').entries ?? []).map(m => String((m as { id?: unknown }).id)))
      : new Set()
  } catch { ids = new Set() }
  return id => (ids.has(id) ? said(id) : id)
}

/** The Org-Actor value of a git identity no member matches (`actorTrailer`): `unknown <email>`. */
const UNKNOWN = /^unknown <.*>$/

/**
 * `displayName(id)` for one answer: `id` an actor as the ledger, a trailer, a comment or presence holds it (a member id, a
 * CAIP-10 account, `unknown <email>`). `viewer`: who it is said to (absent: a member, the server's own reads of git that
 * every member reads). `details`: the tree read's hat names, given only for a viewer who may read the tree (PF-R255).
 */
export function displayNames(repo: string, membership: Membership | null, o: { viewer?: Viewer; details?: ReadonlyMap<string, string> } = {}): (id: string) => string {
  let members: Record<string, unknown>[] = []
  try { members = existsSync(registryPath(repo, 'members')) ? (readRegistry(repo, 'members').entries ?? []) as Record<string, unknown>[] : [] } catch { members = [] }
  const viewer: Viewer = o.viewer ?? { kind: 'member', id: '', hats: [], roles: [] }
  let levels: Levels | null = null
  const shown = (m: Record<string, unknown>): Record<string, unknown> | null => {
    levels ??= new Levels(repo)
    try { return gateRecord(viewer, 'members', m, levels.config, levels.record('members', m)) } catch { return null }
  }
  const memo = new Map<string, string>()
  return id => {
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    let out = id
    const member = members.find(m => String(m.id) === id)
    if (member) out = nameOf(shown(member), id)
    else if (parseCaip10(id)) {
      const holder = members.find(m => walletsOf(m).some((w: string) => sameAccount(w, id)))
      if (holder) out = nameOf(shown(holder), String(holder.id))
      else {
        const tree = membership?.tree() ?? null
        const account = tree ? accountOn(tree.chain, id) : null
        const read = account && membership ? membership.forRead(account) : null
        out = addressName(membership, id, read && !read.stale ? read.hats : [], o.details)
      }
    } else if (UNKNOWN.test(id)) out = 'someone not in the members file'
    memo.set(id, out)
    return out
  }
}
