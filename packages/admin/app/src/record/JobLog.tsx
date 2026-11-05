import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, FINAL_STATUSES } from '../api.ts'
import { onJobOutput } from '../jobLogs.ts'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { JOB_MARK } from '../pages/jobs.tsx'
import { StatusMark } from '../design/StatusMark.tsx'

/** What the log shows while the job runs: the server's snapshot, then the streamed lines the snapshot
 *  does not already hold. The stream began before the snapshot was built, so its first lines may be
 *  the snapshot's tail; those are dropped, and the rest come after it. */
export function merge(log: string, live: string): string {
  for (let k = live.length; k > 0; k--) if (log.endsWith(live.slice(0, k))) return log + live.slice(k)
  return log + live
}

/** A job's log (§14.2 `record/JobLog`): its status mark — the running ring while it runs, with Cancel — then what it
 *  said once it ended, then the log in a Mono well: what the server kept so far, then what streams in. Once the job
 *  has ended, the server's whole log replaces the stream (the stream may have missed its first lines). `canCancel`
 *  false (previewing: a cancel is a write, C-23) draws no Cancel. */
export default function JobLog({ jobId, canCancel = true }: { jobId: string; canCancel?: boolean }) {
  const { data, error } = useQuery({ queryKey: ['job', jobId], queryFn: () => api.job(jobId) })
  const [live, setLive] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const qc = useQueryClient()
  const ended = data ? FINAL_STATUSES.includes(data.job.status) : false
  useEffect(() => { setLive(''); return onJobOutput(jobId, chunk => setLive(l => l + chunk)) }, [jobId])
  useEffect(() => { if (ended) setCancelError(null) }, [ended])
  const cancel = async () => {
    setCancelError(null)
    try { await api.cancelJob(jobId); void qc.invalidateQueries({ queryKey: ['job', jobId] }) }
    catch (err) { setCancelError(err instanceof Error ? err.message : String(err)) }
  }
  if (error) return <Refusal>{error.message}</Refusal>
  if (!data) return <Note state="loading">Loading the log…</Note>
  const mark = JOB_MARK[data.job.status] ?? { mark: 'failed' as const, word: String(data.job.status) }
  return (
    <div className="joblog" role="group" aria-label={`${data.job.label} log`}>
      <div className="joblog-h"><StatusMark mark={mark.mark} label={mark.word} />{!ended && canCancel && <Button small onClick={cancel}>Cancel</Button>}</div>
      {cancelError && <Refusal>{cancelError}</Refusal>}
      {ended && data.job.sentence && (data.job.status === 'ok'
        ? <p className="joblog-said">{data.job.sentence}</p>
        : <Refusal>{data.job.sentence}</Refusal>)}
      <pre className="mono-well joblog-out">{ended ? data.log : merge(data.log, live)}</pre>
    </div>
  )
}
