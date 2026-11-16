// L7-D11, review I3: a library removal is whole for the records its add modified, as L1 makes it whole for those it
// created (lib/receipts.mjs). A receipt marked removed must have each record it names in `modified` given back in the
// same change, by an update or a replace, unless the record is already the version it was before the add (its hash is
// `base`). Here rather than in lib/receipts.mjs, which cannot hash.
import { RECEIPTS } from '../../lib/receipts.mjs'
import { baseOf } from './canonical.ts'
import { StageError, parseRecord } from './records.ts'
import type { RecordError, RecordOp } from './types.ts'
import type { Entity } from '../registry.ts'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const named = (e: Entity, id: string) => e.id !== undefined && e.id !== null && String(e.id) === id

const notRestored = (receipt: string, record: string) =>
  `${receipt} is marked removed, but ${record}, which its add changed, is not given back by this change. Take the removal out as a whole, or stage it again from the library.`

/** One error per record a receipt being removed by `ops` modified and the change does not give back, judged against
 *  the files before the change (`before`). */
export function restoreProblems(ops: RecordOp[], before: (registry: string) => Entity[]): RecordError[] {
  const parsed = (record: string) => { try { return parseRecord(record) } catch (err) { if (err instanceof StageError) return null; throw err } }
  const removals = ops.filter(op => op.op === 'update' && op.set.status === 'removed' && parsed(op.record)?.registry === RECEIPTS)
  if (removals.length === 0) return []
  const changed = new Set(ops.filter(op => op.op === 'update' || op.op === 'replace').map(op => op.record))
  const errors: RecordError[] = []
  for (const op of removals) {
    const receipt = before(RECEIPTS).find(e => named(e, parsed(op.record)!.id))
    const modified = Array.isArray(receipt?.modified) ? receipt.modified.filter(isObject) : []
    for (const item of modified) {
      const record = String(item.record)
      if (changed.has(record)) continue
      const at = parsed(record)
      const found = at ? before(at.registry).find(e => named(e, at.id)) : undefined
      if (!found) continue // nothing left to give back
      const { id: _id, ...fields } = found
      const now = at!.registry === 'governance' ? fields : found // the engine's record of governance has no id
      if (baseOf(now) === item.base) continue
      errors.push({ record: op.record, field: '', message: notRestored(op.record, record) })
    }
  }
  return errors
}
