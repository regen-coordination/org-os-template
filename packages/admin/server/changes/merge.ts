import { baseOf, sameValue } from './canonical.ts'
import { StageError, parseRecord, recordId } from './records.ts'
import type { Op, RecordOp, RecordStaged } from './types.ts'
import type { RegistryDef } from '../registries.ts'
import { registryNameOf, updated } from '../../lib/ops.mjs'

/** The record ops' engine (0.6): a file op (L6 §11.2) has its own, in server/workspace/files.ts. */
const isRecordStaged = (op: Op): op is RecordStaged => op.op !== 'file'

type Entry = Record<string, unknown>

const without = (set: Entry, drop: (key: string) => boolean): Entry =>
  Object.fromEntries(Object.entries(set).filter(([key]) => !drop(key)))

const fixedId = (id: string, sent: unknown) => new StageError('id',
  `id "${String(sent)}" does not match the record's id "${id}": an id is changed by deleting the entry and creating a new one.`)

/** The registry list records are read against (DAO-OS L6 §7.1): an instance's own, with its custom collections, or, absent,
 *  the built-in one. */
type Defs = readonly RegistryDef[] | undefined

const idOf = (record: string, defs: Defs): string => recordId(record, defs).id

/** A create's or replace's value, holding the record's id. */
function withId(record: string, value: Entry, defs: Defs): Entry {
  const id = idOf(record, defs)
  if (value.id === undefined) return { id, ...value }
  if (String(value.id) !== id) throw fixedId(id, value.id)
  return value
}

/** The first op on a record, against the entry as the file holds it now. */
function fresh(n: RecordOp, current: Entry | null, defs: Defs): RecordStaged | null {
  const id = idOf(n.record, defs)
  const { registry } = parseRecord(n.record, defs)
  if (n.op === 'create') {
    if (current) throw new StageError('id', `${registry} already has an entry "${id}".`)
    return { op: 'create', record: n.record, value: withId(n.record, n.value, defs), base: null, before: null }
  }
  if (!current) throw new StageError('', `${registry} has no entry "${id}".`)
  const base = baseOf(current)
  if (n.op === 'delete') return { op: 'delete', record: n.record, base, before: current }
  if (n.op === 'replace') {
    const value = withId(n.record, n.value, defs)
    return sameValue(value, current) ? null : { op: 'replace', record: n.record, value, base, before: current }
  }
  if (n.set.id !== undefined && String(n.set.id) !== id) throw fixedId(id, n.set.id)
  const set = without(n.set, key => sameValue(n.set[key], current[key]))
  return Object.keys(set).length === 0 ? null : { op: 'update', record: n.record, set, base, before: current }
}

/** A later op on a record that already has one. The merged op keeps the first op's base. */
function combine(e: RecordStaged, n: RecordOp, defs: Defs): RecordStaged | null {
  const id = idOf(n.record, defs)
  const { registry } = parseRecord(n.record, defs)
  const keep = { record: e.record, base: e.base, before: e.before }
  if (e.op === 'delete') {
    if (n.op !== 'create') throw new StageError('', `${registry} "${id}" is staged to be deleted: take that op out of the change first.`)
    const value = withId(n.record, n.value, defs)
    return sameValue(value, e.before) ? null : { op: 'replace', ...keep, value }
  }
  if (n.op === 'create') throw new StageError('id', `${registry} "${id}" is already in this change: edit it instead.`)
  if (n.op === 'delete') return e.op === 'create' ? null : { op: 'delete', ...keep }
  if (n.op === 'update' && n.set.id !== undefined && String(n.set.id) !== id) throw fixedId(id, n.set.id)
  if (e.op === 'create') {
    return { op: 'create', ...keep, value: n.op === 'replace' ? withId(n.record, n.value, defs) : { ...e.value, ...n.set } }
  }
  const before = e.before ?? {}
  if (e.op === 'update' && n.op === 'update') {
    const merged = { ...e.set, ...n.set }
    const set = without(merged, key => sameValue(merged[key], before[key]))
    return Object.keys(set).length === 0 ? null : { op: 'update', ...keep, set }
  }
  // Now a whole entry: an update or replace followed by a replace, or a replace followed by an update.
  const value = n.op === 'replace' ? withId(n.record, n.value, defs) : { ...(e.op === 'replace' ? e.value : before), ...n.set }
  return sameValue(value, e.before) ? null : { op: 'replace', ...keep, value }
}

/** `incoming` folded into `ops`: one op per record, in the order records were first staged.
 *  `current` is the record's entry as the file holds it now (null when it has none). `defs`: the instance's registry list
 *  (`registriesOf`), so a custom collection's record is one (L6 ruling R-2b); absent, the built-in list. */
export function mergeOp<O extends Op>(ops: O[], incoming: RecordOp, current: Entry | null, defs?: readonly RegistryDef[]): (O | RecordStaged)[] {
  const at = ops.findIndex(o => isRecordStaged(o) && o.record === incoming.record)
  const next = at >= 0 ? combine(ops[at] as RecordStaged, incoming, defs) : fresh(incoming, current, defs)
  const out: (O | RecordStaged)[] = [...ops]
  if (at >= 0) { if (next) out[at] = next; else out.splice(at, 1) } else if (next) out.push(next)
  return out
}

/** Whether the record changed since the op was staged, where it matters to the op (the walk's I5, review G6): a create is
 *  stale when the record is there; an update whose `before` the tray kept is stale only when a field it sets changed on
 *  the trunk (another field changing is no conflict: `rebased` moves it on); with no `before` (the ledger stores none),
 *  and for a replace or a delete, any change of the record is. */
export function isStale(op: RecordStaged, current: Entry | null): boolean {
  if (op.op === 'create') return current !== null
  if (baseOf(current) === op.base) return false
  if (op.op === 'update' && op.before && current !== null) {
    const before = op.before
    return Object.keys(op.set).some(key => !sameValue(current[key], before[key]))
  }
  return true
}

/** An update staged against an older version of the record whose fields the trunk has not changed, re-based on the record
 *  as it is now (its base and `before` the trunk's), silently (G6); any other op as it is. */
export function rebased<O extends RecordStaged>(op: O, current: Entry | null): O {
  if (op.op !== 'update' || current === null || !op.before || baseOf(current) === op.base || isStale(op, current)) return op
  return { ...op, base: baseOf(current), before: current }
}

/** The op brought up to date with the record as it is now; null when nothing is left of it. */
export function rebaseOp(op: RecordStaged, current: Entry | null, keep: 'mine' | 'theirs'): RecordStaged | null {
  // Not stale by its fields (G6): moved onto the record as it is now, whichever is chosen.
  if (!isStale(op, current)) return rebased(op, current)
  if (keep === 'theirs') {
    if (op.op !== 'update' || current === null) return null
    const before = op.before ?? {}
    const set = without(op.set, key => !sameValue(current[key], before[key]) || sameValue(op.set[key], current[key]))
    return Object.keys(set).length === 0 ? null : { op: 'update', record: op.record, set, base: baseOf(current), before: current }
  }
  if (current === null) {
    if (op.op === 'delete') return null
    // An update's set read as the engine projects it (a governance field set to null is a block taken out).
    const value = op.op === 'update' ? updated(registryNameOf(op.record), op.before ?? {}, op.set) : op.value
    return { op: 'create', record: op.record, value, base: null, before: null }
  }
  const base = baseOf(current)
  if (op.op === 'delete') return { op: 'delete', record: op.record, base, before: current }
  if (op.op === 'update') {
    const set = without(op.set, key => sameValue(op.set[key], current[key]))
    return Object.keys(set).length === 0 ? null : { op: 'update', record: op.record, set, base, before: current }
  }
  return sameValue(op.value, current) ? null : { op: 'replace', record: op.record, value: op.value, base, before: current }
}
