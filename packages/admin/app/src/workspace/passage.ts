// A comment's passage in the page's editor (DAO-OS L6 Task 18, spec §8.2): the selection read as a W3C TextQuoteSelector
// `{ exact, prefix, suffix }` to send with a comment, and an anchor found again in the document to mark it and to show it
// (L4c C3's carry: CommentThread's Show the passage goes through the editor, never through the document's marks).
import type { Node } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'

/** A comment's anchor, as the server takes it and serves it back (each part at most ANCHOR_MAX_CHARS). */
export interface Anchor { exact: string; prefix: string; suffix: string }

/** An anchored comment's passage as the thread hands it over: its comment's id and quote, and (as the Hub serves it) the
 *  anchor's parts; a comment still sending has only the quote. */
export type ShownAnchor = { id: string; text: string } & Partial<Anchor>

/** Each part of an anchor is at most this many characters (spec §8.1; server/workspace/conversation.ts). */
export const ANCHOR_MAX_CHARS = 500
/** How much text before and after the quote is kept to tell one occurrence from another. */
export const ANCHOR_CONTEXT = 32

/** The document's text, blocks apart by a new line, and the document position of each character (-1 for a new line). */
export function textIndex(doc: Node): { text: string; pos: number[] } {
  let text = ''
  const pos: number[] = []
  let first = true
  doc.descendants((n, at) => {
    if (n.isTextblock) {
      if (!first) { text += '\n'; pos.push(-1) }
      first = false
      return true
    }
    if (n.isText) {
      const s = n.text ?? ''
      for (let i = 0; i < s.length; i++) pos.push(at + i)
      text += s
    }
    return true
  })
  return { text, pos }
}

const clip = (s: string, n: number) => [...s].slice(0, n).join('')
const clipEnd = (s: string, n: number) => { const cs = [...s]; return cs.slice(Math.max(0, cs.length - n)).join('') }

/** The selection as an anchor: the selected text (clipped to ANCHOR_MAX_CHARS) and up to ANCHOR_CONTEXT characters of
 *  its own block before and after it. Null for an empty selection or one that holds no text. */
export function anchorOf(state: EditorState): Anchor | null {
  const { from, to, empty } = state.selection
  if (empty) return null
  const { text, pos } = textIndex(state.doc)
  let i0 = pos.findIndex(p => p >= from)
  if (i0 < 0) return null
  let i1 = pos.findIndex(p => p >= to)
  if (i1 < 0) i1 = text.length
  // a selection that starts or ends between blocks does not carry the new line
  while (i0 < i1 && text[i0] === '\n') i0++
  while (i1 > i0 && text[i1 - 1] === '\n') i1--
  const exact = clip(text.slice(i0, i1), ANCHOR_MAX_CHARS)
  if (exact.trim() === '') return null
  const before = text.slice(0, i0)
  const after = text.slice(i0 + exact.length)
  return {
    exact,
    prefix: clipEnd(before.slice(before.lastIndexOf('\n') + 1), ANCHOR_CONTEXT),
    suffix: clip(after.split('\n')[0] ?? '', ANCHOR_CONTEXT),
  }
}

/** Where an anchor's quote is in the document now: the occurrence with its prefix and suffix around it, else the first
 *  of its quote; null when the quote is gone. */
export function findPassage(doc: Node, a: Anchor, index = textIndex(doc)): { from: number; to: number } | null {
  if (a.exact === '') return null
  const { text, pos } = index
  const whole = text.indexOf(`${a.prefix}${a.exact}${a.suffix}`)
  const at = whole >= 0 ? whole + a.prefix.length : text.indexOf(a.exact)
  if (at < 0) return null
  const start = pos[at]
  const end = pos[at + a.exact.length - 1]
  if (start === undefined || end === undefined || start < 0 || end < 0) return null
  return { from: start, to: end + 1 }
}
