import { Link } from 'wouter'
import type { JobRecord, JobStatus, Resource } from '../api.ts'
import type { Column } from '../design/Rows.tsx'
import { StatusMark, type Mark } from '../design/StatusMark.tsx'
import { recordHref } from '../hrefs.ts'
import { clock, seconds, stamp, useNow } from '../time.ts'

/** A job's status as a mark and its words (§14.1 `jobs.tsx`: the running status): queued is open, running turns the
 *  reading ring, ok is done, a cancel is closed, and every other end is failed — each said in words, never colour
 *  alone. */
export const JOB_MARK: Record<JobStatus, { mark: Mark; word: string }> = {
  queued: { mark: 'open', word: 'Queued' }, running: { mark: 'running', word: 'Running' }, ok: { mark: 'done', word: 'Done' },
  cancelled: { mark: 'closed', word: 'Cancelled' }, failed: { mark: 'failed', word: 'Failed' }, 'timed-out': { mark: 'failed', word: 'Timed out' },
  interrupted: { mark: 'failed', word: 'Interrupted' }, 'finished-with-surprises': { mark: 'failed', word: 'Finished with surprises' },
}
const markOf = (status: JobStatus) => JOB_MARK[status] ?? { mark: 'failed' as const, word: String(status) }

/** A job's status mark. A running job's says how long it has run, ticking each second; it is mounted only while the
 *  job runs, so nothing else ticks. */
export function JobMark({ job }: { job: Pick<JobRecord, 'status' | 'created' | 'started'> }) {
  if (job.status === 'running') return <RunningMark job={job} />
  const { mark, word } = markOf(job.status)
  return <StatusMark mark={mark} label={word} />
}

function RunningMark({ job }: { job: Pick<JobRecord, 'created' | 'started'> }) {
  const now = useNow(true)
  return <StatusMark mark="running" label={`Running ${seconds(job.started ?? job.created, now)} s`} />
}

/** A job as a row: when, what ran, on what, and its status mark. `full` adds the date and the sentence. */
export function jobColumns(byId: Map<string, Resource>, full: boolean): Column<JobRecord>[] {
  const cols: Column<JobRecord>[] = [
    { key: 'when', label: 'when', mono: true, sort: j => j.created, cell: j => (full ? stamp(j.created) : clock(j.created)) },
    { key: 'op', label: 'operation', sort: j => j.label, cell: j => j.label },
    { key: 'on', label: 'on', cell: j => {
      const r = byId.get(j.resource)
      return r ? <Link href={recordHref(j.resource)}>{r.name}</Link> : <span className="faint">{j.resource}</span>
    } },
    { key: 'result', label: 'result', sort: j => j.status, cell: j => <JobMark job={j} /> },
  ]
  if (full) cols.push({ key: 'sentence', label: 'what it said', cell: j => (j.sentence ? <span className="wrap">{j.sentence}</span> : '') })
  return cols
}
