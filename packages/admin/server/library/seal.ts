// The seal (DAO-OS L1, ruling L1-R1): a receipt is staged with `by`, `at`, `decision` and every created record's `base`
// null (and, on removal, `removed.by/at/decision`), because only the decision knows them. Apply (`applyAs`), Propose and
// Revise fill them, just before the ops are written: the ops that are committed, or that the ledger holds, are sealed.

import { baseOf } from '../changes/canonical.ts'
import { StageError, parseRecord } from '../changes/records.ts'
import type { StageOp } from '../changes/types.ts'
import { RECEIPTS } from '../../lib/receipts.mjs'
import type { ReceiptDecision } from './types.ts'

/** `at` is a day (YYYY-MM-DD), or the day for each receipt by its record: Revise keeps the day each was proposed (R-6). */
export interface Seal { by: string; at: string | ((record: string) => string); decision: ReceiptDecision }

type Entry = Record<string, unknown>
const isObject = (v: unknown): v is Entry => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Whether `record` names a receipt; a record that names no registry is left for the checks that say so. */
function isReceipt(record: string): boolean {
  try { return parseRecord(record).registry === RECEIPTS } catch (err) { if (err instanceof StageError) return false; throw err }
}

/**
 * `ops` with every receipt sealed: a receipt `create` gets `by`, `at`, `decision`, and each `created[n].base` is the hash of
 * that record's `create` value in `ops` (the value as it will be committed: staging folds a later edit into the create); a
 * receipt `update` that sets `status: 'removed'` gets `set.removed = { by, at, decision }`. An earlier seal is
 * overwritten (Revise seals again). Every other op is returned as it is; the input is never changed.
 */
export function sealReceipts<T extends StageOp>(ops: T[], seal: Seal): T[] {
  const created = new Map<string, Entry>()
  for (const op of ops) if (op.op === 'create') created.set(op.record, op.value)
  const stamp = (record: string): Entry =>
    ({ by: seal.by, at: typeof seal.at === 'string' ? seal.at : seal.at(record), decision: { ...seal.decision } })
  return ops.map((op): T => {
    if (!isReceipt(op.record)) return op
    if (op.op === 'create') {
      const items = Array.isArray(op.value.created) ? op.value.created : []
      const bases = items.map((item: unknown) => {
        if (!isObject(item) || typeof item.record !== 'string') return item
        const value = created.get(item.record)
        return value === undefined ? { ...item } : { ...item, base: baseOf(value) }
      })
      return { ...op, value: { ...op.value, ...(Array.isArray(op.value.created) ? { created: bases } : {}), ...stamp(op.record) } }
    }
    if (op.op === 'update' && op.set.status === 'removed') return { ...op, set: { ...op.set, removed: stamp(op.record) } }
    return op
  })
}
