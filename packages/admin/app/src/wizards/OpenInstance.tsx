import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type WizardDef } from '../api.ts'
import { ButtonLink } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { useMachine, type Guards } from '../machines.ts'
import { wizard, wizardGuards } from '../../../lib/machines/wizard.mjs'
import { cloneCommand, cloneConfigText, defaultFolder, orgProblem, youProblem, type Answers } from '../../../lib/open-instance.mjs'
import { WizardFrame, type WizardView } from './WizardFrame.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { StepBody } from './Fields.tsx'
import { Skeleton } from '../design/Skeleton.tsx'

type Draft = Answers & { start?: string }
const CONFIG_FILE = 'draft.yaml'
const CHOOSE = 'Choose one.'

/** W1's first screens (wizards spec §5.4). It collects what the framework's own `clone:framework` reads, in two modes.
 *  Inside an instance (no `run`) it shows that command at the review, with the config it takes: it runs nothing and
 *  writes nothing but its draft, which sits outside any repository. In the launcher (`run` given; no instance behind it)
 *  there is no intro, start step or draft: it opens at the questions, the review's action is "Create it", which calls
 *  `run`, and Close (or Back from the first question) calls `onClose`. With `fixedFolder` (adopting a repo) the folder is
 *  that repo: the answer is preset, its field is not drawn, and the review's action asks to see what would be added. */
export default function OpenInstance({ def: given, run, base: folderBase, onClose, fixedFolder }: { def: WizardDef; run?: (answers: Answers) => Promise<{ error: string } | void>; base?: string; onClose?: () => void; fixedFolder?: string }) {
  // With `run` (the launcher: no instance behind it) the start step is skipped, no draft is read or kept, and the review
  // creates the instance instead of showing the command.
  const steps = run ? given.steps.filter(s => s.id !== 'start') : given.steps
  const def = fixedFolder === undefined ? (run ? { ...given, steps } : given)
    : { ...given, steps: steps.map(s => (s.fields ? { ...s, ...(s.id === 'org' ? { ask: 'What it is called and what kind it is.' } : {}), fields: s.fields.filter(f => f.id !== 'folder') } : s)) }
  const draft = useQuery({ queryKey: ['draft', def.id], queryFn: () => api.wizardDraft(def.id), retry: false, refetchOnWindowFocus: false, enabled: !run })
  const actor = useQuery({ queryKey: ['actor'], queryFn: api.actor, staleTime: 60_000, retry: false, enabled: !run })
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Draft>({ language: 'en', license: 'MIT', ...(run ? { start: 'open' } : {}), ...(fixedFolder !== undefined ? { folder: fixedFolder } : {}) })
  const [folderTouched, setFolderTouched] = useState(fixedFolder !== undefined)
  const [copied, setCopied] = useState(false)
  const canWrite = useCanWrite()

  // The address git reports here, as the default for the git email: the person may change it.
  const reported = actor.data && 'unknown' in actor.data ? actor.data.unknown : ''
  useEffect(() => { if (reported !== '') setAnswers(a => (a.email === undefined ? { ...a, email: reported } : a)) }, [reported])

  const set = (id: string, value: string) => {
    if (id === 'folder') setFolderTouched(true)
    setAnswers(a => {
      const next = { ...a, [id]: value }
      if (id === 'name' && !folderTouched) next.folder = defaultFolder(value, run ? folderBase : undefined)
      return next
    })
  }

  const step = def.steps[Math.min(index, def.steps.length - 1)]!
  const invalid = step.id === 'start' ? (answers.start === 'open' ? null : CHOOSE) : step.id === 'org' ? orgProblem(answers) : youProblem(answers)

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
        const saved = draft.data.answers as Draft
        setAnswers(a => ({ ...a, ...saved }))
        if (typeof saved.folder === 'string') setFolderTouched(true)
      }
    },
  })

  // The answers so far are kept outside the repository, so closing the tab loses nothing. Keeping a draft is a write to
  // the server (`PUT /api/wizards/<id>/draft`, which writes its file under the Hub's state): not made while previewing
  // (C6, C-23), so a preview leaves no draft behind as the person types.
  const kept = useRef('')
  useEffect(() => {
    if (!canWrite || run) return
    if (m.state !== 'step' && m.state !== 'review') return
    const body = { index, answers }
    const text = JSON.stringify(body)
    if (text === kept.current) return
    kept.current = text
    api.saveWizardDraft(def.id, body).catch(() => { /* a draft is a convenience */ })
  }, [m.state, index, answers, def.id, canWrite, run])

  // In the launcher the intro is skipped: the run starts at the first question. Once: StrictMode runs this effect twice in dev.
  const started = useRef(false)
  useEffect(() => { if (run && !started.current) { started.current = true; m.send('START') } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const view = m.state as WizardView
  const base = { title: def.title, steps: def.steps.map(s => s.title), view, index, status: m.shows.text,
    refusal: view === 'step' && invalid === null ? null : m.refusal }

  if (draft.isPending && !run) return <Skeleton rows={4} shape="row-1" label={def.title} />
  // Save and leave: the answers are kept as a draft (the machine's closed state says so). Previewing draws no write
  // control (C6, C-23), and keeping a draft is a write to the server: neither the control nor the write is made (the
  // effect above stops at `canWrite`). Start, Continue, Back and Copy write nothing.
  const leave = { label: 'Save and leave', onClick: () => m.send('CANCEL') }
  const close = onClose ? { label: 'Close', onClick: onClose } : undefined
  if (run && view === 'intro') return null

  if (view === 'intro') {
    return (
      <WizardFrame {...base} heading={def.title} ask={def.intro.body} writes={def.intro.writes}
        actions={{
          cancel: { label: 'Close', onClick: () => m.send('CANCEL') },
          ...(draft.data ? { back: { label: 'Continue where you left off', onClick: () => m.send('RESUME') } } : {}),
          next: { label: 'Start', onClick: () => m.send('START') },
        }} />
    )
  }

  if (view === 'step') {
    return (
      <WizardFrame {...base} heading={step.title} ask={step.ask} writes={step.writes}
        actions={{ ...(close ? { cancel: close } : canWrite ? { cancel: leave } : {}), back: { label: 'Back', onClick: () => (close && index === 0 ? close.onClick() : m.send('BACK')) }, next: { label: 'Continue', onClick: () => m.send('NEXT') } }}>
        <StepBody step={step} values={answers as Record<string, string | undefined>} onChange={set} />
      </WizardFrame>
    )
  }

  if (view === 'review') {
    if (run) {
      const create = async () => {
        setRunning(true); setRunError(null)
        try {
          const r = await run(answers)
          if (r && 'error' in r) setRunError(r.error)
        } catch (err) { setRunError(err instanceof Error ? err.message : String(err)) } finally { setRunning(false) }
      }
      const adopting = fixedFolder !== undefined
      return (
        <WizardFrame {...base} status={running ? (adopting ? 'Making the files…' : 'Creating it…') : adopting ? 'Review. Nothing is written to your repo yet.' : 'Review. Nothing is made until you choose Create it.'} refusal={runError} heading="Check the answers"
          ask={adopting ? 'Nothing is written to your repo yet. Next you see every file it would add.' : 'Create it makes the folder and its first commit.'}
          writes={adopting ? 'Nothing in your repo yet. The files are made in a scratch folder first, so you can see what would be added.' : 'A new folder with the instance in it, and its first git commit.'}
          actions={{ ...(close ? { cancel: { ...close, disabled: running } } : {}), back: { label: 'Back', onClick: () => m.send('BACK'), disabled: running }, next: { label: adopting ? 'See what it adds' : 'Create it', onClick: () => void create(), disabled: running } }}>
          <p className="wiz-label">{adopting ? 'Repo' : 'Folder'}</p>
          <pre className="wiz-log">{answers.folder}</pre>
          <p className="wiz-label">Config</p>
          <pre className="wiz-log">{cloneConfigText(answers)}</pre>
          {!adopting && <p className="wiz-note">The framework makes the folder and refuses one that already holds files. It never deletes.</p>}
        </WizardFrame>
      )
    }
    const command = cloneCommand(answers, CONFIG_FILE)
    const copy = () => {
      void Promise.resolve(navigator.clipboard?.writeText(command)).then(() => setCopied(true), () => setCopied(false))
    }
    return (
      <WizardFrame {...base} status="Review. This app writes nothing and runs nothing here; the command is yours to run." heading={def.review.title} ask={def.review.ask} writes={def.review.writes}
        actions={{ ...(canWrite ? { cancel: leave } : {}), back: { label: 'Back', onClick: () => m.send('BACK') }, next: { label: 'Copy the command', onClick: copy } }}>
        <p className="wiz-label">{CONFIG_FILE}</p>
        <pre className="wiz-log">{cloneConfigText(answers)}</pre>
        <p className="wiz-label">Command</p>
        <pre className="wiz-log">{command}</pre>
        {copied && <p className="wiz-note" role="status">Copied.</p>}
        <p className="wiz-note">
          This app does not create the folder: that is a write it cannot make yet, so it runs none of this. The steps that come
          after these in the design (how it decides, the starting set) wait for the library and for rules, and are not here yet.
          The command refuses a folder that already holds files; it never deletes.
        </p>
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
