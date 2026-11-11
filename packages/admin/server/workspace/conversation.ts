// packages/admin/server/workspace/conversation.ts
//
// Conversation (DAO-OS L6 spec §8): comments on a page or a record, mentions told only to those who may see what they are
// on, notifications as rows of Needs you, and read state. All of it lives in the private store (schema 2, §8.1), never in
// git (rule 4): a comment has no level of its own, it follows its target's level as it is now (§8.2), so a comment, a
// mention or a notification on something the viewer may not see is absent, and counts drop with it (rule 7). Every read
// is judged here through `Levels` and `gateItems`; while the store is down, conversation refuses in L5's words (§16).
//
// What the routes answer is a superset of L4c's shapes (controller ruling P-11): L4c's `Comment` with the author's id, the
// anchor as stored, a deleted state and the reply's parent; L4c's `Mentionable` with `recordKind` and the `href` a mention
// is written with. `POST /api/comments` answers 201 `{ comment, notTold }`; `GET /api/notifications` answers
// `NotificationRow[]` (preflight row 46; both in the L6 rulings log).

import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { lowestHat, type KnownActor } from '../actor.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { Refusal } from '../changes/apply.ts'
import { baseOf } from '../changes/canonical.ts'
import { currentEntries, targetsOfOps } from '../changes/stage.ts'
import type { RecordOp } from '../changes/types.ts'
import { readRuleContext } from '../governance/effective.ts'
import { registriesOf } from '../registries.ts'
import { shortAddress } from '../systems/safe.ts'
import { accountOn, type Membership } from '../session/membership.ts'
import { displayNames } from '../session/names.ts'
import { addressName } from '../session/address-name.ts'
import { gitNames, reach, unavailable, type PrivateAccess } from '../private/ops.ts'
import { levelOfToken, NO_PRIVATE, privateReads } from '../private/reads.ts'
import type { CommentRow, MentionRow, PrivateStore, StoredNotification } from '../private/store.ts'
import { readConfig } from '../visibility/config.ts'
import { gateItems, Levels, MAINTAINERS, NOBODY } from '../visibility/gate.ts'
import { commitOrStage, guardPageRefs, mayWritePrivate } from './pages.ts'
import { bury, onTargetsGone, tombstones, unbury } from './gone.ts'
import { admits, formatLevel, fullLevel, gitAllows, narrowerOrEqual, type ParsedLevel, type Viewer } from '../../lib/visibility.mjs'
import { refsOf } from '../../lib/workspace/markdown.mjs'
import { NO_PAGE, slugOf, splitPage } from '../../lib/workspace/pages.mjs'
import { resolveRoles, rolesOf } from '../../lib/rules.mjs'
import { actorIdOf, walletsOf } from '../../lib/hat-readings.mjs'
import { parseCaip10 } from '../../lib/caip.mjs'
import { memberKind } from '../../lib/members.mjs'

export type { CommentRow } from '../private/store.ts'

/** What a comment, a mention or presence is on (§8.1). */
export type Target = `page:${string}` | `record:${string}:${string}`

/** §8.2: a comment's body, at most. Characters are counted as code points. */
export const COMMENT_MAX_CHARS = 10000
/** §8.1: each part of an anchor (its quote, the text before, the text after), at most. */
export const ANCHOR_MAX_CHARS = 500

/** §8.3: said under the comment for each member a mention did not tell. */
export const NOT_TOLD = (name: string) => `Not told: ${name} can’t see this page.`
/** §8.2: a comment whose quote is gone from its target stays, unanchored, with this. */
export const ANCHOR_CHANGED = 'The text it was on has changed.'
/** §8.2: a deleted comment's body is cleared, and it reads this. */
export const DELETED = 'Deleted'

// Copy beyond the spec's (L6 rulings log, Task 9).
export const COMMENT_TOO_LONG = (n: number) => `A comment is at most ${COMMENT_MAX_CHARS} characters, and this one is ${n}. Nothing was sent.`
export const ANCHOR_TOO_LONG = `A comment's anchor is the text it is on and the text just before and after it, each at most ${ANCHOR_MAX_CHARS} characters. Nothing was sent.`
export const COMMENT_EMPTY = 'A comment needs some text. Nothing was sent.'
export const NO_TARGET = (t: Target): string => {
  if (t.startsWith('page:')) return NO_PAGE(t.slice('page:'.length))
  const { registry, id } = recordOf(t)
  return `There is no record ${id} in ${registry}.`
}
export const NO_COMMENT = (id: string) => `There is no comment ${id}.`
export const NOT_YOUR_COMMENT = 'Only the person who wrote a comment can delete it. Nothing was changed.'
export const NOT_ON_TARGET = (id: string, t: Target) => `Comment ${id} is not on ${t}, so this cannot reply to it. Nothing was sent.`
export const DELETED_NO_TASK = 'A deleted comment cannot be turned into a task. Nothing was written.'
/** DAO-OS L6 Task 18 fix round 1: a comment becomes one task only. */
export const TASK_ALREADY = (task: string) => `This comment was turned into the task ${task} already. Nothing was written.`
const COMMENT_BODY = 'The body must be {"target": "page:<id>" or "record:<collection>:<id>", "body", "parent"?, "anchor"?: {"exact", "prefix"?, "suffix"?}}.'
const TARGET_QUERY = 'Name what the comments are on: ?target=page:<id> or ?target=record:<collection>:<id>.'
const READ_BODY = 'The body must be {"ids": [<notification id>, …]} or {"target": "page:<id>" or "record:<collection>:<id>"}.'

const PAGE_TARGET = /^page:([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/
const RECORD_TARGET = /^record:([a-z][a-z0-9_-]{0,40}):([^\s:][^\s]{0,199})$/

/** A target as the wire writes it, or null. */
export function parseTarget(s: string): Target | null {
  return PAGE_TARGET.test(s) || RECORD_TARGET.test(s) ? (s as Target) : null
}
function recordOf(t: Target): { registry: string; id: string } {
  const m = RECORD_TARGET.exec(t)
  return m ? { registry: m[1]!, id: m[2]! } : { registry: '', id: t }
}

// ── what a target is (§8.2) ───────────────────────────────────────────────────────────────────────────

const levelsOf = (repo: string, store: PrivateStore | null) =>
  new Levels(repo, readConfig(repo), MAINTAINERS, store ? privateReads(() => store) : NO_PRIVATE)

/** A target's level as it is now; null when there is no such thing (deleted, never there, or kept by a store that cannot
 *  be read). */
export function targetLevel(repo: string, target: Target, store: PrivateStore | null): ParsedLevel | null {
  return levelsOf(repo, store).target(target)
}

/** A target's level, its title (Needs you's "<name> mentioned you on <title>") and its text (where an anchor's quote is
 *  looked for). */
export interface TargetInfo { level: ParsedLevel; title: string; text: string }

const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings)
  : v !== null && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
const titleOf = (r: Record<string, unknown>, id: string): string =>
  (typeof r.title === 'string' && r.title !== '' ? r.title : typeof r.name === 'string' && r.name !== '' ? r.name : id)

export function targetInfo(repo: string, target: Target, store: PrivateStore | null): TargetInfo | null {
  const levels = levelsOf(repo, store)
  const level = levels.target(target)
  if (!level) return null
  if (target.startsWith('page:')) {
    const e = levels.pages().get(target.slice('page:'.length))
    return e ? { level, title: e.title, text: e.markdown } : null
  }
  const { registry, id } = recordOf(target)
  const git = levels.records(registry).find(e => String(e.id) === id) as Record<string, unknown> | undefined
  const body = git ?? levels.priv.records(registry).find(r => r.id === id)?.body
  return body ? { level, title: titleOf(body, id), text: strings(body).join('\n') } : null
}

/**
 * The target as `viewer` may see it; else the 404 of one that is not there (rule 7: absent and invisible read alike). A
 * target that is not there while the store is down (`store` null) may be one the store keeps, so it is the store's 503 in
 * L5's words (`why`), and nothing is told by it.
 */
export function visibleTarget(repo: string, target: Target, store: PrivateStore | null, why: unknown, viewer: Viewer): TargetInfo {
  const info = targetInfo(repo, target, store)
  if (!info) {
    if (!store) throw unavailable(why)
    throw new HttpError(404, NO_TARGET(target))
  }
  if (viewer.kind !== 'member' || !admits(info.level, viewer)) throw new HttpError(404, NO_TARGET(target))
  return info
}

// ── who may be told (§8.3) ──────────────────────────────────────────────────────────────────────────

interface Reading { account: string; hats: string[]; block: number; readAt: string }
type Role = { id: string; members: string[]; all: boolean; defined: boolean }

/** The members, their roles and their last good Hats readings, read once per question. */
class People {
  readonly members: Record<string, unknown>[]
  private readonly byId: Map<string, Record<string, unknown>>
  private readonly governance: Record<string, unknown> | null
  private allRoles: Map<string, Role> | null = null
  constructor(readonly repo: string, private readonly membership: Membership | null) {
    const rc = readRuleContext(repo, { unknown: '' })
    this.members = rc.members ?? []
    this.governance = rc.governance
    this.byId = new Map(this.members.filter(m => m.id !== undefined && m.id !== null && m.id !== '').map(m => [String(m.id), m]))
  }

  member(id: string): Record<string, unknown> | undefined { return this.byId.get(id) }

  /** The last good reading of a member's wallet on the tree's chain (or of a CAIP-10 account), never awaited (`forRead`);
   *  null with none — then they wear no hat here (fail closed, §8.3). */
  reading(memberOrAccount: string): Reading | null {
    const m = this.membership
    const tree = m?.tree() ?? null
    if (!m || !tree) return null
    const member = this.byId.get(memberOrAccount)
    const account = parseCaip10(memberOrAccount) ? accountOn(tree.chain, memberOrAccount)
      : member ? walletsOf(member).map((w: string) => accountOn(tree.chain, w)).find((a: string | null): a is string => a !== null) ?? null : null
    if (!account) return null
    const kept = m.forRead(account)
    return kept && !kept.stale ? { account, hats: kept.hats, block: kept.block, readAt: kept.readAt } : null
  }

  viewer(memberOrAccount: string): Viewer {
    const id = parseCaip10(memberOrAccount) ? String(actorIdOf(memberOrAccount, this.members)) : memberOrAccount
    const r = this.reading(memberOrAccount)
    const roles = rolesOf(resolveRoles(this.governance, this.members, r ? observed(r) : []).roles, id) as string[]
    return { kind: 'member', id, hats: r?.hats ?? [], roles }
  }

  /** Every role, its holders read from every member's last good reading (a role sourced from a hat holds its wearers). */
  roles(): Map<string, Role> {
    this.allRoles ??= resolveRoles(this.governance, this.members, this.members.flatMap(m => {
      const r = this.reading(String(m.id))
      return r ? observed(r) : []
    })).roles as Map<string, Role>
    return this.allRoles
  }

  /** The name of the lowest hat a member wears, by their last good reading. */
  hat(id: string): string | undefined {
    const low = lowestHat(this.reading(id)?.hats ?? [])
    return low && this.membership ? this.membership.hatName(low) : undefined
  }
}
const observed = (r: Reading) => r.hats.map(hat => ({ hat, account: r.account, wears: true, block: r.block, at: r.readAt }))

/**
 * Who `memberOrAccount` reads as (§8.3): their governance roles, and the hats of the last good reading kept for their wallet
 * (`Membership.forRead`). With no reading — never read, past the grace, or no Membership — they wear no hat, so a hat level
 * does not admit them (fail closed). A CAIP-10 account reads as the member whose wallet it is.
 */
export function viewerFor(memberOrAccount: string, deps: { repo: string; membership: Membership | null }): Viewer {
  return new People(deps.repo, deps.membership).viewer(memberOrAccount)
}

/** How a member is shown (L4c's `handle` and `role`): their id, and who they are (session/names.ts `displayNames`, the
 *  one display name: their name; a CAIP-10 actor no member holds, the lowest hat they wear and their short address,
 *  "Council · 0x57cB…E9c7"; walk fix wave 4, G9). A CAIP-10 actor's handle is their short address. `viewer`: who it is
 *  said to (a name they may not read is not said). */
export function namesFor(repo: string, membership: Membership | null, viewer?: Viewer): (id: string) => { handle: string; role: string } {
  const display = displayNames(repo, membership, viewer ? { viewer } : {})
  return id => {
    const caip = parseCaip10(id)
    return { handle: caip ? shortAddress(caip.address) : id, role: display(id) }
  }
}

/** `namesFor` for the actor a request knows: a signed-in CAIP-10 actor is named by the hats their session read. */
export function actorNames(repo: string, membership: Membership | null): (actor: KnownActor) => { handle: string; role: string } {
  return actor => {
    if (actor.via === 'siwe' && actor.id === actor.account) {
      const address = parseCaip10(actor.account)?.address ?? actor.account
      return { handle: shortAddress(address), role: addressName(membership, actor.account, actor.hats) }
    }
    const names = namesFor(repo, membership)(actor.id)
    return names.role === actor.id ? { handle: actor.id, role: actor.name } : names
  }
}

export interface ConversationDeps { repo: string; store: PrivateStore; membership: Membership | null; now?: () => Date }

type Kind = MentionRow['kind']
const KIND: Record<string, Kind> = { member: 'member', person: 'member', role: 'role', page: 'page', record: 'record' }
const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`
const storeRead = <T>(store: PrivateStore, fn: () => T): T => { try { return fn() } catch (err) { throw unavailable(err, store) } }

interface Judged { told: string[]; notTold: string[]; mentions: MentionRow[]; notifications: StoredNotification[] }

/** §8.3's test for each mention, nothing written: a member is told when the target's level admits them (`viewerFor`); a role
 *  tells each holder who passes the same test; the author is never told of their own mention; a page or a record mentioned
 *  tells nobody. A mention `source` already recorded is not told again. One notification per member told. */
function judge(mentions: { kind: string; ref: string }[], target: Target, by: string, deps: ConversationDeps, source: string): Judged {
  const level = targetLevel(deps.repo, target, deps.store)
  const people = new People(deps.repo, deps.membership)
  const recorded = new Set(storeRead(deps.store, () => deps.store.mentionsOf(source)).map(m => `${m.kind} ${m.ref}`))
  const author = parseCaip10(by) ? String(actorIdOf(by, people.members)) : by
  const told = new Set<string>()
  const notTold = new Set<string>()
  const rows: MentionRow[] = []
  const seen = new Set<string>()
  const judgeMember = (id: string): boolean => {
    if (id === author || !people.member(id)) return false
    if (level && admits(level, people.viewer(id))) { told.add(id); return true }
    notTold.add(id)
    return false
  }
  for (const m of mentions) {
    const kind = KIND[m.kind]
    if (!kind || typeof m.ref !== 'string' || m.ref === '') continue
    const key = `${kind} ${m.ref}`
    if (seen.has(key) || recorded.has(key)) continue
    seen.add(key)
    let any = false
    if (kind === 'member') any = judgeMember(m.ref)
    else if (kind === 'role') {
      const role = people.roles().get(m.ref)
      if (role?.defined) for (const holder of role.members) any = judgeMember(holder) || any
    }
    rows.push({ source, kind, ref: m.ref, told: any })
  }
  for (const id of told) notTold.delete(id)
  const created = (deps.now ?? (() => new Date()))().toISOString()
  const notifications = [...told].sort().map((member): StoredNotification =>
    ({ id: newId('ntf'), member, kind: 'mention', target, source, by, created, readAt: null }))
  return { told: [...told].sort(), notTold: [...notTold].sort(), mentions: rows, notifications }
}

/**
 * Tells each mentioned member who may see `target` (§8.3), writing the mentions and the notifications in one store
 * transaction. `source` (`comment:<id>`, `page:<id>`; default the target) is where the mentions were made: a mention it
 * already made is not told again. Answers the members told and the handles of those who were not; a store that fails is
 * its 503 in L5's words.
 */
export async function tell(mentions: { kind: string; ref: string }[], target: Target, by: string, deps: ConversationDeps,
  source: string = target): Promise<{ told: string[]; notTold: string[] }> {
  const j = judge(mentions, target, by, deps, source)
  if (j.mentions.length > 0) {
    try { await deps.store.writeConversation({ mentions: j.mentions, notifications: j.notifications }) } catch (err) { throw unavailable(err, deps.store) }
  }
  return { told: j.told, notTold: j.notTold }
}

/**
 * An editing session's commit (EditSessions.onCommit, preflight row 43): the page's new mentions — those its text holds and
 * the session's base did not, and that the page has not told before — are told (§8.3). A git page's text is its whole file;
 * its mentions are read from the body.
 */
export async function tellAtCommit(page: string, text: string, ctx: { baseText: string; by: string }, deps: ConversationDeps): Promise<{ told: string[]; notTold: string[] }> {
  const where = levelsOf(deps.repo, deps.store).pages().get(page)?.where
  const body = (t: string) => (where === 'git' ? splitPage(t).body : t)
  const key = (m: { kind: string; ref: string }) => `${m.kind} ${m.ref}`
  const was = new Set(refsOf(body(ctx.baseText)).mentions.map(key))
  const fresh = refsOf(body(text)).mentions.filter(m => !was.has(key(m)))
  if (fresh.length === 0) return { told: [], notTold: [] }
  return tell(fresh, `page:${page}`, ctx.by, deps, `page:${page}`)
}

// ── what a viewer is shown (L4c's shapes, and more: ruling P-11) ─────────────────────────────────────

/** L4c's `Comment` (CommentThread), and: the author's id (`by`), the target, the parent replied to, the anchor as stored, an
 *  anchor whose quote is gone (`unanchored`), the deleted state, and when it was resolved. `resolved.by` is a handle. */
export interface Comment {
  id: string
  handle: string
  role: string
  at: string
  body: string
  state: 'sent'
  replies: Comment[]
  /** `role`: the resolver's name, as an author's is shown (Task 18 fix round 1). */
  resolved?: { by: string; at: string; role?: string }
  anchor?: { id: string; text: string; exact: string; prefix: string; suffix: string }
  /** Task 18 fix round 1: the task the comment was turned into (its id). */
  task?: string
  by: string
  target: Target
  parent: string | null
  unanchored?: { text: string; note: string }
  deleted?: { at: string; note: string }
  edited?: string
}

/** One comment as a viewer admitted to its target is shown it (§8.2). `text`: the target's text now; when given and the
 *  anchor's quote is not in it, the comment is shown unanchored with ANCHOR_CHANGED. A deleted comment shows no body. */
export function commentView(row: CommentRow, names: (id: string) => { handle: string; role: string }, text?: string): Comment {
  const who = names(row.by)
  const out: Comment = {
    id: row.id, handle: who.handle, role: who.role, at: row.created, body: row.deleted ? '' : row.body, state: 'sent', replies: [],
    by: row.by, target: row.target as Target, parent: row.parent,
  }
  if (row.resolvedBy && row.resolvedAt) { const r = names(row.resolvedBy); out.resolved = { by: r.handle, at: row.resolvedAt, role: r.role } }
  if (row.task) out.task = row.task
  if (row.edited) out.edited = row.edited
  if (row.deleted) out.deleted = { at: row.deleted, note: DELETED }
  else if (row.anchor) {
    const a = row.anchor
    const there = text === undefined || text.includes(`${a.prefix}${a.exact}${a.suffix}`) || text.includes(a.exact)
    if (there) out.anchor = { id: row.id, text: a.exact, exact: a.exact, prefix: a.prefix, suffix: a.suffix }
    else out.unanchored = { text: a.exact, note: ANCHOR_CHANGED }
  }
  return out
}

/** The thread of a target: its comments, oldest first, each with its replies (a reply to a reply sits under its root). */
function threadOf(rows: CommentRow[], names: (id: string) => { handle: string; role: string }, text: string): Comment[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const rootOf = (r: CommentRow): string => {
    const seen = new Set<string>()
    let at = r
    while (at.parent !== null && byId.has(at.parent) && !seen.has(at.id)) { seen.add(at.id); at = byId.get(at.parent)! }
    return at.id
  }
  const tops = new Map<string, Comment>()
  for (const r of rows) if (rootOf(r) === r.id) tops.set(r.id, commentView(r, names, text))
  for (const r of rows) {
    const root = rootOf(r)
    if (root !== r.id) tops.get(root)?.replies.push(commentView(r, names, text))
  }
  return [...tops.values()]
}

/** L4c's `Mentionable` (mentions.ts), and: a record's collection (`recordKind`, so the picker draws its glyph without
 *  parsing the id; L4c C3's carry) and the `href` the mention is written with in the Markdown (§5.2). */
export interface Mentionable {
  kind: 'person' | 'role' | 'record' | 'page'
  id: string
  label: string
  hat?: string
  count?: number
  canSee: boolean
  recordKind?: string
  href: string
}

/** How many pages, and how many records, one answer offers at most. */
export const MENTIONABLE_MAX = 20

const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * What an `@` may name on `target` (§8.3, L4 §10.4), for `query` (as L4c's `mentionables` matches it): members (their name,
 * the lowest hat they wear) and roles (how many hold them), each with `canSee` by the same test as `tell`; pages and records
 * only when the author may see them. A member who may not see the target is kept, after the rest, to be drawn disabled; a
 * role none of whose holders may see it is not offered. A record of a private collection is offered only on a target no
 * looser than that collection (§4.5); one the author may not see never. Nothing for a target the author may not see.
 */
export function mentionablesFor(target: Target, query: string, viewer: Viewer, deps: Omit<ConversationDeps, 'store'> & { store: PrivateStore | null }): Mentionable[] {
  if (viewer.kind !== 'member') return []
  const info = targetInfo(deps.repo, target, deps.store)
  if (!info || !admits(info.level, viewer)) return []
  const level = info.level
  const q = query.trim().replace(/^@/, '').trim().toLowerCase()
  const matches = (id: string, label: string) => q === '' || id.toLowerCase().startsWith(q) || label.toLowerCase().startsWith(q) || wordsOf(label).some(w => w.startsWith(q))
  const people = new People(deps.repo, deps.membership)

  const persons: Mentionable[] = []
  for (const m of people.members) {
    const id = String(m.id ?? '')
    if (id === '' || !['person', 'agent'].includes(String(memberKind(m)))) continue
    const label = typeof m.name === 'string' && m.name.trim() !== '' ? m.name : id
    if (!matches(id, label)) continue
    const hat = people.hat(id)
    persons.push({ kind: 'person', id, label, ...(hat ? { hat } : {}), canSee: admits(level, people.viewer(id)), href: `hub:member/${id}` })
  }
  const roles: Mentionable[] = []
  for (const r of people.roles().values()) {
    if (!r.defined || !matches(r.id, r.id)) continue
    if (!r.members.some(h => admits(level, people.viewer(h)))) continue
    roles.push({ kind: 'role', id: r.id, label: r.id, count: r.members.length, canSee: true, href: `hub:role/${r.id}` })
  }

  const levels = levelsOf(deps.repo, deps.store)
  const pages: Mentionable[] = []
  for (const e of levels.pages().values()) {
    if (pages.length >= MENTIONABLE_MAX) break
    if (!admits(levels.page(e.id) ?? NOBODY, viewer) || !matches(e.id, e.title)) continue
    pages.push({ kind: 'page', id: e.id, label: e.title || e.id, canSee: true, href: `./${e.id}.md` })
  }

  // A record is offered only when the author may see it and everyone the target admits may see it and its title (R-9b): its
  // label is its title, which the mention writes into the target's text.
  const records: Mentionable[] = []
  const offer = (registry: string, id: string, body: Record<string, unknown>, kept: ParsedLevel[]) => {
    if (!kept.every(l => admits(l, viewer) && narrowerOrEqual(level, l))) return
    const label = titleOf(body, id)
    if (records.length < MENTIONABLE_MAX && matches(id, label)) records.push({ kind: 'record', id: `${registry}:${id}`, label, canSee: true, recordKind: registry, href: `hub:record/${registry}/${id}` })
  }
  const titled = (registry: string, body: Record<string, unknown>) => ['title', 'name'].map(f => fullLevel(levels.config, registry, body, f))
  const git = gitNames(deps.repo)
  for (const def of registriesOf(deps.repo)) {
    if (def.kind !== 'collection' || def.name === 'members') continue
    for (const e of levels.records(def.name)) offer(def.name, String(e.id), e as Record<string, unknown>, [levels.record(def.name, e), ...titled(def.name, e as Record<string, unknown>)])
    for (const r of levels.priv.records(def.name)) offer(def.name, r.id, r.body, [levelOfToken(r.visibility), ...titled(def.name, r.body)])
  }
  for (const c of levels.priv.collections()) {
    if (git.has(c.id)) continue
    const kept = levelOfToken(c.visibility)
    for (const r of levels.priv.records(c.id)) offer(c.id, r.id, r.body, [kept, levelOfToken(r.visibility)])
  }

  const out = [...persons, ...roles, ...pages, ...records]
  return [...out.filter(m => m.canSee), ...out.filter(m => !m.canSee)]
}

/** One row of Needs you (§8.3; preflight row 46), with what the gate adds (`visibility`), the sentence it reads (`text`) and
 *  the mention's source (`comment:<id>`, `page:<id>`). */
export interface NotificationRow {
  id: string; kind: 'mention'; target: Target; title: string; by: { handle: string; role: string }; at: string; read: boolean
  text: string; source: string; visibility: string
}

/** `viewer`'s notifications, each re-judged against its target's level now (§8.3): one on something they may no longer see,
 *  or that is gone, is absent, and is not counted. */
export function notificationsFor(viewer: Viewer, deps: Omit<ConversationDeps, 'now'>): NotificationRow[] {
  if (viewer.kind !== 'member') return []
  const rows = storeRead(deps.store, () => deps.store.notifications(viewer.id))
  const infos = new Map<string, TargetInfo | null>()
  const infoOf = (t: string) => {
    if (!infos.has(t)) infos.set(t, parseTarget(t) ? targetInfo(deps.repo, t as Target, deps.store) : null)
    return infos.get(t) ?? null
  }
  const names = namesFor(deps.repo, deps.membership, viewer)
  const views = rows.flatMap(n => {
    const info = infoOf(n.target)
    if (!info) return []
    const by = names(n.by)
    return [{ id: n.id, kind: n.kind, target: n.target as Target, title: info.title, by, at: n.created, read: n.readAt !== null,
      text: `${by.role} mentioned you on ${info.title}`, source: n.source }]
  })
  return gateItems(viewer, views, v => infoOf(v.target)?.level ?? NOBODY)
}

// ── Turn into a task (§8.2) ──────────────────────────────────────────────────────────────────────────

/** A line of the dialect's inline subset as plain text (Task 18 fix round 1): a link or a mention is its label (a stricter
 *  page's or record's stays `↗`, as the guarded body wrote it), code and emphasis lose their marks. */
export function plainLine(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}*_])([*_])([^*_]+)\1(?![\p{L}\p{N}*_])/gu, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The fields a task links its target with: a page's `page`; a record's own reference field where tasks have one, else
 *  `record: <collection>:<id>`. */
function linkOf(t: Target): Record<string, string> {
  if (t.startsWith('page:')) return { page: t.slice('page:'.length) }
  const { registry, id } = recordOf(t)
  const field = ({ projects: 'project', meetings: 'meeting', proposals: 'proposal' } as Record<string, string>)[registry]
  return field ? { [field]: id } : { record: `${registry}:${id}` }
}

/**
 * Turn into a task (§8.2): a workspace write creating a task whose title is the comment's first line, linked to its target.
 * On a target git may hold, one commit (or staged where the rule is raised), at members at the loosest (M-5: never public
 * at once, whatever the target or the tasks' default); on a target
 * stricter than members, a private task in the store at the target's level, with an opaque id (`t-<12 hex>`, §4.5), and no
 * commit. The caller holds the write lock.
 */
export async function turnIntoTask(row: CommentRow, info: TargetInfo, actor: KnownActor, deps: ConversationDeps & { notify?: (msg: { type: 'changes' }) => void }):
  Promise<{ task: string; commit: string } | { task: string; staged: true } | { task: string; visibility: string }> {
  if (row.deleted) throw new HttpError(409, DELETED_NO_TASK, 'DELETED')
  if (row.task) throw new HttpError(409, TASK_ALREADY(row.task), 'TASKED')
  const title = plainLine(row.body.split('\n').map(l => l.trim()).find(l => l !== '') ?? '')
  const link = linkOf(row.target as Target)
  if (gitAllows(info.level)) {
    let taken: Set<string>
    try { taken = new Set(currentEntries(deps.repo, 'tasks').map(e => String(e.id))) } catch { taken = new Set() }
    const base = slugOf(title)
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    const value: Record<string, unknown> = { id, title, ...link }
    // The final review's M-5 (PF-R117): never public at once, a public target's too. The task takes members, the
    // comment's level; widening it is a publication like any other.
    if (fullLevel(readConfig(deps.repo), 'tasks', value).level === 'public') value.visibility = 'members'
    const out = await commitOrStage(deps.repo, actor, [{ op: 'create', record: `tasks:${id}`, value }], `tasks: ${title}`, deps.notify)
    return 'staged' in out ? { task: id, staged: true } : { task: id, commit: out.commit }
  }
  const id = `t-${randomBytes(6).toString('hex')}`
  const body = { title, ...link }
  const op: RecordOp = { op: 'create', record: `tasks:${id}`, value: { id, ...body } }
  mayWritePrivate(deps.repo, actor, targetsOfOps([op], deps.repo))
  const visibility = formatLevel(info.level)
  try { await deps.store.putRecord({ collection: 'tasks', id, visibility, body, rev: baseOf(body) ?? '' }, actor.id, null) } catch (err) { throw unavailable(err, deps.store) }
  return { task: id, visibility }
}

// ── routes (§16) ─────────────────────────────────────────────────────────────────────────────────────

export interface ConversationRoutesDeps {
  repo: string
  membership: Membership | null
  privateStore: PrivateAccess
  /** The repository's one write lock (Turn into a task writes git). */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after a write: `conversation` for the target (gated per connection, §8.5), `changes` after a staged task. */
  notify?: (msg: { type: 'conversation'; target: Target } | { type: 'changes' }) => void
  now?: () => Date
}

async function json(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const chars = (s: string) => [...s].length

export function mountConversation(app: Hono, deps: ConversationRoutesDeps): void {
  const { repo, membership } = deps
  const now = () => (deps.now ?? (() => new Date()))()
  const notify = (target: Target) => { try { deps.notify?.({ type: 'conversation', target }) } catch { /* the write stands */ } }
  /** R-9a: the tombstones of git targets deleted while the store was down, applied before any conversation is read. */
  const applyTombstones = async (store: PrivateStore) => {
    const list = tombstones(repo)
    if (list.length === 0) return
    try { await store.purgeConversation(list) } catch (err) { throw unavailable(err, store) }
    unbury(repo, list)
  }
  /** The store, or its 503 in L5's words: conversation is kept nowhere else. */
  const needStore = async (): Promise<PrivateStore> => {
    const { store, why } = reach(deps.privateStore)
    if (!store) throw unavailable(why)
    await applyTombstones(store)
    return store
  }
  // R-9a: a git page or record deleted takes its conversation with it; with the store down, a tombstone until it is back.
  onTargetsGone(repo, async (targets, at) => {
    const { store } = reach(deps.privateStore)
    if (!store) { bury(repo, targets, at); return }
    try {
      await applyTombstones(store)
      await store.purgeConversation(targets.map(target => ({ target, at })))
    } catch (err) {
      // Buried, they are taken the moment the store is reached again: the purge is done as far as its callers go (the
      // purge cursor moves on, R2b I-3). A tombstone that cannot be written throws.
      bury(repo, targets, at)
      console.error(`org-os admin: the private store could not take the conversation of ${targets.join(', ')} now (${err instanceof Error ? err.message : String(err)}); it goes when the store is reached again.`)
    }
  })
  const write = async (store: PrivateStore, w: Parameters<PrivateStore['writeConversation']>[0]) => {
    try { await store.writeConversation(w) } catch (err) { throw unavailable(err, store) }
  }
  /** A comment the viewer may see, with its target; else the 404 of one that is not there. */
  const visibleComment = (store: PrivateStore, id: string, viewer: Viewer): { row: CommentRow; info: TargetInfo } => {
    const row = storeRead(store, () => store.comment(id))
    const t = row ? parseTarget(row.target) : null
    if (!row || !t) throw new HttpError(404, NO_COMMENT(id))
    try { return { row, info: visibleTarget(repo, t, store, null, viewer) } } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new HttpError(404, NO_COMMENT(id))
      throw err
    }
  }
  const view = (store: PrivateStore, row: CommentRow, info: TargetInfo) => {
    const names = namesFor(repo, membership)
    const out = commentView(row, names, info.text)
    if (row.parent === null) {
      out.replies = storeRead(store, () => store.comments(row.target)).filter(r => r.parent === row.id).map(r => commentView(r, names, info.text))
    }
    return out
  }

  app.get('/api/comments', async c => {
    const target = parseTarget(c.req.query('target') ?? '')
    if (!target) throw new HttpError(400, TARGET_QUERY)
    const store = await needStore()
    const info = visibleTarget(repo, target, store, null, viewerOf(c))
    return c.json(threadOf(storeRead(store, () => store.comments(target)), namesFor(repo, membership, viewerOf(c)), info.text))
  })

  app.post('/api/comments', async c => {
    const raw = await json(c)
    const target = isObj(raw) && typeof raw.target === 'string' ? parseTarget(raw.target) : null
    const a = isObj(raw) ? raw.anchor : undefined
    if (!isObj(raw) || !target || typeof raw.body !== 'string' || (raw.parent !== undefined && raw.parent !== null && typeof raw.parent !== 'string')
      || (a !== undefined && a !== null && (!isObj(a) || typeof a.exact !== 'string' || (a.prefix !== undefined && typeof a.prefix !== 'string')
        || (a.suffix !== undefined && typeof a.suffix !== 'string')))) throw new HttpError(400, COMMENT_BODY)
    const text = raw.body
    if (chars(text) > COMMENT_MAX_CHARS) throw new HttpError(413, COMMENT_TOO_LONG(chars(text)), 'TOO_LONG')
    if (text.trim() === '') throw new HttpError(422, COMMENT_EMPTY, 'EMPTY')
    const anchor = isObj(a) ? { exact: a.exact as string, prefix: (a.prefix as string | undefined) ?? '', suffix: (a.suffix as string | undefined) ?? '' } : null
    if (anchor?.exact === '') throw new HttpError(400, COMMENT_BODY)
    if (anchor && [anchor.exact, anchor.prefix, anchor.suffix].some(p => chars(p) > ANCHOR_MAX_CHARS)) throw new HttpError(422, ANCHOR_TOO_LONG, 'ANCHOR')
    const actor = knownActorOf(c)
    const viewer = viewerOf(c)
    const store = await needStore()
    const info = visibleTarget(repo, target, store, null, viewer)
    let parent: string | null = null
    if (typeof raw.parent === 'string') {
      const p = visibleComment(store, raw.parent, viewer).row
      if (p.target !== target) throw new HttpError(422, NOT_ON_TARGET(p.id, target), 'NOT_ON_TARGET')
      parent = p.id
    }
    // §4.5 holds in a comment as in a page: a stricter page's title never shows here; a private collection's record cannot
    // be named from a looser target.
    const guarded = guardPageRefs(text, info.level, { repo, store })
    if (guarded.refused !== null) throw new Refusal(422, { code: 'CANNOT_LINK', error: guarded.refused })
    const row: CommentRow = {
      id: newId('cmt'), target, parent, anchor, by: actor.id, body: guarded.body, created: now().toISOString(),
      edited: null, resolvedBy: null, resolvedAt: null, deleted: null,
    }
    const cdeps: ConversationDeps = { repo, store, membership, now }
    const j = judge(refsOf(guarded.body).mentions, target, actor.id, cdeps, `comment:${row.id}`)
    await write(store, { comments: [row], mentions: j.mentions, notifications: j.notifications })
    notify(target)
    return c.json({ comment: commentView(row, namesFor(repo, membership), info.text), notTold: j.notTold.map(NOT_TOLD) }, 201)
  })

  const resolve = (resolved: boolean) => async (c: Context) => {
    const actor = knownActorOf(c)
    const store = await needStore()
    const { row, info } = visibleComment(store, c.req.param('id')!, viewerOf(c))
    const next: CommentRow = resolved ? { ...row, resolvedBy: actor.id, resolvedAt: now().toISOString() } : { ...row, resolvedBy: null, resolvedAt: null }
    await write(store, { comments: [next] })
    notify(row.target as Target)
    return c.json({ comment: view(store, next, info) })
  }
  app.post('/api/comments/:id/resolve', resolve(true))
  app.post('/api/comments/:id/reopen', resolve(false))

  app.delete('/api/comments/:id', async c => {
    const actor = knownActorOf(c)
    const store = await needStore()
    const { row, info } = visibleComment(store, c.req.param('id'), viewerOf(c))
    if (row.by !== actor.id) throw new HttpError(403, NOT_YOUR_COMMENT, 'NOT_YOURS')
    const next: CommentRow = { ...row, body: '', anchor: null, deleted: row.deleted ?? now().toISOString() }
    await write(store, { comments: [next], dropSources: [`comment:${row.id}`] })
    notify(row.target as Target)
    return c.json({ comment: view(store, next, info) })
  })

  app.post('/api/comments/:id/task', async c => {
    const actor = knownActorOf(c)
    const viewer = viewerOf(c)
    return deps.withLock(async () => {
      const store = await needStore()
      const { row, info } = visibleComment(store, c.req.param('id'), viewer)
      const out = await turnIntoTask(row, info, actor, { repo, store, membership, now, notify: msg => deps.notify?.(msg) })
      // Task 18 fix round 1: the comment keeps the task it became, so everyone admitted sees it and it is not made twice.
      await write(store, { comments: [{ ...row, task: out.task }] })
      notify(row.target as Target)
      return c.json(out, 201)
    })
  })

  app.get('/api/mentionables', c => {
    const target = parseTarget(c.req.query('target') ?? '')
    if (!target) throw new HttpError(400, TARGET_QUERY)
    const viewer = viewerOf(c)
    const { store, why } = reach(deps.privateStore)
    visibleTarget(repo, target, store, why, viewer)
    return c.json(mentionablesFor(target, c.req.query('q') ?? '', viewer, { repo, store, membership, now }))
  })

  app.get('/api/notifications', async c => c.json(notificationsFor(viewerOf(c), { repo, store: await needStore(), membership })))

  app.post('/api/notifications/read', async c => {
    const raw = await json(c)
    const ids = isObj(raw) && Array.isArray(raw.ids) && raw.ids.every(i => typeof i === 'string') ? raw.ids as string[] : null
    const target = isObj(raw) && typeof raw.target === 'string' ? parseTarget(raw.target) : null
    if (!ids && !target) throw new HttpError(400, READ_BODY)
    const viewer = viewerOf(c)
    const store = await needStore()
    // Only the rows the viewer may see now are marked or counted (rule 7).
    const visible = notificationsFor(viewer, { repo, store, membership }).filter(n => (ids ? ids.includes(n.id) : n.target === target))
    if (viewer.kind !== 'member' || visible.length === 0) return c.json({ read: 0 })
    let read: number
    try { read = await store.markNotificationsRead(viewer.id, now().toISOString(), { ids: visible.map(n => n.id) }) } catch (err) { throw unavailable(err, store) }
    return c.json({ read })
  })

  app.post('/api/reads', async c => {
    const raw = await json(c)
    const target = isObj(raw) && typeof raw.target === 'string' ? parseTarget(raw.target) : null
    if (!target) throw new HttpError(400, READ_BODY)
    const viewer = viewerOf(c)
    const store = await needStore()
    visibleTarget(repo, target, store, null, viewer)
    if (viewer.kind !== 'member') throw new HttpError(404, NO_TARGET(target))
    const at = now().toISOString()
    let read: number
    try {
      await store.putRead(viewer.id, target, at)
      // §8.3: opening the target marks its rows read.
      read = await store.markNotificationsRead(viewer.id, at, { target })
    } catch (err) { throw unavailable(err, store) }
    return c.json({ target, at, read })
  })
}
