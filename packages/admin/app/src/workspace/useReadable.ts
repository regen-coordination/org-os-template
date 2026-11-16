// 0.7.1 (D6): whether the viewer may open a path in the source editor. Only a path of the agent layer (lib/workspace/
// editors.mjs `readsDeciders`) asks GET /api/editors, which says it per row for the viewer; any other path is readable
// at once, and nothing is fetched for it.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { readsDeciders } from '../../../lib/workspace/editors.mjs'
import { readableIn } from './files.ts'

export function useFileReadable(path: string): boolean {
  const gated = readsDeciders(path)
  const editors = useQuery({ queryKey: ['editors'], queryFn: api.editors, retry: false, staleTime: Number.POSITIVE_INFINITY, enabled: gated })
  return readableIn(editors.data, path)
}
