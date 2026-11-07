// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { buildSiweMessage } from '../../../lib/siwe.mjs'
import App from '../App.tsx'
import type { SessionView } from '../api.ts'
import { fakeAddress } from '../elements/atoms/chain.ts'
import { NO_WALLET } from '../session/session.ts'
import { baseRoutes, refuse } from '../test/data.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import SignInPage from './SignInPage.tsx'

const ADDRESS = fakeAddress(8)
const ACCOUNT = `eip155:42220:${ADDRESS}`
const OUT: SessionView = { mode: 'hosted', signIn: { chainId: 'eip155:42220', tree: 'eip155:42220:13' }, signedIn: false }
const IN: SessionView = {
  mode: 'hosted', signedIn: true, actor: ACCOUNT, account: ACCOUNT,
  hats: [{ hat: 'eip155:42220:13.1', name: 'Council steward' }], expiresAt: '2026-10-30T10:00:00.000Z',
}
const NONCE = { nonce: 'n0nce0000000000000000b', message: buildSiweMessage({
  domain: 'localhost', address: ADDRESS, statement: "Sign in to Fixture Org's Hub. This proves you hold this address. Nothing is sent on chain and nothing is spent.",
  uri: 'http://localhost/', version: '1', chainId: 42220, nonce: 'n0nce0000000000000000b', issuedAt: '2026-10-29T10:00:00.000Z',
}) }

function routes(over: Record<string, unknown> = {}) {
  let now: SessionView = OUT
  return fetchRoutes({
    'GET /api/status': { org: 'Fixture Org' },
    'GET /api/session': () => now,
    'POST /api/session/nonce': NONCE,
    'POST /api/session': () => { now = IN; return IN },
    ...over,
  })
}
function wallet() {
  const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? [ADDRESS] : '0x' + 'ef'.repeat(65))
  ;(window as { ethereum?: unknown }).ethereum = { request }
  return request
}
const card = () => screen.getByRole('group', { name: 'Sign in with your wallet' })

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { delete (window as { ethereum?: unknown }).ethereum })

describe('the sign-in page (L5 spec §11.1)', () => {
  it('draws SignIn for the org, naming its tree, with SignIn’s title the only h1', async () => {
    routes()
    renderAt(<SignInPage />, '/sign-in')
    await waitFor(() => expect(card().querySelector('.signin-k')!.textContent).toBe('Fixture Org · members'))
    await waitFor(() => expect(card().querySelector('.signin-p')!.textContent).toContain('Your role is the hat you wear in tree #13.'))
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Sign in with your wallet'])
    expect(screen.getByRole('main').contains(card())).toBe(true)
    expect(document.body.textContent).not.toMatch(/house/i)
  })

  it('signs in and goes on to next', async () => {
    const { calls } = routes()
    wallet()
    const { loc } = renderAt(<SignInPage />, '/sign-in?next=%2Fgovernance%2Fproposals')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Ethereum' }))
    await waitFor(() => expect(loc.history.at(-1)).toBe('/governance/proposals'))
    expect(calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/api/session/nonce', '/api/session'])
  })

  it.each([['', '/'], ['?next=%2F%2Fexample.org', '/'], ['?next=https%3A%2F%2Fexample.org', '/'], ['?next=%2Fsign-in', '/']])(
    'goes to / when next is %s (only a path of this Hub)', async (search, lands) => {
      routes()
      wallet()
      const { loc } = renderAt(<SignInPage />, `/sign-in${search}`)
      fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Ethereum' }))
      await waitFor(() => expect(loc.history.at(-1)).toBe(lands))
    })

  it('a not-member: the sentence, and Read the public door going to /door', async () => {
    routes({ 'POST /api/session': { signedIn: false, notMember: true } })
    wallet()
    renderAt(<SignInPage />, '/sign-in')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Ethereum' }))
    const door = await screen.findByRole('link', { name: 'Read the public door' })
    expect(door.getAttribute('href')).toBe('/door')
    expect(within(card()).getByText('This address wears no hat in Fixture Org’s tree. You can still read the public door.')).toBeTruthy()
  })

  it('a 401 from the session post: the server’s sentence, and Try again, which signs again', async () => {
    const sentence = 'The wallet signed with another address than the one it gave. Choose one address in the wallet and sign again.'
    const { calls } = routes({ 'POST /api/session': refuse(401, { error: sentence }) })
    wallet()
    renderAt(<SignInPage />, '/sign-in')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Ethereum' }))
    expect(await within(card()).findByText(sentence)).toBeTruthy()
    fireEvent.click(within(card()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'POST' && c.path === '/api/session/nonce')).toHaveLength(2))
  })

  it('no wallet: the failed state with the §4.5 sentence', async () => {
    routes()
    renderAt(<SignInPage />, '/sign-in')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Ethereum' }))
    expect(await within(card()).findByText(NO_WALLET)).toBeTruthy()
    expect(within(card()).getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('a session past the grace (stale: it reads as public)', () => {
  const STALE: SessionView = { ...IN, hats: [], stale: true, band: 'Your hats could not be read for an hour; you see what anyone sees until they can be.' }

  it('does not go on to next from /sign-in', async () => {
    routes({ 'GET /api/session': STALE })
    const { loc } = renderAt(<SignInPage />, '/sign-in?next=%2Fchanges')
    await screen.findByRole('group', { name: 'Sign in with your wallet' })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(loc.history).toEqual(['/sign-in?next=%2Fchanges'])
  })

  it('says the §5.2 band on the card, with Try again, which signs in afresh (no card signed in with no hats)', async () => {
    let now: SessionView = STALE
    routes({ 'GET /api/session': () => now, 'POST /api/session': () => { now = IN; return IN } })
    const request = wallet()
    renderAt(<SignInPage />, '/sign-in')
    const group = await screen.findByRole('group', { name: 'Sign in with your wallet' })
    expect(await within(group).findByText(STALE.signedIn ? STALE.band! : '')).toBeTruthy()
    fireEvent.click(within(group).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'personal_sign' })))
  })

  it('in App, members-only reads that 401 do not loop between /sign-in and the page', async () => {
    const { calls } = fetchRoutes({
      ...baseRoutes({ 'GET /api/session': STALE }),
      'GET /api/actor': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
      'GET /api/changes': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
      'GET /api/registries': [], 'GET /api/resources': [],
    })
    const { loc } = renderAt(<App />, '/changes')
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    // The redirect replaces, so a bounce shows as the frame drawn (and read) again, not as a longer history.
    expect(calls.filter(c => c.path === '/api/resources')).toHaveLength(1)
    expect(calls.filter(c => c.path === '/api/changes')).toHaveLength(1)
    expect(loc.history).toEqual(['/changes'])
    expect(screen.queryByRole('group', { name: 'Sign in with your wallet' })).toBeNull()
  })
})

describe('/sign-in in App', () => {
  it('a session ended elsewhere, still cached as signed in: lands on /sign-in and stays', async () => {
    fetchRoutes({
      ...baseRoutes({ 'GET /api/session': OUT }),
      'GET /api/actor': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
      'GET /api/changes': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
      'GET /api/registries': [], 'GET /api/resources': [],
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['session'], IN)
    const { loc } = renderAt(<App />, '/changes', { queryClient: qc })
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in?next=%2Fchanges'))
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    expect(loc.history).toEqual(['/sign-in?next=%2Fchanges'])
    expect(screen.getByRole('button', { name: 'Sign in with Ethereum' })).toBeTruthy()
  })

  it('Sign out in the full App lands on /sign-in and stays there (does not go on to /)', async () => {
    let now: SessionView = { ...IN, mode: 'local' }
    fetchRoutes({
      ...baseRoutes({ 'GET /api/session': () => now }),
      'DELETE /api/session': () => { now = { ...OUT, mode: 'local' }; return new Response(null, { status: 204 }) },
      'GET /api/registries': [], 'GET /api/resources': [],
    })
    const { loc } = renderAt(<App />, '/b/home')
    // The identity is the session's (Task 20, L5 §11.3): the signed-in member's hat, not git's name.
    fireEvent.click(await screen.findByRole('button', { name: /Council steward/ }))
    const out = await within(screen.getByRole('menu', { name: 'Signed in' })).findByRole('menuitem', { name: 'Sign out' })
    fireEvent.click(out)
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in'))
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    expect(loc.history.at(-1)).toBe('/sign-in')
    expect(screen.getByRole('button', { name: 'Sign in with Ethereum' })).toBeTruthy()
  })

  it('draws the sign-in page in the blank layout: no sidebar, no top bar, no tray', async () => {
    fetchRoutes({ ...baseRoutes({ 'GET /api/session': OUT }), 'GET /api/registries': [], 'GET /api/resources': [] })
    renderAt(<App />, '/sign-in')
    expect(await screen.findByRole('group', { name: 'Sign in with your wallet' })).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Your change' })).toBeNull()
    await waitFor(() => expect(document.title).toBe('Sign in · Fixture Org'))
  })

  it('a members-only page in hosted mode, with no session, lands on /sign-in?next=', async () => {
    fetchRoutes({
      ...baseRoutes({ 'GET /api/session': OUT }),
      'GET /api/actor': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
      'GET /api/changes': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
      'GET /api/registries': [], 'GET /api/resources': [],
    })
    const { loc } = renderAt(<App />, '/changes')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in?next=%2Fchanges'))
    expect(await screen.findByRole('group', { name: 'Sign in with your wallet' })).toBeTruthy()
  })
})
