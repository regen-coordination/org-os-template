// packages/admin/server/workspace/memory.ts
//
// Council memory (DAO-OS L6 spec §14, Q76; §16 `POST /api/memory`): the agent layer's memory split by visibility. *Org
// memory* stays memory/<date>.md in git (members), written by the session and committed at its close; *Council memory*
// is the private collection `council-memory` in the store, written only through the running Hub so the gate applies: made
// on first use at the level its first entry gives (e.g. `hat:<steward hat>`), one record per entry { date, session,
// title, body }, id `<date>-<n>`.
//
//   POST /api/memory  { level, date, title, body, session? }   201 { id, collection, visibility }; members → 409
//   GET  /api/memory?date=<date>                                the entries of that day the viewer may read
//
// Rule 7 (invisible means absent): a viewer the collection does not admit is answered no entry, and a writer it does not
// admit is never told its level. Every entry is kept at the collection's level (R-L6-T15-3), so whoever reads the
// collection reads every entry of it and an entry's number counts nothing they may not see. A raised workspace rule is
// judged at the write's targets before anything is written (PF-R21, PF-R33): the entry at `workspace:council-memory` and
// at the agent layer's `workspace:agent` (R-L6-T15-2), the collection's first making at `workspace:collections`; it is
// refused, never staged (the store keeps no staged entry). Nothing of it reaches git. It is never kept at a level every
// member reads (a role written `all: true`), whoever writes first, and a LEVEL refusal invites a wider level only to an
// entry already wider than the collection's (Task 15 review I-2).

import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { Refusal } from '../changes/apply.ts'
import { newChangeId } from '../changes/store.ts'
import { effectiveRule, readRuleContext } from '../governance/effective.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { gitNames, reach, registryOf, unavailable, type PrivateAccess, type StagedPrivateOp } from '../private/ops.ts'
import { COUNCIL_MEMORY } from '../private/targets.ts'
import { levelOfToken } from '../private/reads.ts'
import type { PrivateRecord, PrivateStore } from '../private/store.ts'
import type { KnownActor } from '../actor.ts'
import { admits, formatLevel, gitAllows, narrowerOrEqual, parseLevel, type ParsedLevel } from '../../lib/visibility.mjs'
import { AGENT_TARGETS, recordTargets } from '../../lib/workspace/targets.mjs'
import { PAGE_MAX_BYTES } from '../../lib/workspace/pages.mjs'

export { COUNCIL_MEMORY }
/** Its definition, made with it: one record per entry. */
const DEFINITION = {
  name: 'Council memory',
  fields: [
    { id: 'date', type: 'date' },
    { id: 'session', type: 'text' },
    { id: 'title', type: 'text' },
    { id: 'body', type: 'longtext' },
  ],
}
export const TITLE_MAX_CHARS = 200
export const SESSION_MAX_CHARS = 200

// Copy. §16 gives the members sentence; the rest are this task's (R-L6-T15-1..4).
export const MEMORY_IN_GIT = (date: string): string => `Org memory is written in memory/${date}.md, in the repository: write it there.`
export const NEVER_PUBLIC = (date: string): string =>
  `Council memory is never public: org memory is written in memory/${date}.md, in the repository, and published by a decision. Nothing was written.`
export const KEPT_AT = (level: string): string => `Council memory is kept at ${level}: write its entries at that level. Nothing was written.`
/** Task 15 review I-2: an entry stricter than the collection, or not ordered with it, is never told to widen. */
export const NOT_KEPT_HERE = (level: string): string =>
  `Council memory cannot keep this entry at ${level}, and nothing was written: keep it out of memory/ and ask a steward where it should be kept.`
/** Task 15 review I-2: the first writer never fixes a level every member reads. */
export const EVERY_MEMBER = (level: string): string =>
  `Council memory is never kept at a level every member reads, and ${level} is one: what every member may read is org memory, written in memory/ in the repository. Nothing was written.`
export const NOT_ADMITTED_TO_IT = 'Council memory is kept at a level you are not admitted to, so you cannot write it here. Nothing was written.'
export const NOT_ADMITTED_LEVEL = (level: string): string =>
  `A Council memory entry would be kept at ${level}, which you are not admitted to, so you cannot write it here. Nothing was written.`
export const IN_GIT = `${COUNCIL_MEMORY} names a collection in the repository, so Council memory cannot be kept there: rename that collection first. Nothing was written.`
export const RAISED = (sentence: string): string => `Council memory is written at once or not at all, and here ${sentence} Nothing was written.`
const BODY = 'The body must be {"level": "hat:<hat ref>" or "role:<role id>", "date": "YYYY-MM-DD", "title", "body", "session"?}.'
const NOT_A_LEVEL = (token: string) => `${token} is not a level: hat:<hat ref> or role:<role id>. Nothing was written.`
const NOT_A_DATE = (v: string) => `${v} is not a date: write it as YYYY-MM-DD. Nothing was written.`
const TOO_BIG = (n: number) => `A Council memory entry is at most ${PAGE_MAX_BYTES} bytes, as a page is, and this one is ${n}. Nothing was written.`

export interface MemoryDeps {
  repo: string
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  privateStore: PrivateAccess
}

export interface MemoryEntry { id: string; date: string; session: string | null; title: string; body: string; visibility: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A real day, as YYYY-MM-DD. */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

interface Asked { level: string; date: string; title: string; body: string; session: string | null }

/** The body, checked; refusals in words before anything is read or written. */
function asked(raw: unknown): Asked {
  if (!isObj(raw)) throw new HttpError(400, BODY)
  const { level, date, title, body, session } = raw
  if (typeof level !== 'string' || level === '') throw new HttpError(400, BODY)
  if (!isDay(date)) throw new HttpError(400, typeof date === 'string' ? NOT_A_DATE(date) : BODY)
  if (level === 'members') throw new Refusal(409, { code: 'IN_GIT_MEMORY', error: MEMORY_IN_GIT(date) })
  if (level === 'public') throw new Refusal(409, { code: 'NEVER_PUBLIC', error: NEVER_PUBLIC(date) })
  const l = parseLevel(level)
  if (!l || gitAllows(l)) throw new HttpError(400, NOT_A_LEVEL(level))
  if (typeof title !== 'string' || title.trim() === '' || title.length > TITLE_MAX_CHARS || /[\r\n]/.test(title)) {
    throw new HttpError(400, `A title is one line of text, 1 to ${TITLE_MAX_CHARS} characters. Nothing was written.`)
  }
  if (typeof body !== 'string') throw new HttpError(400, BODY)
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > PAGE_MAX_BYTES) throw new HttpError(413, TOO_BIG(bytes), 'TOO_BIG')
  if (session !== undefined && session !== null && (typeof session !== 'string' || session.length > SESSION_MAX_CHARS)) {
    throw new HttpError(400, `A session is text of at most ${SESSION_MAX_CHARS} characters. Nothing was written.`)
  }
  return { level: formatLevel(l), date, title: title.trim(), body, session: typeof session === 'string' && session !== '' ? session : null }
}

/** The store, or its 503 in L5's words. */
function storeOf(access: PrivateAccess): PrivateStore {
  const { store, why } = reach(access)
  if (!store) throw unavailable(why)
  return store
}

/** A read of the store, its failure answered as the store's (503). */
function read<T>(store: PrivateStore, fn: () => T): T {
  try { return fn() } catch (err) { throw unavailable(err, store) }
}

/** Refused unless the instance's rules let `actor` write `targets` at once (§3.2; PF-R21, PF-R33). */
function mayWriteAtOnce(repo: string, actor: KnownActor, targets: string[][]): void {
  const rule = effectiveRule(readRuleContext(repo, actor), ['workspace'], targets)
  if (!rule.direct) throw new Refusal(403, { code: 'RAISED', reason: rule.sentence, error: RAISED(rule.sentence) })
}

/** An entry at `asked` where the collection is kept at `kept`: refused 409 `LEVEL` unless they are one level. Only an
 *  entry wider than the collection is told to write at its level; a stricter one, or one not ordered with it, is never
 *  invited to widen (Task 15 review I-2). */
function refuseLevel(asked: string, kept: string): void {
  const a = levelOfToken(asked)
  const k = levelOfToken(kept)
  if (formatLevel(a) === formatLevel(k)) return
  throw new Refusal(409, { code: 'LEVEL', error: narrowerOrEqual(k, a) ? KEPT_AT(kept) : NOT_KEPT_HERE(asked) })
}

/** Does `token` admit every member (`members`, `public`, or a role written `all: true`)? Council memory is never kept there. */
function everyMemberReads(repo: string, token: string): boolean {
  const l = levelOfToken(token)
  if (l.level === 'public' || l.level === 'members') return true
  if (l.level !== 'role') return false
  const roles = readRuleContext(repo, { unknown: '' }).governance?.roles
  const role = isObj(roles) ? roles[l.role] : undefined
  return isObj(role) && role.all === true
}

/** Refused 409 `EVERY_MEMBER` when `token` admits every member. */
function refuseEveryMember(repo: string, token: string): void {
  if (everyMemberReads(repo, token)) throw new Refusal(409, { code: 'EVERY_MEMBER', error: EVERY_MEMBER(token) })
}

/** Council memory refused in a proposal: it is written at once or not at all (R-L6-T15-2). */
export const NOT_PROPOSED = 'Council memory is written at once or not at all, so it is never proposed: take it out of this change. Nothing was written.'

/**
 * Task 15 review I-1: a Council entry written by any route other than POST /api/memory (the records route, the tray, an
 * apply of what the tray holds) is judged as that route judges it: at once or refused 403 `RAISED`, at the entry's targets
 * and the agent layer's, never staged; and at the collection's level, any other being the route's `LEVEL` refusal, so an
 * entry's `<date>-<n>` never counts one a reader of the collection cannot see. `ops` are a write's private part, split for
 * a viewer the collection admits (one it does not admit never reaches here: its ops name no collection to them).
 */
export function guardCouncilMemory(repo: string, actor: KnownActor, store: PrivateStore | null, ops: readonly StagedPrivateOp[]): void {
  const council = ops.filter(op => registryOf(op) === COUNCIL_MEMORY)
  if (council.length === 0) return
  mayWriteAtOnce(repo, actor, [recordTargets(COUNCIL_MEMORY), [...AGENT_TARGETS]])
  if (!store) return
  const held = read(store, () => store.collections()).find(p => p.id === COUNCIL_MEMORY)
  if (!held) return
  refuseEveryMember(repo, held.visibility)
  for (const op of council) {
    const asked = 'visibility' in op && typeof op.visibility === 'string' ? op.visibility : null
    if (asked === null || op.op === 'move-to-git') continue
    refuseEveryMember(repo, asked)
    refuseLevel(asked, held.visibility)
  }
}

/** Task 20 review I4 (PF-R99): a narrowing never moves one Council entry off its collection's level. */
export const ENTRY_KEEPS_LEVEL = "A Council memory entry keeps its collection's level, so it is never narrowed alone. Nothing was written."

/** POST /api/visibility/narrow on a Council entry (I4, PF-R99): judged as any write of one is (at once, at the entry's
 *  targets and the agent layer's: 403 `RAISED`), then refused 409 `LEVEL`, as an entry at another level is (PF-R60).
 *  The caller has already answered a viewer the collection does not admit as it answers one for a record not there. */
export function refuseCouncilNarrow(repo: string, actor: KnownActor, registry: string): void {
  if (registry !== COUNCIL_MEMORY) return
  mayWriteAtOnce(repo, actor, [recordTargets(COUNCIL_MEMORY), [...AGENT_TARGETS]])
  throw new Refusal(409, { code: 'LEVEL', error: ENTRY_KEEPS_LEVEL })
}

/** What narrowing Council memory's collection is told when an entry is kept apart at a level the new one does not narrow
 *  (L6 carries K2): moving it would widen it, leaving it it would leave it wider than the collection. */
export const COLLECTION_ENTRIES_STAY = "An entry of Council memory is kept at a level this one does not narrow, so it cannot move with " +
  "the collection, and it would be left wider than the collection. Nothing was written."

/** POST /api/visibility/narrow on Council memory's collection (L6 carries K2): judged as any write of an entry is (at once,
 *  at the collection's targets and the agent layer's: 403 `RAISED`, PF-R68, PF-R99). */
export function judgeCouncilCollectionNarrow(repo: string, actor: KnownActor, collection: string): void {
  if (collection !== COUNCIL_MEMORY) return
  mayWriteAtOnce(repo, actor, [recordTargets(COUNCIL_MEMORY), [...AGENT_TARGETS]])
}

/** The entries a narrowing of Council memory to `next` moves with the collection (L6 carries K2, PF-R60's one level): every
 *  entry not already there, each at `next`. Refused 409 `LEVEL` when an entry is at a level `next` does not narrow. */
export function councilEntriesMoved(records: readonly PrivateRecord[], next: ParsedLevel): PrivateRecord[] {
  if (records.some(r => !narrowerOrEqual(next, levelOfToken(r.visibility)))) {
    throw new Refusal(409, { code: 'LEVEL', error: COLLECTION_ENTRIES_STAY })
  }
  const token = formatLevel(next)
  return records.filter(r => r.visibility !== token).map(r => ({ ...r, visibility: token }))
}

/** A proposal (or a revision) holding a Council entry is refused: it is written at once or not at all. */
export function refuseCouncilProposed(ops: readonly StagedPrivateOp[]): void {
  if (ops.some(op => registryOf(op) === COUNCIL_MEMORY)) throw new Refusal(403, { code: 'RAISED', error: NOT_PROPOSED })
}

const asEntry = (r: PrivateRecord): MemoryEntry => ({
  id: r.id,
  date: String(r.body.date ?? ''),
  session: typeof r.body.session === 'string' ? r.body.session : null,
  title: String(r.body.title ?? ''),
  body: String(r.body.body ?? ''),
  visibility: r.visibility,
})

/** The next entry's number on `date`: one past the highest the collection holds (every entry is at its level). */
function nextId(store: PrivateStore, date: string): string {
  const prefix = `${date}-`
  let n = 0
  for (const r of read(store, () => store.records(COUNCIL_MEMORY))) {
    if (!r.id.startsWith(prefix)) continue
    const k = Number(r.id.slice(prefix.length))
    if (Number.isInteger(k) && k > n) n = k
  }
  return `${prefix}${n + 1}`
}

async function bodyOf(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}

export function mountMemory(app: Hono, deps: MemoryDeps): void {
  const { repo, withLock, privateStore } = deps

  app.post('/api/memory', async c => {
    const entry = asked(await bodyOf(c))
    return withLock(async () => {
      const actor = knownActorOf(c)
      const viewer = viewerOf(c)
      if (gitNames(repo).has(COUNCIL_MEMORY)) throw new Refusal(409, { code: 'IN_GIT', error: IN_GIT })
      const store = storeOf(privateStore)
      const held = read(store, () => store.collections()).find(p => p.id === COUNCIL_MEMORY) ?? null
      if (held) {
        // Rule 7: the collection's level is named only to someone it admits.
        if (!admits(levelOfToken(held.visibility), viewer)) throw new Refusal(403, { code: 'NOT_ADMITTED', error: NOT_ADMITTED_TO_IT })
        if (!admits(levelOfToken(entry.level), viewer)) throw new Refusal(403, { code: 'NOT_ADMITTED', error: NOT_ADMITTED_LEVEL(entry.level) })
        // Never at a level every member reads, whoever wrote first (Task 15 review I-2).
        refuseEveryMember(repo, entry.level)
        refuseEveryMember(repo, held.visibility)
        refuseLevel(entry.level, held.visibility)
      } else if (!admits(levelOfToken(entry.level), viewer)) {
        throw new Refusal(403, { code: 'NOT_ADMITTED', error: NOT_ADMITTED_LEVEL(entry.level) })
      }
      // The first writer never fixes a level every member reads (Task 15 review I-2).
      if (!held) refuseEveryMember(repo, entry.level)
      // Judged at its targets, every one at once (PF-R21, PF-R33): the entry, the agent layer, and a first making.
      mayWriteAtOnce(repo, actor, [recordTargets(COUNCIL_MEMORY), [...AGENT_TARGETS], ...(held ? [] : [recordTargets('collections')])])
      const id = nextId(store, entry.date)
      const record: PrivateRecord = {
        collection: COUNCIL_MEMORY, id, visibility: entry.level, rev: '',
        body: { date: entry.date, session: entry.session, title: entry.title, body: entry.body },
      }
      const change = newChangeId()
      try {
        await store.tx(w => {
          if (!held) w.putCollection({ id: COUNCIL_MEMORY, visibility: entry.level, definition: DEFINITION }, actor.id)
          w.putRecord(record, actor.id, change)
        })
      } catch (err) { throw unavailable(err, store) }
      return c.json({ id, collection: COUNCIL_MEMORY, visibility: entry.level }, 201)
    })
  })

  app.get('/api/memory', c => {
    const date = c.req.query('date')
    if (date !== undefined && !isDay(date)) throw new HttpError(400, NOT_A_DATE(date))
    const viewer = viewerOf(c)
    const store = storeOf(privateStore)
    const held = read(store, () => store.collections()).find(p => p.id === COUNCIL_MEMORY)
    // Invisible means absent: a collection the viewer may not read answers no entry, as one that is not there.
    if (!held || gitNames(repo).has(COUNCIL_MEMORY) || !admits(levelOfToken(held.visibility), viewer)) return c.json({ entries: [] })
    const entries = read(store, () => store.records(COUNCIL_MEMORY))
      .filter(r => admits(levelOfToken(r.visibility), viewer))
      .map(asEntry)
      .filter(e => date === undefined || e.date === date)
      .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id.slice(11)) - Number(b.id.slice(11)))
    return c.json({ entries })
  })
}
