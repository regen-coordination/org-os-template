// Remove (DAO-OS L1): what an add created is deleted and its receipt marked removed, as one change in the actor's
// tray. A record edited since the add is deleted only when the person names it in `take`, and then all of them or
// none (Q-L1-3). A record already gone is skipped. A record another record names is refused by the engine's own
// delete check; the removal preview lists those referrers in advance.

import { execFileSync } from 'node:child_process'
import { HttpError } from '../errors.ts'
import { RECEIPTS } from '../../lib/receipts.mjs'
import { classesOf, currentEntries, named, project } from '../changes/stage.ts'
import { Refusal } from '../changes/apply.ts'
import { baseOf, governanceRecord } from '../changes/canonical.ts'
import { GOVERNANCE_FIELDS } from '../changes/governance-edit.ts'
import { parseRecord } from '../changes/records.ts'
import type { StageOp } from '../changes/types.ts'
import { entriesFromText, type Entity } from '../registry.ts'
import { referrers } from '../schema.ts'
import { governanceReferrers } from '../../lib/data-validate.mjs'
import { effectiveRule, readRuleContext } from '../governance/effective.ts'
import { isKnown, type Actor } from '../actor.ts'
import { loadLibrary } from './read.ts'
import type { Receipt, ReceiptDecision, RemovalPreview } from './types.ts'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const decision = (v: unknown): ReceiptDecision | null => (isObject(v) ? v as ReceiptDecision : null)

/** A receipt as the file holds it, in the API's shape. */
function toReceipt(e: Entity): Receipt {
  const removed = isObject(e.removed) ? { by: text(e.removed.by), at: text(e.removed.at), decision: decision(e.removed.decision) } : null
  return {
    id: String(e.id), entry: String(e.entry), version: String(e.version), shelf: String(e.shelf),
    created: (Array.isArray(e.created) ? e.created : []).filter(isObject).map(c => ({ record: String(c.record), base: text(c.base) })),
    ...(Array.isArray(e.modified)
      ? { modified: e.modified.filter(isObject).map(m => ({ record: String(m.record), base: text(m.base), after: text(m.after) })) }
      : {}),
    status: e.status === 'removed' ? 'removed' : 'installed', by: text(e.by), at: text(e.at), decision: decision(e.decision), removed,
  }
}

/** The items of data/library.yaml that are mappings; an item that is not (`- `, `- null`, a bare word) is no receipt
 *  and is skipped, as the schema's check says it. [] when there is no file. A file that will not parse is the writes'
 *  own 409. */
export function receiptEntries(repo: string): Entity[] {
  return currentEntries(repo, RECEIPTS, true).filter(isObject)
}

/** Every receipt in data/library.yaml, installed or removed; [] when there is no file. */
export function listReceipts(repo: string): Receipt[] {
  return receiptEntries(repo).map(toReceipt)
}

/** The receipts still installed; [] when data/library.yaml cannot be read, so the library's list and preview are
 *  served whatever that file holds. */
export function installedReceipts(repo: string): Receipt[] {
  try { return listReceipts(repo).filter(r => r.status === 'installed') } catch (err) {
    if (err instanceof HttpError) return []
    throw err
  }
}

/** The receipt `id`, or the 404 that says where the list is. */
export function findReceipt(repo: string, id: string): Receipt {
  const receipt = listReceipts(repo).find(r => r.id === id)
  if (!receipt) throw new HttpError(404, `No receipt "${id}". GET /api/library/receipts lists them.`)
  return receipt
}

type State = RemovalPreview['records'][number]['state']
interface RecordState { record: string; state: State; modified?: { base: string | null; now: Entity | null } }

/** A record as the engine stages against it: the entry, or for `governance:governance` its roles and rules (no id). */
function recordNow(record: string, entriesOf: (registry: string) => Entity[]): Entity | null {
  const { registry, id } = parseRecord(record)
  const now = entriesOf(registry).find(e => named(e, id))
  if (now === undefined) return null
  if (registry !== 'governance') return now
  const { id: _id, ...fields } = now
  return fields
}

/** Each record the receipt created, then each it modified (L7-D11), as it stands now: gone, edited since it was added,
 *  or as added. A modified record is as added while its hash is the receipt's `after`. */
function statesOf(receipt: Receipt, entriesOf: (registry: string) => Entity[]): RecordState[] {
  const created = receipt.created.map(({ record, base }): RecordState => {
    const now = recordNow(record, entriesOf)
    return { record, state: now === null ? 'gone' : baseOf(now) !== base ? 'edited' : 'as added' }
  })
  const modified = (receipt.modified ?? []).map(({ record, base, after }): RecordState => {
    const now = recordNow(record, entriesOf)
    return { record, state: now === null ? 'gone' : after === null || baseOf(now) !== after ? 'edited' : 'as added', modified: { base, now } }
  })
  return [...created, ...modified]
}

/** The version of `record` whose canonical hash is `base`, read from the history of its file with the repository's own
 *  git (read only): `git log` of `data/<registry>.yaml`, newest first, each commit's file read as the engine reads it
 *  (`governanceRecord` for `governance:governance`). Null when no commit holds it. */
export function restoreValue(repo: string, record: string, base: string): Record<string, unknown> | null {
  const { registry, id } = parseRecord(record)
  const file = `data/${registry}.yaml`
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  let commits: string[]
  try { commits = git(['log', '--format=%H', '--', file]).split('\n').filter(Boolean) } catch { return null }
  for (const sha of commits) {
    let value: Record<string, unknown> | null
    try {
      const text = git(['show', `${sha}:${file}`])
      value = registry === 'governance' ? governanceRecord(text) : entriesFromText(text, registry).find(e => named(e, id)) ?? null
    } catch { continue } // the file is not in that commit (a delete), or it does not read: an older one may
    if (value !== null && baseOf(value) === base) return value
  }
  return null
}

/** The op that gives `record` back as it was before the add: for `governance:governance` an update of its roles and
 *  rules (null for one the file did not state then, which takes the block out), for any other record a replace by the
 *  whole entry. Null when it is already that version. Throws Refusal 409 { code: 'RESTORE' } when history holds none. */
function restoreOp(repo: string, record: string, base: string | null, now: Entity | null): StageOp | null {
  if (now === null || base === null || baseOf(now) === base) return null
  const was = restoreValue(repo, record, base)
  if (was === null) {
    throw new Refusal(409, { code: 'RESTORE', error: `${record} as it was before the add is not in this repository's history, so it cannot be given back. Change it by hand. Nothing was staged.` })
  }
  if (parseRecord(record).registry !== 'governance') return { op: 'replace', record, value: was }
  const set: Record<string, unknown> = {}
  for (const key of GOVERNANCE_FIELDS) {
    if (was[key] !== undefined) set[key] = was[key]
    else if (now[key] !== undefined) set[key] = null
  }
  return { op: 'update', record, set }
}

/** The receipt marked removed (the seal fills `removed`). */
const markRemoved = (receipt: Receipt): StageOp =>
  ({ op: 'update', record: `${RECEIPTS}:${receipt.id}`, set: { status: 'removed', removed: { by: null, at: null, decision: null } } })

/** The deletes of every created record still there, the restores of every record it modified, then the receipt marked
 *  removed. */
function opsFor(repo: string, receipt: Receipt, states: RecordState[]): StageOp[] {
  const out: StageOp[] = []
  for (const s of states) {
    if (s.modified) { const op = restoreOp(repo, s.record, s.modified.base, s.modified.now); if (op) out.push(op) } else if (s.state !== 'gone') out.push({ op: 'delete', record: s.record })
  }
  return [...out, markRemoved(receipt)]
}

/** The classes a removal is decided by: those of the registries it deletes in or restores, without reading history. */
const classOps = (receipt: Receipt, states: RecordState[]): StageOp[] =>
  [...states.filter(s => s.modified || s.state !== 'gone').map((s): StageOp => (s.modified ? { op: 'update', record: s.record, set: {} } : { op: 'delete', record: s.record })), markRemoved(receipt)]

/** "a", "a and b", "a, b and c". */
const joined = (xs: string[]): string => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

const askSentence = (asks: string[], modified: Set<string>): string => {
  const one = asks.length === 1
  const it = one ? 'it' : 'them'
  const how = asks.every(a => !modified.has(a)) ? `deletes ${it} with the edits`
    : asks.every(a => modified.has(a)) ? `gives ${it} back as ${one ? 'it was' : 'they were'} before the add, without the edits`
    : `deletes what the add created and gives back what it changed, without the edits`
  return `Since it was added, ${joined(asks)} ${one ? 'was' : 'were'} edited. Removing ${how}; name ${it} in take to go ahead. Nothing was staged.`
}
const removedOn = (receipt: Receipt): string => receipt.removed?.at ?? 'a day it does not record'

const DEPLOYED = 'Its Systems are deployed. Remove each System as its own change; the chain keeps them.'

/** L7-D9: a receipt one of whose created Systems is deployed is not removed by the library; the chain keeps them. */
function refuseDeployed(receipt: Receipt, entriesOf: (registry: string) => Entity[]): void {
  const deployed = receipt.created.some(({ record }) => {
    const { registry } = parseRecord(record)
    if (registry !== 'systems') return false
    const now = recordNow(record, entriesOf)
    return isObject(now?.deployment) && now.deployment.status === 'deployed'
  })
  if (deployed) throw new Refusal(409, { code: 'DEPLOYED', error: DEPLOYED })
}

/** Who decides each class under the rule in force. The rule's answer, not the reader's: a reader who matches no member
 *  is asked about as a stand-in person, so their git email is never printed. */
export function decidedBy(repo: string, actor: Actor, classes: string[]): { class: string; direct: boolean; sentence: string }[] {
  const ctx = readRuleContext(repo, actor)
  const asked = isKnown(actor) ? ctx : { ...ctx, actor: { id: '', name: 'a member', kind: 'person' } }
  return classes.map(k => { const r = effectiveRule(asked, [k]); return { class: k, direct: r.direct, sentence: r.sentence } })
}

/** The registries as the actor's own change (`staged`) would leave them (R-9): `projected` holds those it touches, and
 *  `entriesOf` reads every registry that way, falling back to the file. A record deleted in the tray reads as gone, and
 *  one edited there reads as edited, so the preview and the removal agree with the referrers they list. */
function throughTray(repo: string, staged: StageOp[]): { projected: Map<string, Entity[]>; entriesOf: (registry: string) => Entity[] } {
  const read = (registry: string) => currentEntries(repo, registry, true)
  const projected = staged.length > 0 ? project(read, staged) : new Map<string, Entity[]>()
  return { projected, entriesOf: registry => projected.get(registry) ?? read(registry) }
}

/** What removing receipt `id` would do, without staging it: each record's state and the records that still name it,
 *  both read through `staged`, the actor's own change; the edited records it would ask for; and who decides. Writes
 *  nothing. Throws the 404 for an unknown receipt. */
export function removalPreview(repo: string, actor: Actor, id: string, staged: StageOp[] = []): RemovalPreview {
  const receipt = findReceipt(repo, id)
  const { projected, entriesOf } = throughTray(repo, staged)
  if (receipt.status === 'installed') refuseDeployed(receipt, entriesOf)
  const states = statesOf(receipt, entriesOf)
  const records = states.map(({ record, state, modified }) => {
    const { registry, id: rid } = parseRecord(record)
    // A record the add modified is given back, not deleted: nothing that names it is left pointing at nothing.
    const refs = state === 'gone' || modified ? [] : [
      ...referrers(repo, registry, rid, r => projected.get(r)).map(r => `${r.registry}:${r.id}`),
      // A rule decided by a System, or a membership tree, is in governance.yaml, which is no registry (L1-Q1).
      ...(registry === 'systems' ? governanceReferrers(rid, readRuleContext(repo, actor).governance).map(r => `${r.where}:${r.field}`) : []),
    ]
    return { record, state, referrers: [...new Set(refs)] }
  })
  const title = loadLibrary(repo).entries.find(e => e.id === receipt.entry)?.title ?? null
  const base = { receipt: receipt.id, entry: receipt.entry, title, records }
  if (receipt.status === 'removed') return { ...base, asks: [], decided: [], refusal: `This was removed on ${removedOn(receipt)}.` }
  return {
    ...base,
    asks: states.filter(s => s.state === 'edited').map(s => s.record),
    decided: decidedBy(repo, actor, classesOf(classOps(receipt, states))),
    refusal: null,
  }
}

/** The ops a removal stages: the deletes of every created record still there, the restores of every record the add
 *  modified (L7-D11: the version whose hash is the receipt's `base`, from git history), then
 *  `{ op: 'update', record: 'library:<id>', set: { status: 'removed', removed: { by: null, at: null, decision: null } } }`.
 *  Records are read through `staged`, the actor's own change, as the preview reads them: one deleted there is skipped,
 *  and one edited there counts as edited. Every record edited since the add must be named in `take`, or nothing is
 *  staged. Throws HttpError 404, Refusal 409 { code: 'REMOVED', error }, { code: 'DEPLOYED', error } (L7-D9),
 *  { code: 'ASK', asks, error } or { code: 'RESTORE', error }. */
export function removeOps(repo: string, id: string, take: string[], staged: StageOp[] = []): StageOp[] {
  const receipt = findReceipt(repo, id)
  if (receipt.status === 'removed') {
    throw new Refusal(409, { code: 'REMOVED', error: `Receipt ${receipt.id} was already removed on ${removedOn(receipt)}. Nothing was staged.` })
  }
  const { entriesOf } = throughTray(repo, staged)
  refuseDeployed(receipt, entriesOf)
  const states = statesOf(receipt, entriesOf)
  const asks = states.filter(s => s.state === 'edited').map(s => s.record)
  const modified = new Set(states.filter(s => s.modified).map(s => s.record))
  if (asks.some(record => !take.includes(record))) throw new Refusal(409, { code: 'ASK', asks, error: askSentence(asks, modified) })
  return opsFor(repo, receipt, states)
}
