import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, type DeployPlan, type DeployStep, type ReadBack, type Ran } from '../api.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Note, type NoteState } from '../design/Note.tsx'
import { Empty } from '../design/Empty.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { Section } from '../design/Section.tsx'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { StatusMark, type Mark } from '../design/StatusMark.tsx'
import { AccountStep, ENS_OWNER } from '../elements/governance/AccountStep.tsx'
import { PreparedTx } from '../elements/governance/PreparedTx.tsx'
import { preparedFromSteps } from '../elements/governance/prepared.ts'
import { chainName } from '../elements/atoms/chain.ts'
import { useSystemsRead } from '../queries.ts'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { OPEN_CHANGES } from '../keys/useHouseKeys.ts'
import { announce } from '../parts/live.tsx'
import { useActor } from '../actor.ts'
import { When } from '../elements/atoms/FromMark.tsx'
import { ageText } from '../time.ts'

/** Each status's mark and word (L7 Task 18: Ready, Waits, Done, Doesn't match). */
const MARK: Record<DeployStep['status'], { mark: Mark; word: string }> = {
  ready: { mark: 'open', word: 'Ready' }, waits: { mark: 'aged', word: 'Waits' }, done: { mark: 'done', word: 'Done' }, mismatch: { mark: 'failed', word: 'Doesn’t match' },
}
/** A read-back status's mark and word. */
const READ: Record<ReadBack['systems'][number]['status'], { mark: Mark; word: string }> = {
  deployed: { mark: 'done', word: 'Deployed' }, pending: { mark: 'aged', word: 'Not yet' }, mismatch: { mark: 'failed', word: 'Doesn’t match' },
}
/** What GET /api/deploy answers instead of a plan, as the page's note draws it. */
const NO_PLAN: Record<string, NoteState> = { NOTHING_COMPOSED: 'empty', STAGED_ONLY: 'notYet', PART_HIDDEN: 'unavailable' }
/** Added to a refused flip that would lock the org out (L7 Review Focus 4): what makes it go through. */
export const ADD_A_WEARER = 'Add a wearer who can propose to the composed tree, then read back again.'
const LOCKOUT = /nobody can propose/

const plural = (n: number) => `${n} prepared transaction${n === 1 ? '' : 's'}, in order`
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the signer ran (L7 ruling P2), as the read-back takes it: the plan's ready steps, with the predictions each was
 *  prepared on. A step that is done since reads nothing amiss; one whose place the chain now gives to someone else is a
 *  mismatch, and nothing is staged. */
export function ranOf(plan: DeployPlan): Ran[] {
  return plan.steps.filter(s => s.status === 'ready').map(s => ({ step: s.id, system: s.system, predicts: s.predicts.map(p => ({ kind: p.kind, value: p.value })) }))
}

/** Who signs a step, in words. */
function signerWords(step: DeployStep, nameOf: (id: string) => string): string {
  if (step.signer.kind === 'safe') return `${nameOf(step.signer.system)} signs, in the Safe app`
  if (step.id === 'space:settings') return 'The ENS name’s owner, in the Snapshot app'
  if (step.id === 'registration:daouri') return ENS_OWNER
  return 'Any account, from its own wallet'
}

/** The Snapshot space's settings to paste (spec §8.4): the JSON in a Mono well with Copy, and its links: the name in
 *  the ENS app, the testnet's create page, the space. Nothing is posted; a mismatch keeps the draft to paste again. */
function SpaceDraft({ draft }: { draft: NonNullable<DeployStep['draft']> }) {
  const json = JSON.stringify(draft.settings, null, 2)
  const [refused, setRefused] = useState(false)
  const shown = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!refused || !shown.current) return
    try { window.getSelection()?.selectAllChildren(shown.current) } catch { /* nothing selectable: the JSON is still shown */ }
  }, [refused])
  async function copy() {
    try {
      const board = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!board?.writeText) throw new Error('no clipboard here')
      await board.writeText(json)
    } catch {
      setRefused(true)
      announce('Couldn’t copy. Select the settings and copy them.')
      return
    }
    setRefused(false)
    announce('Copied the settings.')
  }
  return (
    <div className="dep-draft">
      <p className="dep-line">Set these as the space’s settings on Snapshot, signed by the owner of {draft.space}; the Hub posts nothing.</p>
      <pre ref={shown} className="dep-json">{json}</pre>
      <div className="dep-links">
        <Button variant="ghost" onClick={() => { void copy() }}>Copy settings</Button>
        <ButtonLink href={draft.links.name} external>{draft.space} in the ENS app</ButtonLink>
        <ButtonLink href={draft.links.create} external>Create the space</ButtonLink>
        <ButtonLink href={draft.links.space} external>Open the space</ButtonLink>
      </div>
    </div>
  )
}

/** One step: its number, title, who signs it and for which System, its mark; what it waits for; a ready step's
 *  warnings (its `differs`); a mismatch's findings; and, ready, what to run: the prepared-transaction card for a Safe
 *  step, the account-step card for an account step, the settings for the Snapshot space. */
function StepRow({ step: given, n, nameOf, readDeployed }: {
  step: DeployStep; n: number; nameOf: (id: string) => string
  /** The read-back drawn beside the plan reads this step's System deployed, and the plan was read before it (fix I-2):
   *  a ready step is then drawn done, with nothing to run, until the plan is read again. */
  readDeployed: boolean
}) {
  const step: DeployStep = readDeployed && given.status === 'ready' ? { ...given, status: 'done' } : given
  const mark = MARK[step.status]
  const differs = step.status === 'done' ? [] : step.differs ?? []
  const ready = step.status === 'ready'
  // M-4: the card's threshold is the one the server says the step carries (read on chain), never the page's guess.
  const safeCard = ready && step.step?.safe && step.signer.kind === 'safe'
    ? preparedFromSteps([step.step], { name: nameOf(step.signer.system), facts: typeof step.threshold === 'number' ? { threshold: step.threshold } : {} })[0] : undefined
  return (
    <li className="dep-step">
      <div className="dep-h">
        <span className="ptx-n" aria-hidden="true">{n}</span>
        <div className="dep-main">
          <h3 className="dep-t">{step.title}</h3>
          <div className="dep-s">{signerWords(step, nameOf)} · {nameOf(step.system)}</div>
        </div>
        <StatusMark mark={mark.mark} label={mark.word} />
      </div>
      {step.status === 'waits' && step.waits && <p className="dep-w">{step.waits}</p>}
      {step !== given && <p className="dep-w">Read back as deployed.</p>}
      {differs.length > 0 && (
        <ul className={step.status === 'mismatch' ? 'dep-off' : 'dep-warn'} aria-label={step.status === 'mismatch' ? 'What the chain shows' : 'Before you run it'}>
          {differs.map(d => <li key={d}><Icon name="alert" size="sm" /><span>{d}</span></li>)}
        </ul>
      )}
      {safeCard && <PreparedTx tx={safeCard} now={new Date()} openPrimary={false} />}
      {ready && step.step && !step.step.safe && <AccountStep step={step} />}
      {step.draft && step.status !== 'done' && <SpaceDraft draft={step.draft} />}
    </li>
  )
}

/** The read-back's Systems as field rows: each System's name, its mark and what differs. */
function ReadBackRows({ readBack, nameOf }: { readBack: ReadBack; nameOf: (id: string) => string }) {
  if (readBack.systems.length === 0) return null
  return (
    <FieldTable label="Read back">
      {readBack.systems.map(s => (
        <FieldRow key={s.id} label={nameOf(s.id)}>
          <StatusMark mark={READ[s.status].mark} label={READ[s.status].word} />{s.differs.length > 0 ? `: ${s.differs.join('; ')}` : ''}
        </FieldRow>
      ))}
    </FieldTable>
  )
}

/** A refused read-back in its own words: the server's sentence (MISMATCH, PART_HIDDEN, CHANGE_EDITS, KEPT_PRIVATE,
 *  NOT_ADMITTED, PRIVATE_STORE, STAGED_ONLY, NOTHING_COMPOSED, a 502 naming the node's host only), or a 422's engine sentences, the lockout's with
 *  what to do. The read-back's rows come with a mismatch only. */
function refusalOf(err: unknown): { said: string; readBack: ReadBack | null } {
  if (!(err instanceof ApiError)) return { said: err instanceof Error ? err.message : String(err), readBack: null }
  if (err.status === 422 && err.errors.length > 0) {
    const messages = err.errors.map(e => e.message)
    return { said: [...messages, ...(messages.some(m => LOCKOUT.test(m)) ? [ADD_A_WEARER] : [])].join(' '), readBack: null }
  }
  const rb = err.code === 'MISMATCH' && isObj(err.body.readBack) && Array.isArray((err.body.readBack as { systems?: unknown }).systems) ? err.body.readBack as unknown as ReadBack : null
  return { said: err.message, readBack: rb }
}

/** /deploy (DAO-OS L7 Task 18, spec §8, §9): the committed composition's deployment, step by step, as GET /api/deploy
 *  prepares it — each step in order with its mark, who signs it, what it waits for, a ready step's warnings, a
 *  mismatch's findings, and what to run: a Safe step as its prepared transaction (PreparedTx), an account step as the
 *  account-step card, the Snapshot space as its settings and links. **Read back** (the page's one primary) posts what
 *  the signer ran and, when the chain shows something new, opens the Changes tray on what it staged; a refusal is said
 *  in its own sentence, in an error note (the page's one polite region says it once), and nothing is staged.
 *
 *  Invisible means absent (PF-R172, PF-R184): the page draws only what the server answers. Previewing, the plan is not asked (it
 *  is the member's, not the audience's): no steps, no addresses. A composition the viewer may read only part of is the
 *  server's PART_HIDDEN sentence; one they may not read at all is nothing composed. An actor who is no member reads the
 *  steps without Read back (it stages into a member's change). */
export default function Deploy() {
  const who = useActor()
  const canWrite = useCanWrite() && who.known
  const { viewer, previewing, sees } = useViewer()
  const read = useSystemsRead()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{ said: string; readBack: ReadBack | null } | null>(null)
  const [found, setFound] = useState<ReadBack | null>(null)
  /** G4: the read-back staged the Systems while the governance could not take the Safes' on_deploy: why, in words. */
  const [kept, setKept] = useState<string | null>(null)
  /** When the last read-back answered (Date.now()), to tell a plan read before it from one read after (fix I-2). */
  const [answeredAt, setAnsweredAt] = useState(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const records = useMemo(() => [...read.entries.values()].filter(sees), [read.entries, viewer])
  const nameOf = (id: string) => { const r = records.find(x => String(x.id) === id); return typeof r?.name === 'string' && r.name !== '' ? r.name : id }
  // The plan is the chain as it was read (paced on the server), so it is read again whenever it may have moved (fix
  // I-2): after every read-back answer, and when the window takes focus or the page is shown again; never previewing.
  // One read at a time: a focus and a visibility change together ask once.
  const deploy = useQuery({ queryKey: ['deploy'], queryFn: api.getDeploy, retry: false, refetchOnWindowFocus: false, staleTime: 60_000, enabled: !previewing })
  const plan = !previewing ? deploy.data ?? null : null
  const readAgain = () => { void qc.invalidateQueries({ queryKey: ['deploy'] }, { cancelRefetch: false }) }
  useEffect(() => {
    if (previewing) return
    const shown = () => { if (document.visibilityState !== 'hidden') readAgain() }
    window.addEventListener('focus', shown)
    document.addEventListener('visibilitychange', shown)
    return () => { window.removeEventListener('focus', shown); document.removeEventListener('visibilitychange', shown) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing, qc])

  const readBack = async () => {
    if (!plan) return
    setBusy(true); setRefusal(null); setFound(null); setKept(null)
    try {
      const answer = await api.readBackDeploy(ranOf(plan))
      if (answer.change) qc.setQueryData(['changes'], answer.change)
      setFound(answer.readBack)
      setKept(answer.note ?? null)
      if (answer.staged.length > 0) {
        announce(`Read back: ${answer.staged.length} change${answer.staged.length === 1 ? '' : 's'} staged in your changes.${answer.note ? ` ${answer.note}` : ''}`)
        window.dispatchEvent(new Event(OPEN_CHANGES))
      } else announce('Read back: the chain shows nothing new to stage.')
    } catch (err) {
      setRefusal(refusalOf(err))
    } finally {
      setAnsweredAt(Date.now())
      setBusy(false)
      readAgain()
    }
  }

  const meta = plan ? [chainName(plan.chain), plural(plan.steps.length)] : []
  const head = <PageHead title="Deploy" meta={meta}
    about="Each step is prepared from what was decided; its signer runs it from their own wallet or the Safe app. Read back then stages what the chain holds as live Systems in your change." />
  if (previewing) return <>{head}<Empty>Nothing composed is shown.</Empty></>
  if (deploy.isPending || (who.actor === null && who.error === null)) return <>{head}<Skeleton rows={4} shape="row" label="Deploy" /></>
  if (deploy.error) {
    const err = deploy.error
    // M-6: a 401 is the public, not signed in: the house's unavailable note, in the server's (or sign-in's) sentence.
    const state = !(err instanceof ApiError) ? 'error' : err.status === 401 ? 'unavailable' : err.code !== null ? NO_PLAN[err.code] ?? 'error' : 'error'
    return <>{head}<Note state={state}>{err.message}</Note></>
  }
  if (!plan) return <>{head}<Empty>Nothing composed is shown.</Empty></>

  // The read-back drawn beside a plan read before it: its deployed Systems' ready steps are not drawn Ready (fix I-2).
  const rows = found ?? refusal?.readBack ?? null
  const deployedNow = new Set(rows && deploy.dataUpdatedAt <= answeredAt ? rows.systems.filter(s => s.status === 'deployed').map(s => s.id) : [])
  const readWhen = plan.readAt ? <>Read <When iso={plan.readAt}>{ageText(plan.readAt, new Date())}</When></> : undefined

  return (
    <>
      {head}
      {plan.problems.map(p => <Note key={p} state="error">{p}</Note>)}
      <Section label="Steps" count={plan.steps.length} note={readWhen}>
        <ol className="dep-steps">
          {plan.steps.map((s, i) => <StepRow key={`${s.id}:${s.system}`} step={s} n={i + 1} nameOf={nameOf} readDeployed={deployedNow.has(s.system)} />)}
        </ol>
      </Section>
      {canWrite && (
        <div className="dep-foot">
          <Button primary busy={busy ? 'Reading back…' : undefined} onClick={() => { void readBack() }}>Read back</Button>
          <span className="dep-line">Reads the chain again and stages what it holds as live Systems in your change, for the org’s rules to decide. Nothing is applied here.</span>
        </div>
      )}
      {refusal && <Note state="error">{refusal.said}</Note>}
      {refusal?.readBack && <ReadBackRows readBack={refusal.readBack} nameOf={nameOf} />}
      {kept && <Note state="notYet">{kept}</Note>}
      {found && <ReadBackRows readBack={found} nameOf={nameOf} />}
    </>
  )
}
