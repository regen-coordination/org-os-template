import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ChangeView, type StageOp } from '../api.ts'

/** Your staged change (contract: /api/changes). Every write answers with the change as the server
 *  now holds it, and that answer becomes the cached change; other tabs refresh on { type: 'changes' }. */
export function useChanges() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['changes'], queryFn: api.changes })
  return useMemo(() => {
    const put = (v: ChangeView) => { qc.setQueryData(['changes'], v) }
    return {
      view: q.data ?? null,
      error: q.error ? q.error.message : null,
      stage: async (ops: StageOp[]) => put(await api.stage(ops)),
      unstage: async (n: number) => put(await api.unstage(n)),
      rebase: async (n: number, keep: 'mine' | 'theirs') => put(await api.rebase(n, keep)),
      discard: async () => { await api.discard(); await qc.invalidateQueries({ queryKey: ['changes'] }) },
      apply: async () => {
        const done = await api.apply()
        for (const queryKey of [['changes'], ['registry'], ['resource'], ['resources'], ['graph'], ['boards'], ['generated']]) void qc.invalidateQueries({ queryKey })
        return done
      },
    }
  }, [q.data, q.error, qc])
}
