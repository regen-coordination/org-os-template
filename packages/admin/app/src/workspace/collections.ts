// DAO-OS L6 Task 17: a collection's rules in the client (spec §7.2, §7.3, §7.6) — its fields as the views draw and edit
// them, its board's columns and the order of the cards in them, the ops a move makes, the ids a new record, saved view and
// collection take, what this tab wrote and the read does not hold yet, and the map's graph. Pure: CollectionPage and its
// tests hand it what they hold.
import type { CollectionView, Entity, RecordOp } from '../api.ts'
import type { FieldType } from '../../../server/workspace/collections.ts'
import { fieldWord } from '../elements/views/filters.ts'
import type { RecordItem } from '../map/fromRecords.ts'
import type { MapLink } from '../map/layers.ts'
import { orderBetween, ORDER_STEP } from '../../../lib/workspace/pages.mjs'

/** A record as GET /api/registries/:name gives it: its fields, its level (`visibility`) and the gate's marker of the
 *  fields kept from this viewer (`restricted`: field → level, no value). */
export type Row = Entity & { visibility?: string; restricted?: Record<string, string> }

/** One field as the views read it: its id, the words the header says, its type (§7.3), and a relation's collection. */
export interface Field { id: string; label: string; type: FieldType; options?: string[]; to?: string; many?: boolean }

/** The Hub's built-in collections whose records are workspace writes (§3.1); a custom collection is one too. */
export const WORKSPACE_BUILTINS: readonly string[] = ['tasks', 'meetings']

/** Does a record of this collection go through POST /api/workspace/records (a workspace write), rather than the tray? */
export function isWorkspaceCollection(id: string, def?: CollectionView): boolean {
  return WORKSPACE_BUILTINS.includes(id) || (def !== undefined && !def.builtin)
}

const f = (id: string, label: string, type: FieldType, more: Partial<Field> = {}): Field => ({ id, label, type, ...more })
/** The built-ins' fields (§7.2): a task's and a meeting's, in the order the table draws them. */
const BUILTIN_FIELDS: Record<string, Field[]> = {
  tasks: [f('title', 'Task', 'text'), f('status', 'Status', 'select'), f('owner', 'Owner', 'person'), f('due', 'Due', 'date'),
    f('project', 'Project', 'relation', { to: 'projects' }), f('meeting', 'Meeting', 'relation', { to: 'meetings' }),
    f('proposal', 'Proposal', 'relation', { to: 'proposals' }), f('priority', 'Priority', 'text')],
  meetings: [f('title', 'Meeting', 'text'), f('date', 'Date', 'date'), f('type', 'Type', 'select'), f('notes', 'Notes', 'page')],
}
/** What a collection is called where no definition names it. */
export const BUILTIN_NAMES: Record<string, string> = { tasks: 'Tasks', meetings: 'Meetings' }
/** A record of the collection, in a button's words ("New task"). */
export const RECORD_WORD: Record<string, string> = { tasks: 'task', meetings: 'meeting' }

/** The gate's own keys on a row, never a field. */
const GATE_KEYS = new Set(['id', 'visibility', 'restricted'])

/** A collection's fields: the built-ins' own; a custom collection's definition's; else every key its rows hold (and the
 *  fields the gate kept from this viewer), each named in sentence case. */
export function fieldsOf(id: string, def?: { fields?: { id: string; type: FieldType; name?: string; options?: string[]; to?: string; many?: boolean }[] }, rows: Row[] = []): Field[] {
  if (Object.hasOwn(BUILTIN_FIELDS, id)) return BUILTIN_FIELDS[id]!
  if (def?.fields && def.fields.length > 0) {
    return def.fields.map(d => ({ id: d.id, label: d.name ?? fieldWord(d.id), type: d.type,
      ...(d.options ? { options: d.options } : {}), ...(d.to ? { to: d.to } : {}), ...(d.many ? { many: true } : {}) }))
  }
  const keys: string[] = []
  for (const r of rows) for (const k of [...Object.keys(r), ...Object.keys(r.restricted ?? {})]) if (!GATE_KEYS.has(k) && !keys.includes(k)) keys.push(k)
  return keys.map(k => f(k, fieldWord(k), 'text'))
}

/** The field a record is named by: `title`, else `name`, else the first text field, else its id. */
export function titleFieldOf(fields: Field[]): string {
  return fields.find(x => x.id === 'title')?.id ?? fields.find(x => x.id === 'name')?.id ?? fields.find(x => x.type === 'text')?.id ?? 'id'
}

/** A board's field: the one asked for (a saved view's `board.field`), else `status`, else the first select. */
export function boardFieldOf(fields: Field[], asked?: string): string | null {
  if (asked !== undefined && fields.some(x => x.id === asked)) return asked
  return fields.find(x => x.id === 'status')?.id ?? fields.find(x => x.type === 'select')?.id ?? null
}

/** A calendar's field: the one asked for (a saved view's `date`), else the first date or date range. */
export function dateFieldOf(fields: Field[], asked?: string): string | null {
  if (asked !== undefined && fields.some(x => x.id === asked)) return asked
  return fields.find(x => x.type === 'date' || x.type === 'daterange')?.id ?? null
}

/** A value as one line of text: a list's items joined, a checkbox Yes or No, a date range with its dash, nothing empty. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(cellText).filter(s => s !== '').join(', ')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') {
    const o = v as { start?: unknown; end?: unknown }
    if (o.start !== undefined) return o.end ? `${cellText(o.start)} – ${cellText(o.end)}` : cellText(o.start)
    return JSON.stringify(v)
  }
  return String(v)
}

/** A row's day for the calendar, `YYYY-MM-DD` (a date-time's day; a range's start); null for none. */
export function dayOf(v: unknown): string | null {
  const s = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as { start?: unknown }).start : v
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

// ── the board ───────────────────────────────────────────────────────────────────────────────────────

/** The column of a row with no value in the board's field. */
export const NONE = ''

/** The value a card's column is read from: the first item of a list. */
export function columnValue(r: Row, field: string): string {
  const v = r[field]
  const one = Array.isArray(v) ? v[0] : v
  return one === null || one === undefined || one === '' ? NONE : String(one)
}

/** A board's columns (§7.2): the saved view's `board.order`, then the field's values in the order first met, then a
 *  select's options not yet met (so an empty collection has its columns), then "No <field>" for rows with none — or
 *  alone, when there is nothing else, so a first card can be added. */
export function boardColumns(rows: Row[], field: Field, order: readonly string[] = []): { id: string; name: string }[] {
  const ids: string[] = [...order]
  let none = false
  for (const r of rows) {
    const v = columnValue(r, field.id)
    if (v === NONE) none = true
    else if (!ids.includes(v)) ids.push(v)
  }
  for (const o of field.options ?? []) if (!ids.includes(o)) ids.push(o)
  if (none || ids.length === 0) ids.push(NONE)
  return ids.map(id => ({ id, name: id === NONE ? `No ${field.label.toLowerCase()}` : id }))
}

const orderOf = (r: Row): number | null => (typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : null)

/** Cards in their column's order: by `order`, those without one after, each in its place in the file. */
export function inColumnOrder<T extends Row>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = orderOf(a.r), y = orderOf(b.r)
    if (x !== null && y !== null) return x - y || a.i - b.i
    if (x !== null) return -1
    if (y !== null) return 1
    return a.i - b.i
  }).map(e => e.r)
}

/** The ops that put `card` at position `at` of a column (`cards`, in order, without it), with `set` (its new column's
 *  value, on a move across) on its own op: its order between its neighbours'; where a neighbour has none or there is no
 *  room between them, the column numbered anew (ORDER_STEP apart), one op for each card whose order changes. */
export function placeOps(collection: string, cards: Row[], card: Row, at: number, set: Record<string, unknown>): RecordOp[] {
  const op = (r: Row, s: Record<string, unknown>): RecordOp => ({ op: 'update', record: `${collection}:${r.id}`, set: s })
  const prev = cards[at - 1], next = cards[at]
  const unordered = (prev !== undefined && orderOf(prev) === null) || (next !== undefined && orderOf(next) === null)
  const between = unordered ? 'renumber' : orderBetween(prev ? orderOf(prev) : null, next ? orderOf(next) : null)
  if (between !== 'renumber') return [op(card, { ...set, order: between })]
  const placed = [...cards.slice(0, at), card, ...cards.slice(at)]
  return placed.flatMap((r, i) => {
    const order = (i + 1) * ORDER_STEP
    if (r === card) return [op(r, { ...set, order })]
    return orderOf(r) === order ? [] : [op(r, { order })]
  })
}

// ── ids ─────────────────────────────────────────────────────────────────────────────────────────────

const slug = (s: string, sep: '-' | '_', max: number): string =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '')
    .slice(0, max).replace(new RegExp(`\\${sep}+$`), '')

const hex4 = (): string => {
  const a = new Uint8Array(2)
  globalThis.crypto.getRandomValues(a)
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

/** A new record's id: its title's slug and four hex digits (as a page's, §4.1), `record-…` for an empty title. */
export function recordIdOf(title: string, random: () => string = hex4): string {
  return `${slug(title, '-', 48) || 'record'}-${random()}`
}

const VIEW_KINDS = ['table', 'board', 'calendar', 'list', 'map']
/** A saved view's id from its name (§7.3's `^[a-z][a-z0-9-]{0,40}$`): never one taken, nor a view kind's (the address
 *  `/c/<collection>/<kind>` is the kind's). */
export function viewIdOf(name: string, taken: readonly string[]): string {
  let base = slug(name, '-', 36) || 'view'
  if (!/^[a-z]/.test(base)) base = `v-${base}`
  if (VIEW_KINDS.includes(base)) base = `${base}-view`
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/** A collection's id from its name (§7.4: 2 to 41 lowercase letters, digits and hyphens): the server says what is wrong
 *  with it. */
export const collectionIdOf = (name: string): string => slug(name, '-', 41)
/** A field's id from its name (§7.4: lowercase letters, digits and underscores). */
export const fieldIdOf = (name: string): string => slug(name, '_', 41)

// ── what this tab wrote, before the read holds it ──────────────────────────────────────────────────────

/** A record this tab wrote directly, kept until GET /api/registries holds it: a batch is committed RECORD_IDLE_MS after
 *  the last write (§6), so the read lags the write by that long. `created` is a new record's value; `set` the fields. */
export interface KeptRow { at: number; created?: Row; set: Record<string, unknown> }
export type Kept = Record<string, KeptRow>

/** The rows as the read holds them with what this tab wrote laid over them, new records after. */
export function withKept(rows: Row[], kept: Kept): Row[] {
  const out = rows.map(r => (Object.hasOwn(kept, String(r.id)) ? { ...r, ...kept[String(r.id)]!.set } : r))
  for (const [id, k] of Object.entries(kept)) if (k.created && !rows.some(r => String(r.id) === id)) out.push({ ...k.created, ...k.set })
  return out
}

/** What is still kept once the read holds `rows`: a created record the read has is no longer created, a field it holds
 *  as written is no longer set, and what is older than `maxAge` is forgotten (a batch that went to the tray instead says
 *  so in the tray). */
export function pruneKept(kept: Kept, rows: Row[], now: number, maxAge: number): Kept {
  const out: Kept = {}
  for (const [id, k] of Object.entries(kept)) {
    if (now - k.at > maxAge) continue
    const row = rows.find(r => String(r.id) === id)
    const created = row ? undefined : k.created
    const set = Object.fromEntries(Object.entries(k.set).filter(([f, v]) => !row || JSON.stringify(row[f] ?? null) !== JSON.stringify(v ?? null)))
    if (created || Object.keys(set).length > 0) out[id] = { at: k.at, ...(created ? { created } : {}), set }
  }
  return out
}

/** What a direct write leaves kept, op by op. */
export function keepOps(kept: Kept, collection: string, ops: RecordOp[], now: number): Kept {
  const out = { ...kept }
  for (const op of ops) {
    if (!op.record.startsWith(`${collection}:`)) continue
    const id = op.record.slice(collection.length + 1)
    const was = out[id]
    if (op.op === 'create') out[id] = { at: now, created: op.value as Row, set: {} }
    else if (op.op === 'update') out[id] = { at: now, ...(was?.created ? { created: was.created } : {}), set: { ...(was?.set ?? {}), ...op.set } }
  }
  return out
}

// ── the map (§7.6) ──────────────────────────────────────────────────────────────────────────────────────

/** The kind a linked record's node is drawn as. */
const KIND_OF: Record<string, string> = { projects: 'project', meetings: 'meeting', proposals: 'proposal', tasks: 'task' }

/** A collection as a graph: its records as nodes, and an edge for each relation field (a task's project, meeting and
 *  proposal among them) to a record of this collection the viewer sees or one `known` names. Rule 7: an edge to a record
 *  the viewer may not see is dropped, and so is its node. */
export function collectionGraph(records: Row[], def: { id: string; fields?: { id: string; type: FieldType; name?: string; to?: string }[] },
  known: (collection: string, id: string) => { name: string; visibility?: string } | null = () => null,
  /** A record's name on its node; by default its title, "<level> only" where the title is kept from the viewer (never
   *  its id, which a new record takes from its title). */
  nameOf?: (r: Row) => string): { items: RecordItem[]; links: MapLink[] } {
  const fields = fieldsOf(def.id, def as never, records)
  const title = titleFieldOf(fields)
  const nodeId = (collection: string, id: string) => `${collection}:${id}`
  const named = nameOf ?? ((r: Row) => { const kept = r.restricted?.[title]; return kept !== undefined ? `${kept} only` : cellText(r[title]) || String(r.id) })
  const items: RecordItem[] = records.map(r => ({ id: nodeId(def.id, String(r.id)), kind: KIND_OF[def.id] ?? 'record', name: named(r), facts: {},
    ...(r.visibility !== undefined ? { visibility: r.visibility } : {}) }))
  const mine = new Set(records.map(r => String(r.id)))
  const links: MapLink[] = []
  const added = new Set(items.map(i => i.id))
  for (const r of records) {
    for (const field of fields.filter(x => x.type === 'relation' && x.to)) {
      const to = field.to!
      const targets = (Array.isArray(r[field.id]) ? r[field.id] as unknown[] : [r[field.id]]).filter((v): v is string => typeof v === 'string' && v !== '')
      for (const t of targets) {
        const target = nodeId(to, t)
        if (!(to === def.id && mine.has(t))) {
          const k = to === def.id ? null : known(to, t)
          if (!k) continue
          if (!added.has(target)) {
            added.add(target)
            items.push({ id: target, kind: KIND_OF[to] ?? 'record', name: k.name, facts: {}, ...(k.visibility !== undefined ? { visibility: k.visibility } : {}) })
          }
        }
        links.push({ from: nodeId(def.id, String(r.id)), to: target, label: field.label.toLowerCase() })
      }
    }
  }
  return { items, links }
}
