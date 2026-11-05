import { Document, YAMLMap, isMap, isScalar, type Pair, type YAMLSeq } from 'yaml'

/**
 * Line-level edits to a registry file.
 *
 * Why this exists: `doc.toString()` re-serializes the whole document in the
 * YAML library's own style. On real registries that re-wraps long strings and
 * re-aligns comments in entities nobody touched, so a one-field edit showed up
 * in git as dozens of changed lines. Each function here takes the file's
 * original text and returns new text in which only the lines of the edited
 * field (or the created/deleted entity) differ, or `null` when the file's
 * layout is one it does not handle (flow-style entities, two keys on a line).
 * The caller then falls back to re-serializing. Whichever text is used, it is
 * parsed back and compared with the file as it was before it is written, and
 * refused if anything but the edit differs (`saveDoc` in registry.ts, verify.ts).
 */

/** Never fold long lines: folding is what rewrote untouched text. */
export const STRINGIFY = { flowCollectionPadding: false, lineWidth: 0 } as const

interface Span { first: number; last: number } // inclusive 0-based line numbers
interface PairSpan extends Span { key: string }
interface Layout { prefix: string; keyCol: number; pairs: PairSpan[] }

class Lines {
  readonly lines: string[]
  private readonly starts: number[] = [0]
  constructor(readonly src: string) {
    this.lines = src.split('\n')
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.starts.push(i + 1)
  }
  lineOf(offset: number): number {
    let lo = 0; let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid]! <= offset) lo = mid; else hi = mid - 1
    }
    return lo
  }
  colOf(offset: number): number { return offset - this.starts[this.lineOf(offset)]! }
  /** The line holding the last non-blank character before `end`. */
  lastLineBefore(end: number): number {
    return this.lineOf(Math.max(this.src.slice(0, end).trimEnd().length - 1, 0))
  }
}

/** Where each `key: value` pair of a block-style entity sits in the source. */
function layoutOf(text: Lines, item: YAMLMap): Layout | null {
  if (item.flow || !item.range || item.items.length === 0) return null
  const pairs: PairSpan[] = []
  let prefix = ''; let keyCol = -1
  for (const pair of item.items) {
    const { key, value } = pair as Pair<unknown, { range?: [number, number, number] | null } | null>
    if (!isScalar(key) || !key.range) return null
    const first = text.lineOf(key.range[0]); const col = text.colOf(key.range[0])
    const before = text.lines[first]!.slice(0, col)
    if (pairs.length === 0) {
      if (!/^\s*-\s+$/.test(before)) return null
      prefix = before; keyCol = col
    } else if (col !== keyCol || before.trim() !== '' || first <= pairs.at(-1)!.last) {
      return null
    }
    const last = Math.max(first, text.lastLineBefore(value?.range?.[1] ?? key.range[1]))
    const name = String(key.value)
    if (pairs.some(p => p.key === name)) return null
    pairs.push({ key: name, first, last })
  }
  return { prefix, keyCol, pairs }
}

/** One pair rendered on its own, at column 0, without the comment above it
 *  (that comment is kept from the source, not re-rendered). */
function renderPair(pair: Pair): string[] {
  const clone = pair.clone() as Pair
  if (isScalar(clone.key)) { clone.key.commentBefore = null; clone.key.spaceBefore = false }
  const map = new YAMLMap()
  map.items.push(clone)
  const doc = new Document()
  doc.contents = map
  return doc.toString(STRINGIFY).replace(/\n$/, '').split('\n')
}

const indent = (lines: string[], by: string) => lines.map(l => (l === '' ? l : by + l))

/**
 * `item` is the entity as parsed from `src`; `mutated` is the same node after
 * the edit. `changed` names the keys whose value is new or different.
 */
export function spliceUpdate(src: string, item: YAMLMap, mutate: () => Set<string>): string | null {
  const text = new Lines(src)
  const layout = layoutOf(text, item) // read before mutating: ranges describe `src`
  const changed = mutate()
  if (!layout) return null
  const byKey = new Map(layout.pairs.map((p, i) => [p.key, i]))
  const out: string[] = []
  for (const [n, pair] of item.items.entries()) {
    // A pair added by `map.set` holds its key as a plain string, not a node.
    const key = isScalar(pair.key) ? String(pair.key.value) : typeof pair.key === 'string' ? pair.key : null
    if (key === null) return null
    const at = byKey.get(key)
    if (n === 0 && at !== 0) return null // the `- ` line must stay the first key's
    if (at === undefined) { // a key the entity did not have
      out.push(...indent(renderPair(pair as Pair), ' '.repeat(layout.keyCol)))
      continue
    }
    const span = layout.pairs[at]!
    if (at > 0) out.push(...text.lines.slice(layout.pairs[at - 1]!.last + 1, span.first)) // comments above
    if (!changed.has(key)) { out.push(...text.lines.slice(span.first, span.last + 1)); continue }
    const [head, ...rest] = renderPair(pair as Pair)
    out.push((at === 0 ? layout.prefix : ' '.repeat(layout.keyCol)) + head, ...indent(rest, ' '.repeat(layout.keyCol)))
  }
  const first = layout.pairs[0]!.first; const last = layout.pairs.at(-1)!.last
  return [...text.lines.slice(0, first), ...out, ...text.lines.slice(last + 1)].join('\n')
}

/** The lines an entity occupies, and the indentation of its `- `. */
function itemSpan(text: Lines, item: unknown): (Span & { dashIndent: string }) | null {
  if (!isMap(item) || item.flow || !item.range) return null
  const first = text.lineOf(item.range[0])
  const dash = /^(\s*)-\s+$/.exec(text.lines[first]!.slice(0, text.colOf(item.range[0])))
  if (!dash) return null
  return { first, last: Math.max(first, text.lastLineBefore(item.range[1])), dashIndent: dash[1]! }
}

/** Append `entity` after the last entry of a non-empty block list. */
export function spliceCreate(src: string, seq: YAMLSeq, entity: Record<string, unknown>): string | null {
  if (seq.flow || seq.items.length === 0) return null
  const text = new Lines(src)
  const tail = itemSpan(text, seq.items.at(-1))
  if (!tail) return null
  const rendered = new Document([entity]).toString(STRINGIFY).replace(/\n$/, '').split('\n')
  const lines = [...text.lines]
  lines.splice(tail.last + 1, 0, ...indent(rendered, tail.dashIndent))
  return lines.join('\n')
}

/** Remove the entity at `index`, with the comment lines directly above it. */
export function spliceDelete(src: string, seq: YAMLSeq, index: number): string | null {
  if (seq.flow || seq.items.length < 2) return null
  const text = new Lines(src)
  const span = itemSpan(text, seq.items[index])
  if (!span) return null
  let { first } = span
  while (first > 0 && /^\s*#/.test(text.lines[first - 1]!)) first--
  const lines = [...text.lines]
  lines.splice(first, span.last - first + 1)
  // Two blank lines left where one separated the entries: keep one.
  if (first > 0 && lines[first - 1]!.trim() === '' && (lines[first] ?? '').trim() === '') lines.splice(first - 1, 1)
  return lines.join('\n')
}

/** Append `value` as one flow-style line (`- { a: 1, b: 2 }`) after the last item of a non-empty block list,
 *  whatever kind of node that item is, at the indentation of its dash. Every other line stays as it is. Null
 *  when the list is flow or empty, or its last item is not led by a dash on its own line. */
export function spliceAppendFlow(src: string, seq: YAMLSeq, value: unknown): string | null {
  if (seq.flow || seq.items.length === 0) return null
  const last = seq.items.at(-1) as { range?: [number, number, number] | null } | null
  if (!last?.range) return null
  const text = new Lines(src)
  const first = text.lineOf(last.range[0])
  const dash = /^(\s*)-\s+$/.exec(text.lines[first]!.slice(0, text.colOf(last.range[0])))
  if (!dash) return null
  const end = Math.max(first, text.lastLineBefore(last.range[1]))
  const lines = [...text.lines]
  lines.splice(end + 1, 0, `${dash[1]}- ${flowText(value)}`)
  return lines.join('\n')
}

/** `value` as flow-style YAML on one line, never folded. */
export function flowText(value: unknown): string {
  return new Document(value).toString({ ...STRINGIFY, collectionStyle: 'flow', flowCollectionPadding: true }).replace(/\n$/, '')
}
