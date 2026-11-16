import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap } from 'yaml'
import { registryDef, resolveTopKey, type RegistryDef } from './registries.ts'

/**
 * The last check before a registry file is written: does the new text hold
 * what the file held before, plus the one edit that was asked for?
 *
 * Why it reads the text and not the parsed values: the YAML library reads a
 * number into a JavaScript number, which keeps about 16 digits. A 20-digit
 * integer and its rounded form parse to the same value, so a comparison of
 * parsed values cannot tell them apart. Here a number is compared by the
 * digits written in the file (`exactNumber`).
 *
 * Why it compares with the file as it was, not with the document the edit
 * was made on: that document has already been changed, so a comparison with
 * it only proves the text matches the edit that happened, not the edit that
 * was asked for. An alias (`*name`) is followed to the value it stands for, so
 * an edit that reaches another entry through an anchor shows up as a change
 * to that entry.
 */
export type Edit =
  | { kind: 'update'; index: number; entity: Record<string, unknown> }
  | { kind: 'create'; entity: Record<string, unknown> }
  | { kind: 'delete'; index: number }

/**
 * A number literal as an exact value, in one form whatever the spelling:
 * the digits without zeros at either end, then the power of ten. `10`, `10.0`
 * and `1e1` all read `1e1`; `0x1F`, `0x1f` and `31` read `31e0`;
 * 12345678901234567890 and 12345678901234567000 differ.
 *
 * Why one form: an integer used to keep all its digits (`10`) while a number
 * with a point or an exponent was reduced (`1e1`), so the same value had two
 * forms and a comparison of forms called `10.0` and `10` different numbers
 * (third review, N6).
 */
export function exactNumber(source: string): string {
  const s = source.trim()
  const based = /^0x[0-9a-fA-F]+$/.test(s) || /^0o[0-7]+$/.test(s) ? BigInt(s).toString() : s
  const parts = /^([-+]?)(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([-+]?[0-9]+))?$/.exec(based)
  if (!parts) return s.toLowerCase() // .inf, .nan
  const [, sign, whole = '', fraction = '', bare = '', exp = '0'] = parts
  const decimals = fraction || bare
  const digits = (whole + decimals).replace(/^0+/, '')
  if (digits === '') return '0'
  const mantissa = digits.replace(/0+$/, '')
  const exponent = BigInt(exp) - BigInt(decimals.length) + BigInt(digits.length - mantissa.length)
  return `${sign === '-' ? '-' : ''}${mantissa}e${exponent}`
}

/** A node as a string in which two nodes agree only when they hold exactly the same data. */
function exact(node: unknown, doc: Document, depth = 0): string {
  if (depth > 100) throw new Error('the file nests or refers to itself too deeply to check')
  if (isAlias(node)) {
    const target = node.resolve(doc)
    if (!target) throw new Error(`the alias *${node.source} refers to an anchor that is not there`)
    return exact(target, doc, depth + 1)
  }
  if (isMap(node)) return `{${node.items.map(p => `${exact(p.key, doc, depth + 1)}:${exact(p.value, doc, depth + 1)}`).join(',')}}`
  if (isSeq(node)) return `[${node.items.map(item => exact(item, doc, depth + 1)).join(',')}]`
  if (isScalar(node)) {
    const { value } = node
    if (typeof value === 'number' || typeof value === 'bigint') return `#${exactNumber(node.source ?? String(value))}`
    return JSON.stringify(value) ?? 'null'
  }
  return node === null || node === undefined ? 'null' : JSON.stringify(node)
}

const keyOf = (pair: { key: unknown }) => (isScalar(pair.key) ? String(pair.key.value) : String(pair.key))
const shown = (node: unknown) => (isScalar(node) ? (node.source ?? String(node.value)) : 'its value')
const label = (item: unknown, index: number) => {
  const id = isMap(item) ? item.get('id') : undefined
  return id === undefined || id === null ? `entry number ${index + 1}` : `entry "${String(id)}"`
}

/** Every number written under `node`, by the JavaScript number it reads as:
 *  exact value → the text in the file. */
function literals(node: unknown, doc: Document, found = new Map<number, Map<string, string>>(), depth = 0): Map<number, Map<string, string>> {
  if (depth > 100) return found
  if (isAlias(node)) return literals(node.resolve(doc), doc, found, depth + 1)
  if (isMap(node)) for (const pair of node.items) literals(pair.value, doc, found, depth + 1)
  else if (isSeq(node)) for (const item of node.items) literals(item, doc, found, depth + 1)
  else if (isScalar(node) && typeof node.value === 'number') {
    const text = node.source ?? String(node.value)
    found.set(node.value, (found.get(node.value) ?? new Map()).set(exactNumber(text), text))
  }
  return found
}

/**
 * For a field the request replaced: a number about to be written that is the
 * rounded form of a number the field held, as words; or null.
 *
 * Why it is needed: the request's value came through JSON, so it is already
 * rounded, and comparing it with what was written compares two rounded
 * numbers. A value the field held that reads as the same JavaScript number
 * but has other digits can only have been lost on the way, so the text about
 * to be written must carry one of those, digit for digit.
 */
function roundedAway(written: unknown, doc: Document, held: Map<number, Map<string, string>>, depth = 0): string | null {
  if (depth > 100) return null
  if (isAlias(written)) return roundedAway(written.resolve(doc), doc, held, depth + 1)
  const inner = isMap(written) ? written.items.map(p => p.value) : isSeq(written) ? written.items : []
  for (const node of inner) {
    const lost = roundedAway(node, doc, held, depth + 1)
    if (lost) return lost
  }
  if (!isScalar(written) || typeof written.value !== 'number') return null
  const short = exactNumber(String(written.value)) // the number as JSON carries it
  const longer = new Map([...(held.get(written.value) ?? [])].filter(([exactly]) => exactly !== short))
  const text = written.source ?? String(written.value)
  if (longer.size === 0 || longer.has(exactNumber(text))) return null
  return `${[...longer.values()][0]} would become ${text}`
}

/** Whether some number under `a` is written under `b` with other digits while
 *  still reading as the same JavaScript number: the one change that means a
 *  number was too long to be kept, and not that something else went wrong. */
function digitsLost(a: unknown, aDoc: Document, b: unknown, bDoc: Document): boolean {
  const after = literals(b, bDoc)
  for (const [value, exacts] of literals(a, aDoc)) {
    const now = after.get(value)
    if (now && [...exacts.keys()].some(exactly => !now.has(exactly))) return true
  }
  return false
}

/** The first field in which two entries differ, as words. */
function fieldDiff(a: YAMLMap, aDoc: Document, b: YAMLMap, bDoc: Document, only?: (key: string) => boolean): string | null {
  const after = new Map(b.items.map(p => [keyOf(p), p.value]))
  for (const pair of a.items) {
    const key = keyOf(pair)
    if (only && !only(key)) continue
    if (!after.has(key)) return `field "${key}" would be removed`
    if (exact(pair.value, aDoc) !== exact(after.get(key), bDoc)) {
      return `field "${key}": ${shown(pair.value)} would become ${shown(after.get(key))}`
    }
  }
  const before = new Set(a.items.map(keyOf))
  for (const key of after.keys()) if ((!only || only(key)) && !before.has(key)) return `field "${key}" would be added`
  return null
}

function entryDiff(a: unknown, aDoc: Document, b: unknown, bDoc: Document, named: string): string | null {
  if (exact(a, aDoc) === exact(b, bDoc)) return null
  const detail = isMap(a) && isMap(b) ? fieldDiff(a, aDoc, b, bDoc) : null
  return `${named}, ${detail ?? 'which would not read the same'}`
}

/** One entry of a registry file: its key in a map-shaped file (L6 §7.1), null in a list; and its node. */
interface Held { key: string | null; node: unknown }

/** A map entry's fields without `id`: the key is its id (L6 §7.1). */
const withoutId = (entity: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'id'))

/** Why a text cannot be written: `what` names the first thing that would
 *  differ; `digits` says whether that is a number too long to be kept (so that
 *  the refusal can give the advice about numbers only when it applies). */
export interface Unintended { what: string; digits: boolean }

/**
 * `src` is the registry file as it was, `text` what is about to be written,
 * `edit` what was asked for. Returns null when `text` is exactly `src` with
 * that edit, or what would differ.
 */
export function whyNot(src: string, text: string, registry: string | RegistryDef, edit: Edit): Unintended | null {
  const other = (what: string): Unintended => ({ what, digits: false })
  try {
    const before = parseDocument(src); const after = parseDocument(text)
    if (after.errors.length > 0) return other(`the result would not be valid YAML (${after.errors[0]!.message.split('\n')[0]})`)
    const def = typeof registry === 'string' ? registryDef(registry) : registry
    const keyed = def.shape === 'map'
    const topKey = resolveTopKey(k => after.has(k), def)
    const top = (doc: Document) => (isMap(doc.contents) ? doc.contents.items : [])
    const others = (doc: Document) => top(doc).filter(p => keyOf(p) !== topKey)

    // Everything that is not the list of entries stays as it was.
    const [a, b] = [others(before), others(after)]
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (!a[i] || !b[i] || keyOf(a[i]!) !== keyOf(b[i]!) || exact(a[i]!.value, before) !== exact(b[i]!.value, after)) {
        return {
          what: `the top-level key "${keyOf((a[i] ?? b[i])!)}" would change`,
          digits: Boolean(a[i] && b[i]) && digitsLost(a[i]!.value, before, b[i]!.value, after),
        }
      }
    }

    // A map-shaped file's entries are its pairs, each named by its key; a list's, its items.
    const list = (doc: Document): Held[] => {
      const node = doc.get(topKey, true)
      if (keyed) return isMap(node) ? node.items.map(p => ({ key: keyOf(p), node: p.value })) : []
      return isSeq(node) ? node.items.map(item => ({ key: null, node: item })) : []
    }
    const named = (held: Held | undefined, index: number) =>
      (held?.key !== null && held?.key !== undefined ? `entry "${held.key}"` : label(held?.node, index))
    const was = list(before); const now = list(after)
    const entity = keyed && edit.kind !== 'delete' ? withoutId(edit.entity) : edit.kind === 'delete' ? {} : edit.entity
    const untouched = was.map((item, index) => ({ item, index })).filter(e => edit.kind === 'create' || e.index !== edit.index)
    const expected = untouched.length + (edit.kind === 'delete' ? 0 : 1)
    if (now.length !== expected) return other(`the list would hold ${now.length} entries where ${expected} are expected`)

    // Every entry except the one edited reads exactly as before.
    for (const [position, { item, index }] of untouched.entries()) {
      const at = edit.kind === 'update' && index > edit.index ? position + 1 : position
      if (item.key !== (now[at]?.key ?? null)) return other(`${named(item, index)}, which would not read the same`)
      const diff = entryDiff(item.node, before, now[at]?.node, after, named(item, index))
      if (diff) return { what: diff, digits: digitsLost(item.node, before, now[at]?.node, after) }
    }
    if (edit.kind === 'delete') return null

    // The edited entry holds what was asked for; fields the edit left alone read exactly as before.
    const index = edit.kind === 'update' ? edit.index : now.length - 1
    const held = now[index]
    const written = held?.node
    const where = named(held, index)
    if (!isMap(written)) return other(`${where} would not be written as an entry`)
    // In a map, the entry's key is its id: it is the id that was sent, and the id is no field of it.
    if (keyed && held!.key !== String(edit.entity.id)) return other(`${where} would not be written under the id that was sent`)
    const got = (keyed ? withoutId(written.toJS(after) as Record<string, unknown>) : written.toJS(after)) as Record<string, unknown>
    const same = (key: string) => JSON.stringify(got[key]) === JSON.stringify(entity[key])
    for (const key of new Set([...Object.keys(entity), ...Object.keys(got)])) {
      // Own keys only: `'toString' in got` is true of every object.
      if (!Object.hasOwn(got, key)) return other(`${where}, field "${key}" would be missing`)
      if (!Object.hasOwn(entity, key)) return other(`${where}, field "${key}" would be left in`)
      if (!same(key)) return other(`${where}, field "${key}" would not hold the value that was sent`)
    }
    const old = was[index]?.node
    if (edit.kind === 'update' && isMap(old)) {
      const current = (old as YAMLMap).toJS(before) as Record<string, unknown>
      const kept = (key: string) => Object.hasOwn(current, key) && JSON.stringify(current[key]) === JSON.stringify(entity[key])
      const diff = fieldDiff(old as YAMLMap, before, written, after, kept)
      if (diff) return { what: `${where}, ${diff}`, digits: digitsLost(old, before, written, after) }
      // Fields the edit replaced: no number in them was rounded on the way through JSON.
      for (const key of Object.keys(entity)) {
        if (kept(key)) continue
        const lost = roundedAway(written.get(key, true), after, literals((old as YAMLMap).get(key, true), before))
        if (lost) return { what: `${where}, field "${key}": ${lost}`, digits: true }
      }
    }
    return null
  } catch (err) {
    return other(err instanceof Error ? err.message : String(err))
  }
}

/** `whyNot` as a phrase alone, or null. */
export function unintendedChange(src: string, text: string, registry: string | RegistryDef, edit: Edit): string | null {
  return whyNot(src, text, registry, edit)?.what ?? null
}
