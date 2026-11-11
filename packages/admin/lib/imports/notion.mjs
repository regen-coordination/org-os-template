// packages/admin/lib/imports/notion.mjs
//
// The Notion reader (DAO-OS L6 spec §9.4): an unzipped Markdown & CSV export read into an ImportBundle. It reads only the
// folder it is given and writes nothing.
//
// - A page is `<Title> <32 hex>.md`; its subpages and attachments sit in the folder `<Title> <32 hex>/`. The 32-hex suffix
//   is the Notion id; every relation is resolved by it, never by title. A page's title is its `# ` heading (Notion cuts a
//   long title in the file's name), else the file's name; a title over 200 characters is cut with "…".
// - A database is `<Name> <32 hex>.csv` (the `_all.csv` beside it preferred) with its rows' pages in `<Name> <32 hex>/`.
//   The CSV gives the fields; each row is its page (which carries its id): `# <Title>`, then `Property: value` lines up to
//   the first blank line, then the body. A CSV row with no page has no id and is reported, not carried.
// - Field types are inferred per column (every cell reads as the type); a people-shaped column is a person field, an
//   authorship column (`Created by`, `Last edited by`) an author field; a column named for contact details, or any of
//   whose cells reads as an e-mail or a phone, is contact data (`contact: true`, review I1); what cannot be read is said
//   in `notRead`.
// - Comments: the Markdown export holds none. Reading them from an HTML export (`html`) is not built until its markup is
//   confirmed against a real HTML export (Q4, rulings log R-L6-T12-2): comments are reported not carried either way.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cutTitle, emptyBundle, fieldIdOf, splitName } from './bundle.mjs'
import { parseCsv, parseNotionCell } from './notion-csv.mjs'
import { BIG_PAGE } from './plan.mjs'
import { PAGE_MAX_BYTES } from '../workspace/pages.mjs'

/** @typedef {import('./bundle.mjs').ImportBundle} ImportBundle */
/** @typedef {import('./bundle.mjs').BundlePage} BundlePage */
/** @typedef {import('./bundle.mjs').BundleRow} BundleRow */
/** @typedef {import('./bundle.mjs').BundleField} BundleField */
/** @typedef {import('./bundle.mjs').BundleCollection} BundleCollection */
/** @typedef {import('./bundle.mjs').Attachment} Attachment */
/** @typedef {import('../workspace/collections.mjs').FieldType} FieldType */

export const COMMENTS_NOT_CARRIED = 'The Markdown & CSV export holds no comments, so none are carried. Export the workspace as HTML too to read them, once that reader is built.'
export const HTML_NOT_BUILT = 'Comments are read from an HTML export only once its markup is confirmed against a real Notion HTML export; until then none are carried.'
export const NO_ID = 'a row of the CSV with no page in the export, so it has no id: not carried'
export const OUTSIDE = (sid) => `a relation to a page not in the export (${sid}): not carried`
export const SHARED_TITLE = (n, db, title) => `${n} rows of ${db} are titled "${title}", and the relation names it by its title alone: matched to neither, not carried`
export const NO_TITLE = (db, title) => `no row of ${db} is titled "${title}", and the relation names it by its title alone: not carried`
export const NO_TARGET = (title) => `"${title}" is named by its title alone, and no linked item says which database it is in: not carried`
export const OTHER_DB = (sid) => `a relation to an item of another database (${sid}): not carried`
export const AS_TEXT = (text) => `"${[...text].length > 80 ? `${[...text].slice(0, 79).join('')}…` : text}" is not a date in English: kept as text, and the column with it`
// The receipt's words for the same (Task 12 review I2): data/imports.yaml quotes no cell, and names no row the git side
// does not; the printed report says the sentences above.
export const OUTSIDE_RECEIPT = 'a relation to a page not in the export: not carried'
export const OTHER_DB_RECEIPT = 'a relation to an item of another database: not carried'
export const SHARED_TITLE_RECEIPT = (n, db) => `${n} rows of ${db} share the title a relation names alone: matched to neither, not carried`
export const NO_TITLE_RECEIPT = (db) => `no row of ${db} has the title a relation names alone: not carried`
export const NO_TARGET_RECEIPT = 'an item is named by its title alone, and no linked item says which database it is in: not carried'
export const AS_TEXT_RECEIPT = 'a cell is not a date in English: kept as text, and the column with it'
export const NO_ID_RECEIPT = 'a row of the CSV with no page in the export, so it has no id: not carried'
export const ZIPPED = 'a zip file in the export: unzip it into the folder (nested Part-N.zip files too) and read it again'
export const NOT_READ_FILE = 'not a page, a database or an attachment of a page: not read'

/** The map file the import command writes beside the export: never read as part of it. */
export const MAP_FILE = 'hub-import-map.yaml'

const PERSONISH = /^(owners?|leads?|assignees?|assigned(?: to)?|attendees?|participants?|members?|people|persons?|authors?|responsible|hosts?|facilitators?|stewards?|reviewers?|contacts? persons?)$/i
const AUTHOR = /^(created by|last edited by)$/i
/** A column named for contact details (Task 12 review I1), its words read with case and accents folded: a phone's words,
 *  then an e-mail's, then `contact` (whose cells say which). */
const PHONE_WORDS = new Set(['phone', 'phones', 'mobile', 'tel', 'telephone', 'whatsapp', 'signal', 'telegram', 'telefone', 'telefono', 'telefon', 'celular', 'movil', 'cell'])
const MAIL_WORDS = new Set(['email', 'emails', 'mail', 'correo'])
const CONTACT_WORDS = new Set(['contact', 'contacts', 'contacto', 'contato'])
/** @param {string} name @returns {'phone' | 'email' | 'contact' | null} */
function contactName(name) {
  const words = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\be-mail/g, 'email').split(/[^a-z0-9]+/)
  if (words.some(w => PHONE_WORDS.has(w))) return 'phone'
  if (words.some(w => MAIL_WORDS.has(w))) return 'email'
  if (words.some(w => CONTACT_WORDS.has(w))) return 'contact'
  return null
}

const MD = /^(.*) ([0-9a-f]{32})\.md$/
const CSV = /^(.*) ([0-9a-f]{32})(_all)?\.csv$/

/** @param {string} abs */
const entriesOf = abs => {
  try { return readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) } catch { return [] }
}

/** A page file read: its heading's title (or the file's) and its body after the heading. @param {string} text @param {string} fileTitle */
function readPageText(text, fileTitle) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let title = fileTitle
  let at = 0
  const m = /^# (.*)$/.exec(lines[0] ?? '')
  if (m) { title = m[1].trim(); at = 1 }
  while (at < lines.length && lines[at].trim() === '' && at < lines.length - 1) at++
  return { title, lines: lines.slice(at) }
}

/**
 * Reads the export in `dir` (§9.4). `opts.exported`: the export's date (`YYYY-MM-DD`); absent, the day of the newest file
 * in it. `opts.html`: an HTML export of the same workspace, for its comments (not built: reported, R-L6-T12-2).
 * @param {string} dir @param {{ html?: string, exported?: string }} [opts] @returns {ImportBundle}
 */
export function readNotionExport(dir, opts = {}) {
  let newest = 0
  /** @type {{ sid: string, name: string, file: string, all: boolean, rowsDir: string | null, container: string | null }[]} */
  const databases = []
  /** @type {BundlePage[]} */
  const pages = []
  /** @type {Map<string, { db: string, row: BundleRow, props: string[] }>} */
  const rowPages = new Map()
  /** @type {import('./bundle.mjs').NotRead[]} */
  const notRead = []
  const stamp = (/** @type {string} */ abs) => { try { newest = Math.max(newest, statSync(abs).mtimeMs) } catch { /* unread */ } }

  /**
   * One folder. `parent`: the page (or row) its pages sit under; `owner`: the page or row its other files are attachments
   * of (null at the top, where they are not read); `rel`: where it is, for the report; `container`: the item of the export
   * whose folder this is, or holds it (a page, a row, or a database for a row with no page), whose level what is in it
   * takes (Task 12 review I3).
   * @param {string} abs @param {string} rel @param {string | null} parent @param {{ attachments?: Attachment[] } | null} owner
   * @param {string | null} container
   */
  const walk = (abs, rel, parent, owner, container) => {
    const entries = entriesOf(abs)
    const dbsHere = new Map()
    for (const e of entries) {
      const m = e.isFile() ? CSV.exec(e.name) : null
      if (!m) continue
      const was = dbsHere.get(m[2])
      if (!was || m[3]) dbsHere.set(m[2], { sid: m[2], name: m[1], file: join(abs, e.name), all: Boolean(m[3]), rowsDir: null, container })
    }
    const pagesHere = new Map()
    for (const e of entries) {
      const full = join(abs, e.name)
      const here = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isFile()) {
        stamp(full)
        if (CSV.test(e.name)) continue
        const md = MD.exec(e.name)
        if (md) {
          // A page past a page's size is said and not read (stat'd, never opened; Tasks 13–14 review M2).
          let size = 0
          try { size = statSync(full).size } catch { /* read as it is */ }
          if (size > PAGE_MAX_BYTES) { notRead.push({ what: here, why: BIG_PAGE(size), ...(container !== null ? { at: container } : {}) }); continue }
          const read = readPageText(readFileSync(full, 'utf8'), md[1])
          /** @type {BundlePage} */
          const page = { sid: md[2], title: cutTitle(read.title), parent, container, body: read.lines.join('\n'), attachments: [] }
          pages.push(page)
          pagesHere.set(md[2], page)
          continue
        }
        if (rel === '' && e.name === MAP_FILE) continue
        if (e.name === '.DS_Store') continue
        const at = container !== null ? { at: container } : {}
        if (/\.zip$/i.test(e.name)) { notRead.push({ what: here, why: ZIPPED, ...at }); continue }
        if (owner) { (owner.attachments ??= []).push({ name: e.name, path: full }); continue }
        notRead.push({ what: here, why: NOT_READ_FILE, ...at })
      }
    }
    for (const db of dbsHere.values()) databases.push(db)
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = join(abs, e.name)
      const here = rel === '' ? e.name : `${rel}/${e.name}`
      const named = splitName(e.name)
      const db = named ? dbsHere.get(named.sid) : undefined
      if (db) { db.rowsDir = full; continue }
      const page = named ? pagesHere.get(named.sid) : undefined
      // A folder named for a page this folder does not hold: its pages are read under that id (a parent the plan reports
      // missing), and its other files are not read.
      walk(full, here, named ? named.sid : parent, page ?? null, page ? page.sid : container)
    }
  }
  walk(dir, '', null, null, null)

  /** @type {BundleCollection[]} */
  const collections = []
  for (const db of databases) {
    const rows = parseCsv(readFileSync(db.file, 'utf8'))
    const header = rows[0] ?? ['Name']
    const taken = new Set(['title'])
    /** @type {BundleField[]} */
    const fields = header.map((name, i) => {
      if (i === 0) return { id: 'title', type: /** @type {FieldType} */ ('text'), name }
      const id = fieldIdOf(name, taken)
      taken.add(id)
      return { id, type: /** @type {FieldType} */ ('text'), name }
    })
    const byName = new Map(header.map((name, i) => [name, fields[i]]))
    /** @type {BundleCollection} */
    const coll = { sid: db.sid, name: db.name, fields, rows: [], container: db.container }
    // Each row is its page: the id is its file's, the values its property lines.
    for (const e of db.rowsDir ? entriesOf(db.rowsDir) : []) {
      const md = e.isFile() ? MD.exec(e.name) : null
      if (!md) continue
      const full = join(/** @type {string} */ (db.rowsDir), e.name)
      stamp(full)
      const read = readPageText(readFileSync(full, 'utf8'), md[1])
      /** @type {Record<string, string>} */
      const cells = {}
      let at = 0
      for (; at < read.lines.length; at++) {
        const line = read.lines[at]
        if (line.trim() === '') { at++; break }
        const p = /^(.+?): (.*)$/.exec(line)
        const f = p ? byName.get(p[1]) : undefined
        if (!p || !f || f.id === 'title') break
        cells[f.id] = p[2]
      }
      /** @type {BundleRow} */
      const row = { sid: md[2], title: cutTitle(read.title), values: { ...cells }, raw: cells, body: read.lines.slice(at).join('\n') }
      if (row.body.trim() === '') row.body = ''
      coll.rows.push(row)
      rowPages.set(md[2], { db: db.sid, row, props: Object.keys(cells) })
    }
    // A CSV row whose title no page carries has no id.
    const counts = new Map()
    for (const r of coll.rows) counts.set(r.title, (counts.get(r.title) ?? 0) + 1)
    for (const cells of rows.slice(1)) {
      const title = cutTitle(cells[0] ?? '')
      const n = counts.get(title) ?? 0
      if (n > 0) counts.set(title, n - 1)
      else notRead.push({ what: `${db.name} · ${title}`, why: NO_ID, at: db.sid, receiptWhat: db.name, receiptWhy: NO_ID_RECEIPT })
    }
    collections.push(coll)
    // The row's folder: its subpages (under the row) and its attachments.
    if (db.rowsDir) {
      for (const e of entriesOf(db.rowsDir)) {
        if (!e.isDirectory()) continue
        const named = splitName(e.name)
        const row = named ? rowPages.get(named.sid)?.row : undefined
        // A row's folder holds what takes the row's level; a folder whose row has no page, the database's (I3).
        walk(join(db.rowsDir, e.name), `${db.name}/${e.name}`, named ? named.sid : null, row ?? null, row && named ? named.sid : db.sid)
      }
    }
  }

  // Every item by its id, for relations.
  /** @type {Map<string, { kind: 'page' } | { kind: 'row', db: string }>} */
  const index = new Map()
  for (const p of pages) index.set(p.sid, { kind: 'page' })
  for (const c of collections) for (const r of c.rows) index.set(r.sid, { kind: 'row', db: c.sid })
  const nameOf = new Map(collections.map(c => [c.sid, c.name]))

  for (const c of collections) {
    for (const f of c.fields) {
      if (f.id === 'title') continue
      const texts = c.rows.map(r => /** @type {string | undefined} */ (r.values[f.id])).filter(v => v !== undefined && v.trim() !== '')
      inferField(f, texts)
      if (f.type === 'text') {
        // A column some of whose cells read as dates: the others are kept as text, and said so.
        const dated = texts.filter(t => { const r = parseNotionCell(t); return !('problem' in r) && (r.type === 'date' || r.type === 'daterange') })
        if (dated.length > 0) {
          for (const r of c.rows) {
            const t = r.values[f.id]
            if (typeof t === 'string' && t.trim() !== '' && !dated.includes(t)) notRead.push({ what: `${c.name} · ${r.title} · ${f.name}`, why: AS_TEXT(t), at: c.sid, receiptWhy: AS_TEXT_RECEIPT })
          }
        }
      }
      if (f.type === 'relation') {
        const linked = c.rows.flatMap(r => {
          const read = typeof r.values[f.id] === 'string' ? parseNotionCell(/** @type {string} */ (r.values[f.id]), 'relation') : null
          return read && !('problem' in read) ? /** @type {{ sid: string | null }[]} */ (read.value).flatMap(i => (i.sid ? [i.sid] : [])) : []
        })
        const kinds = linked.map(s => index.get(s)).filter(k => k !== undefined)
        const dbVotes = new Map()
        for (const k of kinds) if (k.kind === 'row') dbVotes.set(k.db, (dbVotes.get(k.db) ?? 0) + 1)
        const pagesOnly = kinds.length > 0 && kinds.every(k => k.kind === 'page')
        const target = [...dbVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        if (pagesOnly) { f.type = 'page'; f.many = true; delete f.to } else { f.to = target; f.many = true }
      }
    }
    for (const r of c.rows) {
      for (const f of c.fields) {
        if (f.id === 'title') continue
        const t = r.values[f.id]
        if (typeof t !== 'string') { if (f.type === 'relation' || f.type === 'page') r.values[f.id] = []; continue }
        let read = parseNotionCell(t, f.type)
        if ('problem' in read && f.type === 'daterange') {
          const day = parseNotionCell(t, 'date')
          if (!('problem' in day)) read = { value: { start: day.value }, type: 'daterange' }
        }
        if ('problem' in read) { r.values[f.id] = t; continue }
        if (f.type !== 'relation' && f.type !== 'page') { r.values[f.id] = read.value; continue }
        /** @type {string[]} */
        const out = []
        const where = `${c.name} · ${r.title} · ${f.name}`
        for (const item of /** @type {{ title: string, sid: string | null }[]} */ (read.value)) {
          if (item.sid) {
            const k = index.get(item.sid)
            if (!k) notRead.push({ what: where, why: OUTSIDE(item.sid), at: c.sid, receiptWhy: OUTSIDE_RECEIPT })
            else if (f.type === 'page' ? k.kind !== 'page' : k.kind !== 'row' || k.db !== f.to) {
              notRead.push({ what: where, why: OTHER_DB(item.sid), at: c.sid, to: k.kind === 'row' ? k.db : item.sid, receiptWhy: OTHER_DB_RECEIPT })
            }
            else out.push(item.sid)
            continue
          }
          if (f.type !== 'relation' || !f.to) { notRead.push({ what: where, why: NO_TARGET(item.title), at: c.sid, receiptWhy: NO_TARGET_RECEIPT }); continue }
          const target = collections.find(x => x.sid === f.to)
          const named = (target?.rows ?? []).filter(x => x.title === item.title)
          if (named.length === 1) out.push(named[0].sid)
          else if (named.length === 0) notRead.push({ what: where, why: NO_TITLE(nameOf.get(f.to) ?? f.to, item.title), at: c.sid, to: f.to, receiptWhy: NO_TITLE_RECEIPT(nameOf.get(f.to) ?? f.to) })
          else notRead.push({ what: where, why: SHARED_TITLE(named.length, nameOf.get(f.to) ?? f.to, item.title), at: c.sid, to: f.to, receiptWhy: SHARED_TITLE_RECEIPT(named.length, nameOf.get(f.to) ?? f.to) })
        }
        r.values[f.id] = out
      }
    }
  }

  notRead.push({ what: 'comments', why: opts.html ? HTML_NOT_BUILT : COMMENTS_NOT_CARRIED })
  const exported = opts.exported ?? (newest > 0 ? new Date(newest).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
  return { ...emptyBundle('notion', exported), pages, collections, notRead }
}

/** The type every cell of a column reads as (§9.4), set on `f`: an authorship column is an author's person field; then
 *  checkbox, number, date, date range (a single date among ranges is a range that starts there), e-mail, URL, relation
 *  (every cell a list of items, one linked at least), phone; a people-shaped column's name makes it a person field; else
 *  text. Select and multi-select are the map's to say. @param {BundleField} f @param {string[]} texts */
function inferField(f, texts) {
  if (AUTHOR.test(f.name.trim())) { f.type = 'person'; f.many = true; f.author = true; return }
  const any = (/** @type {FieldType} */ type) => texts.some(t => !('problem' in parseNotionCell(t, type)))
  const phoneLike = (/** @type {string} */ t) => !('problem' in parseNotionCell(t, 'phone')) && /[ +().-]/.test(t)
  // Contact details (I1, the safe side): a column named for them, or one any of whose cells reads as an e-mail or a phone
  // (with its punctuation), is contact data whatever its other cells hold; they land at defaults.contact.
  const named = PERSONISH.test(f.name.trim()) ? null : contactName(f.name)
  if (named !== null) {
    f.contact = true
    f.type = named === 'contact' ? (any('email') || !texts.some(phoneLike) ? 'email' : 'phone') : named
    return
  }
  if (texts.length === 0) { f.type = PERSONISH.test(f.name.trim()) ? 'person' : 'text'; if (f.type === 'person') f.many = true; return }
  const all = (/** @type {FieldType} */ type) => texts.every(t => !('problem' in parseNotionCell(t, type)))
  for (const type of /** @type {FieldType[]} */ (['checkbox', 'number', 'date'])) if (all(type)) { f.type = type; return }
  if (texts.every(t => !('problem' in parseNotionCell(t, 'daterange')) || !('problem' in parseNotionCell(t, 'date')))) { f.type = 'daterange'; return }
  if (any('email')) { f.type = 'email'; f.contact = true; return }
  if (texts.some(phoneLike)) { f.type = 'phone'; f.contact = true; return }
  if (all('url')) { f.type = 'url'; return }
  if (all('relation') && texts.some(t => /\.md\)/.test(t))) { f.type = 'relation'; return }
  if (PERSONISH.test(f.name.trim())) { f.type = 'person'; f.many = true; return }
  f.type = 'text'
}
