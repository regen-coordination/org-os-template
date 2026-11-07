import type { JsonSchema } from '../api.ts'
import { controlKind, propOf, type Value } from '../record/fields.ts'
import { dateProblem } from '../design/inputs/DateInput.tsx'
import { slug } from '../slug.ts'

/** Import from a sheet (spec 2026-11-04 §1c): rows pasted from a sheet (tab-separated) or a CSV, the header row
 *  first, read into creates a person sees before anything is staged. A small reader of its own: quoted fields,
 *  commas and line breaks inside quotes, doubled quotes, CRLF. No dependency. */

/** The text as rows of cells. Tab-separated when the header line holds a tab, else comma-separated. A byte-order
 *  mark and blank lines are dropped; a quoted cell keeps its line breaks as written. */
export function parseSheet(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => { row.push(cell); cell = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = [] }
  while (i < src.length) {
    const c = src[i]!
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (c === '"') { quoted = false; i++; continue }
      cell += c; i++; continue
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue }
    if (c === sep) { row.push(cell); cell = ''; i++; continue }
    if (c === '\r' && src[i + 1] === '\n') { endRow(); i += 2; continue }
    if (c === '\n' || c === '\r') { endRow(); i++; continue }
    cell += c; i++
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

/** Each header's field: the one whose id or schema `title` it names, whatever its case and spacing
 *  ("Amount available" names amount_available); null when it names none. */
export function matchHeaders(headers: string[], schema: JsonSchema): (string | null)[] {
  const props = Object.keys(schema.properties ?? {})
  return headers.map(h => {
    const n = norm(h)
    if (n === '') return null
    return props.find(k => norm(k) === n) ?? props.find(k => { const t = propOf(schema, k).title; return t !== undefined && norm(t) === n }) ?? null
  })
}

/** An id not yet taken: the one given, else it with -2, -3… It is taken from then on, so the rows of one import
 *  never share one. */
export function uniqueId(base: string, taken: Set<string>): string {
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

export interface ImportColumn { header: string; field: string | null; left: string | null }
export interface ImportRow { line: number; id: string; value: Value; problems: string[] }
export interface ImportPlan { columns: ImportColumn[]; rows: ImportRow[] }

/** The field an id follows when no id column is given: what a person calls an entry (fields.ts `entryName`). */
const TITLE_FIELDS = ['name', 'title', 'partner']

const humane = (field: string) => field.replace(/_/g, ' ')
const NUMBER = /^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/

/** One cell as the field's value, or why it can't be. */
function read(text: string, kind: string, enumOf: unknown[] | undefined): { value?: unknown; problem?: string } {
  switch (kind) {
    case 'number': return NUMBER.test(text) ? { value: Number(text.replace(/,/g, '')) } : { problem: `“${text}” is not a number` }
    case 'boolean': {
      const b = text.toLowerCase()
      return ['true', 'yes'].includes(b) ? { value: true } : ['false', 'no'].includes(b) ? { value: false } : { problem: `“${text}” is not yes or no` }
    }
    case 'enum': return enumOf!.some(v => String(v) === text) ? { value: text } : { problem: `“${text}” is not one of ${enumOf!.map(String).join(', ')}` }
    case 'date': { const p = dateProblem(text); return p ? { problem: p } : { value: text } }
    case 'list': case 'refs': return { value: text.split(/[;,]/).map(s => s.trim()).filter(Boolean) }
    default: return { value: text }
  }
}

/** The rows under the header row as creates for `registry`, each with its problems (a row with any is not staged).
 *  Columns that name no field, or a field a cell can't hold (records of its own), are left out and say so. An id
 *  column is kept as given; else the id follows the row's name or title (`slug`), unique against `taken` (the file's
 *  ids and what is staged) and the rows before it. */
export function importPlan(table: string[][], schema: JsonSchema, registry: string, taken: Set<string>): ImportPlan {
  const [headers, ...body] = table
  if (!headers) return { columns: [], rows: [] }
  const fields = matchHeaders(headers, schema)
  const seen = new Set<string>()
  const columns: ImportColumn[] = headers.map((header, i) => {
    const field = fields[i] ?? null
    if (field === null) return { header, field, left: header.trim() === '' ? 'has no header' : 'matches no field' }
    if (seen.has(field)) return { header, field: null, left: `names ${humane(field)} again` }
    seen.add(field)
    if (field !== 'id' && controlKind(registry, field, propOf(schema, field)) === 'yaml') return { header, field: null, left: 'holds records of its own: add them on the record' }
    return { header, field, left: null }
  })
  const labelOf = (field: string) => columns.find(c => c.field === field)?.header.trim() ?? humane(field)
  const titleField = TITLE_FIELDS.find(f => Object.hasOwn(schema.properties ?? {}, f)) ?? TITLE_FIELDS.find(f => seen.has(f))
  const required = (schema.required ?? []).filter(f => f !== 'id')
  const ids = new Set(taken)
  const rows = body.map((cells, n): ImportRow => {
    const value: Value = {}
    const problems: string[] = []
    columns.forEach((c, i) => {
      const text = (cells[i] ?? '').trim()
      if (c.field === null || text === '') return
      if (c.field === 'id') { value.id = text; return }
      const p = propOf(schema, c.field)
      const r = read(text, controlKind(registry, c.field, p), p.enum)
      if (r.problem) problems.push(`${c.header.trim()}: ${r.problem}`)
      else value[c.field] = r.value
    })
    for (const f of required) if (value[f] === undefined && !problems.some(p => p.startsWith(`${labelOf(f)}:`))) problems.push(`${labelOf(f)} is required`)
    let id = ''
    if (typeof value.id === 'string') {
      id = value.id
      if (id.startsWith('#')) problems.push('id: ids beginning with # are read as positions; choose another')
      else if (ids.has(id)) problems.push(`id: ${id} is already taken`)
      else ids.add(id)
    } else {
      const base = titleField && typeof value[titleField] === 'string' ? slug(value[titleField] as string) : ''
      if (base === '') problems.unshift(`No ${titleField ? humane(titleField) : 'name'}, so no id to follow it`)
      else id = uniqueId(base, ids)
    }
    return { line: n + 2, id, value: id ? { id, ...value } : value, problems }
  })
  return { columns, rows }
}
