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

/** W1's first screens (wizards spec §5.4). It collects what the framework's own `clone:framework` reads
 *  and shows that command at the review, with the config it takes. It runs nothing and writes nothing but
 *  its draft, which sits outside any repository: creating a folder is a write path this app does not have
 *  yet, so the wizard stops at the review and says so. */
export default function OpenInstance({ def }: { def: WizardDef }) {
  const draft = useQuery({ queryKey: ['draft', def.id], queryFn: () => api.wizardDraft(def.id), retry: false, refetchOnWindowFocus: false })
  const actor = useQuery({ queryKey: ['actor'], queryFn: api.actor, staleTime: 60_000, retry: false })
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Draft>({ language: 'en', license: 'MIT' })
  const [folderTouched, setFolderTouched] = useState(false)
  const [copied, setCopied] = useState(false)
  const canWrite = useCanWrite()

  // The address git reports here, as the default for the git email: the person may change it.
  const reported = actor.data && 'unknown' in actor.data ? actor.data.unknown : ''
  useEffect(() => { if (reported !== '') setAnswers(a => (a.email === undefined ? { ...a, email: reported } : a)) }, [reported])

  const set = (id: string, value: string) => {
    if (id === 'folder') setFolderTouched(true)
    setAnswers(a => {
      const next = { ...a, [id]: value }
      if (id === 'name' && !folderTouched) next.folder = defaultFolder(value)
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
    if (!canWrite) return
    if (m.state !== 'step' && m.state !== 'review') return
    const body = { index, answers }
    const text = JSON.stringify(body)
    if (text === kept.current) return
    kept.current = text
    api.saveWizardDraft(def.id, body).catch(() => { /* a draft is a convenience */ })
  }, [m.state, index, answers, def.id, canWrite])

  const view = m.state as WizardView
  const base = { title: def.title, steps: def.steps.map(s => s.title), view, index, status: m.shows.text,
    refusal: view === 'step' && invalid === null ? null : m.refusal }

  if (draft.isPending) return <Skeleton rows={4} shape="row-1" label={def.title} />
  // Save and leave: the answers are kept as a draft (the machine's closed state says so). Previewing draws no write
  // control (C6, C-23), and keeping a draft is a write to the server: neither the control nor the write is made (the
  // effect above stops at `canWrite`). Start, Continue, Back and Copy write nothing.
  const leave = { label: 'Save and leave', onClick: () => m.send('CANCEL') }

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
        actions={{ ...(canWrite ? { cancel: leave } : {}), back: { label: 'Back', onClick: () => m.send('BACK') }, next: { label: 'Continue', onClick: () => m.send('NEXT') } }}>
        <StepBody step={step} values={answers as Record<string, string | undefined>} onChange={set} />
      </WizardFrame>
    )
  }

  if (view === 'review') {
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
