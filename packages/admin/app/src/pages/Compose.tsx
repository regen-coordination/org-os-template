import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api, type StageOp } from '../api.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Note } from '../design/Note.tsx'
import { Empty } from '../design/Empty.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { ComposeCanvas } from '../elements/compose/ComposeCanvas.tsx'
import { chainName } from '../elements/atoms/chain.ts'
import { composeFromSystems } from '../compose/fromSystems.ts'
import { useChanges } from '../changes/useChanges.ts'
import { useSystemsRead } from '../queries.ts'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { OPEN_CHANGES, OPEN_PROPOSE } from '../keys/useHouseKeys.ts'
import { announce } from '../parts/live.tsx'
import { useActor } from '../actor.ts'

/** The kinds the canvas places (L7 §7.2): what a composition deploys (a Safe, a Hats tree and its hats, a Snapshot
 *  space) and a link, which is listed and never deployed. */
export const COMPOSE_SHELF = ['safe', 'hats-tree', 'hat', 'snapshot-space', 'link']
const NONE: readonly StageOp[] = []
const PREFIX = 'systems:'

/** /compose (DAO-OS L7 Task 17, spec §6, §7): the compose canvas on the org's composed Systems, read from
 *  data/systems.yaml through the actor's own change, so what is staged shows at once (`composeFromSystems`). Every
 *  canvas action stages into that change (`POST /api/changes/ops`); a refusal is said in an error note and through the
 *  page's one polite region, and the canvas is drawn again as the change stands. The foot's Review order opens the
 *  Changes tray and Propose its Propose panel (`house:open-propose`); with nothing of the composition staged there is
 *  nothing to review, and the foot says the composition is composed. The count of prepared transactions is the
 *  planner's: GET /api/deploy's steps (Task 11), the committed composition's on the chain as read. Until it is read, and
 *  whenever it answers no plan (nothing committed is composed, the composition is only staged, the chain could not be
 *  read), none is drawn; previewing, it is not asked (the plan is the member's, not the audience's). With a plan, the
 *  foot links to its steps on /deploy (Task 18). A composed System every step of which the plan says is done is held by the
 *  chain: its node reads "on chain" and its inspector says Read back records it (whole-platform walk I13); /compose stays
 *  drawn from the records.
 *
 *  Invisible means absent (§6.3): only the records the viewer may read are drawn, and previewing, nothing staged is
 *  projected and nothing that writes is drawn (the canvas's own rule, C-23). An actor who is no member reads the
 *  canvas as a record page is read: without its write controls (C11, C17). */
export default function Compose() {
  const who = useActor()
  const canWrite = useCanWrite() && who.known
  const { viewer, previewing, sees } = useViewer()
  const read = useSystemsRead()
  const ch = useChanges()
  const [refusal, setRefusal] = useState<string | null>(null)
  /** Drawn again from the records after a refusal: the canvas had already moved as if the stage went through. */
  const [generation, setGeneration] = useState(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const records = useMemo(() => [...read.entries.values()].filter(sees), [read.entries, viewer])
  const staged = previewing ? NONE : ch.view?.ops ?? NONE
  const composition = useMemo(() => composeFromSystems(records, staged as StageOp[]), [records, staged])
  // The planner's count (PF-R156's seam): read once the canvas has something to count, never while previewing. A plan
  // reads the chain (paced), so it is not read again on every focus.
  const deploy = useQuery({ queryKey: ['deploy'], queryFn: api.getDeploy, retry: false, refetchOnWindowFocus: false, staleTime: 60_000,
    enabled: !previewing && composition.nodes.length > 0 })
  const prepared = !previewing && deploy.data ? { steps: deploy.data.steps.length } : null
  // The composed Systems the chain holds (walk I13): the plan prepares steps for them and every one is done. The records
  // stay composed until Read back records them; the canvas says so rather than "not deployed".
  const onChain = useMemo(() => {
    const steps = !previewing && deploy.data ? deploy.data.steps : []
    const systems = new Set(steps.map(st => st.system))
    return new Set([...systems].filter(id => steps.every(st => st.system !== id || st.status === 'done')))
  }, [previewing, deploy.data])

  // Whether the actor's change stages any of the composition: a System drawn here, or one composed on the trunk.
  const ids = useMemo(() => new Set([
    ...composition.nodes.map(n => n.tree ?? n.id),
    ...records.filter(r => (r.deployment as { status?: unknown } | undefined)?.status === 'composed').map(r => String(r.id)),
  ]), [composition, records])
  const stagesIt = staged.some(op => 'record' in op && typeof op.record === 'string' && op.record.startsWith(PREFIX) && ids.has(op.record.slice(PREFIX.length)))

  const onStage = async (ops: StageOp[]) => {
    setRefusal(null)
    try {
      await ch.stage(ops)
    } catch (err) {
      const said = err instanceof ApiError && err.errors.length > 0 ? err.errors.map(e => e.message).join(' ') : err instanceof Error ? err.message : String(err)
      setRefusal(said)
      announce(said)
      setGeneration(g => g + 1)
    }
  }

  const head = <PageHead title="Compose" meta={[chainName(composition.chain), 'composed, not deployed']}
    about="A composition is a plan: nothing is deployed until it is applied or proposed, prepared from what was decided, and its signers run it." />
  // until who you are is read, the page cannot say whether you may write here: it waits, rather than draw twice
  if (read.pending || (who.actor === null && who.error === null)) return <>{head}<Skeleton rows={4} shape="row" label="Compose" /></>
  if (read.error) return <>{head}<Note state="error">{read.error.message}</Note></>
  if (composition.nodes.length === 0 && !canWrite) return <>{head}<Empty>Nothing composed is shown.</Empty></>

  return (
    <>
      {head}
      {composition.nodes.length === 0 && (
        <Note state="empty">Nothing is composed yet. Place a System below, or compose a DAO from a wizard in the <Link href="/library">library</Link>.</Note>
      )}
      {refusal && <Note state="error">{refusal}</Note>}
      <ComposeCanvas key={generation} shelf={COMPOSE_SHELF} nodes={composition.nodes} edges={composition.edges} chain={composition.chain}
        onStage={ops => { void onStage(ops) }} prepared={prepared} deployHref={prepared ? '/deploy' : undefined} staged={stagesIt} readOnly={!who.known} onChain={onChain}
        onReview={() => window.dispatchEvent(new Event(OPEN_CHANGES))} onPropose={() => window.dispatchEvent(new Event(OPEN_PROPOSE))} />
    </>
  )
}
