import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { api, type OperationInfo, type Resource } from '../api.ts'
import { kindLabel } from '../kinds.ts'
import { ago } from '../time.ts'
import { Section } from '../design/Section.tsx'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import ConfirmBox from './ConfirmBox.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import JobLog from './JobLog.tsx'

/** An operation that needs nothing filled in and asks no confirmation runs on a click. */
export const runsOnClick = (o: OperationInfo): boolean =>
  !o.confirm && (o.preset !== null || Object.keys(o.params.properties ?? {}).length === 0)

/** The record's operations (§14.1): each a button named by what it does, its effect beside it ("reads · network ·
 *  asks first"); one that cannot run is held with its reason (aria-disabled, the reason beside it). A plain read runs
 *  on a press; the rest open the confirm dialog (plan → nonce → job). The job's log opens below, in its Mono well;
 *  past runs open theirs. `?op=&opLabel=` opens one op's dialog, once. Running an operation is a write: while
 *  previewing (C-23) none is offered — no buttons, no dialog from the address, no Cancel on a log — and only the past
 *  runs are listed. */
export default function Operations({ resource }: { resource: Resource }) {
  const id = resource.id
  const ops = useQuery({ queryKey: ['operations', id], queryFn: () => api.operations(id) })
  const jobs = useQuery({ queryKey: ['jobs', id], queryFn: () => api.jobs(id) })
  const qc = useQueryClient()
  const [path, navigate] = useLocation()
  const search = useSearch()
  const params = new URLSearchParams(search)
  const asked = params.get('op') ? { id: params.get('op')!, label: params.get('opLabel') ?? '' } : null
  const [confirming, setConfirming] = useState<OperationInfo | null>(null)
  const [openJob, setOpenJob] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canWrite = useCanWrite()

  // A deep-linked operation opens its box once: the address is cleared at once, so a later refetch
  // of the operations cannot reopen a box the operator cancelled.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!asked) { handled.current = null; return }
    if (!ops.data || !canWrite) return
    const key = `${asked.id}\u0000${asked.label}`
    if (handled.current === key) return
    const o = ops.data.find(x => x.id === asked.id && x.label === asked.label && x.unavailable === null)
    if (!o) return
    handled.current = key
    setConfirming(o)
    params.delete('op'); params.delete('opLabel')
    const rest = params.toString()
    navigate(rest ? `${path}?${rest}` : path, { replace: true })
  }, [asked?.id, asked?.label, ops.data, canWrite])

  if (resource.kind === 'absent') return null
  const started = (jobId: string) => { setConfirming(null); setOpenJob(jobId); void qc.invalidateQueries({ queryKey: ['jobs'] }) }
  const act = async (o: OperationInfo) => {
    setError(null)
    if (!runsOnClick(o)) { setConfirming(o); return }
    try { started((await api.runJob({ op: o.id, resource: id, params: o.preset ?? {} })).id) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const list = ops.data ?? []
  const history = jobs.data ?? []
  return (
    <>
      {canWrite && <Section label="Operations" id="operations" count={list.length > 0 ? list.length : undefined}>
        {ops.error && <Refusal>{ops.error.message}</Refusal>}
        {list.length === 0 && !ops.error && (ops.isPending
          ? <Note state="loading">Loading…</Note>
          : <Note state="empty">No operations apply to this {kindLabel(resource.kind)}.</Note>)}
        {list.length > 0 && (
          <ul className="ops" aria-label="Operations">
            {list.map(o => (
              <li key={`${o.id}:${o.label}`} className="ops-i">
                <Button unavailable={o.unavailable ?? undefined} onClick={() => void act(o)}>{o.label}</Button>
                <span className="ops-k">{o.effect}{o.network ? ' · network' : ''}{runsOnClick(o) ? '' : ' · asks first'}</span>
                {o.unavailable && <span className="ops-why">{o.unavailable}</span>}
              </li>
            ))}
          </ul>
        )}
        {error && <Refusal>{error}</Refusal>}
        {confirming && <ConfirmBox key={`${confirming.id}:${confirming.label}`} op={confirming} resource={resource} onCancel={() => setConfirming(null)} onDone={job => started(job.id)} />}
        {openJob && !history.some(j => j.id === openJob) && <JobLog jobId={openJob} />}
      </Section>}
      {history.length > 0 && (
        <Section label="Runs" count={history.length}>
          <ul className="ops-runs">
            {history.map(j => (
              <li key={j.id}>
                <button type="button" className="x" aria-expanded={openJob === j.id} onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>
                  {j.label} · {j.status} · {ago(j.created)}
                </button>
                {openJob === j.id && <JobLog jobId={j.id} canCancel={canWrite} />}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
