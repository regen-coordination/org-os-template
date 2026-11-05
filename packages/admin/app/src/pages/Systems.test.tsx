// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Systems from './Systems.tsx'
import Inspector from '../inspector/Inspector.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { SYSTEMS_UNREAD, baseRoutes, resource } from '../test/data.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { NETWORK_PROJECTS, SYSTEMS, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import { ACTOR, PROPOSALS, PROPOSAL_RESOURCES, RETURN_POOLS } from '../test/fixtures/house/governance.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

const connector = resource({ id: 'system:kms', kind: 'system', board: 'systems', name: 'Knowledge connector', status: 'kms-connector',
  facts: { kind: 'kms-connector', section: null }, source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'kms' } })
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes(), 'GET /api/resources': [...SYSTEMS, connector, resource()], 'GET /api/proposals': [], 'GET /api/jobs': [],
  'GET /api/resources/system%3Atreasury': { resource: TREASURY_SYSTEM, edges: [], neighbours: [] }, 'GET /api/operations': [], ...over,
})
beforeEach(() => { flowEnv(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('/systems: every System', () => {
  it('lists every System — the outside systems, the sources’ connectors, the treasury — as Systems rows under their column head', async () => {
    routes()
    renderAt(<Systems />, '/systems')
    expect(await screen.findByRole('heading', { level: 1, name: 'Systems' })).toBeTruthy()
    const list = await screen.findByRole('list', { name: 'Systems' })
    const names = within(list).getAllByRole('link').map(a => a.querySelector('.drow-t')!.textContent)
    expect(names).toEqual([...SYSTEMS.map(r => r.name), 'Knowledge connector'])
    expect([...document.querySelectorAll('.dlist-h > span')].map(s => s.textContent)).toEqual(['', 'Name', 'Chain', 'Where', 'State', 'Read'])
    expect(within(list).getByRole('link', { name: /^Treasury/ }).getAttribute('href')).toBe('/r/system/treasury')
  })

  it('is one tab stop per row: the rows’ chips are still, and Space previews a row in the inspector (E-36)', async () => {
    routes()
    renderAt(<><Systems /><Inspector /></>, '/systems')
    const list = await screen.findByRole('list', { name: 'Systems' })
    const rows = within(list).getAllByRole('link')
    expect(rows.every(r => r.querySelectorAll('button, a').length === 0)).toBe(true)
    expect(rows.filter(r => r.tabIndex === 0)).toHaveLength(1)
    fireEvent.keyDown(rows[0]!, { key: ' ' })
    expect(await screen.findByRole('complementary', { name: 'Treasury inspector' })).toBeTruthy()
  })

  it('List · Map: the map is the DAO map, the main Safe big', async () => {
    routes()
    renderAt(<Systems />, '/systems')
    await screen.findByRole('list', { name: 'Systems' })
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    await waitFor(() => expect(document.querySelector(`[data-node-id="${TREASURY_SYSTEM.id}"]`)).not.toBeNull())
    expect(document.querySelector(`[data-node-id="${TREASURY_SYSTEM.id}"]`)!.className).toContain('hnode-big')
    expect(screen.getByRole('group', { name: /Systems, as a map$/ })).toBeTruthy()
  })

  it('lights a node for a need only when the viewer may see that need: a restricted need titles no node (E-35)', async () => {
    const restricted = PROPOSAL_RESOURCES.map(r => (r.id === `proposal:${RETURN_POOLS.id}` ? { ...r, facts: { ...r.facts, visibility: 'hat:treasury' } } : r))
    routes({ 'GET /api/resources': [...SYSTEMS, ...restricted], 'GET /api/proposals': PROPOSALS,
      'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } })
    const pool = `[data-node-id="${NETWORK_PROJECTS.id}"]`
    const { unmount } = renderAt(<Systems />, '/systems')
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    await waitFor(() => expect(document.querySelector(pool)?.getAttribute('aria-label')).toMatch(/needs you: Return the Gardens pools/))
    unmount()
    renderAt(<ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}><Systems /></ViewAsProvider>, '/systems')
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    await waitFor(() => expect(document.querySelector(pool)).not.toBeNull())
    expect(document.querySelector(pool)!.className).not.toContain('is-needs')
    expect(document.querySelector(pool)!.getAttribute('aria-label')).not.toMatch(/Return the Gardens pools/)
  })

  it('opens the inspector at the need a lit node is lit for, Space on it (E-46): the need first, then the record', async () => {
    routes()
    renderAt(<><Systems /><Inspector /></>, '/systems')
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    const safe = await waitFor(() => { const n = document.querySelector(`[data-node-id="${TREASURY_SYSTEM.id}"]`); expect(n).not.toBeNull(); return n as HTMLElement })
    await waitFor(() => expect(safe.getAttribute('aria-label')).toMatch(/needs you: Sign nonce 18 on the Treasury/))
    fireEvent.keyDown(safe, { key: ' ' })
    const panel = await screen.findByRole('complementary', { name: 'Treasury inspector' })
    expect(panel.querySelector('.insp-need')!.textContent).toContain('Sign nonce 18 on the Treasury')
  })

  it('carries the from mark in its head (E-47)', async () => {
    routes()
    renderAt(<Systems />, '/systems')
    await screen.findByRole('list', { name: 'Systems' })
    await waitFor(() => expect(document.querySelector('.rh-meta .from')!.textContent).toMatch(/^from Fixture Org · read/))
  })
})

// review I-2's follow-up: the list draws facts, which need no entry; the map picks its main Safe and a tree's hats by
// their data/systems.yaml entries, so it waits for that file
describe('/systems before data/systems.yaml answered', () => {
  for (const [what, answer] of SYSTEMS_UNREAD) {
    it(`lists every System, and draws no map while data/systems.yaml ${what}: loading, then the read's error`, async () => {
      routes({ 'GET /api/registries/systems': answer })
      renderAt(<Systems />, '/systems')
      const list = await screen.findByRole('list', { name: 'Systems' })
      expect(within(list).getAllByRole('link').length).toBe(SYSTEMS.length + 1)
      fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
      await new Promise(r => setTimeout(r, 30))
      expect(document.querySelector('[data-node-id]')).toBeNull()
      if (what === 'could not be read') expect((await screen.findByText('data/systems.yaml cannot be read')).closest('.note')).not.toBeNull()
      else expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull()
    })
  }
})
