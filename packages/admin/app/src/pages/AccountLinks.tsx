import { useEffect, useId, useState, type FormEvent } from 'react'
import { useSearch } from 'wouter'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHead } from '../design/PageHead.tsx'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Note } from '../design/Note.tsx'
import { useStatus } from '../queries.ts'
import { useSessionView } from '../session/session.ts'
import { accountLinks, unlinkAccount, useAccountStart } from '../session/accountSignIn.ts'

/** Said once a link comes back. */
export const LINKED = 'Linked. Signing in with this account now signs you in as you, with your Roles.'
const ABOUT = 'Link your own Bluesky or Certified account once, and signing in with it reaches you here, as the emailed link does. '
  + 'Linking shows nothing publicly. It is your account, never your node’s.'
const LINKS_KEY = ['session', 'atproto', 'links'] as const

/** /account-links (refi-dao-os network app spec §5.3, B4): a member's linked Bluesky or Certified accounts, each with
 *  Unlink, and a way to link one: Certified's sign-in by default, or a typed Bluesky handle. Linking is an OAuth
 *  round-trip that proves the account is theirs; the page leaves for the account's own sign-in and comes back here. */
export default function AccountLinks() {
  const org = useStatus().data?.org ?? 'org-os'
  const session = useSessionView()
  const person = session?.signedIn === true && session.via === 'email'
  const search = useSearch()
  const qc = useQueryClient()
  const links = useQuery({ queryKey: LINKS_KEY, queryFn: accountLinks, enabled: person, retry: false })
  const link = useAccountStart('link')
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)
  const handleId = useId()
  const [handle, setHandle] = useState('')

  useEffect(() => { document.title = `Bluesky or Certified account · ${org}` }, [org])

  const unlink = (did: string) => {
    setUnlinking(did); setUnlinkError(null)
    unlinkAccount(did).then(() => qc.invalidateQueries({ queryKey: LINKS_KEY }), (err: unknown) => {
      setUnlinkError(err instanceof Error ? err.message : 'It could not be unlinked.')
    }).finally(() => setUnlinking(null))
  }
  const byHandle = (e: FormEvent) => {
    e.preventDefault()
    if (handle.trim() !== '') link.start(handle)
  }

  return (
    <div className="account-links">
      <PageHead title="Bluesky or Certified account" about={ABOUT} />
      {session && !person && <Note state="unavailable">Sign in with your emailed link first, then link your account here.</Note>}
      {person && <>
        {new URLSearchParams(search).get('linked') === '1' && <p className="note"><Icon name="info" size="sm" /><span className="note-t">{LINKED}</span></p>}
        {links.data && links.data.length > 0 && (
          <ul className="account-links-list">
            {links.data.map(l => (
              <li key={l.did}>
                <span className="who-t">{l.handle}</span>
                <Button small onClick={() => unlink(l.did)} label={`Unlink ${l.handle}`} {...(unlinking === l.did ? { busy: 'Unlinking…' } : {})}>Unlink</Button>
              </li>
            ))}
          </ul>
        )}
        {links.data && links.data.length === 0 && <p className="signin-p">No account is linked yet.</p>}
        {unlinkError && <Note state="error">{unlinkError}</Note>}
        <div className="signin-go"><Button primary onClick={() => link.start()} {...(link.busy ? { busy: 'Opening…' } : {})}>Link with Certified</Button></div>
        <form className="signin-form" onSubmit={byHandle}>
          <label className="signin-label" htmlFor={handleId}>Or a Bluesky handle</label>
          <input className="input" id={handleId} name="handle" autoComplete="username" placeholder="you.bsky.social"
            value={handle} onChange={e => setHandle(e.target.value)} />
          <div className="signin-go"><Button type="submit">Link this handle</Button></div>
        </form>
        {link.error && <Note state="error">{link.error}</Note>}
      </>}
    </div>
  )
}
