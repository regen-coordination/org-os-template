/** What each governed file is edited with in the Hub (rulings F-L3-3): every registry `lib/registries.mjs` lists, every
 *  file `schemas/change-classes.json` classes, and the instance's own data files outside the registry list. The Hub is
 *  meant to be the one place an org is run from, so no governed file is left out: `editors.test.ts` fails when either
 *  list names something this table does not. The README's "What the Hub edits" is written from it (`editorsMarkdown`). */

/** How a governed file is changed here. */
export type EditPath =
  | 'record'      // the record editor: field rows, plus the whole-entry source editor on the record page
  | 'page'        // the page editor (DAO-OS L6 §10): a page edited in place, one commit per editing session
  | 'board'       // arrange and block settings, plus the record page's source editor
  | 'own-routes'  // its own routes, by design
  | 'generated'   // generated, never edited
  | 'source'      // the source editor (DAO-OS L6 Task 19, `/files/<path>`): the file edited whole, staged as one file op

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
const SOURCE_HOW = 'The source editor (/files/<path>): the file edited whole, staged into your change, checked when staged and again when applied.'

/** The registries edited record by record. */
export const RECORD_REGISTRIES = [
  'members', 'projects', 'meetings', 'ideas', 'funding-opportunities', 'relationships', 'sources', 'events', 'channels',
  'assets', 'knowledge-gaps', 'systems', 'tasks',
] as const

/** The workspace's agent layer (DAO-OS L6 §16): written by the agents' own tools, read in the Hub. */
const AGENT_LAYER = ['memory/**', 'MEMORY.md', 'HEARTBEAT.md', 'docs/plans/**', 'docs/agent-plans/**'] as const

/** The table, in the order the README lists it. */
export const GOVERNED_FILES: readonly GovernedFile[] = [
  ...RECORD_REGISTRIES.map((r): GovernedFile => ({ target: r, kind: 'registry', path: 'record', what: `data/${r}.yaml`, how: RECORD_HOW })),
  { target: 'boards', kind: 'registry', path: 'board', what: 'data/boards.yaml',
    how: 'Arrange and block settings on the board, and the source editor on the record page.' },
  { target: 'proposals', kind: 'registry', path: 'own-routes', what: 'data/proposals.yaml, the proposals ledger',
    how: 'Its own routes, by design: propose, approve, ratify and the rest write it, never an edit.' },
  { target: 'library', kind: 'registry', path: 'own-routes', what: 'data/library.yaml, the library’s receipts',
    how: 'Its own routes, by design: the library’s Add and Remove.' },
  { target: 'data/kb/**', kind: 'path', path: 'own-routes', what: 'data/kb/, the knowledge commons’ canon',
    how: 'Its own routes: the commons’ entry page prepares an edit and applies it in one commit, under the org’s rules.' },
  { target: 'pages/**', kind: 'path', path: 'page', what: 'pages/, the workspace’s pages',
    how: 'The page editor: a page is written in place, one commit per editing session; Suggest makes the edit a proposal.' },
  { target: 'data/collections/**', kind: 'path', path: 'record', what: 'data/collections/, the records of the org’s own collections',
    how: 'The collection’s views and the record editor.' },
  { target: '.well-known/**', kind: 'path', path: 'generated', what: 'the published files under .well-known/',
    how: 'Generated from the data files, never edited (L8’s builder).' },
  { target: 'finances', kind: 'registry', path: 'source', what: 'data/finances.yaml', how: SOURCE_HOW },
  { target: 'governance', kind: 'registry', path: 'source', what: 'data/governance.yaml, the rules',
    how: `${SOURCE_HOW} The governance check (§7.6) runs on it, so a text that would lock the org out is refused; the Rules page reads it. Its \`roles\` and \`rules\` are also a record of the change engine, \`governance:governance\` (see Governance below): a rule set's add writes them that way.` },
  { target: 'knowledge-manifest', kind: 'registry', path: 'source', what: 'data/knowledge-manifest.yaml', how: SOURCE_HOW },
  { target: 'visibility', kind: 'registry', path: 'source', what: 'data/visibility.yaml, what is public',
    how: `${SOURCE_HOW} Narrowing a record has its own route (L5); a text that widens what is public is a publication.` },
  { target: 'data/*.yaml', kind: 'path', path: 'source',
    what: 'an instance’s own data files outside the registry list, such as data/horizon.yaml and data/access-grants.yaml',
    how: `${SOURCE_HOW} Rules govern each as a record of the org.` },
  { target: 'collections', kind: 'registry', path: 'source', what: 'data/collections.yaml, the collections and their saved views',
    how: `${SOURCE_HOW} New collection and Save view on the Workspace write their definitions through their own routes.` },
  { target: 'data/imports.yaml', kind: 'path', path: 'source', what: 'data/imports.yaml, the imports’ record', how: SOURCE_HOW },
  ...AGENT_LAYER.map((t): GovernedFile => ({ target: t, kind: 'path', path: 'source', what: t,
    how: `${SOURCE_HOW} The agents’ own tools commit it too. A viewer signed in to the Hub reads it only when they decide under its workspace rule (0.7.1).` })),
  { target: 'IDENTITY.md', kind: 'path', path: 'source', what: 'IDENTITY.md', how: SOURCE_HOW },
  { target: 'federation.yaml', kind: 'path', path: 'source', what: 'federation.yaml', how: SOURCE_HOW },
]

const matches = (pattern: string, path: string) =>
  pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : pattern === 'data/*.yaml' ? /^data\/[^/]+\.ya?ml$/.test(path) : pattern === path

/** The table's row for a registry, or for a file by its path (`data/<registry>.yaml` is its registry's row). Null for a
 *  file that is not governed (a script, a note). */
export function editorOf(target: { registry: string } | { path: string }): GovernedFile | null {
  // A registry whose row is by its file's path (data/imports.yaml) is found there.
  if ('registry' in target) {
    return GOVERNED_FILES.find(f => f.kind === 'registry' && f.target === target.registry)
      ?? GOVERNED_FILES.find(f => f.kind === 'path' && f.target === `data/${target.registry}.yaml`) ?? null
  }
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
  // A registry whose row is by its file's path (data/imports.yaml) has its row.
  const hasRegistry = (r: string) => has('registry', r) || has('path', `data/${r}.yaml`)
  const out = registries.filter(r => !hasRegistry(r)).map(r => `registry ${r}`)
  for (const row of classRows) {
    if (row.path !== undefined && !has('path', row.path)) out.push(`path ${row.path}`)
    if (row.registry === '*' && !has('path', 'data/*.yaml')) out.push('the files outside the registry list (data/*.yaml)')
    else if (row.registry !== undefined && row.registry !== '*' && !hasRegistry(row.registry)) out.push(`registry ${row.registry}`)
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
