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
  idea: 'ideas', source: 'sources', channel: 'channels', system: 'systems',
})
