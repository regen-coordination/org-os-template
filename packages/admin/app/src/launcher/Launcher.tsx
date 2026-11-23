import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { applySkin, chosenSkin } from '../skin.ts'
import { applyTheme, storedTheme } from '../theme.ts'
import OpenInstance from '../wizards/OpenInstance.tsx'
import Adopt from './Adopt.tsx'
import type { WizardDef } from '../api.ts'
import { policySentence } from '../pages/federationWords.ts'
import { cloneInstance, createInstance, inspectHub, launcherWizard, type JoinHub, type Landing, defaultCloneFolder, forgetRecent, launcherState, openInstance, type LauncherState, type RecentEntry } from './api.ts'

type Refusal = { message: string; adoptable: boolean; path?: string }

/** The launcher at /launch, drawn alone outside the Hub's frame: it has no instance behind it, so none of the
 *  instance's APIs are called. The recent instances, then the four ways in. Create runs the open-instance wizard
 *  with the framework's command actually run; Adopt adds the missing org-os files to a repo on the branch org-os/adopt. */
export default function Launcher() {
  const [state, setState] = useState<LauncherState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [folder, setFolder] = useState('')
  const [opening, setOpening] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [cloneFolder, setCloneFolder] = useState('')
  const [cloneEdited, setCloneEdited] = useState(false)
  const [createLog, setCreateLog] = useState<string | null>(null)
  const [creating, setCreating] = useState<WizardDef | null>(null)
  const [adoptFolder, setAdoptFolder] = useState('')
  const [adopting, setAdopting] = useState(false)
  // The Join door: the hub as looked up, the network chosen, and the invite token. The token lives only in this ref: it is
  // never sent to the launcher, stored, logged or put in state that is drawn. It is added to the landing address, in
  // the browser, as `#invite=`, which the Federation page reads and clears.
  const [joinAddress, setJoinAddress] = useState('')
  const [joinHub, setJoinHub] = useState<JoinHub | null>(null)
  const [joinNetwork, setJoinNetwork] = useState('')
  const [joinHasInvite, setJoinHasInvite] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const inviteToken = useRef('')
  const adoptCard = useRef<HTMLElement>(null)
  const [adoptFocus, setAdoptFocus] = useState(0)
  // "Adopt it" hands a path over: keyboard focus follows it to the Adopt card.
  useEffect(() => { if (adoptFocus > 0) adoptCard.current?.focus() }, [adoptFocus])

  useEffect(() => { applyTheme(storedTheme()); applySkin(chosenSkin()); document.title = 'Instances' }, [])
  useEffect(() => {
    let live = true
    launcherState().then(s => { if (live) { setState(s); setRecent(s.recent ?? []) } }, e => { if (live) setLoadError((e as Error).message) })
    return () => { live = false }
  }, [])

  const joining: Landing | undefined = joinHub && joinHub.policy !== 'closed' ? { hub: joinHub.url, ...(joinNetwork ? { network: joinNetwork } : {}) } : undefined
  const go = (url: string) => window.location.assign(inviteToken.current && joining ? `${url}#invite=${inviteToken.current}` : url)

  const lookUp = async (e: FormEvent) => {
    e.preventDefault()
    const pasted = joinAddress.trim()
    // Split here, in the browser, before anything is sent: only the address goes to the launcher.
    const at = pasted.indexOf('#')
    const token = at >= 0 ? (/^invite=(.+)$/.exec(pasted.slice(at + 1))?.[1] ?? '') : ''
    setLooking(true); setJoinError(null); setJoinHub(null); inviteToken.current = ''; setJoinHasInvite(false)
    try {
      const got = await inspectHub(token ? pasted.slice(0, at) : pasted)
      inviteToken.current = token
      if (token) setJoinAddress(pasted.slice(0, at)) // the field no longer shows the token
      setJoinHasInvite(got.invite || token !== '')
      setJoinHub(got.hub); setJoinNetwork(got.hub.networks.length === 1 ? got.hub.networks[0]! : '')
    } catch (err) { setJoinError((err as Error).message) } finally { setLooking(false) }
  }

  const open = async (e: FormEvent) => {
    e.preventDefault()
    setOpening(true); setRefusal(null)
    try {
      const { url } = await (joining ? openInstance(folder.trim(), joining) : openInstance(folder.trim()))
      go(url)
    } catch (err) {
      const x = err as Error & { adoptable?: boolean; path?: string }
      setRefusal({ message: x.message, adoptable: x.adoptable === true, path: x.path })
    } finally { setOpening(false) }
  }

  const onGitUrl = (v: string) => {
    setGitUrl(v)
    if (!cloneEdited && state) setCloneFolder(v.trim() ? defaultCloneFolder(v, state.base) : '')
  }

  const cloneIt = async (e: FormEvent) => {
    e.preventDefault()
    setCloning(true); setRefusal(null)
    try {
      const { url } = await (joining ? cloneInstance(gitUrl.trim(), cloneFolder.trim(), joining) : cloneInstance(gitUrl.trim(), cloneFolder.trim()))
      go(url)
    } catch (err) {
      const x = err as Error & { adoptable?: boolean; path?: string }
      setRefusal({ message: x.message, adoptable: x.adoptable === true, path: x.path })
    } finally { setCloning(false) }
  }

  const startCreate = async () => {
    setRefusal(null)
    try { setCreating(await launcherWizard()) } catch (err) { setRefusal({ message: (err as Error).message, adoptable: false }) }
  }

  const runCreate = async (answers: Parameters<typeof createInstance>[0]): Promise<{ error: string } | void> => {
    setCreateLog(null)
    try {
      const { url } = await (joining ? createInstance(answers, joining) : createInstance(answers))
      go(url)
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
          : <ul className="wiz-lines launcher-lines">
              {recent.map(r => (
                <li key={r.path} className={r.found ? 'wiz-out' : 'wiz-out launcher-missing'}>
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
          <h2 className="wiz-h launcher-door-h" id="door-open">Open an instance</h2>
          <form onSubmit={e => void open(e)} className="wiz-field">
            <label htmlFor="launch-folder">The folder it's in</label>
            <input id="launch-folder" className="input" type="text" value={folder} placeholder={state?.base ?? ''}
              onChange={e => setFolder(e.target.value)} autoComplete="off" spellCheck={false} />
            <div className="wiz-acts">
              <Button type="submit" primary busy={opening ? 'Opening…' : undefined}>Open</Button>
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
              <Button type="submit" busy={cloning ? 'Cloning…' : undefined} disabled={gitUrl.trim() === '' || cloneFolder.trim() === ''}>Clone and open</Button>
            </div>
          </form>
          {refusal && (
            <Note state="error" action={refusal.adoptable ? <Button small onClick={() => { setAdoptFolder(refusal.path ?? folder.trim()); setAdopting(true); setRefusal(null); setAdoptFocus(n => n + 1) }}>Adopt it</Button> : undefined}>
              {refusal.adoptable ? "This folder isn't an org-os instance yet." : refusal.message}
            </Note>
          )}
        </section>

        <section className="wiz-writes" aria-labelledby="door-create">
          <h2 className="wiz-h launcher-door-h" id="door-create">Create a new one</h2>
          {creating
            ? <>
                <OpenInstance def={creating} run={runCreate} base={state?.base} initial={joinHub?.types[0] ? { type: joinHub.types[0] } : undefined} onClose={() => { setCreating(null); setCreateLog(null) }} />
                {createLog && <pre className="wiz-log" aria-label="What the command printed">{createLog}</pre>}
              </>
            : <div className="wiz-acts"><Button onClick={() => void startCreate()}>Create a new one</Button></div>}
        </section>

        <section className="wiz-writes" aria-labelledby="door-adopt" ref={adoptCard} tabIndex={-1}>
          <h2 className="wiz-h launcher-door-h" id="door-adopt">Adopt a repo</h2>
          {adopting
            ? <Adopt key={adoptFolder} base={state?.base} initialFolder={adoptFolder} landing={joining} onGo={go} initial={joinHub?.types[0] ? { type: joinHub.types[0] } : undefined} onClose={() => { setAdopting(false); setAdoptFolder('') }} />
            : <div className="wiz-acts"><Button onClick={() => setAdopting(true)}>Adopt a repo</Button></div>}
        </section>

        <section className="wiz-writes" aria-labelledby="door-join">
          <h2 className="wiz-h launcher-door-h" id="door-join">Join a network</h2>
          <form onSubmit={e => void lookUp(e)} className="wiz-field">
            <label htmlFor="launch-join">The hub's address, or an invite link</label>
            <input id="launch-join" className="input" type="text" value={joinAddress} placeholder="https://hub.example"
              onChange={e => { setJoinAddress(e.target.value); setJoinHub(null); setJoinError(null); inviteToken.current = ''; setJoinHasInvite(false) }} autoComplete="off" spellCheck={false} />
            <div className="wiz-acts">
              <Button type="submit" busy={looking ? 'Looking…' : undefined} disabled={joinAddress.trim() === ''}>Look it up</Button>
            </div>
          </form>
          {joinError && <Note state="error">{joinError}</Note>}
          {joinHub && (
            <>
              <p className="wiz-note">
                {joinHub.name}{joinHub.type ? ` (${joinHub.type})` : ''}. {policySentence(joinHub.policy)}{joinHasInvite ? ' Your invite link will be used.' : ''}
              </p>
              {joinHub.networks.length > 1 && (
                <div className="wiz-field">
                  <label htmlFor="launch-join-network">Which network</label>
                  <select id="launch-join-network" className="input" value={joinNetwork} onChange={e => setJoinNetwork(e.target.value)}>
                    <option value="">Choose one</option>
                    {joinHub.networks.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
              {joining && <p className="wiz-note">Open, clone, create or adopt an instance in the cards here: it opens on its Federation page, ready to ask.</p>}
              {joining && (
                <div className="wiz-acts">
                  <Button onClick={() => void startCreate()}>Create one to join</Button>
                  <Button onClick={() => setAdopting(true)}>Adopt a repo to join</Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}
