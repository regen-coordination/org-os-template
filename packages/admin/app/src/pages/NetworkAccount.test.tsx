// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { away } from '../session/accountSignIn.ts'
import NetworkAccount from './NetworkAccount.tsx'

// refi-dao-os network app spec §5.4, §5.7 (final review of B8): a node adds or removes its own account from a Hub page,
// by a click, never from a link alone. The page names the node, says what will happen, and leaves for the node's
// account's own sign-in (Certified by default, or a Bluesky handle), coming back to where the visitor started.

const BACK = 'https://network.example.org/refi-x/'
const OUT = { mode: 'hosted', signIn: null, signedIn: false, methods: ['email', 'atproto'] }

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { vi.restoreAllMocks() })

describe('Add or remove a node\'s account (/network-account)', () => {
  it('add: names the node, and starts with the node\'s account, Certified or a Bluesky handle, carrying the return', async () => {
    const go = vi.spyOn(away, 'go').mockImplementation(() => {})
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': OUT,
      'GET /api/network/nodes/refi-x': { id: 'refi-x', title: 'ReFi X', account: null },
      'POST /api/session/atproto/start': { url: 'https://auth.example/authorize?z=3' },
    })
    renderAt(<NetworkAccount />, `/network-account?purpose=add-node&node=refi-x&return=${encodeURIComponent(BACK)}`)
    expect(await screen.findByRole('heading', { name: 'Add ReFi X’s account to the ReFi DAO Network' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Certified' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://auth.example/authorize?z=3'))
    expect(calls.filter(c => c.method === 'POST')[0]!.body).toEqual({ purpose: 'add-node', node: 'refi-x', return: BACK })
    fireEvent.change(screen.getByLabelText('Or the node’s Bluesky handle'), { target: { value: 'refi-x.bsky.social' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with this handle' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(2))
    expect(calls.filter(c => c.method === 'POST')[1]!.body).toEqual({ purpose: 'add-node', node: 'refi-x', return: BACK, handle: 'refi-x.bsky.social' })
  })

  it('back from Certified\'s page with the node\'s Bluesky handle: it is filled in, and nothing starts until a click', async () => {
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': OUT,
      'GET /api/network/nodes/refi-x': { id: 'refi-x', title: 'ReFi X', account: null },
    })
    renderAt(<NetworkAccount />, '/network-account?purpose=add-node&node=refi-x&handle=refi-x.bsky.social')
    expect(((await screen.findByLabelText('Or the node’s Bluesky handle')) as HTMLInputElement).value).toBe('refi-x.bsky.social')
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })

  it('remove: names the node and its account; the start is withdraw-node', async () => {
    vi.spyOn(away, 'go').mockImplementation(() => {})
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': OUT,
      'GET /api/network/nodes/refi-x': { id: 'refi-x', title: 'ReFi X', account: { handle: 'refi-x.org' } },
      'POST /api/session/atproto/start': { url: 'https://auth.example/authorize?z=4' },
    })
    renderAt(<NetworkAccount />, '/network-account?purpose=withdraw-node&node=refi-x')
    expect(await screen.findByRole('heading', { name: 'Remove ReFi X’s account from the ReFi DAO Network' })).toBeTruthy()
    expect(screen.getByText(/refi-x\.org/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Certified' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1))
    expect(calls.filter(c => c.method === 'POST')[0]!.body).toEqual({ purpose: 'withdraw-node', node: 'refi-x' })
  })

  it('a node not on the network, or a page asked for something else, offers nothing to start', async () => {
    fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': OUT,
      'GET /api/network/nodes/nope': new Response(JSON.stringify({ error: 'That node is not on the ReFi DAO Network yet.' }), { status: 404 }),
    })
    renderAt(<NetworkAccount />, '/network-account?purpose=add-node&node=nope')
    expect(await screen.findByText('That node is not on the ReFi DAO Network yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue with Certified' })).toBeNull()
  })

  it('a purpose other than add or remove offers nothing', async () => {
    fetchRoutes({ 'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': OUT })
    renderAt(<NetworkAccount />, '/network-account?purpose=link&node=refi-x')
    expect(await screen.findByText(/adds or removes a node’s own account/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue with Certified' })).toBeNull()
  })
})
