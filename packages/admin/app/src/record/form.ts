import type { JsonProp, JsonSchema } from '../api.ts'
import { controlKind, orderedKeys, propOf, typeOf, type Value } from './fields.ts'

/** The new-record form (spec 2026-11-04 §3), as pure functions over a registry's schema and its entries: the words,
 *  the groups, the choices and the control each field gets. Option A (one page) and Option B (one group a step) both
 *  draw from these, so the two never disagree on what a field is. */

/** An id as words: "target_completion" → "Target completion". */
export function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim()
  return words === '' ? id : words.charAt(0).toUpperCase() + words.slice(1)
}

/** A field's label: its schema `title`, else its id humanised. */
export const labelOf = (schema: JsonSchema, field: string): string => propOf(schema, field).title ?? humanise(field)

/** A field's help: its schema `description`, else none. */
export const helpOf = (schema: JsonSchema, field: string): string | null => propOf(schema, field).description ?? null

/** What a person calls an entry, in the order `entryName` reads it. */
const TITLE_FIELDS = ['name', 'title', 'partner']

/** The field the id follows: the schema's name, title or partner; null when it has none (the id is then typed). */
export const titleFieldOf = (schema: JsonSchema): string | null =>
  TITLE_FIELDS.find(f => Object.hasOwn(schema.properties ?? {}, f)) ?? null

/** The line under the title in the preview: a summary, else the description. */
export const summaryFieldOf = (schema: JsonSchema): string | null =>
  ['summary', 'description'].find(f => Object.hasOwn(schema.properties ?? {}, f)) ?? null

export interface FieldGroup {
  label: string
  fields: string[]
  /** A group a person may skip: one the schema marks optional, holding no required field. The folded group is one. */
  optional: boolean
  /** The fields that are neither required nor grouped: drawn under "Show n more". */
  folded?: true
}

/** The label of the one group a schema without `x-groups` gets, and of the folded rest. */
export const ONE_GROUP = 'Details'
export const FOLDED_GROUP = 'More'

/** The form's groups. From the schema's `x-groups`, in order, each field once (a field the schema does not name is
 *  left out); without them, one group of the fields the schema orders (`x-order`), requires or the registry's entries
 *  already use. A required field no group names leads the first group. Everything else folds, last. The id is a field
 *  only where nothing names the entry: otherwise it follows the title. */
export function groupsOf(schema: JsonSchema, entries: readonly Value[]): FieldGroup[] {
  const props = schema.properties ?? {}
  const title = titleFieldOf(schema)
  const fields = orderedKeys(schema, {}, true).filter(k => (k === 'id' ? title === null : Object.hasOwn(props, k)))
  const required = new Set(schema.required ?? [])
  const placed = new Set<string>()
  const take = (keys: readonly string[]) => keys.filter(k => fields.includes(k) && !placed.has(k) && (placed.add(k), true))
  let groups: FieldGroup[]
  if (schema['x-groups'] && schema['x-groups'].length > 0) {
    groups = schema['x-groups'].map(g => ({ label: g.label, fields: take(g.fields ?? []), optional: g.optional === true }))
  } else {
    const ordered = new Set(schema['x-order'] ?? [])
    const used = new Set(entries.flatMap(e => Object.keys(e)))
    groups = [{ label: ONE_GROUP, fields: take(fields.filter(k => required.has(k) || ordered.has(k) || used.has(k))), optional: false }]
  }
  const lead = take(fields.filter(k => required.has(k)))
  if (lead.length > 0) {
    if (groups.length === 0) groups = [{ label: ONE_GROUP, fields: lead, optional: false }]
    else groups[0] = { ...groups[0]!, fields: [...lead, ...groups[0]!.fields] }
  }
  const out = groups.filter(g => g.fields.length > 0).map(g => ({ ...g, optional: g.optional && !g.fields.some(f => required.has(f)) }))
  const rest = fields.filter(k => !placed.has(k))
  return rest.length > 0 ? [...out, { label: FOLDED_GROUP, fields: rest, optional: true, folded: true }] : out
}

/** A field whose values are stages a record moves through. Without examples, these offer what the registry uses. */
const STATUS_LIKE = /^(status|stage|state|phase)$/

/** The choices a field offers, or null for a field that offers none. An enum: its values (no Other). A field with
 *  examples, or a status-like one: the values the registry's entries already use, most used first; while fewer than
 *  two are in use (an instance with no words of its own yet), the examples after them. Always with Other… (the
 *  vocabulary is the instance's own). A field marked `x-choices: examples` (a kind the framework knows) offers its
 *  examples first, then the other values in use. */
export function choicesOf(field: string, prop: JsonProp, entries: readonly Value[]): { options: string[]; other: boolean } | null {
  if (prop.enum) {
    const options = prop.enum.filter(v => v !== null).map(String)
    return options.length > 0 ? { options, other: false } : null
  }
  const examples = (prop.examples ?? []).filter((v): v is string => typeof v === 'string' && v !== '')
  if (examples.length === 0 && !STATUS_LIKE.test(field)) return null
  if (!['string', ''].includes(typeOf(prop))) return null
  const counts = new Map<string, number>()
  for (const e of entries) {
    const v = e[field]
    if (typeof v === 'string' && v.trim() !== '') counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const used = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
  const after = (first: string[], then: string[]) => [...first, ...then.filter(v => !first.some(f => f.toLowerCase() === v.toLowerCase()))]
  const options = prop['x-choices'] === 'examples' ? after(examples, used) : used.length >= 2 ? used : after(used, examples)
  return options.length > 0 ? { options, other: true } : null
}

/** The most choices drawn as a segmented control; more are a select. */
export const SEG_MAX = 5

export type FormKind = 'seg' | 'select' | 'date' | 'ref' | 'refs' | 'tokens' | 'rows' | 'number' | 'boolean' | 'text' | 'prose' | 'yaml'

const prose = (p: JsonProp) => p.format === 'textarea' || p['x-format'] === 'textarea'
const itemTypes = (p: JsonProp): string[] => { const t = p.items?.type; return t === undefined ? [] : Array.isArray(t) ? t : [t] }

/** The control a field gets on the form: a reference picks real records; choices are segmented (≤ SEG_MAX) or a
 *  select; a date, a number, a yes/no; a list of strings is tokens, a list of objects with named properties rows; a
 *  long text (`x-format: textarea`) a text area; YAML only for what none of these fit. */
export function formKindOf(registry: string, field: string, prop: JsonProp, choices: { options: string[] } | null): FormKind {
  const base = controlKind(registry, field, prop)
  if (base === 'ref' || base === 'refs') return base
  if (choices) return choices.options.length <= SEG_MAX ? 'seg' : 'select'
  switch (base) {
    case 'enum': return 'select'
    case 'list': return 'tokens'
    case 'date': case 'number': case 'boolean': return base
    case 'text': return prose(prop) ? 'prose' : 'text'
    default:
      if (typeOf(prop) === 'array' && itemTypes(prop).includes('string')) return 'tokens'
      if (typeOf(prop) === 'array' && Object.keys(prop.items?.properties ?? {}).length > 0) return 'rows'
      return 'yaml'
  }
}

/** Why an id cannot be the new record's, as it is typed: one beginning with # reads as a position (C14); one the
 *  file or the change already holds is taken, in the server's own words. Null when it can be, or is empty. */
export function idProblem(registry: string, id: string, taken: ReadonlySet<string>): string | null {
  if (id === '') return null
  if (id.startsWith('#')) return 'ids beginning with # are read as positions; choose another'
  if (taken.has(id)) return `${registry} already has an entry "${id}".`
  return null
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/** The preview's field rows: the first `max` fields of the groups that hold a value, the title, the summary and the
 *  id aside (the header says them). */
export function previewFields(schema: JsonSchema, groups: readonly FieldGroup[], draft: Value, max = 4): string[] {
  const aside = new Set(['id', titleFieldOf(schema), summaryFieldOf(schema)])
  return groups.flatMap(g => g.fields).filter(k => !aside.has(k) && filled(draft[k])).slice(0, max)
}
