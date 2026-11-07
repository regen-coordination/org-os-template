import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { Note } from '../../design/Note.tsx'
import { Spinner } from '../../design/Spinner.tsx'
import { announce } from '../../parts/live.tsx'
import { shortAddress } from '../atoms/chain.ts'
import { PageHeading } from '../../design/PageHeading.tsx'

export type SignInState = 'idle' | 'waiting' | 'signed-in' | 'not-member' | 'failed'

export interface SignInProps {
  org: string                 // the org's name: "<org> · members", and the not-member sentence
  state: SignInState          // L5's useSession().state
  hats?: string[]             // the names of the hats worn, once signed in
  address?: string            // the signed-in (or refused) address
  tree?: string               // the Hats tree, e.g. "#13": the sentence names it only when given
  error?: string | null       // the failed state's sentence, shown as given (the server's, or the no-wallet one); null as none (useSession().error)
  onSignIn(): void            // Sign in with Ethereum, and Try again
  onCancel(): void            // Cancel while the wallet is asked to sign
  doorHref: string            // where "Read the public door" goes
  /** The ways offered (Lane 3, `GET /api/session`'s `methods`): with `email`, the email form is the primary and the
   *  wallet a second button, drawn only when `wallet` is offered too. Absent, the card is the wallet's alone (L5). */
  methods?: readonly ('email' | 'wallet')[]
  onEmail?(email: string): void  // Email me a link
  emailBusy?: boolean            // the ask is under way
  emailError?: string | null     // the ask failed (a malformed address, the method off): the server's sentence
  sent?: string | null           // once asked: the server's sentence, shown as given, whatever it knows (I6)
}

const WAITING = 'Waiting for your wallet to sign…'
const FAILED = 'Signing in did not work.'
const notMember = (org: string) => `This address wears no hat in ${org}’s tree. You can still read the public door.`
const EMAIL_SENTENCE = 'We’ll email you a link that signs you in. It works once, for 15 minutes.'
const LINK_HINT = 'No mail after a few minutes? Check your spam folder, then ask again.'
const hatCount = (n: number) => `${n} ${n === 1 ? 'hat' : 'hats'}`

/** Sign-in (spec §11.4): a card at most 420 wide, a group named by its title (not a landmark: /parts draws five) —
 *  the eyebrow "<org> · members", the title in the display face, what signing does and does not do, and then the state's body: idle (the one primary, Sign in with Ethereum, and
 *  the EIP-4361 hint), waiting (the reading ring, Cancel), signed in (the hat disc, the hats worn, the short address
 *  and the count), not a member (the sentence, Read the public door) and failed (a clay note, Try again). It draws
 *  only: the wallet and the session are L5's, which pass the state and the two callbacks. When the state changes
 *  after the first draw, focus goes to the new state's action (the body, when it has none) and the new state is said
 *  once through the page's polite region; a failure is said by its own note. */
export function SignIn({ org, state, hats = [], address, tree, error, onSignIn, onCancel, doorHref, methods = ['wallet'], onEmail, emailBusy = false, emailError = null, sent = null }: SignInProps) {
  const byEmail = methods.includes('email')
  const byWallet = methods.includes('wallet')
  const titleId = useId()
  const body = useRef<HTMLDivElement>(null)
  const drawn = useRef<SignInState | 'sent' | null>(null)
  const worn = hats.join(' · ')

  const shown: SignInState | 'sent' = sent ? 'sent' : state
  useEffect(() => {
    const before = drawn.current
    drawn.current = shown
    if (before === null || before === shown || !body.current) return
    const target = shown === 'sent' ? body.current : body.current.querySelector<HTMLElement>('a[href], button') ?? body.current
    target.focus()
    const said = shown === 'sent' ? sent : state === 'waiting' ? WAITING : state === 'not-member' ? notMember(org) : state === 'signed-in' ? `Signed in. ${worn || 'No hats'}.` : null
    if (said) announce(said)
  }, [shown, state, org, worn, sent])

  const sentence = 'You’ll sign a message to prove you hold an address. Nothing is sent on chain and nothing is spent.'
    + (tree ? ` Your role is the hat you wear in tree ${tree}.` : '')
  const second = [address ? shortAddress(address) : null, hats.length > 0 ? hatCount(hats.length) : null].filter(Boolean).join(' · ')

  return (
    <div className="signin" role="group" aria-labelledby={titleId}>
      <p className="signin-k">{org} · members</p>
      <PageHeading className="signin-t display" id={titleId}>{byEmail ? 'Sign in' : 'Sign in with your wallet'}</PageHeading>
      <div className="signin-body" ref={body} tabIndex={-1}>
        {sent && <p className="note"><Icon name="info" size="sm" /><span className="note-t">{sent}</span></p>}
        {sent && <p className="signin-hint">{LINK_HINT}</p>}
        {!sent && byEmail && state === 'idle' && <>
          <EmailForm onEmail={onEmail} busy={emailBusy} />
          {emailError && <Note state="error">{emailError}</Note>}
          {byWallet && <div className="signin-go"><Button onClick={onSignIn}>Sign in with a wallet</Button></div>}
        </>}
        {!sent && !byEmail && state === 'idle' && <>
          <p className="signin-p">{sentence}</p>
          <div className="signin-go"><Button primary onClick={onSignIn}>Sign in with Ethereum</Button></div>
          <p className="signin-hint">EIP-4361 · read-only for anyone without a hat</p>
        </>}
        {!sent && state === 'waiting' && <>
          <p className="note"><Spinner /><span className="note-t">{WAITING}</span></p>
          <div className="signin-go"><Button onClick={onCancel}>Cancel</Button></div>
        </>}
        {!sent && state === 'signed-in' && (
          <div className="who signin-who">
            <span className="hatmark"><Icon name="hat" size="sm" /></span>
            <span className="who-w">
              <span className="who-t">{worn}</span>
              {second && <><span className="sr-only">, </span><span className="who-s">{second}</span></>}
            </span>
          </div>
        )}
        {!sent && state === 'not-member' && <>
          <p className="note"><Icon name="info" size="sm" /><span className="note-t">{notMember(org)}</span></p>
          <div className="signin-go"><ButtonLink href={doorHref}>Read the public door</ButtonLink></div>
        </>}
        {!sent && state === 'failed' && <>
          <Note state="error">{error ?? FAILED}</Note>
          <div className="signin-go"><Button onClick={onSignIn}>Try again</Button></div>
        </>}
      </div>
    </div>
  )
}

/** The email form: one labelled field (type email, autocomplete email) and the one primary. Sends the address as
 *  typed; the server folds it (I3). */
function EmailForm({ onEmail, busy }: { onEmail?: (email: string) => void; busy: boolean }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || email.trim() === '') return
    onEmail?.(email)
  }
  return (
    <form className="signin-form" onSubmit={submit}>
      <p className="signin-p">{EMAIL_SENTENCE}</p>
      <label className="signin-label" htmlFor={id}>Email</label>
      <input className="input" id={id} name="email" type="email" autoComplete="email" required
        value={email} onChange={e => setEmail(e.target.value)} />
      <div className="signin-go"><Button primary type="submit" {...(busy ? { busy: 'Sending…' } : {})}>Email me a link</Button></div>
    </form>
  )
}
