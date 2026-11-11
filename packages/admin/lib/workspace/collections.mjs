// packages/admin/lib/workspace/collections.mjs
//
// Collection definitions (DAO-OS L6 spec §7.3, §7.4): data/collections.yaml, read and checked; the JSON schema a custom
// collection's records are validated against, derived from its fields; the references its relation fields make; its
// contact-shaped fields. Pure: no node:* and no npm import but the YAML parser, so the server, validate:data and the
// client read the same rules.
//
//   readCollections(text)            → the definitions, and a problem per one that cannot be read as written
//   schemaOf(def)                    → the JSON schema for a custom collection's records
//   refsOf(def)                      → the references its relation fields make (lib/data-validate.mjs's Ref shape)
//   collectionIdProblem(id, known)   → why `id` cannot name a new collection, or null
//   fieldIdProblem(id)               → why `id` cannot name a field, or null
//   definitionProblems(def, ctx)     → what is wrong with one definition, field by field and view by view
//   contactFieldsOf(def)             → its email and phone fields (kept at defaults.contact, R-L5-14.4)

import { parse } from 'yaml'
import { CUSTOM_ID, RESERVED_NAMES } from '../registries.mjs'

/** @typedef {{ field: string, op: 'is'|'is-not'|'before'|'after'|'contains', value: string }} Filter  L4c C1's shape */
/** @typedef {'text'|'longtext'|'number'|'select'|'multiselect'|'date'|'daterange'|'checkbox'|'url'|'person'|'relation'|'page'|'email'|'phone'} FieldType */
/** @typedef {{ id: string, type: FieldType, name?: string, options?: string[], to?: string, many?: boolean }} FieldDef */
/**
 * @typedef {{ id: string, name: string, kind: 'table'|'board'|'calendar'|'list'|'map', filters: Filter[],
 *   sort?: { field: string, dir: 'asc'|'desc' }, group?: string, columns?: string[], date?: string,
 *   board?: { field: string, order?: string[] } }} SavedView
 */
/** @typedef {{ id: string, name?: string, fields?: FieldDef[], views?: SavedView[], notes_parent?: string }} CollectionDef */

/** @type {readonly FieldType[]} */
export const FIELD_TYPES = Object.freeze(['text', 'longtext', 'number', 'select', 'multiselect', 'date', 'daterange', 'checkbox',
  'url', 'person', 'relation', 'page', 'email', 'phone'])
/** @type {readonly SavedView['kind'][]} */
export const VIEW_KINDS = Object.freeze(['table', 'board', 'calendar', 'list', 'map'])
/** @type {readonly Filter['op'][]} */
export const FILTER_OPS = Object.freeze(['is', 'is-not', 'before', 'after', 'contains'])
/** The field types kept at `defaults.contact` (L6 §7.3, L5 R-L5-14.4). */
export const CONTACT_TYPES = Object.freeze(['email', 'phone'])

/** A field id (L6 §7.4). */
export const FIELD_ID = /^[a-z][a-z0-9_]{0,40}$/
/** A saved view's id: as a collection's, one character shorter at least (copy of this task). */
export const VIEW_ID = /^[a-z][a-z0-9-]{0,40}$/

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const listed = (/** @type {readonly string[]} */ xs) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`)

/** A taken id, in words that read alike whether or not the asker may read the collection that holds it (rule 7; controller
 *  copy ruling, Task 3 fix round 1). */
export const ID_TAKEN = 'That id cannot be used for a new collection. Choose another.'

/**
 * Why `id` cannot name a new collection (L6 §7.4), or null when it can. `known` holds the names this instance already has:
 * its registries, its custom collections and its private ones, those the asker may not read included (`ID_TAKEN`).
 * @param {unknown} id @param {readonly string[]} known @returns {string | null}
 */
export function collectionIdProblem(id, known) {
  const shown = typeof id === 'string' ? id : JSON.stringify(id) ?? String(id)
  if (typeof id !== 'string' || !CUSTOM_ID.test(id)) {
    return `${shown} is not a collection id: an id is 2 to 41 characters of lowercase letters, digits and hyphens, beginning with a letter.`
  }
  if (id.startsWith('tree-')) return `${id} cannot name a collection: an id beginning with tree- names a tree of pages.`
  if (RESERVED_NAMES.includes(id)) return `${id} cannot name a collection: pages, knowledge and collections are the workspace's own names.`
  if (known.includes(id)) return ID_TAKEN
  return null
}

/** Why `id` cannot name a field (L6 §7.4), or null. @param {unknown} id @returns {string | null} */
export function fieldIdProblem(id) {
  if (typeof id === 'string' && FIELD_ID.test(id)) return null
  const shown = typeof id === 'string' ? id : JSON.stringify(id) ?? String(id)
  return `${shown} is not a field id: a field id is 1 to 41 characters of lowercase letters, digits and underscores, beginning with a letter.`
}

/**
 * What is wrong with one definition (L6 §7.3, §7.4), as `{ field, message }`: `field` is where (`fields.<n>`, `views.<n>`,
 * `name`), the message says what. `ctx.builtin`: the id names a registry, whose fields are its schema's, so a definition
 * holds its name, saved views and notes_parent only. `ctx.collections`: the names a relation's `to` may take.
 * @param {unknown} def @param {{ builtin: boolean, collections: readonly string[] }} ctx
 * @returns {{ field: string, message: string }[]}
 */
export function definitionProblems(def, ctx) {
  /** @type {{ field: string, message: string }[]} */
  const out = []
  const no = (/** @type {string} */ field, /** @type {string} */ message) => out.push({ field, message })
  if (!isObj(def)) return [{ field: '', message: 'a collection is a mapping with an id, a name, its fields and its saved views' }]
  const id = String(def.id)
  if (def.name !== undefined && (typeof def.name !== 'string' || def.name.trim() === '')) no('name', 'a name is text that is not empty')
  if (def.notes_parent !== undefined && def.notes_parent !== null && typeof def.notes_parent !== 'string') no('notes_parent', 'notes_parent names a page by its id')
  /** @type {Set<string>} */
  const fieldIds = new Set()
  if (def.fields !== undefined && def.fields !== null) {
    if (ctx.builtin) no('fields', `${id} is a built-in collection: its fields are its schema's, so only its name, saved views and notes_parent are kept here`)
    else if (!Array.isArray(def.fields)) no('fields', 'fields is a list of fields')
    else {
      def.fields.forEach((f, i) => {
        const at = `fields.${i}`
        if (!isObj(f)) { no(at, 'a field is a mapping with an id and a type'); return }
        const bad = fieldIdProblem(f.id)
        if (bad) { no(`${at}.id`, bad); return }
        const fid = String(f.id)
        if (fid === 'id') { no(`${at}.id`, 'id is every record\'s own, so no field takes it'); return }
        if (fieldIds.has(fid)) no(`${at}.id`, `two fields are called ${fid}`)
        fieldIds.add(fid)
        if (!FIELD_TYPES.includes(/** @type {FieldType} */ (f.type))) no(`${at}.type`, `${JSON.stringify(f.type) ?? 'no type'} is not a field type: ${listed(FIELD_TYPES)}`)
        if (f.name !== undefined && typeof f.name !== 'string') no(`${at}.name`, 'a field\'s name is text')
        if (f.many !== undefined && typeof f.many !== 'boolean') no(`${at}.many`, 'many is true or false')
        if (f.type === 'select' || f.type === 'multiselect') {
          if (f.options !== undefined && (!Array.isArray(f.options) || !f.options.every(o => typeof o === 'string'))) no(`${at}.options`, 'options is a list of texts')
        } else if (f.options !== undefined) no(`${at}.options`, `options are read for a select or multiselect field only, and ${fid} is ${String(f.type)}`)
        if (f.type === 'relation') {
          if (typeof f.to !== 'string' || f.to === '') no(`${at}.to`, `a relation names the collection it points to: to: <collection>`)
          else if (!ctx.collections.includes(f.to)) no(`${at}.to`, `${f.to} is no collection of this instance`)
        } else if (f.to !== undefined) no(`${at}.to`, `to is read for a relation field only, and ${fid} is ${String(f.type)}`)
      })
    }
  }
  if (def.views !== undefined && def.views !== null) {
    if (!Array.isArray(def.views)) no('views', 'views is a list of saved views')
    else {
      /** @type {Set<string>} */
      const viewIds = new Set()
      def.views.forEach((v, i) => {
        for (const p of viewProblems(v)) no(`views.${i}${p.field ? `.${p.field}` : ''}`, p.message)
        if (isObj(v) && typeof v.id === 'string') {
          if (viewIds.has(v.id)) no(`views.${i}.id`, `two saved views are called ${v.id}`)
          viewIds.add(v.id)
        }
      })
    }
  }
  return out
}

/**
 * What is wrong with one saved view (L6 §7.3), as `{ field, message }`.
 * @param {unknown} v @returns {{ field: string, message: string }[]}
 */
export function viewProblems(v) {
  /** @type {{ field: string, message: string }[]} */
  const out = []
  const no = (/** @type {string} */ field, /** @type {string} */ message) => out.push({ field, message })
  if (!isObj(v)) return [{ field: '', message: 'a saved view is a mapping with an id, a name and a kind' }]
  if (typeof v.id !== 'string' || !VIEW_ID.test(v.id)) no('id', `${JSON.stringify(v.id) ?? 'no id'} is not a view id: an id is 1 to 41 characters of lowercase letters, digits and hyphens, beginning with a letter`)
  if (typeof v.name !== 'string' || v.name.trim() === '') no('name', 'a saved view has a name')
  if (!VIEW_KINDS.includes(/** @type {SavedView['kind']} */ (v.kind))) no('kind', `${JSON.stringify(v.kind) ?? 'no kind'} is not a kind of view: ${listed(VIEW_KINDS)}`)
  if (v.filters !== undefined && v.filters !== null) {
    if (!Array.isArray(v.filters)) no('filters', 'filters is a list')
    else v.filters.forEach((f, i) => {
      if (!isObj(f) || typeof f.field !== 'string' || typeof f.value !== 'string' || !FILTER_OPS.includes(/** @type {Filter['op']} */ (f.op))) {
        no(`filters.${i}`, `a filter is { field, op, value }, op one of ${listed(FILTER_OPS)}, value a text`)
      }
    })
  }
  if (v.sort !== undefined && v.sort !== null && (!isObj(v.sort) || typeof v.sort.field !== 'string' || (v.sort.dir !== 'asc' && v.sort.dir !== 'desc'))) {
    no('sort', 'sort is { field, dir }, dir asc or desc')
  }
  for (const key of ['group', 'date']) if (v[key] !== undefined && v[key] !== null && typeof v[key] !== 'string') no(key, `${key} names a field`)
  if (v.columns !== undefined && v.columns !== null && (!Array.isArray(v.columns) || !v.columns.every(c => typeof c === 'string'))) no('columns', 'columns is a list of field ids')
  if (v.board !== undefined && v.board !== null) {
    const b = v.board
    if (!isObj(b) || typeof b.field !== 'string' || (b.order !== undefined && (!Array.isArray(b.order) || !b.order.every(o => typeof o === 'string')))) {
      no('board', 'board is { field, order? }, order a list of the field\'s values')
    }
  }
  return out
}

/** The final review's M-1 (PF-R116): what a saved view of a git collection is told when it names a restricted field. */
export const VIEW_RESTRICTED = (/** @type {string} */ field) =>
  `A saved view is written to data/collections.yaml, which every member reads, and ${field} is kept above members: ` +
  'a saved view cannot filter, sort, group, board or date by it. Nothing was written.'

/**
 * The places a saved view of a git collection names a field in `restricted` (one the policy keeps above members, or a
 * contact field): a filter (its value would be in git), the sort, the group, the board and the date (M-1, PF-R116).
 * Columns are not judged: a column names a field and holds no value. As `{ field, message }`, like viewProblems.
 * @param {unknown} v @param {ReadonlySet<string>} restricted @returns {{ field: string, message: string }[]}
 */
export function viewRestrictedProblems(v, restricted) {
  /** @type {{ field: string, message: string }[]} */
  const out = []
  if (!isObj(v)) return out
  const by = (/** @type {string} */ at, /** @type {unknown} */ f) => { if (typeof f === 'string' && restricted.has(f)) out.push({ field: at, message: VIEW_RESTRICTED(f) }) }
  if (Array.isArray(v.filters)) v.filters.forEach((f, i) => { if (isObj(f)) by(`filters.${i}.field`, f.field) })
  if (isObj(v.sort)) by('sort.field', v.sort.field)
  by('group', v.group)
  if (isObj(v.board)) by('board.field', v.board.field)
  by('date', v.date)
  return out
}

/**
 * data/collections.yaml's definitions (L6 §7.3), in their order, and a problem per thing that cannot be read as written:
 * a text that is not YAML, a `collections:` that is not a list, an entry with no id or one two entries share (the first
 * is read), a field or a view that is wrong. A definition whose id cannot name a collection is left out; one with a
 * problem in its fields or views is kept, so a hand edit is shown, not hidden. `builtins` are the registries' names: an
 * entry naming one holds that registry's saved views.
 * @param {string | null} text @param {readonly string[]} [builtins]
 * @returns {{ collections: CollectionDef[], problems: string[] }}
 */
export function readCollections(text, builtins = []) {
  /** @type {string[]} */
  const problems = []
  if (text === null || text.trim() === '') return { collections: [], problems }
  let doc
  try { doc = parse(text) } catch (err) {
    return { collections: [], problems: [`data/collections.yaml is not valid YAML: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`] }
  }
  const list = isObj(doc) ? doc.collections : undefined
  if (list === undefined || list === null) return { collections: [], problems }
  if (!Array.isArray(list)) return { collections: [], problems: ['collections: is not a list of collections'] }
  /** @type {CollectionDef[]} */
  const collections = []
  const names = [...builtins, ...list.flatMap(e => (isObj(e) && typeof e.id === 'string' ? [e.id] : []))]
  list.forEach((entry, i) => {
    const where = isObj(entry) && typeof entry.id === 'string' ? `collections.${entry.id}` : `collections #${i + 1}`
    if (!isObj(entry) || typeof entry.id !== 'string') { problems.push(`${where}: an entry has an id`); return }
    const id = entry.id
    if (collections.some(c => c.id === id)) { problems.push(`${where}: two entries are called ${id}; the first is read`); return }
    const builtin = builtins.includes(id)
    if (!builtin) {
      const bad = collectionIdProblem(id, [])
      if (bad) { problems.push(`${where}: ${bad}`); return }
    }
    for (const p of definitionProblems(entry, { builtin, collections: names })) problems.push(`${where}${p.field ? `.${p.field}` : ''}: ${p.message}`)
    collections.push(/** @type {CollectionDef} */ (entry))
  })
  return { collections, problems }
}

/** A field's values as JSON schema, null allowed (a field that holds nothing): `type` lists `null` beside the field's own,
 *  so a refusal names the field's own rule alone. @param {FieldDef} f @returns {Record<string, unknown>} */
function fieldSchema(f) {
  const DATE = { type: 'string', format: 'date' }
  const options = Array.isArray(f.options) && f.options.length > 0 ? [...f.options] : null
  const many = f.many === true && (f.type === 'person' || f.type === 'relation' || f.type === 'page')
  if (many) return { type: ['array', 'null'], items: { type: 'string' } }
  switch (f.type) {
    case 'number': return { type: ['number', 'null'] }
    case 'checkbox': return { type: ['boolean', 'null'] }
    case 'date': return { type: ['string', 'null'], format: 'date' }
    case 'daterange': return { type: ['object', 'null'], properties: { start: DATE, end: { type: ['string', 'null'], format: 'date' } }, required: ['start'] }
    case 'url': return { type: ['string', 'null'], format: 'uri' }
    case 'email': return { type: ['string', 'null'], format: 'email' }
    case 'select': return options ? { type: ['string', 'null'], enum: [...options, null] } : { type: ['string', 'null'] }
    case 'multiselect': return { type: ['array', 'null'], items: options ? { type: 'string', enum: options } : { type: 'string' } }
    default: return { type: ['string', 'null'] } // text, longtext, person, relation, page, phone
  }
}

/**
 * The JSON schema a custom collection's records are validated against (L6 §7.3): an `id`, each field by its type (a
 * null is always allowed: a field that holds nothing), and anything else kept, as a registry's schema keeps it.
 * @param {CollectionDef} def @returns {Record<string, unknown> & { $id: string }}
 */
export function schemaOf(def) {
  /** @type {Record<string, unknown>} */
  const properties = { id: { type: 'string', minLength: 1 }, visibility: { type: 'string' }, from: { type: 'object' } }
  for (const f of Array.isArray(def.fields) ? def.fields : []) {
    if (isObj(f) && typeof f.id === 'string' && FIELD_TYPES.includes(f.type)) properties[f.id] = fieldSchema(f)
  }
  return {
    $id: `https://org-os.dev/schemas/collections/${def.id}.schema.json`,
    title: def.name ?? def.id,
    type: 'object',
    required: ['id'],
    properties,
    additionalProperties: true,
  }
}

/**
 * The references a custom collection's relation fields make (lib/data-validate.mjs's Ref shape): `<field>` names a record
 * of `to`, one or (`many`) a list.
 * @param {CollectionDef} def @returns {{ registry: string, field: string, target: string, array?: boolean }[]}
 */
export function refsOf(def) {
  return (Array.isArray(def.fields) ? def.fields : [])
    .filter(f => isObj(f) && f.type === 'relation' && typeof f.to === 'string' && typeof f.id === 'string')
    .map(f => ({ registry: def.id, field: f.id, target: /** @type {string} */ (f.to), ...(f.many === true ? { array: true } : {}) }))
}

/** A definition's contact-shaped fields (L6 §7.3): its email and phone fields, kept at `defaults.contact`.
 *  @param {CollectionDef} def @returns {string[]} */
export function contactFieldsOf(def) {
  return (Array.isArray(def.fields) ? def.fields : [])
    .filter(f => isObj(f) && typeof f.id === 'string' && CONTACT_TYPES.includes(/** @type {string} */ (f.type)))
    .map(f => f.id)
}
