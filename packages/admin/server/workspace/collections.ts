// packages/admin/server/workspace/collections.ts
//
// Collections and their views (DAO-OS L6 spec §7.3, §7.4, §16): data/collections.yaml's definitions and saved views, a
// private collection's definition in the store (never named in git, R-L5-14.3), and a member's view state (theirs alone,
// the store's `view_state`). A definition or a saved view in git is a workspace write to data/collections.yaml, judged at
// `workspace:collections`: under `workspace/direct` it is one commit at once; raised, its file op is staged in the
// actor's change (preflight row 18). Defining a contact-shaped field (email, phone) writes its level, `defaults.contact`,
// into data/visibility.yaml in the same commit: a narrowing (ruling P-6). A private collection's definition is a workspace
// write too (ruling R-1a), written to the store at once, and only where the rule lets it apply at once.
//
//   GET  /api/collections                     the definitions the viewer may see, each with its level
//   POST /api/collections                     a new collection (201)
//   PUT  /api/collections/:id                 a definition changed, whole
//   DELETE /api/collections/:id               a definition removed (refused while it holds records)
//   PUT  /api/collections/:id/views/:view     a saved view, made or changed
//   GET/PUT /api/view-state/:collection       the member's own state of a collection's view

import type { Context, Hono } from 'hono'
import { parseDocument, isMap, isSeq, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import { HttpError } from '../errors.ts'
import { actorTrailer, commitIdent, type KnownActor } from '../actor.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { REGISTRIES, registriesOf } from '../registries.ts'
import { customFileOf } from '../../lib/registries.mjs'
import { STRINGIFY } from '../splice.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleIds } from '../governance/effective.ts'
import { applyOps, Refusal, StageRefusal } from '../changes/apply.ts'
import { classesOf, currentEntries, stage, targetsOfOps } from '../changes/stage.ts'
import { ChangeStore, newChangeId } from '../changes/store.ts'
import type { FileOp, RecordError } from '../changes/types.ts'
import { fileBase, fileText, registerFileCheck } from './files.ts'
import { policyText } from '../visibility/narrow.ts'
import { readConfig } from '../visibility/config.ts'
import { gateItems, MEMBERS } from '../visibility/gate.ts'
import { gitNames, reach, unavailable, type PrivateAccess } from '../private/ops.ts'
import { levelOfToken, privateReads } from '../private/reads.ts'
import type { PrivateCollection, PrivateStore } from '../private/store.ts'
import { admits, CONTACT_FIELDS, contactLevel, formatLevel, gitAllows, parseLevel, restrictedFields, type Viewer } from '../../lib/visibility.mjs'
import {
  collectionIdProblem, contactFieldsOf, definitionProblems, readCollections, viewProblems, viewRestrictedProblems, type CollectionDef, type SavedView,
} from '../../lib/workspace/collections.mjs'

export type { CollectionDef, FieldDef, FieldType, Filter, SavedView } from '../../lib/workspace/collections.mjs'

/** Where the definitions are kept (L6 §7.3). */
export const COLLECTIONS_FILE = 'data/collections.yaml'
const VISIBILITY_FILE = 'data/visibility.yaml'

// Copy (rulings log, Task 3). §7.4 gives the removal sentence; the rest are this task's.
export const NO_COLLECTION = (id: string): string => `There is no collection ${id}.`
export const HOLDS_RECORDS = (n: number): string => `Move or delete its ${n} ${n === 1 ? 'record' : 'records'} first. Nothing was written.`
/** When records the viewer may not read remain (rule 7: no count of them), alone or beside ones they see (controller copy
 *  ruling, Task 3 fix round 1). */
export const HOLDS_HIDDEN_RECORDS = 'This collection still holds records. Move or delete them before removing it. Nothing was changed.'
export const NOT_ADMITTED = (id: string, level: string): string =>
  `${id} would be kept at ${level}, which you are not admitted to, so you cannot write it here.`
export const DEFINED_AT_MEMBERS = 'A collection is defined at members, and made public with its visibility control. Nothing was written.'
export const LEVEL_BY_CONTROL = 'A collection\'s level is changed with its visibility control. Nothing was written.'
const NOT_A_LEVEL = (token: string) => `${token} is not a level: members, hat:<hat ref> or role:<role id>. Nothing was written.`
const BODY = 'The body must be a collection: {"id", "name"?, "fields"?: [...], "views"?: [...], "notes_parent"?, "visibility"?}.'
const VIEW_BODY = 'The body must be a saved view: {"name", "kind", "filters"?: [...], "sort"?, "group"?, "columns"?, "date"?, "board"?}.'
const STATE_BODY = 'The body must be {"state": <the view state, as JSON>}, or {"state": null} to forget it.'

export interface CollectionsDeps {
  repo: string
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  notify: (msg: { type: 'changes' }) => void
  privateStore: PrivateAccess
}

/** What GET /api/collections answers for each definition: the definition, its level, and whether it names a registry. */
export type CollectionView = CollectionDef & { visibility: string; builtin: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const BUILTINS = REGISTRIES.map(r => r.name)
const isBuiltin = (id: string) => BUILTINS.includes(id)
const errorsOf = (id: string, problems: { field: string; message: string }[]): RecordError[] =>
  problems.map(p => ({ record: `collections:${id}`, field: p.field, message: p.message }))
const refuse = (errors: RecordError[]): never => { throw new StageRefusal(errors) }
/** Refused when there is anything to refuse. */
const refuseAny = (errors: RecordError[]): void => { if (errors.length > 0) refuse(errors) }

/** The final review's M-1 (PF-R116): the fields of git collection `id` a saved view may not filter, sort, group, board
 *  or date by: those the policy keeps above members, and its contact fields (a registry's, and `def`'s email and phone
 *  fields; `def` is the definition as it will be written, else the one git holds). */
function keptFromViews(repo: string, id: string, def?: CollectionDef): Set<string> {
  const out = new Set(Object.keys(restrictedFields(readConfig(repo), id)))
  for (const f of Object.hasOwn(CONTACT_FIELDS, id) ? CONTACT_FIELDS[id]! : []) out.add(f)
  const d = def ?? gitDefinitions(repo).collections.find(c => c.id === id)
  if (d) for (const f of contactFieldsOf(d)) out.add(f)
  return out
}

/** A git definition's saved views judged as a saved view is (M-1), each at `views.<i>.…`. */
function definitionViewProblems(repo: string, def: CollectionDef): { field: string; message: string }[] {
  if (!Array.isArray(def.views)) return []
  const kept = keptFromViews(repo, def.id, def)
  return def.views.flatMap((v, i) => viewRestrictedProblems(v, kept).map(p => ({ field: `views.${i}.${p.field}`, message: p.message })))
}

// ── reading ─────────────────────────────────────────────────────────────────────────────────────────

/** data/collections.yaml's definitions as the repository holds them now, with what cannot be read. */
export function gitDefinitions(repo: string): { collections: CollectionDef[]; problems: string[] } {
  return readCollections(fileText(repo, COLLECTIONS_FILE), BUILTINS)
}

/** The private collections the store holds that git does not name (R-L5-14.5: git's name wins). */
function storeCollections(repo: string, access: PrivateAccess): PrivateCollection[] {
  const names = gitNames(repo)
  return privateReads(access).collections().filter(c => !names.has(c.id))
}

/** The private collection `id` when `viewer` may read it; null for one that is not there and one they may not read alike. */
function admittedPrivate(repo: string, access: PrivateAccess, c: Context, id: string): PrivateCollection | null {
  const found = storeCollections(repo, access).find(p => p.id === id)
  return found && admits(levelOfToken(found.visibility), viewerOf(c)) ? found : null
}

const asView = (p: PrivateCollection): CollectionDef => ({ ...(isObj(p.definition) ? p.definition : {}), id: p.id }) as CollectionDef

/** The records a collection holds, as `viewer` may know them (rule 7): its git file's (members') and the store's they are
 *  admitted to are counted; `hidden` when the store holds any they may not read, whose number is never said. With no
 *  viewer (the file check, git alone), every record counts. */
function recordsHeld(repo: string, id: string, store: PrivateStore | null, viewer: Viewer | null): { seen: number; hidden: boolean } {
  let git = 0
  if (registriesOf(repo).some(d => d.name === id && d.custom)) {
    try { git = currentEntries(repo, id).length } catch { git = 0 }
  }
  const kept = store ? store.records(id) : []
  const admitted = viewer === null ? kept : kept.filter(r => admits(levelOfToken(r.visibility), viewer))
  return { seen: git + admitted.length, hidden: admitted.length < kept.length }
}

/** The removal's refusal, when the collection holds records: counted only when the viewer may read every one. */
function refuseHeld(held: { seen: number; hidden: boolean }): void {
  if (held.hidden) throw new Refusal(409, { error: HOLDS_HIDDEN_RECORDS, code: 'HOLDS_RECORDS' })
  if (held.seen > 0) throw new Refusal(409, { error: HOLDS_RECORDS(held.seen), code: 'HOLDS_RECORDS' })
}

// ── data/collections.yaml, edited with the YAML document API so comments survive ───────────────────────

function collectionsSeq(doc: Document): YAMLSeq {
  const node = doc.get('collections')
  if (isSeq(node)) return node
  const seq = doc.createNode([]) as YAMLSeq
  doc.set('collections', seq)
  return seq
}
const itemId = (item: unknown): unknown => (isMap(item) ? (item as YAMLMap).get('id') : undefined)

/** data/collections.yaml as `edit` leaves it, from its text now (an absent file starts as `collections: []`). */
function editedText(repo: string, edit: (doc: Document, seq: YAMLSeq) => void): string {
  const doc = parseDocument(fileText(repo, COLLECTIONS_FILE) ?? 'collections: []\n')
  edit(doc, collectionsSeq(doc))
  return doc.toString(STRINGIFY)
}

/** The entry `def` as a mapping in place: its own node kept (and the comments on it), each key set or removed. */
function putEntry(doc: Document, seq: YAMLSeq, def: CollectionDef): void {
  const at = seq.items.findIndex(item => itemId(item) === def.id)
  if (at < 0) { seq.items.push(doc.createNode(def)); return }
  const item = seq.items[at]
  if (!isMap(item)) { seq.items[at] = doc.createNode(def); return }
  const map = item as YAMLMap
  for (const key of map.items.map(p => String((p.key as { value?: unknown })?.value ?? p.key))) {
    if (key !== 'id' && !Object.hasOwn(def, key)) map.delete(key)
  }
  for (const [key, value] of Object.entries(def)) {
    if (key === 'id') continue
    if (JSON.stringify(map.toJSON()[key]) === JSON.stringify(value)) continue // untouched: its bytes stay
    map.set(key, doc.createNode(value))
  }
}

// ── writing to git ────────────────────────────────────────────────────────────────────────────────────

/** The file op that writes `def`'s new contact fields' level into data/visibility.yaml (L6 §7.3: defaults.contact, a
 *  narrowing); null when it has none new, or the org keeps no contact level. */
function contactOp(repo: string, def: CollectionDef): FileOp | null {
  const policy = readConfig(repo)
  const level = contactLevel(policy)
  if (level === null) return null
  const declared = policy.collections?.[def.id]?.fields ?? {}
  const fields = contactFieldsOf(def).filter(f => !Object.hasOwn(declared, f))
  if (fields.length === 0) return null
  const was = fileText(repo, VISIBILITY_FILE)
  let text = was ?? ''
  for (const f of fields) text = policyText(text, def.id, f, formatLevel(level))
  return { op: 'file', path: VISIBILITY_FILE, text, base: fileBase(repo, VISIBILITY_FILE) }
}

type GitWrite = { commit: string } | { staged: true }

/**
 * One workspace write of data/collections.yaml (§3.2, §3.4): `ops` (the definitions file first, then the files that go
 * with it: a narrowing of data/visibility.yaml, a removed collection's empty records file) are judged by the workspace ops
 * alone, at their targets (`workspace:collections`, `workspace:<id>`): data/visibility.yaml rides along only to narrow
 * (ruling P-6). Direct: one commit, `Org-Rule: workspace/direct`. Raised: staged in the actor's change. The caller holds
 * the repository's write lock.
 */
async function writeGit(deps: CollectionsDeps, actor: KnownActor, ops: FileOp[], message: string): Promise<GitWrite> {
  const { repo } = deps
  const judged = ops.filter(op => op.path !== VISIBILITY_FILE)
  const classes = classesOf(judged, repo)
  const targets = targetsOfOps(judged, repo)
  const ctx = readRuleContext(repo, actor)
  const rule = effectiveRule(ctx, classes, targets)
  if (!rule.direct) {
    if (!rule.proposable) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
    const changes = new ChangeStore(repo)
    const now = new Date().toISOString()
    const change = changes.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: now, updated: now, ops: [] }
    const { ops: staged, errors } = stage(repo, change.ops, ops)
    if (errors.length > 0) refuse(errors)
    changes.save({ ...change, ops: staged, updated: now })
    deps.notify({ type: 'changes' })
    return { staged: true }
  }
  const hat = hatsActedUnder(ctx, classes, targets).join(', ')
  const { commit } = await applyOps(repo, ops, {
    message,
    trailers: { actor: actorTrailer(actor), change: newChangeId(), rule: ruleIds(ctx, classes, targets).map(id => `${id}/direct`).join(','), ...(hat !== '' ? { hat } : {}) },
    ident: commitIdent(actor),
    precheck: () => {
      const now = effectiveRule(readRuleContext(repo, actor), classes, targets)
      if (!now.direct) throw new Refusal(403, { reason: now.sentence, error: now.sentence })
    },
  })
  if (commit === null) throw new HttpError(409, 'Nothing changed: data/collections.yaml already holds this. Nothing was written.', 'UNCHANGED')
  return { commit }
}

/** The file op that writes data/collections.yaml as `edit` leaves it. */
const definitionsOp = (repo: string, edit: (doc: Document, seq: YAMLSeq) => void): FileOp =>
  ({ op: 'file', path: COLLECTIONS_FILE, text: editedText(repo, edit), base: fileBase(repo, COLLECTIONS_FILE) })

// ── a private collection's definition, in the store ───────────────────────────────────────────────────

/** The store, or its 503 in L5's words. */
function storeFor(access: PrivateAccess): PrivateStore {
  const { store, why } = reach(access)
  if (!store) throw unavailable(why)
  return store
}

/** A private collection's definition is a workspace write (ruling R-1a) that applies at once: written only where the rule
 *  for `workspace:collections` lets this actor write alone. A raised one cannot be staged (the change file is in the state
 *  directory, the store keeps no staged definition): refused with the rule's sentence. */
function mayWritePrivate(repo: string, actor: KnownActor): void {
  const targets = targetsOfOps([{ op: 'file', path: COLLECTIONS_FILE, text: null, base: null }], repo)
  const rule = effectiveRule(readRuleContext(repo, actor), ['workspace'], targets)
  if (!rule.direct) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
}

// ── the body ────────────────────────────────────────────────────────────────────────────────────────

async function body(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}

/** A definition from a request body: its keys but `visibility` (a level, not part of the definition). */
function definitionOf(raw: Record<string, unknown>, id: string): CollectionDef {
  const { visibility: _level, ...rest } = raw
  return { ...rest, id } as CollectionDef
}

/** The level a body asks for: undefined or members for git, a hat or role for the store; `public` and anything else refused. */
function levelAsked(id: string, raw: Record<string, unknown>): string | null {
  const v = raw.visibility
  if (v === undefined || v === null || v === 'members') return null
  if (v === 'public') refuse([{ record: `collections:${id}`, field: 'visibility', message: DEFINED_AT_MEMBERS }])
  const l = typeof v === 'string' ? parseLevel(v) : null
  if (!l || gitAllows(l)) refuse([{ record: `collections:${id}`, field: 'visibility', message: NOT_A_LEVEL(String(v)) }])
  return formatLevel(l!)
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────

export function mountCollections(app: Hono, deps: CollectionsDeps): void {
  const { repo, withLock, privateStore } = deps

  app.get('/api/collections', c => {
    const viewer = viewerOf(c)
    const read = gitDefinitions(repo)
    const git = gateItems(viewer, read.collections.map(d => ({ ...d, builtin: isBuiltin(d.id) })), () => MEMBERS)
    const priv = gateItems(viewer, storeCollections(repo, privateStore), p => levelOfToken(p.visibility))
      .map(p => ({ ...asView(p), visibility: p.visibility, builtin: false }))
    return c.json({ collections: [...git, ...priv] as CollectionView[], problems: read.problems })
  })

  app.post('/api/collections', async c => {
    const raw = await body(c)
    if (!isObj(raw) || typeof raw.id !== 'string') throw new HttpError(400, BODY)
    const id = raw.id
    const level = levelAsked(id, raw)
    const def = definitionOf(raw, id)
    return withLock(async () => {
      const actor = knownActorOf(c)
      const store = level === null ? null : storeFor(privateStore)
      // Every name taken, a private collection's the actor may not read included: two collections never share an id.
      const known = [...gitNames(repo), ...privateReads(privateStore).collections().map(p => p.id)]
      const bad = collectionIdProblem(id, known)
      if (bad) refuse(errorsOf(id, [{ field: 'id', message: bad }]))
      if (level === null) {
        // A git collection's relation names a collection git knows, itself included.
        refuseAny(errorsOf(id, definitionProblems(def, { builtin: false, collections: [...gitNames(repo), id] })))
        refuseAny(errorsOf(id, definitionViewProblems(repo, def)))
        const op = definitionsOp(repo, (doc, seq) => putEntry(doc, seq, def))
        const narrow = contactOp(repo, def)
        const out = await writeGit(deps, actor, [op, ...(narrow ? [narrow] : [])], `collections: define ${id}`)
        return c.json({ id, ...out }, 201)
      }
      if (!admits(levelOfToken(level), viewerOf(c))) throw new Refusal(403, { code: 'NOT_ADMITTED', error: NOT_ADMITTED(id, level) })
      const names = [...gitNames(repo), ...storeCollections(repo, privateStore).filter(p => admits(levelOfToken(p.visibility), viewerOf(c))).map(p => p.id), id]
      refuseAny(errorsOf(id, definitionProblems(def, { builtin: false, collections: names })))
      mayWritePrivate(repo, actor)
      const { id: _id, ...definition } = def
      try { await store!.putCollection({ id, visibility: level, definition }, actor.id) } catch (err) { throw unavailable(err, store) }
      return c.json({ id, visibility: level }, 201)
    })
  })

  app.put('/api/collections/:id', async c => {
    const id = c.req.param('id')
    const raw = await body(c)
    if (!isObj(raw) || (raw.id !== undefined && raw.id !== id)) throw new HttpError(400, BODY)
    const def = definitionOf(raw, id)
    return withLock(async () => {
      const actor = knownActorOf(c)
      if (gitNames(repo).has(id)) {
        if (raw.visibility !== undefined && raw.visibility !== null && raw.visibility !== 'members') {
          refuse(errorsOf(id, [{ field: 'visibility', message: raw.visibility === 'public' ? DEFINED_AT_MEMBERS : LEVEL_BY_CONTROL }]))
        }
        refuseAny(errorsOf(id, definitionProblems(def, { builtin: isBuiltin(id), collections: [...gitNames(repo)] })))
        refuseAny(errorsOf(id, definitionViewProblems(repo, def)))
        const op = definitionsOp(repo, (doc, seq) => putEntry(doc, seq, def))
        const narrow = isBuiltin(id) ? null : contactOp(repo, def)
        const out = await writeGit(deps, actor, [op, ...(narrow ? [narrow] : [])], `collections: change ${id}`)
        return c.json({ id, ...out })
      }
      const found = admittedPrivate(repo, privateStore, c, id)
      if (!found) throw new HttpError(404, NO_COLLECTION(id), 'NO_COLLECTION')
      if (raw.visibility !== undefined && raw.visibility !== found.visibility) refuse(errorsOf(id, [{ field: 'visibility', message: LEVEL_BY_CONTROL }]))
      const store = storeFor(privateStore)
      const names = [...gitNames(repo), ...storeCollections(repo, privateStore).filter(p => admits(levelOfToken(p.visibility), viewerOf(c))).map(p => p.id)]
      refuseAny(errorsOf(id, definitionProblems(def, { builtin: false, collections: names })))
      mayWritePrivate(repo, actor)
      const { id: _id, ...definition } = def
      try { await store.putCollection({ id, visibility: found.visibility, definition }, actor.id) } catch (err) { throw unavailable(err, store) }
      return c.json({ id, visibility: found.visibility })
    })
  })

  app.delete('/api/collections/:id', c => withLock(async () => {
    const id = c.req.param('id')
    const actor = knownActorOf(c)
    const listed = gitDefinitions(repo).collections.some(d => d.id === id)
    if (listed) {
      const custom = !isBuiltin(id)
      if (custom) {
        refuseHeld(recordsHeld(repo, id, reach(privateStore).store, viewerOf(c)))
      }
      const op = definitionsOp(repo, (_doc, seq) => { seq.items = seq.items.filter(item => itemId(item) !== id) })
      // A custom collection's records file, empty now, goes with its definition.
      const records = custom ? customFileOf(id) : null
      const gone: FileOp[] = records !== null && fileText(repo, records) !== null ? [{ op: 'file', path: records, text: null, base: fileBase(repo, records) }] : []
      const out = await writeGit(deps, actor, [op, ...gone], `collections: remove ${id}`)
      return c.json({ id, ...out })
    }
    const found = admittedPrivate(repo, privateStore, c, id)
    if (!found) throw new HttpError(404, NO_COLLECTION(id), 'NO_COLLECTION')
    const store = storeFor(privateStore)
    refuseHeld(recordsHeld(repo, id, store, viewerOf(c)))
    mayWritePrivate(repo, actor)
    try { await store.deleteCollection(id, actor.id) } catch (err) { throw unavailable(err, store) }
    return c.json({ id })
  }))

  app.put('/api/collections/:id/views/:view', async c => {
    const id = c.req.param('id'), viewId = c.req.param('view')
    const raw = await body(c)
    if (!isObj(raw) || (raw.id !== undefined && raw.id !== viewId)) throw new HttpError(400, VIEW_BODY)
    const view = { id: viewId, ...raw, filters: Array.isArray(raw.filters) ? raw.filters : (raw.filters ?? []) } as SavedView
    return withLock(async () => {
      const actor = knownActorOf(c)
      const inGit = gitNames(repo).has(id)
      const found = inGit ? null : admittedPrivate(repo, privateStore, c, id)
      if (!inGit && !found) throw new HttpError(404, NO_COLLECTION(id), 'NO_COLLECTION')
      const problems = viewProblems(view)
      if (problems.length > 0) refuse(errorsOf(id, problems.map(p => ({ field: `views.${viewId}${p.field ? `.${p.field}` : ''}`, message: p.message }))))
      // M-1 (PF-R116): a git collection's view is written where every member reads it.
      if (inGit) refuseAny(errorsOf(id, viewRestrictedProblems(view, keptFromViews(repo, id)).map(p => ({ field: `views.${viewId}.${p.field}`, message: p.message }))))
      const withView = (views: unknown): SavedView[] => {
        const list = Array.isArray(views) ? [...views] as SavedView[] : []
        const at = list.findIndex(v => isObj(v) && v.id === viewId)
        if (at >= 0) list[at] = view; else list.push(view)
        return list
      }
      if (inGit) {
        const op = definitionsOp(repo, (doc, seq) => {
          const at = seq.items.findIndex(item => itemId(item) === id)
          if (at < 0) { seq.items.push(doc.createNode({ id, views: [view] })); return }
          const item = seq.items[at] as YAMLMap
          const views = item.get('views')
          if (!isSeq(views)) { item.set('views', doc.createNode([view])); return }
          const vat = views.items.findIndex(v => itemId(v) === viewId)
          if (vat >= 0) views.items[vat] = doc.createNode(view); else views.items.push(doc.createNode(view))
        })
        const out = await writeGit(deps, actor, [op], `collections: view ${viewId} of ${id}`)
        return c.json({ id, view: viewId, ...out })
      }
      const store = storeFor(privateStore)
      mayWritePrivate(repo, actor)
      const definition = isObj(found!.definition) ? found!.definition : {}
      try { await store.putCollection({ id, visibility: found!.visibility, definition: { ...definition, views: withView(definition.views) } }, actor.id) } catch (err) {
        throw unavailable(err, store)
      }
      return c.json({ id, view: viewId })
    })
  })

  /** The collection `id` when the viewer may see it: one git knows, or a private one they are admitted to; else 404. */
  const visibleCollection = (c: Context, id: string): void => {
    if (gitNames(repo).has(id) || admittedPrivate(repo, privateStore, c, id)) return
    throw new HttpError(404, NO_COLLECTION(id), 'NO_COLLECTION')
  }

  app.get('/api/view-state/:collection', c => {
    const collection = c.req.param('collection')
    const actor = knownActorOf(c)
    visibleCollection(c, collection)
    const store = storeFor(privateStore)
    let state: unknown
    try { state = store.viewState(actor.id, collection) } catch (err) { throw unavailable(err, store) }
    return c.json({ collection, state })
  })

  app.put('/api/view-state/:collection', async c => {
    const collection = c.req.param('collection')
    const raw = await body(c)
    if (!isObj(raw) || !Object.hasOwn(raw, 'state')) throw new HttpError(400, STATE_BODY)
    const actor = knownActorOf(c)
    visibleCollection(c, collection)
    const store = storeFor(privateStore)
    try { await store.putViewState(actor.id, collection, raw.state) } catch (err) { throw unavailable(err, store) }
    return c.json({ collection, state: raw.state ?? null })
  })
}

// ── data/collections.yaml edited whole (the source editor): the same checks ──────────────────────────────

/**
 * The definitions file's own check (registerFileCheck, Task 4's hook), at stage and at apply: what the new text adds that
 * `readCollections` cannot read (a problem the file already has is not refused again), and a custom collection it removes
 * while its records file still holds records (§7.4's sentence).
 */
export function collectionsFileErrors(repo: string, op: FileOp): RecordError[] {
  if (op.path !== COLLECTIONS_FILE) return []
  const before = gitDefinitions(repo)
  const after = op.text === null ? { collections: [], problems: [] } : readCollections(op.text, BUILTINS)
  const known = new Set(before.problems)
  const out: RecordError[] = after.problems.filter(p => !known.has(p)).map(p => {
    const at = p.indexOf(': ')
    return { record: COLLECTIONS_FILE, field: at < 0 ? '' : p.slice(0, at), message: at < 0 ? p : p.slice(at + 2) }
  })
  // M-1 (PF-R116): a saved view the new text adds that names a restricted field, however the file is edited.
  const restrictedIn = (defs: CollectionDef[]) => defs.flatMap(d => (Array.isArray(d.views) ? d.views : []).flatMap((v, i) =>
    viewRestrictedProblems(v, keptFromViews(repo, d.id, d)).map(p => `collections.${d.id}.views.${isObj(v) && typeof v.id === 'string' ? v.id : i}.${p.field}\u0000${p.message}`)))
  const had = new Set(restrictedIn(before.collections))
  for (const p of restrictedIn(after.collections).filter(p => !had.has(p))) {
    const [field, message] = p.split('\u0000') as [string, string]
    out.push({ record: COLLECTIONS_FILE, field, message })
  }
  for (const gone of before.collections.filter(d => !isBuiltin(d.id) && !after.collections.some(a => a.id === d.id))) {
    const n = recordsHeld(repo, gone.id, null, null).seen
    if (n > 0) out.push({ record: COLLECTIONS_FILE, field: `collections.${gone.id}`, message: HOLDS_RECORDS(n) })
  }
  return out
}
registerFileCheck(collectionsFileErrors)
