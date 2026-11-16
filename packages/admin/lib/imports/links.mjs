// packages/admin/lib/imports/links.mjs
//
// The links of an imported text (DAO-OS L6 §9.3, Task 12 review C1), read as CommonMark reads an inline link: a label with
// nested brackets and backslash escapes, a destination with balanced parentheses (or inside `<…>`), an optional title;
// and autolinks `<scheme:…>`. And the 32-hex ids a text holds (Notion's ids), dashed (8-4-4-4-12) or not, percent-encoded
// or not, and the names that are a Fileverse item's id (a dDoc's folder, a tab's path), so the plan can keep every private
// item's id out of git. Pure.

/**
 * One link of a text: where it is (`start`, `end`), `bang` for an image, its label's text as written, its destination
 * as written, and `tail` (the `(…)` after the label, as written). An autolink's label and destination are its address.
 * @typedef {{ start: number, end: number, bang: boolean, label: string, dest: string, tail: string, auto: boolean }} MdLink
 */

const SPACE = /[ \t\n]/

/** The index of the `]` closing the label opened at `i`, or -1. A blank line ends a label. @param {string} text @param {number} i */
function labelEnd(text, i) {
  let depth = 0
  for (let j = i; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') { j++; continue }
    if (c === '\n' && /^\n[ \t]*\n/.test(text.slice(j, j + 64))) return -1
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) return j }
  }
  return -1
}

/** The destination and the end (just after `)`) of the `(…)` opened at `i`, or null. @param {string} text @param {number} i */
function destAt(text, i) {
  let j = i + 1
  while (j < text.length && SPACE.test(text[j])) j++
  let dest = ''
  if (text[j] === '<') {
    let k = j + 1
    for (; k < text.length && text[k] !== '>' && text[k] !== '\n'; k++) if (text[k] === '\\') k++
    if (text[k] !== '>') return null
    dest = text.slice(j + 1, k)
    j = k + 1
  } else {
    const s = j
    let depth = 0
    for (; j < text.length; j++) {
      const c = text[j]
      if (c === '\\' && j + 1 < text.length) { j++; continue }
      if (SPACE.test(c)) break
      if (c === '(') depth++
      else if (c === ')') { if (depth === 0) break; depth-- }
    }
    if (depth !== 0) return null
    dest = text.slice(s, j)
  }
  while (j < text.length && SPACE.test(text[j])) j++
  const q = text[j]
  if (q === '"' || q === "'" || (q === '(' && dest !== '')) {
    const close = q === '(' ? ')' : q
    let k = j + 1
    for (; k < text.length && text[k] !== close; k++) if (text[k] === '\\') k++
    if (k >= text.length) return null
    j = k + 1
    while (j < text.length && SPACE.test(text[j])) j++
  }
  if (text[j] !== ')') return null
  return { dest, end: j + 1 }
}

const AUTOLINK = /^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/i

/** Every link of `text`, outermost first and in order (a link inside another's label is in that label). @param {string} text
 *  @returns {MdLink[]} */
export function markdownLinks(text) {
  /** @type {MdLink[]} */
  const out = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') { i++; continue }
    if (c === '<') {
      const m = AUTOLINK.exec(text.slice(i, i + 4096))
      if (m) { out.push({ start: i, end: i + m[0].length, bang: false, label: m[1], dest: m[1], tail: '', auto: true }); i += m[0].length - 1 }
      continue
    }
    if (c !== '[') continue
    const close = labelEnd(text, i)
    if (close < 0 || text[close + 1] !== '(') continue
    const d = destAt(text, close + 1)
    if (!d) continue
    const bang = i > 0 && text[i - 1] === '!' && !(i > 1 && text[i - 2] === '\\')
    out.push({ start: bang ? i - 1 : i, end: d.end, bang, label: text.slice(i + 1, close), dest: d.dest, tail: text.slice(close + 1, d.end), auto: false })
    i = d.end - 1
  }
  return out
}

/** `text` with each link `fn` answers a string for replaced by it (null keeps the link as written).
 *  @param {string} text @param {(link: MdLink) => string | null} fn @returns {string} */
export function rewriteLinks(text, fn) {
  let out = ''
  let last = 0
  for (const link of markdownLinks(text)) {
    const to = fn(link)
    if (to === null) continue
    out += text.slice(last, link.start) + to
    last = link.end
  }
  return last === 0 ? text : out + text.slice(last)
}

/** A link written again with another label, its destination as it was. @param {MdLink} link @param {string} label */
export const withLabel = (link, label) => (link.auto ? `<${link.dest}>` : `${link.bang ? '!' : ''}[${label}]${link.tail}`)

/** A label as read: its backslash escapes undone, trimmed. @param {string} label */
export const labelText = label => label.replace(/\\([!-/:-@[-`{-~])/g, '$1').trim()

const HEX_RUN = /[0-9a-f](?:[0-9a-f]|-(?=[0-9a-f]))*/gi
/** `text` with its %XX escapes read as the characters they stand for (a byte each). @param {string} text */
const percentRead = text => text.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))

/**
 * The first of `ids` (32 hex digits, lower case) that `text` holds: as written, with its dashes left out (Notion writes an
 * id 8-4-4-4-12 in its URLs), and with its %XX escapes read; null when it holds none.
 * @param {string} text @param {ReadonlySet<string>} ids @returns {string | null}
 */
export function firstIdIn(text, ids) {
  if (ids.size === 0 || text === '') return null
  for (const t of new Set([text, percentRead(text)])) {
    for (const m of t.matchAll(HEX_RUN)) {
      const run = m[0].replace(/-/g, '').toLowerCase()
      for (let k = 0; k + 32 <= run.length; k++) { const id = run.slice(k, k + 32); if (ids.has(id)) return id }
    }
  }
  return null
}

/** A character a name (a Fileverse dDoc's folder, a tab's file) can hold beside another: a name is found only where it
 *  stands whole, between characters that are not these (`/`, `.`, a space, punctuation), as a path segment does. */
const NAME_CHAR = String.raw`[\p{L}\p{N}_-]`

/**
 * A finder of `names` (source ids that are not 32-hex: a Fileverse dDoc's folder, `<doc>/<tab>`; Tasks 13–14 review I1)
 * in a text: each one found where it stands whole (not inside a longer name), in any case, as written or with its %XX
 * escapes read. Answers the names found.
 * @param {Iterable<string>} names @returns {(text: string) => Set<string>}
 */
export function namesFinder(names) {
  const list = [...new Set(names)].filter(n => n !== '').sort((a, b) => b.length - a.length)
  if (list.length === 0) return () => new Set()
  const escaped = list.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(?<!${NAME_CHAR})(?:${escaped.join('|')})(?!${NAME_CHAR})`, 'giu')
  const byLower = new Map(list.map(n => [n.toLowerCase(), n]))
  return text => {
    /** @type {Set<string>} */
    const out = new Set()
    if (text === '') return out
    let decoded = text
    try { decoded = decodeURIComponent(text) } catch { decoded = percentRead(text) }
    for (const t of new Set([text, decoded])) {
      for (const m of t.matchAll(re)) { const n = byLower.get(m[0].toLowerCase()); if (n !== undefined) out.add(n) }
    }
    return out
  }
}

/** Every 32-hex id `text` holds, as `firstIdIn` reads them. @param {string} text @returns {Set<string>} */
export function idsIn(text) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const t of new Set([text, percentRead(text)])) {
    for (const m of t.matchAll(HEX_RUN)) {
      const run = m[0].replace(/-/g, '').toLowerCase()
      for (let k = 0; k + 32 <= run.length; k++) out.add(run.slice(k, k + 32))
    }
  }
  return out
}
