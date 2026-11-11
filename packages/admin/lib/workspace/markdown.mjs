// packages/admin/lib/workspace/markdown.mjs
//
// The Hub's Markdown dialect (L6 spec §5.2): CommonMark, plus GFM tables, strikethrough, task lists and
// autolinks, plus GFM alerts, `hub:` links and two leaf directives — and nothing else. Shared by the server
// and the client; pure (markdown-it only, no node: imports).
//
// The token stream `hubMarkdownIt().parse(src, {})` gives, beyond markdown-it's CommonMark tokens
// (this is the contract the editor engine, Task 6, maps to its schema):
//
//   table_open … table_close, s_open/s_close   GFM tables and strikethrough (markdown-it's own rules)
//   link_open (markup 'linkify')               a GFM autolink (markdown-it's linkify)
//   list_item_open.meta                        { task: true, checked: boolean } for a task item
//                                              (`- [ ] …` / `- [x] …`; the marker is cut from the
//                                              inline content); null for any other item
//   alert_open … alert_close                   a top-level `> [!KIND]` quote whose marker stands alone on
//                                              its first line, KIND one of ALERT_KINDS (any case, as GitHub
//                                              reads it); meta { kind } upper-case; the marker line is cut.
//                                              Anything else (`> [!NOPE]`, an alert inside a list) stays a
//                                              blockquote.
//   record_embed                               `::record[Label]{ref="<registry>:<id>"}` on a line of its own;
//                                              one block token (nesting 0), meta { label, ref }
//   view_embed                                 `::view[Label]{collection="<c>" view="<v>"}` on a line of its
//                                              own; one block token, meta { label, collection, view }
//   html_block / html_inline                   raw HTML, kept (html: true) so the editor can hold it as a
//                                              `raw` block, "Kept as written". render() never emits it as
//                                              HTML: it shows it escaped, as text (<pre class="hub-raw">
//                                              for a block, <code class="hub-raw"> inline)
//
// A directive must start a block (it does not interrupt a paragraph), name exactly its attributes (record:
// `ref`; view: `collection`, `view`), with double-quoted non-empty values, and nothing after the `}`.
// Anything else that looks like one is a paragraph. Every token keeps markdown-it's `map` (source lines);
// an alert's first paragraph's map starts after the marker line it lost.
//
// Refs (`refsOf`, `embedRefs`) are read from the token stream, so code spans and fenced code never count.
//   page link   `[Title](./<id>.md)` (or `<id>.md`, `#fragment` allowed)   → links: '<id>'
//   mention     `[@Label](hub:member/<id>)`, `hub:role/<id>`, `hub:page/<id>`, `hub:record/<registry>/<id>`
//               → mentions: { kind, ref }, a record's ref written `<registry>:<id>` like an embed's.
//               Any `hub:` link of these kinds counts; the `@` in the label is how it reads, not the test.
//   embed       record → { kind: 'record', ref: '<registry>:<id>' }; view → { kind: 'view', ref: '<c>:<v>' }
// Each list holds a ref once, in the order first met.
import MarkdownIt from 'markdown-it'

/** The five GFM alert kinds. */
export const ALERT_KINDS = /** @type {const} */ (['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

const ALERT_MARK = /^\[!(note|tip|important|warning|caution)\][ \t]*$/i
const TASK_MARK = /^\[([ xX])\](?:[ \t]+|$)/
const DIRECTIVE = /^::(record|view)\[((?:[^\]\\]|\\.)*)\]\{([^}]*)\}[ \t]*$/
const DIRECTIVE_ATTR = /[ \t]*([a-zA-Z][\w-]*)="([^"]*)"[ \t]*/y
const DIRECTIVE_KEYS = { record: ['ref'], view: ['collection', 'view'] }
const PAGE_LINK = /^(?:\.\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.md(?:#.*)?$/
const HUB_LINK = /^hub:(member|role|page)\/([^/\s]+)$/
const HUB_RECORD_LINK = /^hub:record\/([^/\s]+)\/([^/\s]+)$/

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Parse a directive's `{key="value" …}` into a map, or null when it is not exactly the kind's keys.
 * @param {'record'|'view'} kind @param {string} text @returns {Record<string, string> | null} */
function directiveAttrs(kind, text) {
  /** @type {Record<string, string>} */
  const attrs = {}
  DIRECTIVE_ATTR.lastIndex = 0
  let at = 0
  while (at < text.length) {
    DIRECTIVE_ATTR.lastIndex = at
    const m = DIRECTIVE_ATTR.exec(text)
    if (!m || m[0].length === 0) return text.slice(at).trim() === '' ? attrs : null
    if (m[1] in attrs || m[2] === '') return null
    attrs[m[1]] = m[2]
    at = DIRECTIVE_ATTR.lastIndex
  }
  const keys = Object.keys(attrs).sort()
  const want = [...DIRECTIVE_KEYS[kind]].sort()
  return keys.length === want.length && keys.every((k, i) => k === want[i]) ? attrs : null
}

/** Block rule: `::record[…]{…}` / `::view[…]{…}`, a line of its own.
 * @param {import('markdown-it').StateBlock} state @param {number} startLine @param {number} _endLine @param {boolean} silent
 * @returns {boolean} */
function leafDirective(state, startLine, _endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine])
  if (!line.startsWith('::')) return false
  const m = DIRECTIVE.exec(line)
  if (!m) return false
  const kind = /** @type {'record'|'view'} */ (m[1])
  const attrs = directiveAttrs(kind, m[3])
  if (!attrs) return false
  if (silent) return true
  const label = m[2].replace(/\\(.)/g, '$1')
  const token = state.push(`${kind}_embed`, 'div', 0)
  token.block = true
  token.markup = `::${kind}`
  token.info = label
  token.map = [startLine, startLine + 1]
  token.meta = kind === 'record' ? { label, ref: attrs.ref } : { label, collection: attrs.collection, view: attrs.view }
  state.line = startLine + 1
  return true
}

/** Core rule (after block, before inline): top-level `> [!KIND]` quotes become alerts.
 * @param {import('markdown-it').StateCore} state */
function alerts(state) {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'blockquote_open' || open.level !== 0) continue
    const para = tokens[i + 1]
    const inline = tokens[i + 2]
    if (para?.type !== 'paragraph_open' || inline?.type !== 'inline') continue
    const nl = inline.content.indexOf('\n')
    const first = nl === -1 ? inline.content : inline.content.slice(0, nl)
    const m = ALERT_MARK.exec(first)
    if (!m) continue
    const rest = nl === -1 ? '' : inline.content.slice(nl + 1)
    let close = i + 3
    while (close < tokens.length && !(tokens[close].type === 'blockquote_close' && tokens[close].level === 0)) close++
    if (close >= tokens.length) continue
    if (rest === '') {
      if (close === i + 4) continue // the marker alone, nothing in the alert: GitHub shows a quote
      tokens.splice(i + 1, 3)
      close -= 3
    } else {
      inline.content = rest
      if (para.map) para.map = [para.map[0] + 1, para.map[1]]
      if (inline.map) inline.map = [inline.map[0] + 1, inline.map[1]]
    }
    const kind = m[1].toUpperCase()
    open.type = 'alert_open'
    open.tag = 'div'
    open.meta = { kind }
    tokens[close].type = 'alert_close'
    tokens[close].tag = 'div'
  }
}

/** Core rule (after block, before inline): GFM task list items.
 * @param {import('markdown-it').StateCore} state */
function taskLists(state) {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open') continue
    const inline = tokens[i + 2]
    if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue
    const m = TASK_MARK.exec(inline.content)
    if (!m) continue
    inline.content = inline.content.slice(m[0].length)
    tokens[i].meta = { task: true, checked: m[1] !== ' ' }
  }
}

/** A markdown-it configured for the Hub's dialect. A new instance each call (callers may add renderer
 * rules of their own); `refsOf` keeps one of its own.
 * @returns {import('markdown-it').MarkdownIt} */
export function hubMarkdownIt() {
  const md = new MarkdownIt('commonmark', { html: true, linkify: true })
  md.enable(['table', 'strikethrough', 'linkify'])
  md.block.ruler.before('lheading', 'hub_directive', leafDirective, { alt: [] })
  md.core.ruler.after('block', 'hub_alert', alerts)
  md.core.ruler.after('hub_alert', 'hub_task_list', taskLists)

  const rules = md.renderer.rules
  // Raw HTML is kept as written and shown as text (§5.2), never rendered: a member's page carries no script.
  rules.html_block = (tokens, i) => `<pre class="hub-raw">${esc(tokens[i].content.replace(/\n$/, ''))}</pre>\n`
  rules.html_inline = (tokens, i) => `<code class="hub-raw">${esc(tokens[i].content)}</code>`
  rules.alert_open = (tokens, i) => {
    const kind = tokens[i].meta.kind
    const title = kind.charAt(0) + kind.slice(1).toLowerCase()
    return `<div class="markdown-alert markdown-alert-${kind.toLowerCase()}">\n<p class="markdown-alert-title">${title}</p>\n`
  }
  rules.alert_close = () => '</div>\n'
  rules.record_embed = (tokens, i) => {
    const { label, ref } = tokens[i].meta
    return `<div class="hub-embed" data-kind="record" data-ref="${esc(ref)}">${esc(label)}</div>\n`
  }
  rules.view_embed = (tokens, i) => {
    const { label, collection, view } = tokens[i].meta
    return `<div class="hub-embed" data-kind="view" data-collection="${esc(collection)}" data-view="${esc(view)}">${esc(label)}</div>\n`
  }
  rules.list_item_open = (tokens, i, options, _env, self) => {
    const meta = tokens[i].meta
    if (!meta?.task) return self.renderToken(tokens, i, options)
    return `<li class="task-list-item"><input type="checkbox" disabled${meta.checked ? ' checked' : ''}> `
  }
  return md
}

/** @type {import('markdown-it').MarkdownIt | null} */
let shared = null

/** @typedef {{ type: 'link', id: string } | { type: 'mention', kind: 'member'|'role'|'page'|'record', ref: string } | { type: 'embed', kind: 'record'|'view', ref: string }} Ref */

/** Every page link, mention and embed of a Markdown body, in document order (repeats included).
 * @param {string} markdown @returns {Ref[]} */
function refsInOrder(markdown) {
  shared ??= hubMarkdownIt()
  /** @type {Ref[]} */
  const out = []
  /** @param {import('markdown-it').Token[]} tokens */
  const walk = (tokens) => {
    for (const t of tokens) {
      if (t.type === 'record_embed') out.push({ type: 'embed', kind: 'record', ref: t.meta.ref })
      else if (t.type === 'view_embed') out.push({ type: 'embed', kind: 'view', ref: `${t.meta.collection}:${t.meta.view}` })
      else if (t.type === 'link_open') {
        const href = t.attrGet('href') ?? ''
        let m
        if ((m = PAGE_LINK.exec(href))) out.push({ type: 'link', id: m[1] })
        else if ((m = HUB_LINK.exec(href))) out.push({ type: 'mention', kind: /** @type {'member'|'role'|'page'} */ (m[1]), ref: m[2] })
        else if ((m = HUB_RECORD_LINK.exec(href))) out.push({ type: 'mention', kind: 'record', ref: `${m[1]}:${m[2]}` })
      }
      if (t.children) walk(t.children)
    }
  }
  walk(shared.parse(markdown, {}))
  return out
}

/** The one extraction (§5.2) that backlinks, page mentions, the portal and imports use.
 * @param {string} markdown
 * @returns {{ links: string[], mentions: { kind: 'member'|'role'|'page'|'record', ref: string }[], embeds: { kind: 'record'|'view', ref: string }[] }} */
export function refsOf(markdown) {
  /** @type {string[]} */
  const links = []
  /** @type {{ kind: 'member'|'role'|'page'|'record', ref: string }[]} */
  const mentions = []
  /** @type {{ kind: 'record'|'view', ref: string }[]} */
  const embeds = []
  const seen = new Set()
  for (const r of refsInOrder(markdown)) {
    const key = r.type === 'link' ? `link ${r.id}` : `${r.type} ${r.kind} ${r.ref}`
    if (seen.has(key)) continue
    seen.add(key)
    if (r.type === 'link') links.push(r.id)
    else if (r.type === 'mention') mentions.push({ kind: r.kind, ref: r.ref })
    else embeds.push({ kind: r.kind, ref: r.ref })
  }
  return { links, mentions, embeds }
}

/** The `<registry>:<id>` / `<collection>:<view>` form → the path part of a `hub:` URI. @param {string} ref */
const colonToSlash = (ref) => {
  const at = ref.indexOf(':')
  return at === -1 ? ref : `${ref.slice(0, at)}/${ref.slice(at + 1)}`
}

/** L9 §3.6's seam: every record, view, page, member and role a body refers to, as `hub:` URIs
 * (`hub:record/<registry>/<id>`, `hub:view/<collection>/<view>`, `hub:page/<id>`, `hub:member/<id>`,
 * `hub:role/<id>`), each once, in document order — so the portal can render "Members only" for any
 * target that is not public. A page link `./<id>.md` is `hub:page/<id>`.
 * @param {string} markdown @returns {string[]} */
export function embedRefs(markdown) {
  const out = new Set()
  for (const r of refsInOrder(markdown)) {
    if (r.type === 'link') out.add(`hub:page/${r.id}`)
    else if (r.kind === 'record' || r.kind === 'view') out.add(`hub:${r.kind}/${colonToSlash(r.ref)}`)
    else out.add(`hub:${r.kind}/${r.ref}`)
  }
  return [...out]
}
