import { useEffect, useId, useRef } from 'react'
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
}

const WAITING = 'Waiting for your wallet to sign…'
const FAILED = 'Signing in did not work.'
const notMember = (org: string) => `This address wears no hat in ${org}’s tree. You can still read the public door.`
const hatCount = (n: number) => `${n} ${n === 1 ? 'hat' : 'hats'}`

/** Sign-in (spec §11.4): a card at most 420 wide, a group named by its title (not a landmark: /parts draws five) —
 *  the eyebrow "<org> · members", the title in the display face, what signing does and does not do, and then the state's body: idle (the one primary, Sign in with Ethereum, and
 *  the EIP-4361 hint), waiting (the reading ring, Cancel), signed in (the hat disc, the hats worn, the short address
 *  and the count), not a member (the sentence, Read the public door) and failed (a clay note, Try again). It draws
 *  only: the wallet and the session are L5's, which pass the state and the two callbacks. When the state changes
 *  after the first draw, focus goes to the new state's action (the body, when it has none) and the new state is said
 *  once through the page's polite region; a failure is said by its own note. */
export function SignIn({ org, state, hats = [], address, tree, error, onSignIn, onCancel, doorHref }: SignInProps) {
  const titleId = useId()
  const body = useRef<HTMLDivElement>(null)
  const drawn = useRef<SignInState | null>(null)
  const worn = hats.join(' · ')

  useEffect(() => {
    const before = drawn.current
    drawn.current = state
    if (before === null || before === state || !body.current) return
    const target = body.current.querySelector<HTMLElement>('a[href], button') ?? body.current
    target.focus()
    const said = state === 'waiting' ? WAITING : state === 'not-member' ? notMember(org) : state === 'signed-in' ? `Signed in. ${worn || 'No hats'}.` : null
    if (said) announce(said)
  }, [state, org, worn])

  const sentence = 'You’ll sign a message to prove you hold an address. Nothing is sent on chain and nothing is spent.'
    + (tree ? ` Your role is the hat you wear in tree ${tree}.` : '')
  const second = [address ? shortAddress(address) : null, hats.length > 0 ? hatCount(hats.length) : null].filter(Boolean).join(' · ')

  return (
    <div className="signin" role="group" aria-labelledby={titleId}>
      <p className="signin-k">{org} · members</p>
      <PageHeading className="signin-t display" id={titleId}>Sign in with your wallet</PageHeading>
      <div className="signin-body" ref={body} tabIndex={-1}>
        {state === 'idle' && <>
          <p className="signin-p">{sentence}</p>
          <div className="signin-go"><Button primary onClick={onSignIn}>Sign in with Ethereum</Button></div>
          <p className="signin-hint">EIP-4361 · read-only for anyone without a hat</p>
        </>}
        {state === 'waiting' && <>
          <p className="note"><Spinner /><span className="note-t">{WAITING}</span></p>
          <div className="signin-go"><Button onClick={onCancel}>Cancel</Button></div>
        </>}
        {state === 'signed-in' && (
          <div className="who signin-who">
            <span className="hatmark"><Icon name="hat" size="sm" /></span>
            <span className="who-w">
              <span className="who-t">{worn}</span>
              {second && <><span className="sr-only">, </span><span className="who-s">{second}</span></>}
            </span>
          </div>
        )}
        {state === 'not-member' && <>
          <p className="note"><Icon name="info" size="sm" /><span className="note-t">{notMember(org)}</span></p>
          <div className="signin-go"><ButtonLink href={doorHref}>Read the public door</ButtonLink></div>
        </>}
        {state === 'failed' && <>
          <Note state="error">{error ?? FAILED}</Note>
          <div className="signin-go"><Button onClick={onSignIn}>Try again</Button></div>
        </>}
      </div>
    </div>
  )
}
