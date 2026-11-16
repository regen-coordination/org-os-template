// A page body → a ProseMirror document (L6 spec §5.2, §5.3), with prosemirror-markdown's parser over the
// Hub's markdown-it (lib/workspace/markdown.mjs).
//
// The body is tokenized once; its top-level blocks are then read one by one. Each top-level node is
// remembered with its source text — its own lines and the blank lines after it (the first one also
// takes any blank lines before it) — so serializePage can write an untouched node back byte for byte.
//
// What the dialect does not model becomes a `raw` block holding its lines as written, never a lossy guess:
//   - a block holding a token the schema has no reading for (raw HTML, inline or block);
//   - a heading deeper than level 4;
//   - a footnote definition (`[^1]: …`);
//   - lines markdown-it consumed without a token (reference definitions);
//   - a front-matter-like block in the body (`---`, lines, `---`);
//   - anything prosemirror-markdown could not fit into the schema (it would otherwise drop it silently).
import type { Node } from 'prosemirror-model'
import { MarkdownParser } from 'prosemirror-markdown'
import type Token from 'markdown-it/lib/token.mjs'
import { hubMarkdownIt } from '../../../lib/workspace/markdown.mjs'
import { hubSchema } from './schema.ts'

/** What serializePage needs beyond the sources map: the file's line end and its top-level nodes in order. */
export interface PageInfo {
  /** The file's line end ('\r\n' when most lines end so), used for every line the serializer writes. */
  eol: string
  /** Whether the file ends with a line end (an empty file counts as one). */
  finalEol: boolean
  /** The top-level nodes as parsed, in file order. */
  parsed: Node[]
  /** parsed node → its index. */
  index: Map<Node, number>
}

/** Keyed by the `sources` map parsePage returns, so the public signature stays (doc, sources). */
export const pageInfo = new WeakMap<object, PageInfo>()

class Unmodelled extends Error {}

const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]\s]+\]:/
const FRONT_FENCE = /^---[ \t]*(?:\r\n|\r|\n)?$/
const HUB_MENTION = /^hub:(member|role|page)\/([^/\s]+)$/
const HUB_RECORD = /^hub:record\/([^/\s]+)\/([^/\s]+)$/
const ALIGN = /text-align:\s*(left|center|right)/

/** Lines with their own terminators, the way markdown-it numbers them (it reads \r\n, \r and \n as one). */
export function splitLines(s: string): string[] {
  const out: string[] = []
  const re = /\r\n|\r|\n/g
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    out.push(s.slice(at, m.index + m[0].length))
    at = m.index + m[0].length
  }
  if (at < s.length) out.push(s.slice(at))
  return out
}

const isBlank = (line: string) => /^[ \t]*(?:\r\n|\r|\n)?$/.test(line)
const dropEol = (s: string) => s.replace(/(?:\r\n|\r|\n)$/, '')

/** A list is tight when markdown-it hid its paragraphs (prosemirror-markdown's listIsTight). */
function isTight(tokens: Token[], i: number): boolean {
  while (++i < tokens.length) if (tokens[i].type !== 'list_item_open') return tokens[i].hidden
  return false
}

const cellAttrs = (tok: Token) => {
  const m = ALIGN.exec(tok.attrGet('style') ?? '')
  return { align: m ? m[1] : null }
}

const SPEC = {
  blockquote: { block: 'blockquote' },
  alert: { block: 'alert', getAttrs: (tok: Token) => ({ kind: tok.meta.kind }) },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item', getAttrs: (tok: Token) => ({ checked: tok.meta?.task ? Boolean(tok.meta.checked) : null }) },
  bullet_list: { block: 'bullet_list', getAttrs: (tok: Token, tokens: Token[], i: number) => ({ tight: isTight(tokens, i), bullet: tok.markup || '-' }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok: Token, tokens: Token[], i: number) => ({ order: Number(tok.attrGet('start') ?? 1), tight: isTight(tokens, i), delim: tok.markup || '.' }),
  },
  heading: {
    block: 'heading',
    getAttrs: (tok: Token) => {
      const level = Number(tok.tag.slice(1))
      if (level > 4) throw new Unmodelled(`h${level}`)
      return { level }
    },
  },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok: Token) => ({ params: tok.info || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule', getAttrs: (tok: Token) => ({ markup: tok.markup || '---' }) },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: cellAttrs },
  td: { block: 'table_cell', getAttrs: cellAttrs },
  record_embed: { node: 'embed_record', getAttrs: (tok: Token) => ({ ref: tok.meta.ref, label: tok.meta.label }) },
  view_embed: { node: 'embed_view', getAttrs: (tok: Token) => ({ collection: tok.meta.collection, view: tok.meta.view, label: tok.meta.label }) },
  image: {
    node: 'image',
    getAttrs: (tok: Token) => ({
      src: tok.attrGet('src') ?? '',
      title: tok.attrGet('title') || null,
      alt: (tok.children ?? []).map((c) => c.content).join('') || null,
    }),
  },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike' },
  link: {
    mark: 'link',
    getAttrs: (tok: Token) => ({
      href: tok.attrGet('href') ?? '',
      title: tok.attrGet('title') || null,
      auto: tok.markup === 'linkify' || tok.markup === 'autolink' ? tok.markup : null,
    }),
  },
  mention: { mark: 'mention', getAttrs: (tok: Token) => ({ kind: tok.meta.kind, ref: tok.meta.ref }) },
  code_inline: { mark: 'code', noCloseToken: true },
}

type ParseState = { addNode(type: unknown, attrs: unknown, content: unknown): Node | null; __strict?: true }
type Handler = (state: ParseState, tok: Token, tokens: Token[], i: number) => void

let current: Token[] = []
let parser: MarkdownParser | null = null

/** One parser for every block; its tokenizer hands it the block's tokens. prosemirror-markdown drops a node
 * it cannot fit into the schema without a word; here that is an error, so the block is kept as raw. */
function blockParser(): MarkdownParser {
  if (parser) return parser
  const tokenizer = { parse: () => current }
  const p = new MarkdownParser(hubSchema, tokenizer as unknown as ConstructorParameters<typeof MarkdownParser>[1], SPEC as unknown as ConstructorParameters<typeof MarkdownParser>[2])
  const handlers = (p as unknown as { tokenHandlers: Record<string, Handler> }).tokenHandlers
  for (const key of Object.keys(handlers)) {
    const handler = handlers[key]
    handlers[key] = (state, tok, tokens, i) => {
      if (!state.__strict) {
        const add = state.addNode
        state.addNode = function (type, attrs, content) {
          const node = add.call(this, type, attrs, content)
          if (!node) throw new Unmodelled('does not fit the schema')
          return node
        }
        state.__strict = true
      }
      handler(state, tok, tokens, i)
    }
  }
  parser = p
  return p
}

/** `hub:member|role|page|record` links are mentions: rename their tokens so the parser marks them so. */
function markMentions(tokens: Token[]) {
  for (const t of tokens) {
    if (t.children) markMentions(t.children)
    if (t.type !== 'inline' || !t.children) continue
    const kids = t.children
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].type !== 'link_open') continue
      const href = kids[i].attrGet('href') ?? ''
      let m: RegExpExecArray | null
      let meta: { kind: string; ref: string } | null = null
      if ((m = HUB_MENTION.exec(href))) meta = { kind: m[1], ref: m[2] }
      else if ((m = HUB_RECORD.exec(href))) meta = { kind: 'record', ref: `${m[1]}:${m[2]}` }
      if (!meta || kids[i].attrGet('title')) continue
      let j = i + 1
      while (j < kids.length && kids[j].type !== 'link_close') j++
      if (j === kids.length) continue
      kids[i].type = 'mention_open'
      kids[i].meta = meta
      kids[j].type = 'mention_close'
      i = j
    }
  }
}

/** One top-level block's tokens → its node; throws Unmodelled (or the parser's own error) when it cannot. */
function readBlock(tokens: Token[]): Node {
  current = tokens
  try {
    const doc = blockParser().parse('')
    if (doc.childCount !== 1) throw new Unmodelled('not one block')
    doc.check()
    return doc.firstChild!
  } finally {
    current = []
  }
}

interface Segment { start: number; end: number; tokens: Token[] | null }

/** The body's top-level blocks as line ranges; lines no token covers (reference definitions) are segments
 * of their own, with no tokens (raw). */
function segments(tokens: Token[], lines: string[]): Segment[] {
  const groups: Segment[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    let j = i
    if (t.nesting === 1) while (j + 1 < tokens.length && !(tokens[++j].level === t.level && tokens[j].nesting === -1));
    const prev = groups[groups.length - 1]
    const map = t.map ?? [prev ? prev.end : 0, prev ? prev.end : 0]
    groups.push({ start: map[0], end: map[1], tokens: tokens.slice(i, j + 1) })
    i = j
  }

  // `---`, lines, `---` in the body: markdown-it reads a rule and a setext heading; it is front matter's shape
  for (let k = 0; k + 1 < groups.length; k++) {
    const a = groups[k], b = groups[k + 1]
    if (a.tokens![0].type === 'hr' && FRONT_FENCE.test(lines[a.start]) && b.start === a.end && b.tokens![0].type === 'heading_open' && b.tokens![0].markup === '-') {
      groups.splice(k, 2, { start: a.start, end: b.end, tokens: null })
    }
  }

  const out: Segment[] = []
  let prevEnd = 0
  const gap = (from: number, to: number) => {
    let a = from, b = to
    while (a < b && isBlank(lines[a])) a++
    while (b > a && isBlank(lines[b - 1])) b--
    if (a < b) out.push({ start: a, end: b, tokens: null })
  }
  for (const g of groups) {
    gap(prevEnd, g.start)
    out.push(g)
    prevEnd = Math.max(prevEnd, g.end)
  }
  gap(prevEnd, lines.length)
  return out
}

/** The text of lines [start, end), trailing blank lines and the final line end left out. */
function rawText(lines: string[], start: number, end: number): string {
  let b = end
  while (b > start + 1 && isBlank(lines[b - 1])) b--
  return dropEol(lines.slice(start, b).join(''))
}

function lineEnd(body: string): string {
  const crlf = (body.match(/\r\n/g) ?? []).length
  const lf = (body.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? '\r\n' : '\n'
}

/** A page body → its document, and each top-level node's source text (its lines and the gap after it). */
export function parsePage(body: string): { doc: Node; sources: WeakMap<Node, string> } {
  const lines = splitLines(body)
  const tokens = hubMarkdownIt().parse(body, {}) as unknown as Token[]
  markMentions(tokens)
  const segs = segments(tokens, lines)

  const sources = new WeakMap<Node, string>()
  const parsed: Node[] = []
  segs.forEach((seg, k) => {
    let node: Node | null = null
    if (seg.tokens && !(seg.tokens[0].type === 'paragraph_open' && FOOTNOTE_DEF.test(lines[seg.start]))) {
      try {
        node = readBlock(seg.tokens)
      } catch {
        node = null
      }
    }
    node ??= hubSchema.nodes.raw.create({ src: rawText(lines, seg.start, seg.end) })
    const from = k === 0 ? 0 : seg.start
    const to = k + 1 < segs.length ? segs[k + 1].start : lines.length
    sources.set(node, lines.slice(from, to).join(''))
    parsed.push(node)
  })
  if (parsed.length === 0) {
    const empty = hubSchema.nodes.paragraph.create()
    sources.set(empty, body)
    parsed.push(empty)
  }

  const doc = hubSchema.topNodeType.create(null, parsed)
  pageInfo.set(sources, { eol: lineEnd(body), finalEol: body === '' || /(?:\r\n|\r|\n)$/.test(body), parsed, index: new Map(parsed.map((n, i) => [n, i])) })
  return { doc, sources }
}
