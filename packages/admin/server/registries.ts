// The registry table itself is in ../lib/registries.mjs, so that the root
// scripts (`npm run validate:data`) read the same list as the server. This file
// gives it its TypeScript types and keeps every name the server imports here.
// The list an instance has is dynamic (L6 §7.1): `registriesOf(repo)` adds the
// custom collections its data/collections.yaml defines.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { REGISTRIES as TABLE, KNOWLEDGE as KNOWLEDGE_DEF, resolveTopKey as resolveKey, customRegistries, registryFileOf as fileOf } from '../lib/registries.mjs'
import type { CollectionDef } from '../lib/workspace/collections.mjs'

export type RegistryKind = 'collection' | 'document'

export interface RegistryDef {
  name: string        // filename without .yaml, used in URLs
  topKey: string      // canonical top-level YAML key (used when creating the block)
  aliases?: string[]  // other keys real instances use for the same block
  kind: RegistryKind
  createOnly?: boolean // an entry is created, never replaced, updated or deleted by hand (invites)
  ledger?: boolean    // written only by its own routes (P2): the change engine refuses to stage an op on it
  file?: string       // the file it is written in, from the repository's root (default data/<name>.yaml; L6 §7.1)
  shape?: 'list' | 'map' // entries as a list (default), or as a map keyed by id (kms's `entries:`)
  custom?: true       // a custom collection of data/collections.yaml (L6 §7.3)
  filesGlob?: string  // a registry spread over several files, a file per record (knowledge, L6 §7.5: KNOWLEDGE)
}

export const REGISTRIES: RegistryDef[] = TABLE

/** The collection `knowledge` (L6 §7.5, Task 10): one file per kind under data/kb/, ids `<type>/<slug>`. An instance has it
 *  when it has data/kb/ (`registriesOf`); its records are read by `knowledgeEntries` (server/registry.ts). */
export const KNOWLEDGE: RegistryDef = KNOWLEDGE_DEF as RegistryDef

/** One canon file as a registry the writers can name: the knowledge collection's shape, in that file alone (its sentences
 *  name the file, never the glob). */
export const knowledgeFileDef = (rel: string): RegistryDef => ({ name: KNOWLEDGE.name, topKey: KNOWLEDGE.topKey, kind: 'collection', shape: 'map', file: rel })

/** The file a registry is written in, from the repository's root: its def's `file`, else data/<name>.yaml; for a registry
 *  spread over several files (knowledge), the file of the record `id` (lib/registries.mjs `registryFileOf`). */
export function registryFileOf(def: Pick<RegistryDef, 'name' | 'file' | 'filesGlob'>, id?: string): string {
  return fileOf(def, id)
}

/** Where an instance defines its collections (L6 §7.3). */
const COLLECTIONS_FILE = join('data', 'collections.yaml')
/** Where kms keeps the canon (L6 §7.5): its presence gives the instance the collection `knowledge`. */
const KNOWLEDGE_DIR = join('data', 'kb')

/** The list last answered for each repository, and the stat of data/collections.yaml it was read at. */
const lists = new Map<string, { stat: string; defs: RegistryDef[]; definitions: Map<string, CollectionDef> }>()

function statOf(path: string): string {
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}:${s.ino}` } catch { return 'absent' }
}

/** Whether the instance at `repo` keeps a canon (a data/kb/ folder). */
function hasCanon(repo: string): boolean {
  try { return statSync(join(repo, KNOWLEDGE_DIR)).isDirectory() } catch { return false }
}

/**
 * The registries of the instance at `repo` (L6 §7.1), the one answer: REGISTRIES, then `knowledge` when the instance keeps a
 * canon (data/kb/, L6 §7.5), then each custom collection its data/collections.yaml defines (`customRegistries`: a name git
 * knows is never taken). Read again only when that file's stat, or whether data/kb/ is there, changes. A file that cannot be read adds no collection; validate:data says what is wrong with it.
 */
export function registriesOf(repo: string): RegistryDef[] {
  return listOf(repo).defs
}

function listOf(repo: string): { stat: string; defs: RegistryDef[]; definitions: Map<string, CollectionDef> } {
  const path = join(repo, COLLECTIONS_FILE)
  const canon = hasCanon(repo)
  const stat = `${statOf(path)}|${canon ? 'kb' : ''}`
  const known = lists.get(repo)
  if (known && known.stat === stat) return known
  let listed: unknown = null
  if (!stat.startsWith('absent|')) {
    try { listed = (parse(readFileSync(path, 'utf8')) as { collections?: unknown } | null)?.collections ?? null } catch { listed = null }
  }
  const custom = customRegistries(listed) as RegistryDef[]
  const defs = custom.length === 0 && !canon ? REGISTRIES : [...REGISTRIES, ...(canon ? [KNOWLEDGE] : []), ...custom]
  // Each custom collection's definition, the first entry of its id (as customRegistries reads them): its fields make its
  // records' schema and references (lib/workspace/collections.mjs schemaOf, refsOf).
  const definitions = new Map<string, CollectionDef>()
  for (const entry of Array.isArray(listed) ? listed : []) {
    const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined
    if (typeof id === 'string' && !definitions.has(id) && custom.some(d => d.name === id)) definitions.set(id, entry as CollectionDef)
  }
  const read = { stat, defs, definitions }
  lists.set(repo, read)
  return read
}

/** A custom collection's definition as data/collections.yaml holds it (L6 §7.3); null for a registry or a name it does not
 *  define. Read with `registriesOf`, from the same reading of the file. */
export function customDefinition(repo: string, name: string): CollectionDef | null {
  return listOf(repo).definitions.get(name) ?? null
}

/** A registry by name. With `repo`, a custom collection of that instance is one too (`registriesOf`). */
export function registryDef(name: string, repo?: string): RegistryDef {
  const def = REGISTRIES.find(r => r.name === name) ?? (repo === undefined ? undefined : registriesOf(repo).find(r => r.name === name))
  if (!def) throw new Error(`unknown registry: ${name}`)
  return def
}

/** The file registry `name` of the instance at `repo` is written in, from the repository's root (`registryFileOf`); for
 *  knowledge, the file of the record `id` (preflight row 13). */
export function registryFile(repo: string, name: string, id?: string): string {
  return registryFileOf(registryDef(name, repo), id)
}

/**
 * The top-level key this document actually uses: the canonical one if present,
 * else the first alias that is, else the canonical one (for creating it).
 * `has` is the yaml Document/Map predicate — passed in so this stays pure.
 */
export function resolveTopKey(has: (key: string) => boolean, def: RegistryDef): string {
  return resolveKey(has, def)
}
