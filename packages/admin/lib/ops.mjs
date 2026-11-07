// packages/admin/lib/ops.mjs
//
// The op projection: what a staged op does to a registry's entries, and the record names that
// ops use. Pure and import-free of the server, so the root scripts (validate-governance) and the
// client can run it as well. server/changes/records.ts re-exports these names.

import { REGISTRIES } from './registries.mjs'

/** @typedef {Record<string, unknown>} Entity */
/** @typedef {{ op: 'update', record: string, set: Record<string, unknown> }
 *   | { op: 'create', record: string, value: Record<string, unknown> }
 *   | { op: 'delete', record: string }
 *   | { op: 'replace', record: string, value: Record<string, unknown> }} StageOp */

/** A staged op the engine cannot take. `field` is '' when the op as a whole is refused. */
export class StageError extends Error {
  /** @param {string} field @param {string} message */
  constructor(field, message) { super(message); this.field = field }
}

/** `<registry>:<id>`, split at the first colon: ids hold colons themselves (`members:github:x`).
 *  @param {string} record @returns {{ registry: string, id: string }} */
export function parseRecord(record) {
  const at = record.indexOf(':')
  const registry = at < 0 ? record : record.slice(0, at)
  const id = at < 0 ? '' : record.slice(at + 1)
  const def = REGISTRIES.find(r => r.name === registry)
  if (!def) {
    throw new StageError('', `"${record}" names no registry: a record is written <registry>:<id>, for example projects:my-project.`)
  }
  if (def.kind !== 'collection') {
    throw new StageError('', `${registry} is a document registry: it is not edited entry by entry, so it cannot be staged here.`)
  }
  return { registry, id }
}

/** `parseRecord`, refusing a record with no id. The one place that sentence is written.
 *  @param {string} record @returns {{ registry: string, id: string }} */
export function recordId(record) {
  const parsed = parseRecord(record)
  if (parsed.id === '') throw new StageError('id', `"${record}" has no id after the colon: a record is written <registry>:<id>.`)
  return parsed
}

/** A ledger op on private data (DAO-OS L5 spec §9.6): `{ op: private, ref, class, digest }`, a placeholder for ops the
 *  private store keeps (`pending`). It names no record, so it changes no registry file.
 *  @param {unknown} op @returns {boolean} */
export function isPlaceholder(op) {
  return typeof op === 'object' && op !== null && !Array.isArray(op) && /** @type {{ op?: unknown }} */ (op).op === 'private'
}

/** The ops git applies: every op but a private placeholder (`isPlaceholder`), in their order.
 *  @template T @param {readonly T[]} ops @returns {T[]} */
export function gitOpsOf(ops) {
  return ops.filter(op => !isPlaceholder(op))
}

/** `entries` (registry → its entries, copies the caller owns) as `op` leaves them. Lenient: an op
 *  whose record is not where it expects changes nothing here; the step that writes says why. A private
 *  placeholder (`isPlaceholder`) changes nothing in git, so nothing here.
 *  @param {Map<string, Entity[]>} entries @param {StageOp} op @returns {void} */
export function projectOp(entries, op) {
  if (isPlaceholder(op)) return
  const { registry, id } = parseRecord(op.record)
  const list = entries.get(registry) ?? []
  const at = list.findIndex(e => e.id !== undefined && e.id !== null && String(e.id) === id)  // ids compare as strings, as the files' lookups do
  if (op.op === 'create') {
    if (at < 0) list.push(op.value)
  } else if (at >= 0) {
    if (op.op === 'delete') list.splice(at, 1)
    else if (op.op === 'replace') list[at] = op.value
    else list[at] = { ...list[at], ...op.set }
  }
  entries.set(registry, list)
}
