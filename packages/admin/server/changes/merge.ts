import { baseOf, sameValue } from './canonical.ts'
import { StageError, parseRecord, recordId } from './records.ts'
import type { Op, StageOp } from './types.ts'

type Entry = Record<string, unknown>

const without = (set: Entry, drop: (key: string) => boolean): Entry =>
  Object.fromEntries(Object.entries(set).filter(([key]) => !drop(key)))

const fixedId = (id: string, sent: unknown) => new StageError('id',
  `id "${String(sent)}" does not match the record's id "${id}": an id is changed by deleting the entry and creating a new one.`)

const idOf = (record: string): string => recordId(record).id

/** A create's or replace's value, holding the record's id. */
function withId(record: string, value: Entry): Entry {
  const id = idOf(record)
  if (value.id === undefined) return { id, ...value }
  if (String(value.id) !== id) throw fixedId(id, value.id)
  return value
}

/** The first op on a record, against the entry as the file holds it now. */
function fresh(n: StageOp, current: Entry | null): Op | null {
  const id = idOf(n.record)
  const { registry } = parseRecord(n.record)
  if (n.op === 'create') {
    if (current) throw new StageError('id', `${registry} already has an entry "${id}".`)
    return { op: 'create', record: n.record, value: withId(n.record, n.value), base: null, before: null }
  }
  if (!current) throw new StageError('', `${registry} has no entry "${id}".`)
  const base = baseOf(current)
  if (n.op === 'delete') return { op: 'delete', record: n.record, base, before: current }
  if (n.op === 'replace') {
    const value = withId(n.record, n.value)
    return sameValue(value, current) ? null : { op: 'replace', record: n.record, value, base, before: current }
  }
  if (n.set.id !== undefined && String(n.set.id) !== id) throw fixedId(id, n.set.id)
  const set = without(n.set, key => sameValue(n.set[key], current[key]))
  return Object.keys(set).length === 0 ? null : { op: 'update', record: n.record, set, base, before: current }
}

/** A later op on a record that already has one. The merged op keeps the first op's base. */
function combine(e: Op, n: StageOp): Op | null {
  const id = idOf(n.record)
  const { registry } = parseRecord(n.record)
  const keep = { record: e.record, base: e.base, before: e.before }
  if (e.op === 'delete') {
    if (n.op !== 'create') throw new StageError('', `${registry} "${id}" is staged to be deleted: take that op out of the change first.`)
    const value = withId(n.record, n.value)
    return sameValue(value, e.before) ? null : { op: 'replace', ...keep, value }
  }
  if (n.op === 'create') throw new StageError('id', `${registry} "${id}" is already in this change: edit it instead.`)
  if (n.op === 'delete') return e.op === 'create' ? null : { op: 'delete', ...keep }
  if (n.op === 'update' && n.set.id !== undefined && String(n.set.id) !== id) throw fixedId(id, n.set.id)
  if (e.op === 'create') {
    return { op: 'create', ...keep, value: n.op === 'replace' ? withId(n.record, n.value) : { ...e.value, ...n.set } }
  }
  const before = e.before ?? {}
  if (e.op === 'update' && n.op === 'update') {
    const merged = { ...e.set, ...n.set }
    const set = without(merged, key => sameValue(merged[key], before[key]))
    return Object.keys(set).length === 0 ? null : { op: 'update', ...keep, set }
  }
  // Now a whole entry: an update or replace followed by a replace, or a replace followed by an update.
  const value = n.op === 'replace' ? withId(n.record, n.value) : { ...(e.op === 'replace' ? e.value : before), ...n.set }
  return sameValue(value, e.before) ? null : { op: 'replace', ...keep, value }
}

/** `incoming` folded into `ops`: one op per record, in the order records were first staged.
 *  `current` is the record's entry as the file holds it now (null when it has none). */
export function mergeOp(ops: Op[], incoming: StageOp, current: Entry | null): Op[] {
  const at = ops.findIndex(o => o.record === incoming.record)
  const next = at >= 0 ? combine(ops[at]!, incoming) : fresh(incoming, current)
  const out = [...ops]
  if (at >= 0) { if (next) out[at] = next; else out.splice(at, 1) } else if (next) out.push(next)
  return out
}

/** Whether the record changed since the op was staged. */
export function isStale(op: Op, current: Entry | null): boolean {
  return op.op === 'create' ? current !== null : baseOf(current) !== op.base
}

/** The op brought up to date with the record as it is now; null when nothing is left of it. */
export function rebaseOp(op: Op, current: Entry | null, keep: 'mine' | 'theirs'): Op | null {
  if (!isStale(op, current)) return op
  if (keep === 'theirs') {
    if (op.op !== 'update' || current === null) return null
    const before = op.before ?? {}
    const set = without(op.set, key => !sameValue(current[key], before[key]) || sameValue(op.set[key], current[key]))
    return Object.keys(set).length === 0 ? null : { op: 'update', record: op.record, set, base: baseOf(current), before: current }
  }
  if (current === null) {
    if (op.op === 'delete') return null
    const value = op.op === 'update' ? { ...(op.before ?? {}), ...op.set } : op.value
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
