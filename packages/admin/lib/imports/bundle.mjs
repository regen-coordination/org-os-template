// packages/admin/lib/imports/bundle.mjs
//
// The import pipeline's one shape (DAO-OS L6 spec §9.1): a reader turns a source into an ImportBundle; the plan
// (lib/imports/plan.mjs) turns a bundle and a map into writes and a report. Pure: no node:* import.
//
// The bundle as Task 12 builds it, beside the plan's interface: a row may carry `attachments` (a page's do) and its cells'
// text as written (`raw`, read again when the map types a field), a field read
// as authorship carries `author: true`, a relation's `to` names its target database by its source id, and an entry of
// `notRead` may say which database or page it is about (`at`, and `to`, a database it names), so the plan can leave a private one's name out of the
// receipt (rulings log, R-L6-T12-1); and `receiptWhat`/`receiptWhy`, its words in the receipt where the printed report's
// quote a cell (Task 12 review I2). A page and a database may say their `container`: the item (a page, a row, or the
// database of a row with no page) whose folder holds them, whose level they take (I3); absent, a page's is its parent.
// A page may carry `mark`: what its source says of it beyond its id (Fileverse: the dDoc, the tab, its id, the pull's date
// and digest, Task 13), joined into its `from`.

/**
 * @typedef {import('../workspace/collections.mjs').FieldType} FieldType
 * @typedef {{ id: string, type: FieldType, name: string, options?: string[], to?: string | null, many?: boolean, author?: true, contact?: true }} BundleField
 * @typedef {{ name: string, path: string }} Attachment
 * @typedef {{ sid: string, title: string, parent: string | null, container?: string | null, body: string, attachments: Attachment[], mark?: Record<string, string> }} BundlePage
 * @typedef {{ sid: string, title: string, values: Record<string, unknown>, body: string, attachments?: Attachment[], raw?: Record<string, string> }} BundleRow
 * @typedef {{ sid: string, name: string, fields: BundleField[], rows: BundleRow[], container?: string | null }} BundleCollection
 * @typedef {{ on: string, author: string, at: string | null, body: string }} BundleComment
 * @typedef {{ what: string, why: string, at?: string, to?: string, receiptWhat?: string, receiptWhy?: string }} NotRead
 * @typedef {{ source: 'notion' | 'fileverse', exported: string, pages: BundlePage[], collections: BundleCollection[],
 *   comments: BundleComment[], notRead: NotRead[] }} ImportBundle
 */

/** A title is at most this many characters (code points); a longer one is cut with "…" (§9.4). */
export const TITLE_MAX = 200

/** A title as it lands: at most TITLE_MAX characters, the last of a cut one "…"; emoji and any Unicode kept.
 *  @param {string} title @returns {string} */
export function cutTitle(title) {
  const chars = [...String(title)]
  return chars.length <= TITLE_MAX ? chars.join('') : `${chars.slice(0, TITLE_MAX - 1).join('')}…`
}

/** A Notion id: 32 hex digits, the suffix of every page's, database's and row's file name. */
export const NOTION_ID = /[0-9a-f]{32}/

/** `<Title> <32 hex>` read apart: the title and the id, or null for a name that carries no id.
 *  @param {string} name @returns {{ title: string, sid: string } | null} */
export function splitName(name) {
  const m = /^(.*?) ?([0-9a-f]{32})$/.exec(name)
  return m ? { title: m[1] ?? '', sid: /** @type {string} */ (m[2]) } : null
}

/** An empty bundle. @param {'notion' | 'fileverse'} source @param {string} exported @returns {ImportBundle} */
export function emptyBundle(source, exported) {
  return { source, exported, pages: [], collections: [], comments: [], notRead: [] }
}

/** A field id from a column's name (L6 §7.4's rule: lower case letters, digits and underscores, a letter first, at most 41),
 *  never `id`, `visibility`, `from` or `notes` (the record's own keys), unique among `taken`.
 *  @param {string} name @param {ReadonlySet<string>} taken @returns {string} */
export function fieldIdOf(name, taken) {
  let base = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z]/.test(base)) base = `f_${base}`.replace(/_+$/, '')
  base = base.slice(0, 30).replace(/_+$/, '') // room for `_<n>` and `_names` within 41
  if (['id', 'visibility', 'from', 'notes', 'title'].includes(base)) base = `${base}_field`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}
