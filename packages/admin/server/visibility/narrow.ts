// packages/admin/server/visibility/narrow.ts
//
// Narrowing (L5 spec §9.7, §13 `POST /api/visibility/narrow`, C-14): it applies at once, under the named rule
// `visibility/narrow` (outside data/governance.yaml, like the owner's claim), by anyone who may write the thing and is
// admitted to the new level. A narrowing to `members` stays in git (a record's own `visibility`, a collection's level, a
// field's level). A narrowing stricter than members takes what it narrows out of git in the same act: removed from the
// YAML in one commit (`Org-Rule: visibility/narrow`) and written to the private store in one transaction around it
// (§10.3's order). The proposals that wrote it hold it as placeholders from then on (R-L5-10.7), the open ones with their
// private part in `pending`. Earlier history is not rewritten; the confirmation says so (`LEAVES_GIT`).
//
// What can be narrowed (R-L5-16.1): one record (`{ registry, id }`), a git collection's level to members
// (`{ collection }`), a private collection (`{ collection }`), and a git collection's field (`{ collection, field }`).
// A field has one level for every record of its collection (§9.2), so `{ registry, id, field }` is refused.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, Scalar } from 'yaml'
import { HttpError } from '../errors.ts'
import { actorTrailer, commitIdent, type KnownActor } from '../actor.ts'
import { commitDataPaths, restageDataPaths } from '../git.ts'
import { REGISTRIES } from '../registries.ts'
import { deletedText, entriesFromText, updatedText } from '../registry.ts'
import { referrers } from '../schema.ts'
import { guardFiles, Refusal } from '../changes/apply.ts'
import { baseOf } from '../changes/canonical.ts'
import { currentEntries, named } from '../changes/stage.ts'
import { assertGitSafe, type GitFile } from '../private/guard.ts'
import {
  aroundGit, noCollection, noRecord, reach, STORE_FAILED, unavailable, type PrivateAccess, type StagedPrivateOp,
} from '../private/ops.ts'
import { pendingPart } from '../private/proposals.ts'
import { levelOfToken } from '../private/reads.ts'
import type { PendingRow, PrivateField, PrivateStore, PrivateWriter, StagedRow } from '../private/store.ts'
import { readConfig } from './config.ts'
import { mayWrite, readRuleContext } from '../governance/effective.ts'
import {
  admits, formatLevel, fullLevel, gitAllows, narrowerOrEqual, parseLevel, readFullPolicy, type ParsedLevel, type Viewer, type VisibilityPolicy,
} from '../../lib/visibility.mjs'
import { CARRIED_EVENTS, governanceNamesOf, LEAVES_GIT, NARROW_RULE, narrowSubject, referrersInWords, ROSTER, substituteOps, takenOutOfGit, WIDENS, withoutFields } from '../../lib/narrow.mjs'
import { readGovernance } from '../../lib/governance-read.mjs'
import { canonicalJson, revOf, type Proposal } from '../../lib/proposals.mjs'

export { LEAVES_GIT, NARROW_RULE, ROSTER, WIDENS }

/** What a narrowing names (R-L5-16.1). */
export type NarrowTarget = { registry: string; id: string; field?: string } | { collection: string; field?: string }
export interface NarrowInput { target: NarrowTarget; level: string }
/** Who narrows, besides the actor: the viewer the act was judged with (hats read now, §5.2), and the store. */
export interface NarrowDeps { viewer: Viewer; privateStore: PrivateAccess; now?: () => Date }
/** §13's answer. `moved`: something left git (the client confirmed it with `LEAVES_GIT` before it asked). */
export interface NarrowResult { commit: string; moved: boolean }

const VISIBILITY = 'data/visibility.yaml'
const LEDGER = 'data/proposals.yaml'
const KNOWN = new Set(REGISTRIES.map(r => r.name))
const COLLECTIONS = new Set(REGISTRIES.filter(r => r.kind === 'collection' && !r.ledger).map(r => r.name))
const NOTHING = 'Nothing was written.'
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const held = (v: unknown) => v !== undefined && v !== null
const omit = (v: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== key))

const SHAPE = 'The body must be {"target": {"registry": "<registry>", "id": "<id>"} or {"collection": "<collection>"} or ' +
  '{"collection": "<collection>", "field": "<field>"}, "level": "members", "hat:<hat ref>" or "role:<role id>"}.'
/** A field has one level for every record of its collection (§9.2). */
export const fieldOfRecord = (registry: string, field: string) =>
  `${field} has one level for every record of ${registry}, kept in data/visibility.yaml: narrow it for the whole collection instead. ${NOTHING}`
/** A git collection's level is public or members (§9.2, rule 7). */
export const COLLECTION_IN_GIT = `A collection in the repository is public or members: narrow its records or its fields instead. ${NOTHING}`
export const notAdmitted = (level: string) =>
  `You are not admitted to ${level}, so you cannot narrow anything to it: you could no longer read it yourself. ${NOTHING}`
/** Q77: a narrowing is a write, by whoever the rule for the thing's class lets apply or propose it. */
export const mayNotNarrow = (registry: string, why: string) => `You cannot change ${registry}, so you cannot narrow it: ${why} ${NOTHING}`
export const unchanged = (level: string) => `It is already ${level}: there is nothing to narrow. ${NOTHING}`
const referred = (registry: string, id: string, refs: { registry: string; id: string; field: string }[]) =>
  `${registry} "${id}" is named by ${referrersInWords(refs)} ` +
  `in the repository, so it cannot leave it. ${NOTHING} Change or remove ${refs.length === 1 ? 'that reference' : 'those references'} first, then narrow it.`
const conflict = (registry: string, id: string) =>
  `The private store already keeps a record ${id} of ${registry}, so this one cannot be moved there. ${NOTHING}`
const noId = (registry: string, n: number, field: string) =>
  `Entry #${n} of data/${registry}.yaml holds ${field} and has no id, so its value cannot be moved out of the repository: give it an id in the file first. ${NOTHING}`

/** The body of POST /api/visibility/narrow, or a 400 that says what it must be (a 422 for a record's field). */
export function readNarrowBody(body: unknown): NarrowInput {
  const bad = new HttpError(400, SHAPE)
  if (!isObj(body) || !isObj(body.target) || typeof body.level !== 'string') throw bad
  if (parseLevel(body.level) === null) throw new HttpError(400, `"${body.level}" is not a level: members, hat:<hat ref> or role:<role id>. ${SHAPE}`)
  const t = body.target
  const str = (v: unknown) => typeof v === 'string' && v !== ''
  if (str(t.registry) && str(t.id) && t.collection === undefined) {
    if (t.field !== undefined) {
      if (!str(t.field)) throw bad
      throw new Refusal(422, { code: 'FIELD_OF_COLLECTION', error: fieldOfRecord(String(t.registry), String(t.field)) })
    }
    return { target: { registry: String(t.registry), id: String(t.id) }, level: body.level }
  }
  if (str(t.collection) && t.registry === undefined && t.id === undefined) {
    if (t.field !== undefined && !str(t.field)) throw bad
    return { target: { collection: String(t.collection), ...(t.field !== undefined ? { field: String(t.field) } : {}) }, level: body.level }
  }
  throw bad
}

/** One file the narrowing writes: its bytes before (null: none yet) and its text after. */
interface FileWrite { rel: string; before: Buffer | null; text: string }

/** What one narrowing does, worked out before anything is written. */
interface Plan {
  subject: string
  files: FileWrite[]
  moved: boolean
  /** The store's writes, before the git commit (null: the store is not written). */
  before: ((w: PrivateWriter) => void) | null
  /** The store's writes that need the commit (the `applied` mark of a ratified proposal whose ops were substituted). */
  after?: (w: PrivateWriter, commit: string) => void
  /** The policy the files are judged by (data/visibility.yaml as the narrowing leaves it). */
  policy: VisibilityPolicy
}

/** Refuses a move from `cur` to `next` that is not a narrowing (409 `WIDENS`), and one that changes nothing and moves
 *  nothing out of git (409 `UNCHANGED`). Equal levels pass when something is still to leave git (legacy values, R-L5-16.2). */
function judgeMove(cur: ParsedLevel, next: ParsedLevel, movesSomething: boolean): void {
  if (!narrowerOrEqual(next, cur)) throw new Refusal(409, { code: 'WIDENS', error: WIDENS })
  if (narrowerOrEqual(cur, next) && !movesSomething) throw new Refusal(409, { code: 'UNCHANGED', error: unchanged(formatLevel(next)) })
}

/** The actor must still read what they narrow (§9.7: "admitted to the new level"). */
function judgeAdmitted(next: ParsedLevel, viewer: Viewer): void {
  if (!admits(next, viewer)) throw new Refusal(403, { code: 'NOT_ADMITTED', error: notAdmitted(formatLevel(next)) })
}

const fileOf = (repo: string, rel: string): FileWrite & { src: string } => {
  const path = join(repo, rel)
  const before = existsSync(path) ? readFileSync(path) : null
  return { rel, before, text: before ? before.toString('utf8') : '', src: before ? before.toString('utf8') : '' }
}

/** data/visibility.yaml with one level set: a collection's (its `level`, or `default` when that is the key it has) or one
 *  of its fields'. Comments and the rest of the file are kept (the yaml Document). */
function policyText(src: string, collection: string, field: string | undefined, level: string): string {
  const doc = parseDocument(src === '' ? 'visibility:\n  collections: {}\n' : src)
  const top = isObj(doc.toJS()) && (doc.toJS() as Record<string, unknown>).visibility !== undefined ? ['visibility'] : []
  const at = [...top, 'collections', collection]
  const value = new Scalar(level)
  value.type = 'QUOTE_DOUBLE'
  if (field !== undefined) doc.setIn([...at, 'fields', field], value)
  else doc.setIn([...at, doc.hasIn([...at, 'default']) && !doc.hasIn([...at, 'level']) ? 'default' : 'level'], value)
  return doc.toString({ flowCollectionPadding: false, lineWidth: 0 })
}

/** The store's rows at a level `next` narrows, put at `next`; the others (already within it, or not ordered with it) are
 *  kept, so no value is ever re-levelled wider (R-L5-16.4). */
function relevel(w: PrivateWriter, rows: readonly PrivateField[], next: ParsedLevel, by: string): void {
  const token = formatLevel(next)
  for (const r of rows) {
    if (r.visibility !== token && narrowerOrEqual(next, levelOfToken(r.visibility))) w.putField({ ...r, visibility: token }, by, null)
  }
}

/** The staged field ops (§10.2 `staged`) `match` names, put at `next` where it narrows their level, so their apply judges
 *  the stager against the new level and writes at it (R-L5-16.4). */
function relevelStaged(w: PrivateWriter, rows: readonly StagedRow[], match: (registry: string, record: string, field: string) => boolean, next: ParsedLevel): void {
  const token = formatLevel(next)
  for (const row of rows) {
    const op = row.op as StagedPrivateOp
    if (op.op !== 'put-field' && op.op !== 'delete-field') continue
    const f = op.op === 'put-field' ? op.field : op
    const at = op.op === 'put-field' ? op.field.visibility : op.visibility
    if (!match(f.registry, f.record, f.field)) continue
    if (at !== undefined && (at === token || !narrowerOrEqual(next, levelOfToken(at)))) continue
    const moved: StagedPrivateOp = op.op === 'put-field' ? { ...op, field: { ...op.field, visibility: token } } : { ...op, visibility: token }
    w.putStaged({ ...row, op: moved })
  }
}

/** What stays in git of one ledger op, and what moves, for a narrowing. Null: the op is left as it is. */
type Take = (op: Record<string, unknown>, open: boolean) => { keep: Record<string, unknown> | null; moved: StagedPrivateOp[] } | null

/**
 * The ledger with every proposal's ops that `take` moves something from rewritten (R-L5-10.7, §9.6): the moved ops as
 * placeholders after its own, its `rev` the rev of its ops. An open proposal's private part goes to `pending`; a closed
 * one's is decided and kept nowhere new (its values stay in the history, C-14), a ratified one marked `applied`, so the
 * next start does not apply it again. The ops each `revise` event recorded are rewritten the same way (final review
 * MF-2, R-L5-final.2): the revision the proposal holds now gets the proposal's new ops and rev, placeholders included; an
 * earlier one gets placeholders of its own, kept nowhere new (that revision is no longer proposed; C-14). Null when no
 * proposal changes.
 */
function ledgerPlan(repo: string, take: Take): { file: FileWrite; rows: PendingRow[]; ratified: string[] } | null {
  const f = fileOf(repo, LEDGER)
  if (f.before === null) return null
  let text = f.src
  const rows: PendingRow[] = []
  const ratified: string[] = []
  for (const p of entriesFromText(f.src, 'proposals') as unknown as Proposal[]) {
    const id = String(p.id)
    const open = p.state === 'open'
    const held = (p.ops ?? []) as unknown as Record<string, unknown>[]
    const sub = substituteOps(held, op => take(op, open))
    const part = sub ? pendingPart(id, sub.moved as StagedPrivateOp[]) : null
    const ops = sub && part ? [...sub.git, ...sub.held, ...part.placeholders] : held
    const rev = sub ? revOf(ops) : p.rev
    let revised = false
    // A substitution is no revision (R-L5-16.6): what was said of the proposal on its old rev is carried to the new one, so
    // its approvals and ballots keep counting, its objections stay open, and its window is not restarted. A revise event's
    // ops hold what that revision wrote, in clear: what leaves git leaves them too (MF-2).
    const events = (p.events ?? []).map(e => {
      if (!isObj(e)) return e
      const carried = e.rev === p.rev ? { rev } : {}
      if (e.kind === 'revise' && Array.isArray(e.ops)) {
        const was = e.ops as Record<string, unknown>[]
        const esub = substituteOps(was, op => take(op, open))
        if (!esub) return e
        revised = true
        if (sub && canonicalJson(was) === canonicalJson(held)) return { ...e, ops, ...carried }
        return { ...e, ops: [...esub.git, ...esub.held, ...pendingPart(id, esub.moved as StagedPrivateOp[]).placeholders], ...carried }
      }
      return CARRIED_EVENTS.includes(String(e.kind)) ? { ...e, ...carried } : e
    })
    if (!sub && !revised) continue
    text = updatedText(text, 'proposals', id, { ...(p as unknown as Record<string, unknown>), ops, rev, events })
    if (!sub) continue
    if (open) rows.push(...part!.rows)
    else if (p.state === 'ratified') ratified.push(id)
  }
  return text === f.src ? null : { file: { rel: LEDGER, before: f.before, text }, rows, ratified }
}

/** A git record's op as the private op that carries it once the record is kept in the store (§10.3's typed deltas). A
 *  `visibility` it wrote is left out: the record's level is the narrowing's from now on. */
function recordDelta(op: Record<string, unknown>, collection: string, id: string, level: string): StagedPrivateOp {
  const strip = (v: unknown) => omit(isObj(v) ? v : {}, 'visibility')
  if (op.op === 'delete') return { op: 'delete-record', collection, id }
  if (op.op === 'update') return { op: 'update-record', collection, id, set: strip(op.set) }
  if (op.op === 'replace') return { op: 'replace-record', collection, id, value: strip(op.value) }
  return { op: 'create-record', collection, id, visibility: level, value: strip(op.value) }
}

const storeRead = <T>(store: PrivateStore, fn: () => T): T => { try { return fn() } catch (err) { throw unavailable(err, store) } }
const needStore = (store: PrivateStore | null, why: unknown): PrivateStore => { if (!store) throw unavailable(why); return store }

/** Where data/governance.yaml names record `id` of `registry` (R-L5-16.9, 16.12): lib/narrow.mjs `governanceNamesOf`, the
 *  same reading validate:governance makes offline. */
function governanceNames(repo: string, registry: string, id: string): { registry: string; id: string; field: string }[] {
  const path = join(repo, 'data', 'governance.yaml')
  if (!existsSync(path)) return []
  return governanceNamesOf(readGovernance(readFileSync(path, 'utf8')).governance, registry, id)
}

/** One record (R-L5-16.1): a record the store keeps (narrowed in the store), or a git record (to members in git; stricter,
 *  out of git into the store). */
function planRecord(repo: string, by: string, registry: string, id: string, next: ParsedLevel, viewer: Viewer,
  store: PrivateStore | null, why: unknown, policy: VisibilityPolicy): Plan {
  const token = formatLevel(next)
  if (!KNOWN.has(registry)) {
    // A private collection's record: only for those admitted to the collection; anyone else is told it is not there.
    const s = needStore(store, why)
    const listed = storeRead(s, () => s.collections()).find(c => c.id === registry)
    if (!listed || !admits(levelOfToken(listed.visibility), viewer)) throw new HttpError(404, noCollection(registry), 'NO_COLLECTION')
  }
  if (KNOWN.has(registry) && !COLLECTIONS.has(registry)) throw new HttpError(404, noRecord(registry, id), 'NO_RECORD')
  const kept = store ? storeRead(store, () => store.record(registry, id)) : null
  if (kept && admits(levelOfToken(kept.visibility), viewer)) {
    judgeMove(levelOfToken(kept.visibility), next, false)
    judgeAdmitted(next, viewer)
    const s = store!
    const fields = storeRead(s, () => s.fields(registry, id))
    const staged = storeRead(s, () => s.staged())
    return {
      subject: narrowSubject({ kind: 'store' }), files: [], moved: false, policy,
      before: w => {
        w.putRecord({ ...kept, visibility: token }, by, null)
        relevel(w, fields, next, by)
        relevelStaged(w, staged, (r, rec) => r === registry && rec === id, next)
      },
    }
  }
  if (!KNOWN.has(registry)) throw new HttpError(404, noRecord(registry, id), 'NO_RECORD')

  const rel = `data/${registry}.yaml`
  const record = currentEntries(repo, registry, true).find(e => named(e, id))
  if (!record) throw new HttpError(404, noRecord(registry, id), 'NO_RECORD')
  const cur = fullLevel(policy, registry, record)
  const leaves = !gitAllows(next)
  // A record git holds at a stricter level (its own `visibility` written by hand) still has to leave: equal is a move then.
  judgeMove(cur, next, leaves)
  judgeAdmitted(next, viewer)
  const f = fileOf(repo, rel)
  if (!leaves) {
    return {
      subject: narrowSubject({ kind: 'record', registry, id, level: token }), moved: false, before: null, policy,
      files: [{ rel, before: f.before, text: updatedText(f.src, registry, id, { ...record, visibility: token }) }],
    }
  }
  if (registry === 'members') throw new Refusal(409, { code: 'ROSTER', error: ROSTER })
  const refs = [...referrers(repo, registry, id), ...governanceNames(repo, registry, id)]
  if (refs.length > 0) throw new Refusal(409, { code: 'REFERRED', error: referred(registry, id, refs) })
  const s = needStore(store, why)
  if (kept) throw new Refusal(409, { code: 'PRIVATE_CONFLICT', error: conflict(registry, id) })
  const body = { ...omit(record, 'visibility'), id }
  const fields = storeRead(s, () => s.fields(registry, id))
  const staged = storeRead(s, () => s.staged())
  const ledger = ledgerPlan(repo, op => (op.record === `${registry}:${id}` ? { keep: null, moved: [recordDelta(op, registry, id, token)] } : null))
  return {
    subject: narrowSubject({ kind: 'record', registry, id, level: token }), moved: true, policy,
    files: [{ rel, before: f.before, text: deletedText(f.src, registry, id) }, ...(ledger ? [ledger.file] : [])],
    before: w => {
      w.putRecord({ collection: registry, id, visibility: token, body, rev: baseOf(body) ?? '' }, by, null)
      relevel(w, fields, next, by)
      relevelStaged(w, staged, (r, rec) => r === registry && rec === id, next)
      for (const row of ledger?.rows ?? []) w.putPending(row)
    },
    after: ratifiedApplied(s, ledger?.ratified ?? []),
  }
}

/** The `applied` mark of each ratified proposal whose ops a narrowing turned into placeholders: its part was applied when
 *  it was ratified, in git, so the next start must not apply it (`reconcilePrivate`). */
function ratifiedApplied(store: PrivateStore, ids: readonly string[]): Plan['after'] {
  if (ids.length === 0) return undefined
  return (w, commit) => {
    for (const id of ids) if (store.applied(id) === null) w.putApplied({ proposal: id, commit, at: new Date().toISOString() })
  }
}

/** A collection (R-L5-16.1): a git collection's level to members, or a private collection's level in the store. */
function planCollection(repo: string, by: string, collection: string, next: ParsedLevel, viewer: Viewer,
  store: PrivateStore | null, why: unknown, policy: VisibilityPolicy): Plan {
  const token = formatLevel(next)
  if (!KNOWN.has(collection)) {
    const s = needStore(store, why)
    const listed = storeRead(s, () => s.collections()).find(c => c.id === collection)
    if (!listed || !admits(levelOfToken(listed.visibility), viewer)) throw new HttpError(404, noCollection(collection), 'NO_COLLECTION')
    judgeMove(levelOfToken(listed.visibility), next, false)
    judgeAdmitted(next, viewer)
    return { subject: narrowSubject({ kind: 'store' }), files: [], moved: false, policy, before: w => w.putCollection({ ...listed, visibility: token }, by) }
  }
  if (!COLLECTIONS.has(collection)) throw new HttpError(404, noCollection(collection), 'NO_COLLECTION')
  if (!gitAllows(next)) throw new Refusal(422, { code: 'COLLECTION_IN_GIT', error: COLLECTION_IN_GIT })
  judgeMove(fullLevel(policy, collection, null), next, false)
  judgeAdmitted(next, viewer)
  const v = fileOf(repo, VISIBILITY)
  const text = policyText(v.src, collection, undefined, token)
  const after = readFullPolicy(parseDocument(text).toJS()).policy
  // A record that says it is public itself is narrowed with its collection (R-L5-16.1): nothing in it stays wider.
  const rel = `data/${collection}.yaml`
  const f = fileOf(repo, rel)
  let records = f.src
  for (const e of currentEntries(repo, collection, true)) {
    if (e.visibility === 'public' && e.id !== undefined && e.id !== null) records = updatedText(records, collection, String(e.id), omit(e, 'visibility'))
  }
  return {
    subject: narrowSubject({ kind: 'collection', collection, level: token }), moved: false, before: null, policy: after,
    files: [{ rel: VISIBILITY, before: v.before, text }, ...(records !== f.src ? [{ rel, before: f.before, text: records }] : [])],
  }
}

/** A git collection's field (R-L5-16.1): its level in data/visibility.yaml, and, stricter than members, every value git
 *  holds of it moved to the store, and every ledger op writing it held as a placeholder. */
function planField(repo: string, by: string, collection: string, field: string, next: ParsedLevel, viewer: Viewer,
  store: PrivateStore | null, why: unknown, policy: VisibilityPolicy): Plan {
  const token = formatLevel(next)
  if (!COLLECTIONS.has(collection)) throw new HttpError(404, noCollection(collection), 'NO_COLLECTION')
  if (field === 'id' || field === 'visibility') throw new HttpError(400, `${field} is not a field a level can be given to. ${NOTHING}`)
  const leaves = !gitAllows(next)
  if (leaves && collection === 'members' && field === 'handles') throw new Refusal(409, { code: 'ROSTER', error: ROSTER })
  const rel = `data/${collection}.yaml`
  const f = fileOf(repo, rel)
  const entries = currentEntries(repo, collection, true)
  const holding = leaves ? entries.flatMap((e, i) => (held(e[field]) ? [{ e, i }] : [])) : []
  const take: Take = (op, open) => {
    if (typeof op.record !== 'string' || !op.record.startsWith(`${collection}:`) || op.op === 'delete') return null
    const written = op.op === 'update' ? op.set : op.value
    if (!isObj(written) || !Object.hasOwn(written, field)) return null
    const id = op.record.slice(collection.length + 1)
    const value = written[field]
    // A closed proposal's null holds nothing restricted: it is left as it was decided. An open one's removal is kept as one.
    if (!held(value) && !open) return null
    const moved: StagedPrivateOp = held(value)
      ? { op: 'put-field', field: { registry: collection, record: id, field, visibility: token, value } }
      : { op: 'delete-field', registry: collection, record: id, field, visibility: token }
    return { keep: withoutFields(op, [field]), moved: [moved] }
  }
  const ledger = leaves ? ledgerPlan(repo, take) : null
  const declared = policy.collections?.[collection]?.fields?.[field]
  judgeMove(fullLevel(policy, collection, null, field), next, holding.length > 0 || ledger !== null)
  judgeAdmitted(next, viewer)

  const v = fileOf(repo, VISIBILITY)
  const text = declared === token ? v.src : policyText(v.src, collection, field, token)
  const after = text === v.src ? policy : readFullPolicy(parseDocument(text).toJS()).policy
  const files: FileWrite[] = text === v.src ? [] : [{ rel: VISIBILITY, before: v.before, text }]
  if (!leaves) return { subject: narrowSubject({ kind: 'field', collection, field, level: token }), files, moved: false, before: null, policy: after }

  const s = needStore(store, why)
  let records = f.src
  const moves: PrivateField[] = []
  for (const { e, i } of holding) {
    if (e.id === undefined || e.id === null) throw new Refusal(409, { code: 'NO_ID', error: noId(collection, i + 1, field) })
    records = updatedText(records, collection, String(e.id), takenOutOfGit(collection, field, e))
    moves.push({ registry: collection, record: String(e.id), field, visibility: token, value: e[field] })
  }
  if (records !== f.src) files.push({ rel, before: f.before, text: records })
  if (ledger) files.push(ledger.file)
  const kept = storeRead(s, () => s.fieldsNamed(collection, field))
  const staged = storeRead(s, () => s.staged())
  return {
    subject: narrowSubject({ kind: 'field', collection, field, level: token }), files, moved: moves.length > 0 || ledger !== null, policy: after,
    before: w => {
      // The store's value wins over git's on read (R-L5-14.5): where it keeps one, git's is dropped and the store's kept.
      const stored = new Set(kept.map(k => k.record))
      for (const m of moves) if (!stored.has(m.record)) w.putField(m, by, null)
      relevel(w, kept, next, by)
      relevelStaged(w, staged, (r, _rec, fld) => r === collection && fld === field, next)
      for (const row of ledger?.rows ?? []) w.putPending(row)
    },
    after: ratifiedApplied(s, ledger?.ratified ?? []),
  }
}

/** Write `files` and make the one commit; on any failure every file goes back to its bytes before, and the index with it. */
async function commitFiles(repo: string, files: readonly FileWrite[], message: string, actor: KnownActor): Promise<string> {
  const trailers = { actor: actorTrailer(actor), rule: NARROW_RULE }
  if (files.length === 0) {
    try { return await commitDataPaths(repo, [], message, trailers, { ident: commitIdent(actor), allowEmpty: true }) } catch (err) {
      throw new HttpError(503, `Not narrowed: git refused the commit (${firstLine(err)}). ${NOTHING}`)
    }
  }
  try {
    for (const f of files) writeFileSync(join(repo, f.rel), f.text)
    return await commitDataPaths(repo, files.map(f => f.rel), message, trailers, { ident: commitIdent(actor) })
  } catch (err) {
    const lost: string[] = []
    for (const f of files) {
      try { if (f.before) writeFileSync(join(repo, f.rel), f.before); else rmSync(join(repo, f.rel), { force: true }) } catch { lost.push(f.rel) }
    }
    await restageDataPaths(repo, files.filter(f => f.before !== null).map(f => f.rel)).catch(() => {})
    throw new HttpError(503, `Not narrowed: git refused the commit (${firstLine(err)}). ` +
      (lost.length === 0 ? 'Nothing was changed in the files.' : `${lost.join(', ')} could not be put back: \`git diff HEAD\` shows what they hold now.`))
  }
}
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0]

/**
 * Narrow `input.target` to `input.level` (§9.7), as `actor`, judged with `deps.viewer` (hats read for the act). Refuses,
 * before anything is written: a level that lets more people read it (409 `WIDENS`), one that changes nothing (409
 * `UNCHANGED`), a level the actor is not admitted to (403 `NOT_ADMITTED`), a thing they may not read (404, as one that is
 * not there), a record other records name (409 `REFERRED`), the store down when the narrowing writes to it (503), and
 * then an actor the rule for the thing's class lets neither apply nor propose it (403 `MAY_NOT_WRITE`, Q77). The caller
 * holds the repository's write lock.
 */
export async function narrow(repo: string, actor: KnownActor, input: NarrowInput, deps: NarrowDeps): Promise<NarrowResult> {
  const next = parseLevel(input.level)
  if (next === null) throw new HttpError(400, SHAPE)
  if (deps.viewer.kind !== 'member') throw new Refusal(403, { code: 'NOT_ADMITTED', error: notAdmitted(formatLevel(next)) })
  const { store, why } = reach(deps.privateStore)
  const policy = readConfig(repo)
  const t = input.target
  const plan = 'registry' in t
    ? planRecord(repo, actor.id, t.registry, t.id, next, deps.viewer, store, why, policy)
    : t.field !== undefined
      ? planField(repo, actor.id, t.collection, t.field, next, deps.viewer, store, why, policy)
      : planCollection(repo, actor.id, t.collection, next, deps.viewer, store, why, policy)

  // Who may narrow is who may write the thing (Q77): the predicate that draws the control (GET /api/visibility). Judged
  // after the plan, so a thing the actor may not read is still answered as one that is not there.
  const registry = 'registry' in t ? t.registry : t.collection
  const may = mayWrite(readRuleContext(repo, actor), registry)
  if (may !== true) throw new Refusal(403, { code: 'MAY_NOT_WRITE', error: mayNotNarrow(registry, may) })

  await guardFiles(repo, plan.files.map(f => f.rel))
  // Nothing stricter than members enters git (§10.5), judged by the policy as the narrowing leaves it: only what the
  // narrowing would add is refused (it adds nothing; a legacy value elsewhere in the same file is not its to judge).
  const gitFiles = (pick: (f: FileWrite) => string | null): GitFile[] =>
    plan.files.flatMap(f => { const text = pick(f); return text === null ? [] : [{ path: f.rel, text }] })
  assertGitSafe(repo, gitFiles(f => f.text), plan.policy, gitFiles(f => f.before?.toString('utf8') ?? null))

  const commitIt = async () => ({ commit: await commitFiles(repo, plan.files, plan.subject, actor) })
  const answer = (commit: string): NarrowResult => ({ commit, moved: plan.moved })
  if (plan.before === null) return answer((await commitIt()).commit)
  const s = needStore(store, why)
  const before = plan.before
  const out = await aroundGit(s, {
    before,
    git: commitIt,
    after: plan.after ? (w, o) => plan.after!(w, o.commit) : undefined,
    late: o => {
      throw new Refusal(503, { code: 'PRIVATE_STORE', commit: o.commit, error:
        `Commit ${o.commit} was made, but the private store could not keep what it took out of the repository: it is still in the commit before it. ${STORE_FAILED}` })
    },
  })
  return answer(out.commit)
}
