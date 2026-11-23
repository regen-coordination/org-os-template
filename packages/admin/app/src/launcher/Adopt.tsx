import { useId, useState, type FormEvent } from 'react'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import OpenInstance from '../wizards/OpenInstance.tsx'
import type { WizardDef } from '../api.ts'
import type { Answers } from '../../../lib/open-instance.mjs'
import { type Landing, adoptApply, adoptPlan, launcherWizard, type AdoptPlanAnswer } from './api.ts'

/** The Adopt door: a repo that is not org-os yet. The folder, then the open-instance questions with that folder fixed,
 *  then what would be added and what is kept, from a plan made in a scratch folder. Nothing is written to the repo until
 *  "Add them on org-os/adopt", and then only the missing files, on that new branch. */
export default function Adopt({ base, initialFolder = '', onClose, landing, onGo, initial }: { base?: string; initialFolder?: string; onClose?: () => void; landing?: Landing; onGo?: (url: string) => void; initial?: Partial<Answers> }) {
  const [folder, setFolder] = useState(initialFolder)
  const [def, setDef] = useState<WizardDef | null>(null)
  const [plan, setPlan] = useState<AdoptPlanAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const addId = useId()
  const keptId = useId()
  const ignoredId = useId()
  const fieldId = useId()

  const start = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try { setDef(await launcherWizard()) } catch (err) { setError((err as Error).message) }
  }

  const run = async (answers: Answers): Promise<{ error: string } | void> => {
    try {
      const made = await adoptPlan(folder.trim(), answers)
      setPlan(made)
    } catch (e) { return { error: (e as Error).message } }
  }

  const apply = async () => {
    if (!plan) return
    setBusy(true); setError(null)
    try {
      const { url } = await (landing ? adoptApply(plan.planId, landing) : adoptApply(plan.planId))
      ;(onGo ?? (u => window.location.assign(u)))(url)
    } catch (err) {
      setError((err as Error).message)
      setTried(true) // a plan is used once: after a failed apply, start again
    } finally { setBusy(false) }
  }

  const again = () => { setPlan(null); setDef(null); setError(null); setTried(false) }

  if (plan) {
    return (
      <div className="wiz-field">
        <p className="wiz-label" id={addId}>These files will be added on a new branch, org-os/adopt:</p>
        <ul className="wiz-lines" aria-labelledby={addId}>
          {plan.add.map(p => <li key={p} className="wiz-cmd">{p}</li>)}
        </ul>
        {plan.kept.length > 0 && <>
          <p className="wiz-label" id={keptId}>Your repo already has these. They stay exactly as they are:</p>
          <ul className="wiz-lines" aria-labelledby={keptId}>
            {plan.kept.map(p => <li key={p} className="wiz-cmd">{p}</li>)}
          </ul>
        </>}
        {(plan.ignored ?? []).length > 0 && <>
          <p className="wiz-label" id={ignoredId}>Your .gitignore leaves these out, so they aren't added:</p>
          <ul className="wiz-lines" aria-labelledby={ignoredId}>
            {plan.ignored.map(p => <li key={p} className="wiz-cmd">{p}</li>)}
          </ul>
        </>}
        {error !== null && <Note state="error">{error}</Note>}
        <div className="wiz-acts">
          {tried
            ? <Button onClick={again}>Start again</Button>
            : <Button primary onClick={() => void apply()} busy={busy ? 'Adding…' : undefined}>Add them on org-os/adopt</Button>}
          {onClose && <Button onClick={onClose} disabled={busy}>Close</Button>}
        </div>
        <p className="wiz-note">Your default branch isn't touched. Merging is up to you.</p>
      </div>
    )
  }

  if (def) return <OpenInstance def={def} run={run} base={base} fixedFolder={folder.trim()} initial={initial} onClose={() => setDef(null)} />

  return (
    <form onSubmit={e => void start(e)} className="wiz-field">
      <label htmlFor={fieldId}>The repo's folder</label>
      <input id={fieldId} className="input" type="text" value={folder} placeholder={base ?? ''}
        onChange={e => setFolder(e.target.value)} autoComplete="off" spellCheck={false} />
      {error !== null && <Note state="error">{error}</Note>}
      <div className="wiz-acts">
        <Button type="submit" primary disabled={folder.trim() === ''}>Continue</Button>
        {onClose && <Button onClick={onClose}>Close</Button>}
      </div>
    </form>
  )
}
