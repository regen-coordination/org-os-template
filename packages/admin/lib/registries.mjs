// packages/admin/lib/registries.mjs
//
// The one list of registries (architecture §4.1). It lives here, in plain
// JavaScript, so that the root scripts (`validate:data`) read the same list as
// the server; server/registries.ts re-exports it with its TypeScript types.

/** @typedef {'collection'|'document'} RegistryKind */
/**
 * @typedef {object} RegistryDef
 * @property {string} name      filename without .yaml, used in URLs
 * @property {string} topKey    canonical top-level YAML key (used when creating the block)
 * @property {string[]} [aliases] other keys real instances use for the same block
 * @property {RegistryKind} kind
 * @property {boolean} [ledger] written only by its own routes (P2): the change engine refuses to stage an op on it
 * @property {string} [file]    the file it is written in, from the repository's root (default `data/<name>.yaml`; L6 §7.1)
 * @property {'list'|'map'} [shape] its entries as a list (the default) or as a map keyed by id (kms's `entries:`)
 * @property {true} [custom]    a custom collection of data/collections.yaml (L6 §7.3), not one of REGISTRIES
 * @property {string} [filesGlob] a registry spread over several files, a file per record (knowledge, L6 §7.5: `KNOWLEDGE`)
 */

/** @type {RegistryDef[]} */
export const REGISTRIES = [
  { name: 'members', topKey: 'members', kind: 'collection' },
  { name: 'projects', topKey: 'projects', kind: 'collection' },
  { name: 'finances', topKey: 'finances', kind: 'document' },
  { name: 'governance', topKey: 'governance', kind: 'document' },
  { name: 'meetings', topKey: 'meetings', kind: 'collection' },
  { name: 'ideas', topKey: 'ideas', kind: 'collection' },
  // Real instances split on this key: `opportunities` in most, and in the
  // framework itself; `funding_opportunities` (the DATA-MODEL name) in
  // others. Resolving both is not politeness —
  // hardcoding one meant the UI showed an EMPTY registry for a populated file
  // and then appended to a NEW second top-level key on create, splitting the
  // data in two. scripts/initialize.mjs already accepts either.
  { name: 'funding-opportunities', topKey: 'funding_opportunities', aliases: ['opportunities'], kind: 'collection' },
  { name: 'relationships', topKey: 'relationships', kind: 'collection' },
  { name: 'sources', topKey: 'sources', kind: 'collection' },
  { name: 'knowledge-manifest', topKey: 'knowledge_manifest', kind: 'document' },
  { name: 'events', topKey: 'events', kind: 'collection' },
  { name: 'channels', topKey: 'channels', kind: 'collection' },
  { name: 'assets', topKey: 'assets', kind: 'collection' },
  { name: 'knowledge-gaps', topKey: 'gaps', kind: 'collection' },
  // 0.6 (F1 spec §3.4): the org's outside systems — a Safe, a Gardens pool, a docs space.
  { name: 'systems', topKey: 'systems', kind: 'collection' },
  // 0.6 (P4 spec §5.1): the org's boards — workspaces of blocks. Records, never graph resources.
  { name: 'boards', topKey: 'boards', kind: 'collection' },
  // DAO-OS L6 (spec §7.2): the org's tasks, class workspace. L6's own registries sit here, before proposals.
  { name: 'tasks', topKey: 'tasks', kind: 'collection' },
  // DAO-OS L6 (spec §7.3): the collections' definitions and saved views, data/collections.yaml. A document: written whole
  // by the collection routes (server/workspace/collections.ts) or by the source editor, never entry by entry.
  { name: 'collections', topKey: 'collections', kind: 'document' },
  // DAO-OS L6 (spec §9.6, §11.1): the import receipts, data/imports.yaml, class workspace. A document, as collections is:
  // written whole by the import command (scripts/import.ts) in its one commit, or by the source editor, never entry by
  // entry. Counts and reasons only, never the name of a private item.
  { name: 'imports', topKey: 'imports', kind: 'document' },
  // 0.6 (P2 spec §3.1): proposals and their events. A ledger: only the proposal routes write it.
  { name: 'proposals', topKey: 'proposals', kind: 'collection', ledger: true },
  // DAO-OS L1 (ruling L1-R1): the library's receipts, one per entry added. Class `records`; written only
  // through the library's Add and Remove, and lib/receipts.mjs keeps every change that holds one whole.
  { name: 'library', topKey: 'installed', kind: 'collection' },
  // DAO-OS L8 (spec §3): which collections, records and fields are public in git. L5 reads it too (lib/visibility.mjs).
  { name: 'visibility', topKey: 'visibility', kind: 'document' },
]

/**
 * The top-level key this document actually uses: the canonical one if present,
 * else the first alias that is, else the canonical one (for creating it).
 * `has` is the yaml Document/Map predicate — passed in so this stays pure.
 * @param {(key: string) => boolean} has
 * @param {RegistryDef} def
 * @returns {string}
 */
export function resolveTopKey(has, def) {
  if (has(def.topKey)) return def.topKey
  for (const alias of def.aliases ?? []) if (has(alias)) return alias
  return def.topKey
}

/** The registry each record kind is read from. The change engine addresses records by registry name
 *  (`funding-opportunities:x`), never by kind (`funding:x`). app/src/kinds.ts re-exports it.
 *  @type {Readonly<Record<string, string>>} */
export const REGISTRY_OF_KIND = Object.freeze({
  person: 'members', project: 'projects', funding: 'funding-opportunities', partner: 'relationships',
  idea: 'ideas', source: 'sources', channel: 'channels', system: 'systems', meeting: 'meetings', event: 'events',
})

/**
 * The collection `knowledge` (L6 §7.5, Task 10): kms's store as the instance holds it, one file per kind under data/kb/,
 * each `entries:` a map keyed by slug (lib/workspace/knowledge.mjs reads them). A record's id is `<type>/<slug>` and its file
 * is its kind's (`registryFileOf(def, id)`). Not one of REGISTRIES: an instance has it when it has data/kb/ (`registriesOf`).
 * @type {Readonly<RegistryDef>}
 */
export const KNOWLEDGE = Object.freeze({ name: 'knowledge', topKey: 'entries', kind: 'collection', shape: 'map', filesGlob: 'data/kb/*.yaml' })

/** The file a registry is written in, from the repository's root: its own `file`, else `data/<name>.yaml` (L6 §7.1). A
 *  registry spread over several files (`filesGlob`: knowledge) has a file per record, read from its id (`<type>/<slug>` →
 *  `data/kb/<type>.yaml`); without an id, or with one that names no file, its glob, which classes and targets read as the
 *  collection's own (`data/kb/**`) and which no file is.
 *  @param {{ name: string, file?: string, filesGlob?: string }} def @param {string} [id] @returns {string} */
export function registryFileOf(def, id) {
  if (def.filesGlob !== undefined) {
    const kind = id === undefined ? null : /^([a-z0-9][a-z0-9-]*)\/[^/\s]+$/.exec(id)?.[1] ?? null
    return kind === null ? def.filesGlob : def.filesGlob.replace('*', kind)
  }
  return def.file ?? `data/${def.name}.yaml`
}

/** The id a custom collection may take (L6 §7.4). */
export const CUSTOM_ID = /^[a-z][a-z0-9-]{1,40}$/

/** Names no custom collection takes besides the registries': pages, knowledge and the definitions file's own. */
export const RESERVED_NAMES = Object.freeze(['pages', 'knowledge', 'collections'])

/** The file a custom collection's records are kept in (L6 §7.3). A private collection, never named in git, is classed as
 *  if it were there. @param {string} id @returns {string} */
export function customFileOf(id) {
  return `data/collections/${id}.yaml`
}

/** The file the records of the registry or collection called `name` are kept in, read from its name alone (DAO-OS L6
 *  §7.1): a registry's own, any other name a custom collection's. Where the instance's list is at hand (`registriesOf`),
 *  its def's file says the same. @param {string} name @param {readonly RegistryDef[]} [builtins] @returns {string} */
export function fileOfName(name, builtins = REGISTRIES) {
  const def = builtins.find(d => d.name === name) ?? (name === KNOWLEDGE.name ? KNOWLEDGE : undefined)
  return def ? registryFileOf(def) : customFileOf(name)
}

/** The file a record op (`<registry>:<id>`) writes, read from the record alone (`fileOfName`): knowledge's is its kind's
 *  (`data/kb/<type>.yaml`, L6 §7.5). @param {string} record @param {readonly RegistryDef[]} [builtins] @returns {string} */
export function fileOfRecord(record, builtins = REGISTRIES) {
  const at = record.indexOf(':')
  const name = at < 0 ? record : record.slice(0, at)
  return name === KNOWLEDGE.name && at >= 0 ? registryFileOf(KNOWLEDGE, record.slice(at + 1)) : fileOfName(name, builtins)
}

/** Whether `id` can name a custom collection: the id rule, not a registry's name (a name git knows is never taken,
 *  R-L5-14.5), not a reserved name, not a tree's (`tree-`). @param {unknown} id @param {readonly RegistryDef[]} [builtins]
 *  @returns {id is string} */
export function isCustomId(id, builtins = REGISTRIES) {
  return typeof id === 'string' && CUSTOM_ID.test(id) && !id.startsWith('tree-') &&
    !RESERVED_NAMES.includes(id) && !builtins.some(def => def.name === id)
}

/**
 * The registries data/collections.yaml adds (L6 §7.1, §7.3), from its parsed `collections:` list: one per entry whose id
 * can name a custom collection (`isCustomId`), the first of two with one id, each a list under its id in its own file.
 * An entry naming a registry (`tasks`) holds that registry's saved views only and adds nothing; one that cannot be read
 * as a collection adds nothing either (validate:data says what is wrong with it).
 * @param {unknown} collections @param {readonly RegistryDef[]} [builtins] @returns {RegistryDef[]}
 */
export function customRegistries(collections, builtins = REGISTRIES) {
  if (!Array.isArray(collections)) return []
  /** @type {RegistryDef[]} */
  const out = []
  for (const entry of collections) {
    const id = typeof entry === 'object' && entry !== null ? /** @type {{ id?: unknown }} */ (entry).id : undefined
    if (!isCustomId(id, builtins) || out.some(def => def.name === id)) continue
    out.push({ name: id, topKey: id, kind: 'collection', file: customFileOf(id), custom: true })
  }
  return out
}

/** A task's project (L6 §7.2): its `project`, else the `related_project` an instance's older tasks carry; null for none.
 *  @param {Record<string, unknown>} task @returns {string | null} */
export function taskProject(task) {
  for (const key of ['project', 'related_project']) {
    const value = task[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}
