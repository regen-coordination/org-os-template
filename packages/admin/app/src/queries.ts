import { useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, api } from './api.ts'
import type { SystemEntries } from './sections.ts'

export const useResources = () => useQuery({ queryKey: ['resources'], queryFn: api.resources })
export const useRegistries = () => useQuery({ queryKey: ['registries'], queryFn: api.registries })
export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 5000 })

/** `data/systems.yaml` by id. An instance without the file has no systems: an empty map, not an error. */
export function useSystemEntries(): SystemEntries {
  return useSystemsRead().entries
}

/** The last failed read of `data/systems.yaml`, by query client (one per app, one per test). */
const lastFailure = new WeakMap<QueryClient, Error>()

/** `data/systems.yaml` by id, with where its read stands (review I-2): `pending` until it first answers, `error` when it
 *  failed for a reason other than there being no file (a 404 is no systems, as above). What sorts systems by their
 *  entry (Treasury, Outside systems, Sources) is drawn only once it answered, and says the error when it failed. */
export function useSystemsRead(): { entries: SystemEntries; pending: boolean; error: Error | null } {
  const q = useQuery({ queryKey: ['registry', 'systems'], queryFn: () => api.registry('systems'), retry: false })
  const entries = useMemo(() => new Map((q.data?.entries ?? []).map(e => [String(e.id), e as Record<string, unknown>])), [q.data])
  // the last failure, kept while a reader that mounts fetches the file again: that fetch, with no data, clears the
  // query's error, so it is kept per client, for every reader — one that mounts later too (DP-51's cost) — until a
  // success arrives
  const qc = useQueryClient()
  if (q.error) lastFailure.set(qc, q.error)
  else if (q.isSuccess) lastFailure.delete(qc)
  const failed = q.error ?? (q.isFetching && q.errorUpdatedAt > q.dataUpdatedAt ? lastFailure.get(qc) ?? null : null)
  const error = failed && !(failed instanceof ApiError && failed.status === 404) ? failed : null
  // pending until it has answered once, as `useEntryOf` (D-12): a refetch after a failure is not pending again, or what
  // waits for it would unmount the reader that set it off, and take turns with it
  return { entries, pending: q.isPending && q.dataUpdatedAt === 0 && q.errorUpdatedAt === 0, error }
}
