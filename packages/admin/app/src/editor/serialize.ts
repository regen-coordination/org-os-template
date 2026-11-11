// A ProseMirror document → a page body (L6 spec §5.2, §5.3).
//
// A top-level node identical to one parsePage read (the same node, or one equal to it) is written from its
// source text, byte for byte; only the nodes that changed are written, in the dialect's own form, with
// prosemirror-markdown's serializer and the rules below. So a hand-written file's first save changes only
// what was edited, and its line ends (CRLF or LF) are kept for the lines the editor writes.
import type { Mark, Node } from 'prosemirror-model'
import { MarkdownSerializer, MarkdownSerializerState, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { hubSchema } from './schema.ts'
import { pageInfo } from './parse.ts'

/** The serializer state's fields prosemirror-markdown keeps internal. */
type State = MarkdownSerializerState & { out: string; atBlockStart: boolean; inAutolink?: boolean }

const NL = /\r\n|\r|\n/g

/** prosemirror-markdown's escaping, plus what the Hub's markdown-it would otherwise read as markup. */
function escapeText(state: State, line: string, startOfLine: boolean): string {
  let s = state.esc(line, startOfLine)
  if (startOfLine) s = s.replace(/^(\s*\d+)\)(\s|$)/, '$1\\)$2') // `1)` would start a list
  s = s.replace(/\\\[\^([^\]\s\\]+)\\\]/g, '[^$1]') // a footnote reference stays as written
  s = s.replace(/<(?=[A-Za-z/!?])/g, '\\<') // would be raw HTML or an autolink
  s = s.replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&') // would be an entity
  return s
}

/** A per-state stack (em delimiters, link forms), opened and closed in order. */
const stacks = new WeakMap<object, Record<string, string[]>>()
function stack(state: object, name: string): string[] {
  let s = stacks.get(state)
  if (!s) stacks.set(state, (s = {}))
  return (s[name] ??= [])
}

/** The first text after the run of `parent`'s children carrying `mark`, from `index`. */
function charAfter(mark: Mark, parent: Node, index: number): string {
  let k = index
  while (k < parent.childCount && mark.isInSet(parent.child(k).marks)) k++
  const next = k < parent.childCount ? parent.child(k) : null
  return next?.isText ? next.text!.charAt(0) : ''
}

/** A link written as its URL alone: 'linkify' (bare, as it was read) or 'autolink' (`<…>`); or null. */
function bareForm(mark: Mark, parent: Node, index: number): 'linkify' | 'autolink' | null {
  const href = String(mark.attrs.href)
  if (mark.attrs.title || !/^\w+:/.test(href) || /[\s<>]/.test(href)) return null
  const content = parent.child(index)
  if (!content.isText || content.text !== href) return null
  if (index + 1 < parent.childCount && mark.isInSet(parent.child(index + 1).marks)) return null
  return mark.attrs.auto === 'linkify' ? 'linkify' : 'autolink'
}

const destination = (href: string) => (href === '' || /[\s<>]/.test(href) ? `<${href.replace(/[<>]/g, '\\$&')}>` : href.replace(/[()\\]/g, '\\$&'))
const titlePart = (title: string | null) => (title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : '')
const directiveLabel = (label: string) => label.replace(/[\\\]]/g, '\\$&')

/** A mention's `hub:` URI: a record's ref `<registry>:<id>` is written `hub:record/<registry>/<id>`. */
export function mentionHref(kind: string, ref: string): string {
  if (kind !== 'record') return `hub:${kind}/${ref}`
  const at = ref.indexOf(':')
  return `hub:record/${at === -1 ? ref : `${ref.slice(0, at)}/${ref.slice(at + 1)}`}`
}

const ALIGN_ROW: Record<string, string> = { left: ':---', center: ':---:', right: '---:' }

const taskMark = (item: Node) => (item.attrs.checked === null ? '' : item.attrs.checked ? '[x] ' : '[ ] ')

const serializer: MarkdownSerializer = new MarkdownSerializer(
  {
    blockquote: defaultMarkdownSerializer.nodes.blockquote,
    alert(state, node) {
      state.wrapBlock('> ', null, node, () => {
        state.text(`[!${node.attrs.kind}]`, false)
        state.ensureNewLine()
        state.renderContent(node)
      })
    },
    paragraph: defaultMarkdownSerializer.nodes.paragraph,
    heading: defaultMarkdownSerializer.nodes.heading,
    code_block: defaultMarkdownSerializer.nodes.code_block,
    horizontal_rule(state, node) {
      state.write(node.attrs.markup || '---')
      state.closeBlock(node)
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', (i) => `${node.attrs.bullet || '-'} ${taskMark(node.child(i))}`)
    },
    ordered_list(state, node) {
      const start = node.attrs.order ?? 1
      const width = String(start + node.childCount - 1).length
      const delim = node.attrs.delim || '.'
      state.renderList(node, state.repeat(' ', width + 2), (i) => {
        const n = String(start + i)
        return `${state.repeat(' ', width - n.length)}${n}${delim} ${taskMark(node.child(i))}`
      })
    },
    list_item(state, node) {
      state.renderContent(node)
    },
    table(state, node) {
      const rows: string[][] = []
      node.forEach((row) => {
        const cells: string[] = []
        row.forEach((cell) => {
          const md = serializer.serialize(hubSchema.topNodeType.create(null, hubSchema.nodes.paragraph.create(null, cell.content)))
          cells.push(md.replace(/\\\n/g, ' ').replace(NL, ' ').replace(/\|/g, '\\|'))
        })
        rows.push(cells)
      })
      const width = Math.max(1, ...rows.map((r) => r.length))
      const aligns: (string | null)[] = []
      node.firstChild?.forEach((cell) => aligns.push(cell.attrs.align ?? null))
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
      rows.forEach((cells, r) => {
        state.write(line(cells))
        state.ensureNewLine()
        if (r === 0) {
          state.write(`| ${Array.from({ length: width }, (_, i) => ALIGN_ROW[aligns[i] ?? ''] ?? '---').join(' | ')} |`)
          state.ensureNewLine()
        }
      })
      state.closeBlock(node)
    },
    embed_record(state, node) {
      state.write(`::record[${directiveLabel(node.attrs.label)}]{ref="${node.attrs.ref}"}`)
      state.closeBlock(node)
    },
    embed_view(state, node) {
      state.write(`::view[${directiveLabel(node.attrs.label)}]{collection="${node.attrs.collection}" view="${node.attrs.view}"}`)
      state.closeBlock(node)
    },
    raw(state, node) {
      state.text(String(node.attrs.src), false)
      state.closeBlock(node)
    },
    image: defaultMarkdownSerializer.nodes.image,
    hard_break: defaultMarkdownSerializer.nodes.hard_break,
    text(state, node) {
      const s = state as State
      if (s.inAutolink) {
        s.text(node.text!, false)
        return
      }
      const lines = node.text!.split('\n')
      lines.forEach((line, i) => {
        s.write()
        s.out += escapeText(s, line, s.atBlockStart)
        if (i !== lines.length - 1) s.out += '\n'
      })
    },
  },
  {
    link: {
      open(state, mark, parent, index) {
        const form = bareForm(mark, parent, index)
        stack(state, 'link').push(form ?? 'inline')
        if (form) (state as State).inAutolink = true
        return form === 'linkify' ? '' : form === 'autolink' ? '<' : '['
      },
      close(state, mark) {
        const form = stack(state, 'link').pop()
        ;(state as State).inAutolink = undefined
        if (form === 'linkify') return ''
        if (form === 'autolink') return '>'
        return `](${destination(String(mark.attrs.href))}${titlePart(mark.attrs.title)})`
      },
      mixable: false,
    },
    mention: {
      open: '[',
      close: (_state, mark) => `](${mentionHref(mark.attrs.kind, mark.attrs.ref)})`,
      mixable: false,
    },
    em: {
      // `_em_` as the dialect writes it; `*em*` where an underscore could not open or close (inside a word)
      open(state, mark, parent, index) {
        const before = (state as State).out.slice(-1)
        const d = /\w/.test(before) || /\w/.test(charAfter(mark, parent, index)) ? '*' : '_'
        stack(state, 'em').push(d)
        return d
      },
      close: (state) => stack(state, 'em').pop() ?? '_',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    code: defaultMarkdownSerializer.marks.code,
  },
)

const BULLETS = ['-', '*', '+']
const DELIMS = ['.', ')']

/** A list written next to a list of the same marker would merge with it when read back: pick another. */
function apart(node: Node, prev: Node | null, next: Node | null): Node {
  const key = node.type.name === 'bullet_list' ? 'bullet' : node.type.name === 'ordered_list' ? 'delim' : null
  if (!key) return node
  const taken = new Set([prev, next].filter((n) => n?.type === node.type).map((n) => n!.attrs[key]))
  if (!taken.has(node.attrs[key])) return node
  const pick = (key === 'bullet' ? BULLETS : DELIMS).find((c) => !taken.has(c))
  return pick ? node.type.create({ ...node.attrs, [key]: pick }, node.content, node.marks) : node
}

/** One top-level node in the dialect's own form, with no line end after it. */
function writeNode(node: Node): string {
  return serializer.serialize(hubSchema.topNodeType.create(null, node)).replace(/\n+$/, '')
}

const ENDS_BLANK = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)[ \t]*$/
const ENDS_LINE = /(?:\r\n|\r|\n)$/
const TRAILING_LINES = /(?:(?:\r\n|\r|\n)[ \t]*)+$/
/** A source's gap: its last line end and the blank lines after it ('' for a file's last block with no final
 * line end). */
const GAP = /(?:\r\n|\r|\n)(?:[ \t]*(?:\r\n|\r|\n))*[ \t]*$/
/** The blank lines before a file's first block (they belong to its first node's source). */
const LEADING = /^(?:[ \t]*(?:\r\n|\r|\n))*/

interface Entry {
  node: Node
  /** the parsed node it is written from (untouched), or null when it is written in the dialect's form */
  p: number | null
  /** the parsed node whose place it holds: p, or for a changed node, the parsed node it replaced */
  at: number | null
}

/** The document → the page body. Untouched top-level nodes are written from `sources`.
 *
 * A changed node that stands where a parsed node of its type stood (its predecessor is that node's
 * predecessor, and that node is gone) took its place: it keeps that node's separators — the blank lines (or
 * none) before and after it, and the file's missing final line end. Anywhere else a blank line separates it. */
export function serializePage(doc: Node, sources: WeakMap<Node, string>): string {
  const info = pageInfo.get(sources)
  const eol = info?.eol ?? '\n'
  const kids: Entry[] = []
  doc.forEach((node) => {
    const p = info && sources.has(node) ? (info.index.get(node) ?? null) : null
    kids.push({ node, p, at: p })
  })

  const used = new Set<number>()
  if (info) {
    for (const k of kids) if (k.p !== null) used.add(k.p)
    // a node equal to a parsed one (an undo, a no-op rewrite) is written from that one's source
    for (const k of kids) {
      if (k.p !== null) continue
      const p = info.parsed.findIndex((n, i) => !used.has(i) && n.type === k.node.type && n.nodeSize === k.node.nodeSize && n.eq(k.node))
      if (p !== -1) {
        k.p = k.at = p
        used.add(p)
      }
    }
  }

  // an empty paragraph the editor made is not written (Markdown has no empty paragraph)
  const list = kids.filter((k) => k.p !== null || !(k.node.type === hubSchema.nodes.paragraph && k.node.content.size === 0))

  // a changed node in the place of a parsed node of its type, now gone, takes that node's place
  if (info) {
    list.forEach((k, i) => {
      if (k.p !== null) return
      const prevAt = i === 0 ? -1 : list[i - 1].at
      if (prevAt === null) return
      const at = prevAt + 1
      if (at < info.parsed.length && !used.has(at) && info.parsed[at].type === k.node.type) {
        k.at = at
        used.add(at)
      }
    })
  }

  const sourceOf = (at: number) => (info ? (sources.get(info.parsed[at]) ?? '') : '')
  let out = ''
  list.forEach((k, i) => {
    const next = list[i + 1] ?? null
    let text: string
    if (k.p !== null) text = sourceOf(k.p)
    else {
      const node = apart(k.node, list[i - 1]?.node ?? null, next?.node ?? null)
      text = writeNode(node).replace(NL, eol)
      if (k.at !== null) {
        const src = sourceOf(k.at)
        if (i === 0 && k.at === 0) text = (LEADING.exec(src)?.[0] ?? '') + text
        text += GAP.exec(src)?.[0] ?? ''
      } else text += eol
    }
    const original = info && k.at !== null
    if (!next) {
      if (!(original && k.at === info!.parsed.length - 1)) text = text.replace(TRAILING_LINES, eol)
    } else if (!(original && next.at === k.at! + 1) && !ENDS_BLANK.test(text)) {
      text += ENDS_LINE.test(text) ? eol : eol + eol
    }
    out += text
  })
  // a file that had no final line end keeps having none
  if (info && !info.finalEol) out = out.replace(TRAILING_LINES, '')
  return out
}
