// packages/admin/lib/imports/notion-csv.mjs
//
// Notion's CSV and its cells (DAO-OS L6 spec §9.4): a database's CSV read as rows of text (RFC 4180: quoted cells, a
// doubled quote, a line break inside quotes, a byte-order mark), and one cell read in the forms Notion writes: dates in
// English (`October 29, 2026`, with a time, and `A → B` ranges), checkboxes (`Yes`/`No`), multi-select and people
// (comma-separated; a list of e-mails or phones too), relations (`Title (path%20<32hex>.md)` items, or a title alone), URLs, e-mails, phones and numbers.
// Anything else is text; a cell that does not read as the type asked is a problem, never a guess. Pure.

/** @typedef {import('../workspace/collections.mjs').FieldType} FieldType */

/** A CSV text as rows of cells. @param {string} text @returns {string[][]} */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  /** @type {string[][]} */
  const rows = []
  /** @type {string[]} */
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
      continue
    }
    if (c === '"' && cell === '') quoted = true
    else if (c === ',') { row.push(cell); cell = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DATE = /^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2})(?: ?([AP]M))?)?(?: \(([^)]*)\))?$/i
const RANGE = ' → '
const EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/
const URL_RE = /^https?:\/\/[^\s]+$/
const PHONE = /^\+?[0-9][0-9 ().-]{6,}[0-9]$/
const NUMBER = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
/** One relation item as Notion writes it: a title, then its file in parentheses, the 32-hex id before `.md`. */
const ITEM = /^(.*?) \(([^()\s]*?([0-9a-f]{32})\.md)\)(?:, |$)/

const two = (/** @type {number} */ n) => String(n).padStart(2, '0')

/** An English Notion date: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM` with a time; null when it is not one.
 *  @param {string} text @returns {string | null} */
function readDate(text) {
  const m = DATE.exec(text.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  const day = Number(m[2]), year = Number(m[3])
  if (month < 0 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month, day))
  if (d.getUTCMonth() !== month) return null
  const date = `${year}-${two(month + 1)}-${two(day)}`
  if (m[4] === undefined) return date
  let hour = Number(m[4])
  const minute = Number(m[5])
  if (minute > 59) return null
  if (m[6] !== undefined) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0)
  } else if (hour > 23) return null
  return `${date}T${two(hour)}:${two(minute)}`
}

/** A comma-separated list, each item trimmed, none empty. @param {string} text */
const listOf = text => text.split(',').map(s => s.trim()).filter(s => s !== '')

/** Relation items: each `Title (path.md)` with its id; a cell with no link at all is a list of titles alone. Null when a
 *  cell mixes linked items with text that is neither. @param {string} text */
function readRelation(text) {
  /** @type {{ title: string, sid: string | null }[]} */
  const items = []
  let rest = text.trim()
  if (!ITEM.test(rest)) return /[()]/.test(rest) ? null : listOf(rest).map(title => ({ title, sid: null }))
  while (rest !== '') {
    const m = ITEM.exec(rest)
    if (!m) return null
    items.push({ title: m[1].trim(), sid: m[3] })
    rest = rest.slice(m[0].length)
  }
  return items
}

/**
 * One cell read (§9.4). With `type`, as that type, or `{ problem }` when it does not read as one; without, the first form
 * it reads as: checkbox, number, date or date range, e-mail, URL, a relation (linked items only), phone, else text. An
 * empty cell is null of the type asked (text when none). A date with a time is `YYYY-MM-DDTHH:MM` (the plan keeps the day
 * of a `date` field and reports the time).
 * @param {string} text @param {FieldType} [type]
 * @returns {{ value: unknown, type: FieldType } | { problem: string }}
 */
export function parseNotionCell(text, type) {
  const t = String(text ?? '').trim()
  if (t === '') return { value: null, type: type ?? 'text' }
  /** @param {string} why */
  const no = why => ({ problem: `"${t}" ${why}` })
  if (type === undefined) {
    for (const guess of /** @type {FieldType[]} */ (['checkbox', 'number', 'date', 'daterange', 'email', 'url'])) {
      const read = parseNotionCell(t, guess)
      if (!('problem' in read)) return read
    }
    if (ITEM.test(t)) { const r = readRelation(t); if (r) return { value: r, type: 'relation' } }
    if (PHONE.test(t) && /[ +().-]/.test(t)) return { value: t, type: 'phone' }
    return { value: t, type: 'text' }
  }
  switch (type) {
    case 'checkbox': return t === 'Yes' ? { value: true, type } : t === 'No' ? { value: false, type } : no('is not Yes or No')
    case 'number': return NUMBER.test(t) ? { value: Number(t.replace(/,/g, '')), type } : no('is not a number')
    case 'date': {
      if (t.includes(RANGE)) return no('is a range of dates, not one date')
      const d = readDate(t)
      return d ? { value: d, type } : no('is not a date in English')
    }
    case 'daterange': {
      const [a, b, ...more] = t.split(RANGE)
      if (b === undefined || more.length > 0) return no('is not a range of dates (A → B)')
      const start = readDate(a ?? ''), end = readDate(b)
      return start && end ? { value: { start, end }, type } : no('is not a range of dates in English')
    }
    case 'email': return EMAIL.test(t) ? { value: t, type } : listOf(t).length > 1 && listOf(t).every(x => EMAIL.test(x)) ? { value: listOf(t), type } : no('is not an e-mail address')
    case 'url': return URL_RE.test(t) ? { value: t, type } : no('is not a web address')
    case 'phone': return PHONE.test(t) ? { value: t, type } : listOf(t).length > 1 && listOf(t).every(x => PHONE.test(x)) ? { value: listOf(t), type } : no('is not a phone number')
    case 'multiselect': case 'person': return { value: listOf(t), type }
    case 'relation': case 'page': {
      const r = readRelation(t)
      return r ? { value: r, type } : no('is not a list of linked pages')
    }
    default: return { value: t, type }
  }
}
