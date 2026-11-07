import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClaimDone, type ClaimPlan, type ClaimTarget, type WizardDef } from '../api.ts'
import { useMachine, type Guards } from '../machines.ts'
import { wizard, wizardGuards } from '../../../lib/machines/wizard.mjs'
import { ButtonLink } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Choice, TextInput } from '../design/inputs/index.ts'
import { WizardFrame, type WizardView } from './WizardFrame.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { Skeleton } from '../design/Skeleton.tsx'

const CREATE = '__create'
const WHY = 'Choose who you are first.'
const NAME = 'Write your name for the new member.'

/** W2a (wizards spec §5.4a): the git address becomes a member's handle. One step, then the review: the
 *  exact line the server will write, the address as git reports it, and the commit it will make.
 *  Nothing is written until the person presses "This is me". The page never sends an address; the
 *  server reads it from git itself. */
export default function ClaimHandle({ def }: { def: WizardDef }) {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['claim'], queryFn: api.claimStatus, retry: false, refetchOnWindowFocus: false })
  const draft = useQuery({ queryKey: ['draft', def.id], queryFn: () => api.wizardDraft(def.id), retry: false, refetchOnWindowFocus: false })
  const [index, setIndex] = useState(0)
  const [choice, setChoice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [plan, setPlan] = useState<ClaimPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<ClaimDone | null>(null)
  const canWrite = useCanWrite()

  const target = (): ClaimTarget | null =>
    choice === null ? null : choice === CREATE ? { create: { name: name.trim() } } : { member: choice }
  const invalid = choice === null ? WHY : choice === CREATE && name.trim() === '' ? NAME : null

  const loadPlan = async () => {
    const t = target()
    setPlan(null); setPlanError(null)
    if (!t) { setPlanError(WHY); return }
    try { setPlan(await api.claimPlan(t)) } catch (err) { setPlanError(err instanceof Error ? err.message : String(err)) }
  }

  const m = useMachine(wizard, {
    guards: wizardGuards as Guards,
    context: { n: index + 1, total: def.steps.length, invalid, draft: !!draft.data },
    onEffect: effect => {
      if (effect === 'step:first') setIndex(0)
      else if (effect === 'step:next') setIndex(i => i + 1)
      else if (effect === 'step:back') setIndex(i => i - 1)
      else if (effect === 'step:last') setIndex(def.steps.length - 1)
      else if (effect === 'step:review') void loadPlan()
      else if (effect === 'step:resume' && draft.data) {
        setIndex(Math.min(draft.data.index, def.steps.length - 1))
        const who = draft.data.answers.who
        if (typeof who === 'string') setChoice(who)
        const saved = draft.data.answers.name
        if (typeof saved === 'string') setName(saved)
      }
    },
  })

  // The answers so far are kept outside the repository, so closing the tab loses nothing. Keeping a draft is a write to
  // the server (`PUT /api/wizards/<id>/draft`, which writes its file under the Hub's state): not made while previewing
  // (C6, C-23), so a preview neither draws "Save and leave" nor leaves a draft behind.
  const kept = useRef('')
  useEffect(() => {
    if (!canWrite) return
    if (m.state !== 'step' && m.state !== 'review') return
    const body = { index, answers: { who: choice, ...(name !== '' ? { name } : {}) } }
    const text = JSON.stringify(body)
    if (text === kept.current) return
    kept.current = text
    api.saveWizardDraft(def.id, body).catch(() => { /* a draft is a convenience; the wizard goes on without it */ })
  }, [m.state, index, choice, name, def.id, canWrite])

  const confirm = async () => {
    if (!plan || !m.send('CONFIRM')) return
    try {
      const out = await api.claimConfirm(plan.nonce)
      setResult(out)
      m.send('DONE')
      api.discardWizardDraft(def.id).catch(() => {})
      void qc.invalidateQueries({ queryKey: ['actor'] })
      void qc.invalidateQueries({ queryKey: ['claim'] })
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
      m.send('FAIL')
    }
  }

  const stepTitles = def.steps.map(s => s.title)
  const step = def.steps[Math.min(index, def.steps.length - 1)]!
  const view = m.state as WizardView
  const back = () => { m.send('BACK') }
  // A guard's sentence is shown while what it refused is still so: once a choice is made it goes.
  const base = { title: def.title, steps: stepTitles, view, index, status: m.shows.text, refusal: view === 'step' && invalid === null ? null : m.refusal }

  if (status.isPending || draft.isPending) return <Skeleton rows={4} shape="row-1" label={def.title} />
  if (status.error) return <Note state="error">{status.error.message}</Note>
  const s = status.data!

  if (view === 'intro') {
    if (!s.available) {
      return <WizardFrame {...base} heading={def.title} ask={def.intro.body} writes="Nothing. This wizard cannot be used here." refusal={s.refusal}
        actions={{ cancel: { label: 'Close', onClick: () => m.send('CANCEL') } }} />
    }
    return (
      <WizardFrame {...base} heading={def.title} ask={def.intro.body} writes={def.intro.writes}
        actions={{
          cancel: { label: 'Close', onClick: () => m.send('CANCEL') },
          ...(draft.data ? { back: { label: 'Continue where you left off', onClick: () => m.send('RESUME') } } : {}),
          next: { label: 'Start', onClick: () => m.send('START') },
        }} />
    )
  }

  // Previewing draws no write control (C6, C-23): Save and leave keeps a draft on the server and This is me writes the
  // line, so neither is drawn. Continue, Back and Start only move between screens, and Close on the intro writes nothing.
  const leave = { label: 'Save and leave', onClick: () => m.send('CANCEL') }

  if (view === 'step') {
    return (
      <WizardFrame {...base} heading={step.title} ask={step.ask} writes={step.writes}
        actions={{ ...(canWrite ? { cancel: leave } : {}), back: { label: 'Back', onClick: back }, next: { label: 'Continue', onClick: () => m.send('NEXT') } }}>
        <fieldset className="wiz-doors">
          <legend className="sr-only">Members who hold no git address</legend>
          {s.candidates.map(c => (
            <Choice key={c.id} type="card" name="who" checked={choice === c.id} onChange={() => setChoice(c.id)} label={c.name} hint={`${c.id} · holds no git address`} />
          ))}
          {s.canCreate && (
            <Choice type="card" name="who" checked={choice === CREATE} onChange={() => setChoice(CREATE)} label="Add me as a new member"
              hint="No person is a member yet. The next screen shows the id before it is written." />
          )}
        </fieldset>
        {choice === CREATE && (
          <div className="wiz-field">
            <label htmlFor="wiz-name">Your name</label>
            <TextInput common={{ id: 'wiz-name' }} prose={false} readOnly={false} value={name} onChange={v => setName(v == null ? '' : String(v))} />
          </div>
        )}
        {s.candidates.length === 0 && !s.canCreate && <p className="wiz-note">No member is waiting for an address.</p>}
      </WizardFrame>
    )
  }

  if (view === 'failed') {
    // Nothing was written, and a second write goes through the review again: Back to review plans it afresh.
    return (
      <WizardFrame {...base} heading="Nothing was written" writes={def.review.writes} refusal={failure}
        actions={{ ...(canWrite ? { cancel: leave } : {}), back: { label: 'Back to review', onClick: () => { setFailure(null); if (m.send('RETRY')) void loadPlan() } } }} />
    )
  }

  if (view === 'review' || view === 'running') {
    const r = plan?.review
    return (
      <WizardFrame {...base} heading={view === 'review' ? def.review.title : 'Writing'}
        ask={view === 'review' ? def.review.ask : undefined} writes={def.review.writes}
        refusal={view === 'review' ? planError ?? m.refusal : null}
        lines={view === 'running' && r ? [{ text: 'Checked: the line is the one you reviewed', done: true }, { text: `Writing ${r.file} and its commit…` }] : undefined}
        actions={view === 'running' ? {} : {
          ...(canWrite ? { cancel: leave } : {}),
          back: { label: 'Back', onClick: back },
          ...(r && canWrite ? { next: { label: 'This is me', onClick: () => void confirm() } } : {}),
        }}>
        {view === 'review' && !r && !planError && <Note state="loading">Preparing the line…</Note>}
        {r && view === 'review' && <Answers plan={plan!} />}
        {r && <ReviewLog plan={plan!} />}
        {r && view === 'review' && <p className="wiz-note">{r.note}</p>}
      </WizardFrame>
    )
  }

  if (view === 'done') {
    const who = plan?.review.member.name ?? result?.member.id ?? ''
    // What decided it (E-26): the rule the commit names, which the server read; then what to do next.
    const rule = result?.trailers['Org-Rule'] ?? s.rule
    return (
      <WizardFrame {...base} heading={def.done.title.replace('{member}', who)} ask={`The rule ${rule} decided it. ${def.done.body}`}
        writes={result ? `Written: ${result.changed.join(', ')}, in commit ${result.commit.slice(0, 7)}.` : def.review.writes}
        actions={{}}>
        {result && (
          <pre className="wiz-log">
            <b>Commit</b> {result.commit.slice(0, 7)}{'\n'}
            {Object.entries(result.trailers).map(([k, v]) => `${k}: ${v}`).join('\n')}{'\n'}
            <b>Undo</b> git revert {result.commit.slice(0, 7)}
          </pre>
        )}
        <div className="wiz-acts"><ButtonLink href="/" primary>Open your boards</ButtonLink></div>
      </WizardFrame>
    )
  }

  // closed: the answers stay as a draft
  return (
    <WizardFrame {...base} heading="Closed" ask="Your answers are kept as a draft. Nothing was written." writes="Nothing." actions={{}}>
      <div className="wiz-acts"><ButtonLink href="/">Back to the app</ButtonLink></div>
    </WizardFrame>
  )
}

/** The review's answers as field rows (§11.3, E-26): who the person said they are, the address git reports, and
 *  every file the claim writes. */
function Answers({ plan }: { plan: ClaimPlan }) {
  const r = plan.review
  return (
    <FieldTable label="Your answers">
      <FieldRow label="Member">{`${r.member.name} · ${r.member.id}`}</FieldRow>
      <FieldRow label="Address">{r.address}</FieldRow>
      <FieldRow label="Files it writes"><span className="wiz-files">{r.writes.map(f => <span key={f} className="mono">{f}</span>)}</span></FieldRow>
    </FieldTable>
  )
}

/** What the server will do, as the plan fixed it: the lines added to the file, the address, the commit,
 *  and the command with its limits. */
function ReviewLog({ plan }: { plan: ClaimPlan }) {
  const r = plan.review
  return (
    <>
    <pre className="wiz-log">
      <b>File</b> {r.file}{'\n'}
      {r.lines.map(l => `+ ${l}`).join('\n')}{'\n'}
      <b>Address</b> {r.address} (as git reports it){'\n'}
      <b>Member</b> {r.member.id} · {r.member.name}{r.member.created ? ' (new member)' : ''}{'\n'}
      <b>Commit</b> {r.commit.message}{'\n'}
      {Object.entries(r.commit.trailers).map(([k, v]) => `       ${k}: ${v}`).join('\n')}{'\n'}
      <b>May write</b> {r.writes.join(', ')} · {r.timeoutMs / 1000} s limit · {r.network ? 'reaches the network' : 'reaches nothing outside this machine'}
    </pre>
    <details className="wiz-cmd">
      <summary>The exact command it runs</summary>
      <pre className="wiz-log">{[r.cmd, ...r.args].join(' ')}</pre>
    </details>
    </>
  )
}
