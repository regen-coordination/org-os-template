// DAO-OS L6 Task 18: a comment's passage in the page's editor — the selection as an anchor, found again in the document.
import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { parsePage } from '../editor/parse.ts'
import { ANCHOR_MAX_CHARS, anchorOf, findPassage, textIndex } from './passage.ts'

const state = (md: string, pick?: string, nth = 0) => {
  const { doc } = parsePage(md)
  const s = EditorState.create({ doc })
  if (!pick) return s
  const { text, pos } = textIndex(doc)
  let at = -1
  for (let i = 0; i <= nth; i++) at = text.indexOf(pick, at + 1)
  return s.apply(s.tr.setSelection(TextSelection.create(doc, pos[at]!, pos[at + pick.length - 1]! + 1)))
}

describe('a passage as an anchor (§8.1: a W3C TextQuoteSelector)', () => {
  it('quotes the selection with the text of its own block before and after it', () => {
    const s = state('First paragraph here.\n\nThe Council can ask for **them** back.\n', 'ask for them')
    expect(anchorOf(s)).toEqual({ exact: 'ask for them', prefix: 'The Council can ', suffix: ' back.' })
  })
  it('is null for an empty selection', () => {
    expect(anchorOf(state('Some text.\n'))).toBeNull()
  })
  it('clips the quote to the most the server takes', () => {
    const long = 'x'.repeat(ANCHOR_MAX_CHARS + 40)
    expect([...anchorOf(state(`${long}\n`, long))!.exact]).toHaveLength(ANCHOR_MAX_CHARS)
  })
  it('finds the occurrence its prefix and suffix name, else the first, else none', () => {
    const md = 'One Safe here.\n\nAnd one Safe there.\n'
    const s = state(md, 'one Safe', 0)
    const second = anchorOf(state(md, 'Safe', 1))!
    expect(second.prefix).toBe('And one ')
    const r = findPassage(s.doc, second)!
    expect(s.doc.textBetween(r.from, r.to)).toBe('Safe')
    expect(r.from).toBeGreaterThan(s.doc.firstChild!.nodeSize) // in the second paragraph
    expect(findPassage(s.doc, { exact: 'Safe', prefix: 'nowhere ', suffix: '' })!.from).toBeLessThan(s.doc.firstChild!.nodeSize)
    expect(findPassage(s.doc, { exact: 'a vault', prefix: '', suffix: '' })).toBeNull()
  })
})

describe('the thread beside the page, or over it (L4c C3’s carry)', () => {
  it('lies over the page at its inline end, under the editor bar, where the editor would keep under 760 beside a 320 thread', async () => {
    const { readFileSync } = await import('node:fs')
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
    const pages = read('../design/css/pages.css')
    const house = read('../design/skins/house.css')
    expect(house).toMatch(/--w-thread: 320px;/)
    expect(pages).toMatch(/\.ed-page\.hub-page \{ container: pgpage \/ inline-size; \}/)
    // 760 (the editor's least) + 24 (the gap, --sp-12) + 320 (the thread) = 1104: under it, the thread is laid over
    expect(house).toMatch(/--sp-12: 24px;/)
    const at = pages.indexOf('@container pgpage (max-width: 1103px) {')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(pages.slice(at + 1)).toMatch(/^[^@]*\.ed-page\.hub-page > \.thread-panel \{ position: absolute; inset-block-start: calc\(var\(--h-ed-bar\) \+ var\(--rule-w\)\); inset-inline-end: 0;[^}]*inline-size: min\(var\(--w-thread\), 100%\);/)
  })
})
