import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, FINAL_STATUSES, type JobRecord, type OperationInfo, type PlanReply } from '../api.ts'
import { Button } from '../design/Button.tsx'
import ConfirmBox from '../record/ConfirmBox.tsx'
import { Refusal, SyncConfirmation, SyncLine } from '../parts/SyncParts.tsx'

type Open = 'sync' | 'share' | null

/** git's words for a push the remote refused because it has commits this clone lacks (spec §3.12, proof P). */
const REJECTED = /\[rejected\]|non-fast-forward|\(fetch first\)/

/** How a finished Share job is said: what the remote now holds, or why not. A rejection is never retried (spec §3.12):
 *  the member is told to Sync, then Share again. */
export function shareOutcome(job: Pick<JobRecord, 'status' | 'sentence'>, trunk: string): { said: string } | { refused: string } {
  if (job.status === 'ok') return { said: `Shared: origin now holds ${trunk}.` }
  const sentence = (job.sentence ?? '').trim()
  if (REJECTED.test(sentence)) return { refused: 'The remote has commits this clone lacks: Sync, then Share again.' }
  return { refused: `Not shared. ${sentence || `The job ended ${job.status}.`}` }
}

/** Sync and Share on the Proposals page (spec 3.12, P2-R18; §14.1 "tray foot line + confirm dialog"): the foot line of
 *  what the last fetch says, read without the network, with the two buttons at its end, and the confirmation each
 *  opens. Sync is the `fetch` operation's plan, then POST /api/sync with its nonce, confirmed in a modal dialog; Share
 *  is the `share` operation, run like any confirmed operation, and its job is followed to its end so what the remote
 *  did is said (a rejection with what to do next). A refusal is an error note, said once (E-58). `head` is the line
 *  (under the page head), `panel` what it opens and says. While previewing neither is drawn: both write (C-23). */
export function useSyncShare(): { head: ReactNode; panel: ReactNode } {
  const qc = useQueryClient()
  const read = useQuery({ queryKey: ['sync'], queryFn: api.syncRead, retry: false })
  const resources = useQuery({ queryKey: ['resources'], queryFn: api.resources })
  const self = resources.data?.find(r => r.kind === 'instance' && r.facts.self === true)
  const ops = useQuery({ queryKey: ['operations', self?.id], queryFn: () => api.operations(self!.id), enabled: !!self })
  const share: OperationInfo | undefined = ops.data?.find(o => o.id === 'share')
  const [open, setOpen] = useState<Open>(null)
  const [plan, setPlan] = useState<PlanReply | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false) // set at once, so a second click before the next render cannot send the nonce again
  const [said, setSaid] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null) // the Share job being followed to its end
  const followed = useQuery({
    queryKey: ['job', sharing], queryFn: () => api.job(sharing!), enabled: sharing !== null,
    // the server's job-finished event refreshes it at once; the interval is for a page whose socket is down
    refetchInterval: q => (q.state.data && FINAL_STATUSES.includes(q.state.data.job.status) ? false : 1000),
  })
  const noRemote = read.data !== undefined && read.data.remote === null
  const settled = () => { for (const k of ['sync', 'governance', 'proposals', 'generated', 'jobs']) void qc.invalidateQueries({ queryKey: [k] }) }
  const fail = (err: unknown) => setRefused(err instanceof Error ? err.message : String(err))

  // The dialog opens once the plan is read: until then Sync says it is planning, and a plan refused is said instead.
  const startSync = async () => {
    if (!self || busy) return
    setSaid(null); setRefused(null); setPlan(null); setBusy(true)
    try { setPlan(await api.plan('fetch', self.id, {})); setOpen('sync') } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const confirmSync = async () => {
    if (!plan?.nonce || sending.current) return
    sending.current = true
    setBusy(true); setRefused(null)
    try {
      const done = await api.sync(plan.nonce)
      setSaid(done.sentence ?? 'Synced.'); closeSync(); settled()
    } catch (err) { fail(err); closeSync(); settled() } finally { sending.current = false; setBusy(false) }
  }
  const closeSync = () => { setOpen(null); setPlan(null); setTimeout(() => document.getElementById('sync-button')?.focus(), 0) }
  const startShare = () => { setSaid(null); setRefused(null); setSharing(null); setOpen('share') }
  const trunk = read.data?.trunk ?? 'the trunk'
  const ended = followed.data && FINAL_STATUSES.includes(followed.data.job.status) ? followed.data.job : null
  useEffect(() => {
    if (!sharing || !ended || ended.id !== sharing) return
    const out = shareOutcome(ended, trunk)
    setSharing(null)
    if ('said' in out) setSaid(out.said); else { setSaid(null); setRefused(out.refused) }
    settled()
  }, [sharing, ended, trunk])
  useEffect(() => { if (sharing && followed.error) { setSharing(null); setSaid(null); setRefused(`Could not read how the Share ended (${followed.error.message}); the Jobs page keeps its log.`) } }, [sharing, followed.error])
  const why = noRemote ? read.data!.sentence : undefined

  const head = (
    <SyncLine sentence={read.data?.sentence ?? (read.error ? 'What the last fetch says could not be read.' : 'Reading what the last fetch says…')}>
      <Button id="sync-button" label="Sync" disabled={!self || noRemote} busy={busy && open === null ? 'Planning…' : undefined} title={why} onClick={() => void startSync()}>Sync</Button>
      <Button label="Share" disabled={!share || share.unavailable !== null || noRemote || sharing !== null} title={why ?? share?.unavailable ?? undefined} onClick={startShare}>Share</Button>
    </SyncLine>
  )
  const panel = (
    <>
      {open === 'sync' && plan && (
        <SyncConfirmation summary={plan.summary ?? 'Fetch the remote.'} onConfirm={() => void confirmSync()} onCancel={closeSync} />
      )}
      {open === 'share' && self && share && (
        <ConfirmBox key="share" op={share} resource={self} onCancel={() => setOpen(null)}
          onDone={job => { setOpen(null); setSharing(job.id); setSaid(`Sharing ${trunk} with origin…`) }} />
      )}
      {refused && <Refusal>{refused}</Refusal>}
      {said && <p role="status">{said}</p>}
    </>
  )
  return { head, panel }
}
