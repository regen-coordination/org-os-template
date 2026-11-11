// packages/admin/lib/imports/plan.mjs
//
// The import plan (DAO-OS L6 spec §9.1–§9.3, §9.6): a bundle and a map turned into writes, a report and a receipt. Pure:
// what it knows of the instance comes in `state` (server/workspace/imports.ts `readImportState` reads it), and nothing is
// written here. `applyImport` (server/workspace/imports.ts) performs the writes.
//
// - Rule 10 (§9.3): everything lands members. The map may set a stricter level per database (then it is a private
//   collection in the store, never named in git) or for the standalone pages, and per page at the top of the export
//   (`docs:`, a Fileverse pull's dDocs, Task 13: its tabs, in it, take its level); `public` is refused (NOT_PUBLIC), and a
//   `docs:` entry naming no such page is refused (NOT_A_DOC) rather than let the page it meant land members.
// - People and contact data (person fields, authorship, e-mail, phone) land at `defaults.contact`, as restricted fields of
//   their records. No name is guessed into an id: a name the map's `people:` links becomes a `person` field holding that
//   member id; an unlinked one stays text (`<field>_names`) at the contact level. Authorship is carried only when the map
//   says `keep_authors: true`.
// - Imports land in their own collections (`notion-<slug>`) and pages (under one root, "Notion archive · <date>", or
//   "Fileverse archive · <date>"); never in
//   a governed registry or the proposals ledger, only in a workspace collection the map names (`into`).
// - Idempotence (§9.6): every page and record carries `from: { source, id, exported }`; an item is updated only when the
//   Hub left it as the last import wrote it (a git page's blob, a git record's digest, as the receipt holds them; a private
//   item's digest, kept in its own `from` in the store, since the receipt names no private item); otherwise it is kept and
//   reported. An item whose content did not change is not rewritten (its mark keeps the export it came from).
// - The receipt (data/imports.yaml) holds counts and reasons only, and the blobs of git items (an attachment's too: one
//   replaced in the Hub since is kept, review I6).

import { isMap, isSeq, parseDocument, Scalar } from 'yaml'
import { canonicalJson } from '../proposals.mjs'
import { sha256Hex } from '../sha256.mjs'
import { contactLevel, formatLevel, gitAllows, narrowerOrEqual, parseLevel } from '../visibility.mjs'
import {
  ASSET_MAX_BYTES, guardRefs, joinPage, newPageId, ORDER_STEP, PAGE_MAX_BYTES, pageEntries, pageLevel, slugOf, STRICT_LABEL,
} from '../workspace/pages.mjs'
import { readCollections } from '../workspace/collections.mjs'
import { cutTitle, splitName } from './bundle.mjs'
import { customFileOf, isCustomId, REGISTRIES } from '../registries.mjs'
import { parseNotionCell } from './notion-csv.mjs'
import { firstIdIn, idsIn, labelText, namesFinder, rewriteLinks, withLabel } from './links.mjs'

/**
 * @typedef {import('./bundle.mjs').ImportBundle} ImportBundle
 * @typedef {import('./bundle.mjs').BundleCollection} BundleCollection
 * @typedef {import('./bundle.mjs').BundleField} BundleField
 * @typedef {import('./bundle.mjs').BundlePage} BundlePage
 * @typedef {import('./bundle.mjs').BundleRow} BundleRow
 * @typedef {import('../visibility.mjs').ParsedLevel} ParsedLevel
 * @typedef {import('../visibility.mjs').VisibilityPolicy} VisibilityPolicy
 * @typedef {import('../workspace/collections.mjs').FieldType} FieldType
 * @typedef {{ databases?: Record<string, { into?: string, level?: string, fields?: Record<string, string> }>, pages?: { level?: string },
 *   docs?: Record<string, { level?: string, title?: string } | string>, people?: Record<string, string>, keep_authors?: boolean }} ImportMap
 * @typedef {{ what: string, why: string }} Said
 * @typedef {{ created: { pages: number, records: number, collections: number }, updated: number, kept: Said[], notCarried: Said[] }} ImportReport
 * @typedef {{ id: string, source: string, export: string, at: string, by: string, created: ImportReport['created'], updated: number,
 *   kept: number, not_carried: Said[], blobs: Record<string, string> }} ImportReceipt
 * @typedef {{ op: 'file', path: string, text: string | null, base: string | null }} FileOp
 * @typedef {{ op: 'put-collection', collection: { id: string, visibility: string, definition: Record<string, unknown> } }
 *   | { op: 'put-record', record: { collection: string, id: string, visibility: string, body: Record<string, unknown>, rev: string } }
 *   | { op: 'put-field', field: { registry: string, record: string, field: string, visibility: string, value: unknown } }} PrivateWrite
 * @typedef {{ path: string, from: string }} AssetWrite
 * @typedef {{ id: string, visibility: string, body: Record<string, unknown>, rev?: string }} StoreRecord
 * @typedef {{
 *   policy: VisibilityPolicy, members: readonly string[],
 *   registries: readonly { name: string, class: string, file: string, topKey: string, ledger?: boolean, custom?: boolean }[],
 *   storeCollections: readonly { id: string, visibility: string, definition: unknown }[] | null,
 *   storeRecords: (collection: string) => readonly StoreRecord[],
 *   storeFields: (registry: string, record: string) => readonly { field: string, value: unknown }[],
 *   gitPages: readonly { id: string, text: string }[], text: (path: string) => string | null, blobOf: (text: string) => string,
 *   revOf: (body: Record<string, unknown>) => string, sizeOf: (abs: string) => number,
 *   fileBlob: (rel: string) => string | null, blobOfFile: (abs: string) => string,
 *   registryProps: (name: string) => Record<string, string[]> | null,
 *   now: string, by: string, random: () => string,
 * }} ImportState
 * @typedef {{ writes: { git: FileOp[], private: PrivateWrite[], assets: AssetWrite[] }, needsStore: boolean, report: ImportReport,
 *   receipt: ImportReceipt, subject: string, databases: { sid: string, name: string, into: string, level: string, fields: Record<string, string>, within?: string }[],
 *   privatePages: string[] }} ImportPlan
 */

/** `receipt` added to data/imports.yaml's text (§9.6), the others kept as written. @param {string | null} text @param {ImportReceipt} receipt */
export function withReceipt(text, receipt) {
  const doc = listDoc(text, 'imports')
  upsert(doc, 'imports', /** @type {any} */ (receipt))
  return yamlText(doc)
}

// ── copy ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** §9.3's sentence: the map gives a database (or the pages) the level public. */
export const NOT_PUBLIC = (/** @type {string} */ db) => `Nothing imported is public: the map gives ${db} the level public. Nothing was written.`
export const NOT_A_LEVEL = (/** @type {string} */ what, /** @type {string} */ token) =>
  `The map gives ${what} the level ${token}, which is not a level: members, hat:<hat ref> or role:<role id>. Nothing was written.`
export const INTO_NOT_WORKSPACE = (/** @type {string} */ db, /** @type {string} */ into) =>
  `The map puts ${db} into ${into}, which is not a workspace collection: an import never writes a governed registry or the proposals ledger. Nothing was written.`
export const INTO_STRICTER = (/** @type {string} */ db, /** @type {string} */ into) =>
  `The map puts ${db} into ${into} at a level stricter than members: import it as a collection of its own to keep it private. Nothing was written.`
export const INTO_PRIVATE = (/** @type {string} */ db, /** @type {string} */ into) =>
  `The map puts ${db} into ${into}, which cannot take it: name a workspace collection in the repository, or a new collection id. Nothing was written.`
/** A database inside a private item's folder, which the map gives a looser level (Task 12 review I3). */
export const LOOSER_THAN_CONTAINER = (/** @type {string} */ db, /** @type {string} */ token, /** @type {string} */ level) =>
  `The map gives ${db} the level ${token}, more open than the item it sits in, which is kept at ${level}: give it that level or a stricter one. Nothing was written.`
export const LEVEL_MOVED = (/** @type {string} */ db, /** @type {string} */ was) =>
  `${db} was imported at ${was}, and the map gives it another level: change its level with its visibility control, not the map. Nothing was written.`
/** A re-run that would put an imported page at another level than it was imported at (Task 12 review minor). */
export const PAGE_LEVEL_MOVED = (/** @type {string} */ page, /** @type {string} */ was, /** @type {string} */ now) =>
  `${page} was imported at ${was}, and this run would put it at ${now}: change a page's level with its visibility control, not the map. Nothing was written.`
/** A `docs:` entry of the map naming no page at the top of the export (a dDoc of a Fileverse pull, Task 13). */
export const NOT_A_DOC = (/** @type {string} */ doc) =>
  `The map names ${doc} under docs, and the pull holds no dDoc of that name: a misspelt dDoc would land members. Nothing was written.`
/** A `docs:` entry giving no level (Tasks 13–14 review M7): it is never read as members. */
export const DOC_NO_LEVEL = (/** @type {string} */ doc) =>
  `The map names ${doc} under docs with no level: give it one (members, hat:<hat ref> or role:<role id>), so that no dDoc lands members by a slip. Nothing was written.`
/** A `docs:` entry with a key docs does not take (M7): a misspelt `level` would leave the dDoc at members. */
export const DOC_KEY = (/** @type {string} */ doc, /** @type {string} */ key) =>
  `The map gives ${doc} under docs the key ${key}, which docs does not take (level and title): a misspelt level would land it members. Nothing was written.`
export const NOT_A_TYPE = (/** @type {string} */ db, /** @type {string} */ field, /** @type {string} */ type) =>
  `The map types ${db} · ${field} as ${type}: a field is text, longtext, number, select, multiselect, date, daterange, checkbox, url, person, email or phone here (a relation is read from the export's links). Nothing was written.`

export const KEPT = 'edited in the Hub since it was imported — kept'
export const AUTHORS = 'authorship is not carried unless the map says keep_authors: true'
export const NO_CONTACT = 'people and contact details are kept at defaults.contact, and data/visibility.yaml names none: not carried'
export const CONTACT_OUTSIDE = 'people and contact details are kept at defaults.contact, and this collection is kept at a level outside it: not carried'
export const STRICTER_RELATION = 'its relations point into a collection kept stricter than this one: not carried'
export const NO_TARGET = 'no linked item says which database it points to: not carried'
export const TIMES = 'times of day are not carried; the day is'
export const PRIVATE_ATTACHMENT = 'a page kept stricter than members holds no attachments: not carried'
export const BIG_ATTACHMENT = (/** @type {number} */ n) => `an attachment is at most ${ASSET_MAX_BYTES} bytes, and this one is ${n}: not carried`
export const BIG_PAGE = (/** @type {number} */ n) => `a page is at most ${PAGE_MAX_BYTES} bytes, and this one would be ${n}: not carried`
export const PARENT_LEVEL_TAKEN = 'the pages\' level and the level of the item it sits in are not within one another: it takes the level of the item it sits in'
export const MISSING_PARENT = 'its parent is not in the export: put under the archive root'
export const LINK_OUTSIDE = 'a link to a page not in the export: its words are kept, the link is not'
export const STRICT_RECORD = 'a link to a record kept stricter than this page: replaced by ↗'
export const STRICT_ITEM = 'a link to an item kept stricter than this page: replaced by ↗'
/** A relative link into the export that names no page the import carries (Tasks 13–14 review I1): never left as an export
 *  path, whose folder and file may be a private item's. */
export const LINK_NOT_CARRIED = 'a link to a page of the export the import does not carry: replaced by ↗'
export const NAMES_PRIVATE = 'it names an item kept stricter than this collection: not carried'
/** The fail-closed backstop (Task 12 review C1): a git text still holding a private item's id after the links were
 *  rewritten. `where` is the git page or file, never the private item. @param {string} where */
export const PRIVATE_IN_TEXT = (/** @type {string} */ where) =>
  `${where} holds the id of an item kept stricter than it, outside a link the import can rewrite to ↗: take it out of the export, or import it at that item's level. Nothing was written.`
/** PRIVATE_IN_TEXT for an id that is a name (a Fileverse dDoc's folder, a tab's path; Tasks 13–14 review I1). @param {string} where */
export const PRIVATE_NAME_IN_TEXT = (/** @type {string} */ where) =>
  `${where} names an item kept stricter than it (a dDoc's folder or a tab's path), outside a link the import can rewrite to ↗: take it out of the export, or import it at that item's level. Nothing was written.`
export const NOT_OF_TYPE = (/** @type {string} */ text, /** @type {string} */ type) => `"${text}" is not ${type}: not carried`
/** NOT_OF_TYPE's words in the receipt, which quotes no cell (Task 12 review I2). @param {string} type */
export const NOT_OF_TYPE_RECEIPT = (/** @type {string} */ type) => `a cell is not ${type}: not carried`
export const NOT_AN_ASSET_NAME_RECEIPT = 'an attachment\'s name is not one an attachment can take: not carried'
export const NOT_A_MEMBER = (/** @type {string} */ id) => `the map links a name to ${id}, which is no member: kept as an unlinked name`
export const REFUSED_LINK = (/** @type {string} */ why) => `${why.replace(/\.$/, '')}: not carried`
export const INTO_OWN_FIELD = (/** @type {string} */ registry, /** @type {string} */ field) =>
  `${registry} defines ${field} itself, naming its own kind of record: the export's relation is not carried there`
export const ONE_VALUE = (/** @type {string} */ registry, /** @type {string} */ field) => `${registry}'s ${field} holds one value, and this cell holds several: not carried`
export const RESTRICTED = (/** @type {number} */ n) => `${n} ${n === 1 ? 'item' : 'items'} in a restricted collection or page`
export const RESTRICTED_WHY = 'not named here: the report printed where the import ran names them'

/** The archive root's key among the plan's pages, and its mark's id (Tasks 13–14 review I2): one no source id can take,
 *  since none begins with `/` (a Notion id is 32 hex digits; a Fileverse one a folder's name, or `<folder>/<file>`). */
export const ROOT_ID = '/archive'
const TYPES = /** @type {const} */ (['text', 'longtext', 'number', 'select', 'multiselect', 'date', 'daterange', 'checkbox', 'url', 'person', 'email', 'phone'])
const MEMBERS = Object.freeze({ level: 'members' })

/** A refusal of the plan: its sentence, its code. @param {string} code @param {string} message */
function refuse(code, message) {
  const err = /** @type {Error & { code: string }} */ (new Error(message))
  err.code = code
  return err
}

const isObj = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const HEX_ID = /^[0-9a-f]{32}$/
/** `path` read from the folder `base` (both `/`-separated, in the export's source ids), or null when it climbs out of the
 *  export. @param {string} base @param {string} path */
const resolveIn = (base, path) => {
  const out = path.startsWith('/') || base === '' ? [] : base.split('/')
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.join('/')
}
const safeDecode = (/** @type {string} */ s) => { try { return decodeURIComponent(s) } catch { return s } }
const digest = (/** @type {unknown} */ v) => `sha256:${sha256Hex(canonicalJson(v))}`
/** A private item's digest: its body with its own mark's digest left out. @param {Record<string, unknown>} body */
const privDigest = body => digest({ ...body, from: isObj(body.from) ? { .../** @type {object} */ (body.from), digest: undefined } : body.from })
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const assetName = (/** @type {string} */ name) => {
  const clean = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 100)
  return ASSET_NAME.test(clean) ? clean : null
}

/** A map's level for `what`: members when it says none; public refused; a token that is no level refused.
 *  @param {unknown} token @param {string} what @returns {ParsedLevel} */
function mapLevel(token, what) {
  if (token === undefined || token === null || token === 'members') return MEMBERS
  if (token === 'public') throw refuse('NOT_PUBLIC', NOT_PUBLIC(what))
  const l = typeof token === 'string' ? parseLevel(token) : null
  if (!l) throw refuse('NOT_A_LEVEL', NOT_A_LEVEL(what, String(token)))
  return l
}

/** A YAML text with a list under `key`, as a Document (one created when there is none). @param {string | null} text @param {string} key */
function listDoc(text, key) {
  const doc = parseDocument(text ?? `${key}: []\n`)
  if (!isSeq(doc.get(key))) doc.set(key, doc.createNode([]))
  return doc
}
/** `value` written into the list `key` of `doc`, over the entry with its id or after the others. */
function upsert(/** @type {import('yaml').Document} */ doc, /** @type {string} */ key, /** @type {Record<string, unknown>} */ value) {
  const seq = /** @type {import('yaml').YAMLSeq} */ (doc.get(key))
  const at = seq.items.findIndex(item => isMap(item) && String(/** @type {any} */ (item).get('id')) === String(value.id))
  if (at >= 0) seq.items[at] = doc.createNode(value)
  else seq.items.push(doc.createNode(value))
}
/** A visibility text with `collections.<c>.fields.<f>` set to `level` (a narrowing, ruling P-6), as narrow.ts's policyText. */
function narrowed(/** @type {string} */ src, /** @type {string} */ collection, /** @type {string} */ field, /** @type {string} */ level) {
  const doc = parseDocument(src === '' ? 'visibility:\n  collections: {}\n' : src)
  const top = isObj(doc.toJS()) && /** @type {any} */ (doc.toJS()).visibility !== undefined ? ['visibility'] : []
  const value = new Scalar(level)
  value.type = 'QUOTE_DOUBLE'
  doc.setIn([...top, 'collections', collection, 'fields', field], value)
  return doc.toString({ flowCollectionPadding: false, lineWidth: 0 })
}
const yamlText = (/** @type {import('yaml').Document} */ doc) => doc.toString({ lineWidth: 0 })

/**
 * The plan (§9.1): `bundle` and `map` against the instance as `state` reads it. Throws a refusal (`code`, the sentence)
 * for a map it cannot follow: nothing is planned then.
 * @param {ImportBundle} bundle @param {ImportMap} map @param {ImportState} state @returns {ImportPlan}
 */
export function planImport(bundle, map, state) {
  const source = bundle.source
  const exported = bundle.exported
  const policy = state.policy
  const contact = contactLevel(policy)
  const contactToken = contact ? formatLevel(contact) : null
  const people = isObj(map.people) ? /** @type {Record<string, string>} */ (map.people) : {}
  const keepAuthors = map.keep_authors === true
  const pagesLevel = mapLevel(map.pages?.level, 'the pages')
  // `docs:` (Task 13): a page at the top of the export (a dDoc) by its source id, with its level and its title. An entry
  // naming no such page is refused: the page it meant would land at the pages' level, members; so is one giving no
  // level, or a key docs does not take (Tasks 13–14 review M7).
  const docsMap = isObj(map.docs) ? /** @type {Record<string, unknown>} */ (map.docs) : {}
  const topSids = new Set(bundle.pages.filter(p => p.parent === null && (p.container ?? null) === null).map(p => p.sid))
  /** @type {Map<string, ParsedLevel>} */
  const docLevel = new Map()
  /** @type {Map<string, string>} */
  const docTitle = new Map()
  for (const [key, entry] of Object.entries(docsMap)) {
    if (!topSids.has(key)) throw refuse('NOT_A_DOC', NOT_A_DOC(key))
    const e = isObj(entry) ? /** @type {Record<string, unknown>} */ (entry) : { level: entry }
    // Each entry says its level, in the two keys docs takes (M7): never defaulted to members.
    const other = Object.keys(e).find(k => k !== 'level' && k !== 'title')
    if (other !== undefined) throw refuse('NOT_A_DOC_ENTRY', DOC_KEY(key, other))
    if (e.level === undefined || e.level === null || e.level === '') throw refuse('NOT_A_DOC_ENTRY', DOC_NO_LEVEL(key))
    docLevel.set(key, mapLevel(e.level, key))
    if (typeof e.title === 'string' && e.title.trim() !== '') docTitle.set(key, cutTitle(e.title.trim()))
  }
  const names = new Set([...state.registries.map(r => r.name), ...(state.storeCollections ?? []).map(c => c.id)])
  /** @type {ImportReport} */
  const report = { created: { pages: 0, records: 0, collections: 0 }, updated: 0, kept: [], notCarried: [] }
  /** Every sid kept private, so a report entry about one stays out of the receipt. @type {Set<string>} */
  const privateSids = new Set()
  /** What the report says; `told` is the receipt's words where they differ (it quotes no cell, I2).
   *  @type {{ what: string, why: string, sids: string[], told?: { what?: string, why?: string } }[]} */
  const said = []
  const say = (/** @type {string} */ what, /** @type {string} */ why, /** @type {string[]} */ sids = [], /** @type {{ what?: string, why?: string }} */ told = {}) =>
    said.push({ what, why, sids, told })
  /** @type {Record<string, string>} */
  const blobs = {}
  /** @type {PrivateWrite[]} */
  const priv = []
  /** @type {AssetWrite[]} */
  const assets = []
  /** Files written whole, by path: the text as this plan leaves it. @type {Map<string, string>} */
  const files = new Map()
  const fileNow = (/** @type {string} */ path) => (files.has(path) ? /** @type {string} */ (files.get(path)) : state.text(path))
  let needsStore = false

  /** The newest receipt's blob for `key` (§9.6): the last import's mark of a git item. */
  const receipts = /** @type {Record<string, any>[]} */ ((() => {
    try { const r = parseDocument(state.text('data/imports.yaml') ?? '').toJS()?.imports; return Array.isArray(r) ? r : [] } catch { return [] }
  })())
  const lastBlob = (/** @type {string} */ key) => {
    for (const r of [...receipts].reverse()) if (isObj(r?.blobs) && typeof r.blobs[key] === 'string') return r.blobs[key]
    return null
  }
  /** What the source says of each page beyond its id (a Fileverse tab's dDoc, name, id, pull date and digest, Task 13). */
  const marks = new Map(bundle.pages.filter(p => isObj(p.mark)).map(p => [p.sid, /** @type {Record<string, string>} */ (p.mark)]))
  const markOf = (/** @type {string} */ sid) => ({ ...(marks.get(sid) ?? {}), source, id: sid, exported })

  // ── where each database goes ──────────────────────────────────────────────────────────────────────────────────
  const gitDefs = readCollections(state.text('data/collections.yaml'), state.registries.filter(r => !r.custom).map(r => r.name)).collections
  /** @type {Map<string, { id: string, git: boolean, level: ParsedLevel, file: string, topKey: string, def: Record<string, any> | null, ours: boolean, into: boolean }>} */
  const target = new Map()
  const dbsNamed = (/** @type {string} */ name) => bundle.collections.filter(c => c.name === name).length
  const mapOf = (/** @type {BundleCollection} */ c) => {
    const dbs = isObj(map.databases) ? /** @type {Record<string, any>} */ (map.databases) : {}
    return dbs[c.sid] ?? dbs[`${c.name} ${c.sid}`] ?? (dbsNamed(c.name) === 1 ? dbs[c.name] : undefined) ?? {}
  }
  // ── levels: what sits in a private item's folder takes its level (I3) ─────────────────────────────────────────
  const rowOf = new Map(bundle.collections.flatMap(c => c.rows.map(r => [r.sid, { c, r }])))
  const pageOf = new Map(bundle.pages.map(p => [p.sid, p]))
  const collOf = new Map(bundle.collections.map(c => [c.sid, c]))
  /** The item a page or database sits in: its container, else (a page) its parent. @param {{ container?: string | null, parent?: string | null }} x */
  const containerOf = x => (x.container !== undefined ? x.container : (x.parent ?? null))
  /** @type {Map<string, ParsedLevel>} */
  const levelMemo = new Map()
  /** The level of the export's item `sid` (a database, a row, a page), or null for one it does not hold.
   *  @param {string} sid @param {Set<string>} [seen] @returns {ParsedLevel | null} */
  const levelOfItem = (sid, seen = new Set()) => {
    const known = levelMemo.get(sid)
    if (known) return known
    if (seen.has(sid)) return null
    seen.add(sid)
    const c = collOf.get(sid)
    const row = rowOf.get(sid)
    const page = pageOf.get(sid)
    const level = c ? dbLevelOf(c, seen) : row ? levelOfItem(row.c.sid, seen) : page ? pageLevelOf(page, seen) : null
    if (level) levelMemo.set(sid, level)
    return level
  }
  /** A database's level: the map's; inside a private item, that item's unless the map sets it stricter, never looser.
   *  @param {BundleCollection} c @param {Set<string>} seen @returns {ParsedLevel} */
  const dbLevelOf = (c, seen) => {
    const m = mapOf(c)
    const asked = mapLevel(m.level, c.name)
    const at = containerOf(c)
    const up = at !== null ? levelOfItem(at, seen) : null
    if (!up || gitAllows(up)) return asked
    if (m.level === undefined || m.level === null) return up
    if (narrowerOrEqual(asked, up)) return asked
    throw refuse('LOOSER_THAN_PARENT', LOOSER_THAN_CONTAINER(c.name, formatLevel(asked), formatLevel(up)))
  }
  /** A page's level: the pages' level; inside a private item, that item's unless the pages' level is within it.
   *  @param {BundlePage} p @param {Set<string>} seen @returns {ParsedLevel} */
  const pageLevelOf = (p, seen) => {
    const at = containerOf(p)
    const up = at !== null ? levelOfItem(at, seen) : null
    if (!up || gitAllows(up)) return docLevel.get(p.sid) ?? pagesLevel
    if (!gitAllows(pagesLevel) && narrowerOrEqual(pagesLevel, up)) return pagesLevel
    // Two levels neither within the other (two sibling hats, a hat and a role): the container's is taken, and said.
    if (!gitAllows(pagesLevel) && !narrowerOrEqual(up, pagesLevel)) say(p.title, PARENT_LEVEL_TAKEN, [p.sid])
    return up
  }
  /** Where a database sits, for the dry run's map (I3): the page, the row (`<database> · <row>`) or the database. @param {BundleCollection} c */
  const withinOf = c => {
    const at = containerOf(c)
    if (at === null) return null
    const row = rowOf.get(at)
    return pageOf.get(at)?.title ?? (row ? `${row.c.name} · ${row.r.title}` : collOf.get(at)?.name ?? null)
  }

  for (const c of bundle.collections) {
    const m = mapOf(c)
    const level = /** @type {ParsedLevel} */ (levelOfItem(c.sid))
    const oursGit = gitDefs.find(d => isObj(d.from) && /** @type {any} */ (d.from).source === source && /** @type {any} */ (d.from).id === c.sid)
    const oursStore = (state.storeCollections ?? []).find(s => isObj(s.definition) && isObj(/** @type {any} */ (s.definition).from)
      && /** @type {any} */ (s.definition).from.id === c.sid && /** @type {any} */ (s.definition).from.source === source)
    const into = typeof m.into === 'string' && m.into !== '' ? m.into : null
    const reg = into ? state.registries.find(r => r.name === into) : undefined
    if (reg && !(oursGit && oursGit.id === into)) {
      if (reg.class !== 'workspace' || reg.ledger || ['collections', 'imports'].includes(reg.name)) throw refuse('INTO_NOT_WORKSPACE', INTO_NOT_WORKSPACE(c.name, reg.name))
      if (!gitAllows(level)) throw refuse('INTO_STRICTER', INTO_STRICTER(c.name, reg.name))
      const def = reg.custom ? gitDefs.find(d => d.id === reg.name) ?? null : null
      target.set(c.sid, { id: reg.name, git: true, level, file: reg.file, topKey: reg.topKey, def, ours: false, into: true })
      continue
    }
    if (into && !reg && (state.storeCollections ?? []).some(s => s.id === into) && !(oursStore && oursStore.id === into)) throw refuse('INTO_PRIVATE', INTO_PRIVATE(c.name, into))
    if (into && !reg && !(oursStore && oursStore.id === into) && !isCustomId(into, REGISTRIES)) throw refuse('INTO_PRIVATE', INTO_PRIVATE(c.name, into))
    const ours = oursGit ?? (oursStore ? { ...(/** @type {any} */ (oursStore.definition)), id: oursStore.id } : null)
    if (ours && into && ours.id !== into) throw refuse('INTO_PRIVATE', INTO_PRIVATE(c.name, into))
    if (ours) {
      const wasGit = Boolean(oursGit)
      const wasLevel = wasGit ? MEMBERS : parseLevel(/** @type {any} */ (oursStore).visibility) ?? { level: 'hat', hat: String(/** @type {any} */ (oursStore).visibility) }
      if (wasGit !== gitAllows(level) || (!wasGit && formatLevel(wasLevel) !== formatLevel(level))) throw refuse('LEVEL_MOVED', LEVEL_MOVED(c.name, formatLevel(wasLevel)))
      target.set(c.sid, { id: ours.id, git: wasGit, level, file: customFileOf(ours.id), topKey: ours.id, def: /** @type {any} */ (ours), ours: true, into: false })
      continue
    }
    let id = into ?? `notion-${slugOf(c.name).slice(0, 34).replace(/-+$/, '')}`
    if (!into && !isCustomId(id, REGISTRIES)) id = 'notion-db'
    const base = id
    for (let n = 2; names.has(id) || [...target.values()].some(t => t.id === id); n++) id = `${base.slice(0, 38)}-${n}`
    if (state.storeCollections === null) needsStore = true // a new name the store may hold: it must be asked (R-L6-T12-4)
    target.set(c.sid, { id, git: gitAllows(level), level, file: customFileOf(id), topKey: id, def: null, ours: false, into: false })
  }
  for (const c of bundle.collections) if (!target.get(c.sid)?.git) { privateSids.add(c.sid); for (const r of c.rows) privateSids.add(r.sid) }

  // ── the pages: ids, levels, places ───────────────────────────────────────────────────────────────────────────
  const storePages = state.storeCollections === null ? [] : state.storeRecords('pages')
  const byId = pageEntries(state.gitPages, storePages)
  const existingPage = (/** @type {string} */ id) => [...byId.values()].find(e => isObj(e.from) && e.from?.source === source && e.from?.id === id) ?? null
  /** Each page this import writes or keeps, by its source id (ROOT_ID for the root, a row's id for its notes page). */
  /** @type {Map<string, { id: string, level: ParsedLevel, git: boolean, title: string, parent: string | null, body: string, attachments: { name: string, path: string }[], existing: any, sid: string, about: string[] }>} */
  const planned = new Map()
  const rootTitle = `${source === 'notion' ? 'Notion' : 'Fileverse'} archive · ${exported}`
  const rootWas = existingPage(ROOT_ID)
  const rootId = rootWas?.id ?? newPageId(rootTitle, 'git', state.random)
  planned.set(ROOT_ID, { id: rootId, level: MEMBERS, git: true, title: rootWas?.title ?? rootTitle, parent: rootWas ? rootWas.parent : null, body: rootWas?.markdown ?? '', attachments: [], existing: rootWas, sid: ROOT_ID, about: [] })
  /** Refused when an imported page would move between git and the store, or between two private levels (as LEVEL_MOVED
   *  for a database): the map does not move what was imported. @param {any} was @param {string} title @param {ParsedLevel} level */
  const samePlace = (was, title, level) => {
    if (!was) return
    const wasGit = was.where === 'git'
    const wasLevel = wasGit ? MEMBERS : (parseLevel(String(was.own)) ?? { level: 'hat', hat: String(was.own) })
    if (wasGit === gitAllows(level) && (wasGit || formatLevel(wasLevel) === formatLevel(level))) return
    throw refuse('LEVEL_MOVED', PAGE_LEVEL_MOVED(wasGit ? `The page "${title}"` : `A page kept at ${formatLevel(wasLevel)}`, formatLevel(wasLevel), formatLevel(level)))
  }
  const freshPage = (/** @type {string} */ title, /** @type {boolean} */ git) => {
    for (;;) { const id = newPageId(title, git ? 'git' : 'private', state.random); if (!byId.has(id) && ![...planned.values()].some(p => p.id === id)) return id }
  }
  const hasSubpages = new Set(bundle.pages.map(p => p.parent).filter(s => s !== null))
  // The notes pages of rows (a body, or subpages under the row).
  for (const c of bundle.collections) {
    const t = /** @type {NonNullable<ReturnType<typeof target.get>>} */ (target.get(c.sid))
    for (const r of c.rows) {
      if (r.body.trim() === '' && !hasSubpages.has(r.sid)) continue
      const was = existingPage(r.sid)
      samePlace(was, r.title, t.level)
      planned.set(r.sid, { id: was?.id ?? freshPage(r.title, t.git), level: t.level, git: t.git, title: r.title, parent: rootId, body: r.body, attachments: r.attachments ?? [], existing: was, sid: r.sid, about: [c.sid] })
    }
  }
  for (const p of bundle.pages) {
    const level = /** @type {ParsedLevel} */ (levelOfItem(p.sid))
    const git = gitAllows(level)
    if (!git) privateSids.add(p.sid)
    const was = existingPage(p.sid)
    const title = docTitle.get(p.sid) ?? p.title
    samePlace(was, title, level)
    planned.set(p.sid, { id: was?.id ?? freshPage(title, git), level, git, title, parent: null, body: p.body, attachments: p.attachments, existing: was, sid: p.sid, about: [] })
  }
  for (const p of bundle.pages) {
    const me = /** @type {NonNullable<ReturnType<typeof planned.get>>} */ (planned.get(p.sid))
    if (p.parent === null) me.parent = rootId
    else if (planned.has(p.parent)) me.parent = /** @type {any} */ (planned.get(p.parent)).id
    else if (rowOf.has(p.parent)) me.parent = rootId // its row has no notes page (cannot happen: a row with subpages has one)
    else { me.parent = rootId; say(p.title, MISSING_PARENT, [p.sid]) }
  }
  const levelOfId = (/** @type {string} */ id) => {
    const mine = [...planned.values()].find(p => p.id === id)
    return mine ? mine.level : byId.has(id) ? pageLevel(id, byId, policy) : null
  }

  // ── records and fields ──────────────────────────────────────────────────────────────────────────────────────
  const recordIdOf = new Map()
  /** @type {Map<string, Record<string, unknown>[]>} */
  const existingRecords = new Map()
  const recordsIn = (/** @type {NonNullable<ReturnType<typeof target.get>>} */ t) => {
    if (existingRecords.has(t.id)) return /** @type {Record<string, unknown>[]} */ (existingRecords.get(t.id))
    let list = /** @type {Record<string, unknown>[]} */ ([])
    if (t.git) {
      try { const v = parseDocument(fileNow(t.file) ?? '').toJS()?.[t.topKey]; if (Array.isArray(v)) list = v.filter(isObj) } catch { /* none read */ }
    } else if (state.storeCollections !== null) list = state.storeRecords(t.id).map(r => ({ ...r.body, id: r.id, __visibility: r.visibility, __rev: r.rev }))
    existingRecords.set(t.id, list)
    return list
  }
  /** The ids taken in each target, one set however many databases land there (two `into` one registry). @type {Map<string, Set<string>>} */
  const takenIn = new Map()
  for (const c of bundle.collections) {
    const t = /** @type {NonNullable<ReturnType<typeof target.get>>} */ (target.get(c.sid))
    const list = recordsIn(t)
    if (!takenIn.has(t.id)) takenIn.set(t.id, new Set(list.map(e => String(e.id))))
    const taken = /** @type {Set<string>} */ (takenIn.get(t.id))
    for (const r of c.rows) {
      const was = list.find(e => isObj(e.from) && /** @type {any} */ (e.from).source === source && /** @type {any} */ (e.from).id === r.sid)
      if (was) { recordIdOf.set(r.sid, String(was.id)); continue }
      const base = slugOf(r.title) === 'page' && !/page/i.test(r.title) ? 'row' : slugOf(r.title)
      let id = base
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
      taken.add(id)
      recordIdOf.set(r.sid, id)
    }
  }

  // ── the pages' texts (before the records, so a record never names a page that is not carried) ──────────────────
  /** The new pages not carried (a link the guard refused, too big): no record names them. @type {Set<string>} */
  const dropped = new Set()
  const siblingsOrder = new Map()
  const nextOrder = (/** @type {string | null} */ parent) => {
    if (!siblingsOrder.has(parent)) {
      const max = [...byId.values()].filter(e => e.parent === parent).reduce((n, e) => Math.max(n, e.order), 0)
      siblingsOrder.set(parent, max)
    }
    const n = siblingsOrder.get(parent) + ORDER_STEP
    siblingsOrder.set(parent, n)
    return n
  }
  const privateLevels = new Map([...target.values()].filter(t => !t.git).map(t => [t.id, t.level]))
  /** The level of the export's item `sid` (a page, a row, a database), or null for one it does not hold. */
  const levelOfSid = (/** @type {string} */ sid) => planned.get(sid)?.level
    ?? (rowOf.has(sid) ? /** @type {any} */ (target.get(/** @type {any} */ (rowOf.get(sid)).c.sid)).level : target.get(sid)?.level) ?? null
  /** Every private item's title (a database's name, a row's title, a private page's), as a link label may hold it. */
  const privateTitles = new Set([
    ...bundle.collections.filter(c => !target.get(c.sid)?.git).flatMap(c => [c.name, ...c.rows.map(r => r.title)]),
    ...[...planned.values()].filter(x => !x.git).map(x => x.title),
    ...bundle.pages.filter(x => privateSids.has(x.sid)).map(x => x.title), // a dDoc the map titled: its folder's name too
  ].map(t => labelText(t)).filter(t => t !== '' && t !== STRICT_LABEL))
  /** Every private item's id that is a name, not 32 hex digits (a Fileverse dDoc's folder, `<doc>/<tab>`, I1): found in
   *  a text where it stands whole, as a path segment does. */
  const privateNames = namesFinder([...privateSids].filter(s => !HEX_ID.test(s)))
  /** The refusal of a git text holding a private item's id, hex or a name (C1, I1), or null. `names: false` for the plan's
   *  own words (the archive root's title and mark, which say "archive" of themselves): only a hex id is looked for there.
   *  @param {string} text @param {string} where @param {{ names?: boolean }} [opts] */
  const privateInText = (text, where, opts = {}) => (firstIdIn(text, privateSids) !== null ? refuse('PRIVATE_IN_TEXT', PRIVATE_IN_TEXT(where))
    : opts.names !== false && privateNames(text).size > 0 ? refuse('PRIVATE_IN_TEXT', PRIVATE_NAME_IN_TEXT(where)) : null)
  /** The title of the git page or git record a link the plan wrote goes to, or null. @param {string} dest */
  const gitTitleAt = dest => {
    const page = /^\.\/([a-z0-9-]+)\.md$/.exec(dest)?.[1]
    if (page !== undefined) { const x = [...planned.values()].find(q => q.id === page); return x && x.git ? x.title : null }
    const rec = /^hub:record\/([^/]+)\/([^/]+)$/.exec(dest)
    if (rec) {
      for (const c of bundle.collections) {
        const t = target.get(c.sid)
        if (!t?.git || t.id !== rec[1]) continue
        const r = c.rows.find(x => recordIdOf.get(x.sid) === rec[2])
        if (r) return r.title
      }
    }
    return null
  }
  /** A git page's body with each link that still names a private item written ↗ (C1's backstop). @param {string} text @returns {string} */
  const backstop = text => rewriteLinks(text, link => {
    const label = link.auto ? link.label : backstop(link.label)
    const dest = link.dest
    const relative = !/^[a-z][a-z0-9+.-]*:/i.test(dest) && !dest.startsWith('#')
    const read = labelText(label)
    const named = privateTitles.has(read) && gitTitleAt(dest) !== read
    if (firstIdIn(dest, privateSids) !== null || privateNames(dest).size > 0 || (relative && /[0-9a-f]{32}\.(md|csv)(?:$|[?#])/i.test(safeDecode(dest))) || named) return STRICT_LABEL
    return label === link.label ? null : withLabel(link, label)
  })
  for (const s of state.storeCollections ?? []) if (!privateLevels.has(s.id)) privateLevels.set(s.id, parseLevel(s.visibility) ?? { level: 'hat', hat: s.visibility })
  /** A git page's parent as this import leaves it; and whether its chain of parents reaches the archive root (I5). */
  const finalParent = new Map([...planned.values()].map(x => [x.id, x.existing ? x.existing.parent : x.parent]))
  const underRoot = (/** @type {string} */ id) => {
    const seen = new Set([id])
    let at = finalParent.has(id) ? finalParent.get(id) : byId.get(id)?.parent ?? null
    while (at !== null && at !== undefined && !seen.has(at)) {
      if (at === rootId) return true
      seen.add(at)
      at = finalParent.has(at) ? finalParent.get(at) : byId.get(at)?.parent ?? null
    }
    return false
  }
  for (const p of planned.values()) {
    const where = p.title
    const about = [p.sid, ...p.about]
    // Links to what the export holds, by id; its attachments, beside a git page.
    /** @type {Map<string, string>} */
    const carried = new Map()
    /** @type {AssetWrite[]} */
    const pending = []
    /** The attachments edited in the Hub since the last import wrote them: kept (I6). @type {Said[]} */
    const keptAssets = []
    /** @type {Record<string, string>} */
    const assetBlobs = {}
    /** The names this page's attachments take: two that clean to one are told apart (`a-b.png`, `a-b-2.png`). */
    const assetNames = new Set()
    for (const a of p.attachments) {
      if (!p.git) { say(`${where} · ${a.name}`, PRIVATE_ATTACHMENT, about); continue }
      let name = assetName(a.name)
      if (name !== null && assetNames.has(name)) {
        const dot = name.lastIndexOf('.')
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
        let n = 2
        while (assetNames.has(`${stem.slice(0, 95 - ext.length)}-${n}${ext}`)) n++
        name = `${stem.slice(0, 95 - ext.length)}-${n}${ext}`
      }
      if (name !== null) assetNames.add(name)
      const size = state.sizeOf(a.path)
      if (name === null) { say(`${where} · ${a.name}`, NOT_OF_TYPE(a.name, 'a name an attachment can take'), about, { what: where, why: NOT_AN_ASSET_NAME_RECEIPT }); continue }
      if (size > ASSET_MAX_BYTES) { say(`${where} · ${a.name}`, BIG_ATTACHMENT(size), about); continue }
      carried.set(a.name, `./assets/${p.id}/${name}`)
      const rel = `pages/assets/${p.id}/${name}`
      // As a page is (§9.6): written when absent or as the last import left it (the receipt's blob), else kept (I6).
      const exported = state.blobOfFile(a.path)
      const current = state.fileBlob(rel)
      if (current === exported) continue
      if (current === null || current === lastBlob(rel)) { pending.push({ path: rel, from: a.path }); assetBlobs[rel] = exported }
      else keptAssets.push({ what: `${where} · ${a.name}`, why: KEPT })
    }
    const carryAssets = () => { assets.push(...pending); Object.assign(blobs, assetBlobs); report.kept.push(...keptAssets) }
    // Every link, read as CommonMark reads it (nested brackets in a label, parentheses in a path, absolute URLs and
    // autolinks too): a link into an item kept stricter than this page carries ↗ and no label (C1).
    const stricterHere = (/** @type {string} */ sid) => { const l = levelOfSid(sid); return l !== null && !narrowerOrEqual(p.level, l) }
    // The folder this page's relative links are read from, in source ids (a Fileverse tab's dDoc, I1).
    const folder = p.sid.includes('/') ? p.sid.slice(0, p.sid.lastIndexOf('/')) : ''
    /** A link to a page this import plans: its Hub page; ↗, said, when that page is stricter than this one (I1). */
    const toPage = (/** @type {NonNullable<ReturnType<typeof planned.get>>} */ page, /** @type {string} */ label) => {
      if (!narrowerOrEqual(p.level, page.level) || (p.git && !page.git)) { say(where, STRICT_ITEM, about); return `[${STRICT_LABEL}](./${page.id}.md)` }
      return `[${label}](./${page.id}.md)`
    }
    /** @param {string} text @returns {string} */
    const rewrite = text => rewriteLinks(text, link => {
      const label = link.auto ? link.label : rewrite(link.label)
      const href = link.dest
      // Into anything kept stricter: by a 32-hex id, or by a private name standing whole in it (a dDoc's folder, I1).
      const strict = [...idsIn(href), ...privateNames(href)].some(stricterHere)
      if (link.auto || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        if (strict) { say(where, STRICT_ITEM, about); return STRICT_LABEL }
        return label === link.label ? null : withLabel(link, label)
      }
      if (href.startsWith('#')) return label === link.label ? null : withLabel(link, label)
      let path = href
      try { path = decodeURIComponent(href) } catch { /* kept as written */ }
      const bare = path.split(/[?#]/)[0]
      const parts = bare.split('/')
      const file = parts[parts.length - 1] ?? path
      const own = parts.length === 1 || splitName(parts[parts.length - 2] ?? '')?.sid === p.sid
      // The page a relative path names, read from this page's folder (a Fileverse tab `<doc>/<stem>`, a dDoc its folder).
      const resolved = resolveIn(folder, bare)
      const md = /\.md$|\.csv$/.test(file)
      const named = resolved === null ? undefined : planned.get(md ? resolved.replace(/\.md$/, '') : resolved)
      if (link.bang || !md) {
        const to = own ? carried.get(file) : undefined
        if (to) return `${link.bang ? '!' : ''}[${label}](${to})`
        if (named && !link.bang) return toPage(named, label)
        if (strict) { say(where, STRICT_ITEM, about); return STRICT_LABEL }
        return label === link.label ? null : withLabel(link, label)
      }
      const sid = /([0-9a-f]{32})\.(md|csv)$/.exec(file)?.[1]
      if (!sid) {
        if (named) return toPage(named, label)
        // A path into the export at which the import carries no page: never left as written (its folder and its file
        // may be a private item's), ↗ (I1).
        if (strict) { say(where, STRICT_ITEM, about); return STRICT_LABEL }
        say(where, LINK_NOT_CARRIED, about)
        return STRICT_LABEL
      }
      const page = planned.get(sid)
      if (page) return toPage(page, label)
      const row = rowOf.get(sid)
      if (row) {
        const t = /** @type {any} */ (target.get(row.c.sid))
        if (!narrowerOrEqual(p.level, t.level)) { say(where, STRICT_RECORD, about); return STRICT_LABEL }
        return `[${label}](hub:record/${t.id}/${recordIdOf.get(sid)})`
      }
      if (target.has(sid)) {
        if (stricterHere(sid) || strict) { say(where, STRICT_ITEM, about); return STRICT_LABEL }
        return label
      }
      if (strict) { say(where, STRICT_ITEM, about); return STRICT_LABEL }
      say(where, LINK_OUTSIDE, about)
      return label
    })
    // The archive root's text is the Hub's own (its links are the Hub's), never the export's: it is not rewritten.
    let body = p.sid === ROOT_ID ? p.body : rewrite(p.body)
    const guarded = guardRefs(body, p.level, { pageLevel: levelOfId, collectionLevel: name => privateLevels.get(name) ?? null })
    if (guarded.refused !== null) { say(where, REFUSED_LINK(guarded.refused), about); if (!p.existing) dropped.add(p.sid); continue }
    body = guarded.body
    // The backstop (fail closed, C1): in a git page, a link still holding a private item's id, a path into the export or
    // a private item's title as its label is ↗; a private id left anywhere else refuses the import, naming this page.
    if (p.git) {
      body = backstop(body)
      const left = privateInText(body, `The page "${p.title}"`)
      if (left) throw left
    }
    const was = p.existing
    if (p.git) {
      const parent = was ? was.parent : p.parent
      const order = was ? was.order : nextOrder(p.parent)
      // Nothing imported is public (I5): the archive root, and a page the import leaves outside it, carry members; a page
      // under the root takes it from there.
      const own = p.sid === ROOT_ID || !underRoot(p.id) ? { visibility: 'members' } : {}
      const front = { id: p.id, title: p.title, parent, order, ...own, from: was?.from ?? markOf(p.sid) }
      const path = `pages/${p.id}.md`
      if (p.sid === ROOT_ID) front.from = was?.from ?? { source, id: ROOT_ID, exported }
      const keptText = joinPage(front, body)
      const text = joinPage({ ...front, from: p.sid === ROOT_ID ? front.from : markOf(p.sid) }, body)
      const n = Buffer.byteLength(text, 'utf8')
      if (n > PAGE_MAX_BYTES) { say(where, BIG_PAGE(n), about); if (!was) dropped.add(p.sid); continue }
      if (was) {
        const current = typeof was.text === 'string' ? was.text : null
        if (current === keptText || state.blobOf(keptText) === lastBlob(path)) { carryAssets(); continue }
        if (current === null || state.blobOf(current) !== lastBlob(path)) { report.kept.push({ what: where, why: KEPT }); continue }
        report.updated++
      } else report.created.pages++
      carryAssets()
      files.set(path, text)
      blobs[path] = state.blobOf(text)
      continue
    }
    const visibility = formatLevel(p.level)
    const parent = was ? was.parent : p.parent
    const order = was ? was.order : nextOrder(p.parent)
    /** @type {Record<string, unknown>} */
    const pageBody = { title: p.title, parent, order, from: markOf(p.sid), markdown: body }
    const n = Buffer.byteLength(body, 'utf8')
    if (n > PAGE_MAX_BYTES) { say(where, BIG_PAGE(n), about); if (!was) dropped.add(p.sid); continue }
    if (was) {
      const current = { title: was.title, parent: was.parent, order: was.order, ...(was.extra ?? {}), ...(was.meeting ? { meeting: was.meeting } : {}), from: was.from, markdown: was.markdown }
      const stamped = /** @type {any} */ (was.from)?.digest
      const kept = { ...pageBody, from: { .../** @type {any} */ (was.from), digest: undefined } }
      if (privDigest(kept) === stamped) continue
      if (privDigest(current) !== stamped) { report.kept.push({ what: where, why: KEPT }); continue }
      report.updated++
    } else report.created.pages++
    const stampedBody = { ...pageBody, from: { ...markOf(p.sid), digest: privDigest(pageBody) } }
    priv.push({ op: 'put-record', record: { collection: 'pages', id: p.id, visibility, body: stampedBody, rev: state.revOf(stampedBody) } })
  }

  for (const c of bundle.collections) {
    const t = /** @type {NonNullable<ReturnType<typeof target.get>>} */ (target.get(c.sid))
    const m = mapOf(c)
    const types = isObj(m.fields) ? /** @type {Record<string, string>} */ (m.fields) : {}
    /** The fields this collection is defined with, and how each value is carried. */
    /** @type {Record<string, unknown>[]} */
    const defFields = [{ id: 'title', type: 'text', name: c.fields[0]?.name ?? 'Name' }]
    /** @type {{ f: BundleField, type: FieldType, carry: 'git' | 'drop' | 'person' | 'contact', to?: string }[]} */
    const plans = []
    const contactOk = t.git ? contact !== null : contact !== null && narrowerOrEqual(t.level, contact)
    for (const f of c.fields.slice(1)) {
      const asked = types[f.id] ?? types[f.name]
      let type = /** @type {FieldType} */ (f.type)
      if (asked !== undefined && asked !== f.type) {
        if (!(/** @type {readonly string[]} */ (TYPES)).includes(String(asked)) || f.type === 'relation' || f.type === 'page') throw refuse('NOT_A_TYPE', NOT_A_TYPE(c.name, f.name, String(asked)))
        type = /** @type {FieldType} */ (asked)
      }
      const where = `${c.name} · ${f.name}`
      if (f.author && !keepAuthors) { plans.push({ f, type, carry: 'drop' }); say(where, AUTHORS, [c.sid]); continue }
      // A contact column (the reader's `contact`, I1) stays contact data whatever type the map gives it.
      if (type === 'person' || type === 'email' || type === 'phone' || f.contact) {
        if (!contactOk) { plans.push({ f, type, carry: 'drop' }); say(where, contact === null ? NO_CONTACT : CONTACT_OUTSIDE, [c.sid]); continue }
        if (type === 'person') {
          plans.push({ f, type, carry: 'person' })
          defFields.push({ id: f.id, type: 'person', name: f.name, many: true })
          defFields.push({ id: `${f.id}_names`, type: 'text', name: `${f.name} (names)` })
        } else {
          plans.push({ f, type, carry: 'contact' })
          defFields.push({ id: f.id, type, name: f.name })
        }
        continue
      }
      if (type === 'relation') {
        const to = f.to ? target.get(f.to) : undefined
        if (!to) { plans.push({ f, type, carry: 'drop' }); say(where, NO_TARGET, [c.sid]); continue }
        if (t.git && !to.git) { plans.push({ f, type, carry: 'drop' }); say(where, STRICTER_RELATION, [c.sid, /** @type {string} */ (f.to)]); continue }
        if (!narrowerOrEqual(t.level, to.level)) { plans.push({ f, type, carry: 'drop' }); say(where, STRICTER_RELATION, [c.sid, /** @type {string} */ (f.to)]); continue }
        plans.push({ f, type, carry: 'git', to: to.id })
        defFields.push({ id: f.id, type: 'relation', name: f.name, to: to.id, many: true })
        continue
      }
      plans.push({ f, type, carry: 'git' })
      /** @type {Record<string, unknown>} */
      const d = { id: f.id, type: type === 'page' ? 'page' : type, name: f.name }
      if (type === 'page') d.many = true
      if (type === 'select' || type === 'multiselect') {
        const opts = new Set()
        for (const r of c.rows) {
          const read = typeof r.raw?.[f.id] === 'string' ? parseNotionCell(/** @type {string} */ (r.raw?.[f.id]), type) : null
          if (read && !('problem' in read)) for (const o of [read.value].flat()) if (typeof o === 'string') opts.add(o)
        }
        d.options = [...opts]
      }
      defFields.push(d)
    }
    const timesSaid = new Set()
    const ownSaid = new Set()
    if (c.rows.some(r => planned.has(r.sid) && !dropped.has(r.sid))) defFields.push({ id: 'notes', type: 'page', name: 'Notes' })

    // The definition: a new collection's whole, or ours with the fields the export added.
    const defKeys = new Set(Array.isArray(t.def?.fields) ? t.def.fields.map((/** @type {any} */ f) => f.id) : [])
    const newFields = defFields.filter(f => !defKeys.has(f.id))
    if (!t.into) {
      if (!t.def) {
        const def = { id: t.id, name: c.name, fields: defFields, from: { source, id: c.sid } }
        report.created.collections++
        if (t.git) {
          const doc = listDoc(fileNow('data/collections.yaml'), 'collections')
          upsert(doc, 'collections', def)
          files.set('data/collections.yaml', yamlText(doc))
        } else priv.push({ op: 'put-collection', collection: { id: t.id, visibility: formatLevel(t.level), definition: def } })
      } else if (newFields.length > 0 && t.ours) {
        const def = { ...t.def, fields: [...(Array.isArray(t.def.fields) ? t.def.fields : []), ...newFields] }
        if (t.git) {
          const doc = listDoc(fileNow('data/collections.yaml'), 'collections')
          upsert(doc, 'collections', def)
          files.set('data/collections.yaml', yamlText(doc))
        } else priv.push({ op: 'put-collection', collection: { id: t.id, visibility: formatLevel(t.level), definition: def } })
      }
    }
    // Contact fields of a git collection are declared at defaults.contact in data/visibility.yaml (a narrowing, P-6).
    if (t.git && contactToken !== null) {
      const declared = policy.collections?.[t.id]?.fields ?? {}
      for (const p of plans) {
        const ids = p.carry === 'person' ? [`${p.f.id}_names`] : p.carry === 'contact' ? [p.f.id] : []
        for (const fid of ids) {
          if (Object.hasOwn(declared, fid)) continue
          files.set('data/visibility.yaml', narrowed(fileNow('data/visibility.yaml') ?? '', t.id, fid, contactToken))
        }
      }
    }

    // The records.
    const list = recordsIn(t)
    const doc = t.git ? listDoc(fileNow(t.file), t.topKey) : null
    let touched = false
    for (const r of c.rows) {
      const id = /** @type {string} */ (recordIdOf.get(r.sid))
      /** @type {Record<string, unknown>} */
      const value = { id, title: r.title }
      /** @type {{ field: string, value: unknown }[]} */
      const restricted = []
      for (const p of plans) {
        if (p.carry === 'drop') continue
        let v = r.values[p.f.id]
        if (p.type !== p.f.type && typeof r.raw?.[p.f.id] === 'string') {
          const read = parseNotionCell(/** @type {string} */ (r.raw?.[p.f.id]), p.type)
          if ('problem' in read) { say(`${c.name} · ${r.title} · ${p.f.name}`, NOT_OF_TYPE(/** @type {string} */ (r.raw?.[p.f.id]), p.type), [c.sid, r.sid], { why: NOT_OF_TYPE_RECEIPT(p.type) }); continue }
          v = read.value
        }
        if (v === undefined || v === null || (Array.isArray(v) && v.length === 0 && p.type !== 'relation' && p.type !== 'page')) continue
        if (p.type === 'person') {
          const names = [v].flat().map(String)
          const linked = []
          const unlinked = []
          for (const n of names) {
            const member = Object.hasOwn(people, n) ? people[n] : undefined
            if (typeof member === 'string' && member !== '' && state.members.includes(member)) linked.push(member)
            else {
              if (typeof member === 'string' && member !== '') say(`${c.name} · ${p.f.name}`, NOT_A_MEMBER(member), [c.sid])
              unlinked.push(n)
            }
          }
          if (linked.length > 0) value[p.f.id] = linked
          if (unlinked.length > 0) {
            if (t.git) restricted.push({ field: `${p.f.id}_names`, value: unlinked.join(', ') })
            else value[`${p.f.id}_names`] = unlinked.join(', ')
          }
          continue
        }
        if (p.carry === 'contact') { if (t.git) restricted.push({ field: p.f.id, value: v }); else value[p.f.id] = v; continue }
        if (p.type === 'relation') { value[p.f.id] = /** @type {string[]} */ (v).map(s => recordIdOf.get(s)).filter(Boolean); continue }
        if (p.type === 'page') { value[p.f.id] = /** @type {string[]} */ (v).filter(s => !dropped.has(s)).map(s => planned.get(s)?.id).filter(Boolean); continue }
        if (p.type === 'date' && typeof v === 'string' && v.includes('T')) {
          if (!timesSaid.has(p.f.id)) { timesSaid.add(p.f.id); say(`${c.name} · ${p.f.name}`, TIMES, [c.sid]) }
          v = v.slice(0, 10)
        }
        if (p.type === 'daterange' && isObj(v)) {
          const range = /** @type {{ start: string, end?: string }} */ (v)
          if (range.start.includes('T') || range.end?.includes('T')) {
            if (!timesSaid.has(p.f.id)) { timesSaid.add(p.f.id); say(`${c.name} · ${p.f.name}`, TIMES, [c.sid]) }
            v = { start: range.start.slice(0, 10), ...(range.end ? { end: range.end.slice(0, 10) } : {}) }
          }
        }
        value[p.f.id] = v
      }
      // Into a registry the instance defines (tasks, meetings): its own fields keep their shape; a relation never lands in
      // a field that names the registry's own kind of record (R-L6-T12-7).
      const props = t.into && !t.def ? state.registryProps(t.id) : null
      if (props) {
        for (const p of plans) {
          const fid = p.f.id
          if (!Object.hasOwn(value, fid) || !Object.hasOwn(props, fid)) continue
          const types = /** @type {string[]} */ (props[fid])
          if (p.type === 'relation' || p.type === 'page') {
            delete value[fid]
            if (!ownSaid.has(fid)) { ownSaid.add(fid); say(`${c.name} · ${p.f.name}`, INTO_OWN_FIELD(t.id, fid), [c.sid]) }
            continue
          }
          const v = value[fid]
          if (Array.isArray(v) && !types.includes('array')) {
            if (v.length === 1) value[fid] = v[0]
            else { delete value[fid]; say(`${c.name} · ${r.title} · ${p.f.name}`, ONE_VALUE(t.id, fid), [c.sid, r.sid]) }
          }
        }
      }
      // A git record's value holding a private item's id (a relation Notion wrote as text, a path) is not carried (C1).
      if (t.git) {
        for (const p of plans) {
          if (!Object.hasOwn(value, p.f.id) || privateInText(JSON.stringify(value[p.f.id]), '') === null) continue
          delete value[p.f.id]
          say(`${c.name} · ${r.title} · ${p.f.name}`, NAMES_PRIVATE, [c.sid])
        }
      }
      const notes = dropped.has(r.sid) ? undefined : planned.get(r.sid)
      if (notes) value.notes = notes.id
      // Nothing imported is public (I5): in a collection whose default is public, a record carries members.
      if (t.git && policy.collections?.[t.id]?.default === 'public') value.visibility = 'members'
      value.from = markOf(r.sid)
      const was = list.find(e => String(e.id) === id && isObj(e.from) && /** @type {any} */ (e.from).id === r.sid)
      const label = `${c.name} · ${r.title}`
      if (t.git) {
        const key = `${t.id}:${id}`
        let write = false
        if (was) {
          const kept = { ...value, from: was.from }
          if (digest(kept) === digest(was) || digest(kept) === lastBlob(key)) { /* nothing new from the export */ } else if (lastBlob(key) !== digest(was)) {
            report.kept.push({ what: label, why: KEPT })
            continue
          } else { write = true; report.updated++ }
        } else { write = true; report.created.records++ }
        if (write) { upsert(/** @type {any} */ (doc), t.topKey, value); touched = true; blobs[key] = digest(value) }
        // Its restricted fields, in the store; one already holding the value is not written again.
        const held = state.storeCollections === null ? [] : state.storeFields(t.id, id)
        for (const f of restricted) {
          if (held.some(h => h.field === f.field && canonicalJson(h.value) === canonicalJson(f.value))) continue
          priv.push({ op: 'put-field', field: { registry: t.id, record: id, field: f.field, visibility: /** @type {string} */ (contactToken), value: f.value } })
        }
        continue
      }
      // A private collection's record: its body in the store, its mark's digest with it.
      const body = { ...value }
      const visibility = formatLevel(t.level)
      if (was) {
        const { __visibility, __rev, ...current } = /** @type {any} */ (was)
        const stamped = /** @type {any} */ (current.from)?.digest
        const kept = { ...body, from: { .../** @type {any} */ (current.from), digest: undefined } }
        if (privDigest(kept) === stamped) continue
        if (privDigest(current) !== stamped) { report.kept.push({ what: label, why: KEPT }); continue }
        report.updated++
      } else report.created.records++
      const stampedBody = { ...body, from: { ...markOf(r.sid), digest: privDigest(body) } }
      priv.push({ op: 'put-record', record: { collection: t.id, id, visibility, body: stampedBody, rev: state.revOf(stampedBody) } })
    }
    if (t.git && touched) files.set(t.file, yamlText(/** @type {any} */ (doc)))
  }

  // ── what the reader could not read, and the report ────────────────────────────────────────────────────────────
  for (const n of bundle.notRead) {
    say(n.what, n.why, [n.at, n.to].filter(s => typeof s === 'string'), { ...(n.receiptWhat ? { what: n.receiptWhat } : {}), ...(n.receiptWhy ? { why: n.receiptWhy } : {}) })
  }
  // An entry is about a private item when it says so (`sids`), or when any of its words, the receipt's or the report's,
  // hold a private item's id (dashed or not).
  const isPrivate = (/** @type {(typeof said)[number]} */ s) => s.sids.some(x => privateSids.has(x))
    || [s.what, s.why, s.told?.what ?? '', s.told?.why ?? ''].some(t => privateInText(t, '') !== null)
  report.notCarried = said.map(s => ({ what: s.what, why: s.why }))
  const shown = said.filter(s => !isPrivate(s)).map(s => ({ what: s.told?.what ?? s.what, why: s.told?.why ?? s.why }))
  const hidden = said.length - shown.length
  const changed = files.size > 0 || priv.length > 0 || assets.length > 0
  const id = `imp_${state.random()}${state.random()}`.slice(0, 20)
  /** @type {ImportReceipt} */
  const receipt = {
    id, source, export: exported, at: state.now, by: state.by, created: { ...report.created }, updated: report.updated, kept: report.kept.length,
    not_carried: hidden > 0 ? [...shown, { what: RESTRICTED(hidden), why: RESTRICTED_WHY }] : shown, blobs,
  }
  // The backstop over every git text this plan writes, the receipt with them (C1): a private item's id in any is refused.
  for (const [path, text] of files) {
    const page = [...planned.values()].find(x => x.git && `pages/${x.id}.md` === path)
    // The archive root holds no export text: its title and mark are the plan's words, its text the Hub's.
    const left = privateInText(text, page ? `The page "${page.title}"` : path, { names: page?.sid !== ROOT_ID })
    if (left) throw left
  }
  // The receipt's own words (its source, its dates) are the plan's: a private name is looked for in what it says of the
  // export (its entries, the blobs' paths) only.
  const inReceipt = privateInText(JSON.stringify(receipt), 'data/imports.yaml', { names: false })
    ?? privateInText(JSON.stringify([receipt.not_carried, Object.keys(receipt.blobs)]), 'data/imports.yaml')
  if (inReceipt) throw inReceipt
  /** @type {FileOp[]} */
  const git = changed ? [...files].map(([path, text]) => ({ op: 'file', path, text, base: null })) : []
  const databases = bundle.collections.map(c => {
    const t = /** @type {NonNullable<ReturnType<typeof target.get>>} */ (target.get(c.sid))
    const within = withinOf(c)
    return { sid: c.sid, name: c.name, into: t.id, level: formatLevel(t.level), fields: Object.fromEntries(c.fields.slice(1).map(f => [f.id, f.type])), ...(within !== null ? { within } : {}) }
  })
  // The export's pages kept stricter than members, by source id: the command keeps a private dDoc's snapshot out of git
  // (Tasks 13–14 review I4).
  const privatePages = bundle.pages.filter(p => privateSids.has(p.sid)).map(p => p.sid)
  return { writes: { git, private: changed ? priv : [], assets: changed ? assets : [] }, needsStore, report, receipt, subject: `import: ${source} ${exported}`, databases, privatePages }
}
