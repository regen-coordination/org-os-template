// DAO-OS L6 Task 19: the source editor's addresses and words (spec §11, §15). Every governed file has a path (F-L3-3):
// `/files/<path>` opens a file whole; each row of the editor table (GET /api/editors) links to the editor it names.
// Pure: no React, no fetch.
import { wholeFileRefusal } from '../../../lib/workspace/editors.mjs'
import { safeDecode } from '../hrefs.ts'

export { wholeFileRefusal }

/** The editors a file is written whole with here (§11.1: the source editor, alone or beside an editor of its own). */
export const WRITES_WHOLE: ReadonlySet<string> = new Set(['source', 'rules+source', 'visibility+source', 'collections+source'])

/** `/files/<path>`, each segment encoded; a path ending in `/` (a folder) keeps it, and opens the path field there. */
export function filesHref(path: string): string {
  return `/files/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** Where a staged file op opens from the tray: a page at its page, any other file in the source editor. */
export function fileOpHref(path: string): string {
  const page = /^pages\/([^/]+)\.md$/.exec(path)?.[1]
  return page ? `/p/${encodeURIComponent(page)}` : filesHref(path)
}

/** The path `/files/*` names: each segment decoded, a leading `./` or `/` dropped. */
export function filesPathOf(splat: string | undefined): string {
  return (splat ?? '').split('/').map(safeDecode).join('/').replace(/^(\.\/|\/)+/, '')
}

/** Each editor in a person's words (§11.1). */
export const EDITOR_WORDS: Record<string, string> = {
  record: 'Record editor',
  page: 'Page editor',
  'rules+source': 'Rules page, and the source editor for the whole file',
  'visibility+source': 'Visibility controls, and the source editor for the whole file',
  'collections+source': 'Collection settings, and the source editor for the whole file',
  source: 'Source editor',
  board: 'Board arrange',
  library: 'The library’s Add and Remove',
  knowledge: 'The commons’ entry page',
  generated: 'Generated from the records, never edited',
  ledger: 'The proposal routes',
  ratify: 'Ratify, when a proposal is ratified',
}
export const editorWords = (editor: string): string => EDITOR_WORDS[editor] ?? editor

/** A row's pattern as the folder or file the source editor opens: `memory/**` → `memory/`, `data/*.yaml` → `data/`. */
const openable = (pattern: string): string => {
  if (pattern.endsWith('/**')) return pattern.slice(0, -2)
  const star = pattern.indexOf('*')
  return star < 0 ? pattern : pattern.slice(0, pattern.lastIndexOf('/', star) + 1)
}

/** The registry whose records a `data/<name>.yaml` row holds. */
const registryOf = (pattern: string): string | null => /^data\/([^/*]+)\.ya?ml$/.exec(pattern)?.[1] ?? null

/** Where a record editor's records are opened: a Hub collection at /c/<id>, the Systems at /systems, any other
 *  registry's list at /all/<name>; the org's own collections from /workspace. */
function recordPlace(pattern: string): string {
  const name = registryOf(pattern)
  if (name === 'tasks' || name === 'meetings') return `/c/${name}`
  if (name === 'systems') return '/systems'
  return name === null ? '/workspace' : `/all/${encodeURIComponent(name)}`
}

/** Where the editor a row names is (the F-L3-3 link): the source editor at /files/<path or folder>; any other editor
 *  at its own page. A generated file opens in the source editor too, which says why it is never edited. */
export function editorHref(row: { pattern: string; editor: string }): string {
  switch (row.editor) {
    case 'record': return recordPlace(row.pattern)
    case 'page': return '/workspace'
    case 'board': return '/boards'
    case 'library': return '/library'
    case 'knowledge': return '/c/knowledge'
    case 'ledger': return '/governance/proposals'
    case 'ratify': return '/governance/decisions'
    default: return filesHref(openable(row.pattern))
  }
}

/** The editor of its own a file has beside the source editor, or in its place (the file page links to it): null for
 *  the source editor alone and a generated file. */
export function ownEditor(path: string, editor: string): { href: string; label: string } | null {
  switch (editor) {
    case 'rules+source': return { href: '/governance/rules', label: 'Open the Rules' }
    case 'collections+source': return { href: '/workspace', label: 'Open the collections' }
    case 'record': return { href: recordPlace(path), label: 'Open its records' }
    case 'page': {
      const id = /^pages\/([^/]+)\.md$/.exec(path)?.[1]
      return { href: id ? `/p/${encodeURIComponent(id)}` : '/workspace', label: id ? 'Open the page' : 'Open the pages' }
    }
    case 'board': return { href: '/boards', label: 'Open the boards' }
    case 'library': return { href: '/library', label: 'Open the library' }
    case 'knowledge': return { href: '/c/knowledge', label: 'Open the commons' }
    case 'ledger': return { href: '/governance/proposals', label: 'Open the proposals' }
    case 'ratify': return { href: '/governance/decisions', label: 'Open the decisions' }
    default: return null
  }
}

/** What the file page says of a file the table gives an editor of its own and no source editor (ruling PF-R78): it is
 *  read here and written there. */
export const READ_HERE = (path: string, editor: string): string =>
  `${path} is written with the ${editorWords(editor).toLowerCase()}, not whole here: it is read here only.`
/** A staged file op on the file, as the page says it. */
export const STAGED_WHOLE = 'Staged in your change: the file is written whole when the change is applied.'
export const STAGED_DELETE = 'Staged in your change: the file is deleted when the change is applied.'
export const NO_FILE_YET = (path: string): string => `There is no ${path} yet.`
