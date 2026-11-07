import type { JsonSchema, Op } from '../api.ts'
import { refOf } from '../refs.ts'

export type Value = Record<string, unknown>
export type Prop = NonNullable<JsonSchema['properties']>[string]

export const typeOf = (p: Prop): string =>
  Array.isArray(p.type) ? (p.type.find(t => t !== 'null') ?? 'string') : (p.type ?? '')

/** A field's schema, by own key only: `'toString' in props` is true of every object. */
export const propOf = (schema: JsonSchema, key: string): Prop =>
  (schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key]! : {})

/** Schema order (`x-order`), then the schema's other properties (all of them while editing; those the
 *  entry holds while reading), then whatever the entry holds that the schema does not name. */
export function orderedKeys(schema: JsonSchema, value: Value, editing: boolean): string[] {
  const props = schema.properties ?? {}
  const inSchema = (k: string) => Object.hasOwn(props, k)
  const order = schema['x-order'] ?? []
  return [
    ...order.filter(k => inSchema(k) || k === 'id' || Object.hasOwn(value, k)),
    ...Object.keys(props).filter(k => !order.includes(k) && (editing || Object.hasOwn(value, k))),
    ...Object.keys(value).filter(k => !inSchema(k) && !order.includes(k)),
  ].filter((k, i, all) => k !== '__proto__' && all.indexOf(k) === i)
}

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const blank = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
/** Whether an edited value leaves a field as the entry had it. A field the entry did not hold is
 *  unchanged by any empty value (null, '', []): typing into it and clearing it again writes nothing. */
export const unchanged = (before: unknown, now: unknown): boolean => (before === undefined ? blank(now) : same(before, now))

export interface StagedView { value: Value | null; was: Value; created: boolean; deleted: boolean }

/** The entry as it will be once its staged ops apply, and each changed field's value in the file. */
export function stagedView(entry: Value | null, ops: Op[]): StagedView {
  let value: Value | null = entry ? { ...entry } : null
  let created = false
  let deleted = false
  for (const op of ops) {
    if (op.op === 'create') { value = { ...op.value }; created = true; deleted = false }
    else if (op.op === 'replace') value = { ...op.value }
    else if (op.op === 'update') value = { ...(value ?? {}), ...op.set }
    else deleted = true
  }
  const was: Value = {}
  if (value && !created) {
    for (const k of new Set([...Object.keys(value), ...Object.keys(entry ?? {})])) {
      if (!same(value[k], entry?.[k])) was[k] = entry?.[k]
    }
  }
  return { value, was, created, deleted }
}

/** The staged fields whose value moved on the trunk since they were staged (§6.2 stale): for each field a staged
 *  update sets, the file's value now, when it is no longer the value the op was staged against (`Op.before`). A
 *  create, a delete, or an op with no `before` makes nothing stale. Each is shown as "now <value> on the trunk". */
export function staleOf(entry: Value | null, ops: Op[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!entry) return out
  for (const op of ops) {
    if (op.op !== 'update' || !op.before) continue
    for (const k of Object.keys(op.set)) {
      if (!same(entry[k], op.before[k])) out[k] = shown(entry[k])
    }
  }
  return out
}

/** A value for a reader: '—' for nothing, scalars joined by commas, anything else as JSON. */
export function shown(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every(x => typeof x !== 'object' || x === null)) return v.map(String).join(', ')
  return JSON.stringify(v)
}

/** A changed field's old value, to strike beside it; none when the field held nothing, since a
 *  struck "—" reads as a value. */
export const wasShown = (v: unknown): string | undefined => (blank(v) ? undefined : shown(v))

const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
/** What a person would call an entry: its name, title or partner. */
export const entryName = (v: Value | null): string | null => (v ? text(v.name) ?? text(v.title) ?? text(v.partner) : null)

export type ControlKind = 'enum' | 'date' | 'text' | 'number' | 'boolean' | 'list' | 'ref' | 'refs' | 'yaml'

/** The input a field gets (spec §6.4). References come first: they are strings or string arrays in
 *  the schema, but edit as a select or a token list over their target registry. A field the schema
 *  does not name edits as YAML, as it did before. */
export function controlKind(registry: string, field: string, p: Prop): ControlKind {
  const ref = refOf(registry, field)
  if (ref?.array) return 'refs'
  if (ref) return 'ref'
  if (p.enum) return 'enum'
  switch (typeOf(p)) {
    case 'string': return p.format === 'date' ? 'date' : 'text'
    case 'number': case 'integer': return 'number'
    case 'boolean': return 'boolean'
    case 'array': return p.items?.type === 'string' ? 'list' : 'yaml'
    default: return 'yaml'
  }
}

/** Why a `format: date` text is not a date, in words; null when it is one, or empty. */
export { dateProblem } from '../design/inputs/DateInput.tsx'
