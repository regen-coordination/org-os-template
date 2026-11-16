// packages/admin/lib/workspace/editors.mjs
//
// Every governed file has a path (DAO-OS L6 spec §11.1, F-L3-3): which editor writes each file a rule can govern, one row
// per pattern, first match wins. `record` is the record editor (collection views for the workspace's); `page` the page
// editor; `<x>+source` an editor of its own for part of the file and the source editor for the whole of it; `source` the
// source editor alone (a `file` op, §11.2); `board` the board arrange; `library` the library's Add and Remove only;
// `knowledge` the commons' entry page only (ruling PF-R1: the canon has no `file` op, so publishing is judged where it is);
// `generated` none by hand (`.well-known/` is generated from the records); `ledger` the proposal routes only; `ratify`
// written by ratify only. Pure and import-free of the server, so the client and the root scripts can read it.
//
//   EDITORS          → the table: { pattern, class, editor } (class as schemas/change-classes.json gives it; null: none)
//   editorFor(path)  → the editor of a path, or null for a path no rule governs

/** @typedef {'record' | 'page' | 'rules+source' | 'visibility+source' | 'collections+source' | 'source' | 'board' | 'library' | 'knowledge' | 'generated' | 'ledger' | 'ratify'} EditorKind */
/** @typedef {{ pattern: string, class: string | null, editor: EditorKind }} EditorRow */

/** @param {string} pattern @param {string | null} cls @param {EditorKind} editor @returns {EditorRow} */
const row = (pattern, cls, editor) => Object.freeze({ pattern, class: cls, editor })

/** The record editor's registries of class `records` (spec §11.1, second row). */
const RECORDS = ['projects', 'ideas', 'funding-opportunities', 'relationships', 'sources', 'events', 'channels', 'assets', 'knowledge-gaps']

/** @type {readonly EditorRow[]} */
export const EDITORS = Object.freeze([
  row('.well-known/**', 'identity', 'generated'),
  row('data/proposals.yaml', null, 'ledger'),
  row('DECISIONS.md', null, 'ratify'),
  row('data/members.yaml', 'members', 'record'),
  ...RECORDS.map(name => row(`data/${name}.yaml`, 'records', 'record')),
  row('data/tasks.yaml', 'workspace', 'record'),
  row('data/meetings.yaml', 'workspace', 'record'),
  row('data/collections/**', 'workspace', 'record'),
  row('data/kb/**', 'workspace', 'knowledge'),
  row('data/systems.yaml', 'systems', 'record'),
  row('data/boards.yaml', 'records', 'board'),
  row('data/library.yaml', 'records', 'library'),
  row('data/governance.yaml', 'governance', 'rules+source'),
  row('data/visibility.yaml', 'publication', 'visibility+source'),
  row('data/collections.yaml', 'workspace', 'collections+source'),
  row('data/finances.yaml', 'records', 'source'),
  row('data/knowledge-manifest.yaml', 'records', 'source'),
  row('data/imports.yaml', 'workspace', 'source'),
  row('IDENTITY.md', 'identity', 'source'),
  row('federation.yaml', 'identity', 'source'),
  row('pages/**', 'workspace', 'page'),
  row('memory/**', 'workspace', 'source'),
  row('MEMORY.md', 'workspace', 'source'),
  row('HEARTBEAT.md', 'workspace', 'source'),
  row('docs/plans/**', 'workspace', 'source'),
  row('docs/agent-plans/**', 'workspace', 'source'),
  // Any other data file an instance keeps (horizon.yaml, access-grants.yaml, council.yaml, …): the `*` row's records.
  row('data/*.yaml', 'records', 'source'),
  row('data/*.yml', 'records', 'source'),
])

/** `./x`, `a//b` and `a/./b` read as the plain path; a path that climbs (`..`) or is absolute matches no row.
 *  @param {string} path @returns {string | null} */
function plain(path) {
  if (typeof path !== 'string' || path === '') return null
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (p.startsWith('/')) return null
  const segs = p.split('/').filter(s => s !== '' && s !== '.')
  if (segs.length === 0 || segs.includes('..')) return null
  return segs.join('/')
}

/** A row's pattern: exact; `<dir>/**` for everything under <dir>; `<dir>/*.<ext>` for a file directly in <dir>.
 *  @param {string} pattern @param {string} path */
function matches(pattern, path) {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -2)) && path.length > pattern.length - 2
  const star = pattern.indexOf('*')
  if (star < 0) return path === pattern
  const head = pattern.slice(0, star)
  const tail = pattern.slice(star + 1)
  if (!path.startsWith(head) || !path.endsWith(tail) || path.length <= head.length + tail.length) return false
  return !path.slice(head.length, path.length - tail.length).includes('/')
}

/** The table's row for `path`, or null. @param {string} path @returns {EditorRow | null} */
export function editorRowFor(path) {
  const p = plain(path)
  if (p === null) return null
  return EDITORS.find(r => matches(r.pattern, p)) ?? null
}

/** The editor of `path` (spec §11.1), or null for a path no rule governs.
 *  @param {string} path @returns {EditorKind | null} */
export function editorFor(path) {
  return editorRowFor(path)?.editor ?? null
}

// ── the files no `file` op writes (§11.2; PF-R1), in the words the server refuses one with ─────────────────────────────
// Here, not in server/workspace/files.ts, so the source editor (DAO-OS L6 Task 19) says the server's own sentence.

export const GENERATED = '.well-known/ is generated from the records (npm run generate:schemas): change the records instead. Nothing was staged.'
export const LEDGER_FILE = 'data/proposals.yaml is written by the proposal routes only (Propose, and the buttons on a proposal), never edited whole. Nothing was staged.'
export const RATIFY_FILE = 'DECISIONS.md is written by ratify only, when a proposal that carries a statement is ratified. Nothing was staged.'
/** Ruling PF-R1 (review C-1): a file op judges the canon at its own targets only, never by kms's publishability floor (Q-1). */
export const CANON_FILE = 'The knowledge canon is edited on its entry page in the commons, where publishing is judged. Nothing was staged.'

/** The sentence a `file` op on a file of this editor is refused with whatever its text, or null when the editor's
 *  files can be written whole. @param {EditorKind | string | null} editor @returns {string | null} */
export function wholeFileRefusal(editor) {
  if (editor === 'generated') return GENERATED
  if (editor === 'ledger') return LEDGER_FILE
  if (editor === 'ratify') return RATIFY_FILE
  if (editor === 'knowledge') return CANON_FILE
  return null
}
