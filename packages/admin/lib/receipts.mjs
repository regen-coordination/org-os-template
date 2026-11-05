// packages/admin/lib/receipts.mjs
//
// The library's receipts (DAO-OS L1, ruling L1-R1): data/library.yaml, one entry per
// entry added, class `records`. What keeps a change that holds a receipt whole, and
// what the committed tree must say. Pure and import-free of the server and of node,
// so the client and the root scripts can run it as well.

import { StageError, parseRecord } from './ops.mjs'

/** @typedef {Record<string, unknown>} Entity */
/** @typedef {import('./ops.mjs').StageOp} StageOp */
/** @typedef {{ record: string, field: string, message: string }} ReceiptProblem */

/** The registry of the receipts. */
export const RECEIPTS = 'library'

/**
 * A receipt's id for an entry: its id with ':' → '-', then -2, -3… while `taken` holds it.
 * @param {string} entryId @param {Set<string>} taken @returns {string}
 */
export function receiptIdFor(entryId, taken) {
  const base = entryId.replace(/:/g, '-')
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** The registry and id of a record, or null for one that names no collection (other checks say so).
 *  @param {string} record @returns {{ registry: string, id: string } | null} */
function parsed(record) {
  try { return parseRecord(record) } catch (err) { if (err instanceof StageError) return null; throw err }
}

/** Whether `record` names a receipt; a record that does not parse is not one.
 *  @param {string} record */
const isReceipt = record => parsed(record)?.registry === RECEIPTS

/**
 * The ops a change is judged by (ruling L1-C5: the receipt rides along): every op, except that `library:` ops are left
 * out when any other op is present. A change of receipt ops only is judged by them. Ops whose record does not parse are
 * kept (other checks say so).
 *
 * This and `judgedFiles` (the same rule over a commit's files) agree on every change the platform writes, because
 * staging never holds a no-op content op beside a receipt: `mergeOp` folds an op that changes nothing away, so every
 * content op left writes its file, and the commit's files hold a governed file whenever the ops hold a content op.
 * @template {{ record: string }} T
 * @param {T[]} ops
 * @returns {T[]}
 */
export function judgedOps(ops) {
  const rest = ops.filter(op => !isReceipt(op.record))
  return rest.length > 0 ? rest : ops
}

/** The receipts' file, as a commit names it. */
const RECEIPTS_FILE = `data/${RECEIPTS}.yaml`

/**
 * The files a commit is judged by (L1-C5): `data/library.yaml` is left out when any other file in the list has a
 * governed class. `governedClassOf` is passed in, so this module stays free of the class table. It agrees with
 * `judgedOps` because staging never holds a no-op content op beside a receipt (see there).
 * @param {string[]} files
 * @param {(file: string) => string | null} governedClassOf
 * @returns {string[]}
 */
export function judgedFiles(files, governedClassOf) {
  const others = files.some(f => f !== RECEIPTS_FILE && governedClassOf(f))
  return others ? files.filter(f => f !== RECEIPTS_FILE) : files
}

/** @param {Entity} e @param {string} id */
const named = (e, id) => e.id !== undefined && e.id !== null && String(e.id) === id

/** The records a receipt says it created, as written; [] for a value that holds none.
 *  @param {unknown} receipt @returns {string[]} */
function createdOf(receipt) {
  const created = receipt && typeof receipt === 'object' ? /** @type {Entity} */ (receipt).created : undefined
  if (!Array.isArray(created)) return []
  return created.flatMap(item => (item && typeof item === 'object' && typeof item.record === 'string' ? [item.record] : []))
}

const NEVER_DELETED = 'A receipt is never deleted: Remove in the library marks it removed.'
const ONLY_REMOVE = 'A receipt changes only by Remove in the library, which sets status and removed.'
/** @param {string} receipt @param {string} record */
const notCreated = (receipt, record) =>
  `${receipt} names ${record}, which this change does not create. Take the add out as a whole: remove its receipt op too, or discard the change.`
/** @param {string} receipt @param {string} record */
const notDeleted = (receipt, record) =>
  `${receipt} is marked removed, but ${record} is not deleted by this change. Take the removal out as a whole, or stage it again from the library.`

/**
 * The change as a whole, against the files as they are before it (`entriesOf`). An add is whole: a
 * receipt create names only records the change creates. A removal is whole: a receipt marked removed
 * leaves none of its records that still exist without a delete op. A receipt is never deleted or
 * replaced. It moves one way, once: it is created `installed`, and an update sets `status: 'removed'`
 * (with or without `removed`, which the seal fills) on a receipt that is `installed` now, and nothing
 * else. So un-removing, a second removal (which would overwrite the first one's seal) and `removed`
 * alone are refused.
 * @param {StageOp[]} ops
 * @param {(registry: string) => Entity[]} entriesOf
 * @returns {ReceiptProblem[]}
 */
export function receiptProblems(ops, entriesOf) {
  /** @type {ReceiptProblem[]} */
  const problems = []
  const creates = new Set(ops.filter(o => o.op === 'create').map(o => o.record))
  const deletes = new Set(ops.filter(o => o.op === 'delete').map(o => o.record))
  /** @param {string} record */
  const existsNow = record => {
    const at = parsed(record)
    return at !== null && entriesOf(at.registry).some(e => named(e, at.id))
  }
  for (const op of ops) {
    const at = parsed(op.record)
    if (at?.registry !== RECEIPTS) continue
    /** @param {string} message */
    const refuse = message => problems.push({ record: op.record, field: '', message })
    if (op.op === 'delete') { refuse(NEVER_DELETED); continue }
    if (op.op === 'replace' || (op.op === 'update' && Object.keys(op.set).some(k => k !== 'status' && k !== 'removed'))) {
      refuse(ONLY_REMOVE)
      continue
    }
    if (op.op === 'create') {
      if (op.value.status !== 'installed') refuse(ONLY_REMOVE)
      for (const record of createdOf(op.value)) if (!creates.has(record)) refuse(notCreated(op.record, record))
      continue
    }
    const receipt = entriesOf(RECEIPTS).find(e => named(e, at.id))
    if (op.set.status !== 'removed' || receipt?.status !== 'installed') { refuse(ONLY_REMOVE); continue }
    for (const record of createdOf(receipt)) {
      if (!deletes.has(record) && existsNow(record)) refuse(notDeleted(op.record, record))
    }
  }
  return problems
}

const UNSEALED = 'this receipt was committed without its decision; it was not written by the platform. Correct it by hand from the commit that added it.'

/**
 * The committed tree: every field the seal fills must be filled. Each receipt with a null `by`, `at`,
 * `decision` or `created[n].base`, or on a removed receipt a null `removed.by/at/decision`, is one
 * problem per field. The shape itself is the schema's to say.
 * @param {Entity[]} entries
 * @returns {{ id: string, path: string, message: string }[]}
 */
export function checkReceipts(entries) {
  /** @type {{ id: string, path: string, message: string }[]} */
  const problems = []
  entries.forEach((receipt, index) => {
    const id = receipt.id === undefined || receipt.id === null || receipt.id === '' ? `#${index + 1}` : String(receipt.id)
    /** @param {string} path */
    const unsealed = path => problems.push({ id, path, message: UNSEALED })
    for (const key of ['by', 'at', 'decision']) if (receipt[key] === null) unsealed(key)
    if (Array.isArray(receipt.created)) {
      receipt.created.forEach((item, n) => { if (item && typeof item === 'object' && item.base === null) unsealed(`created.${n}.base`) })
    }
    const removed = receipt.removed
    if (receipt.status === 'removed' && removed && typeof removed === 'object') {
      for (const key of ['by', 'at', 'decision']) if (/** @type {Entity} */ (removed)[key] === null) unsealed(`removed.${key}`)
    }
  })
  return problems
}
