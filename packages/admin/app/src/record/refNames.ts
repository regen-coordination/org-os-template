import { useMemo } from 'react'
import { useResources } from '../queries.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { useEntryOfResources } from '../blocks/entries.ts'
import { REFS, refOf } from '../refs.ts'
import { REGISTRY_OF_KIND } from '../kinds.ts'
import { shownName } from './restricted.ts'

/** Names a record by its registry and id as the record page does (walk 2026-11-04): the name of the record the viewer
 *  may see, read through its file entry, so a name the gate keeps reads "<hat> only" (D-12, E-70); its id while that
 *  entry is read, or when there is no such record the viewer may see. */
export type RecordName = (registry: string, id: string) => string
/** A field's value as a list or a card says it: a reference field (a project's `lead`, its `contributors`) names each
 *  id it holds by `RecordName`; any other field is its own text. */
export type FieldName = (kind: string, field: string, text: string) => string

export function useRecordNames(registries?: readonly string[]): { nameOf: RecordName; fieldText: FieldName } {
  const resources = useResources().data
  const { visible, viewer } = useViewer()
  const source = useVisibilitySource()
  // the registries a reference field names, or those given (a proposal's Touches names any record)
  const targets = useMemo(() => new Set(registries ?? REFS.map(r => r.target)), [registries?.join('\n')])
  const named = useMemo(() => visible((resources ?? []).filter(r => r.source?.registry !== undefined && targets.has(r.source.registry))),
    [resources, viewer, source, targets])
  const entries = useEntryOfResources(named)
  return useMemo(() => {
    const byKey = new Map(named.map(r => [`${r.source!.registry}\n${r.source!.entityId}`, r]))
    const nameOf: RecordName = (registry, id) => {
      const r = byKey.get(`${registry}\n${id}`)
      return r === undefined || entries.pending ? id : shownName(r, entries.entryOf(r), source)
    }
    const fieldText: FieldName = (kind, field, text) => {
      const registry = REGISTRY_OF_KIND[kind]
      const ref = registry === undefined ? undefined : refOf(registry, field)
      if (ref === undefined || text === '') return text
      return text.split(', ').map(id => nameOf(ref.target, id)).join(', ')
    }
    return { nameOf, fieldText }
  }, [named, entries.entryOf, entries.pending, source])
}
