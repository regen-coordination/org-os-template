// packages/admin/lib/decision-write.mjs
//
// The text splices of a ratified, rejected or expired proposal: a row in `governance.yaml`'s
// `decisions` list and an entry in `DECISIONS.md` (P2 spec §3.9).
//
// Every function takes text and returns the complete new text, or a sentence refusing. None
// reads a file, runs git, or knows a revision: the caller passes the text of the tree-to-be
// (`git show <C>:<file>`), because a file an op also edits differs in HEAD and in the merge
// (the second review's N1). That is what lets ratify compute and check every splice before it
// touches the working tree.

import { parseAllDocuments } from 'yaml'

/** @typedef {{ ok: true, text: string } | { ok: false, reason: string }} Spliced */
/**
 * @typedef {object} DecisionRow
 * @property {string} id @property {string} proposal @property {string} rule @property {string} method
 * @property {string} outcome @property {string} status @property {string[]} by @property {string} date @property {string} title
 * @property {string} summary
 */

/** `status` equals `outcome`: the governance schema requires it of every row, and the Governance page groups by it. */
const ROW_KEYS = ['id', 'proposal', 'rule', 'method', 'outcome', 'status', 'by', 'date', 'title', 'summary']

/** @param {string} reason @returns {{ ok: false, reason: string }} */
const refuse = reason => ({ ok: false, reason })

/** The next `gov-<yyyymmdd>-<NNN>` for `date` (`YYYY-MM-DD`), counted among that day's rows.
 *  @param {readonly { id?: unknown }[]} rows @param {string} date */
export function nextDecisionId(rows, date) {
  const prefix = `gov-${date.replace(/-/g, '')}-`
  let top = 0
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : ''
    if (!id.startsWith(prefix)) continue
    const n = Number(id.slice(prefix.length))
    if (Number.isInteger(n) && n > top) top = n
  }
  return `${prefix}${String(top + 1).padStart(3, '0')}`
}

const eolOf = (/** @type {string} */ text) => (text.includes('\r\n') ? '\r\n' : '\n')
const indentOf = (/** @type {string} */ line) => line.length - line.trimStart().length
/** A line that holds YAML content: not blank, not a comment. */
const isContent = (/** @type {string} */ line) => { const t = line.trim(); return t !== '' && !t.startsWith('#') }

/** One row as block YAML lines, its `- ` at `dash` spaces. Strings are double-quoted (JSON is YAML).
 *  @param {DecisionRow} row @param {number} dash */
function rowLines(row, dash) {
  const pad = ' '.repeat(dash)
  const rest = ' '.repeat(dash + 2)
  return ROW_KEYS.map((key, i) => {
    const value = /** @type {Record<string, unknown>} */ (row)[key]
    return `${i === 0 ? `${pad}- ` : rest}${key}: ${JSON.stringify(value)}`
  })
}

/**
 * Insert `row` into the `decisions` list inside the `governance:` block, as text. Every other
 * byte, comment and line ending is kept; the result is re-parsed and must equal the original
 * plus the row, else nothing is returned but a sentence.
 * @param {string} text @param {DecisionRow} row @returns {Spliced}
 */
export function insertDecisionRow(text, row) {
  const hand = `Add this row to data/governance.yaml under governance.decisions by hand: ${JSON.stringify(row)}`
  const docs = parseAllDocuments(text)
  if (docs.length !== 1) return refuse(`data/governance.yaml holds ${docs.length} YAML documents; the decision row is written into a file of one. ${hand}`)
  if (docs[0].errors.length > 0) return refuse(`data/governance.yaml does not parse (${docs[0].errors[0].message.split('\n')[0]}). ${hand}`)
  const before = docs[0].toJS()
  const wrapper = before?.governance
  if (typeof wrapper !== 'object' || wrapper === null || Array.isArray(wrapper)) {
    return refuse(`data/governance.yaml has no governance: block, so the decision row has nowhere to go. ${hand}`)
  }
  if (wrapper.decisions !== undefined && !Array.isArray(wrapper.decisions)) {
    return refuse(`governance.decisions in data/governance.yaml is not a list. ${hand}`)
  }

  const eol = eolOf(text)
  const lines = text.split(eol)
  const start = lines.findIndex(l => /^governance:\s*(#.*)?$/.test(l.trimEnd()))
  if (start < 0) return refuse(`data/governance.yaml writes its governance: block in a style this writer will not edit (flow style or an anchor). ${hand}`)
  let end = start
  for (let i = start + 1; i < lines.length; i++) {
    if (isContent(lines[i]) && indentOf(lines[i]) === 0) break
    if (isContent(lines[i])) end = i
  }
  // The block's keys sit at the indent of its first content line.
  const first = lines.slice(start + 1, end + 1).find(isContent)
  if (first === undefined) return refuse(`The governance: block in data/governance.yaml is empty. ${hand}`)
  const keyIndent = indentOf(first)

  const keyAt = lines.findIndex((l, i) => i > start && i <= end && indentOf(l) === keyIndent && /^decisions:/.test(l.trimStart()))
  /** @type {string[]} */
  let out
  if (keyAt < 0) {
    out = [...lines.slice(0, end + 1), `${' '.repeat(keyIndent)}decisions:`, ...rowLines(row, keyIndent + 2), ...lines.slice(end + 1)]
  } else {
    const after = lines[keyAt].trimStart().slice('decisions:'.length).replace(/\s+#.*$/, '').trim()
    if (after === '[]') {
      out = [...lines.slice(0, keyAt), `${' '.repeat(keyIndent)}decisions:`, ...rowLines(row, keyIndent + 2), ...lines.slice(keyAt + 1)]
    } else if (after !== '') {
      return refuse(`governance.decisions in data/governance.yaml is written in flow style, which this writer will not edit. ${hand}`)
    } else {
      // The list ends at the last content line that still belongs to it.
      let last = keyAt
      let dash = keyIndent + 2
      let seen = false
      for (let i = keyAt + 1; i <= end; i++) {
        if (!isContent(lines[i])) continue
        const ind = indentOf(lines[i])
        const t = lines[i].trimStart()
        if (ind < keyIndent || (ind === keyIndent && !t.startsWith('- '))) break
        if (!seen && t.startsWith('- ')) { dash = ind; seen = true }
        last = i
      }
      out = [...lines.slice(0, last + 1), ...rowLines(row, dash), ...lines.slice(last + 1)]
    }
  }
  const result = out.join(eol)

  // The proof: the result is the original plus the row, and nothing else.
  const expected = structuredClone(before)
  expected.governance.decisions = [...(expected.governance.decisions ?? []), JSON.parse(JSON.stringify(row))]
  const reparsed = parseAllDocuments(result)
  const same = reparsed.length === 1 && reparsed[0].errors.length === 0 && JSON.stringify(sorted(reparsed[0].toJS())) === JSON.stringify(sorted(expected))
  if (!same) return refuse(`Writing the decision row would not leave data/governance.yaml as it was plus the row, so nothing was written. ${hand}`)
  return { ok: true, text: result }
}

/** Key-sorted copy, so two parses compare by value. @param {unknown} v @returns {unknown} */
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(/** @type {any} */ (v)[k])]))
  return v
}

/**
 * @typedef {object} DecisionEntry
 * @property {string} date `YYYY-MM-DD`  @property {string} title  @property {string} scope
 * @property {string} decision  @property {string} why  @property {string} proposal  @property {string} decisionId
 */

/**
 * Add the entry as the newest section of `DECISIONS.md`: directly after the closing `---` of the
 * Conventions block, in the file's own id scheme (`LD-2026-035` is followed by `LD-2026-036`).
 * A file whose structure it does not recognise is refused with what to add; it never guesses.
 * @param {string} text @param {DecisionEntry} entry @returns {Spliced}
 */
export function insertDecisionsMdEntry(text, entry) {
  // An entry is one heading and its body up to a `---` line. A field that would write another heading or another rule
  // would make the file read as more than one entry, or end this one early (final review M3): refused, in words.
  for (const [field, value] of /** @type {const} */ ([['title', entry.title], ['scope', entry.scope]])) {
    if (/[\r\n]/.test(String(value))) return refuse(`The statement's ${field} is written on the entry's heading line, so it must be one line; this one holds a line break. Nothing was written.`)
  }
  for (const [field, value] of /** @type {const} */ ([['decision', entry.decision], ['why', entry.why]])) {
    for (const line of String(value).split(/\r?\n/)) {
      const t = line.trimStart()
      if (/^##\s/.test(t) || t === '##') return refuse(`The statement's ${field} has a line that begins "## ", which would start an entry of its own in DECISIONS.md. Write that line another way. Nothing was written.`)
      if (/^#{1,6}(\s|$)/.test(t)) return refuse(`The statement's ${field} has a line that is a Markdown heading ("${t.slice(0, 40)}"), which would break the entry in DECISIONS.md. Write that line another way. Nothing was written.`)
      if (/^-{3,}\s*$/.test(t)) return refuse(`The statement's ${field} has a "---" line, which ends an entry in DECISIONS.md. Write that line another way. Nothing was written.`)
    }
  }
  const eol = eolOf(text)
  const lines = text.split(eol)
  const conv = lines.findIndex(l => /^##\s+Conventions\s*$/.test(l.trimEnd()))
  if (conv < 0) return refuse('DECISIONS.md has no "## Conventions" block, so the entry has no place to follow. Add the Conventions block and a --- line after it, or write the entry by hand.')
  const rule = lines.findIndex((l, i) => i > conv && l.trimEnd() === '---')
  if (rule < 0) return refuse('DECISIONS.md has no --- line after its Conventions block, so the entry has no place to go. Add one, or write the entry by hand.')

  const newest = lines.slice(rule + 1).find(l => /^##\s/.test(l))
  const id = nextHeadingId(newest)
  const heading = id ? `## ${entry.date} · ${id} — ${entry.title}` : `## ${entry.date} — ${entry.title}`
  const body = [
    heading, '',
    '**Status:** active',
    `**Scope:** ${entry.scope}`, '',
    `**Decision** — ${entry.decision}`, '',
    `**Why** — ${entry.why}`, '',
    `**Refs** — proposal ${entry.proposal}, decision ${entry.decisionId} in data/governance.yaml`,
  ]
  const out = [...lines.slice(0, rule + 1), '', ...body, '', '---', ...lines.slice(rule + 1)]
  return { ok: true, text: out.join(eol) }
}

/** The id after the one in the newest heading (`## 2026-10-16 · LD-2026-035 — …`), or null when it has none.
 *  @param {string | undefined} heading @returns {string | null} */
function nextHeadingId(heading) {
  const m = heading?.match(/^##\s+\S+\s+·\s+([A-Za-z][A-Za-z0-9]*(?:-\d+)*?)-(\d+)(?=\s+[—-]|\s*$)/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`
}
