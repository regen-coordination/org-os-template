export type RegistryKind = 'collection' | 'document'

export interface RegistryDef {
  name: string      // filename without .yaml, used in URLs
  topKey: string    // top-level YAML key
  kind: RegistryKind
}

export const REGISTRIES: RegistryDef[] = [
  { name: 'members', topKey: 'members', kind: 'collection' },
  { name: 'projects', topKey: 'projects', kind: 'collection' },
  { name: 'finances', topKey: 'finances', kind: 'document' },
  { name: 'governance', topKey: 'governance', kind: 'document' },
  { name: 'meetings', topKey: 'meetings', kind: 'collection' },
  { name: 'ideas', topKey: 'ideas', kind: 'collection' },
  { name: 'funding-opportunities', topKey: 'funding_opportunities', kind: 'collection' },
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
