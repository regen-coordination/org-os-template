// Remove (DAO-OS L1): what an add created is deleted and its receipt marked removed, as one change in the actor's
// tray. A record edited since the add is deleted only when the person names it in `take`, and then all of them or
// none (Q-L1-3). A record already gone is skipped. A record another record names is refused by the engine's own
// delete check; the removal preview lists those referrers in advance.

import { HttpError } from '../errors.ts'
import { RECEIPTS } from '../../lib/receipts.mjs'
import { classesOf, currentEntries, named, project } from '../changes/stage.ts'
import { Refusal } from '../changes/apply.ts'
import { baseOf } from '../changes/canonical.ts'
import { parseRecord } from '../changes/records.ts'
import type { StageOp } from '../changes/types.ts'
import type { Entity } from '../registry.ts'
import { referrers } from '../schema.ts'
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

/** Each record the receipt created, as it stands now: gone, edited since it was added, or as added. */
function statesOf(receipt: Receipt, entriesOf: (registry: string) => Entity[]): { record: string; state: State }[] {
  return receipt.created.map(({ record, base }) => {
    const { registry, id } = parseRecord(record)
    const now = entriesOf(registry).find(e => named(e, id))
    return { record, state: now === undefined ? 'gone' : baseOf(now) !== base ? 'edited' : 'as added' }
  })
}

/** The deletes of every created record still there, then the receipt marked removed (the seal fills `removed`). */
function opsFor(receipt: Receipt, states: { record: string; state: State }[]): StageOp[] {
  const deletes: StageOp[] = states.filter(s => s.state !== 'gone').map(s => ({ op: 'delete', record: s.record }))
  return [...deletes, { op: 'update', record: `${RECEIPTS}:${receipt.id}`, set: { status: 'removed', removed: { by: null, at: null, decision: null } } }]
}

/** "a", "a and b", "a, b and c". */
const joined = (xs: string[]): string => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

const askSentence = (asks: string[]): string => {
  const one = asks.length === 1
  const it = one ? 'it' : 'them'
  return `Since it was added, ${joined(asks)} ${one ? 'was' : 'were'} edited. Removing deletes ${it} with the edits; name ${it} in take to go ahead. Nothing was staged.`
}
const removedOn = (receipt: Receipt): string => receipt.removed?.at ?? 'a day it does not record'

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
  const states = statesOf(receipt, entriesOf)
  const records = states.map(({ record, state }) => {
    const { registry, id: rid } = parseRecord(record)
    const refs = state === 'gone' ? [] : referrers(repo, registry, rid, r => projected.get(r)).map(r => `${r.registry}:${r.id}`)
    return { record, state, referrers: [...new Set(refs)] }
  })
  const title = loadLibrary(repo).entries.find(e => e.id === receipt.entry)?.title ?? null
  const base = { receipt: receipt.id, entry: receipt.entry, title, records }
  if (receipt.status === 'removed') return { ...base, asks: [], decided: [], refusal: `This was removed on ${removedOn(receipt)}.` }
  return {
    ...base,
    asks: states.filter(s => s.state === 'edited').map(s => s.record),
    decided: decidedBy(repo, actor, classesOf(opsFor(receipt, states))),
    refusal: null,
  }
}

/** The ops a removal stages: the deletes of every created record still there, then
 *  `{ op: 'update', record: 'library:<id>', set: { status: 'removed', removed: { by: null, at: null, decision: null } } }`.
 *  Records are read through `staged`, the actor's own change, as the preview reads them: one deleted there is skipped,
 *  and one edited there counts as edited. Every record edited since the add must be named in `take`, or nothing is
 *  staged. Throws HttpError 404, Refusal 409 { code: 'REMOVED', error } or Refusal 409 { code: 'ASK', asks, error }. */
export function removeOps(repo: string, id: string, take: string[], staged: StageOp[] = []): StageOp[] {
  const receipt = findReceipt(repo, id)
  if (receipt.status === 'removed') {
    throw new Refusal(409, { code: 'REMOVED', error: `Receipt ${receipt.id} was already removed on ${removedOn(receipt)}. Nothing was staged.` })
  }
  const states = statesOf(receipt, throughTray(repo, staged).entriesOf)
  const asks = states.filter(s => s.state === 'edited').map(s => s.record)
  if (asks.some(record => !take.includes(record))) throw new Refusal(409, { code: 'ASK', asks, error: askSentence(asks) })
  return opsFor(receipt, states)
}
