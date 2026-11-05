import { useQuery } from '@tanstack/react-query'
import { api, type JobRecord, type Resource } from '../api.ts'
import { useResources } from '../queries.ts'
import { recordHref } from '../hrefs.ts'
import { stamp } from '../time.ts'
import { PageHead } from '../design/PageHead.tsx'
import { ListView } from '../elements/views/ListView.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { JobMark } from './jobs.tsx'

/** One run as an event row: what ran, on what and what it said, when, and its status mark; the row opens the record it
 *  ran on, when that is here. */
function RunRow({ job, on }: { job: JobRecord; on: Resource | undefined }) {
  const at = stamp(job.created)
  return (
    <DataRow kind="operation" title={job.label} href={on ? recordHref(job.resource) : undefined} marks={[]}
      second={<>{on ? on.name : <span className="faint">{job.resource}</span>}{job.sentence && <> · <span className="wrap">{job.sentence}</span></>}</>}
      trailing={<>{at && <time className="age" dateTime={job.created} title={job.created}>{at}</time>}<JobMark job={job} /></>} />
  )
}

/** Every operation run, newest first (§14.1, "Activity → a list view of events"): a data row per run. The activity
 *  trail of every change replaces it later (P3). */
export default function Activity() {
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs() })
  const resources = useResources()
  const byId = new Map((resources.data ?? []).map(r => [r.id, r]))
  return (
    <>
      <PageHead title="Activity" meta={[jobs.data ? `${jobs.data.length} operation run${jobs.data.length === 1 ? '' : 's'}` : null, 'newest first', 'the latest 50']} />
      <ListView label="Activity" rows={jobs.data ?? []} loading={jobs.isPending ? 4 : undefined} error={jobs.error?.message} onRetry={() => void jobs.refetch()}
        empty={{ title: 'No operations have run yet.', line: 'A record’s operations, run from its page, are listed here.' }}
        row={j => <RunRow key={j.id} job={j} on={byId.get(j.resource)} />} />
    </>
  )
}
