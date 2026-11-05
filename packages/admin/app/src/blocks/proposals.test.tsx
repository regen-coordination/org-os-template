// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { BlockFrame } from './BlockFrame.tsx'
import { proposalsBlock } from './index.ts'
import { blockType } from './registry.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, knownActor } from '../test/data.ts'
import { proposalViews, proposalView, PROPOSAL_NOW } from '../test/fixtures/proposals.ts'

// The block reads the clock; the fixtures are dated against PROPOSAL_NOW, so only Date is held there.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PROPOSAL_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const routes = (views = proposalViews, over: Record<string, unknown> = {}) =>
  fetchRoutes({ ...baseRoutes(), 'GET /api/proposals': views, 'GET /api/actor': { ...knownActor, id: 'carla' }, ...over })
const cfg = (proposals: string, title = 'Proposals') => ({ title, source: { proposals }, view: { empty: 'No proposals here.' } })
const names = (list: HTMLElement) => within(list).getAllByRole('link').map(a => a.querySelector('.drow-t')!.textContent)

describe('the proposals block', () => {
  it('is registered as proposals, and stages nothing', () => {
    expect(blockType('proposals')).toBe(proposalsBlock)
    expect(proposalsBlock.actions ?? {}).toEqual({})
  })

  // The rows are proposal rows in a data list now (CC-4, E-42): 0.6's Card-row table and its "approving" / "stale" pills
  // are replaced (ledger C6); the row says the id, the route, the step under way and the deadline.
  it('open: lists the open proposals as proposal rows — the one that waits on you marked, each with its route and when it closes', async () => {
    routes()
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('open', 'Open proposals')} id="p" />)
    const list = await screen.findByRole('list', { name: 'Open proposals' })
    expect(names(list)).toEqual(['Move the garden seat to the board', 'Open the spring call to non-members', 'Adopt the new budget line', 'Rename the host cooperative'])
    const first = within(list).getByRole('link', { name: /Move the garden seat to the board/ })
    expect(first.textContent).toContain('p-2026-10-16-001')
    expect(within(first).getByText('Closes in 5 days')).toBeTruthy()
    expect(within(first).getByText('Needs you')).toBeTruthy()
  })

  it('open: a proposal that needs nobody says nothing of you', async () => {
    routes()
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('open')} id="p" />)
    const list = await screen.findByRole('list', { name: 'Proposals' })
    const other = within(list).getByRole('link', { name: /Rename the host cooperative/ })
    expect(within(other).queryByText('Needs you')).toBeNull()
  })

  it('closed: lists the ratified, rejected, withdrawn and expired; the ratified Decided, the others closed and dimmed', async () => {
    routes()
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('closed')} id="p" />)
    const list = await screen.findByRole('list', { name: 'Proposals' })
    expect(names(list)).toEqual(['Add a second signer', 'Pay the retreat deposit', 'Change the logo', 'Join the regional network'])
    expect(within(list).getByRole('link', { name: /Add a second signer/ }).querySelector('.drow-end .smark-done')).not.toBeNull()
    expect(within(list).getByRole('link', { name: /Change the logo/ }).className).toContain('o-dim')
  })

  it('mine: the actor\'s own proposals, open and closed', async () => {
    routes()
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('mine')} id="p" />)
    const list = await screen.findByRole('list', { name: 'Proposals' })
    expect(names(list)).toEqual(['Move the garden seat to the board', 'Rename the host cooperative', 'Add a second signer', 'Pay the retreat deposit', 'Change the logo', 'Join the regional network'])
  })

  it('needs-me: the open proposals that wait on the actor', async () => {
    routes()
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('needs-me')} id="p" />)
    const list = await screen.findByRole('list', { name: 'Proposals' })
    expect(names(list)).toEqual(['Move the garden seat to the board', 'Adopt the new budget line'])
  })

  it('mine, with no known actor, is unavailable with the reason', async () => {
    routes(proposalViews, { 'GET /api/actor': { unknown: 'x@example.org' } })
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('mine')} id="p" />)
    expect(await screen.findByText('Your proposals are not known: x@example.org matches no member.')).toBeTruthy()
  })

  it('says empty in the sentence it was given', async () => {
    routes([proposalView({ state: 'ratified' })])
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('open')} id="p" />)
    expect(await screen.findByText('No proposals here.')).toBeTruthy()
  })

  it('says an error as the server said it', async () => {
    routes(proposalViews, { 'GET /api/proposals': () => new Response(JSON.stringify({ error: 'data/proposals.yaml cannot be read' }), { status: 409 }) })
    renderAt(<BlockFrame def={proposalsBlock} cfg={cfg('open')} id="p" />)
    expect(await screen.findByText('data/proposals.yaml cannot be read')).toBeTruthy()
  })
})
