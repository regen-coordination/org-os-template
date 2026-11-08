import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { goTo, SignInRefused, spendLink } from '../session/emailSignIn.ts'

/** The token of `/sign-in/link?token=…`, read once, then taken out of the address bar and history, so it is not left
 *  in the history list, a bookmark or a shared screen. */
function takeToken(): string | null {
  const q = new URLSearchParams(window.location.search)
  const token = q.get('token')
  if (token !== null) {
    q.delete('token')
    const rest = q.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
  }
  return token
}

const NO_TOKEN = 'This sign-in link is not complete.'
const ASK_AGAIN = 'Ask for a new link: enter your email address again on the sign-in page.'

/** `/sign-in/link` (Lane 3 Task 10): "Continue to <org>" and one button that posts the token. Opening the page spends
 *  nothing, so a mail scanner that follows the link leaves it working; the click spends it, once. Then it goes to
 *  where the link was asked from: another of the org's sites by a full load, a path here through the router. A link
 *  that is refused says so and offers a new one. Drawn alone, outside the frame. */
export default function SignInLinkPage({ org }: { org: string }) {
  const titleId = useId()
  const [, navigate] = useLocation()
  const token = useRef<string | null | undefined>(undefined)
  if (token.current === undefined) token.current = takeToken()
  const [state, setState] = useState<'ready' | 'posting' | 'done' | 'refused'>(token.current ? 'ready' : 'refused')
  const [refusal, setRefusal] = useState<{ error: string; hint: string }>({ error: NO_TOKEN, hint: ASK_AGAIN })
  const spent = useRef(false)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { if (state === 'refused' && spent.current) body.current?.focus() }, [state])

  const go = () => {
    if (spent.current || !token.current) return
    spent.current = true
    setState('posting')
    spendLink(token.current).then(answer => {
      setState('done')
      goTo(answer.return, navigate)
    }, (err: unknown) => {
      setRefusal({
        error: err instanceof Error ? err.message : 'Signing in did not work.',
        hint: err instanceof SignInRefused && err.hint ? err.hint : ASK_AGAIN,
      })
      setState('refused')
    })
  }

  return (
    <main className="signin-page">
      <div className="signin" role="group" aria-labelledby={titleId}>
        <p className="signin-k">{org} · members</p>
        <h1 className="signin-t display" id={titleId}>{state === 'refused' ? 'This link did not sign you in' : `Continue to ${org}`}</h1>
        <div className="signin-body" ref={body} tabIndex={-1}>
          {state !== 'refused' && <>
            <p className="signin-p">One click signs you in on this device. The link then stops working.</p>
            <div className="signin-go">
              <Button primary onClick={go} {...(state === 'posting' || state === 'done' ? { busy: 'Signing in…' } : {})}>Continue</Button>
            </div>
          </>}
          {state === 'refused' && <>
            <Note state="error">{refusal.error}</Note>
            <p className="signin-p">{refusal.hint}</p>
            <div className="signin-go"><ButtonLink href="/sign-in">Send a new link</ButtonLink></div>
          </>}
        </div>
      </div>
    </main>
  )
}
