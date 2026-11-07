// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import App from '../App.tsx'
import Needs from './Needs.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { ACTOR, NEEDS_SYSTEMS, PROPOSALS, PROPOSAL_RESOURCES } from '../test/fixtures/house/governance.ts'

const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } }),
  'GET /api/resources': [...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES], 'GET /api/proposals': PROPOSALS, 'GET /api/jobs': [],
  'GET /api/registries': [], 'GET /api/governance': { model: null, description: null, rules: [], decisions: [], problems: [] }, ...over,
})
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('/needs: Needs you, whole', () => {
  it('lists every item that waits on you, in its order — overdue first, then by deadline, then failed reads, then waiting on others', async () => {
    routes()
    renderAt(<Needs />, '/needs')
    expect(await screen.findByRole('heading', { level: 1, name: 'Needs you' })).toBeTruthy()
    const list = await screen.findByRole('list', { name: 'Needs you' })
    const titles = within(list).getAllByRole('link').map(a => a.querySelector('.need-t')!.textContent)
    expect(titles[0]).toBe('Close the spring call for local nodes')
    expect(titles.at(-1)).toBe('Add a Treasury signer') // you approved it: it waits on others
    expect(titles).toContain('The Example DAO Garden couldn’t be read')
    expect(titles.length).toBeGreaterThan(5) // the whole list, not Home's first five
  })

  it('lists a registry that cannot be read as a failed item, opening the registry (C12, operator)', async () => {
    const broken = { id: 'absent:records:members', kind: 'absent', board: 'organization', name: 'data/members.yaml', status: 'absent',
      attention: { level: 'warn', text: 'cannot be read: bad indentation (3:5)' }, changed: null, facts: {}, source: null }
    routes({ 'GET /api/resources': [...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES, broken] })
    renderAt(<Needs />, '/needs')
    const list = await screen.findByRole('list', { name: 'Needs you' })
    const row = within(list).getByRole('link', { name: /data\/members\.yaml couldn’t be read/ })
    expect(row.getAttribute('href')).toBe('/all/members')
    expect(row.textContent).toContain('bad indentation (3:5)')
  })

  it('a registry that cannot be read is not shown under a Public preview: it is the members\' (C12 review M-3)', async () => {
    const broken = { id: 'absent:records:members', kind: 'absent', board: 'organization', name: 'data/members.yaml', status: 'absent',
      attention: { level: 'warn', text: 'cannot be read: bad indentation (3:5)' }, changed: null, facts: {}, source: null }
    routes({ 'GET /api/resources': [...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES, broken] })
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><Needs /></ViewAsProvider>, '/needs')
    expect(await screen.findByText('data/members.yaml couldn’t be read')).toBeTruthy()
    cleanup()
    routes({ 'GET /api/resources': [...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES, broken] })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Needs /></ViewAsProvider>, '/needs')
    await screen.findByRole('heading', { level: 1, name: 'Needs you' })
    // the reads are in: the list is drawn, and holds nothing the public may not see
    expect(await screen.findByText('Nothing waits on you.')).toBeTruthy()
    expect(screen.queryByText(/data\/members\.yaml/)).toBeNull()
  })

  it('carries the from mark: the instance and when its records were read (E-47)', async () => {
    routes()
    renderAt(<Needs />, '/needs')
    await screen.findByRole('list', { name: 'Needs you' })
    await waitFor(() => expect(document.querySelector('.rh-meta .from')!.textContent).toMatch(/^from Fixture Org · read/))
  })

  it('says the error with Try again when the reads fail', async () => {
    routes({ 'GET /api/proposals': () => new Response(JSON.stringify({ error: 'the ledger cannot be read' }), { status: 500 }) })
    renderAt(<Needs />, '/needs')
    expect(await screen.findByText('the ledger cannot be read')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('g n lands here', async () => {
    vi.stubGlobal('WebSocket', class { onmessage = null; close() {} })
    routes()
    const { loc } = renderAt(<App />, '/activity')
    await screen.findAllByRole('heading', { level: 1 })
    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'n' })
    await waitFor(() => expect(loc.history.at(-1)).toBe('/needs'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Needs you' })).toBeTruthy()
  })
})
