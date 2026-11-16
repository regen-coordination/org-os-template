import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { api, ApiError, type StageError, type WizardDef, type WizardStep } from '../api.ts'
import { ButtonLink } from '../design/Button.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Note } from '../design/Note.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { useMachine, type Guards } from '../machines.ts'
import { wizard, wizardGuards } from '../../../lib/machines/wizard.mjs'
import { readField, resultOf } from '../../../lib/wizard-answers.mjs'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { useActor } from '../actor.ts'
import { StepBody } from './Fields.tsx'
import { WizardFrame, type WizardView } from './WizardFrame.tsx'

type Answers = Record<string, string | undefined>

/** Where the canvas is: the runner ends there, and so does a "Start blank" door (L7 §7.1). */
export const COMPOSE_PATH = '/compose'
/** The door that opens the canvas with nothing staged. */
const BLANK = 'blank'
const CHOOSE = 'Choose one.'
/** A field filled from another the first time its step is reached, while the person has not written in it (L7 Task 19's
 *  carry: the council's wearers are, to start with, the Safe's signers). */
const PREFILL: Record<string, string> = { wearers: 'owners' }
/** A field filled as its source is written, while the person has not written in it (walk I12): the id the records are
 *  named from (`<id>-safe`, `<id>-roles`) follows the Name, as an id: "Test DAO" → `test-dao`. */
const DERIVE: Record<string, { from: string; as: (v: string) => string }> = { id: { from: 'name', as: v => slugOf(v) } }
/** A name as an id: lowercase letters, digits and single hyphens (what a record id may be). */
export const slugOf = (v: string): string =>
  v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** What is wrong with each field of a step, by field id: a required field left blank, or an answer its kind does not
 *  read (lib/wizard-answers.mjs). A field left blank that is not required is not asked for. */
function problemsOf(step: WizardStep, answers: Answers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of step.fields ?? []) {
    const raw = answers[f.id] ?? ''
    if (raw.trim() === '') { if (f.required) out[f.id] = f.kind === 'addresses' ? 'Write at least one address.' : `${f.label} is required.`; continue }
    const read = readField(f, raw)
    if ('error' in read) out[f.id] = read.error
  }
  return out
}

/** The answers as their fields read them, the blank ones left out: what `result.config` is built from. */
function readAnswers(def: WizardDef, answers: Answers): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of def.steps.flatMap(s => s.fields ?? [])) {
    const raw = answers[f.id] ?? ''
    if (raw.trim() === '') continue
    const read = readField(f, raw)
    if ('value' in read) out[f.id] = read.value
  }
  return out
}

/** The field a refusal of the add names, by the wizard's field id: `config.<name>` is the config key a result maps from a
 *  field; a composition's field (`deployment.threshold`, `hats.<key>.wearers`, `space`) is the config key of its last
 *  word. Null when no field of the wizard holds it. */
function fieldOfError(def: WizardDef, e: StageError): string | null {
  const config = def.result?.config ?? {}
  const path = e.field.startsWith('config.') ? e.field.slice('config.'.length).split('.')[0]! : e.field.split('.').at(-1)!
  const ref = Object.hasOwn(config, path) ? /^\$\{field\.([^}]*)\}$/.exec(config[path]!)?.[1] : undefined
  return ref !== undefined && def.steps.some(s => s.fields?.some(f => f.id === ref)) ? ref : null
}

/** The wizard's field a result's config key is put in from (`<key>: "${field.<id>}"`), or null. */
function fieldOfConfig(def: WizardDef, key: string): string | null {
  const value = def.result?.config?.[key]
  const ref = typeof value === 'string' ? /^\$\{field\.([^}]*)\}$/.exec(value)?.[1] : undefined
  return ref !== undefined && def.steps.some(s => s.fields?.some(f => f.id === ref)) ? ref : null
}

/** A shelf wizard's runner (DAO-OS L7 §7.1, Task 19): any wizard whose definition carries a `result` (the library entry
 *  to add and its config) runs here. Its steps are data; each is one screen of the house's `WizardFrame`, the eyebrow
 *  counting the rail, the review last ("Compose a DAO · 3 of 6"). The review lists the answers and the records the add
 *  stages (the entry's preview, which writes nothing); "Stage in your changes" posts `POST /api/library/<entry>/add`
 *  with `{ config }` built from `result.config`, then opens /compose, where the composition is drawn. A refusal of a
 *  field (a 422, the composition's check or the config's) goes back to the step that holds it, the sentence under its
 *  field and in the step's error note; any other refusal is said on the run's failed screen, nothing staged. A door
 *  whose value is `blank` opens the canvas with nothing staged. Previewing, or as an actor who is no member (as /compose,
 *  review M3), nothing that writes is drawn: no Save and leave, no stage, and no draft is read or kept; nothing is drawn
 *  until who you are is read. */
export default function TemplateWizard({ def }: { def: WizardDef }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  // what /compose writes by (review M3): the write gate and a member; an actor who is no member stages nothing and keeps no
  // draft, and nothing is offered until who you are is read
  const who = useActor()
  const canWrite = useCanWrite() && who.known
  const draft = useQuery({ queryKey: ['draft', def.id], queryFn: () => api.wizardDraft(def.id), retry: false, refetchOnWindowFocus: false, enabled: canWrite })
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  /** Fields the person wrote in (a prefilled one they changed is theirs). */
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  /** The steps whose Continue was refused: their fields say what is wrong under them. */
  const [tried, setTried] = useState<Set<number>>(() => new Set())
  /** What the add refused, by field id; a field's sentence goes once the person changes it. */
  const [refused, setRefused] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  /** What the same refusal said that no field holds, on the step it went back to (review M2): said, never dropped. */
  const [unheld, setUnheld] = useState<{ at: number; text: string } | null>(null)

  const add = def.result?.add ?? ''
  const fieldIds = new Set(def.steps.flatMap(s => (s.fields ?? []).map(f => f.id)))
  const step = def.steps[Math.min(index, def.steps.length - 1)]!
  const problems = problemsOf(step, answers)
  const chosen = step.doors ? answers[step.id] : undefined
  const invalid = step.doors && !step.doors.some(d => d.value === chosen && !d.later) ? CHOOSE : Object.values(problems)[0] ?? null

  const m = useMachine(wizard, {
    guards: wizardGuards as Guards,
    context: { n: index + 1, total: def.steps.length, invalid, draft: !!draft.data },
    onEffect: effect => {
      if (effect === 'step:first') setIndex(0)
      else if (effect === 'step:next') setIndex(i => i + 1)
      else if (effect === 'step:back') setIndex(i => i - 1)
      else if (effect === 'step:last') setIndex(def.steps.length - 1)
      else if (effect === 'step:resume' && draft.data) {
        setIndex(Math.min(draft.data.index, def.steps.length - 1))
        const saved = Object.fromEntries(Object.entries(draft.data.answers).filter(([, v]) => typeof v === 'string')) as Answers
        setAnswers(a => ({ ...a, ...saved }))
        setTouched(new Set(Object.keys(saved)))
      }
    },
  })
  const view = m.state as WizardView

  // Reaching a step, a prefilled field the person has not written in takes its source's answer.
  useEffect(() => {
    if (view !== 'step') return
    const fill: Answers = {}
    for (const f of step.fields ?? []) {
      const from = PREFILL[f.id]
      if (from !== undefined && !touched.has(f.id) && (answers[from] ?? '') !== '' && answers[f.id] !== answers[from]) fill[f.id] = answers[from]
    }
    if (Object.keys(fill).length > 0) setAnswers(a => ({ ...a, ...fill }))
  }, [index, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useQuery({ queryKey: ['library', 'preview', add], queryFn: () => api.libraryPreview(add), enabled: add !== '' && view === 'review', retry: false })

  // The answers so far are kept outside the repository (`PUT /api/wizards/<id>/draft`); previewing keeps none.
  const kept = useRef('')
  useEffect(() => {
    if (!canWrite) return
    if (m.state !== 'step' && m.state !== 'review') return
    const body = { index, answers: answers as Record<string, unknown> }
    const text = JSON.stringify(body)
    if (text === kept.current) return
    kept.current = text
    api.saveWizardDraft(def.id, body).catch(() => { /* a draft is a convenience */ })
  }, [m.state, index, answers, def.id, canWrite])

  const set = (id: string, value: string) => {
    // a field derived from this one, on any step, follows it until the person writes in it
    const follow: Answers = {}
    for (const [target, d] of Object.entries(DERIVE)) if (d.from === id && !touched.has(target) && fieldIds.has(target)) follow[target] = d.as(value)
    setAnswers(a => ({ ...a, [id]: value, ...follow }))
    setTouched(t => (t.has(id) ? t : new Set(t).add(id)))
    setRefused(r => { if (!(id in r)) return r; const rest = { ...r }; delete rest[id]; return rest })
  }

  const onNext = () => {
    if (step.doors && chosen === BLANK) { navigate(COMPOSE_PATH); return }
    if (!m.send('NEXT')) setTried(t => new Set(t).add(index))
  }

  const stage = async () => {
    const result = resultOf(def, readAnswers(def, answers))
    if (!result || !m.send('CONFIRM')) return
    setFailure(null)
    setUnheld(null)
    try {
      await api.libraryAdd(result.add, result.config)
    } catch (err) {
      // A taken id (409 TAKEN) the wizard asks for: the next free one in its field, back on its step, with the sentence
      // (walk I12). A wizard that asks no id says it on the failed screen, as before.
      const idField = err instanceof ApiError && err.code === 'TAKEN' && typeof err.body.nextFreeId === 'string' ? fieldOfConfig(def, 'id') : null
      if (idField !== null && err instanceof ApiError) {
        const free = String(err.body.nextFreeId)
        const at = def.steps.findIndex(s => s.fields?.some(f => f.id === idField))
        m.send('FAIL')
        setAnswers(a => ({ ...a, [idField]: free }))
        setTouched(t => new Set(t).add(idField))
        setRefused({ [idField]: `${err.message} ${free} is free: Continue with it, or write another.` })
        m.send('BACK'); m.send('BACK')
        setIndex(at)
        return
      }
      const errors = err instanceof ApiError ? err.errors : []
      const byField: Record<string, string> = {}
      const rest: string[] = []
      for (const e of errors) {
        const f = fieldOfError(def, e)
        if (f !== null) byField[f] = byField[f] ? `${byField[f]} ${e.message}` : e.message
        else rest.push(e.message)
      }
      const at = def.steps.findIndex(s => s.fields?.some(f => f.id in byField))
      m.send('FAIL')
      if (at >= 0) {
        // back to the step holding the first field refused: failed → review → the last step, then that step
        setRefused(byField)
        if (rest.length > 0) setUnheld({ at, text: rest.join(' ') })
        m.send('BACK'); m.send('BACK')
        setIndex(at)
        return
      }
      setFailure(errors.length > 0 ? errors.map(e => e.message).join(' ') : err instanceof Error ? err.message : String(err))
      return
    }
    m.send('DONE')
    api.discardWizardDraft(def.id).catch(() => {})
    for (const queryKey of [['changes'], ['library'], ['registry', 'systems']]) void qc.invalidateQueries({ queryKey })
    navigate(COMPOSE_PATH)
  }

  if ((who.actor === null && who.error === null) || (canWrite && draft.isPending)) return <Skeleton rows={4} shape="row-1" label={def.title} />

  // The eyebrow counts the rail, the review last, on every screen (walk M14: "2 of 2" on the last step became "3 of 3"
  // on the review), as the page head's "<n> steps" does; the step's status says the same count. The machine's own
  // `total` stays the questions, which its guards count.
  const rail = def.steps.length + 1
  const status = view === 'step' ? `Step ${index + 1} of ${rail}, the review last. Nothing is written yet.` : m.shows.text
  const base = { title: def.title, steps: def.steps.map(s => s.title), view, index, status }
  const leave = canWrite ? { cancel: { label: 'Save and leave', onClick: () => m.send('CANCEL') } } : {}

  if (view === 'intro') {
    return (
      <WizardFrame {...base} heading={def.title} ask={def.intro.body} writes={def.intro.writes}
        actions={{
          cancel: { label: 'Close', onClick: () => m.send('CANCEL') },
          ...(canWrite && draft.data ? { back: { label: 'Continue where you left off', onClick: () => m.send('RESUME') } } : {}),
          next: { label: 'Start', onClick: () => m.send('START') },
        }} />
    )
  }

  if (view === 'step') {
    const shown = tried.has(index)
    const errors = Object.fromEntries((step.fields ?? []).map(f => [f.id, refused[f.id] ?? (shown ? problems[f.id] : undefined)]))
    const fromAdd = [step.fields?.map(f => refused[f.id]).find(Boolean), unheld?.at === index ? unheld.text : undefined].filter(Boolean).join(' ') || undefined
    const refusal = fromAdd ?? (invalid === null ? null : m.refusal)
    return (
      <WizardFrame {...base} heading={step.title} ask={step.ask} writes={step.writes} refusal={refusal}
        actions={{ ...leave, back: { label: 'Back', onClick: () => m.send('BACK') },
          next: { label: step.doors && chosen === BLANK ? 'Open the canvas' : 'Continue', onClick: onNext } }}>
        <StepBody step={step} values={answers} errors={errors} onChange={set} />
      </WizardFrame>
    )
  }

  if (view === 'failed') {
    return (
      <WizardFrame {...base} heading="Nothing was staged" writes={def.review.writes} refusal={failure}
        actions={{ ...leave, back: { label: 'Back to review', onClick: () => { setFailure(null); m.send('RETRY') } } }} />
    )
  }

  if (view === 'review' || view === 'running') {
    const fields = def.steps.flatMap(s => s.fields ?? [])
    const adds = preview.data?.adds ?? []
    return (
      <WizardFrame {...base} heading={view === 'review' ? def.review.title : 'Staging'} ask={view === 'review' ? def.review.ask : undefined}
        writes={def.review.writes} refusal={view === 'review' ? m.refusal : null}
        lines={view === 'running' ? [{ text: `Adding ${add} to your changes…` }] : undefined}
        actions={view === 'running' ? {} : { ...leave, back: { label: 'Back', onClick: () => m.send('BACK') },
          ...(canWrite ? { next: { label: 'Stage in your changes', onClick: () => void stage() } } : {}) }}>
        {view === 'review' && (
          <>
            <FieldTable label="Your answers">
              {fields.filter(f => (answers[f.id] ?? '').trim() !== '').map(f => (
                <FieldRow key={f.id} label={f.label}>
                  {f.kind === 'addresses'
                    ? <span className="wiz-files">{(answers[f.id] ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(a => <span key={a} className="mono">{a}</span>)}</span>
                    : f.kind === 'count' ? <span className="mono">{answers[f.id]!.trim()}</span> : answers[f.id]}
                </FieldRow>
              ))}
            </FieldTable>
            <p className="wiz-label">What it stages</p>
            {preview.isPending && <Note state="loading">Reading what the add stages…</Note>}
            {preview.error && <Note state="error">{preview.error.message}</Note>}
            {adds.length > 0 && (
              <ul className="wiz-lines" aria-label="What it stages">
                {adds.map(a => <li key={a.record}><span className="mono">{a.record}</span>{` · ${a.summary}`}</li>)}
              </ul>
            )}
          </>
        )}
      </WizardFrame>
    )
  }

  // closed (Save and leave, or Close on the intro): the answers stay as a draft
  return (
    <WizardFrame {...base} heading="Closed" ask={canWrite ? 'Your answers are kept as a draft. Nothing was staged.' : 'Nothing was staged.'} writes="Nothing." actions={{}}>
      <div className="wiz-acts"><ButtonLink href="/library">Back to the library</ButtonLink></div>
    </WizardFrame>
  )
}
