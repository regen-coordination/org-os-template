import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button, buttonClass } from '../../design/Button.tsx'
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
  /** Where "Read the portal" goes: the portal's origin (D-5). Null or absent, a Hub with none: no link, and the
   *  not-a-member sentence does not offer it. */
  portalHref?: string | null
  /** The ways offered (Lane 3, `GET /api/session`'s `methods`): with `email`, the email form is the primary and the
   *  wallet a second button, drawn only when `wallet` is offered too. Absent, the card is the wallet's alone (L5). */
  methods?: readonly ('email' | 'wallet' | 'atproto')[]
  onEmail?(email: string): void  // Email me a link
  emailBusy?: boolean            // the ask is under way
  emailError?: string | null     // the ask failed (a malformed address, the method off): the server's sentence
  sent?: string | null           // once asked: the server's sentence, shown as given, whatever it knows (I6)
  /** With `atproto` (refi-dao-os network app B3): sign in with a Bluesky or Certified account. No handle: Certified's
   *  sign-in; a handle: that account's own. The page leaves for it and comes back signed in. */
  onAccount?(handle?: string): void
  /** A Bluesky handle to fill in (back from Certified's page, ?handle=); nothing starts until a click. */
  accountHandle?: string
  accountBusy?: boolean
  accountError?: string | null
}

const WAITING = 'Waiting for your wallet to sign…'
const FAILED = 'Signing in did not work.'
const notMember = (org: string, portal: boolean) => `This address wears no hat in ${org}’s tree.${portal ? ' You can still read the portal.' : ''}`
const EMAIL_SENTENCE = 'We’ll email you a link that signs you in. It works once, for 15 minutes.'
const LINK_HINT = 'No mail after a few minutes? Check your spam folder, then ask again.'
const hatCount = (n: number) => `${n} ${n === 1 ? 'hat' : 'hats'}`

/** Sign-in (spec §11.4): a card at most 420 wide, a group named by its title (not a landmark: /parts draws five) —
 *  the eyebrow "<org> · members", the title in the display face, what signing does and does not do, and then the state's body: idle (the one primary, Sign in with Ethereum, and
 *  the EIP-4361 hint), waiting (the reading ring, Cancel), signed in (the hat disc, the hats worn, the short address
 *  and the count), not a member (the sentence, and Read the portal when there is one) and failed (a clay note, Try again). It draws
 *  only: the wallet and the session are L5's, which pass the state and the two callbacks. When the state changes
 *  after the first draw, focus goes to the new state's action (the body, when it has none) and the new state is said
 *  once through the page's polite region; a failure is said by its own note. */
export function SignIn({ org, state, hats = [], address, tree, error, onSignIn, onCancel, portalHref = null, methods = ['wallet'], onEmail, emailBusy = false, emailError = null, sent = null, onAccount, accountHandle = '', accountBusy = false, accountError = null }: SignInProps) {
  const byEmail = methods.includes('email')
  const byAccount = methods.includes('atproto') && onAccount !== undefined
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
    const said = shown === 'sent' ? sent : state === 'waiting' ? WAITING : state === 'not-member' ? notMember(org, portalHref !== null) : state === 'signed-in' ? `Signed in. ${worn || 'No hats'}.` : null
    if (said) announce(said)
  }, [shown, state, org, worn, sent, portalHref])

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
          {byAccount && <AccountForm onAccount={onAccount!} busy={accountBusy} initial={accountHandle} />}
          {byAccount && accountError && <Note state="error">{accountError}</Note>}
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
          <p className="note"><Icon name="info" size="sm" /><span className="note-t">{notMember(org, portalHref !== null)}</span></p>
          {/* the portal is its own site (its origin), so a plain link, not the Hub's router */}
          {portalHref !== null && <div className="signin-go"><a className={buttonClass({})} href={portalHref}>Read the portal</a></div>}
        </>}
        {!sent && state === 'failed' && <>
          <Note state="error">{error ?? FAILED}</Note>
          <div className="signin-go"><Button onClick={onSignIn}>Try again</Button></div>
        </>}
      </div>
    </div>
  )
}

/** A Bluesky or Certified account (network app B3): the one button, which starts at Certified's sign-in, and a labelled
 *  field for a Bluesky handle. Pages say "Bluesky or Certified", never the protocol's name. */
function AccountForm({ onAccount, busy, initial }: { onAccount: (handle?: string) => void; busy: boolean; initial: string }) {
  const id = useId()
  const [handle, setHandle] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!busy && handle.trim() !== '') onAccount(handle)
  }
  return (
    <div className="signin-form">
      <div className="signin-go"><Button onClick={() => { if (!busy) onAccount() }} {...(busy ? { busy: 'Opening…' } : {})}>Sign in with Bluesky or Certified</Button></div>
      <form onSubmit={submit}>
        <label className="signin-label" htmlFor={id}>Or a Bluesky handle</label>
        <input className="input" id={id} name="handle" autoComplete="username" placeholder="you.bsky.social"
          value={handle} onChange={e => setHandle(e.target.value)} />
        <div className="signin-go"><Button type="submit">Continue with this handle</Button></div>
      </form>
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
