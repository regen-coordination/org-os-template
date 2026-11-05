import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { useChanges } from '../changes/useChanges.ts'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { runningJobs } from '../map/flow.ts'
import { useNow } from '../time.ts'
import type { MarkContext } from '../parts/marks.ts'
import type { BlockCtx } from './types.ts'

/** What every block reads besides its own data: the time (ticking while a job runs), the marks'
 *  sources (your change, the jobs, the selection), and staging, the only way a block writes. */
export function useBlockCtx(): BlockCtx {
  const changes = useChanges()
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs() })
  const inspector = useInspector()
  const running = useMemo(() => runningJobs(jobs.data ?? []), [jobs.data])
  const now = useNow([...running.values()].some(j => j.status === 'running'))
  // The marks' sources change with your change, the jobs and the selection, never with the clock: a
  // tick must not hand a map a new marks function, or it rebuilds its nodes (a dragged one snaps back).
  const marks = useMemo<MarkContext>(() => ({ change: changes.view, jobs: running, selected: inspector.id }), [changes.view, running, inspector.id])
  return useMemo(() => ({ now, marks, stage: changes.stage }), [now, marks, changes.stage])
}
