// @vitest-environment jsdom
// Home in the house (C6, spec §14.1). This file replaces 0.6's Home cases (ledger C6): the org-and-branch head, the
// ⌘K button, the Needs you list block of records with attention, Projects, Crew, Recent operations and "Waiting for
// your say" are gone — Projects live in Workspace, crew and operations in the Instance group, and what waits on you
// (proposals and Systems, `needsFrom`) is Needs you.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BoardPage } from './Board.tsx'
import { dayLine, homeLine } from './HomeHead.tsx'
import { builtinBoard } from '../test/builtinBoards.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { baseRoutes, refuse } from '../test/data.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { ACTOR, PROPOSALS, PROPOSAL_RESOURCES } from '../test/fixtures/house/governance.ts'
import { GARDEN, SYSTEMS, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'

describe('homeLine', () => {
  it.each([
    [0, 'Nothing waits on you.'], [1, 'One thing waits on you.'], [2, 'Two things wait on you.'], [3, 'Three things wait on you.'],
    [9, 'Nine things wait on you.'], [10, '10 things wait on you.'], [12, '12 things wait on you.'], [-1, 'Nothing waits on you.'],
  ])('%i → %s', (n, line) => expect(homeLine(n)).toBe(line))

  it('dates the eyebrow in the viewer’s own day: "Thursday 29 October"', () => {
    expect(dayLine(new Date('2026-10-29T10:00:00Z'))).toBe('Thursday 29 October')
  })
})

/** Every System but the failed Garden (so none is failing), the proposals as the store lists them, and the ledger. */
const READ = SYSTEMS.filter(r => r.id !== GARDEN.id)
const decisions = [
  { date: '2026-10-15', id: 'DR-2026-011', title: 'Return the pools to the treasury', status: 'executed', group: null, where: 'governance.yaml' },
  { date: '2026-10-08', id: 'DR-2026-010', title: 'Remove a signer from the Treasury', status: 'ratified', group: null, where: 'governance.yaml' },
]
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } }),
  'GET /api/resources': [...READ, ...PROPOSAL_RESOURCES], 'GET /api/proposals': PROPOSALS, 'GET /api/jobs': [],
  'GET /api/governance': { model: null, description: null, rules: [], decisions, problems: [] }, ...over,
})

describe('Home', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('is a board of Needs you, Systems and Recently, in that order', () => {
    expect(builtinBoard('home').blocks.map(b => [b.id, b.type])).toEqual([['needs', 'needs'], ['systems', 'systems'], ['recently', 'recently']])
  })

  it('heads the page with the day, the line in the display face, and how everything else was read', async () => {
    routes()
    const { container } = renderAt(<BoardPage id="home" />)
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Four things wait on you.' })
    expect(h1.className).toBe('greet-t')
    expect(container.querySelector('.greet-day')!.textContent).toBe('Saturday 17 October')
    await waitFor(() => expect(container.querySelector('.greet-s')!.textContent)
      .toMatch(/^Everything else is as it was read 4 min ago · 7 Systems, none failing · from Fixture Org/))
    // the read age is said once: the line's, not again in the from mark (walk 2026-11-04, L4c-fix 9)
    expect(container.querySelector('.greet-s')!.textContent).toMatch(/· from Fixture Org$/)
    expect(container.querySelectorAll('.greet-s time').length).toBe(1)
  })

  it('then its sections: Needs you (with its count), Systems (with its count, List · Map), Recently — no Projects, Crew or Recent operations', async () => {
    routes()
    renderAt(<BoardPage id="home" />)
    const needs = await screen.findByRole('region', { name: 'Needs you · 5' })
    expect(within(needs).getByRole('list', { name: 'Needs you' })).toBeTruthy()
    expect(within(needs).getByRole('link', { name: 'All →' }).getAttribute('href')).toBe('/needs')
    const systems = await screen.findByRole('region', { name: 'Systems · 7' })
    expect(within(systems).getAllByRole('tab').map(t => t.textContent)).toEqual(['List', 'Map'])
    expect(within(systems).getByRole('link', { name: /^Treasury/ }).getAttribute('href')).toBe('/r/system/treasury')
    const recently = await screen.findByRole('region', { name: 'Recently' })
    expect(await within(recently).findByRole('link', { name: /Return the pools to the treasury/ })).toBeTruthy()
    for (const gone of ['Projects', 'Crew', 'Recent operations', 'Waiting for your say']) expect(screen.queryByRole('region', { name: new RegExp(`^${gone}`) })).toBeNull()
  })

  it('counts a registry that cannot be read in Needs you (C12, operator)', async () => {
    const broken = { id: 'absent:records:projects', kind: 'absent', board: 'organization', name: 'data/projects.yaml', status: 'absent',
      attention: { level: 'warn', text: 'cannot be read: bad indentation (3:5)' }, changed: null, facts: {}, source: null }
    routes({ 'GET /api/resources': [...READ, ...PROPOSAL_RESOURCES, broken] })
    renderAt(<BoardPage id="home" />)
    const needs = await screen.findByRole('region', { name: 'Needs you · 6' })
    expect(within(needs).getByRole('link', { name: /data\/projects\.yaml couldn’t be read/ }).getAttribute('href')).toBe('/all/projects')
  })

  // five items, four of them waiting on you: the line counts those, the list (and its count) holds the one you
  // approved too, waiting on others (§9.4)
  it('lists what waits on you, overdue first, each a link to where it is done', async () => {
    routes()
    renderAt(<BoardPage id="home" />)
    const list = await screen.findByRole('list', { name: 'Needs you' })
    const items = within(list).getAllByRole('link')
    expect(items[0]!.textContent).toMatch(/^Close the spring call for local nodes/)
    expect(items.map(a => a.getAttribute('href'))).toContain('/r/proposal/p-2026-10-17-001')
  })

  it('switches Systems to the DAO map, the main Safe big', async () => {
    flowEnv()
    routes()
    renderAt(<BoardPage id="home" />)
    const systems = await screen.findByRole('region', { name: 'Systems · 7' })
    fireEvent.click(within(systems).getByRole('tab', { name: 'Map' }))
    await waitFor(() => expect(systems.querySelector(`[data-node-id="${TREASURY_SYSTEM.id}"]`)).not.toBeNull())
    expect(systems.querySelector(`[data-node-id="${TREASURY_SYSTEM.id}"]`)!.className).toContain('hnode-big')
  })

  it('says "Nothing waits on you." when nothing does, over how the Systems were read', async () => {
    routes({ 'GET /api/resources': READ.filter(r => r.id === 'system:votes'), 'GET /api/proposals': [] })
    renderAt(<BoardPage id="home" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Nothing waits on you.' })).toBeTruthy()
    const needs = await screen.findByRole('region', { name: 'Needs you' })
    expect(within(needs).getByText('Nothing waits on you.')).toBeTruthy()
    expect(within(needs).getByText(/^1 System read 4.min ago, none failing\.$/)).toBeTruthy()
  })

  it('says the reads are on their way before they answer', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { fn } = routes()
    vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => { if (String(i).includes('/api/resources')) await gate; return fn(i, init) })
    renderAt(<BoardPage id="home" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Reading what waits on you…' })).toBeTruthy()
    expect(screen.queryByText('Nothing waits on you.')).toBeNull()
    release()
    expect(await screen.findByRole('heading', { level: 1, name: 'Four things wait on you.' })).toBeTruthy()
  })

  it('shows the error in place of the list, and says in the line that what waits could not be read', async () => {
    routes({ 'GET /api/resources': refuse(500, { error: 'the registry cannot be read' }) })
    renderAt(<BoardPage id="home" />)
    expect((await screen.findAllByText('the registry cannot be read')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('heading', { level: 1, name: 'What waits on you couldn’t be read.' })).toBeTruthy()
    expect(screen.queryByText('Nothing waits on you.')).toBeNull()
  })
})
