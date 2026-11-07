/** What each governed file is edited with in the Hub (rulings F-L3-3): every registry `lib/registries.mjs` lists, every
 *  file `schemas/change-classes.json` classes, and the instance's own data files outside the registry list. The Hub is
 *  meant to be the one place an org is run from, so no governed file is left out: `editors.test.ts` fails when either
 *  list names something this table does not. The README's "What the Hub edits" is written from it (`editorsMarkdown`). */

/** How a governed file is changed here. */
export type EditPath =
  | 'record'      // the record editor: field rows, plus the whole-entry source editor on the record page
  | 'board'       // arrange and block settings, plus the record page's source editor
  | 'own-routes'  // its own routes, by design
  | 'generated'   // generated, never edited
  | 'none-yet'    // the source editor is L6's: no path in the Hub yet

export interface GovernedFile {
  /** A registry's name (`members`), a path (`IDENTITY.md`) or a path pattern (`.well-known/**`, `data/*.yaml`). */
  target: string
  kind: 'registry' | 'path'
  path: EditPath
  /** What the file is, as a person reads it. */
  what: string
  /** How the Hub edits it, as a person reads it. */
  how: string
}

const RECORD_HOW = 'The record editor: field rows, and the whole-entry source editor on the record page.'
const NONE_YET = 'Read only here. The source editor comes with L6; until then a change to it has no path in the Hub.'

/** The registries edited record by record. */
export const RECORD_REGISTRIES = [
  'members', 'projects', 'meetings', 'ideas', 'funding-opportunities', 'relationships', 'sources', 'events', 'channels',
  'assets', 'knowledge-gaps', 'systems',
] as const

/** The table, in the order the README lists it. */
export const GOVERNED_FILES: readonly GovernedFile[] = [
  ...RECORD_REGISTRIES.map((r): GovernedFile => ({ target: r, kind: 'registry', path: 'record', what: `data/${r}.yaml`, how: RECORD_HOW })),
  { target: 'boards', kind: 'registry', path: 'board', what: 'data/boards.yaml',
    how: 'Arrange and block settings on the board, and the source editor on the record page.' },
  { target: 'proposals', kind: 'registry', path: 'own-routes', what: 'data/proposals.yaml, the proposals ledger',
    how: 'Its own routes, by design: propose, approve, ratify and the rest write it, never an edit.' },
  { target: 'library', kind: 'registry', path: 'own-routes', what: 'data/library.yaml, the library’s receipts',
    how: 'Its own routes, by design: the library’s Add and Remove.' },
  { target: '.well-known/**', kind: 'path', path: 'generated', what: 'the published files under .well-known/',
    how: 'Generated from the data files, never edited (L8’s builder).' },
  { target: 'finances', kind: 'registry', path: 'none-yet', what: 'data/finances.yaml', how: NONE_YET },
  { target: 'governance', kind: 'registry', path: 'none-yet', what: 'data/governance.yaml, the rules',
    how: `${NONE_YET} It is never staged today (R-L5-11.7): a later edit path must run the governance check (§7.6).` },
  { target: 'knowledge-manifest', kind: 'registry', path: 'none-yet', what: 'data/knowledge-manifest.yaml', how: NONE_YET },
  { target: 'visibility', kind: 'registry', path: 'none-yet', what: 'data/visibility.yaml, what is public',
    how: `${NONE_YET} Narrowing a record has its own route (L5); widening one is a publication, decided as a proposal.` },
  { target: 'data/*.yaml', kind: 'path', path: 'none-yet',
    what: 'an instance’s own data files outside the registry list, such as data/horizon.yaml and data/access-grants.yaml',
    how: `${NONE_YET} Rules govern each as a record of the org.` },
  { target: 'IDENTITY.md', kind: 'path', path: 'none-yet', what: 'IDENTITY.md', how: NONE_YET },
  { target: 'federation.yaml', kind: 'path', path: 'none-yet', what: 'federation.yaml', how: NONE_YET },
]

/** What a registry page says of a file with no path in the Hub yet (a document registry, F-L3-3). */
export const READ_ONLY_HERE = 'Read only here: a change to this file has no path in the Hub yet.'

const matches = (pattern: string, path: string) =>
  pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : pattern === 'data/*.yaml' ? /^data\/[^/]+\.ya?ml$/.test(path) : pattern === path

/** The table's row for a registry, or for a file by its path (`data/<registry>.yaml` is its registry's row). Null for a
 *  file that is not governed (a script, a note). */
export function editorOf(target: { registry: string } | { path: string }): GovernedFile | null {
  if ('registry' in target) return GOVERNED_FILES.find(f => f.kind === 'registry' && f.target === target.registry) ?? null
  const path = target.path.replace(/^\.\//, '')
  const registry = /^data\/([^/]+)\.ya?ml$/.exec(path)?.[1]
  const own = registry === undefined ? null : editorOf({ registry })
  return own ?? GOVERNED_FILES.find(f => f.kind === 'path' && f.target !== 'data/*.yaml' && matches(f.target, path))
    ?? (registry !== undefined ? GOVERNED_FILES.find(f => f.target === 'data/*.yaml')! : null)
}

/** What the two lists name that the table leaves out: a registry (by name) or a change-classes row (a registry, a path,
 *  or `*`, the files outside the registry list). Empty when every governed file has its row. */
export function leftOut(registries: readonly string[], classRows: readonly { registry?: string; path?: string }[]): string[] {
  const has = (kind: GovernedFile['kind'], target: string) => GOVERNED_FILES.some(f => f.kind === kind && f.target === target)
  const out = registries.filter(r => !has('registry', r)).map(r => `registry ${r}`)
  for (const row of classRows) {
    if (row.path !== undefined && !has('path', row.path)) out.push(`path ${row.path}`)
    if (row.registry === '*' && !has('path', 'data/*.yaml')) out.push('the files outside the registry list (data/*.yaml)')
    else if (row.registry !== undefined && row.registry !== '*' && !has('registry', row.registry)) out.push(`registry ${row.registry}`)
  }
  return [...new Set(out)]
}

/** The README's "What the Hub edits": the table as Markdown, a row per way of editing. */
export function editorsMarkdown(): string {
  const groups = new Map<string, GovernedFile[]>()
  for (const f of GOVERNED_FILES) groups.set(f.how, [...(groups.get(f.how) ?? []), f])
  const rows = [...groups.entries()].map(([how, files]) => `| ${files.map(f => f.what).join('; ')} | ${how} |`)
  return ['| File | How the Hub edits it |', '|---|---|', ...rows].join('\n')
}
