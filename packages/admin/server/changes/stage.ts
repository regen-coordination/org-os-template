import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readRegistry, parseForWrite, registryPath, knowledgeEntries, type Entity } from '../registry.ts'
import { REGISTRIES, registriesOf, registryDef, registryFileOf, type RegistryDef } from '../registries.ts'
import { validateEntity, referrers, type Overlay, type Referrer } from '../schema.ts'
import { addressability } from '../../lib/data-validate.mjs'
import { classOf, publishes } from '../../lib/change-classes.mjs'
import { canonReadDiffers, canonReadDiffersSentence, knowledgeIdParts } from '../../lib/workspace/knowledge.mjs'
import { checkFields } from '../knowledge/canon-text.ts'
import { HttpError } from '../errors.ts'
import { readConfig } from '../visibility/config.ts'
import { receiptProblems, judgedOps } from '../../lib/receipts.mjs'
import { readGovernance } from '../../lib/governance-read.mjs'
import { CHANGE_CLASSES } from '../../lib/change-classes.mjs'
import { checkGovernance, effectiveRules, membershipTree, nobodyCanPropose, resolveRoles } from '../../lib/rules.mjs'
import { GOVERNANCE_FIELDS, GOVERNANCE_ONLY, governanceEntries } from './governance-edit.ts'
import { actorTrailer, type Actor } from '../actor.ts'
import { effectiveRule, readRuleContext } from '../governance/effective.ts'
import { deriveChangeState } from '../../lib/machines/change.mjs'
import { pageReader, targetsOfPath } from '../../lib/workspace/targets.mjs'
import { mergeOp, isStale, rebased } from './merge.ts'
import {
  FILE_AND_RECORDS, fileClassOf, fileWidens, fileOpErrors, isFileOp, isFileStale, isRecordOp, mergeFileOp, mixedFileErrors, recordFilesOf, RECORDS_AND_FILE,
} from '../workspace/files.ts'
import { StageError, parseRecord, recordId, projectOp, notDeleted } from './records.ts'
import { compositionErrors } from './composition.ts'
import { isComposed } from '../../lib/compose.mjs'
import { CHAIN_HELD_SENTENCE, chainHeldChanges } from '../../lib/chain-held.mjs'
import { governanceNamesOf } from '../../lib/narrow.mjs'
import { restoreProblems } from './restores.ts'
import type { Change, ChangeView, Op, PrivateEntry, PrivatePlaceholder, RecordError, RecordOp, StageOp } from './types.ts'

/** Whether an entry's id is `id`, as strings (F1's reading: an id of 42 is addressable as "42"). */
export const named = (e: Entity, id: string): boolean => e.id !== undefined && e.id !== null && String(e.id) === id

/** An entry as ops are staged against it: the entry itself, but for the `governance` one, which is the file's
 *  `{ roles, rules }` (no id): that is what its base hashes (L7-D10). */
function recordOf(registry: string, entry: Entity | null): Entity | null {
  if (registry !== 'governance' || entry === null) return entry
  const { id: _id, ...fields } = entry  // the same shape as canonical.ts's governanceRecord
  return fields
}

/** A registry's entries as the file holds them now (its own file, L6 §7.1); [] when there is no file. With `strict`, a
 *  file with YAML errors is refused (409, the writes' own sentence) rather than read in part. */
export function currentEntries(repo: string, registry: string, strict = false): Entity[] {
  const def = registryDef(registry, repo)
  // Knowledge (L6 §7.5, Task 10): every canon file's records, ids `<type>/<slug>`.
  if (def.filesGlob !== undefined) return knowledgeEntries(repo, strict)
  const path = registryPath(repo, def)
  if (!existsSync(path)) return []
  // The one entry of `governance` is the file's roles and rules (L7-D10).
  if (registry === 'governance') return governanceEntries(readFileSync(path, 'utf8'))
  if (strict) parseForWrite(readFileSync(path, 'utf8'), def, 'saved')
  return readRegistry(repo, def).entries ?? []
}

/** The file a registry's entries are in, as a sentence names it (L6 §7.1). */
const fileIn = (defs: readonly RegistryDef[], registry: string): string =>
  registryFileOf(defs.find(d => d.name === registry) ?? { name: registry })

/** The file a record op writes (L6 §7.1): its registry's own, or for knowledge its kind's (`data/kb/<type>.yaml`, Task 10).
 *  `defs`: the instance's list (`registriesOf`). */
export function recordFileOf(repo: string, record: string, defs: readonly RegistryDef[] = registriesOf(repo)): string {
  const { registry, id } = parseRecord(record, defs)
  return registryFileOf(registryDef(registry, repo), id)
}

/** What is said when a knowledge op is not a field edit (Task 10, R-L6-T10-2): the canon's entries are added by kms. */
export const KNOWLEDGE_FIELDS_ONLY = 'A knowledge entry is changed here field by field: kms adds entries to the canon, and an entry is removed in its file. Nothing was staged.'
/** What is said when a knowledge op names no `<type>/<slug>`. */
export const KNOWLEDGE_ID = (record: string): string =>
  `"${record}" names no knowledge entry: a knowledge record is written knowledge:<type>/<slug>, for example knowledge:claim-evidence/my-claim. Nothing was staged.`

/** A knowledge op (Task 10) is an update of its entry's fields, as the commons' entry page edits them: the fields named as kms
 *  names them, never the entry's identity (`id`, `type`, `slug`), each a text, a number, a yes/no, a list of those, or null to
 *  clear it (server/knowledge/canon-text.ts `checkFields`). A create, a delete or a whole-entry replace is refused. With
 *  `repo`, an op on a canon file kms reads differently from the house (anchors, merge keys, tags: ruling PF-R2, fail closed)
 *  is refused too, its sentence ending in `tail`. */
export function knowledgeOpErrors(ops: StageOp[], defs: readonly RegistryDef[] = REGISTRIES, repo?: string,
  tail = 'Nothing was staged.'): RecordError[] {
  const differs = new Map<string, string | null>()
  const differsIn = (rel: string): string | null => {
    if (!differs.has(rel)) {
      let text: string | null = null
      try { text = readFileSync(join(repo!, rel), 'utf8') } catch { text = null }
      differs.set(rel, canonReadDiffers(text))
    }
    return differs.get(rel)!
  }
  return ops.filter(isRecordOp).flatMap((op): RecordError[] => {
    let registry: string; let id: string
    try { ({ registry, id } = parseRecord(op.record, defs)) } catch (err) { if (err instanceof StageError) return []; throw err }
    if (defs.find(d => d.name === registry)?.filesGlob === undefined) return []
    const parts = knowledgeIdParts(id)
    if (parts === null) return [{ record: op.record, field: 'id', message: KNOWLEDGE_ID(op.record) }]
    const rel = `data/kb/${parts.type}.yaml`
    const why = repo === undefined ? null : differsIn(rel)
    if (why !== null) return [{ record: op.record, field: '', message: canonReadDiffersSentence(rel, why, tail) }]
    if (op.op !== 'update') return [{ record: op.record, field: '', message: KNOWLEDGE_FIELDS_ONLY }]
    try { checkFields(op.set) } catch (err) {
      if (!(err instanceof HttpError)) throw err
      const field = /^"([^"]+)"/.exec(err.message)?.[1] ?? ''
      return [{ record: op.record, field, message: err.message }]
    }
    return []
  })
}

/** Reads each registry at most once for one request. */
function reader(repo: string, strict = false) {
  const defs = registriesOf(repo)
  const seen = new Map<string, Entity[]>()
  const entries = (registry: string): Entity[] => {
    let e = seen.get(registry)
    if (!e) { e = currentEntries(repo, registry, strict); seen.set(registry, e) }
    return e
  }
  const current = (record: string): Entity | null => {
    const { registry, id } = parseRecord(record, defs)
    return recordOf(registry, entries(registry).find(e => named(e, id)) ?? null)
  }
  return { entries, current, defs }
}

export const currentOf = (repo: string, record: string): Entity | null => reader(repo).current(record)

/** The walk's I5 (review G6): every update op whose fields the trunk left alone since it was staged, re-based on the
 *  record as it is now (`rebased`), silently; every other op as it is. A record that cannot be read leaves its op as it is. */
export function freshen<O extends Op>(repo: string, ops: O[]): O[] {
  if (!ops.some(op => op.op === 'update')) return ops
  const read = reader(repo)
  return ops.map((op): O => {
    if (op.op !== 'update') return op
    try { return rebased(op, read.current(op.record)) as O } catch { return op }
  })
}

/** Every registry the ops touch, as the ops would leave it. `defs` is the registry list the records are read against. */
export function project(entriesOf: (registry: string) => Entity[], all: StageOp[],
  defs: readonly RegistryDef[] = REGISTRIES): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>()
  // A file op (L6 §11.2) writes its file whole: no registry's entries are projected from it.
  const ops = all.filter(isRecordOp)
  for (const op of ops) {
    const { registry } = parseRecord(op.record, defs)
    if (!out.has(registry)) out.set(registry, entriesOf(registry).map(e => ({ ...e })))
  }
  for (const op of ops) projectOp(out, op, defs)
  return out
}

/** Field errors of every entry the ops write: a create's or replace's value as sent, an update's
 *  entry as it would be. References are read through `projected`, the change's own state. */
export function entryErrors(repo: string, ops: StageOp[], projected: Map<string, Entity[]>): RecordError[] {
  const overlay: Overlay = registry => projected.get(registry)
  const defs = registriesOf(repo)
  const errors: RecordError[] = []
  for (const op of ops.filter(isRecordOp)) {
    if (op.op === 'delete') continue
    const { registry, id } = parseRecord(op.record, defs)
    const entry = op.op === 'update' ? projected.get(registry)?.find(e => named(e, id)) : op.value
    if (!entry) continue
    if (registry === 'governance') { errors.push(...governanceErrors(repo, op.record, entry, projected)); continue }
    for (const e of validateEntity(repo, registry, entry, overlay).errors) {
      errors.push({ record: op.record, field: e.field, message: e.message })
    }
  }
  return errors
}

/** The governance block the file holds with `entry`'s roles and rules in place of its own: what the written rules are
 *  judged as, once the change is applied. Null when there is no governance file to read. */
function governanceAfter(repo: string, entry: Entity): Record<string, unknown> | null {
  let text: string
  try { text = readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8') } catch { return null }
  const block = readGovernance(text).governance as Record<string, unknown> | null
  if (!block) return null
  const next: Record<string, unknown> = { ...block }
  for (const key of GOVERNANCE_FIELDS) { if (entry[key] !== undefined) next[key] = entry[key]; else delete next[key] }
  return next
}

/** What `checkGovernance` refuses in the roles and rules a governance op writes, judged with the members and systems
 *  as the change leaves them. Its sentences, as the validator says them; the lockout is `lockoutErrors`'s. */
function governanceErrors(repo: string, record: string, entry: Entity, projected: Map<string, Entity[]>): RecordError[] {
  const governance = governanceAfter(repo, entry)
  if (!governance) return []
  const known = (registry: string): Entity[] | null => {
    try { return projected.get(registry) ?? currentEntries(repo, registry) } catch { return null }
  }
  return checkGovernance(governance, { members: known('members'), systems: known('systems'), classes: CHANGE_CLASSES })
    .filter(p => p.level === 'error')
    .map(p => ({ record, field: '', message: p.message }))
}

/** An op on `governance:governance` that is not an update of its roles or rules (L7-D10): refused, one error per op. */
export function governanceShapeErrors(ops: RecordOp[]): RecordError[] {
  return ops.flatMap((op): RecordError[] => {
    let registry: string
    try { registry = parseRecord(op.record).registry } catch (err) {
      // `governance:<anything but governance>` is refused by parseRecord with this very sentence; it is not read as an unknown record.
      if (err instanceof StageError && err.message === GOVERNANCE_ONLY) return [{ record: op.record, field: '', message: GOVERNANCE_ONLY }]
      if (err instanceof StageError) return []
      throw err
    }
    if (registry !== 'governance') return []
    const only = op.op === 'update' && Object.keys(op.set).every(k => (GOVERNANCE_FIELDS as readonly string[]).includes(k))
    return only ? [] : [{ record: op.record, field: '', message: GOVERNANCE_ONLY }]
  })
}

/** The governance block as the change leaves it (its roles and rules op applied), else as the file holds it; null when
 *  there is none to read. */
function governanceNow(repo: string, projected: Map<string, Entity[]>): Record<string, unknown> | null {
  const entry = projected.get('governance')?.[0]
  if (entry) { const after = governanceAfter(repo, entry); if (after) return after }
  try { return readGovernance(readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')).governance as Record<string, unknown> | null } catch { return null }
}

/** The entries that would still name a deleted record, read through `projected`; for a System, also the places
 *  data/governance.yaml names it (the membership tree, a rule decided by it: `governanceNamesOf`), so its delete
 *  refuses on governance as on any record (L7 Task 2's carry, closed by the Tasks 19/17 review). */
export function deleteRefs(repo: string, op: RecordOp, projected: Map<string, Entity[]>): Referrer[] {
  const { registry, id } = parseRecord(op.record, registriesOf(repo))
  const refs = referrers(repo, registry, id, r => projected.get(r))
  return registry === 'systems' ? [...refs, ...governanceNamesOf(governanceNow(repo, projected), registry, id)] : refs
}

/** What is said when a change would write a deployed System back to `composed` (L7 Tasks 19/17 review, I1). */
export const NOT_RECOMPOSED = (id: string): string =>
  `System "${id}" is deployed: the chain holds it, so it is not written back to composed. Change it on its own record, or compose a new System.`

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** An op on a `systems` record that sets `deployment.status: composed` on a System that is deployed — one the change
 *  found deployed (no `deployment`, or not `composed`), holding an address, or the governance's membership tree — is
 *  refused: the composition's ops would otherwise unset the tree a wallet signs in by (review I1). `before` reads the
 *  Systems before the change. */
export function recomposedErrors(repo: string, ops: StageOp[], before: (registry: string) => Entity[]): RecordError[] {
  const defs = registriesOf(repo)
  const setsComposed = ops.filter(isRecordOp).filter(op => {
    let registry: string
    try { ({ registry } = parseRecord(op.record, defs)) } catch { return false }
    if (registry !== 'systems') return false
    const d = op.op === 'update' ? op.set.deployment : op.op === 'replace' ? op.value.deployment : undefined
    return isObj(d) && d.status === 'composed'
  })
  if (setsComposed.length === 0) return []
  let was: Entity[]
  try { was = before('systems') } catch { return [] } // an unreadable systems file is its own check's to say
  const governance = governanceNow(repo, new Map())
  const tree = isObj(governance?.membership) ? governance.membership.tree : undefined
  return setsComposed.flatMap(op => {
    const { id } = parseRecord(op.record, defs)
    const b = was.find(e => named(e, id))
    if (!b) return []
    const address = typeof b.address === 'string' ? b.address !== '' : b.address !== undefined && b.address !== null
    return !isComposed(b) || address || tree === id ? [{ record: op.record, field: 'deployment.status', message: NOT_RECOMPOSED(id) }] : []
  })
}

/**
 * L7 gap B1 (PF-R224's words made one rule): a field the chain holds of a deployed System (`lib/chain-held.mjs`: its
 * address, chain, kind, deployment but its `on_deploy`, a Safe's gate, a tree's hats, a space's id, a registration's
 * name) is not written by hand on any path; every other field is edited as any record's. Judged on each Systems record
 * in `records` that the change leaves standing, the record before the change (`before`) against the one it leaves
 * (`projected`), so a whole-record replace is judged field by field. The read-back's own writes on a deployed System (a
 * tree's wearers dropped, a Safe's `on_deploy` taken out) change nothing the chain holds, so they pass; flipping a
 * composed System to deployed is no change of a deployed one. A deployment PF-R165's refusal names is not said again.
 */
export function chainHeldErrors(repo: string, records: Iterable<string>, projected: Map<string, Entity[]>,
  before: (registry: string) => Entity[], said: readonly RecordError[] = []): RecordError[] {
  const defs = registriesOf(repo)
  const ids = [...records].flatMap(record => {
    try { const r = parseRecord(record, defs); return r.registry === 'systems' ? [{ record, id: r.id }] : [] } catch { return [] }
  })
  if (ids.length === 0) return []
  let was: Entity[]
  try { was = before('systems') } catch { return [] } // an unreadable systems file is its own check's to say
  const now = projected.get('systems') ?? was
  const out: RecordError[] = []
  for (const { record, id } of ids) {
    const b = was.find(e => named(e, id))
    const a = now.find(e => named(e, id))
    if (!b || !a) continue
    for (const field of chainHeldChanges(b, a)) {
      // PF-R165 already refuses this deployment whole: its sentence is the one said of it
      if (field.startsWith('deployment') && said.some(e => e.record === record && e.field.startsWith('deployment'))) continue
      out.push({ record, field, message: CHAIN_HELD_SENTENCE(field) })
    }
  }
  return out
}

/** Ops that cannot say which entry they mean: no id after the colon, an entry the lists show as
 *  `#<position>` because it has no id, or an id more than one entry in its file uses (the
 *  interfaces file, "Entries the platform can't address"). The id rules are lib's `addressability`. `defs` is the registry
 *  list the records are read against (an instance's, `registriesOf(repo)`, holds its custom collections). */
export function idErrors(ops: StageOp[], entriesOf: (registry: string) => Entity[],
  defs: readonly RegistryDef[] = REGISTRIES): RecordError[] {
  const errors: RecordError[] = []
  for (const op of ops.filter(isRecordOp)) {
    let registry: string; let id: string
    try { ({ registry, id } = recordId(op.record, defs)) } catch (err) {
      if (!(err instanceof StageError)) throw err
      errors.push({ record: op.record, field: err.field, message: err.message })
      continue
    }
    const { noId, shared } = addressability(entriesOf(registry))
    const position = /^#(\d+)$/.exec(id)
    if (position && noId.includes(Number(position[1]) - 1)) {
      errors.push({ record: op.record, field: 'id', message: `entry ${id} in \`${fileIn(defs, registry)}\` has no id, so it cannot be changed here; give it one in the file.` })
      continue
    }
    const n = shared.get(id)
    if (n) errors.push({ record: op.record, field: 'id', message: `id \`${id}\` appears ${n} times in \`${fileIn(defs, registry)}\`; fix it in the file.` })
  }
  return errors
}

/** What is said when a change reaches for a ledger registry (`proposals`). */
export const LEDGER_SENTENCE = (registry: string): string =>
  `${registry} are changed by their own routes (Propose, and the buttons on a proposal), not by staging a change here; a hand edit of ${fileIn(REGISTRIES, registry)} is caught by validate:governance.`

/** What is said when a change reaches for an entry of a create-only registry (`invites`): it holds a token's hash and who used it. */
export const OWN_ROUTES_SENTENCE = (registry: string): string =>
  `${registry} are created here but never changed or removed by hand: an entry holds who used it, and only the federation routes write that. Nothing was staged.`

/** An op aimed at a ledger registry is refused: the ledger is written only by the proposal routes (spec §3.1).
 *  A record that names no registry is left for the checks that say so. */
export function ledgerErrors(ops: StageOp[], defs: readonly RegistryDef[] = REGISTRIES): RecordError[] {
  return ops.filter(isRecordOp).flatMap((op): RecordError[] => {
    let registry: string
    try { registry = parseRecord(op.record, defs).registry } catch (err) { if (err instanceof StageError) return []; throw err }
    const def = defs.find(d => d.name === registry)
    if (def?.ledger) return [{ record: op.record, field: '', message: LEDGER_SENTENCE(registry) }]
    // A create-only registry (invites): `create` passes; anything else could reset `used_by`.
    return def?.createOnly && op.op !== 'create' ? [{ record: op.record, field: '', message: OWN_ROUTES_SENTENCE(registry) }] : []
  })
}

/** F1's change classes of the ops the change is judged by, each once, in the order first met. A library receipt rides
 *  along (L1-C5, `judgedOps`): its class counts only in a change that holds nothing else. Stage, the tray's view,
 *  Apply's precheck, Propose and Revise all read the classes here. With `repo` (L5 §9.7), an op that widens what it
 *  writes (`widens`: a record made more public, a wallet link put in git) adds `publication` beside its registry's class;
 *  the record it is judged against is the one it was staged against (`before`), else the one git holds now. A record op is
 *  classed by its registry's file (L6 ruling P-5: a custom collection's `data/collections/<id>.yaml` and knowledge's
 *  `data/kb/**` have path rows only); with `repo`, the instance's own list (`registriesOf`) says which file that is. */
export function classesOf(ops: StageOp[], repo?: string): string[] {
  const judged = judgedOps(ops as (StageOp & { record: string })[]) as StageOp[]
  const defs = repo === undefined ? REGISTRIES : registriesOf(repo)
  const classes = judged.map(op => {
    if (isFileOp(op)) return fileClassOf(op) // L6 §11.2: its path's class
    const { registry, id } = parseRecord(op.record, defs)
    return String(classOf({ path: registryFileOf(registryDef(registry, repo), id) }))
  })
  // An op that publishes (L6 §13, `publishes`) is a publication: a record made more public, a page made public, a knowledge
  // object made publishable; a file op that loosens data/visibility.yaml, or whose records would widen as record ops (§11.2).
  if (repo !== undefined && judged.some(op => publishesHere(repo, op))) classes.push('publication')
  return [...new Set(classes)]
}

/** Whether `op` publishes (L6 §13), read against this repository: a file op through `fileWidens` (which reads the git pages
 *  for a page), a record op through `publishes` against the record it was staged against. */
export function publishesHere(repo: string, op: StageOp): boolean {
  return isFileOp(op) ? fileWidens(repo, op) : publishes(op, beforeOf(repo, op), readConfig(repo))
}

/** Where each op is judged (L6 §3.2): one target list per op the change is judged by (`judgedOps`), most specific first: a
 *  workspace op's targets (lib/workspace/targets.mjs: a record by its collection, through its registry's file; a page by its
 *  tree, read from the worktree), any other op's `[its class]`. A widening op adds `['publication']` once, as `classesOf`
 *  adds the class. `classesOf` keeps answering the base classes. */
export function targetsOfOps(ops: StageOp[], repo: string): string[][] {
  const judged = judgedOps(ops as (StageOp & { record: string })[]) as StageOp[]
  const defs = registriesOf(repo)
  const readDisk = (rel: string): string | null => { try { return readFileSync(join(repo, rel), 'utf8') } catch { return null } }
  const readPage = pageReader(readDisk)
  const lists = judged.flatMap(op => {
    // As `classesOf` reads it: the registry's own file (knowledge's: its kind's), or a file op's path (L6 §11.2).
    const file = isFileOp(op) ? op.path : recordFileOf(repo, op.record, defs)
    const here = targetsOfPath(file, readPage) ?? [isFileOp(op) ? fileClassOf(op) : String(classOf({ path: file }))]
    // DAO-OS L6 Task 7: a page's file op is judged where it is and where its text puts it (a new page, read with its own
    // parent; a move, under its new parent too), so a page staged under a raised tree stays under that tree's rule.
    if (!isFileOp(op) || op.text === null || !/^pages\/[^/]+\.md$/.test(op.path)) return [here]
    const text = op.text
    const there = targetsOfPath(file, pageReader(rel => (rel === op.path ? text : readDisk(rel))))
    return there && JSON.stringify(there) !== JSON.stringify(here) ? [here, there] : [here]
  })
  if (judged.some(op => publishesHere(repo, op))) lists.push(['publication'])
  return lists
}

/** `targetsOfOps` for a change, then its private part's: `privateTargets` when the caller read them from the store
 *  (server/private/targets.ts `changePrivateTargets`: each staged op at its own targets, Task 15 review I-1), else each
 *  placeholder at its class; and `['publication']` when one widens (L5 §10.3, §9.7). The change file names no private
 *  collection or page (a placeholder is its ref and class), so its targets are read from the store, never kept there. */
export function targetsOf(change: Pick<Change, 'ops' | 'private'> | null, repo: string, privateTargets?: string[][]): string[][] {
  const priv = change?.private ?? []
  return [...targetsOfOps(change?.ops ?? [], repo), ...(privateTargets ?? priv.map(p => [p.class])), ...(priv.some(p => p.publication) ? [['publication']] : [])]
}

/** The record an op was staged against (`Op.before`), else the one git holds now (an op that carries none). */
export function beforeOf(repo: string, op: StageOp): Record<string, unknown> | null {
  if (isFileOp(op)) return null // a file op names no record
  const before = (op as Partial<Extract<Op, { before: unknown }>>).before
  if (before !== undefined) return before
  try { return currentOf(repo, op.record) } catch { return null }
}

/** A change's classes: its git ops' (`classesOf`), then those of its private part (L5 §10.3: the rule judged is the class
 *  of the registry or private collection, as for git), each once. With `repo`, a widening op adds `publication` (§9.7). */
export function changeClasses(change: Pick<Change, 'ops' | 'private'> | null, repo?: string): string[] {
  const priv = change?.private ?? []
  return [...new Set([...classesOf(change?.ops ?? [], repo), ...priv.map(p => p.class), ...(priv.some(p => p.publication) ? ['publication'] : [])])]
}

/** The registries whose entries decide who can propose under the written rules (L5 spec §7.6): the members, and the
 *  systems that name the membership tree a wallet is judged by. */
const WHO_CAN_PROPOSE = ['members', 'systems', 'governance']

/**
 * L5 spec §7.6 and §8.1 point 4 (F-L3-1): no change leaves a written rule with nobody able to propose under it.
 * What can lock an org out here is a change to the roles or rules (L7-D10), or to the members or the systems they
 * are judged with. Each §7.6 sentence the change's state gives and the state before it
 * did not is refused, on the first op that touches those registries: an org already locked out is not refused again
 * for what the change did not bring.
 */
export function lockoutErrors(repo: string, ops: StageOp[], projected: Map<string, Entity[]>,
  before: (registry: string) => Entity[]): RecordError[] {
  const defs = registriesOf(repo)
  const touching = ops.filter(isRecordOp).find(op => WHO_CAN_PROPOSE.includes(parseRecord(op.record, defs).registry))
  if (!touching) return []
  const path = registryPath(repo, 'governance')
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return [] }
  const governance = readGovernance(text).governance as Record<string, unknown> | null
  if (!governance) return []
  // A change to the roles or rules is judged with the governance it leaves (L7-D10).
  const entry = projected.get('governance')?.[0]
  const after = entry ? governanceAfter(repo, entry) ?? governance : governance
  const said = (gov: Record<string, unknown>, members: Entity[], systems: Entity[] | null) => {
    const { rules, implied } = effectiveRules(gov)
    if (implied) return new Set<string>()
    const book = resolveRoles(gov, members)
    return new Set(rules.map(rule => nobodyCanPropose(rule, book, members, gov, systems)).filter((m): m is string => m !== null))
  }
  // A systems file that cannot be read is "no tree known" here: its own checks say what is wrong with it.
  let systems: Entity[] | null
  try { systems = before('systems') } catch { systems = null }
  const was = said(governance, before('members'), systems)
  const now = said(after, projected.get('members') ?? before('members'), projected.get('systems') ?? systems)
  return [...now].filter(m => !was.has(m)).map(message => ({ record: touching.record, field: '', message }))
}

/** What is said when a change would leave several deployed hats trees with none named (final L7 review I-1). It counts
 *  the trees and names none: one may be a System the actor does not read. */
export const NAME_THE_TREE = (n: number): string =>
  `Name the membership tree in data/governance.yaml first: this change would make ${n} deployed hats trees, and the Hub would no longer know which one holds the org's roles.`

/**
 * The membership tree (L5 spec §5.1, `membershipTree`) is the only deployed `hats-tree` System while
 * `governance.membership.tree` names none; with several it is none, and the org's wallets and hat-sourced roles are
 * read in no tree. A change that would bring that about (a read-back flipping a second tree live, a deployed tree
 * created or written by hand) is refused on its first Systems op, until the tree is named. An org already holding
 * several unnamed trees is not refused again for what the change did not bring (as `lockoutErrors`).
 */
export function membershipTreeErrors(repo: string, ops: StageOp[], projected: Map<string, Entity[]>,
  before: (registry: string) => Entity[]): RecordError[] {
  const defs = registriesOf(repo)
  const touching = ops.filter(isRecordOp).find(op => { try { return parseRecord(op.record, defs).registry === 'systems' } catch { return false } })
  if (!touching) return []
  const governance = governanceNow(repo, projected)
  if (isObj(governance?.membership) && typeof governance.membership.tree === 'string' && governance.membership.tree !== '') return []
  let was: Entity[]
  try { was = before('systems') } catch { return [] } // an unreadable systems file is its own check's to say
  const now = projected.get('systems') ?? was
  const deployedTrees = (xs: Entity[]) => xs.filter(s => isObj(s) && s.kind === 'hats-tree' && !isComposed(s)).length
  const n = deployedTrees(now)
  if (n < 2 || deployedTrees(was) >= 2) return []
  if (membershipTree(governance, now) !== null) return []
  // Said on the op that makes a tree deployed, else on the first Systems op.
  const tree = ops.filter(isRecordOp).find(op => {
    let id: string
    try { const r = parseRecord(op.record, defs); if (r.registry !== 'systems') return false; id = r.id } catch { return false }
    const e = now.find(x => named(x, id))
    return !!e && e.kind === 'hats-tree' && !isComposed(e)
  })
  return [{ record: (tree ?? touching).record, field: '', message: NAME_THE_TREE(n) }]
}

/** The change as a whole, judged against the state it leaves. Every op in `records` (default: all)
 *  has its written entry validated; and every record in `records` that no longer exists in that
 *  state (deleted, or a create folded away) must not be named by any entry still there. With the
 *  default, the references of every remaining op are checked, which is how removing an op that
 *  others depend on is refused. A library receipt keeps its add or its removal whole, judged over
 *  every op whatever `records` holds (lib/receipts.mjs): stage, unstage, Propose, Revise and
 *  Apply's backstop all see it. A change to a composed System is checked as the composition it leaves
 *  (`compositionErrors`, L7 §6). `entriesOf` is the current-file reader (default: lenient). A receipt is judged
 *  against the files before the change: `before`, when `entriesOf` reads them as the change leaves them (Apply's
 *  backstop), else `entriesOf`. `membership: false` leaves the membership tree out: a judgment on the whole (git and the
 *  private store) does, since the Hub reads the membership tree from git alone (PF-R228) and git's own judgment says it
 *  (the gaps review's I-3). */
export function validateChange(repo: string, all: StageOp[], records?: Iterable<string>,
  entriesOf: (registry: string) => Entity[] = r => currentEntries(repo, r),
  before: (registry: string) => Entity[] = entriesOf, opts: { membership?: boolean } = {}): RecordError[] {
  // A file op (L6 §11.2) is checked whole, against the file as it is, and never beside record ops on its own file.
  const files = all.filter(isFileOp)
  const fileErrors = [...mixedFileErrors(repo, all), ...files.flatMap(op => fileOpErrors(repo, op))]
  const ops = all.filter(isRecordOp)
  if (ops.length === 0) return fileErrors
  const touched = new Set(records ?? ops.map(o => o.record))
  const defs = registriesOf(repo)
  const projected = project(entriesOf, ops, defs)
  const errors = [...fileErrors, ...entryErrors(repo, ops.filter(o => touched.has(o.record)), projected)]
  for (const record of touched) {
    const { registry, id } = parseRecord(record, defs)
    if ((projected.get(registry) ?? entriesOf(registry)).some(e => named(e, id))) continue
    const refs = deleteRefs(repo, { op: 'delete', record }, projected)
    if (refs.length > 0) errors.push({ record, field: '', message: notDeleted(registry, id, refs) })
  }
  errors.push(...receiptProblems(ops, before))
  errors.push(...restoreProblems(ops, before))
  errors.push(...lockoutErrors(repo, ops, projected, before))
  if (opts.membership !== false) errors.push(...membershipTreeErrors(repo, ops, projected, before))
  // A composed System is checked as the composition the change leaves (L7 §6, P8), on what the records state; a deployed
  // one is never written back to composed (review I1).
  const recomposed = recomposedErrors(repo, ops.filter(o => touched.has(o.record)), before)
  errors.push(...recomposed)
  // What the chain holds of a deployed System is not written by hand (L7 gap B1).
  errors.push(...chainHeldErrors(repo, touched, projected, before, recomposed))
  errors.push(...compositionErrors(ops.filter(o => touched.has(o.record)), projected, before))
  return errors
}

/** `incoming` folded into `ops`, then every op it touched validated against the state the whole
 *  change leaves. When anything is refused, `ops` comes back as it was. A registry file with YAML
 *  errors throws the writes' own 409. */
export function stage(repo: string, ops: Op[], incoming: StageOp[], from?: ReadonlyMap<string, string>): { ops: Op[]; errors: RecordError[] } {
  // A file op and record ops on one file are never in one change (L6 §11.2): refused before anything is folded.
  const editedWhole = new Set([...ops, ...incoming].filter(isFileOp).map(op => op.path))
  const recordFiles = recordFilesOf(repo, [...ops, ...incoming])
  const mixed = [
    ...incoming.filter(isFileOp).filter(op => recordFiles.has(op.path)).map(op => ({ record: op.path, field: '', message: FILE_AND_RECORDS(op.path) })),
    ...incoming.filter(isRecordOp).flatMap(op => {
      const file = [...recordFilesOf(repo, [op])][0]
      return file !== undefined && editedWhole.has(file) && !incoming.some(o => isFileOp(o) && o.path === file)
        ? [{ record: op.record, field: '', message: RECORDS_AND_FILE(file) }] : []
    }),
  ]
  if (mixed.length > 0) return { ops, errors: mixed }
  const files = incoming.filter(isFileOp)
  if (files.length > 0) {
    const fileErrors = files.flatMap(op => fileOpErrors(repo, op))
    if (fileErrors.length > 0) return { ops, errors: fileErrors }
  }
  let folded = ops
  // `from`: the text an editing session's edit started from, per path (the walk's G5): a pending text it did not start
  // from is never replaced (the session merges over it first, `overPending`).
  for (const op of files) {
    try { folded = mergeFileOp(folded, op, repo, from?.get(op.path)) } catch (err) {
      if (!(err instanceof HttpError) || err.code !== 'CONFLICT') throw err
      return { ops, errors: [{ record: op.path, field: '', message: err.message }] }
    }
  }
  const records = incoming.filter(isRecordOp)
  if (records.length === 0) return { ops: folded, errors: [] }
  const read = reader(repo, true)
  const ledgered = [...ledgerErrors(records, read.defs), ...governanceShapeErrors(records)]
  if (ledgered.length > 0) return { ops, errors: ledgered }
  const fieldsOnly = knowledgeOpErrors(records, read.defs, repo)
  if (fieldsOnly.length > 0) return { ops, errors: fieldsOnly }
  const ambiguous = idErrors(records, read.entries, read.defs)
  if (ambiguous.length > 0) return { ops, errors: ambiguous }
  // G6: an op the trunk moved past without touching its fields is folded on the record as it is now.
  let next = freshen(repo, folded)
  const errors: RecordError[] = []
  const touched = new Set<string>()
  for (const op of records) {
    try {
      next = mergeOp(next, op, read.current(op.record), read.defs)
      touched.add(op.record)
    } catch (err) {
      if (!(err instanceof StageError)) throw err
      errors.push({ record: op.record, field: err.field, message: err.message })
    }
  }
  if (errors.length === 0) errors.push(...validateChange(repo, next, touched, read.entries))
  // The gaps review's M-3: what the chain holds is judged against the change it joins as well as the trunk, so a System
  // this change already made deployed (its read-back's flip) is not then hand-edited where the chain holds it.
  if (errors.length === 0 && ops.some(op => isRecordOp(op) && parseRecord(op.record, read.defs).registry === 'systems')) {
    const was = project(read.entries, ops.filter(isRecordOp), read.defs)
    const now = project(read.entries, next.filter(isRecordOp), read.defs)
    errors.push(...chainHeldErrors(repo, touched, now, r => was.get(r) ?? read.entries(r)))
  }
  return errors.length > 0 ? { ops, errors } : { ops: next, errors }
}

/** The positions of the ops whose record changed since they were staged. */
export function staleOps(repo: string, ops: Op[]): number[] {
  const read = reader(repo)
  return ops.flatMap((op, i) => ((isFileOp(op) ? isFileStale(repo, op) : isStale(op, read.current(op.record))) ? [i] : []))
}

/** What GET /api/changes answers: the change, its classes, the rule for this actor, which ops are
 *  stale, and each op's record as it is now. Its private part (L5 §10.3) is listed in `private`, each op as the person
 *  who staged it wrote it when `privateOf` can read it from the store (the change file holds placeholders only). */
export function changeView(repo: string, actor: Actor, change: Change | null,
  privateOf: (p: PrivatePlaceholder) => PrivateEntry['op'], privateTargets?: string[][]): ChangeView {
  const read = reader(repo)
  // G6: shown re-based where the trunk moved past an op without touching its fields.
  const ops = freshen(repo, change?.ops ?? [])
  const placeholders = change?.private ?? []
  // A file op names no record: its current is null, and it is stale when the file's blob moved (L6 §11.2).
  const current = ops.map(op => (isFileOp(op) ? null : read.current(op.record)))
  const classes = changeClasses(change, repo)
  const stale = ops.flatMap((op, i) => ((isFileOp(op) ? isFileStale(repo, op) : isStale(op, current[i] ?? null)) ? [i] : []))
  return {
    id: change?.id ?? '',
    actor: actorTrailer(actor),
    created: change?.created ?? '',
    updated: change?.updated ?? '',
    ops,
    classes,
    rule: effectiveRule(readRuleContext(repo, actor), classes, targetsOf(change, repo, privateTargets)),
    stale,
    current,
    state: deriveChangeState({ ops: [...ops, ...placeholders], stale }),
    ...(placeholders.length > 0 ? { private: placeholders.map(p => ({ ref: p.ref, class: p.class, op: privateOf(p) })) } : {}),
    ...(change?.revises !== undefined && ops.length + placeholders.length > 0 ? { revises: change.revises } : {}),
  }
}
