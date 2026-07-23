import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, isSeq, isMap, isScalar, YAMLSeq, YAMLMap } from 'yaml'
import { REGISTRIES, registryDef, type RegistryKind } from './registries.ts'

export type Entity = Record<string, unknown>

export interface RegistryRead {
  name: string
  kind: RegistryKind
  schemaVersion: string | null
  entries?: Entity[]
  document?: Record<string, unknown>
}

export function registryPath(repo: string, name: string): string {
  registryDef(name) // throws on unknown
  return join(repo, 'data', `${name}.yaml`)
}

function loadDoc(repo: string, name: string) {
  const path = registryPath(repo, name)
  if (!existsSync(path)) throw new Error(`registry file missing: ${name}`)
  return { path, doc: parseDocument(readFileSync(path, 'utf8')) }
}

export function listRegistries(repo: string) {
  return REGISTRIES.filter(def => existsSync(join(repo, 'data', `${def.name}.yaml`)))
    .map(def => {
      if (def.kind === 'document') return { name: def.name, kind: def.kind, count: null }
      const { doc } = loadDoc(repo, def.name)
      const node = doc.get(def.topKey)
      return { name: def.name, kind: def.kind, count: isSeq(node) ? node.items.length : 0 }
    })
}

export function readRegistry(repo: string, name: string): RegistryRead {
  const def = registryDef(name)
  const { doc } = loadDoc(repo, name)
  const schemaVersion = (doc.get('schema_version') as string | undefined) ?? null
  if (def.kind === 'document') {
    const node = doc.get(def.topKey)
    return { name, kind: def.kind, schemaVersion,
      document: (isMap(node) ? node.toJSON() : {}) as Record<string, unknown> }
  }
  const node = doc.get(def.topKey)
  const entries = isSeq(node) ? (node.toJSON() as Entity[]) : []
  return { name, kind: def.kind, schemaVersion, entries }
}

/** Shared by the write half. Returns the collection seq, creating it if the key is null/absent. */
export function collectionSeq(doc: ReturnType<typeof parseDocument>, name: string): YAMLSeq {
  const def = registryDef(name)
  if (def.kind !== 'collection') throw new Error(`${name} is a document registry`)
  let node = doc.get(def.topKey)
  if (!isSeq(node)) {
    node = doc.createNode([])
    doc.set(def.topKey, node)
  }
  return node as YAMLSeq
}

export function findEntity(seq: YAMLSeq, id: string): { index: number; item: YAMLMap } {
  const index = seq.items.findIndex(it => isMap(it) && (it as YAMLMap).get('id') === id)
  if (index < 0) throw new Error(`entity not found: ${id}`)
  return { index, item: seq.items[index] as YAMLMap }
}

function saveDoc(path: string, doc: ReturnType<typeof parseDocument>): void {
  // flowCollectionPadding:false keeps `["a"]` from being rewritten to `[ "a" ]` on
  // every save, so untouched flow arrays stay out of the diff (minimal-diff guarantee).
  writeFileSync(path, doc.toString({ flowCollectionPadding: false }))
}

/** Minimal-diff update: set only changed keys, delete removed ones. */
export function updateEntity(repo: string, name: string, id: string, entity: Entity): Entity {
  const { path, doc } = loadDoc(repo, name)
  const seq = collectionSeq(doc, name)
  const { item } = findEntity(seq, id)
  const current = item.toJSON() as Entity
  for (const [key, value] of Object.entries(entity)) {
    if (JSON.stringify(value) !== JSON.stringify(current[key])) {
      // Mutate an existing scalar in place so its representation (quote style) survives;
      // fall back to replacing the node for structural or newly-added values.
      const existing = item.get(key, true)
      if (isScalar(existing) && (typeof value !== 'object' || value === null)) {
        existing.value = value
      } else {
        item.set(key, doc.createNode(value))
      }
    }
  }
  for (const key of Object.keys(current)) {
    if (!(key in entity)) item.delete(key)
  }
  saveDoc(path, doc)
  return readRegistry(repo, name).entries!.find(e => e.id === id)!
}

export function createEntity(repo: string, name: string, entity: Entity): Entity {
  if (typeof entity.id !== 'string' || entity.id.length === 0) {
    throw new Error('entity requires a non-empty string id')
  }
  const { path, doc } = loadDoc(repo, name)
  const seq = collectionSeq(doc, name)
  if (seq.items.some(it => isMap(it) && (it as YAMLMap).get('id') === entity.id)) {
    throw new Error(`entity already exists: ${entity.id}`)
  }
  if (seq.flow && seq.items.length === 0) seq.flow = false // `key: []` → block style
  seq.add(doc.createNode(entity))
  saveDoc(path, doc)
  return entity
}

export function deleteEntity(repo: string, name: string, id: string): void {
  const { path, doc } = loadDoc(repo, name)
  const seq = collectionSeq(doc, name)
  const { index } = findEntity(seq, id)
  seq.items.splice(index, 1)
  saveDoc(path, doc)
}
