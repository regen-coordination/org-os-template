import { useEffect, useRef } from 'react'
import { useLocation, useSearch } from 'wouter'
import { SignIn } from '../elements/signin/SignIn.tsx'
import { useStatus } from '../queries.ts'
import { isSignInPath, useSession } from '../session/session.ts'

/** Where to go once signed in: `next` when it is a path of this Hub (one leading slash, not the sign-in page), else /. */
export function nextOf(search: string): string {
  const next = new URLSearchParams(search).get('next')
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || isSignInPath(next)) return '/'
  return next
}

/** "eip155:42220:13" → "#13": the tree as SignIn names it. */
const treeName = (ref: string) => `#${ref.slice(ref.lastIndexOf(':') + 1)}`
/** "eip155:42220:0x…" → "0x…". */
const bareAddress = (account: string) => account.slice(account.lastIndexOf(':') + 1)

/** /sign-in (L5 spec §11.1): L4c's SignIn on the Hub frame's blank layout — no sidebar, no bars, no tray; SignIn's
 *  title is the page's only h1. Signed in, it goes on to `next`. */
export default function SignInPage() {
  const { session, state, error, signIn, cancel } = useSession()
  const org = useStatus().data?.org ?? 'org-os'
  const search = useSearch()
  const [, navigate] = useLocation()

  useEffect(() => { document.title = `Sign in · ${org}` }, [org])
  // Once per sign-in: where `next` pointed when the session began, never again as the location changes after. Not
  // for a session past the grace (`stale`): it reads as public, so `next` would answer 401 and send it back here.
  const stale = session?.signedIn === true && session.stale === true
  const gone = useRef(false)
  useEffect(() => {
    if (state !== 'signed-in' || stale) { gone.current = false; return }
    if (gone.current) return
    gone.current = true
    navigate(nextOf(search), { replace: true })
  }, [state, stale, search, navigate])

  const signedIn = session?.signedIn ? session : null
  const tree = session && !session.signedIn && session.signIn ? treeName(session.signIn.tree) : undefined
  // Past the grace the session lives on but its hats could not be read: the card says the §5.2 band and offers Try again
  // (signing in again reads the hats now), never "signed in" with no hats (R-L5-20.6).
  const graced = stale && state === 'signed-in'
  return (
    <main className="signin-page">
      <SignIn org={org} state={graced ? 'failed' : state} tree={tree} error={graced ? signedIn?.band : error ?? undefined}
        hats={signedIn?.hats.map(h => h.name)} address={signedIn ? bareAddress(signedIn.account) : undefined}
        onSignIn={() => { void signIn() }} onCancel={cancel} doorHref="/door" />
    </main>
  )
}
