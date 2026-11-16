// DAO-OS L6 Task 19: the from marks the server sends (spec §10, Q70; R-L6-T14-5) for L4c's mark on the record, page and
// view headers. A collection's mark and its records' come from GET /api/registries/:name?from=1 (`fromMark`), read
// under a key of their own: the record itself is read without them, so a mark is never edited or staged back as a
// field. Only what the server sends is drawn: no mark for a record it gives none, none at all for the public, and none
// while previewing as the public (the from mark is the members' side).
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import type { From } from '../elements/atoms/from.ts'
import { useViewer } from '../viewAs/ViewAs.tsx'

export interface FromMarks {
  /** The collection's own mark (its file, or the instance for one the store keeps). */
  collection: From | undefined
  /** A record's mark, by its id. */
  of(id: string): From | undefined
  /** The marks are still being read. */
  pending: boolean
}

const NONE: FromMarks = { collection: undefined, of: () => undefined, pending: false }

export function useFromMarks(registry: string | null): FromMarks {
  const { viewer } = useViewer()
  const asked = registry !== null && viewer.as !== 'public'
  const q = useQuery({ queryKey: ['registry', registry, 'from'], queryFn: () => api.registryMarks(registry!), enabled: asked, retry: false })
  return useMemo(() => {
    if (!asked) return NONE
    const by = new Map<string, From>()
    for (const e of q.data?.entries ?? []) {
      if ((typeof e.id === 'string' || typeof e.id === 'number') && e.fromMark) by.set(String(e.id), e.fromMark)
    }
    return { collection: q.data?.fromMark, of: (id: string) => by.get(id), pending: q.isPending }
  }, [asked, q.data, q.isPending])
}

/** A page's mark as GET /api/pages/:id sends it, unless previewing as the public. */
export function usePageMark(mark: From | undefined): From | undefined {
  const { viewer } = useViewer()
  return viewer.as === 'public' ? undefined : mark
}
