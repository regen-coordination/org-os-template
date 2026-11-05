// packages/admin/app/src/blocks/entries.ts
import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api, type Resource } from '../api.ts'
import { REGISTRY_OF_KIND } from '../kinds.ts'
import { sectionById } from '../sections.ts'
import { BASE_FIELDS, sortKeys } from '../../../lib/board-query.mjs'
import type { RecordSource } from './types.ts'

/** A record's entry in its registry file, for the fields its Resource does not carry. */
export type EntryOf = (r: Resource) => Record<string, unknown> | undefined

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The kinds whose file entries a source reads: the kinds it names (or its section's), when it reads a
 *  field beyond every record's own, in `where`, `sort` or `also` (a view's field, such as a sum's). A
 *  Resource's facts are a hand-picked few, while validate:data accepts every field of the kind's schema
 *  (boardFieldsOf), so the rest comes from the file (final review I-1). None for every kind ("*"). */
export function entryKinds(source: RecordSource, also: unknown[] = []): string[] {
  const kinds = source.section !== undefined ? (sectionById(source.section)?.kinds ?? [])
    : source.kind === undefined ? [] : Array.isArray(source.kind) ? source.kind : [source.kind]
  if (kinds.length === 0 || kinds.includes('*')) return []
  const fields = [...(isMap(source.where) ? Object.keys(source.where) : []),
    ...(typeof source.sort === 'string' || Array.isArray(source.sort) ? sortKeys(source.sort).map(k => k.field) : []),
    ...also.filter((f): f is string => typeof f === 'string' && f !== '')]
  return fields.some(f => !BASE_FIELDS.includes(f)) ? kinds : []
}

/** The file entries of the kinds given: one ['registry', <name>] query per kind a registry backs (the key
 *  every reader of a registry file shares). `pending` holds until each has answered, so a block that needs
 *  entries stays loading and never says empty early; a file that cannot be read leaves its entries out. */
export function useEntryOf(kinds: readonly string[]): { entryOf: EntryOf; pending: boolean } {
  return useEntriesAt([...new Set(kinds.map(k => REGISTRY_OF_KIND[k]).filter((r): r is string => r !== undefined))])
}

/** The file entries behind these Resources, each read from the registry its own `source` names (else its kind's):
 *  what a page, an inspector or a small map holds — Resources rather than a block's kinds. */
export function useEntryOfResources(resources: readonly Resource[]): { entryOf: EntryOf; pending: boolean } {
  return useEntriesAt([...new Set(resources.flatMap(r => {
    const registry = r.source?.registry ?? REGISTRY_OF_KIND[r.kind]
    return registry === undefined ? [] : [registry]
  }))])
}

function useEntriesAt(registries: readonly string[]): { entryOf: EntryOf; pending: boolean } {
  const files = useQueries({
    queries: registries.map(registry => ({ queryKey: ['registry', registry], queryFn: () => api.registry(registry), retry: false })),
  })
  const stamp = files.map(f => f.dataUpdatedAt).join()
  const entryOf = useMemo<EntryOf>(() => {
    const byKey = new Map<string, Record<string, unknown>>()
    registries.forEach((registry, i) => {
      for (const e of files[i]?.data?.entries ?? []) if (e.id !== undefined && e.id !== null) byKey.set(`${registry}\n${String(e.id)}`, e as Record<string, unknown>)
    })
    return r => {
      const registry = r.source?.registry ?? REGISTRY_OF_KIND[r.kind]
      const id = r.source?.entityId
      return registry && id ? byKey.get(`${registry}\n${id}`) : undefined
    }
  }, [registries.join('\n'), stamp])
  // Pending until each file has answered once. A file that failed is fetched again when another reader mounts, and that
  // fetch, having no data, puts the query back to pending: counted as pending, a block that waits for its entries would
  // unmount the reader that set it off, and take turns with it (D-12).
  return { entryOf, pending: files.some(f => f.isPending && f.dataUpdatedAt === 0 && f.errorUpdatedAt === 0) }
}
