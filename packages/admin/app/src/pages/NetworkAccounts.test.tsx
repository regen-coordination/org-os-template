// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import NetworkAccounts from './NetworkAccounts.tsx'

// refi-dao-os network app spec §5.4, §5.6 (B6): stewards see the node accounts that are live (New, with Remove) and
// those waiting for a steward (Waiting, with Confirm and Decline). Remove and Decline ask a reason kept privately;
// Confirm asks which channel on the node's record was used. Synthetic values only.

const ID = 'example-org:person:example-steward'
const STEWARD = { mode: 'hosted', signedIn: true, via: 'email', actor: ID, viewer: 'member', expiresAt: '2026-12-19T10:00:00.000Z',
  person: { id: ID, name: 'Example Steward', roles: ['steward'], nodes: [] }, signIn: null, methods: ['email', 'atproto'], instanceWrites: 'off' }
const LIVE = { id: 'ne-1', node: 'refi-x', title: 'ReFi X', handle: 'refi-x.org', added: '2026-12-18T10:00:00.000Z', check: 'pass', why: 'domain' }
const WAITING = { id: 'ne-p', node: 'refi-y', title: 'ReFi Y', handle: 'refi-y-claim.bsky.social', added: '2026-12-17T10:00:00.000Z',
  note: 'the node already has a live account', channels: [{ key: 'website', url: 'https://refi-y.org/' }, { key: 'telegram', url: 'https://t.me/refiy' }] }

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { vi.restoreAllMocks() })

const board = (over: { new?: unknown[]; waiting?: unknown[] } = {}) => ({ new: [LIVE], waiting: [WAITING], ...over })

describe('Node accounts (/network-accounts)', () => {
  it('New lists the live accounts (node, handle, when, why); Waiting the pending ones with their note', async () => {
    fetchRoutes({ 'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': STEWARD, 'GET /api/network/entries': board() })
    renderAt(<NetworkAccounts />, '/network-accounts')
    const fresh = await screen.findByRole('region', { name: 'New' })
    expect(within(fresh).getByText('refi-x.org')).toBeTruthy()
    expect(within(fresh).getByText(/ReFi X · 2026-12-18 · checked both ways · its own domain/)).toBeTruthy()
    const waiting = screen.getByRole('region', { name: 'Waiting' })
    expect(within(waiting).getByText('refi-y-claim.bsky.social')).toBeTruthy()
    expect(within(waiting).getByText(/the node already has a live account/)).toBeTruthy()
  })

  it('says when a list is empty', async () => {
    fetchRoutes({ 'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': STEWARD, 'GET /api/network/entries': board({ new: [], waiting: [] }) })
    renderAt(<NetworkAccounts />, '/network-accounts')
    expect(await screen.findByText('No node account is live yet.')).toBeTruthy()
    expect(screen.getByText('Nothing is waiting.')).toBeTruthy()
  })

  it('Remove asks a reason, kept privately, then sends it', async () => {
    let entries = board()
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': STEWARD, 'GET /api/network/entries': () => entries,
      'POST /api/network/entries/ne-1/remove': () => { entries = board({ new: [] }); return new Response(null, { status: 204 }) },
    })
    renderAt(<NetworkAccounts />, '/network-accounts')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove refi-x.org' }))
    fireEvent.change(screen.getByLabelText('Why (kept privately)'), { target: { value: 'the node asked us' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ reason: 'the node asked us' }))
    await waitFor(() => expect(screen.queryByText('refi-x.org')).toBeNull())
  })

  it('Confirm asks which channel on the node\'s record was used, then sends it', async () => {
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': STEWARD, 'GET /api/network/entries': board(),
      'POST /api/network/entries/ne-p/confirm': new Response(null, { status: 204 }),
    })
    renderAt(<NetworkAccounts />, '/network-accounts')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm refi-y-claim.bsky.social' }))
    fireEvent.change(screen.getByLabelText('Confirmed with the node through'), { target: { value: 'telegram' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ channel: 'telegram' }))
  })

  it('Decline asks a reason, then sends it; a refusal shows the Hub\'s sentence', async () => {
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': STEWARD, 'GET /api/network/entries': board(),
      'POST /api/network/entries/ne-p/decline': new Response(JSON.stringify({ error: 'There is no such account waiting or live; nothing was changed.' }), { status: 404 }),
    })
    renderAt(<NetworkAccounts />, '/network-accounts')
    fireEvent.click(await screen.findByRole('button', { name: 'Decline refi-y-claim.bsky.social' }))
    fireEvent.change(screen.getByLabelText('Why (kept privately)'), { target: { value: 'not theirs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ reason: 'not theirs' }))
    expect(await screen.findByText('There is no such account waiting or live; nothing was changed.')).toBeTruthy()
  })

  it('anyone who is no steward reads the Hub\'s refusal, and no list', async () => {
    fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': { ...STEWARD, person: { ...STEWARD.person, roles: ['network-member'] } },
      'GET /api/network/entries': new Response(JSON.stringify({ error: 'Only stewards see and decide the network\'s node accounts.', code: 'STEWARDS_ONLY' }), { status: 403 }),
    })
    renderAt(<NetworkAccounts />, '/network-accounts')
    expect(await screen.findByText('Only stewards see and decide the network\'s node accounts.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'New' })).toBeNull()
  })
})
