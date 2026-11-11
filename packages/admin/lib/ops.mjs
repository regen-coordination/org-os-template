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
 *   | { op: 'replace', record: string, value: Record<string, unknown> }} RecordOp */
/** @typedef {{ op: 'file', path: string, text: string | null, base: string | null }} FileOp */
/** @typedef {RecordOp | FileOp} StageOp */

/** A staged op the engine cannot take. `field` is '' when the op as a whole is refused. */
export class StageError extends Error {
  /** @param {string} field @param {string} message */
  constructor(field, message) { super(message); this.field = field }
}

/** What is said of any edit of data/governance.yaml but the roles and rules of `governance:governance` (L7-D10). */
export const GOVERNANCE_ONLY = 'Only roles and rules of data/governance.yaml are edited here.'

/** `<registry>:<id>`, split at the first colon: ids hold colons themselves (`members:github:x`). `defs` is the registry
 *  list the record is read against: REGISTRIES, or an instance's own (`registriesOf(repo)`, with its custom collections).
 *  @param {string} record @param {readonly import('./registries.mjs').RegistryDef[]} [defs]
 *  @returns {{ registry: string, id: string }} */
export function parseRecord(record, defs = REGISTRIES) {
  const at = record.indexOf(':')
  const registry = at < 0 ? record : record.slice(0, at)
  const id = at < 0 ? '' : record.slice(at + 1)
  const def = defs.find(r => r.name === registry)
  if (!def) {
    throw new StageError('', `"${record}" names no registry: a record is written <registry>:<id>, for example projects:my-project.`)
  }
  // The one document the change engine edits: its roles and rules, as the record `governance:governance` (L7-D10).
  if (registry === 'governance') {
    if (id !== 'governance') throw new StageError('', GOVERNANCE_ONLY)
    return { registry, id }
  }
  if (def.kind !== 'collection') {
    throw new StageError('', `${registry} is a document registry: it is not edited entry by entry, so it cannot be staged here.`)
  }
  return { registry, id }
}

/** `parseRecord`, refusing a record with no id. The one place that sentence is written.
 *  @param {string} record @param {readonly import('./registries.mjs').RegistryDef[]} [defs]
 *  @returns {{ registry: string, id: string }} */
export function recordId(record, defs = REGISTRIES) {
  const parsed = parseRecord(record, defs)
  if (parsed.id === '') throw new StageError('id', `"${record}" has no id after the colon: a record is written <registry>:<id>.`)
  return parsed
}

/** A ledger op on private data (DAO-OS L5 spec §9.6): `{ op: private, ref, class, digest }`, a placeholder for ops the
 *  private store keeps (`pending`). It names no record, so it changes no registry file.
 *  @param {unknown} op @returns {boolean} */
export function isPlaceholder(op) {
  return typeof op === 'object' && op !== null && !Array.isArray(op) && /** @type {{ op?: unknown }} */ (op).op === 'private'
}

/** A governed file edited whole (DAO-OS L6 §11.2): `{ op: file, path, text, base }`. It names no record: it writes its
 *  file, and no registry's entries are projected from it.
 *  @param {unknown} op @returns {boolean} */
export function isFileOp(op) {
  return typeof op === 'object' && op !== null && !Array.isArray(op) && /** @type {{ op?: unknown }} */ (op).op === 'file'
}

/** The ops that name a record: every op but a private placeholder and a file op, in their order.
 *  @template T @param {readonly T[]} ops @returns {T[]} */
export function recordOpsOf(ops) {
  return ops.filter(op => !isPlaceholder(op) && !isFileOp(op))
}

/** The ops git applies: every op but a private placeholder (`isPlaceholder`), in their order.
 *  @template T @param {readonly T[]} ops @returns {T[]} */
export function gitOpsOf(ops) {
  return ops.filter(op => !isPlaceholder(op))
}

/** The registry a record names, read as its text before the first colon: what `updated` asks (is it governance?), with no
 *  registry list to hold it against, so a custom collection's record (DAO-OS L6 §7.3) is read as well as a built-in one.
 *  @param {string} record @returns {string} */
export function registryNameOf(record) {
  const at = record.indexOf(':')
  return at < 0 ? record : record.slice(0, at)
}

/** An entry with an update's `set` applied: the set's fields in place of the entry's. In `governance:governance` a
 *  field set to null is a block the file no longer states (L7-D11: a removal restores a file that had no `rules:`), so
 *  it is left out rather than kept as null.
 *  @param {string} registry @param {Entity} entry @param {Record<string, unknown>} set @returns {Entity} */
export function updated(registry, entry, set) {
  const out = { ...entry, ...set }
  if (registry === 'governance') for (const [key, value] of Object.entries(set)) if (value === null) delete out[key]
  return out
}

/** `entries` (registry → its entries, copies the caller owns) as `op` leaves them. Lenient: an op
 *  whose record is not where it expects changes nothing here; the step that writes says why. A private
 *  placeholder (`isPlaceholder`) changes nothing in git, so nothing here; nor does a file op (`isFileOp`), which writes its file whole.
 *  @param {Map<string, Entity[]>} entries @param {StageOp} op
 *  @param {readonly import('./registries.mjs').RegistryDef[]} [defs] the registry list (`parseRecord`) @returns {void} */
export function projectOp(entries, op, defs = REGISTRIES) {
  if (isPlaceholder(op) || isFileOp(op)) return
  const { registry, id } = parseRecord(/** @type {RecordOp} */ (op).record, defs)
  const list = entries.get(registry) ?? []
  const at = list.findIndex(e => e.id !== undefined && e.id !== null && String(e.id) === id)  // ids compare as strings, as the files' lookups do
  if (op.op === 'create') {
    if (at < 0) list.push(op.value)
  } else if (at >= 0) {
    if (op.op === 'delete') list.splice(at, 1)
    else if (op.op === 'replace') list[at] = op.value
    else list[at] = updated(registry, list[at], op.set)
  }
  entries.set(registry, list)
}
