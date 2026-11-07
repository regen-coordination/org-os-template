// The registry table itself is in ../lib/registries.mjs, so that the root
// scripts (`npm run validate:data`) read the same list as the server. This file
// gives it its TypeScript types and keeps every name the server imports here.
import { REGISTRIES as TABLE, resolveTopKey as resolveKey } from '../lib/registries.mjs'

export type RegistryKind = 'collection' | 'document'

export interface RegistryDef {
  name: string        // filename without .yaml, used in URLs
  topKey: string      // canonical top-level YAML key (used when creating the block)
  aliases?: string[]  // other keys real instances use for the same block
  kind: RegistryKind
  ledger?: boolean    // written only by its own routes (P2): the change engine refuses to stage an op on it
}

export const REGISTRIES: RegistryDef[] = TABLE

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
  return resolveKey(has, def)
}
