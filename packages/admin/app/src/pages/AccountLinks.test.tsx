// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { away } from '../session/accountSignIn.ts'
import AccountLinks from './AccountLinks.tsx'

// refi-dao-os network app spec §5.3 (B4): a member links their own Bluesky or Certified account once, from the Hub,
// by signing in with it (an OAuth round-trip that proves it is theirs), and can unlink it with one button.

const ID = 'example-org:person:example-one'
const PERSON = { mode: 'hosted', signedIn: true, via: 'email', actor: ID, viewer: 'member', expiresAt: '2026-12-19T10:00:00.000Z',
  person: { id: ID, name: 'Example One', roles: ['network-member'], nodes: [] }, signIn: null, methods: ['email', 'atproto'], instanceWrites: 'on' }
const LINK = { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'one.bsky.social', linked: '2026-12-18T10:00:00.000Z' }

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { vi.restoreAllMocks() })

describe('Bluesky or Certified account (/account-links)', () => {
  it('lists the member\'s linked accounts by handle, each with Unlink, which unlinks it', async () => {
    let links = [LINK]
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': PERSON,
      'GET /api/session/atproto/links': () => ({ links }),
      [`DELETE /api/session/atproto/links/${encodeURIComponent(LINK.did)}`]: () => { links = []; return new Response(null, { status: 204 }) },
    })
    renderAt(<AccountLinks />, '/account-links')
    expect(await screen.findByText('one.bsky.social')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink one.bsky.social' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(screen.queryByText('one.bsky.social')).toBeNull())
  })

  it('links with Certified by default, or with a typed handle, by leaving for the account\'s own sign-in', async () => {
    const go = vi.spyOn(away, 'go').mockImplementation(() => {})
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': PERSON,
      'GET /api/session/atproto/links': { links: [] },
      'POST /api/session/atproto/start': { url: 'https://auth.example/authorize?x=1' },
    })
    renderAt(<AccountLinks />, '/account-links')
    fireEvent.click(await screen.findByRole('button', { name: 'Link with Certified' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://auth.example/authorize?x=1'))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ purpose: 'link' })
    fireEvent.change(screen.getByLabelText('Or a Bluesky handle'), { target: { value: '@one.bsky.social' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link this handle' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(2))
    expect(calls.filter(c => c.method === 'POST')[1]!.body).toEqual({ purpose: 'link', handle: 'one.bsky.social' })
  })

  it('back from Certified\'s page with a Bluesky handle: it is filled in, and nothing starts until a click', async () => {
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': PERSON, 'GET /api/session/atproto/links': { links: [] },
    })
    renderAt(<AccountLinks />, '/account-links?handle=one.bsky.social')
    expect(((await screen.findByLabelText('Or a Bluesky handle')) as HTMLInputElement).value).toBe('one.bsky.social')
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })

  it('says the server\'s sentence when the start is refused', async () => {
    fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': PERSON,
      'GET /api/session/atproto/links': { links: [] },
      'POST /api/session/atproto/start': new Response(JSON.stringify({ error: 'No Bluesky or Certified account answers to nope.example.' }), { status: 400 }),
    })
    renderAt(<AccountLinks />, '/account-links')
    fireEvent.change(await screen.findByLabelText('Or a Bluesky handle'), { target: { value: 'nope.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link this handle' }))
    expect(await screen.findByText('No Bluesky or Certified account answers to nope.example.')).toBeTruthy()
  })

  it('back from a link, says it worked', async () => {
    fetchRoutes({ 'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': PERSON, 'GET /api/session/atproto/links': { links: [LINK] } })
    renderAt(<AccountLinks />, '/account-links?linked=1')
    expect(await screen.findByText(/Linked\. Signing in with this account now signs you in as you/)).toBeTruthy()
  })

  it('anyone not signed in with their emailed link is told to do that first, and offered no link', async () => {
    fetchRoutes({ 'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': { mode: 'hosted', signIn: null, signedIn: false, methods: ['email', 'atproto'] } })
    renderAt(<AccountLinks />, '/account-links')
    expect(await screen.findByText(/Sign in with your emailed link first/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Link with Certified' })).toBeNull()
  })
})
