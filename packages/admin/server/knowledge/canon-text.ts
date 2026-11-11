/** The canon's text, written in place (R-43, R-58): one entry's fields set or cleared by splicing only those fields' lines.
 *  The one writer of data/kb/<type>.yaml in this package, used by the commons' entry page (write.ts) and by the change
 *  engine for a knowledge record op (server/changes/apply.ts: a canon edit staged, proposed and ratified like any record op,
 *  L6 Task 10). Pure text in, text out: nothing here reads or writes a file. Moved out of write.ts so apply.ts can use it
 *  without importing the entry page's module (which imports apply.ts). */
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isMap, isScalar, parseDocument, stringify, visit, type Document, type Node as YamlNode, type Pair, type Scalar, type YAMLMap } from 'yaml'
import { HttpError } from '../errors.ts'
import { canonReadDiffers, canonReadDiffersSentence } from '../../lib/workspace/knowledge.mjs'
import { floorPublishable } from '../../lib/workspace/publishable.mjs'

export const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** A field may be set to a string, a number, a yes/no, a list of those, or null to clear it. */
export type FieldValue = string | number | boolean | null | (string | number)[]
export interface EditRequest { fields: Record<string, FieldValue>; base?: string }

/** The entry's identity is not a field: it is where the entry lives, and every reference names it. */
const PROTECTED = new Set(['id', 'type', 'slug'])

/** Validate the fields of an edit: a refusal names the field, never the page. */
export function checkFields(fields: Record<string, unknown>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) throw new HttpError(422, `"${field}" is not a field name: kms's fields are lowercase, with underscores.`)
    if (PROTECTED.has(field)) throw new HttpError(422, `"${field}" is the entry's identity, not a field: it cannot be changed here.`)
    // PF-R5: what the commons shows is kms's gate (maturity and public use), not the house's visibility.
    if (field === 'visibility') throw new HttpError(422, '"visibility" is not a knowledge entry\'s field: what the commons shows is decided by its maturity and public use. Set those instead.')
    if (value === null) { out[field] = null; continue }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') { out[field] = value; continue }
    if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) { out[field] = value; continue }
    throw new HttpError(422, `"${field}" must be text, a number, a yes/no, a list of those, or null to clear it.`)
  }
  if (Object.keys(out).length === 0) throw new HttpError(422, 'Nothing to change: the edit names no field.')
  return out
}

export const canonRel = (type: string): string => join('data', 'kb', `${type}.yaml`)

function parsed(text: string, type: string): Document.Parsed {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    throw new HttpError(409, `${canonRel(type)} cannot be read: ${doc.errors[0]!.message}. Fix the file, then edit here.`)
  }
  return doc
}

/** One entry as the file holds it, from a text — before or after the edit. */
export function entryOf(text: string, type: string, slug: string): Record<string, unknown> {
  const doc = parsed(text, type)
  const entries = doc.get('entries') as { toJS?: (doc: unknown) => unknown } | null
  const all = asObject(entries?.toJS?.(doc) ?? {})
  const entry = all[slug]
  if (entry === undefined) throw new HttpError(404, `No entry "${slug}" in ${type}.yaml. The collection lists every entry the canon holds.`)
  return asObject(entry)
}

/* ── the in-place writer (R-43) ───────────────────────────────────────────────────────────────────────────────── */

type Commented = { commentBefore?: string | null; comment?: string | null }

const lineStart = (t: string, i: number): number => t.lastIndexOf('\n', i - 1) + 1
const lineEnd = (t: string, i: number): number => { const n = t.indexOf('\n', i); return n === -1 ? t.length : n + 1 }
const indentAt = (t: string, i: number): number => i - lineStart(t, i)
const keyOf = (p: Pair): Scalar | null => (isScalar(p.key) ? p.key as Scalar : null)
const blockScalar = (n: Scalar): boolean => n.type === 'BLOCK_FOLDED' || n.type === 'BLOCK_LITERAL'

/** Every comment a document (or a node) holds, as text: the check that nothing an edit did not mean to drop was. */
function commentsOf(node: Document | YamlNode | null | undefined): string[] {
  const out: string[] = []
  const take = (n: Commented | null | undefined) => {
    if (n?.commentBefore) out.push(n.commentBefore)
    if (n?.comment) out.push(n.comment)
  }
  if (!node) return out
  take(node as Commented)
  visit(node as Document, { Node: (_k, n) => { take(n as Commented) } })
  return out
}

/** The lines a pair occupies: from the start of its key's line to the end of its value's last line. */
function pairSpan(text: string, pair: Pair): [number, number] {
  const key = keyOf(pair)!
  const value = pair.value as YamlNode | null
  const end = value?.range ? value.range[1] : key.range![1]
  const to = end > 0 && text[end - 1] === '\n' ? end : lineEnd(text, end)
  return [lineStart(text, key.range![0]), to]
}

/** A field and its value as block YAML lines, at an indent. */
function pairLines(field: string, value: FieldValue, indent: number): string {
  const block = stringify({ [field]: value }, { lineWidth: 0 })
  return block.split('\n').map(l => (l === '' ? l : `${' '.repeat(indent)}${l}`)).join('\n')
}

/** A value as one line of flow YAML, or null when it cannot be one (a list, a text with line breaks). */
function inline(value: FieldValue): string | null {
  if (Array.isArray(value)) return null
  const s = stringify(value, { lineWidth: 0 }).replace(/\n$/, '')
  return s.includes('\n') ? null : s
}

/** One field set (or cleared) in a text, touching only that field's lines. Returns the new text and the comments the
 *  edit may drop: those that sat on the lines of a field it clears. */
function setField(text: string, type: string, slug: string, field: string, value: FieldValue): { text: string; mayDrop: string[] } {
  const doc = parsed(text, type)
  const entries = doc.get('entries', true)
  const entry = isMap(entries) ? (entries as YAMLMap).get(slug, true) : undefined
  if (!isMap(entry)) throw new HttpError(404, `No entry "${slug}" in ${type}.yaml. The collection lists every entry the canon holds.`)
  const map = entry as YAMLMap
  const refuse = (why: string) => new HttpError(409, `${canonRel(type)}: ${why} Nothing was written: make this change in the file.`)
  if (map.flow) throw refuse(`"${slug}" is written on one line ({…}), and an edit here would rewrite it.`)
  const pair = map.items.find(p => keyOf(p)?.value === field) ?? null
  if (value === null) {
    if (!pair) return { text, mayDrop: [] }
    const [from, to] = pairSpan(text, pair)
    const key = keyOf(pair)!
    return { text: text.slice(0, from) + text.slice(to), mayDrop: [...commentsOf(pair.value as YamlNode), ...(key.comment ? [key.comment] : [])] }
  }
  if (pair) {
    const v = pair.value as YamlNode | null
    const one = inline(value)
    // A one-line scalar becomes another: only its own characters change, so an inline comment stays where it was.
    if (one !== null && isScalar(v) && v.range && v.range[1] > v.range[0] && !blockScalar(v as Scalar)
      && !text.slice(v.range[0], v.range[1]).includes('\n')) {
      return { text: text.slice(0, v.range[0]) + one + text.slice(v.range[1]), mayDrop: [] }
    }
    const [from, to] = pairSpan(text, pair)
    return { text: text.slice(0, from) + pairLines(field, value, indentAt(text, keyOf(pair)!.range![0])) + text.slice(to), mayDrop: [] }
  }
  // A field the entry does not have yet: its lines after the entry's last field, at its keys' indent.
  const first = map.items[0] ? keyOf(map.items[0]) : null
  const last = map.items[map.items.length - 1]
  if (!first?.range || !last) throw refuse(`"${slug}" holds no field to place a new one beside.`)
  const at = pairSpan(text, last)[1]
  const lead = at > 0 && text[at - 1] !== '\n' ? '\n' : ''
  return { text: text.slice(0, at) + lead + pairLines(field, value, indentAt(text, first.range[0])) + text.slice(at), mayDrop: [] }
}

/** The file's text with one entry's fields set. Only those fields' lines change (R-43); the result is checked against
 *  the document API's own answer for the same edit, and against the comments the file held, before anything uses it:
 *  an edit that could only be made by rewriting other lines, or by dropping a comment, is refused, not approximated. */
export function applyToText(text: string, type: string, slug: string, fields: Record<string, FieldValue>): string {
  // PF-R2 (fail closed): a canon kms reads differently (anchors, merge keys, tags, a YAML 1.1 directive) is judged by no
  // reading the house shares with it, so the house writes none of its entries.
  const differs = canonReadDiffers(text)
  if (differs !== null) throw new HttpError(409, canonReadDiffersSentence(canonRel(type), differs, 'Nothing was written.'))
  const doc = parsed(text, type)
  const entries = doc.get('entries') as { get?: (k: string) => unknown } | null
  const node = entries?.get?.(slug) as { set: (k: string, v: unknown) => void; delete: (k: string) => void } | undefined
  if (!node) throw new HttpError(404, `No entry "${slug}" in ${type}.yaml. The collection lists every entry the canon holds.`)
  for (const [field, value] of Object.entries(fields)) {
    if (value === null) node.delete(field)
    else node.set(field, value)
  }
  const expected = doc.toJS()

  let out = text
  const mayDrop: string[] = []
  for (const [field, value] of Object.entries(fields)) {
    const step = setField(out, type, slug, field, value)
    out = step.text
    mayDrop.push(...step.mayDrop)
  }
  const after = parsed(out, type)
  if (!isDeepStrictEqual(after.toJS(), expected)) {
    throw new HttpError(409, `${canonRel(type)}: this edit cannot be made without rewriting lines it does not touch. Nothing was written: make this change in the file.`)
  }
  const left = commentsOf(after)
  const lost = commentsOf(parsed(text, type)).filter(c => {
    const i = left.indexOf(c)
    if (i >= 0) { left.splice(i, 1); return false }
    const j = mayDrop.indexOf(c)
    if (j >= 0) { mayDrop.splice(j, 1); return false }
    return true
  })
  if (lost.length > 0) {
    throw new HttpError(409, `${canonRel(type)}: this edit would drop a comment ("${lost[0]!.trim()}"). Nothing was written: make this change in the file, where the comment can move with it.`)
  }
  return out
}

/* ── the whole-file judgement (PF-R3) ─────────────────────────────────────────────────────────────────────────── */

/** The entries a canon text holds as the house reads it, and everything else in it. */
function wholeOf(text: string, type: string): { entries: Record<string, unknown>; rest: Record<string, unknown> } {
  const { entries, ...rest } = asObject(parsed(text, type).toJS())
  return { entries: asObject(entries), rest }
}

/** Ruling PF-R3 (review I1), the backstop behind PF-R2: a knowledge op is judged over its whole file, before against after,
 *  wherever it is applied (the tray's apply and a ratify's build, server/changes/apply.ts; the entry page's, write.ts).
 *  Every entry it does not name, and everything outside `entries:`, must read as it did (an anchor shared between entries
 *  would let an edit of one change another through its alias); and the entries the commons' floor calls publishable may
 *  grow only by entries the op names, and only when the change was decided as a publication (`publication`, a thunk so it
 *  is judged only when the set grows). Refused 409, nothing written. */
export function judgeCanonWrite(before: string, after: string, type: string, named: ReadonlySet<string>, publication: boolean | (() => boolean)): void {
  const was = wholeOf(before, type)
  const now = wholeOf(after, type)
  const refuse = (why: string) => new HttpError(409, `${canonRel(type)}: ${why} Nothing was written: make this change in the file.`)
  const others = [...new Set([...Object.keys(was.entries), ...Object.keys(now.entries)])].filter(slug => !named.has(slug))
  const moved = others.find(slug => !isDeepStrictEqual(was.entries[slug], now.entries[slug]))
  if (moved !== undefined) {
    throw refuse(`this edit would also change "${moved}", an entry it does not name (the two share a value in the file).`)
  }
  if (!isDeepStrictEqual(was.rest, now.rest)) throw refuse('this edit would also change what the file holds outside its entries.')
  const publishable = (entries: Record<string, unknown>) =>
    new Set(Object.entries(entries).filter(([, object]) => floorPublishable(asObject(object))).map(([slug]) => slug))
  const had = publishable(was.entries)
  const grown = [...publishable(now.entries)].filter(slug => !had.has(slug))
  const stranger = grown.find(slug => !named.has(slug))
  if (stranger !== undefined) throw refuse(`this edit would make "${stranger}" publishable, an entry it does not name.`)
  if (grown.length > 0 && !(typeof publication === 'function' ? publication() : publication)) {
    throw refuse(`this edit would make "${grown[0]}" publishable, and it was not decided as a publication.`)
  }
}
