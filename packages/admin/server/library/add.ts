import { RECEIPTS, receiptIdFor } from '../../lib/receipts.mjs'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import type { StageOp } from '../changes/types.ts'
import { resolveInstalls } from './config.ts'
import { cannotAdd, takenRefusal } from './preview.ts'
import { receiptEntries } from './remove.ts'
import type { LibraryEntry } from './types.ts'

/** The receipt ids already used: those in data/library.yaml (installed or removed) and those the actor's change stages. */
function receiptIds(repo: string, staged: StageOp[]): Set<string> {
  const ids = receiptEntries(repo).map(e => String(e.id))
  const prefix = `${RECEIPTS}:`
  for (const op of staged) if (op.record.startsWith(prefix)) ids.push(op.record.slice(prefix.length))
  return new Set(ids)
}

/** The ops an add stages: the entry's resolved creates, then its receipt (by/at/decision/bases null; the seal fills
 *  them where the change is applied or proposed). Everything is read through `staged`, the actor's own change.
 *  Throws Refusal 409 { code: 'NOT_ADDABLE', error } with cannotAdd's sentence, Refusal 409 { code: 'TAKEN', error,
 *  nextFreeId } for an id that is taken, or StageRefusal (422 { errors }) for config. `receipt` is the receipt's id. */
export function addOps(repo: string, entry: LibraryEntry, config: unknown, staged: StageOp[]): { ops: StageOp[]; receipt: string } {
  const blocked = cannotAdd(repo, entry, staged)
  if (blocked !== null) {
    // cannotAdd's last reason is a taken id the person cannot change; it is answered as TAKEN, with the next free id.
    const taken = takenRefusal(repo, resolveInstalls(entry, {}, { lenient: true }).ops, staged)
    if (taken && taken.sentence === blocked) throw new Refusal(409, { code: 'TAKEN', error: taken.sentence, nextFreeId: taken.nextFreeId })
    throw new Refusal(409, { code: 'NOT_ADDABLE', error: blocked })
  }
  const { ops: resolved, errors } = resolveInstalls(entry, config)
  if (errors.length > 0) throw new StageRefusal(errors)
  // An id the person chose (or left at its default) that is taken.
  const taken = takenRefusal(repo, resolved, staged)
  if (taken) throw new Refusal(409, { code: 'TAKEN', error: taken.sentence, nextFreeId: taken.nextFreeId })

  // cannotAdd has refused every op but create, so each resolved op is a create.
  const creates: StageOp[] = resolved.map(op => ({ op: 'create', record: op.record, value: op.value ?? {} }))
  const id = receiptIdFor(entry.id, receiptIds(repo, staged))
  const receipt: StageOp = {
    op: 'create',
    record: `${RECEIPTS}:${id}`,
    value: {
      id, entry: entry.id, version: entry.version, shelf: entry.source,
      created: creates.map(op => ({ record: op.record, base: null })),
      status: 'installed', by: null, at: null, decision: null, removed: null,
    },
  }
  return { ops: [...creates, receipt], receipt: id }
}
