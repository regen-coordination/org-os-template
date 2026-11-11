// packages/admin/lib/imports/fileverse.mjs
//
// The Fileverse reader (DAO-OS L6 spec §9.5, Task 13): the output of the instance's Fileverse pull read into an
// ImportBundle. It reads only the folder it is given (the pull's `docs/governance/fileverse/`) and writes nothing: the
// snapshot files are left where they are, byte for byte. Fileverse stays a `link` System (Q68).
//
// - The pull writes one file per tab, `<doc>/<tab>.md`, opening with front matter: `title` (the tab's), `fileverse_doc`
//   (the dDoc, its folder's name), `fileverse_tab` (the tab's name in the dDoc), `fileverse_tab_id` (when the dDoc gives a
//   plain one), `pulled_at` and `content_sha256` (of the text after the front matter and its blank line); then the text.
// - Each dDoc is a page (its source id the dDoc's folder; titled by it, since the pull names the dDoc by its folder only:
//   the map may title it), with no text of its own; each tab is its subpage (its source id `<doc>/<tab file>`, the place
//   the pull itself keys it by: a tab id is not unique across dDocs, every first tab's is `default`), in the order of the
//   tabs' names in the dDoc. A tab sits in its dDoc (`container`), so it takes the dDoc's level (Task 12 review I3); the
//   map sets each dDoc's level (§20 Q7, `docs:` in lib/imports/plan.mjs).
// - A page's mark (`mark`, joined into its `from`) carries what the pull says of it: the dDoc, and for a tab its name, its
//   id, its pull date and its digest.
// - A tab whose text is not the text its `content_sha256` names was changed after the pull, and one whose `fileverse_doc`
//   names another dDoc than its folder was moved there by hand: neither is carried (each said), since its mark would say
//   what is not so. What is not a tab the pull wrote is not read (said).
// - The pull writes no comments: none are carried (said once).
// - A link (to a folder or a file) is not read, and a tab past a page's size is not read either (said, the file stat'd and
//   never opened): Tasks 13–14 review M2.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { sha256Hex } from '../sha256.mjs'
import { cutTitle, emptyBundle } from './bundle.mjs'
import { MAP_FILE } from './notion.mjs'
import { BIG_PAGE } from './plan.mjs'
import { PAGE_MAX_BYTES } from '../workspace/pages.mjs'

/** @typedef {import('./bundle.mjs').ImportBundle} ImportBundle */
/** @typedef {import('./bundle.mjs').BundlePage} BundlePage */
/** @typedef {import('./bundle.mjs').NotRead} NotRead */

export const NOT_A_SNAPSHOT = 'not a tab the Fileverse pull wrote (front matter with fileverse_doc, fileverse_tab, pulled_at and content_sha256): not read'
export const SHA_MISMATCH = 'its text is not the text its content_sha256 names, so it was changed after the pull: not carried; pull it again'
export const DOC_ELSEWHERE = (/** @type {string} */ doc) => `its fileverse_doc is ${doc}, not the dDoc whose folder holds it: not carried`
/** DOC_ELSEWHERE's words in the receipt, which names no other dDoc (it may be one kept stricter, Task 12 review I2). */
export const DOC_ELSEWHERE_RECEIPT = 'a tab whose fileverse_doc is not the dDoc whose folder holds it: not carried'
export const NOT_IN_A_DOC = 'a folder inside a dDoc\'s folder, where the pull writes none: not read'
export const NO_COMMENTS = 'The Fileverse pull writes no comments, so none are carried.'
/** A symbolic link in the pull, to a folder or a file (Tasks 13–14 review M2): the import reads what the pull wrote, and
 *  a link may point anywhere. */
export const A_LINK = 'a link: not read'
/** A_LINK's words in the receipt, which does not name a link: what it points at is not known. */
export const A_LINK_RECEIPT = 'a link in the pull'

const TAB = /^([^.].*)\.md$/
const DAY = /^\d{4}-\d{2}-\d{2}/

/** @param {string} abs */
const entriesOf = abs => {
  try { return readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) } catch { return [] }
}

/** A snapshot's front matter and text, or null when the file does not open with front matter.
 *  @param {string} text @returns {{ front: Record<string, unknown>, body: string } | null} */
function splitSnapshot(text) {
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---\n', 3)
  if (end < 0) return null
  let front
  // Every value as text (YAML's failsafe schema, Tasks 13–14 review M1): a folder `007` or `1e3`, a title `1e3`, a date,
  // are the words the pull wrote, never a number or a Date.
  try { front = parse(text.slice(4, end), { schema: 'failsafe' }) } catch { return null }
  if (typeof front !== 'object' || front === null || Array.isArray(front)) return null
  const rest = text.slice(end + 5)
  return { front: /** @type {Record<string, unknown>} */ (front), body: rest.startsWith('\n') ? rest.slice(1) : rest }
}

const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : null)

/**
 * Reads the pull in `dir` (§9.5). `opts.exported`: the pull's date (`YYYY-MM-DD`); absent, the newest `pulled_at` day
 * among the tabs read, else the day of the newest file in it.
 * @param {string} dir @param {{ exported?: string }} [opts] @returns {ImportBundle}
 */
export function readFileverse(dir, opts = {}) {
  /** @type {BundlePage[]} */
  const pages = []
  /** @type {NotRead[]} */
  const notRead = []
  let newestPull = ''
  let newestFile = 0
  for (const e of entriesOf(dir)) {
    if (e.name.startsWith('.')) continue
    if (e.isSymbolicLink()) { notRead.push({ what: e.name, why: A_LINK, receiptWhat: A_LINK_RECEIPT }); continue }
    if (e.isFile()) {
      if (e.name !== MAP_FILE) notRead.push({ what: e.name, why: NOT_A_SNAPSHOT })
      continue
    }
    if (!e.isDirectory()) continue
    const doc = e.name
    const folder = join(dir, doc)
    const entries = entriesOf(folder).filter(x => !x.name.startsWith('.'))
    // A folder holding no Markdown file is no dDoc: what is in it is not read.
    if (!entries.some(x => x.isFile() && TAB.test(x.name))) {
      for (const x of entries) notRead.push(x.isSymbolicLink() ? { what: `${doc}/${x.name}`, why: A_LINK, receiptWhat: A_LINK_RECEIPT }
        : { what: `${doc}/${x.name}`, why: x.isDirectory() ? NOT_IN_A_DOC : NOT_A_SNAPSHOT })
      continue
    }
    /** @type {{ page: BundlePage, name: string }[]} */
    const tabs = []
    for (const x of entries) {
      const what = `${doc}/${x.name}`
      const at = { at: doc }
      if (x.isDirectory()) { notRead.push({ what, why: NOT_IN_A_DOC, ...at }); continue }
      if (x.isSymbolicLink()) { notRead.push({ what, why: A_LINK, ...at, receiptWhat: A_LINK_RECEIPT }); continue }
      const m = x.isFile() ? TAB.exec(x.name) : null
      if (!m) { notRead.push({ what, why: NOT_A_SNAPSHOT, ...at }); continue }
      const full = join(folder, x.name)
      let size = 0
      try { const st = statSync(full); size = st.size; newestFile = Math.max(newestFile, st.mtimeMs) } catch { /* unread */ }
      if (size > PAGE_MAX_BYTES) { notRead.push({ what, why: BIG_PAGE(size), ...at }); continue }
      const read = splitSnapshot(readFileSync(full, 'utf8').replace(/\r\n/g, '\n'))
      const f = read?.front ?? {}
      const named = str(f.fileverse_doc)
      const tab = str(f.fileverse_tab)
      const pulledAt = str(f.pulled_at)
      const sha = str(f.content_sha256)
      if (!read || named === null || tab === null || pulledAt === null || sha === null) { notRead.push({ what, why: NOT_A_SNAPSHOT, ...at }); continue }
      if (named !== doc) { notRead.push({ what, why: DOC_ELSEWHERE(named), ...at, to: named, receiptWhat: doc, receiptWhy: DOC_ELSEWHERE_RECEIPT }); continue }
      if (sha256Hex(read.body) !== sha.toLowerCase()) { notRead.push({ what, why: SHA_MISMATCH, ...at }); continue }
      if (DAY.test(pulledAt) && pulledAt.slice(0, 10) > newestPull) newestPull = pulledAt.slice(0, 10)
      const tabId = str(f.fileverse_tab_id)
      const title = str(f.title)
      tabs.push({
        name: tab,
        page: {
          sid: `${doc}/${m[1]}`, title: cutTitle(title !== null && title.trim() !== '' ? title : tab), parent: doc, container: doc, body: read.body,
          attachments: [], mark: { doc, tab, ...(tabId !== null ? { tab_id: tabId } : {}), pulled_at: pulledAt, content_sha256: sha.toLowerCase() },
        },
      })
    }
    pages.push({ sid: doc, title: cutTitle(doc), parent: null, container: null, body: '', attachments: [], mark: { doc } })
    tabs.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || (a.page.sid < b.page.sid ? -1 : 1))
    for (const t of tabs) pages.push(t.page)
  }
  notRead.push({ what: 'comments', why: NO_COMMENTS })
  const exported = opts.exported ?? (newestPull !== '' ? newestPull : new Date(newestFile > 0 ? newestFile : Date.now()).toISOString().slice(0, 10))
  return { ...emptyBundle('fileverse', exported), pages, notRead }
}
