import { useQuery } from '@tanstack/react-query'
import { api, type Op, type RegistryRead, type Resource } from './api.ts'
import { hasId, idCounts } from './record/addressing.ts'
import { stagedView } from './record/fields.ts'
import { useActor } from './actor.ts'
import { SECTIONS } from './sections.ts'

/** One place decides what may be changed (rulings C11, C17): Edit, `e`, `?edit=1` and Delete on a
 *  record (the record page, the inspector, ⌘K), and New on a list, are offered only where these say so. */

export interface EditTarget {
  resource: Resource | null      // the record's resource, when it has one: its source must allow changes
  registry: string | null        // the registry the record is read from
  reg: RegistryRead | undefined  // that registry as read; until it has been, nothing is offered
  id: string                     // the record's id in it (`#n` for an entry with no id)
  ops: Op[]                      // your staged change
  known: boolean                 // your git email matched a member
}

/** Whether a record may be edited or deleted. You are a known member; the record is read from a
 *  collection (and, for a resource, a source that allows changes); the platform can address it, its
 *  id held by exactly one entry (by none, for a record staged as new); and it is not staged for
 *  deletion. A registry-only record (a meeting, an event…) counts like any other (C17). */
export function canEdit(t: EditTarget): boolean {
  if (t.resource && !t.resource.source?.editable) return false
  if (!t.known || !t.registry || !t.id || t.reg?.kind !== 'collection' || !t.reg.entries) return false
  const mine = t.ops.filter(o => o.record === `${t.registry}:${t.id}`)
  const created = mine.some(o => o.op === 'create')
  const n = idCounts(t.reg.entries).get(t.id) ?? 0
  if (n !== (created ? 0 : 1)) return false
  const entry = t.reg.entries.find(e => hasId(e) && String(e.id) === t.id) ?? null
  const view = stagedView(entry, mine)
  return view.value !== null && !view.deleted
}

/** `canEdit`, reading the actor, the registry and your change itself. The registry and id default to
 *  the resource's source. */
export function useCanEdit(o: { resource?: Resource | null; registry?: string | null; id?: string }): boolean {
  const { known } = useActor()
  const resource = o.resource ?? null
  const registry = o.registry ?? resource?.source?.registry ?? null
  const id = o.id ?? resource?.source?.entityId ?? ''
  const reg = useQuery({ queryKey: ['registry', registry], queryFn: () => api.registry(registry!), enabled: !!registry })
  const changes = useQuery({ queryKey: ['changes'], queryFn: api.changes })
  if (!o.resource && !o.registry) return false
  return canEdit({ resource, registry, reg: reg.data, id, ops: changes.data?.ops ?? [], known })
}

/** Whether New is offered for a registry: you are a known member, it is a collection, and a section
 *  adds its records there (`newRegistry`), not every collection the instance holds. */
export const canCreate = (registry: string, kind: RegistryRead['kind'] | undefined, known: boolean): boolean =>
  known && kind === 'collection' && SECTIONS.some(s => s.newRegistry === registry)
