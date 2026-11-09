import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { applySkin, chosenSkin } from '../skin.ts'
import { applyTheme, storedTheme } from '../theme.ts'
import OpenInstance from '../wizards/OpenInstance.tsx'
import type { WizardDef } from '../api.ts'
import { cloneInstance, createInstance, launcherWizard, defaultCloneFolder, forgetRecent, launcherState, openInstance, type LauncherState, type RecentEntry } from './api.ts'

type Refusal = { message: string; adoptable: boolean; path?: string }

/** The launcher at /launch, drawn alone outside the Hub's frame: it has no instance behind it, so none of the
 *  instance's APIs are called. The recent instances, then the four ways in. Create runs the open-instance wizard
 *  with the framework's command actually run; Adopt is wired by a later task and cannot be used yet. */
export default function Launcher() {
  const [state, setState] = useState<LauncherState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [cloneFolder, setCloneFolder] = useState('')
  const [cloneEdited, setCloneEdited] = useState(false)
  const [createLog, setCreateLog] = useState<string | null>(null)
  const [creating, setCreating] = useState<WizardDef | null>(null)
  const [adoptFolder, setAdoptFolder] = useState('')

  useEffect(() => { applyTheme(storedTheme()); applySkin(chosenSkin()); document.title = 'Instances' }, [])
  useEffect(() => {
    let live = true
    launcherState().then(s => { if (live) { setState(s); setRecent(s.recent ?? []) } }, e => { if (live) setLoadError((e as Error).message) })
    return () => { live = false }
  }, [])

  const open = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setRefusal(null)
    try {
      const { url } = await openInstance(folder.trim())
      window.location.assign(url)
    } catch (err) {
      const x = err as Error & { adoptable?: boolean; path?: string }
      setRefusal({ message: x.message, adoptable: x.adoptable === true, path: x.path })
    } finally { setBusy(false) }
  }

  const onGitUrl = (v: string) => {
    setGitUrl(v)
    if (!cloneEdited && state) setCloneFolder(v.trim() ? defaultCloneFolder(v, state.base) : '')
  }

  const cloneIt = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setRefusal(null)
    try {
      const { url } = await cloneInstance(gitUrl.trim(), cloneFolder.trim())
      window.location.assign(url)
    } catch (err) {
      const x = err as Error & { adoptable?: boolean; path?: string }
      setRefusal({ message: x.message, adoptable: x.adoptable === true, path: x.path })
    } finally { setBusy(false) }
  }

  const startCreate = async () => {
    setRefusal(null)
    try { setCreating(await launcherWizard()) } catch (err) { setRefusal({ message: (err as Error).message, adoptable: false }) }
  }

  const runCreate = async (answers: Parameters<typeof createInstance>[0]): Promise<{ error: string } | void> => {
    setCreateLog(null)
    try {
      const { url } = await createInstance(answers)
      window.location.assign(url)
    } catch (err) {
      const x = err as Error & { log?: string }
      setCreateLog(x.log ?? null)
      return { error: x.message }
    }
  }

  const forget = async (path: string) => {
    try { setRecent((await forgetRecent(path)).recent) } catch (err) { setRefusal({ message: (err as Error).message, adoptable: false }) }
  }

  const door = (id: string) => state?.doors?.find(d => d.id === id)

  return (
    <main className="wiz-body" id="launcher-main">
      <h1 className="wiz-h">Instances</h1>

      {loadError !== null && <Note state="error">{loadError}</Note>}

      <section aria-label="Recent instances" className="wiz-files">
        <p className="wiz-label">Recent instances</p>
        {recent.length === 0
          ? <p className="wiz-note">{state ? 'Nothing opened yet.' : ''}</p>
          : <ul className="wiz-lines" style={{ color: 'inherit' }}>
              {recent.map(r => (
                <li key={r.path} className="wiz-out" style={r.found ? undefined : { opacity: 0.6 }}>
                  <div className="wiz-out-b">
                    <strong>{r.name ?? r.path.split('/').filter(Boolean).pop() ?? r.path}</strong>
                    <span className="wiz-cmd">{r.path}</span>
                    {!r.found && <span className="wiz-note">Not found.</span>}
                  </div>
                  {r.found
                    ? <Button small onClick={() => { setFolder(r.path); setRefusal(null) }} label={`Use ${r.path}`}>Use</Button>
                    : <Button small onClick={() => void forget(r.path)}>Remove from the list</Button>}
                </li>
              ))}
            </ul>}
      </section>

      <div className="wiz-doors" role="group" aria-label="The four doors">
        <section className="wiz-writes" aria-labelledby="door-open">
          <h2 className="wiz-h" id="door-open" style={{ fontSize: 'inherit' }}>Open an instance</h2>
          <form onSubmit={e => void open(e)} className="wiz-field">
            <label htmlFor="launch-folder">The folder it's in</label>
            <input id="launch-folder" className="input" type="text" value={folder} placeholder={state?.base ?? ''}
              onChange={e => setFolder(e.target.value)} autoComplete="off" spellCheck={false} />
            <div className="wiz-acts">
              <Button type="submit" primary busy={busy ? 'Opening…' : undefined}>Open</Button>
            </div>
          </form>
          <form onSubmit={e => void cloneIt(e)} className="wiz-field">
            <label htmlFor="launch-git">Or paste a git address</label>
            <input id="launch-git" className="input" type="text" value={gitUrl} placeholder="https://github.com/owner/name"
              onChange={e => onGitUrl(e.target.value)} autoComplete="off" spellCheck={false} />
            <label htmlFor="launch-clone-folder">The folder to clone it into</label>
            <input id="launch-clone-folder" className="input" type="text" value={cloneFolder}
              onChange={e => { setCloneFolder(e.target.value); setCloneEdited(true) }} autoComplete="off" spellCheck={false} />
            <div className="wiz-acts">
              <Button type="submit" busy={busy ? 'Cloning…' : undefined} disabled={gitUrl.trim() === '' || cloneFolder.trim() === ''}>Clone and open</Button>
            </div>
          </form>
          {refusal && (
            <Note state="error" action={refusal.adoptable ? <Button small onClick={() => { setAdoptFolder(refusal.path ?? folder.trim()); setRefusal(null) }}>Adopt it</Button> : undefined}>
              {refusal.adoptable ? "This folder isn't an org-os instance yet." : refusal.message}
            </Note>
          )}
        </section>

        <section className="wiz-writes" aria-labelledby="door-create">
          <h2 className="wiz-h" id="door-create" style={{ fontSize: 'inherit' }}>Create a new one</h2>
          {creating
            ? <>
                <OpenInstance def={creating} run={runCreate} base={state?.base} onClose={() => { setCreating(null); setCreateLog(null) }} />
                {createLog && <pre className="wiz-log" aria-label="What the command printed">{createLog}</pre>}
              </>
            : <div className="wiz-acts"><Button onClick={() => void startCreate()}>Create a new one</Button></div>}
        </section>

        <section className="wiz-writes" aria-labelledby="door-adopt">
          <h2 className="wiz-h" id="door-adopt" style={{ fontSize: 'inherit' }}>Adopt a repo</h2>
          {adoptFolder !== '' && <p className="wiz-cmd">{adoptFolder}</p>}
          <div className="wiz-acts"><Button disabled={true}>Adopt a repo</Button></div>
        </section>

        <section className="wiz-writes" aria-labelledby="door-join">
          <h2 className="wiz-h" id="door-join" style={{ fontSize: 'inherit' }}>Join a network</h2>
          <p className="wiz-note">{door('join')?.note ?? 'Comes with federation.'}</p>
          <div className="wiz-acts"><Button disabled={true}>Join a network</Button></div>
        </section>
      </div>
    </main>
  )
}
