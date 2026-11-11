// DAO-OS L7-D10: the change engine edits data/governance.yaml's `roles` and `rules` and nothing else. The file is
// never re-serialised: the two blocks are replaced (or inserted) where the YAML library says they are, so every other
// byte (comments, quoting, the model, the decision rows) stays as the file holds it.
import { parseDocument, isMap, isScalar, stringify } from 'yaml'
import type { Pair } from 'yaml'
import { governanceRecord } from './canonical.ts'
import { yamlDocuments } from '../../lib/governance-read.mjs'
import { STRINGIFY } from '../splice.ts'
import type { Entity } from '../registry.ts'
import { GOVERNANCE_ONLY } from '../../lib/ops.mjs'

/** The only fields of data/governance.yaml the change engine writes. */
export const GOVERNANCE_FIELDS = ['roles', 'rules'] as const
export { GOVERNANCE_ONLY }
/** The one record of the `governance` registry: `governance:governance`. */
export const GOVERNANCE_RECORD = 'governance:governance'

/** The governance file's `{ roles, rules }` as the file holds them (a key it does not state is absent), as the one
 *  entry of the registry `governance`; no file, or one that is not read (several documents), has none. */
export function governanceEntries(text: string | null): Entity[] {
  const record = text === null ? null : governanceRecord(text)
  return record === null ? [] : [{ id: 'governance', ...record }]
}

interface Edit { start: number; end: number; text: string }

/**
 * `text` with its `governance` block's `roles` and `rules` replaced by `set`'s (an absent key is left alone), or
 * inserted before the block's first other key when the file has none. A key set to null is taken out, its lines and
 * the comment trailing them (L7-D11: a library removal restores a file that stated no rules). Every other byte is kept.
 * Throws a sentence for a file of several documents, one that does not parse, or one whose governance block is not a
 * block mapping.
 */
export function writeGovernanceBlocks(text: string, set: { roles?: Record<string, unknown> | null; rules?: unknown[] | null }): string {
  if (yamlDocuments(text).length > 1) throw new Error('data/governance.yaml holds several YAML documents; edit it by hand.')
  const doc = parseDocument(text)
  const [fault] = doc.errors
  if (fault) throw new Error(`data/governance.yaml is not valid YAML, so it is not edited here: ${(fault.message.split('\n')[0] ?? '').trim()}. Correct the file by hand.`)
  const root = doc.contents
  const map = isMap(root) ? (root.has('governance') ? root.get('governance', true) : root) : null
  if (!isMap(map) || map.flow || map.items.length === 0 || !map.items.every(p => isScalar(p.key))) {
    throw new Error('data/governance.yaml has no block mapping of governance fields to put roles and rules in; edit it by hand.')
  }
  const first = map.items[0]!.key as { range?: [number, number, number] | null }
  const lineStart = (at: number) => text.lastIndexOf('\n', at - 1) + 1
  const indent = ' '.repeat((first.range?.[0] ?? 0) - lineStart(first.range?.[0] ?? 0))
  const render = (key: string, value: unknown): string[] =>
    stringify({ [key]: value }, STRINGIFY).replace(/\n$/, '').split('\n')

  const edits: Edit[] = []
  const inserted: string[] = []
  for (const key of GOVERNANCE_FIELDS) {
    const value = set[key]
    if (value === undefined) continue
    const lines = render(key, value)
    const pair = map.items.find((p: Pair) => isScalar(p.key) && p.key.value === key)
    if (value === null && !pair) continue
    if (!pair) { inserted.push(...lines.map(l => (l === '' ? l : indent + l))); continue }
    const keyRange = (pair.key as { range: [number, number, number] }).range
    const col = keyRange[0] - lineStart(keyRange[0])
    // The block ends where its value does; a null value (`rules:` and nothing) ends at the colon.
    const valueRange = (pair.value as { range?: [number, number, number] | null } | null)?.range
    let end = valueRange ? valueRange[1] : text.indexOf(':', keyRange[1]) + 1
    while (end > keyRange[1] && /\s/.test(text[end - 1]!)) end--
    // A comment that trails the block's last line goes with it.
    const rest = /^[ \t]*(#[^\n]*)?(?=\n|$)/.exec(text.slice(end))
    if (rest) end += rest[0].length
    if (value === null) {
      // The whole lines go: from the key's line to the end of the block's last line, with its newline.
      edits.push({ start: lineStart(keyRange[0]), end: text[end] === '\n' ? end + 1 : end, text: '' })
      continue
    }
    edits.push({ start: keyRange[0], end, text: lines.map((l, i) => (i === 0 || l === '' ? l : ' '.repeat(col) + l)).join('\n') })
  }
  if (inserted.length > 0) {
    // Before the comment lines that sit directly above the first key, so they stay with it.
    let at = lineStart(first.range?.[0] ?? 0)
    for (;;) {
      if (at === 0) break
      const prev = text.slice(text.lastIndexOf('\n', at - 2) + 1, at - 1)
      if (!/^\s*#/.test(prev)) break
      at = text.lastIndexOf('\n', at - 2) + 1
    }
    edits.push({ start: at, end: at, text: inserted.join('\n') + '\n' })
  }
  let out = text
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}
