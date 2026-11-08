// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderAt } from '../test/render.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { SignIn } from '../elements/signin/SignIn.tsx'
import { Identity } from '../frame/Identity.tsx'
import SignInLinkPage from '../pages/SignInLinkPage.tsx'
import { goTo, personIdentity, roleWords, signInReturn, useEmailSignIn } from './emailSignIn.ts'

// Lane 3 Task 10: the emailed-link sign-in's client half. Synthetic values only; fetch is stubbed by route.

const SENTENCE = "If this address is on Example Org's records, a link is on its way."
const noop = () => {}

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

/** The sign-in card as the sign-in page draws it with the email method: the form, the hook, the server's sentence. */
function Card({ ret, methods = ['email'] as const }: { ret: string | null; methods?: readonly ('email' | 'wallet')[] }) {
  const email = useEmailSignIn(ret)
  return <SignIn org="Example Org" state="idle" methods={methods} onSignIn={noop} onCancel={noop} doorHref="/door"
    onEmail={email.send} emailBusy={email.state === 'sending'} emailError={email.error} sent={email.sentence} />
}

async function submit(address: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: address } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email me a link' })) })
}

describe('the sign-in card with the email method (Lane 3 Task 10)', () => {
  it('no tree: the email form, no wallet button', () => {
    renderAt(<SignIn org="Example Org" state="idle" methods={['email']} onSignIn={noop} onCancel={noop} doorHref="/door" />, '/sign-in')
    const card = screen.getByRole('group', { name: 'Sign in' })
    const field = within(card).getByLabelText('Email')
    expect([field.getAttribute('type'), field.getAttribute('autocomplete')]).toEqual(['email', 'email'])
    const buttons = within(card).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Email me a link'])
    expect(buttons[0]!.className).toBe('btn primary')
    expect(card.textContent).not.toMatch(/Ethereum|wallet|house/i)
  })

  it('with a tree too: the email form first, then Sign in with a wallet, which starts the wallet', () => {
    const onSignIn = vi.fn()
    renderAt(<SignIn org="Example Org" state="idle" methods={['email', 'wallet']} onSignIn={onSignIn} onCancel={noop} doorHref="/door" />, '/sign-in')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Email me a link', 'Sign in with a wallet'])
    expect(buttons[1]!.className).toBe('btn secondary')
    fireEvent.click(buttons[1]!)
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('after submit: the same sentence whatever the server knows', async () => {
    const shown: string[] = []
    for (const address of ['steward@example.org', 'nobody@example.org']) {
      fetchRoutes({ 'POST /api/session/email': () => new Response(JSON.stringify({ sent: true, sentence: SENTENCE }), { status: 202 }) })
      const { unmount } = renderAt(<Card ret={null} />, '/sign-in')
      await submit(address)
      const card = screen.getByRole('group', { name: 'Sign in' })
      expect(within(card).queryByLabelText('Email')).toBeNull()
      shown.push(card.querySelector('.signin-body')!.textContent!)
      expect(screen.getByTestId('live').textContent).toBe(SENTENCE)
      unmount()
    }
    expect(shown[0]).toContain(SENTENCE)
    expect(shown[1]).toBe(shown[0])
  })

  it('a refused ask shows the server’s sentence and keeps the form', async () => {
    fetchRoutes({ 'POST /api/session/email': () => new Response(JSON.stringify({ error: 'Sign-in by email is not offered here.', code: 'EMAIL_OFF' }), { status: 409 }) })
    renderAt(<Card ret={null} />, '/sign-in')
    await submit('steward@example.org')
    expect(screen.getByText('Sign-in by email is not offered here.').closest('.note-error')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('return and next are carried to the server', async () => {
    expect(signInReturn('?return=https%3A%2F%2Fideas.example.org%2Fidea%2F7&next=%2Fregistries')).toBe('https://ideas.example.org/idea/7')
    expect(signInReturn('?next=%2Fregistries')).toBe('/registries')
    expect(signInReturn('next=%2Fb%2Fhome')).toBe('/b/home')
    expect(signInReturn('')).toBeNull()
    for (const [ret, body] of [
      ['https://ideas.example.org/idea/7', { email: 'steward@example.org', return: 'https://ideas.example.org/idea/7' }],
      ['/registries', { email: 'steward@example.org', return: '/registries' }],
      [null, { email: 'steward@example.org' }],
    ] as const) {
      const { calls } = fetchRoutes({ 'POST /api/session/email': { sent: true, sentence: SENTENCE } })
      const { unmount } = renderAt(<Card ret={ret} />, '/sign-in')
      await submit('steward@example.org')
      expect(calls).toEqual([{ method: 'POST', path: '/api/session/email', body }])
      unmount()
    }
  })
})

describe('/sign-in/link (Lane 3 Task 10)', () => {
  const TOKEN = 'A'.repeat(43)

  it('the link page posts once and goes to return', async () => {
    window.history.replaceState(null, '', `/sign-in/link?token=${TOKEN}`)
    const { calls } = fetchRoutes({ 'POST /api/session/link': { signedIn: true, return: '/registries' } })
    const { loc } = renderAt(<SignInLinkPage org="Example Org" />, '/sign-in/link')
    // The token has left the address bar and the history entry.
    expect(window.location.search).toBe('')
    const card = screen.getByRole('group', { name: 'Continue to Example Org' })
    const button = within(card).getByRole('button', { name: 'Continue' })
    await act(async () => { fireEvent.click(button); fireEvent.click(button) })
    expect(calls).toEqual([{ method: 'POST', path: '/api/session/link', body: { token: TOKEN } }])
    expect(loc.history!.at(-1)).toBe('/registries')
  })

  it('another of the org’s sites is a full load; a path here, the router', () => {
    const assign = vi.fn()
    const here = { origin: 'https://hub.example.org', assign } as unknown as Location
    const navigate = vi.fn()
    goTo('https://ideas.example.org/idea/7', navigate, here)
    expect(assign).toHaveBeenCalledWith('https://ideas.example.org/idea/7')
    goTo('https://hub.example.org/registries?x=1', navigate, here)
    goTo('/b/home', navigate, here)
    goTo('javascript:alert(1)', navigate, here)
    expect(navigate.mock.calls).toEqual([['/registries?x=1'], ['/b/home'], ['/']])
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('a failed link offers a new one', async () => {
    window.history.replaceState(null, '', `/sign-in/link?token=${TOKEN}`)
    fetchRoutes({ 'POST /api/session/link': () => new Response(JSON.stringify({
      error: 'This sign-in link has expired or was already used.',
      hint: 'Ask for a new link: enter your email address again on the sign-in page.', code: 'LINK_REFUSED',
    }), { status: 401 }) })
    renderAt(<SignInLinkPage org="Example Org" />, '/sign-in/link')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    const card = screen.getByRole('group', { name: 'This link did not sign you in' })
    expect(within(card).getByText('This sign-in link has expired or was already used.').closest('.note-error')).toBeTruthy()
    expect(within(card).getByText('Ask for a new link: enter your email address again on the sign-in page.')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Send a new link' }).getAttribute('href')).toBe('/sign-in')
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('a link with no token offers a new one and posts nothing', () => {
    window.history.replaceState(null, '', '/sign-in/link')
    const { calls } = fetchRoutes({})
    renderAt(<SignInLinkPage org="Example Org" />, '/sign-in/link')
    expect(screen.getByText('This sign-in link is not complete.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Send a new link' })).toBeTruthy()
    expect(calls).toEqual([])
  })
})

describe('Identity for an email session (Lane 3 Task 10)', () => {
  it('Identity names the Roles of an email session', () => {
    expect(roleWords(['network-member', 'steward', 'node-lead'])).toEqual(['Network Member', 'Steward', 'Node Lead'])
    const who = personIdentity({ name: 'Example Steward', roles: ['steward', 'node-lead'] })
    renderAt(<Identity who={who} full />, '/')
    const face = screen.getByRole('button', { name: /Example Steward/ })
    expect(face.textContent).toContain('Steward · Node Lead')
    expect(face.textContent).not.toMatch(/0x|hat /)
    fireEvent.click(face)
    const menu = screen.getByRole('menu', { name: 'Signed in' })
    const roles = within(menu).getByRole('group', { name: 'Roles' })
    expect(within(roles).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Steward', 'Node Lead'])
    expect(within(menu).queryByRole('menuitem', { name: 'Copy address' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'View as…' })).toBeTruthy()
  })
})
