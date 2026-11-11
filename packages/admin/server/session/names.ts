// packages/admin/server/session/names.ts
//
// Walk fix wave 4 (G9: W1, W2, W5, M13; PF-R258): who someone is, said one way everywhere a person is shown: history (from
// a commit's Org-Actor trailer, never git's author name), presence, comments, a proposal's author and its events. A member
// is their name; a CAIP-10 actor no member holds is the name of the lowest hat they wear and their short address
// ("Council · 0x00C0…0C01", as a signed-in actor is named, request.ts); anyone else as the id says. Monograms are drawn
// from this name, so a person has the same two letters everywhere.
//
// Rule 4: a member's name is read from their record as the viewer may read it (the gate, `gateRecord`): a name the viewer
// may not read is not said, the id the ledger or the trailer already holds is. A hat is named as PF-R255 names it: the
// role sourced from it, else the tree read's details only when the caller passes them (a viewer who may read the tree),
// else its pretty id.

import { readRegistryOrEmptyCached } from '../registry.ts'
import { HttpError } from '../errors.ts'
import { accountOn, type Membership } from './membership.ts'
import { addressName } from './address-name.ts'
import { gateRecord, Levels } from '../visibility/gate.ts'
import { walletsOf } from '../../lib/hat-readings.mjs'
import { parseCaip10, sameAccount } from '../../lib/caip.mjs'
import type { ParsedLevel, Viewer } from '../../lib/visibility.mjs'

/** R4c 4: the members file through the repository's read cache (L9 §7.6), as every request reads it: parsed again only when
 *  the file changes. A missing file is no members ([]); one that is there but cannot be read is null, so each caller keeps
 *  its fail-closed reading of it (no name said; held, so no other name stands in). Frozen: requests share it. */
function membersRead(repo: string): readonly Record<string, unknown>[] | null {
  try { return (readRegistryOrEmptyCached(repo, 'members').entries ?? []) as Record<string, unknown>[] } catch { return null }
}
const idsOf = (entries: readonly Record<string, unknown>[]) => new Set(entries.map(m => String(m.id)))

/** R4c 3: said when a text that mentions a member is written while the members file cannot be read (503, as the house's
 *  other unavailable answers): its labels would be written as ids for good. */
export const MEMBERS_UNREADABLE = 'The members file cannot be read now, so the names this text mentions cannot be written as its readers may read them. Nothing was written.'

/** The generic member: no hat, no role (the viewer `actorNames` and a members text's labels are read as). */
const ANY_MEMBER: Viewer = Object.freeze({ kind: 'member', id: '', hats: [], roles: [] }) as Viewer
const THE_PUBLIC: Viewer = Object.freeze({ kind: 'public' }) as Viewer

/** R4c 1: the loosest viewer a text at `level` admits: the public for a public text, otherwise the generic member. */
export const loosestReader = (level: ParsedLevel): Viewer => (level.level === 'public' ? THE_PUBLIC : ANY_MEMBER)

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
  const read = membersRead(repo)
  const ids = read === null ? null : idsOf(read)
  return id => ids === null || ids.has(id)
}

/** T2f 1, R4c 1 and 3 (Rule 4): the label a mention of a member is written with into a text at `level` (a comment, a page,
 *  a task's title, an import; `relabelMembers`): their name as the loosest reader of that level may read it (the gate: the
 *  public for a public text, otherwise the generic member that `actorNames` uses), else their id. An id the members file does
 *  not hold is its id. The file is read at the first label asked for: one that cannot be read refuses the write (503,
 *  MEMBERS_UNREADABLE), since its labels would otherwise be written as ids for good; a text with no member mention is
 *  never refused by it. */
export function memberLabels(repo: string, level: ParsedLevel): (id: string) => string {
  let label: ((id: string) => string) | null = null
  return id => {
    if (label === null) {
      const read = membersRead(repo)
      if (read === null) throw new HttpError(503, MEMBERS_UNREADABLE, 'MEMBERS_UNREADABLE')
      label = labelsFrom(repo, read, loosestReader(level))
    }
    return label(id)
  }
}

/** R4c 1 (half b): a member mention's label as stored text is handed to `viewer` from a text at `level` now: the name when
 *  both the loosest reader of that level and the viewer may read it, else the id. A page widened since it was written, or
 *  one written outside the Hub, is read so. A members file that cannot be read says the id (fail closed). */
export function readLabels(repo: string, level: ParsedLevel, viewer: Viewer): (id: string) => string {
  const read = membersRead(repo)
  if (read === null) return id => id
  const atLevel = labelsFrom(repo, read, loosestReader(level))
  const toViewer = displayNames(repo, null, { viewer })
  return id => {
    const name = atLevel(id)
    return name !== id && toViewer(id) === name ? name : id
  }
}

function labelsFrom(repo: string, read: readonly Record<string, unknown>[], viewer: Viewer): (id: string) => string {
  const ids = idsOf(read)
  const said = displayNames(repo, null, { viewer })
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
  const members = membersRead(repo) ?? []
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
