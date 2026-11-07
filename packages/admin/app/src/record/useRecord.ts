import { useQuery } from '@tanstack/react-query'
import { api, type Entity, type JsonSchema, type Op, type ResourceDetail } from '../api.ts'
import { REGISTRY_OF_KIND, RESOURCE_KINDS } from '../kinds.ts'
import { addressProblem, hasId, positionOf } from './addressing.ts'
import { restrictedOf, withoutRestricted } from './restricted.ts'

export interface RecordModel {
  kind: string
  id: string
  resourceId: string | null
  detail: ResourceDetail | null
  registry: string | null
  entry: Entity | null           // the file's entry, without the gate's `restricted` marker; null when the file does not hold it
  restricted: Record<string, string> // the fields the viewer is not admitted to, each with the level that keeps them out (E-60)
  readAt: string | null          // when what the page shows was read: the registry, else the resource (the from mark, Q70)
  schema: JsonSchema | null
  changeKey: string | null       // `<registry>:<id>`
  entityId: string
  staged: Op[]                   // this record's staged ops
  collection: boolean            // its registry is a collection, so it can be edited
  problem: string | null         // why the platform can't address this entry (no id, or a shared id): read-only
  loading: boolean
  error: string | null           // nothing to show at all
}

/** `/r/<kind>/<id>`: a resource when `kind` is a resource kind, else the registry named `kind`.
 *  `knowledge-gaps` is both, and is a resource only for its summary card. */
export function recordTarget(kind: string, id: string): { resourceId: string | null; registry: string | null } {
  // `#3` names an entry with no id by its position: it has no resource, only its place in the file.
  if (positionOf(id) !== null) return { resourceId: null, registry: REGISTRY_OF_KIND[kind] ?? (RESOURCE_KINDS.has(kind) ? null : kind) }
  if (kind === 'knowledge-gaps' && id !== 'summary') return { resourceId: null, registry: 'knowledge-gaps' }
  if (RESOURCE_KINDS.has(kind)) return { resourceId: `${kind}:${id}`, registry: REGISTRY_OF_KIND[kind] ?? null }
  return { resourceId: null, registry: kind }
}

export function useRecord(kind: string, id: string): RecordModel {
  const t = recordTarget(kind, id)
  const detail = useQuery({ queryKey: ['resource', t.resourceId], queryFn: () => api.resource(t.resourceId!), enabled: t.resourceId !== null })
  const registry = t.registry
  const reg = useQuery({ queryKey: ['registry', registry], queryFn: () => api.registry(registry!), enabled: registry !== null })
  const schema = useQuery({ queryKey: ['schema', registry], queryFn: () => api.schema(registry!), enabled: registry !== null })
  const changes = useQuery({ queryKey: ['changes'], queryFn: api.changes })
  const entityId = detail.data?.resource.source?.entityId ?? id
  const entries = reg.data?.entries ?? []
  const pos = positionOf(id)
  const index = pos !== null ? (entries[pos] && !hasId(entries[pos]!) ? pos : -1) : entries.findIndex(e => hasId(e) && String(e.id) === entityId)
  const held = index >= 0 ? entries[index]! : null
  const entry = withoutRestricted(held)
  const problem = registry && index >= 0 ? addressProblem(entries, index, `data/${registry}.yaml`) : null
  const changeKey = registry && pos === null ? `${registry}:${entityId}` : null
  const staged = (changes.data?.ops ?? []).filter(o => o.record === changeKey)
  const createdHere = staged.some(o => o.op === 'create')
  const loading = (t.resourceId !== null && detail.isLoading) || (registry !== null && (reg.isLoading || schema.isLoading))
  let error: string | null = null
  if (!loading) {
    if (t.resourceId !== null && detail.error && !entry && !createdHere) error = detail.error.message
    else if (t.resourceId === null && reg.error) error = reg.error.message
    else if (t.resourceId === null && !entry && !createdHere) error = `No entry "${id}" in data/${registry}.yaml.`
  }
  const at = registry !== null ? reg.dataUpdatedAt : detail.dataUpdatedAt
  return {
    kind, id, resourceId: t.resourceId, detail: detail.data ?? null, registry, entry, restricted: restrictedOf(held),
    readAt: at > 0 ? new Date(at).toISOString() : null, schema: schema.data ?? null,
    changeKey, entityId, staged, collection: reg.data?.kind === 'collection', problem, loading, error,
  }
}
