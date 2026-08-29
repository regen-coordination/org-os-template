export type RegistryKind = 'collection' | 'document'

export interface RegistryDef {
  name: string        // filename without .yaml, used in URLs
  topKey: string      // canonical top-level YAML key (used when creating the block)
  aliases?: string[]  // other keys real instances use for the same block
  kind: RegistryKind
}

export const REGISTRIES: RegistryDef[] = [
  { name: 'members', topKey: 'members', kind: 'collection' },
  { name: 'projects', topKey: 'projects', kind: 'collection' },
  { name: 'finances', topKey: 'finances', kind: 'document' },
  { name: 'governance', topKey: 'governance', kind: 'document' },
  { name: 'meetings', topKey: 'meetings', kind: 'collection' },
  { name: 'ideas', topKey: 'ideas', kind: 'collection' },
  // Real instances split on this key: `opportunities` in refi-bcn, refi-dao,
  // bread-coop and the framework itself; `funding_opportunities` (the
  // DATA-MODEL name) in regen-coordination. Resolving both is not politeness —
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
]

export function registryDef(name: string): RegistryDef {
  const def = REGISTRIES.find(r => r.name === name)
  if (!def) throw new Error(`unknown registry: ${name}`)
  return def
}

/**
 * The top-level key this document actually uses: the canonical one if present,
 * else the first alias that is, else the canonical one (for creating it).
 * `has` is the yaml Document/Map predicate — passed in so this stays pure.
 */
export function resolveTopKey(has: (key: string) => boolean, def: RegistryDef): string {
  if (has(def.topKey)) return def.topKey
  for (const alias of def.aliases ?? []) if (has(alias)) return alias
  return def.topKey
}
