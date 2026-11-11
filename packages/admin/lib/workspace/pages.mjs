// packages/admin/lib/workspace/pages.mjs
//
// A page file (L6 spec §4.1): YAML front matter, then the Markdown body. Ids, the front matter's reading
// and writing, and sibling order; the tree's levels and the links across them (below). Pure (yaml, the dialect and
// lib/visibility.mjs only, no node: imports), so the client can use it too.
//
//   splitPage(text)              → { front, body, problems }: never throws; problems are sentences. A page
//                                  with no front matter, or one never closed, is all body.
//   joinPage(front, body, before) → the file text. With `before` (the file as it was), its front matter is
//                                  edited in place through yaml's document API, so its comments, key order
//                                  and quoting stay; an unchanged front matter is written back byte for byte.
//                                  A front matter it cannot read (absent, not closed, not valid YAML, not a
//                                  map) is never rewritten (§5.3, Review Focus 2): unchanged, its bytes are
//                                  kept as they were; changed, joinPage throws UNREADABLE_FRONT's sentence.
//                                  Without `before`, keys go in the spec's order and absent ones are left out.
//   newPageId(title, level)      → '<slug>-<4 hex>' (git) | 'p-<12 hex>' (private; nothing readable)
//   orderBetween(a, b)           → the order for a page placed between siblings a and b, or 'renumber'
import { Document, isMap, isScalar, parseDocument } from 'yaml'
import { refsOf, hubMarkdownIt } from './markdown.mjs'
import { formatLevel, fullLevel, gitAllows, narrowerOrEqual, parseLevel } from '../visibility.mjs'

/** @typedef {{ id: string, title: string, parent: string | null, order: number, visibility?: 'public'|'members', meeting?: string, from?: Record<string, unknown>, [key: string]: unknown }} PageFront */

/** The front matter's keys, in the order the spec writes them (§4.1). */
export const FRONT_KEYS = /** @type {const} */ (['id', 'title', 'parent', 'order', 'visibility', 'meeting', 'from'])

/** Two neighbours closer than this renumber their siblings (§4.1). */
export const ORDER_EPSILON = 1e-6
/** Renumbering, and a step past either end, goes in steps of this. */
export const ORDER_STEP = 1000
/** A git page id's slug is at most this long. */
export const SLUG_MAX = 48

/** joinPage's refusal to change a front matter it could not read; `error.code` is 'UNREADABLE_FRONT'.
 * @param {string} problem the problem splitPage reported */
export const UNREADABLE_FRONT = (problem) => `${problem.replace(/\.?$/, '.')} Its front matter is kept as written, so it cannot be changed here. Nothing was written.`

const OPEN = /^---[ \t]*\r?\n/
const CLOSE = /^---[ \t]*(?:\r?\n|$)/m

/** @param {unknown} v */
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Structural equality of YAML-shaped values. @param {unknown} a @param {unknown} b @returns {boolean} */
function same(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(/** @type {object} */ (a)), kb = Object.keys(/** @type {object} */ (b))
    return ka.length === kb.length && ka.every((k) => same(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]))
  }
  return false
}

/** Where the front matter ends, or why there is none.
 * @param {string} text @returns {{ yaml: string, bodyAt: number } | { problem: string }} */
function frontBlock(text) {
  const open = OPEN.exec(text)
  if (!open) return { problem: 'The page has no front matter.' }
  const rest = text.slice(open[0].length)
  const close = CLOSE.exec(rest)
  if (!close) return { problem: 'Its front matter is not closed.' }
  return { yaml: rest.slice(0, close.index), bodyAt: open[0].length + close.index + close[0].length }
}

/** A scalar read as text (a title `2027` is the text "2027"). @param {unknown} v */
const asText = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)

/** Read a page file. Unknown keys are kept as they are. A known key with a wrong value is reported and read
 * as its default (`parent` null, `order` 0, `meeting`/`from` absent) — except `visibility`, kept as written so
 * a reader can fail closed on it rather than have a page inherit a looser level.
 * @param {string} text @returns {{ front: PageFront, body: string, problems: string[] }} */
export function splitPage(text) {
  const { front, body, problems } = readPage(text)
  return { front, body, problems }
}

/** splitPage, plus where the body starts and whether the front matter could be read at all.
 * @param {string} text
 * @returns {{ front: PageFront, body: string, problems: string[], bodyAt: number, unreadable: string | null, yaml: string }} */
function readPage(text) {
  /** @type {string[]} */
  const problems = []
  /** @type {PageFront} */
  const front = { id: '', title: '', parent: null, order: 0 }
  const block = frontBlock(text)
  if ('problem' in block) return { front, body: text, problems: [block.problem], bodyAt: 0, unreadable: block.problem, yaml: '' }
  const { bodyAt, yaml } = block
  const body = text.slice(bodyAt)
  /** @param {string} problem */
  const unread = (problem) => ({ front, body, problems: [problem], bodyAt, unreadable: problem, yaml })
  const doc = parseDocument(yaml)
  if (doc.errors.length) return unread(`Its front matter is not valid YAML: ${doc.errors[0].message.split('\n')[0]}`)
  const raw = doc.toJS() ?? {}
  if (!isPlainObject(raw)) return unread('Its front matter is not a map of keys.')

  const id = asText(raw.id)
  if (raw.id === undefined || raw.id === null || id === '') problems.push('Its front matter has no id.')
  else if (id === null) problems.push('Its id is not text.')
  else front.id = id

  const title = asText(raw.title)
  if (raw.title === undefined || raw.title === null) problems.push('Its front matter has no title.')
  else if (title === null) problems.push('Its title is not text.')
  else front.title = title

  if (typeof raw.parent === 'string' && raw.parent !== '') front.parent = raw.parent
  else if (raw.parent !== undefined && raw.parent !== null) problems.push('Its parent is not a page id.')

  if (typeof raw.order === 'number' && Number.isFinite(raw.order)) front.order = raw.order
  else if (raw.order !== undefined && raw.order !== null) problems.push('Its order is not a number.')

  if (raw.visibility !== undefined) {
    front.visibility = raw.visibility
    if (raw.visibility !== 'public' && raw.visibility !== 'members') problems.push('Its visibility is neither public nor members.')
  }
  if (raw.meeting !== undefined) {
    if (typeof raw.meeting === 'string' && raw.meeting !== '') front.meeting = raw.meeting
    else problems.push('Its meeting is not a meeting id.')
  }
  if (raw.from !== undefined) {
    if (isPlainObject(raw.from)) front.from = raw.from
    else problems.push('Its from is not a map.')
  }
  for (const [k, v] of Object.entries(raw)) if (!(/** @type {readonly string[]} */ (FRONT_KEYS)).includes(k)) front[k] = v
  return { front, body, problems, bodyAt, unreadable: null, yaml }
}

/** The front's keys in writing order: the spec's, then the rest as given; absent (undefined) ones left out.
 * @param {PageFront} front @returns {string[]} */
const keysInOrder = (front) => [
  ...FRONT_KEYS.filter((k) => front[k] !== undefined),
  ...Object.keys(front).filter((k) => !(/** @type {readonly string[]} */ (FRONT_KEYS)).includes(k) && front[k] !== undefined),
]

const TO_STRING = { lineWidth: 0 }

/** Write a page file. See the module head for what `before` keeps.
 * @param {PageFront} front @param {string} body @param {string} [before] @returns {string} */
export function joinPage(front, body, before) {
  if (before !== undefined) {
    const prev = readPage(before)
    const keys = keysInOrder(front)
    const prevKeys = keysInOrder(prev.front)
    const unchanged = keys.length === prevKeys.length && keys.every((k) => same(front[k], prev.front[k]))
    if (unchanged) return before.slice(0, prev.bodyAt) + body
    if (prev.unreadable !== null) {
      throw Object.assign(new Error(UNREADABLE_FRONT(prev.unreadable)), { code: 'UNREADABLE_FRONT' })
    }
    const doc = parseDocument(prev.yaml)
    if (doc.contents === null) doc.contents = /** @type {any} */ (doc.createNode({})) // empty, or comments only: keep them
    if (isMap(doc.contents)) return `---\n${edited(doc, front, prev.front)}---\n${body}`
  }
  /** @type {Record<string, unknown>} */
  const ordered = {}
  for (const k of keysInOrder(front)) ordered[k] = front[k]
  return `---\n${new Document(ordered).toString(TO_STRING)}---\n${body}`
}

/** Apply the difference between `prev` and `front` to the document, in place, and print it.
 * @param {import('yaml').Document.Parsed} doc @param {PageFront} front @param {PageFront} prev @returns {string} */
function edited(doc, front, prev) {
  const map = /** @type {import('yaml').YAMLMap<unknown, unknown>} */ (doc.contents)
  for (const k of keysInOrder(prev)) if (front[k] === undefined && doc.has(k)) doc.delete(k)
  for (const k of keysInOrder(front)) {
    const value = front[k]
    if (same(value, prev[k])) continue // unchanged as read (a default read for an absent key included)
    if (doc.has(k)) {
      const node = doc.get(k, true)
      if (isScalar(node) && (value === null || typeof value !== 'object')) {
        node.value = value
        delete node.source
        if (node.type !== 'PLAIN' && typeof value !== 'string') node.type = undefined
      } else doc.set(k, doc.createNode(value))
      continue
    }
    map.items.splice(insertAt(map, k), 0, doc.createPair(k, value))
  }
  return doc.toString(TO_STRING)
}

/** Where a new key goes: after the nearest spec key before it that is present, else before the nearest one
 * after it, else at the end (unknown keys always go at the end).
 * @param {import('yaml').YAMLMap<unknown, unknown>} map @param {string} key @returns {number} */
function insertAt(map, key) {
  const rank = (/** @type {readonly string[]} */ (FRONT_KEYS)).indexOf(key)
  if (rank === -1) return map.items.length
  const ranks = map.items.map((p) => (/** @type {readonly string[]} */ (FRONT_KEYS)).indexOf(String(isScalar(p.key) ? p.key.value : p.key)))
  let after = -1
  ranks.forEach((r, i) => { if (r !== -1 && r < rank) after = i })
  if (after !== -1) return after + 1
  const before = ranks.findIndex((r) => r > rank)
  return before === -1 ? map.items.length : before
}

/** @param {number} bytes @returns {string} */
function randomHex(bytes) {
  const a = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The title at creation as an id's slug: ASCII (accents folded), lower case, hyphens, at most SLUG_MAX
 * characters, `page` when nothing is left. @param {string} title @returns {string} */
export function slugOf(title) {
  const slug = String(title ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX).replace(/-+$/, '')
  return slug || 'page'
}

/** A new page id. Ids never change. `random` gives hex digits (at least 4 for git, 12 for private).
 * @param {string} title @param {'git'|'private'} level @param {() => string} [random] @returns {string} */
export function newPageId(title, level, random) {
  const need = level === 'private' ? 12 : 4
  const hex = random ? random() : randomHex(6)
  if (typeof hex !== 'string' || hex.length < need || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`A page id needs ${need} hex digits; the random source gave ${JSON.stringify(hex)}.`)
  }
  return level === 'private' ? `p-${hex.slice(0, 12)}` : `${slugOf(title)}-${hex.slice(0, 4)}`
}

/** The order for a page placed between siblings `a` and `b` (null: no sibling on that side): their mean;
 * ORDER_STEP past an end; ORDER_STEP alone. 'renumber' when the neighbours are closer than ORDER_EPSILON
 * (the caller renumbers the siblings 1000, 2000, … in the same commit).
 * @param {number | null} a @param {number | null} b @returns {number | 'renumber'} */
export function orderBetween(a, b) {
  for (const v of [a, b]) if (v !== null && !Number.isFinite(v)) throw new Error(`An order is a finite number, not ${String(v)}.`)
  if (a === null && b === null) return ORDER_STEP
  if (a === null) return /** @type {number} */ (b) - ORDER_STEP
  if (b === null) return a + ORDER_STEP
  if (Math.abs(b - a) < ORDER_EPSILON) return 'renumber'
  const mid = (a + b) / 2
  return mid === a || mid === b ? 'renumber' : mid
}

// ── the tree, its levels and its links (L6 spec §4.2, §4.5; controller ruling P-14) ─────────────────────────────────
//
// Shared by the server (server/workspace/pages.ts, the gate's `Levels`), validate:data (lib/data-validate.mjs) and
// validate:governance (lib/narrow.mjs), so the rules cannot disagree. Pure: lib/visibility.mjs and the dialect only.
//
//   PAGE_MAX_BYTES, ASSET_MAX_BYTES        the sizes of §4.1
//   LOOSER_THAN_PARENT, HAS_SUBPAGES, …     the sentences §4.2, §4.5 and §16 give
//   pageEntries(git, store)                every page git and the store hold, by id (git's wins an id both hold)
//   pageLevel(id, byId, policy)            its own level, else its parent's, else collections.pages.default, else members
//   parentLevelOf(id, byId, policy)        the level of the page it sits in (null at the root, or a parent that is missing)
//   looserThanParent(id, byId, policy)     the parent's level token when the page's own level is looser than it, else null
//   onLoop(id, byId) / staleOf(id, byId)   whether its parent chain loops back to it; 'missing-parent' for §4.2's mark
//   childrenOf(id, byId) / descendantsOf   the pages that sit in it, directly / at any depth
//   guardRefs(body, level, lookups)        §4.5: links to stricter pages labelled ↗; a private collection's record refused
//   treeProblems(byId, policy)             validate:data's reading of the tree (§4.2, §4.5)
//   pageWidens(git, id, text, policy)      whether a page file op leaves it, or a subpage, public where it was not (§4.4)
//   labelledLinks(byId, tree, levelOf, …)  the pages that name a page of `tree` by its title while looser than it (§4.4, R-7a)
//   PAGE_FILE_NAME                         a git page's file name, `<id>.md` (every reader of pages/ uses it)

/** A page file is at most this many bytes (§4.1). */
export const PAGE_MAX_BYTES = 524288
/** An attachment is at most this many bytes (§4.1). */
export const ASSET_MAX_BYTES = 5242880
/** The label a link to a stricter page carries, so its title never enters a looser file (§4.5). */
export const STRICT_LABEL = '↗'

/** §4.2: a child is never looser than its parent. @param {string} level */
export const LOOSER_THAN_PARENT = (level) => `A page cannot be more open than the page it sits in, which is ${level}. Nothing was written.`
/** §4.2: a page with subpages is not deleted (one subpage: the singular, rulings log Task 7). @param {number} n */
export const HAS_SUBPAGES = (n) => `Move or delete its ${n} ${n === 1 ? 'subpage' : 'subpages'} first. Nothing was written.`
/** §4.5: a private collection's record from a looser page. @param {string} here @param {string} there */
export const CANNOT_LINK = (here, there) => `This page is ${here}; that record is kept at ${there}, so it cannot be linked from here.`
/** §16: a private page holds no attachment in L6 (§20 Q13). @param {string} level */
export const NO_PRIVATE_ASSETS = (level) => `A page kept at ${level} cannot hold attachments yet. Nothing was written.`
/** §4.2: what the Hub shows beside a page whose parent names no page, or whose parent chain loops. */
export const PARENT_MISSING = 'Its parent page is missing.'
/** §16: absent and invisible alike (rule 7). @param {string} id */
export const NO_PAGE = (id) => `There is no page ${id}.`
/** A link to a stricter page written so that its label is not ↗ and cannot be rewritten (a reference-style link, a title
 *  in the link): this task's copy (rulings log, Task 7). @param {string} id */
export const STRICT_LINK = (id) =>
  `This page links to ${id}, which fewer people may read, in a way that would show its title here: write the link as [${STRICT_LABEL}](./${id}.md).`

/** DAO-OS L6 R-9b: a record mention that would show a stricter record's title, and whose label cannot be rewritten.
 * @param {string} ref `<collection>:<id>` */
export const STRICT_RECORD_LINK = (ref) =>
  `This text names the record ${ref}, which fewer people may read, in a way that would show its title here: write the mention as [${STRICT_LABEL}](hub:record/${ref.replace(':', '/')}).`

/** A private page's id (§4.1): nothing readable in it. */
export const PRIVATE_PAGE_ID = /^p-[0-9a-f]{12}$/
/** A git page's file name under pages/ (`<id>.md`, ids `[a-z0-9-]+`): what every reader of the folder takes as a page. */
export const PAGE_FILE_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.md$/

/** Narrowing a page while other git pages name it by its title (controller ruling R-7a, as L5's REFERRED).
 * @param {readonly string[]} titles */
export const NAMED_BY = (titles) => `Other pages link to this page by name: ${titles.join(', ')}. Change those links to ${STRICT_LABEL} first. Nothing was changed.`

/**
 * @typedef {{ id: string, title: string, parent: string | null, order: number, own?: string, meeting?: string,
 *   from?: Record<string, unknown>, markdown: string, where: 'git' | 'store', text?: string, front?: PageFront,
 *   problems?: string[], rev?: string, extra?: Record<string, unknown> }} PageEntry
 *   One page as the tree reads it. `own`: its own level as written (a git page's `visibility`, a private page's store
 *   level); absent, it inherits. `text`, `front` and `problems`: a git page's file, as splitPage read it.
 * @typedef {import('../visibility.mjs').ParsedLevel} ParsedLevel
 * @typedef {import('../visibility.mjs').VisibilityPolicy} VisibilityPolicy
 */

/** @param {unknown} v */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const STORE_KEYS = ['title', 'parent', 'order', 'meeting', 'from', 'markdown']

/**
 * Every page, by id: git's (`pages/<id>.md`, its id the file's name) and the store's (`collection: 'pages'`). An id both
 * hold is git's (a name git knows is never a private one, R-L5-14.5).
 * @param {readonly { id: string, text: string }[]} git
 * @param {readonly { id: string, visibility: string, body: Record<string, unknown>, rev?: string }[]} store
 * @returns {Map<string, PageEntry>}
 */
export function pageEntries(git, store) {
  /** @type {Map<string, PageEntry>} */
  const out = new Map()
  for (const r of store) {
    const b = isObject(r.body) ? r.body : {}
    /** @type {PageEntry} */
    const e = {
      id: r.id, title: typeof b.title === 'string' ? b.title : '', parent: typeof b.parent === 'string' && b.parent !== '' ? b.parent : null,
      order: typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : 0, own: r.visibility,
      markdown: typeof b.markdown === 'string' ? b.markdown : '', where: 'store', rev: r.rev,
      extra: Object.fromEntries(Object.entries(b).filter(([k]) => !STORE_KEYS.includes(k))),
    }
    if (typeof b.meeting === 'string') e.meeting = b.meeting
    if (isObject(b.from)) e.from = /** @type {Record<string, unknown>} */ (b.from)
    out.set(r.id, e)
  }
  for (const g of git) {
    const { front, body, problems, unreadable } = readPage(g.text)
    /** @type {PageEntry} */
    const e = { id: g.id, title: front.title, parent: front.parent, order: front.order, markdown: body, where: 'git', text: g.text, front, problems }
    if (front.visibility !== undefined && front.visibility !== null) e.own = String(front.visibility)
    // A front matter that cannot be read says nothing of its level: the page is members, never a looser default (fails closed).
    else if (unreadable !== null) e.own = 'members'
    if (front.meeting !== undefined) e.meeting = front.meeting
    if (front.from !== undefined) e.from = front.from
    out.set(g.id, e)
  }
  return out
}

/** A level as written; one that does not read admits nobody (no hat ref, so nobody wears it), so a page fails closed.
 * @param {string} token @returns {ParsedLevel} */
const ownLevel = (token) => parseLevel(token) ?? { level: 'hat', hat: String(token) }

/**
 * A page's level (§4.2): its own `visibility`, else its parent's level, else `data/visibility.yaml` →
 * `collections.pages.default`, else members. A parent that names no page, or a chain that loops, ends the climb at the
 * default — except a missing parent with a private page's id (`p-<12 hex>`, read without the store, or gone from it):
 * what sits under a private page is never read as public, so it is members. An id no page has reads as the default
 * (callers ask only of pages they hold).
 * @param {string} id @param {ReadonlyMap<string, { parent: string | null, own?: string }>} byId
 * @param {VisibilityPolicy | null | undefined} policy @returns {ParsedLevel}
 */
export function pageLevel(id, byId, policy) {
  const seen = new Set()
  let at = byId.get(id)
  let key = id
  while (at && !seen.has(key)) {
    seen.add(key)
    if (at.own !== undefined && at.own !== null) return ownLevel(at.own)
    if (at.parent === null) break
    key = at.parent
    at = byId.get(at.parent)
    if (!at && PRIVATE_PAGE_ID.test(key)) return { level: 'members' }
  }
  return fullLevel(policy, 'pages', null)
}

/** The level of the page `id` sits in, or null at the root and under a parent that names no page.
 * @param {string} id @param {ReadonlyMap<string, { parent: string | null, own?: string }>} byId
 * @param {VisibilityPolicy | null | undefined} policy @returns {ParsedLevel | null} */
export function parentLevelOf(id, byId, policy) {
  const parent = byId.get(id)?.parent ?? null
  if (parent === null || !byId.has(parent)) return null
  return pageLevel(parent, byId, policy)
}

/** The parent's level token when the page's own level is looser than it (§4.2), else null. A page with no own level
 *  inherits, so it is never looser. @param {string} id @param {ReadonlyMap<string, { parent: string | null, own?: string }>} byId
 *  @param {VisibilityPolicy | null | undefined} policy @returns {string | null} */
export function looserThanParent(id, byId, policy) {
  const own = byId.get(id)?.own
  if (own === undefined || own === null) return null
  const parent = parentLevelOf(id, byId, policy)
  if (parent === null) return null
  return narrowerOrEqual(ownLevel(own), parent) ? null : formatLevel(parent)
}

/** Whether `id`'s parent chain comes back to it. @param {string} id @param {ReadonlyMap<string, { parent: string | null }>} byId */
export function onLoop(id, byId) {
  const seen = new Set()
  let at = byId.get(id)?.parent ?? null
  while (at !== null && byId.has(at) && !seen.has(at)) {
    if (at === id) return true
    seen.add(at)
    at = byId.get(at)?.parent ?? null
  }
  return false
}

/** §4.2's mark: 'missing-parent' for a page whose parent names no page in `byId`, or whose chain loops back to it.
 * @param {string} id @param {ReadonlyMap<string, { parent: string | null }>} byId @returns {'missing-parent' | null} */
export function staleOf(id, byId) {
  const parent = byId.get(id)?.parent ?? null
  if (parent === null) return null
  return !byId.has(parent) || onLoop(id, byId) ? 'missing-parent' : null
}

/** The pages that sit directly in `id`. @param {string} id @param {ReadonlyMap<string, { parent: string | null }>} byId
 *  @returns {string[]} */
export function childrenOf(id, byId) {
  return [...byId.entries()].filter(([k, e]) => k !== id && e.parent === id).map(([k]) => k)
}

/** Every page that sits in `id`, at any depth, nearest first; a loop is followed once.
 * @param {string} id @param {ReadonlyMap<string, { parent: string | null }>} byId @returns {string[]} */
export function descendantsOf(id, byId) {
  /** @type {string[]} */
  const out = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    const at = /** @type {string} */ (queue.shift())
    for (const c of childrenOf(at, byId)) {
      if (seen.has(c)) continue
      seen.add(c)
      out.push(c)
      queue.push(c)
    }
  }
  return out
}

// ── links across levels (§4.5) ──────────────────────────────────────────────────────────────────────────────

const ID = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const LABEL = String.raw`\[((?:[^\[\]\\\n]|\\.|\[(?:[^\[\]\\\n]|\\.)*\])*)\]`
const DEST = String.raw`\(\s*(<)?((?:\.\/)?(${ID})\.md(?:#[^\s)>]*)?|hub:page\/(${ID}))(>)?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)`
const INLINE_LINK = new RegExp(String.raw`(?<![\\!])${LABEL}${DEST}`, 'g')
/** A record mention's destination, `hub:record/<collection>/<id>` (DAO-OS L6 R-9b). */
const RECORD_DEST = String.raw`\(\s*(<)?(hub:record\/([^/\s()<>]+)\/([^/\s()<>]+))(>)?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)`
const RECORD_LINK = new RegExp(String.raw`(?<![\\!])${LABEL}${RECORD_DEST}`, 'g')

/** The lines of `body` the regex pass leaves alone: fenced and indented code, and raw HTML blocks.
 * @param {string} body @returns {Set<number>} */
function codeLines(body) {
  const out = new Set()
  for (const t of hubMarkdownIt().parse(body, {})) {
    if ((t.type === 'fence' || t.type === 'code_block' || t.type === 'html_block') && t.map) {
      for (let l = t.map[0]; l < t.map[1]; l++) out.add(l)
    }
  }
  return out
}

/** `line` with its code spans blanked out (same length), so a link written inside one is never rewritten. @param {string} line */
const maskCode = (line) => line.replace(/(`+)(?:(?!\1)[\s\S])+?\1/g, (m) => ' '.repeat(m.length))

/** Each link in `body` to one of `ids` whose label is not ↗ (nor the address itself, an autolink) or that carries a title,
 *  read from the dialect's tokens. @param {string} body @param {ReadonlySet<string>} ids @returns {string[]} */
function badLabels(body, ids) {
  /** @type {string[]} */
  const out = []
  const PAGE = new RegExp(`^(?:\\.\\/)?(${ID})\\.md(?:#.*)?$|^hub:page\\/(${ID})$`)
  /** @param {import('markdown-it').Token[]} tokens */
  const walk = (tokens) => {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.children) walk(t.children)
      if (t.type !== 'link_open') continue
      const href = t.attrGet('href') ?? ''
      const m = PAGE.exec(href)
      const id = m?.[1] ?? m?.[2]
      if (id === undefined || !ids.has(id)) continue
      let label = ''
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'link_close'; j++) label += tokens[j].content ?? ''
      if ((label !== STRICT_LABEL && label !== href) || (t.attrGet('title') ?? '') !== '') out.push(id)
    }
  }
  walk(hubMarkdownIt().parse(body, {}))
  return [...new Set(out)]
}

/**
 * §4.5, enforced by the server on every save and every page write: in a page at `level`, a link (or a page mention) to a
 * page stricter than it carries the label ↗ (`[↗](./p-….md)`), so its title never enters a looser file; a record or view
 * of a private collection stricter than it is refused with CANNOT_LINK. `lookups.pageLevel(id)` is a page's level, or
 * null when no page has that id (a link to a deleted page keeps its label); a private page's id (`p-<12 hex>`) whose level
 * cannot be read is taken as stricter. `lookups.collectionLevel(name)` is a private collection's level, or null for a
 * collection git knows (or none). A link to a stricter page whose label cannot be rewritten (a reference-style link) is
 * refused with STRICT_LINK.
 * @param {string} body @param {ParsedLevel} level
 * `lookups.recordLevels(collection, id)`, when given (DAO-OS L6 R-9b), is the levels a record and its title are kept at ([] for
 * none known): a mention of a record stricter than the text is labelled ↗ as a page link is, or refused with
 * STRICT_RECORD_LINK when its label cannot be rewritten.
 * @param {{ pageLevel: (id: string) => ParsedLevel | null, collectionLevel: (name: string) => ParsedLevel | null,
 *   recordLevels?: (collection: string, id: string) => ParsedLevel[] }} lookups
 * @returns {{ body: string, refused: string | null }}
 */
export function guardRefs(body, level, lookups) {
  const refs = refsOf(body)
  const collections = [
    ...refs.mentions.filter((m) => m.kind === 'record').map((m) => m.ref),
    ...refs.embeds.map((e) => e.ref),
  ].map((ref) => ref.slice(0, Math.max(0, ref.indexOf(':'))))
  for (const name of new Set(collections)) {
    if (name === '') continue
    const at = lookups.collectionLevel(name)
    if (at !== null && !narrowerOrEqual(level, at)) return { body, refused: CANNOT_LINK(formatLevel(level), formatLevel(at)) }
  }
  const ids = new Set([...refs.links, ...refs.mentions.filter((m) => m.kind === 'page').map((m) => m.ref)])
  const stricter = new Set([...ids].filter((id) => {
    const at = lookups.pageLevel(id)
    if (at === null) return PRIVATE_PAGE_ID.test(id)
    return !narrowerOrEqual(level, at)
  }))
  // DAO-OS L6 R-9b (Task 9): a record mentioned whose level, or its title's, is stricter than the text carries ↗ too.
  const recordLevels = lookups.recordLevels
  const records = new Set(recordLevels ? refs.mentions.filter((m) => m.kind === 'record').map((m) => m.ref).filter((ref) => {
    const at = ref.indexOf(':')
    return recordLevels(ref.slice(0, at), ref.slice(at + 1)).some((l) => !narrowerOrEqual(level, l))
  }) : [])
  if (stricter.size === 0 && records.size === 0) return { body, refused: null }
  const skip = codeLines(body)
  const out = body.split('\n').map((line, n) => {
    if (skip.has(n)) return line
    const pages = stricter.size === 0 ? line : relabel(line, INLINE_LINK, (m) => (stricter.has(m[4] ?? m[5]) ? `${m[2] ?? ''}${m[3]}${m[6] ?? ''}` : null))
    return records.size === 0 ? pages : relabel(pages, RECORD_LINK, (m) => (records.has(`${m[4]}:${m[5]}`) ? `${m[2] ?? ''}${m[3]}${m[6] ?? ''}` : null))
  }).join('\n')
  const bad = badLabels(out, stricter)
  if (bad.length > 0) return { body, refused: STRICT_LINK(bad[0]) }
  const badRecord = badRecordLabels(out, records)
  return badRecord.length > 0 ? { body, refused: STRICT_RECORD_LINK(badRecord[0]) } : { body: out, refused: null }
}

// ── member mentions (T2f 1, Rule 4) ──────────────────────────────────────────────────────────────────

/** A member mention whose label cannot be rewritten (a reference-style link, a label over several lines, a title in the
 *  link), so the name it shows could be one fewer people may read. @param {string} id */
export const MEMBER_LINK = (id) =>
  `This text names the member ${id} in a way whose label cannot be written as the name every member may read: write the mention as [@${id}](hub:member/${id}).`

const MEMBER_DEST = String.raw`\(\s*(<)?(hub:member\/([^/\s()<>]+))(>)?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)`
/** A member mention as the dialect reads it (a label with one level of brackets inside). */
const MEMBER_INLINE = new RegExp(String.raw`(?<![\\!])${LABEL}${MEMBER_DEST}`, 'g')
/** A member mention as a comment's thread draws it (commentBody.tsx: any `[label](target)` on one line, code or not). */
const MEMBER_PLAIN = /\[([^\]\n]*)\]\(\s*(<)?(hub:member\/([^/\s()<>]+))(>)?\s*\)/g
const MEMBER_HREF = /^hub:member\/([^/\s]+)$/
/** A name as a label holds it: no bracket, backslash, backtick or line break that would end or change the link. @param {string} s */
const labelText = (s) => s.replace(/[[\]\\`\r\n]/g, '').replace(/\s+/g, ' ').trim()
/** A label as the check compares it: its marks and spaces gone. @param {string} s */
const bare = (s) => s.replace(/[[\]\\`*_~\s]/g, '')

/**
 * T2f 1 (Rule 4): `body` with the label of every member mention (`[label](hub:member/<id>)`) rewritten to `labelOf(id)` (the
 * name every member may read, else the id; the server's `memberLabels`), an `@` kept where the label had one, and a title
 * in the link dropped. Every write of a comment, a page (git and store) and a task's title passes it, so a label typed or
 * picked by someone who may read more, or written before a name was narrowed, never carries a name to the text's readers.
 * Two passes: the dialect's (outside code, labels with brackets inside) and the thread's (every line, code too, as a
 * comment is drawn); then the dialect's tokens are read, and a member link whose label is still another is refused with
 * MEMBER_LINK (a reference-style link, a label over lines).
 * @param {string} body @param {(id: string) => string} labelOf @returns {{ body: string, refused: string | null }}
 */
export function relabelMembers(body, labelOf) {
  if (!body.includes('hub:member/')) return { body, refused: null }
  /** @type {Map<string, string>} */
  const memo = new Map()
  const nameOf = (/** @type {string} */ id) => {
    let hit = memo.get(id)
    if (hit === undefined) { hit = labelText(labelOf(id)) || id; memo.set(id, hit) }
    return hit
  }
  const label = (/** @type {string} */ was, /** @type {string} */ id) => `${was.trimStart().startsWith('@') ? '@' : ''}${nameOf(id)}`
  const skip = codeLines(body)
  const first = body.split('\n').map((line, n) => {
    if (skip.has(n)) return line
    const masked = maskCode(line)
    let out = ''
    let last = 0
    MEMBER_INLINE.lastIndex = 0
    for (let m; (m = MEMBER_INLINE.exec(masked)) !== null;) {
      out += `${line.slice(last, m.index)}[${label(m[1], m[4])}](${m[2] ?? ''}${m[3]}${m[5] ?? ''})`
      last = m.index + m[0].length
    }
    return out + line.slice(last)
  }).join('\n')
  const out = first.replace(MEMBER_PLAIN, (_all, was, open, dest, id, close) => `[${label(was, id)}](${open ?? ''}${dest}${close ?? ''})`)
  /** @type {string | null} */
  let bad = null
  /** @param {import('markdown-it').Token[]} tokens */
  const walk = (tokens) => {
    for (let i = 0; i < tokens.length && bad === null; i++) {
      const t = tokens[i]
      if (t.children) walk(t.children)
      if (t.type !== 'link_open') continue
      const href = t.attrGet('href') ?? ''
      const m = MEMBER_HREF.exec(href)
      if (!m) continue
      let text = ''
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'link_close'; j++) text += tokens[j].content ?? ''
      const ok = [href, nameOf(m[1]), `@${nameOf(m[1])}`].map(bare).includes(bare(text))
      if (!ok || (t.attrGet('title') ?? '') !== '') bad = m[1]
    }
  }
  walk(hubMarkdownIt().parse(out, {}))
  return bad !== null ? { body, refused: MEMBER_LINK(bad) } : { body: out, refused: null }
}

/** `line` with the label of each link `re` matches (outside code spans) whose destination `destOf` gives rewritten to ↗.
 * @param {string} line @param {RegExp} re @param {(m: RegExpExecArray) => string | null} destOf */
function relabel(line, re, destOf) {
  const masked = maskCode(line)
  let result = ''
  let last = 0
  re.lastIndex = 0
  for (let m; (m = re.exec(masked)) !== null;) {
    const dest = destOf(m)
    if (dest === null) continue
    result += `${line.slice(last, m.index)}[${STRICT_LABEL}](${dest})`
    last = m.index + m[0].length
  }
  return result + line.slice(last)
}

/** Each record mention in `body` of one of `refs` (`<collection>:<id>`) whose label is not ↗ (nor the address) or that
 *  carries a title, read from the dialect's tokens (R-9b). @param {string} body @param {ReadonlySet<string>} refs */
function badRecordLabels(body, refs) {
  if (refs.size === 0) return []
  /** @type {string[]} */
  const out = []
  const RECORD = /^hub:record\/([^/\s]+)\/([^/\s]+)$/
  /** @param {import('markdown-it').Token[]} tokens */
  const walk = (tokens) => {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.children) walk(t.children)
      if (t.type !== 'link_open') continue
      const href = t.attrGet('href') ?? ''
      const m = RECORD.exec(href)
      if (!m || !refs.has(`${m[1]}:${m[2]}`)) continue
      let label = ''
      for (let j = i + 1; j < tokens.length && tokens[j].type !== 'link_close'; j++) label += tokens[j].content ?? ''
      if ((label !== STRICT_LABEL && label !== href) || (t.attrGet('title') ?? '') !== '') out.push(`${m[1]}:${m[2]}`)
    }
  }
  walk(hubMarkdownIt().parse(body, {}))
  return [...new Set(out)]
}

/**
 * validate:data's reading of the git pages (§4.1, §4.2, §4.5), as `{ id, path, message, level }`: front matter it cannot
 * read or a key with a wrong value (warn; a `visibility` that is neither public nor members is an error: git holds
 * nothing stricter than members); an id that is not the file's name (warn); a file over PAGE_MAX_BYTES (error); a
 * parent that names no page, or a loop (warn: the Hub shows it at the root); a page looser than its parent (error); a link
 * to a stricter page whose label shows its title (error).
 * @param {ReadonlyMap<string, PageEntry>} byId @param {VisibilityPolicy | null | undefined} policy
 * @returns {{ id: string, path: string, message: string, level: 'error' | 'warn' }[]}
 */
export function treeProblems(byId, policy) {
  /** @type {{ id: string, path: string, message: string, level: 'error' | 'warn' }[]} */
  const out = []
  for (const [id, e] of byId) {
    if (e.where !== 'git') continue
    for (const p of e.problems ?? []) {
      out.push({ id, path: /visibility/.test(p) ? 'visibility' : '', message: p, level: /visibility/.test(p) ? 'error' : 'warn' })
    }
    if (e.front && e.front.id !== '' && e.front.id !== id) out.push({ id, path: 'id', message: `Its id ${e.front.id} is not its file's name (${id}).`, level: 'warn' })
    const bytes = new TextEncoder().encode(e.text ?? '').length
    if (bytes > PAGE_MAX_BYTES) out.push({ id, path: '', message: `It is ${bytes} bytes, and a page is at most ${PAGE_MAX_BYTES}.`, level: 'error' })
    if (staleOf(id, byId) !== null) {
      out.push({ id, path: 'parent', message: byId.has(/** @type {string} */ (e.parent)) ? `Its parent chain loops back to it. ${PARENT_MISSING}` : `Its parent ${e.parent} names no page. ${PARENT_MISSING}`, level: 'warn' })
    }
    const looser = looserThanParent(id, byId, policy)
    if (looser !== null) out.push({ id, path: 'visibility', message: LOOSER_THAN_PARENT(looser).replace(/ Nothing was written\.$/, ''), level: 'error' })
    const level = pageLevel(id, byId, policy)
    if (gitAllows(level)) {
      const guarded = guardRefs(e.markdown, level, {
        pageLevel: (other) => (byId.has(other) ? pageLevel(other, byId, policy) : null),
        collectionLevel: () => null,
      })
      if (guarded.refused !== null) out.push({ id, path: '', message: guarded.refused, level: 'error' })
      else if (guarded.body !== e.markdown) {
        out.push({ id, path: '', message: `It links to a page fewer people may read with a label that shows that page's title: label the link ${STRICT_LABEL}.`, level: 'error' })
      }
    }
  }
  return out
}

// ── widening and naming across a level change (§4.4; controller rulings I2, R-7a) ────────────────────────────

/**
 * Whether a file op on git page `id` (its text, or null for a delete) leaves that page or any git subpage of it public
 * where it was not public before (a new public page included): a publication (§3.1, §4.4, §11.2). Read on the git pages
 * alone (a page under a private one reads as members, `pageLevel`).
 * @param {readonly { id: string, text: string }[]} git the git pages as they are @param {string} id
 * @param {string | null} text @param {VisibilityPolicy | null | undefined} policy @returns {boolean}
 */
export function pageWidens(git, id, text, policy) {
  return pagesMadePublic(git, id, text, policy).length > 0
}

/**
 * The pages `pageWidens` reads as made public (DAO-OS L6 Task 20 review I2): page `id` and each git subpage of it that a
 * file op leaves public where it was not public before, in tree order, `id` first when it is one of them. What a widening
 * says it exposes: the page, and the subpages that take its level.
 * @param {readonly { id: string, text: string }[]} git @param {string} id @param {string | null} text
 * @param {VisibilityPolicy | null | undefined} policy @returns {string[]}
 */
export function pagesMadePublic(git, id, text, policy) {
  if (text === null) return []
  const before = pageEntries(git, [])
  const after = pageEntries([...git.filter((p) => p.id !== id), { id, text }], [])
  return [id, ...descendantsOf(id, after)].filter((p) => after.get(p)?.where === 'git' && pageLevel(p, after, policy).level === 'public'
    && (!before.has(p) || pageLevel(p, before, policy).level !== 'public'))
}

/**
 * The git pages of `byId`, outside `tree`, that link to (or mention) a page of `tree` with a label other than ↗ while that
 * page is stricter than they are (§4.5): they would show its title to readers who may not read it. `levelOf` is each tree
 * page's level (as a narrowing leaves it); every other link is left to `guardRefs`' own reading and not counted here.
 * @param {ReadonlyMap<string, PageEntry>} byId @param {ReadonlySet<string>} tree @param {(id: string) => ParsedLevel} levelOf
 * @param {VisibilityPolicy | null | undefined} policy @returns {string[]}
 */
export function labelledLinks(byId, tree, levelOf, policy) {
  /** @type {string[]} */
  const out = []
  for (const [id, e] of byId) {
    if (e.where !== 'git' || tree.has(id)) continue
    const level = pageLevel(id, byId, policy)
    const g = guardRefs(e.markdown, level, { pageLevel: (other) => (tree.has(other) ? levelOf(other) : level), collectionLevel: () => null })
    if (g.refused !== null || g.body !== e.markdown) out.push(id)
  }
  return out
}
