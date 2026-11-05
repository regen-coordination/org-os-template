// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAt } from '../../test/render.tsx'
import { fakeAddress, shortAddress } from '../atoms/chain.ts'
import { SignIn, type SignInProps } from './SignIn.tsx'

const ADDRESS = fakeAddress(3)
const HATS = ['Council steward', 'Treasury signer']
const noop = () => {}

function draw(over: Partial<SignInProps> = {}) {
  const p: SignInProps = { org: 'Example DAO', state: 'idle', onSignIn: vi.fn(), onCancel: vi.fn(), doorHref: '/door', ...over }
  const r = renderAt(<SignIn {...p} />, '/sign-in')
  return { ...r, p, card: screen.getByRole('group', { name: 'Sign in with your wallet' }) }
}

describe('SignIn (§11.4)', () => {
  it('idle: the eyebrow, the title in the display face, the sentence with the tree, the one primary and the hint', () => {
    const { card, p } = draw({ tree: '#13' })
    expect(card.querySelector('.signin-k')!.textContent).toBe('Example DAO · members')
    const title = within(card).getByRole('heading', { name: 'Sign in with your wallet' })
    expect(title.classList.contains('display')).toBe(true)
    expect(card.querySelector('.signin-p')!.textContent)
      .toBe('You’ll sign a message to prove you hold an address. Nothing is sent on chain and nothing is spent. Your role is the hat you wear in tree #13.')
    const buttons = within(card).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Sign in with Ethereum'])
    expect(buttons[0]!.className).toBe('btn primary')
    expect(buttons[0]!.closest('.signin-go')).toBeTruthy()
    expect(card.querySelector('.signin-hint')!.textContent).toBe('EIP-4361 · read-only for anyone without a hat')
    fireEvent.click(buttons[0]!)
    expect(p.onSignIn).toHaveBeenCalledTimes(1)
    expect(p.onCancel).not.toHaveBeenCalled()
  })

  it('idle without a tree: the sentence stops after “nothing is spent.” (E-20)', () => {
    const { card } = draw()
    expect(card.querySelector('.signin-p')!.textContent)
      .toBe('You’ll sign a message to prove you hold an address. Nothing is sent on chain and nothing is spent.')
  })

  it('waiting: the reading ring and its line, and Cancel, which calls onCancel; no Sign in', () => {
    const { card, p } = draw({ state: 'waiting' })
    const line = within(card).getByText('Waiting for your wallet to sign…')
    expect(line.closest('.note')!.querySelector('.spin')).toBeTruthy()
    expect(within(card).getAllByRole('button').map(b => b.textContent)).toEqual(['Cancel'])
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(p.onCancel).toHaveBeenCalledTimes(1)
    expect(p.onSignIn).not.toHaveBeenCalled()
  })

  it('signed in: the hat disc, the hats worn, and the short address · N hats in Mono; no action', () => {
    const { card } = draw({ state: 'signed-in', hats: HATS, address: ADDRESS })
    const who = card.querySelector('.signin-who')!
    expect(who.querySelector('.hatmark svg')).toBeTruthy()
    expect(who.querySelector('.who-t')!.textContent).toBe('Council steward · Treasury signer')
    expect(who.querySelector('.who-s')!.textContent).toBe(`${shortAddress(ADDRESS)} · 2 hats`)
    expect(within(card).queryAllByRole('button')).toEqual([])
    expect(within(card).queryAllByRole('link')).toEqual([])
  })

  it('signed in with one hat says “1 hat”; without an address, the count alone', () => {
    draw({ state: 'signed-in', hats: ['Ops lead'] })
    expect(document.querySelector('.who-s')!.textContent).toBe('1 hat')
  })

  it('not a member: the sentence names the org from its prop, and Read the public door links to doorHref', () => {
    const { card } = draw({ org: 'Example DAO', state: 'not-member', address: ADDRESS, doorHref: '/door' })
    expect(card.querySelector('.signin-k')!.textContent).toBe('Example DAO · members')
    expect(within(card).getByText('This address wears no hat in Example DAO’s tree. You can still read the public door.')).toBeTruthy()
    const door = within(card).getByRole('link', { name: 'Read the public door' })
    expect(door.getAttribute('href')).toBe('/door')
    expect(within(card).queryAllByRole('button')).toEqual([])
  })

  it('failed: the error shown verbatim in a clay note, and Try again calls onSignIn (E-19)', () => {
    const sentence = 'Open the Hub in a browser with a wallet, or install one, then try again.'
    const { card, p } = draw({ state: 'failed', error: sentence })
    const note = within(card).getByText(sentence).closest('.note')!
    expect(note.classList.contains('note-error')).toBe(true)
    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }))
    expect(p.onSignIn).toHaveBeenCalledTimes(1)
  })

  it('failed without an error: “Signing in did not work.”', () => {
    const { card } = draw({ state: 'failed' })
    expect(card.querySelector('.note-error')!.textContent).toBe('Signing in did not work.')
  })

  it('moves focus to the new state’s action, and says the new state once through the live region', () => {
    const p: SignInProps = { org: 'Example DAO', state: 'idle', onSignIn: noop, onCancel: noop, doorHref: '/door' }
    const { rerender } = renderAt(<SignIn {...p} />)
    screen.getByRole('button', { name: 'Sign in with Ethereum' }).focus()
    rerender(<SignIn {...p} state="waiting" />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('live').textContent).toBe('Waiting for your wallet to sign…')
    rerender(<SignIn {...p} state="not-member" />)
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Read the public door' }))
    expect(screen.getByTestId('live').textContent).toBe('This address wears no hat in Example DAO’s tree. You can still read the public door.')
    rerender(<SignIn {...p} state="failed" error="The signature did not match." />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
    rerender(<SignIn {...p} state="signed-in" hats={HATS} address={ADDRESS} />)
    expect(document.activeElement).toBe(document.querySelector('.signin-body'))
    expect(screen.getByTestId('live').textContent).toBe('Signed in. Council steward · Treasury signer.')
  })

  it('says nothing and takes no focus when it first draws', () => {
    renderAt(<SignIn org="Example DAO" state="waiting" onSignIn={noop} onCancel={noop} doorHref="/door" />)
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByTestId('live').textContent).toBe('')
  })

  it('reads “Hub”, never “house”, in every state (Q66, E-20)', () => {
    for (const state of ['idle', 'waiting', 'signed-in', 'not-member', 'failed'] as const) {
      const { card, unmount } = draw({ state, tree: '#13', hats: HATS, address: ADDRESS })
      expect(card.textContent, state).not.toMatch(/house/i)
      unmount()
    }
  })
})

// The words "connect wallet" and "login" (§11.4; Global Constraints › Copy) appear in no file a person's screen is
// built from: every non-test file under app/src, L5's client included, any case.
const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + sep
const BANNED = [/connect\s+wallet/i, /login/i]

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(e => { const p = join(dir, e); return statSync(p).isDirectory() ? filesUnder(p) : [p] })
}
function banned(text: string): string[] {
  return BANNED.filter(re => re.test(text)).map(re => re.source)
}

describe('no “connect wallet” and no “login” in app/src', () => {
  it('catches either word in any case (the check can fail)', () => {
    expect(banned('<button>Connect  Wallet</button>')).toEqual(['connect\\s+wallet'])
    expect(banned('LogIn to continue')).toEqual(['login'])
    expect(banned('Sign in with Ethereum')).toEqual([])
  })

  it('finds neither in any non-test file under app/src', () => {
    const files = filesUnder(src).filter(f => !/\.test\.tsx?$/.test(f) && !/\.(woff2?|png|jpe?g|webp|gif|ico)$/.test(f))
    expect(files.length).toBeGreaterThan(100)
    expect(files.some(f => f.endsWith(join('elements', 'signin', 'SignIn.tsx')))).toBe(true)
    const hits = files.flatMap(f => banned(readFileSync(f, 'utf8')).map(w => `${f.slice(src.length)}: ${w}`))
    expect(hits).toEqual([])
  })
})
