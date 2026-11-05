// packages/admin/lib/board-query.mjs
//
// Boards (P4 spec §5): the source language a block reads with, and the checks
// a board must pass. Plain ESM with no node: imports (P4-R1), so the server's
// writes, `validate:data` and the client run this one file. The evaluator is
// P4b's blocks/query.ts, moved here (contract "P4b produces"); query.ts adapts it.

/** @typedef {'grid'|'canvas'|'flow'} Layout */
/** @typedef {Record<string, unknown>} Where */
/** @typedef {{ kind?: string | string[], section?: string, where?: Where, sort?: string | string[], limit?: number }} RecordSource */
/**
 * What a query reads of a record: a Resource's own fields, its facts, and its file entry when given.
 * @typedef {{ id: string, kind: string, name: string, status: string | null,
 *   attention: { level: string, text: string } | null, changed: { at: string, by: string } | null,
 *   facts: Record<string, unknown> }} RecordLike
 */

export const BLOCK_TYPES = Object.freeze(['list', 'kanban', 'map', 'record', 'metric', 'system', 'note', 'proposals', 'needs', 'systems', 'recently', 'prepared', 'balances', 'fundflow'])
/** What a recently block reads (C6): every decision, or the decisions that moved money. */
export const RECENTLY_SOURCES = Object.freeze(['all', 'money'])
export const LAYOUTS = Object.freeze(['grid', 'canvas', 'flow'])
export const GRID_COLUMNS = 12
export const MIN_SPAN = 3
export const CANVAS_MIN = Object.freeze({ w: 240, h: 120 })
/** The map boards: the existing `Board` ids (P4-R3). */
export const MAPS = Object.freeze(['organization', 'systems'])
/** Today's sections: app/src/sections.ts SECTIONS, in its order (a test keeps the two equal). */
export const SECTION_IDS = Object.freeze(['projects', 'people', 'funding', 'partners', 'ideas', 'meetings', 'treasury',
  'crew', 'modules', 'fleet', 'sources', 'systems'])
/** The kinds a source may name ("*" is any): app/src/kinds.ts RESOURCE_KINDS (a test keeps the two equal). */
export const RECORD_KINDS = Object.freeze(['person', 'project', 'idea', 'funding', 'partner', 'knowledge-gaps', 'proposal',
  'role', 'seat', 'module', 'instance', 'connector', 'source', 'channel', 'system'])
/** The proposals a `proposals` block may read: GET /api/proposals, narrowed. */
export const PROPOSAL_SOURCES = Object.freeze(['open', 'closed', 'mine', 'needs-me'])
/** The fields every record has, the three derived ones included (P4-C9). */
export const BASE_FIELDS = Object.freeze(['id', 'kind', 'name', 'status', 'attention', 'needs', 'changed', 'free'])
const CONDITIONS = ['not', 'in', 'before', 'after', 'has']
const RANK = { alert: 0, warn: 1 }

/** A section's board id. The section `systems` would take the systems map's id, which old `/b/systems`
 *  links name (P4-C10). @param {string} section @returns {string} */
export const sectionBoardId = section => (section === 'systems' ? 'outside-systems' : section)

const isMap = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const absent = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const same = (v, x) => (Array.isArray(v) ? v.some(y => same(y, x)) : String(v) === String(x))

/**
 * A record's field as a source reads it: id, kind, name, status and attention (its text); the derived
 * needs (alert 0, warn 1, none 2), changed (when, as ISO) and free (1 for a free seat); else the fact of
 * that name; else, when given, the file entry's field; else null.
 * @param {RecordLike} r @param {string} field @param {Record<string, unknown>} [entry] @returns {unknown}
 */
export function fieldOf(r, field, entry) {
  switch (field) {
    case 'id': return r.id
    case 'kind': return r.kind
    case 'name': return r.name
    case 'status': return r.status
    case 'attention': return r.attention?.text ?? null
    case 'needs': return r.attention ? (RANK[r.attention.level] ?? 1) : 2
    case 'changed': return r.changed?.at ?? null
    case 'free': return r.status === 'free' ? 1 : 0
  }
  if (r.facts && Object.hasOwn(r.facts, field)) return r.facts[field]
  if (entry && Object.hasOwn(entry, field)) return entry[field]
  return null
}

/** One `where` test on one value (P4b's rules). A plain value equals by text, an array holding it matches,
 *  and null asks for nothing there. `not` keeps what does not hold the field. `in`, `before` and `after`
 *  need it, with dates compared as text. `has` asks whether it is there.
 *  @param {unknown} v @param {unknown} test @returns {boolean} */
export function matches(v, test) {
  if (test === null || typeof test !== 'object' || Array.isArray(test)) return test === null ? absent(v) : !absent(v) && same(v, test)
  const t = /** @type {Record<string, unknown>} */ (test)
  if ('has' in t && Boolean(t.has) === absent(v)) return false
  if ('not' in t && !absent(v) && same(v, t.not)) return false
  if ('in' in t && (absent(v) || !Array.isArray(t.in) || !t.in.some(x => same(v, x)))) return false
  if ('before' in t && (absent(v) || !(String(v) < String(t.before)))) return false
  if ('after' in t && (absent(v) || !(String(v) > String(t.after)))) return false
  return true
}

/** Nothing sorts last, whichever way round; numbers as numbers; anything else as text. */
function compare(a, b, dir) {
  const ea = absent(a), eb = absent(b)
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  return c * dir
}

/** A sort as keys: one string or a list, each string comma-separated; `-field` descending; `field=value`
 *  puts the records holding that value last (P4-C9).
 *  @param {string | string[] | undefined} sort @returns {{ field: string, dir: 1 | -1, eq?: string }[]} */
export function sortKeys(sort) {
  return (Array.isArray(sort) ? sort : [sort ?? '']).flatMap(s => String(s).split(',')).map(k => k.trim()).filter(Boolean)
    .map(k => {
      const dir = k.startsWith('-') ? -1 : 1
      const body = dir === -1 ? k.slice(1) : k
      const at = body.indexOf('=')
      return at > 0 ? { field: body.slice(0, at), dir, eq: body.slice(at + 1) } : { field: body, dir }
    })
}

/**
 * The records a source names (spec §5.1): by kind (one, several, or "*") or section, then each `where`,
 * then `sort` (ties by name, then input order), then `limit` (0 included). It drops nothing on its own
 * (P4b ruling: Home's "Needs you" lists absent adapters). A section's membership is the caller's
 * (`opts.inSection`), because only the client knows how sections choose systems (C-4).
 * @template {RecordLike} T
 * @param {RecordSource} source
 * @param {T[]} records
 * @param {{ inSection?: (section: string, r: T) => boolean, entryOf?: (r: T) => Record<string, unknown> | undefined }} [opts]
 * @returns {T[]}
 */
export function runQuery(source, records, opts = {}) {
  const entryOf = opts.entryOf ?? (() => undefined)
  const named = source.kind === undefined ? null : Array.isArray(source.kind) ? source.kind : [source.kind]
  const kinds = named === null || named.includes('*') ? null : new Set(named)
  let out = records.filter(r => (!kinds || kinds.has(r.kind))
    && (source.section === undefined || (opts.inSection ? opts.inSection(source.section, r) : false)))
  for (const [field, test] of Object.entries(source.where ?? {})) out = out.filter(r => matches(fieldOf(r, field, entryOf(r)), test))
  const keys = sortKeys(source.sort)
  if (keys.length > 0) {
    const value = (r, k) => {
      const v = fieldOf(r, k.field, entryOf(r))
      return k.eq === undefined ? v : (!absent(v) && same(v, k.eq) ? 1 : 0)
    }
    out = out.map((r, i) => ({ r, i })).sort((x, y) => {
      for (const k of keys) {
        const c = k.eq === undefined ? compare(value(x.r, k), value(y.r, k), k.dir) : (value(x.r, k) - value(y.r, k)) * k.dir
        if (c !== 0) return c
      }
      return x.r.name.localeCompare(y.r.name) || x.i - y.i
    }).map(x => x.r)
  }
  return typeof source.limit === 'number' && source.limit >= 0 ? out.slice(0, source.limit) : out
}

/** The fields a source may name: every record's for no kind or "*", the union of the kinds' (null when
 *  any is unchecked), and null for a section, whose kinds are the client's. */
function fieldsFor(s, fieldsOf) {
  if (s.section !== undefined) return null
  const kinds = s.kind === undefined ? ['*'] : Array.isArray(s.kind) ? s.kind : [s.kind]
  if (kinds.includes('*')) return [...BASE_FIELDS]
  const lists = kinds.map(k => fieldsOf(k))
  return lists.some(l => l === null) ? null : [...new Set(lists.flat())]
}
const kindName = s => (s.kind === undefined || s.kind === '*' || (Array.isArray(s.kind) && s.kind.includes('*')) ? 'every record'
  : Array.isArray(s.kind) ? s.kind.join(' or ') : s.kind)

/** @param {string} field @param {Record<string, any>} s @param {string[] | null} fields @returns {string | null} */
function fieldProblem(field, s, fields) {
  if (!fields || fields.includes(field)) return null
  return `"${field}" is not a field of ${kindName(s)} (it has ${fields.join(', ')})`
}

/**
 * The problems of a records source, as sentences (P4-C9's one RecordSource).
 * @param {unknown} source
 * @param {(kind: string) => string[] | null} fieldsOf the FULL list of a kind's fields, BASE_FIELDS included
 *   (the contract of data-validate.mjs boardFieldsOf), or null to leave its fields unchecked
 * @returns {string[]}
 */
export function validateSource(source, fieldsOf) {
  if (!isMap(source)) return ['the source is not a mapping: give it a kind, such as { kind: project }']
  const s = /** @type {Record<string, any>} */ (source)
  const out = []
  for (const k of Object.keys(s)) if (!['kind', 'section', 'where', 'sort', 'limit'].includes(k)) out.push(`"${k}" is not part of a source (kind, section, where, sort, limit)`)
  if (s.kind !== undefined && s.section !== undefined) { out.push('a source names kind or section, not both'); return out }
  if (s.section !== undefined && !SECTION_IDS.includes(s.section)) { out.push(`section ${JSON.stringify(s.section)} is not a section (${SECTION_IDS.join(', ')})`); return out }
  if (s.kind !== undefined) {
    const kinds = Array.isArray(s.kind) ? s.kind : [s.kind]
    const bad = kinds.find(k => typeof k !== 'string' || (k !== '*' && !RECORD_KINDS.includes(k)))
    if (bad !== undefined || kinds.length === 0) {
      out.push(`kind ${JSON.stringify(bad ?? s.kind)} is not a record kind (${RECORD_KINDS.join(', ')}, or "*" for any)`)
      return out
    }
  }
  const fields = fieldsFor(s, fieldsOf)
  if (s.where !== undefined) {
    if (!isMap(s.where)) out.push('where is not a mapping of fields to values')
    else for (const [field, cond] of Object.entries(s.where)) {
      const p = fieldProblem(field, s, fields)
      if (p) out.push(`where: ${p}`)
      if (!isMap(cond)) continue
      for (const [op, v] of Object.entries(cond)) {
        if (!CONDITIONS.includes(op)) out.push(`where.${field}: "${op}" is not a condition (not, in, before, after, has)`)
        else if (op === 'in' && !Array.isArray(v)) out.push(`where.${field}.in is not a list`)
        else if (op === 'has' && typeof v !== 'boolean') out.push(`where.${field}.has is not true or false`)
        else if ((op === 'before' || op === 'after') && typeof v !== 'string') out.push(`where.${field}.${op} is not a date or text, such as "2026-10-28"`)
      }
    }
  }
  if (s.sort !== undefined) {
    if (!(typeof s.sort === 'string' || (Array.isArray(s.sort) && s.sort.every(x => typeof x === 'string')))) out.push('sort is not a field name or a list of them')
    else for (const k of sortKeys(s.sort)) {
      if (k.field === '') { out.push('sort has an empty key'); continue }
      const p = fieldProblem(k.field, s, fields)
      if (p) out.push(`sort: ${p}`)
    }
  }
  if (s.limit !== undefined && !(Number.isInteger(s.limit) && s.limit >= 0)) out.push(`limit ${JSON.stringify(s.limit)} is not a whole number from 0`)
  return out
}

/** The problems of one block's source and view, by its type, in P4b's cfg shapes (P4-C9). */
function blockProblems(b, fieldsOf) {
  const s = b.source
  const has = k => isMap(s) && Object.hasOwn(s, k)
  const view = isMap(b.view) ? b.view : {}
  const singleKind = isMap(s) && typeof s.kind === 'string' && s.kind !== '*' && RECORD_KINDS.includes(s.kind)
  switch (b.type) {
    case 'note':
      return [...(typeof b.text === 'string' ? [] : ['a note needs text (Markdown); it may be ""']),
        ...(s === undefined ? [] : ['a note reads no source: remove source'])]
    case 'list':
      if (has('jobs')) {
        return s.jobs === 'recent' && Object.keys(s).every(k => k === 'jobs' || k === 'limit') && (s.limit === undefined || (Number.isInteger(s.limit) && s.limit >= 0))
          ? [] : ['a jobs source is { jobs: recent }, with an optional limit']
      }
      return validateSource(s ?? {}, fieldsOf)
    case 'map':
      if (has('map')) return MAPS.includes(s.map) && Object.keys(s).length === 1 ? [] : [`map ${JSON.stringify(s.map)} is not a map (${MAPS.join(', ')})`]
      return validateSource(s ?? {}, fieldsOf)
    case 'kanban': {
      const out = validateSource(s ?? {}, fieldsOf)
      if (typeof view.group !== 'string' || view.group === '') out.push('a kanban needs view.group: the field its columns are, such as status')
      else if (singleKind) { const p = fieldProblem(view.group, s, fieldsOf(s.kind)); if (p) out.push(`view.group: ${p}`) }
      if (!Array.isArray(view.columns) || view.columns.length === 0 || !view.columns.every(c => typeof c === 'string' && c !== '')) {
        out.push('a kanban needs view.columns: the values its columns hold, such as [idea, active, done]')
      }
      return out
    }
    case 'proposals':
      return has('proposals') && PROPOSAL_SOURCES.includes(s.proposals) && Object.keys(s).length === 1
        ? [] : [`a proposals block reads { proposals: <${PROPOSAL_SOURCES.join(', ')}> }`]
    case 'needs': case 'systems': case 'prepared': case 'balances': case 'fundflow':
      // the Hub's own reads (C6, C12): Needs you, every System, the prepared transactions, the main Safe's balances and
      // its fund flow
      return s === undefined ? [] : [`a ${b.type} block reads no source: remove source`]
    case 'recently':
      return has('recently') && RECENTLY_SOURCES.includes(s.recently) && Object.keys(s).length === 1
        ? [] : [`a recently block reads { recently: <${RECENTLY_SOURCES.join(', ')}> }`]
    case 'record':
      return has('record') && typeof s.record === 'string' && /^[a-z][a-z-]*:.+/.test(s.record) && Object.keys(s).length === 1
        ? [] : ['a record block reads { record: <kind>:<id> }, such as { record: project:co-fund }']
    case 'system':
      return has('system') && typeof s.system === 'string' && s.system !== ''
        && Object.keys(s).every(k => k === 'system' || (k === 'reading' && typeof s.reading === 'string'))
        ? [] : ['a system block reads { system: <its id in data/systems.yaml> }, with an optional reading']
    case 'metric': {
      if (has('system')) {
        return typeof s.system === 'string' && s.system !== '' && typeof s.fact === 'string' && s.fact !== ''
          && (s.reading === undefined || (typeof s.reading === 'string' && s.reading !== ''))
          && Object.keys(s).every(k => k === 'system' || k === 'fact' || k === 'reading')
          ? [] : ['a metric of a system reads { system, fact }, with an optional reading, such as { system: treasury-safe, fact: threshold }']
      }
      const out = validateSource(s ?? {}, fieldsOf)
      const measure = view.measure ?? 'count'
      if (measure !== 'count' && measure !== 'sum') out.push(`view.measure ${JSON.stringify(measure)} is not count or sum`)
      if (measure === 'sum') {
        if (typeof view.field !== 'string' || view.field === '') out.push('a sum needs view.field: the number field it adds up')
        else if (singleKind) { const p = fieldProblem(view.field, s, fieldsOf(s.kind)); if (p) out.push(`view.field: ${p}`) }
      }
      return out
    }
    default:
      return []
  }
}

/** The problems of one block's place on a board of `layout`. */
function placeProblems(layout, b) {
  const p = b.place
  if (layout === 'flow') return p === undefined || (isMap(p) && Object.keys(p).length === 0) ? [] : ['a flow board places blocks by their order: remove place']
  if (!isMap(p)) return [`has no place on this ${layout} board`]
  const out = []
  if (layout === 'grid') {
    for (const k of Object.keys(p)) if (!['col', 'span', 'row'].includes(k)) out.push(`"${k}" is not part of a grid place (col, span, row)`)
    if (!Number.isInteger(p.col) || p.col < 1 || p.col > GRID_COLUMNS) out.push(`col ${JSON.stringify(p.col ?? null)} is outside 1–${GRID_COLUMNS}`)
    if (!Number.isInteger(p.span) || p.span < 1 || p.span > GRID_COLUMNS) out.push(`span ${JSON.stringify(p.span ?? null)} is outside 1–${GRID_COLUMNS}`)
    else if (p.span < MIN_SPAN) out.push(`span ${p.span} is under the minimum of ${MIN_SPAN}`)
    if (!Number.isInteger(p.row) || p.row < 1) out.push(`row ${JSON.stringify(p.row ?? null)} is not a whole number from 1`)
    if (out.length === 0 && p.col + p.span - 1 > GRID_COLUMNS) {
      out.push(`reaches column ${p.col + p.span - 1}, past ${GRID_COLUMNS}: start it further left or make it narrower`)
    }
    return out
  }
  for (const k of Object.keys(p)) if (!['x', 'y', 'w', 'h'].includes(k)) out.push(`"${k}" is not part of a canvas place (x, y, w, h)`)
  for (const k of ['x', 'y']) if (!(typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0)) out.push(`${k} ${JSON.stringify(p[k] ?? null)} is not a number from 0`)
  if (!(typeof p.w === 'number' && p.w >= CANVAS_MIN.w)) out.push(`w ${JSON.stringify(p.w ?? null)} is under ${CANVAS_MIN.w}`)
  if (!(typeof p.h === 'number' && p.h >= CANVAS_MIN.h)) out.push(`h ${JSON.stringify(p.h ?? null)} is under ${CANVAS_MIN.h}`)
  return out
}

/**
 * Every problem a board has beyond its JSON Schema: block ids, types, sources, places and grid overlaps.
 * Used by validate:data and the server's staging (through validateEntry), and by Arrange's review.
 * @param {unknown} board
 * @param {{ blockTypes?: readonly string[], fieldsOf: (kind: string) => string[] | null }} ctx
 *   fieldsOf answers a kind's full field list, BASE_FIELDS included, or null to leave it unchecked
 * @returns {string[]}
 */
export function validateBoard(board, ctx) {
  if (!isMap(board)) return ['a board is a mapping with id, name, layout and blocks']
  const b = /** @type {Record<string, any>} */ (board)
  const types = ctx.blockTypes ?? BLOCK_TYPES
  const out = []
  const layoutOk = LAYOUTS.includes(b.layout)
  if (!layoutOk) out.push(`layout ${JSON.stringify(b.layout ?? null)} is not grid, canvas or flow`)
  if (!Array.isArray(b.blocks)) return out
  const seen = new Set()
  const cells = new Map()
  b.blocks.forEach((block, i) => {
    const at = `block ${isMap(block) && typeof block.id === 'string' && block.id !== '' ? `"${block.id}"` : `#${i + 1}`}`
    if (!isMap(block)) { out.push(`${at} is not a mapping`); return }
    if (typeof block.id !== 'string' || block.id === '') out.push(`${at} has no id`)
    else if (seen.has(block.id)) { out.push(`two blocks are called "${block.id}": block ids must differ`); return }
    else seen.add(block.id)
    if (!types.includes(block.type)) { out.push(`${at}: type ${JSON.stringify(block.type ?? null)} is not a block type (${types.join(', ')})`); return }
    for (const p of blockProblems(block, ctx.fieldsOf)) out.push(`${at}: ${p}`)
    if (!layoutOk) return
    const places = placeProblems(b.layout, block)
    for (const p of places) out.push(`${at}: ${p}`)
    if (b.layout !== 'grid' || places.length > 0) return
    for (let c = block.place.col; c < block.place.col + block.place.span; c++) {
      const other = cells.get(`${block.place.row}:${c}`)
      if (other) { out.push(`${at} overlaps block "${other}" in row ${block.place.row}`); return }
    }
    for (let c = block.place.col; c < block.place.col + block.place.span; c++) cells.set(`${block.place.row}:${c}`, block.id)
  })
  return out
}
