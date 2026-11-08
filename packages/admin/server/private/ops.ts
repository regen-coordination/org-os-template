// packages/admin/server/private/ops.ts
//
// Writes to private data (L5 spec §10.3): each staged op is split by data/visibility.yaml into its git part (fields at
// members or looser) and its private part (records of private collections, private records of a git collection,
// restricted fields). The private part is staged in the store's `staged` table, the change file keeps a placeholder per
// op (`{ op: 'private', ref: 'stg-<seq>', class }`), and a direct apply writes it inside one store transaction around
// the git commit: begin, apply, commit to git, commit the transaction; a failed git commit rolls the store back.

import { REGISTRIES } from '../registries.ts'
import { classOf } from '../../lib/change-classes.mjs'
import { StageError } from '../../lib/ops.mjs'
import { admits, CONTACT_FIELDS, contactLevel, formatLevel, fullLevel, gitAllows, narrowerOrEqual, parseLevel, restrictedFields, type ParsedLevel, type Viewer, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { baseOf, sameValue } from '../changes/canonical.ts'
import { currentOf } from '../changes/stage.ts'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import { readConfig } from '../visibility/config.ts'
import type { Change, PrivatePlaceholder, RecordError, StageOp } from '../changes/types.ts'
import { StoreUnavailable, type PrivateField, type PrivateRecord, type PrivateStore, type PrivateWriter } from './store.ts'

/** One write to private data, as `applyPrivate` makes it: a whole record (a private collection's, or a git
 *  collection's record kept private) or one restricted field of a git record. Resolved at apply time from the staged ops
 *  (`resolvePrivate`), never staged itself. */
export type PrivateOp =
  | { op: 'put-record'; record: PrivateRecord }
  | { op: 'delete-record'; collection: string; id: string }
  | { op: 'put-field'; field: PrivateField }
  | { op: 'delete-field'; registry: string; record: string; field: string }

/** One staged op on private data, as typed (R-L5-14.2 as amended): a delta on a private record, composed with what is
 *  already staged on it the way 0.6 composes git ops and merged with the store's record only at apply time, or one
 *  restricted field's new value (or its removal). `clear-fields` is never staged: an apply adds it for each git record it
 *  deletes, so the record's restricted fields go with it. */
export type StagedPrivateOp =
  | { op: 'create-record'; collection: string; id: string; visibility: string; value: Record<string, unknown> }
  | { op: 'update-record'; collection: string; id: string; set: Record<string, unknown>; visibility?: string }
  | { op: 'replace-record'; collection: string; id: string; value: Record<string, unknown>; visibility?: string }
  | { op: 'delete-record'; collection: string; id: string }
  | { op: 'put-field'; field: PrivateField }
  | { op: 'delete-field'; registry: string; record: string; field: string; visibility?: string }
  | { op: 'clear-fields'; registry: string; record: string }

export type { PrivatePlaceholder }

/** How a route reaches the one private store: the store, or a throw of `StoreUnavailable` naming why it is not open
 *  (§10.1). The git side never needs it. */
export type PrivateAccess = () => PrivateStore

/** The subject of the commit a change with only a private part makes (§10.3): git holds nothing of it but the fact. */
export const RESTRICTED_SUBJECT = 'A change to a restricted collection'

/** L3-C4: contact details are kept at `defaults.contact` unless data/visibility.yaml gives the field a level. */
export const NO_CONTACT_LEVEL = 'Name the hat that keeps contact details in data/visibility.yaml (defaults.contact) first.'
/** The fields kept at `defaults.contact` unless data/visibility.yaml names their level: contact details and a person's
 *  wallet link (lib/visibility.mjs, R-L5-18.7). */
export { CONTACT_FIELDS }

/** Said when a server was made with no private store at all (a script, a test of the git side). */
export const NO_STORE = 'This server has no private store open, so nothing private can be read or written here.'
export const noStore: PrivateAccess = () => { throw new StoreUnavailable(NO_STORE) }

/** Said, and raised as the store's attention (§10.1), when the store fails after it opened (a damaged file, a full
 *  disk): what the store said goes to the server's log, never into an answer. */
export const STORE_FAILED = 'The private store failed after the server started, so nothing private can be read or written until it is fixed: '
  + 'see the server\'s log, restore the store from a backup (npm run house:restore), then start the server again.'

/** One answer, at apply, for a private collection that is not there and one the actor may no longer read. */
export const noCollection = (collection: string) => `"${collection}" names no collection here. Nothing was written.`
/** One answer for a private record that is not there and one the actor may not read (§9.2, §9.5): the same words. */
export const noRecord = (collection: string, id: string) => `There is no record ${id} in ${collection} to change. Nothing was written.`

/** The access to `store`, or, when it could not be opened, a throw of the failure's fixed sentence (L9 §7.4,
 *  `classifyOpenError`): never the store's own words, which went to the log. No failure named: `NO_STORE`. */
export function storeAccess(store: PrivateStore | null, failure: { sentence: string } | null): PrivateAccess {
  return () => { if (store) return store; throw new StoreUnavailable(failure?.sentence ?? NO_STORE) }
}

/** The store when it can be reached; else null, with why. */
export function reach(access: PrivateAccess): { store: PrivateStore | null; why: unknown } {
  try { return { store: access(), why: null } } catch (err) { return { store: null, why: err } }
}

/**
 * A failure of the store as a `StoreUnavailable` (Task 4 review ruling): one it already is keeps its words; any other
 * (corruption found after the store opened, a full disk) becomes `STORE_FAILED`, is raised as the store's attention
 * through `store.onFailure`, and its own text goes to the server's log only.
 */
export function asUnavailable(err: unknown, store: PrivateStore | null): StoreUnavailable {
  if (err instanceof StoreUnavailable) return err
  console.error(`org-os admin: the private store failed: ${err instanceof Error ? err.message : String(err)}`)
  try { store?.onFailure?.(STORE_FAILED) } catch { /* the attention is best effort; the refusal stands */ }
  return new StoreUnavailable(STORE_FAILED)
}

/** A store that cannot be used, as the answer it gives: 503 `PRIVATE_STORE` with its sentence. A refusal is itself. */
export function unavailable(err: unknown, store: PrivateStore | null = null): Refusal {
  if (err instanceof Refusal) return err
  return new Refusal(503, { error: asUnavailable(err, store).message, code: 'PRIVATE_STORE' })
}

/** A read of the store, its failure answered as the store's (503). */
function storeRead<T>(store: PrivateStore, fn: () => T): T {
  try { return fn() } catch (err) { throw unavailable(err, store) }
}

const KNOWN = new Set(REGISTRIES.map(r => r.name))
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A value that is there: a field written as null holds nothing. */
const held = (v: unknown) => v !== undefined && v !== null
/** A level as the store holds it; one that does not parse admits nobody. */
const levelOf = (token: string): ParsedLevel => parseLevel(token) ?? { level: 'hat', hat: token }

/** `<registry>:<id>` read apart at the first colon, whether or not the registry is one git knows. */
function ref(record: string): { registry: string; id: string } {
  const at = record.indexOf(':')
  return at < 0 ? { registry: record, id: '' } : { registry: record.slice(0, at), id: record.slice(at + 1) }
}

/** A record's own `visibility` stricter than members: its token, else null. */
function strictToken(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return gitAllows(fullLevel(null, '', { visibility: v })) ? null : v
}

/** The gate's `restricted` marker (§9.5), written back with a record read through it: not a field. */
const isMarker = (v: unknown) => isObj(v) && Object.values(v).every(t => typeof t === 'string')

/** Which registry or collection a private op is about. */
function registryOf(op: PrivateOp | StagedPrivateOp): string {
  if (op.op === 'put-record') return op.record.collection
  if (op.op === 'put-field') return op.field.registry
  return 'collection' in op ? op.collection : op.registry
}

/** The class a private op is judged under: its registry's or private collection's (§10.3; a private collection falls to
 *  the `*` row). */
export function privateClass(op: PrivateOp | StagedPrivateOp): string {
  return String(classOf({ registry: registryOf(op) }))
}

/**
 * Does staged op `op` widen a private record's level (§9.7, R-L5-16.8): an update or replace giving it a `visibility` that
 * admits someone the level it is stored at did not (wider, or not ordered with it)? Such a change carries the class
 * `publication` and is proposed, never applied directly (409 `WIDENS`). A create widens nothing (it had no readers).
 */
export function privateWidens(store: PrivateStore, op: StagedPrivateOp): boolean {
  if ((op.op !== 'update-record' && op.op !== 'replace-record') || op.visibility === undefined) return false
  const stored = storeRead(store, () => store.record(op.collection, op.id))
  return stored !== null && !narrowerOrEqual(levelOf(op.visibility), levelOf(stored.visibility))
}

/** The classes a change's private part is judged under: each op's (`privateClass`), and `publication` when one widens. */
export function privateClasses(store: PrivateStore | null, ops: readonly StagedPrivateOp[]): string[] {
  const classes = ops.map(privateClass)
  if (store && ops.some(op => privateWidens(store, op))) classes.push('publication')
  return [...new Set(classes)]
}

/** What a staged op writes to: one record, or one field. Two ops on the same target are composed into one. */
function targetOf(op: StagedPrivateOp): string {
  if (op.op === 'put-field') return `f:${op.field.registry}/${op.field.record}/${op.field.field}`
  if (op.op === 'delete-field') return `f:${op.registry}/${op.record}/${op.field}`
  if (op.op === 'clear-fields') return `c:${op.registry}/${op.record}`
  return `r:${op.collection}/${op.id}`
}

export interface Split { git: StageOp | null; private: StagedPrivateOp[] }
/** Who is staging (§9.4), and the git record as it is now (for contact details). */
export interface SplitContext { viewer: Viewer; current?: Record<string, unknown> | null }

/** I3 (R-L5-16.8): moving a private record into git is §9.7's third widening, not built yet; the words promise no path. */
const widens = (record: string, token: string) =>
  `${record} is private; making it ${token} would move it into the repository, where more people read it. ` +
  'Moving a private record into the repository is a publication that cannot be proposed here yet, so it stays private. Nothing was staged.'
const narrowsFirst = (record: string, token: string) =>
  `${record} would be ${token}, stricter than members, and the repository holds nothing stricter: narrow it with its visibility control instead, which takes it out of the repository at once.`
const notAdmittedTo = (what: string, token: string) =>
  `${what} would be kept at ${token}, which you are not admitted to, so you cannot write it here.`

/** A whole-record op on a private record, as typed: nothing of the store's record is read here (it is merged at apply
 *  time), so staging says nothing about what the record holds, or whether it is there. */
function recordDelta(op: StageOp, collection: string, id: string, level: string, viewer: Viewer): Split {
  if (op.op === 'delete') return { git: null, private: [{ op: 'delete-record', collection, id }] }
  const typed = op.op === 'update' ? op.set : op.value
  const entries = Object.entries(typed).filter(([k, v]) => !(k === 'restricted' && isMarker(v)) && k !== 'visibility')
  const said = typed.visibility
  const token = said === undefined || said === null ? null : String(said)
  if (token !== null && gitAllows(fullLevel(null, '', { visibility: token }))) throw new StageError('visibility', widens(op.record, token))
  if (token !== null && !admits(levelOf(token), viewer)) throw new StageError('visibility', notAdmittedTo(op.record, token))
  const value = Object.fromEntries(entries)
  if (op.op === 'update') return { git: null, private: [{ op: 'update-record', collection, id, set: value, ...(token ? { visibility: token } : {}) }] }
  if (op.op === 'replace') return { git: null, private: [{ op: 'replace-record', collection, id, value, ...(token ? { visibility: token } : {}) }] }
  const visibility = token ?? level
  if (!admits(levelOf(visibility), viewer)) throw new StageError('visibility', notAdmittedTo(op.record, visibility))
  return { git: null, private: [{ op: 'create-record', collection, id, visibility, value }] }
}

/**
 * One staged op split by data/visibility.yaml (§10.3): its git part, or null, and its private part, as typed. Private
 * data `ctx.viewer` is not admitted to is answered exactly as if it were not there (§9.2, §9.5): a private collection
 * they may not read is no registry, a private record they may not read is no record of it, and a restricted field's
 * stored value is never read here. A restricted field is written only by someone admitted to the level the policy keeps
 * it at. `store` null: it cannot be reached (the policy alone decides; a private part is then the caller's to refuse).
 * Throws a `StageError` for what cannot be staged.
 */
export function splitOp(op: StageOp, config: VisibilityPolicy, store: PrivateStore | null, ctx: SplitContext): Split {
  const { viewer } = ctx
  const { registry, id } = ref(op.record)
  if (registry === '' || id === '' || viewer.kind === 'public') return { git: op, private: [] }
  if (!KNOWN.has(registry)) {
    const collection = store ? storeRead(store, () => store.collections()).find(c => c.id === registry) : undefined
    // One this viewer may not read is answered as an unknown registry: staging says it names none.
    if (!collection || !admits(levelOf(collection.visibility), viewer)) return { git: op, private: [] }
    return recordDelta(op, registry, id, collection.visibility, viewer)
  }
  // A record of a git collection kept private, when this viewer may read it; otherwise git's answer stands.
  const kept = store ? storeRead(store, () => store.record(registry, id)) : null
  if (kept && admits(levelOf(kept.visibility), viewer)) return recordDelta(op, registry, id, kept.visibility, viewer)
  if (op.op === 'delete') return { git: op, private: [] } // its restricted fields go with it at apply (`clear-fields`)
  const written = op.op === 'update' ? op.set : op.value
  const strict = strictToken(written.visibility)
  if (strict !== null) {
    if (op.op === 'create') return recordDelta(op, registry, id, strict, viewer)
    throw new StageError('visibility', narrowsFirst(op.record, strict))
  }

  const restricted = restrictedFields(config, registry)
  const declared = config.collections?.[registry]?.fields ?? {}
  const contact = contactLevel(config)
  const current = ctx.current ?? null
  // Entries, not a plain object written field by field: a field called `__proto__` stays a field (and staging refuses it).
  const keep: [string, unknown][] = []
  const priv: StagedPrivateOp[] = []
  let changed = false
  for (const [field, value] of Object.entries(written)) {
    if (field === 'restricted' && isMarker(value)) { changed = true; continue }
    // Own properties only: a field named like something every object inherits (toString, __proto__) is a field like any other.
    // The level is the policy's, never what the store holds, so the answer is the same whatever the store holds.
    let level: ParsedLevel | null = Object.hasOwn(restricted, field) ? restricted[field]! : null
    const contactField = Object.hasOwn(CONTACT_FIELDS, registry) && CONTACT_FIELDS[registry]!.includes(field)
    const gitHolds = current !== null && Object.hasOwn(current, field) && held(current[field])
    if (level === null && contactField && !Object.hasOwn(declared, field) && !gitHolds) {
      // A new contact value goes to the store at `defaults.contact`; a null removes the one kept there (judged at that
      // level, never by what the store holds). With no contact level, a null stays git's, as any field.
      if (held(value) && !contact) throw new StageError(field, NO_CONTACT_LEVEL)
      if (contact) level = contact
    }
    if (level === null) { keep.push([field, value]); continue }
    if (!admits(level, viewer)) throw new StageError(field, notAdmittedTo(`${field} of ${op.record}`, formatLevel(level)))
    changed = true
    priv.push(held(value)
      ? { op: 'put-field', field: { registry, record: id, field, visibility: formatLevel(level), value } }
      : { op: 'delete-field', registry, record: id, field, visibility: formatLevel(level) })
  }
  if (!changed) return { git: op, private: [] }
  if (op.op === 'update') return { git: keep.length > 0 ? { ...op, set: Object.fromEntries(keep) } : null, private: priv }
  return { git: { ...op, value: Object.fromEntries(keep) }, private: priv }
}

/** Every op split, against the store `access` reaches and the policy as it is now, for `viewer`. A split that cannot be
 *  staged is a 422 `{ errors }`; a private part while the store cannot be reached is the store's 503. */
export function splitOps(repo: string, ops: StageOp[], access: PrivateAccess, viewer: Viewer): { git: StageOp[]; private: StagedPrivateOp[]; store: PrivateStore | null } {
  const config = readConfig(repo)
  const { store, why } = reach(access)
  const git: StageOp[] = []
  const priv: StagedPrivateOp[] = []
  const errors: RecordError[] = []
  for (const op of ops) {
    let current: Record<string, unknown> | null = null
    try { current = currentOf(repo, op.record) } catch { /* a record git does not hold, or one staging refuses */ }
    try {
      const split = splitOp(op, config, store, { viewer, current })
      if (split.git) git.push(split.git)
      priv.push(...split.private)
    } catch (err) {
      if (!(err instanceof StageError)) throw err
      errors.push({ record: op.record, field: (err as StageError & { field: string }).field, message: err.message })
    }
  }
  if (errors.length > 0) throw new StageRefusal(errors)
  if (priv.length > 0 && !store) throw unavailable(why)
  return { git, private: priv, store }
}

// ── staging ─────────────────────────────────────────────────────────────────────────────────────────

const SEQ = /^stg-(\d+)$/
const seqOf = (p: PrivatePlaceholder): number => Number(SEQ.exec(p.ref)?.[1] ?? NaN)
const recordName = (op: { collection: string; id: string }) => `${op.collection}:${op.id}`

/**
 * A later staged op on a target that already has one, composed as 0.6 composes git ops (`mergeOp`): an update after a
 * create merges into the create, a replace after it replaces its value, a delete after it cancels both (null); two
 * updates merge; an update after a replace merges into the replace; anything after a delete but a create (then a
 * replace) is refused, and a create after anything. A field's later value replaces the earlier one.
 */
export function composeStaged(e: StagedPrivateOp, n: StagedPrivateOp): StagedPrivateOp | null {
  if (n.op === 'put-field' || n.op === 'delete-field' || n.op === 'clear-fields') return n
  if (e.op === 'put-field' || e.op === 'delete-field' || e.op === 'clear-fields') return n
  const name = recordName(n)
  if (e.op === 'delete-record') {
    if (n.op !== 'create-record') throw new StageError('', `${name} is staged to be deleted: take that op out of the change first.`)
    return { op: 'replace-record', collection: n.collection, id: n.id, value: n.value, visibility: n.visibility }
  }
  if (n.op === 'create-record') throw new StageError('id', `${name} is already in this change: edit it instead.`)
  if (n.op === 'delete-record') return e.op === 'create-record' ? null : n
  const visibility = n.visibility ?? e.visibility
  if (e.op === 'create-record') {
    return { op: 'create-record', collection: e.collection, id: e.id, visibility: visibility!, value: n.op === 'replace-record' ? n.value : { ...e.value, ...n.set } }
  }
  if (e.op === 'update-record' && n.op === 'update-record') {
    return { op: 'update-record', collection: e.collection, id: e.id, set: { ...e.set, ...n.set }, ...(visibility ? { visibility } : {}) }
  }
  // What is left: one of the two is a replace. An update or replace followed by a replace is that replace; a replace
  // followed by an update is the replace, merged.
  const value = n.op === 'replace-record' ? n.value : { ...(e.op === 'replace-record' ? e.value : {}), ...n.set }
  return { op: 'replace-record', collection: e.collection, id: e.id, value, ...(visibility ? { visibility } : {}) }
}

/** `ops` staged for `change` in the store's `staged` table, each composed with the op already staged on the same target
 *  (`composeStaged`; a composition that leaves nothing removes it); answers the change's placeholders, one per staged op.
 *  A composition that cannot be made is a 422 `{ errors }`, and nothing is written. */
export async function stagePrivate(store: PrivateStore, change: Change, actor: string, ops: StagedPrivateOp[]): Promise<PrivatePlaceholder[]> {
  const rows = storeRead(store, () => store.staged(change.id))
  const staged = new Map(rows.map(r => [targetOf(r.op as StagedPrivateOp), { seq: r.seq, op: r.op as StagedPrivateOp | null }]))
  let next = rows.reduce((max, r) => Math.max(max, r.seq), 0) + 1
  const touched = new Set<string>()
  const errors: RecordError[] = []
  for (const op of ops) {
    const t = targetOf(op)
    const was = staged.get(t)
    try {
      if (!was || was.op === null) staged.set(t, { seq: was?.seq ?? next++, op })
      else staged.set(t, { seq: was.seq, op: composeStaged(was.op, op) })
      touched.add(t)
    } catch (err) {
      if (!(err instanceof StageError)) throw err
      const record = op.op === 'put-field' ? `${op.field.registry}:${op.field.record}` : 'collection' in op ? recordName(op) : `${op.registry}:${op.record}`
      errors.push({ record, field: (err as StageError & { field: string }).field, message: err.message })
    }
  }
  if (errors.length > 0) throw new StageRefusal(errors)
  const writes = [...touched].map(t => staged.get(t)!)
  try {
    await store.tx(w => {
      for (const { seq, op } of writes) {
        if (op === null) w.deleteStaged(change.id, seq)
        else w.putStaged({ change: change.id, seq, actor, op })
      }
    })
  } catch (err) { throw unavailable(err, store) }
  const live = new Map([...staged.values()].filter(s => s.op !== null).map(s => [s.seq, s.op!]))
  const kept = (change.private ?? []).filter(p => live.has(seqOf(p)))
  const known = new Set(kept.map(seqOf))
  const added = [...live].filter(([seq]) => !known.has(seq)).sort(([a], [b]) => a - b)
    .map(([seq]): PrivatePlaceholder => ({ op: 'private', ref: `stg-${seq}`, class: '' }))
  // Each placeholder's class read again from its op as composed now, and whether it widens a private record (R-L5-16.8).
  return [...kept, ...added].map(p => {
    const op = live.get(seqOf(p))!
    return { op: 'private', ref: p.ref, class: privateClass(op), ...(privateWidens(store, op) ? { publication: true as const } : {}) }
  })
}

/** The staged ops a change's placeholders stand for, in their order. A placeholder whose op the store no longer holds
 *  refuses the apply (409): nothing of the change is written. */
export function stagedPrivate(store: PrivateStore, change: Change): StagedPrivateOp[] {
  const rows = new Map(storeRead(store, () => store.staged(change.id)).map(r => [r.seq, r.op as StagedPrivateOp]))
  return (change.private ?? []).map(p => {
    const op = rows.get(seqOf(p))
    if (!op) {
      throw new Refusal(409, { code: 'PRIVATE_LOST', ref: p.ref,
        error: `The private part of this change (${p.ref}) is no longer in the private store: discard the change and stage it again. Nothing was written.` })
    }
    return op
  })
}

/** The op a placeholder stands for, as the person who staged it typed it, for their tray; null when the store cannot say
 *  (a failure of the store is raised as its attention). */
export function stagedView(access: PrivateAccess, change: Change | null): (p: PrivatePlaceholder) => StagedPrivateOp | null {
  if (!change?.private?.length) return () => null
  const { store } = reach(access)
  if (!store) return () => null
  let rows: Map<number, StagedPrivateOp>
  try { rows = new Map(store.staged(change.id).map(r => [r.seq, r.op as StagedPrivateOp])) } catch (err) {
    asUnavailable(err, store)
    return () => null
  }
  return p => rows.get(seqOf(p)) ?? null
}

/** A discarded change's staged private ops go with it. A store that cannot be reached keeps them: nothing reads them
 *  without the change, whose id is never used again. */
export async function discardStaged(access: PrivateAccess, change: Change | null): Promise<void> {
  if (!change?.private?.length) return
  const { store } = reach(access)
  if (!store) return
  try { await store.tx(w => w.deleteStaged(change.id)) } catch (err) { asUnavailable(err, store) /* kept, as above */ }
}

// ── applying ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The writes `ops` make against the store as it is now (read inside the caller's `within`, so nothing moves under it),
 * for `viewer`, whose hats are read again for the act (§5.2): every level the ops write at — a create's, a new
 * `visibility`, a field's — must still admit them (409 `NOT_ADMITTED`, judged from the op before the store is read), and a
 * private collection they may no longer read is answered as one that is not there (409 `NO_COLLECTION`). A delta on a
 * record that is not there, or that `viewer` may not read, is refused 409 with one sentence for both (`noRecord`); a
 * create on a record that is there, 409. A replace overwrites the whole record. A field is written over a stored value only by someone
 * admitted to the level it is stored at; a value equal to what the store holds writes nothing. `clear-fields` deletes
 * every stored field of a git record the apply deletes.
 *
 * `viewer` null: the ops are a decided proposal's (Task 15, R-L5-15.3), judged at Propose for their proposer and decided
 * under the org's rules; nobody's admission is asked again, only whether the store still holds what they change.
 */
export function resolvePrivate(store: PrivateStore, ops: StagedPrivateOp[], viewer: Viewer | null): PrivateOp[] {
  const out: PrivateOp[] = []
  const conflict = (error: string, code: string) => new Refusal(409, { code, error })
  const admitted = (token: string) => viewer === null || admits(levelOf(token), viewer)
  for (const op of ops) {
    if (op.op === 'clear-fields') {
      for (const f of storeRead(store, () => store.fields(op.registry, op.record))) out.push({ op: 'delete-field', registry: op.registry, record: op.record, field: f.field })
      continue
    }
    if (op.op === 'put-field' || op.op === 'delete-field') {
      const f = op.op === 'put-field' ? op.field : op
      // The level it was staged at is judged again (an act reads hats now, §5.2): from the op alone, before the store is read.
      const at = op.op === 'put-field' ? op.field.visibility : op.visibility
      if (at !== undefined && !admitted(at)) throw conflict(notAdmittedTo(`${f.field} of ${f.registry}:${f.record}`, at), 'NOT_ADMITTED')
      const was = storeRead(store, () => store.fields(f.registry, f.record)).find(x => x.field === f.field)
      if (was && !admitted(was.visibility)) throw conflict(notAdmittedTo(`${f.field} of ${f.registry}:${f.record}`, was.visibility), 'NOT_ADMITTED')
      if (op.op === 'delete-field') { if (was) out.push(op); continue }
      if (was && was.visibility === op.field.visibility && sameValue(was.value, op.field.value)) continue
      out.push(op)
      continue
    }
    const { collection, id } = op
    // A private collection this viewer may no longer read (or that is gone) is answered as one that never was: before
    // anything of its records is read.
    if (!KNOWN.has(collection)) {
      const listed = storeRead(store, () => store.collections()).find(c => c.id === collection)
      if (!listed || !admitted(listed.visibility)) throw conflict(noCollection(collection), 'NO_COLLECTION')
    }
    if (op.op === 'create-record' && !admitted(op.visibility)) throw conflict(notAdmittedTo(recordName(op), op.visibility), 'NOT_ADMITTED')
    const existing = storeRead(store, () => store.record(collection, id))
    if (op.op === 'create-record') {
      if (existing) throw conflict(`${collection} already holds a record ${id}: change it instead of creating it again. Nothing was written.`, 'PRIVATE_CONFLICT')
      const body = { ...op.value, id }
      out.push({ op: 'put-record', record: { collection, id, visibility: op.visibility, body, rev: baseOf(body) ?? '' } })
      continue
    }
    if (!existing || !admitted(existing.visibility)) throw conflict(noRecord(collection, id), 'NO_RECORD')
    if (op.op === 'delete-record') { out.push(op); continue }
    if (op.visibility !== undefined && !admitted(op.visibility)) throw conflict(notAdmittedTo(recordName(op), op.visibility), 'NOT_ADMITTED')
    const body = { ...(op.op === 'update-record' ? { ...existing.body, ...op.set } : op.value), id }
    const visibility = op.visibility ?? existing.visibility
    out.push({ op: 'put-record', record: { collection, id, visibility, body, rev: baseOf(body) ?? '' } })
  }
  return out
}

/** `ops` written through `w`, an open transaction (`within`), each with its history row (by, change, and the decision row
 *  of a ratify). A failure of the store is its 503. */
export function applyPrivate(w: PrivateWriter, ops: PrivateOp[], by: string, change: string | null, store: PrivateStore | null = null,
  decision: string | null = null): void {
  try {
    for (const op of ops) {
      if (op.op === 'put-record') w.putRecord(op.record, by, change, decision)
      else if (op.op === 'delete-record') w.deleteRecord(op.collection, op.id, by, change, decision)
      else if (op.op === 'put-field') w.putField(op.field, by, change, decision)
      else w.deleteField(op.registry, op.record, op.field, by, change, decision)
    }
  } catch (err) { throw unavailable(err, store) }
}

/** The `clear-fields` op of each git record `ops` delete: its restricted fields go with it. */
export function clearsOf(ops: readonly StageOp[]): StagedPrivateOp[] {
  return ops.flatMap(op => {
    if (op.op !== 'delete') return []
    const { registry, id } = ref(op.record)
    return KNOWN.has(registry) && id !== '' ? [{ op: 'clear-fields' as const, registry, record: id }] : []
  })
}

/**
 * §10.3's direct apply: one store transaction around the git commit. The staged ops are resolved against the store as it
 * is now and written (and the change's staged rows removed, when `staged`), then `git` makes the commit, then the
 * transaction is committed. When `git` throws, the transaction is rolled back and its error is the answer. When the store
 * fails to commit after the git commit was made, the answer is 503 naming that commit (`commit` in the body): its git
 * part is in git, its private part was not written.
 */
export async function withPrivate<T extends { commit: string | null }>(store: PrivateStore, ops: StagedPrivateOp[], viewer: Viewer, by: string,
  change: string, staged: boolean, git: () => Promise<T>): Promise<T> {
  return aroundGit(store, {
    before: w => {
      applyPrivate(w, resolvePrivate(store, ops, viewer), by, change, store)
      if (staged) { try { w.deleteStaged(change) } catch (err) { throw unavailable(err, store) } }
    },
    git,
    late: out => {
      throw new Refusal(503, { code: 'PRIVATE_STORE', commit: out.commit,
        error: `Commit ${out.commit} was made, but the private store could not keep its part, so nothing private was written. ${STORE_FAILED}` })
    },
  })
}

/** The three steps of §10.3's order around a git commit (C-20). */
export interface AroundGit<T> {
  /** The store's writes, before git runs: one that throws rolls them back and is the answer, with nothing committed. */
  before: (w: PrivateWriter) => void
  /** The git commit. One that throws rolls the store back and is the answer as it is. */
  git: () => Promise<T>
  /** The store's writes that need git's answer (a commit's id), after it and in the same transaction. */
  after?: (w: PrivateWriter, out: T) => void
  /** The answer when the git commit was made and the store then failed (its writes rolled back): throw the refusal that
   *  says so, or answer `out` when the store's part can wait (the store's failure is logged and raised as attention). */
  late: (out: T) => T
}

/**
 * One store transaction around a git commit (§10.3, C-20): `within` begins it, `before` writes, `git` commits, `after`
 * writes what needed the commit, and the transaction commits. Any failure before git runs, or git's own, rolls the store
 * back and is answered (a store failure as its 503). A failure after the git commit was made (an `after` write, or the
 * store's COMMIT) goes to `late` with git's answer.
 */
export async function aroundGit<T>(store: PrivateStore, steps: AroundGit<T>): Promise<T> {
  const at: { phase: 'store' | 'git' | 'done'; out?: T } = { phase: 'store' }
  try {
    return await store.within(async w => {
      steps.before(w)
      at.phase = 'git'
      const out = await steps.git()
      at.out = out
      at.phase = 'done'
      steps.after?.(w, out)
      return out
    })
  } catch (err) {
    if (at.phase === 'git') throw err // git's own refusal; the store was rolled back
    if (at.phase === 'done') {
      asUnavailable(err, store) // logged, and raised as the store's attention
      return steps.late(at.out as T)
    }
    throw unavailable(err, store)
  }
}
