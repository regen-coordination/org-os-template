// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { buildSiweMessage } from '../../../lib/siwe.mjs'
import { api, type SessionView } from '../api.ts'
import { fakeAddress } from '../elements/atoms/chain.ts'
import { Identity } from '../frame/Identity.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { refuse } from '../test/data.ts'
import { renderAt } from '../test/render.tsx'
import { NO_WALLET, SessionProvider, useSession } from './session.ts'
import type { Eip1193 } from './wallet.ts'

const ADDRESS = fakeAddress(6)
const ACCOUNT = `eip155:42220:${ADDRESS}`
const SIGNATURE = '0x' + 'cd'.repeat(65)
const OUT: SessionView = { mode: 'local', signIn: { chainId: 'eip155:42220', tree: 'eip155:42220:13' }, signedIn: false }
const IN: SessionView = {
  mode: 'local', signedIn: true, actor: ACCOUNT, account: ACCOUNT,
  hats: [{ hat: 'eip155:42220:13.1', name: 'Council steward' }], expiresAt: '2026-10-30T10:00:00.000Z',
}
const message = (address = ADDRESS) => buildSiweMessage({
  domain: 'localhost', address, statement: "Sign in to Fixture Org's Hub. This proves you hold this address. Nothing is sent on chain and nothing is spent.",
  uri: 'http://localhost/', version: '1', chainId: 42220, nonce: 'n0nce0000000000000000a', issuedAt: '2026-10-29T10:00:00.000Z',
})

/** A wallet in window.ethereum whose signature waits until the test lets it go. */
function wallet(over: Partial<Record<string, () => unknown>> = {}) {
  let release: (s: string) => void = () => {}
  const signed = new Promise<string>(r => { release = r })
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (over[method]) return over[method]!()
    if (method === 'eth_requestAccounts') return [ADDRESS]
    if (method === 'personal_sign') return signed
    throw new Error(`unexpected ${method}`)
  })
  const p: Eip1193 = { request }
  ;(window as { ethereum?: unknown }).ethereum = p
  return { request, release: (s = SIGNATURE) => release(s) }
}

/** The machine, drawn plainly: its state, its error, and its three actions. */
function Probe() {
  const s = useSession()
  return (
    <div>
      <p data-testid="state">{s.state}</p>
      <p data-testid="error">{s.error ?? ''}</p>
      <button type="button" onClick={() => { void s.signIn() }}>go</button>
      <button type="button" onClick={s.cancel}>stop</button>
    </div>
  )
}
const state = () => screen.getByTestId('state').textContent

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { delete (window as { ethereum?: unknown }).ethereum })

describe('useSession: the sign-in machine (L5 spec §11.1)', () => {
  it('idle → waiting → signed in: asks a nonce for the wallet’s address, has the wallet sign the server’s message, posts the signature', async () => {
    let now: SessionView = OUT
    const { calls } = fetchRoutes({
      'GET /api/session': () => now,
      'POST /api/session/nonce': { nonce: 'n0nce0000000000000000a', message: message() },
      'POST /api/session': () => { now = IN; return IN },
    })
    const w = wallet()
    renderAt(<Probe />, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(state()).toBe('waiting')
    await waitFor(() => expect(w.request).toHaveBeenCalledWith({ method: 'personal_sign', params: [expect.stringMatching(/^0x[0-9a-f]+$/), ADDRESS] }))
    expect(calls.filter(c => c.method === 'POST').map(c => [c.path, c.body]))
      .toEqual([['/api/session/nonce', { address: ADDRESS }]])
    await act(async () => { w.release() })
    await waitFor(() => expect(state()).toBe('signed-in'))
    expect(calls.filter(c => c.method === 'POST').at(-1)).toEqual({ method: 'POST', path: '/api/session', body: { nonce: 'n0nce0000000000000000a', signature: SIGNATURE } })
    // The only wallet methods asked are the four (§4.5): no chain switch.
    expect(w.request.mock.calls.map(([a]) => a.method)).toEqual(['eth_requestAccounts', 'personal_sign'])
  })

  it('Cancel while waiting returns to idle and posts nothing: the signature that comes later is dropped', async () => {
    const { calls } = fetchRoutes({
      'GET /api/session': OUT,
      'POST /api/session/nonce': { nonce: 'n0nce0000000000000000a', message: message() },
      'POST /api/session': IN,
    })
    const w = wallet()
    renderAt(<Probe />, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(w.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'personal_sign' })))
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(state()).toBe('idle')
    await act(async () => { w.release(); await new Promise(r => setTimeout(r, 20)) })
    expect(state()).toBe('idle')
    expect(calls.some(c => c.method === 'POST' && c.path === '/api/session')).toBe(false)
  })

  it('no wallet in the browser: failed, with the §4.5 sentence, and nothing asked of the server', async () => {
    const { calls } = fetchRoutes({ 'GET /api/session': OUT })
    renderAt(<Probe />, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'go' })) })
    await waitFor(() => expect(state()).toBe('failed'))
    expect(screen.getByTestId('error').textContent).toBe(NO_WALLET)
    expect(NO_WALLET).toBe("No wallet was found in this browser. Open the Hub in a browser with a wallet, or in your wallet's own browser.")
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
  })

  it('a not-member answer: the not-member state, and no session', async () => {
    fetchRoutes({
      'GET /api/session': OUT,
      'POST /api/session/nonce': { nonce: 'n0nce0000000000000000a', message: message() },
      'POST /api/session': { signedIn: false, notMember: true },
    })
    const w = wallet({ personal_sign: () => SIGNATURE })
    renderAt(<Probe />, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(state()).toBe('not-member'))
    expect(w.request).toHaveBeenCalledTimes(2)
  })

  it('a 401 from the session post: failed, with the server’s sentence', async () => {
    const sentence = 'This sign-in message is not known here or was already used. Ask for a new one and sign again.'
    fetchRoutes({
      'GET /api/session': OUT,
      'POST /api/session/nonce': { nonce: 'n0nce0000000000000000a', message: message() },
      'POST /api/session': refuse(401, { error: sentence }),
    })
    wallet({ personal_sign: () => SIGNATURE })
    const { loc } = renderAt(<SessionProvider><Probe /></SessionProvider>, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(state()).toBe('failed'))
    expect(screen.getByTestId('error').textContent).toBe(sentence)
    expect(loc.history).toEqual(['/sign-in']) // the session's own 401 sends nobody anywhere
  })

  it('a message that names another address than the wallet gave is not signed', async () => {
    const { calls } = fetchRoutes({
      'GET /api/session': OUT,
      'POST /api/session/nonce': { nonce: 'n0nce0000000000000000a', message: message(fakeAddress(9)) },
    })
    const w = wallet({ personal_sign: () => SIGNATURE })
    renderAt(<Probe />, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(state()).toBe('failed'))
    expect(screen.getByTestId('error').textContent).toMatch(/another address/)
    expect(w.request.mock.calls.map(([a]) => a.method)).toEqual(['eth_requestAccounts'])
    expect(calls.some(c => c.path === '/api/session' && c.method === 'POST')).toBe(false)
  })

  it('the wallet declining to sign (EIP-1193 4001): failed, in words, nothing posted', async () => {
    const { calls } = fetchRoutes({
      'GET /api/session': OUT,
      'POST /api/session/nonce': { nonce: 'n0nce0000000000000000a', message: message() },
    })
    wallet({ personal_sign: () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }) } })
    renderAt(<Probe />, '/sign-in')
    await waitFor(() => expect(state()).toBe('idle'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(state()).toBe('failed'))
    expect(screen.getByTestId('error').textContent).toBe('The wallet did not sign, so you are not signed in. Try again when you are ready.')
    expect(calls.some(c => c.path === '/api/session' && c.method === 'POST')).toBe(false)
  })
})

const WHO = { hatName: 'Council steward', address: ADDRESS, hatId: '13.1', hats: ['Council steward'] }

describe('Sign out, in the identity menu', () => {
  it('ends the session, forgets what was read as a member, and returns to /sign-in', async () => {
    let now: SessionView = IN
    const { calls } = fetchRoutes({
      'GET /api/session': () => now,
      'DELETE /api/session': () => { now = OUT; return new Response(null, { status: 204 }) },
    })
    const { loc, qc } = renderAt(<SessionProvider><Identity who={WHO} /></SessionProvider>, '/b/home')
    qc.setQueryData(['resources'], [{ id: 'project:members-only' }])
    fireEvent.click(screen.getByRole('button', { name: /Council steward/ }))
    const menu = screen.getByRole('menu', { name: 'Signed in' })
    const out = await within(menu).findByRole('menuitem', { name: 'Sign out' })
    await act(async () => { fireEvent.click(out) })
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in'))
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/session')).toBe(true)
    expect(qc.getQueryData(['resources'])).toBeUndefined()
    await waitFor(() => expect(qc.getQueryData(['session'])).toEqual(OUT))
  })

  it('is not offered without a session (a git member, or a specimen)', async () => {
    fetchRoutes({ 'GET /api/session': OUT })
    renderAt(<SessionProvider><Identity who={WHO} /></SessionProvider>, '/b/home')
    await waitFor(() => expect(screen.getByRole('button', { name: /Council steward/ })).toBeTruthy())
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    fireEvent.click(screen.getByRole('button', { name: /Council steward/ }))
    expect(within(screen.getByRole('menu', { name: 'Signed in' })).queryByRole('menuitem', { name: 'Sign out' })).toBeNull()
  })
})

function Reads({ what }: { what: () => Promise<unknown> }) {
  useQuery({ queryKey: ['probe'], queryFn: what, retry: false })
  return null
}
const SIGN_IN_401 = refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' })

describe('a 401 in hosted mode', () => {
  it('sends the person from any query’s 401 to /sign-in?next=<path>', async () => {
    fetchRoutes({ 'GET /api/session': { ...OUT, mode: 'hosted' }, 'GET /api/governance': SIGN_IN_401 })
    const { loc } = renderAt(<SessionProvider><Reads what={api.governance} /></SessionProvider>, '/b/home?select=project%3Ap1')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in?next=%2Fb%2Fhome%3Fselect%3Dproject%253Ap1'))
  })

  it('sends nobody anywhere while the session, read again now, is still live (past the grace it reads as public: the band says so)', async () => {
    const STALE: SessionView = { ...IN, mode: 'hosted', hats: [], stale: true, band: 'Your hats could not be read for an hour; you see what anyone sees until they can be.' }
    const { calls } = fetchRoutes({ 'GET /api/session': STALE, 'GET /api/governance': SIGN_IN_401 })
    const { loc } = renderAt(<SessionProvider><Reads what={api.governance} /></SessionProvider>, '/b/home')
    await waitFor(() => expect(calls.some(c => c.path === '/api/governance')).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(loc.history).toEqual(['/b/home'])
  })

  it('reads the session again on a 401, not from the cache: a session ended elsewhere goes to sign in at once', async () => {
    const { calls } = fetchRoutes({ 'GET /api/session': { ...OUT, mode: 'hosted' }, 'GET /api/governance': SIGN_IN_401 })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['session'], { ...IN, mode: 'hosted' }) // what the cache still says, within its staleTime
    const { loc } = renderAt(<SessionProvider><Reads what={api.governance} /></SessionProvider>, '/b/home', { queryClient: qc })
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in?next=%2Fb%2Fhome'))
    expect(calls.filter(c => c.path === '/api/session').length).toBeGreaterThan(0)
  })

  it('sends nobody anywhere in local mode', async () => {
    const { calls } = fetchRoutes({ 'GET /api/session': OUT, 'GET /api/governance': SIGN_IN_401 })
    const { loc } = renderAt(<SessionProvider><Reads what={api.governance} /></SessionProvider>, '/b/home')
    await waitFor(() => expect(calls.some(c => c.path === '/api/governance')).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(loc.history).toEqual(['/b/home'])
  })
})
