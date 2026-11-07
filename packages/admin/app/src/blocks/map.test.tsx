// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { BlockFrame, BlockView } from './BlockFrame.tsx'
import { mapBlock } from './index.ts'
import Inspector from '../inspector/Inspector.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { SYSTEMS_UNREAD, baseRoutes, changeView, entryPlacedSafe, resource } from '../test/data.ts'
import { SYSTEMS, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'

beforeEach(() => flowEnv())
afterEach(() => vi.unstubAllGlobals())
const mod = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', source: null })
const p = resource({ id: 'project:p1', board: 'organization', name: 'River Commons' })
const lead = resource({ id: 'person:a', kind: 'person', board: 'organization', name: 'Steward A', status: null })
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({ ...baseRoutes(),
  'GET /api/graph/systems': { board: 'systems', nodes: [mod], edges: [], portals: [] },
  'GET /api/graph/organization': { board: 'organization', nodes: [p, lead], edges: [{ from: 'project:p1', to: 'person:a', kind: 'lead' }],
    portals: [{ id: 'portal:systems', toBoard: 'systems', text: '1 link', targets: ['module:a'] }] },
  'GET /api/layout/organization': { 'project:p1': { x: 40, y: 50 } }, 'PUT /api/layout/organization': (i: RequestInit | undefined) => JSON.parse(String(i?.body)),
  'GET /api/jobs': [], 'GET /api/proposals': [], 'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] },
  'GET /api/resources/project%3Ap1': { resource: p, edges: [], neighbours: [] }, 'GET /api/operations': [], ...over })
const nodeOf = async (id: string) => {
  await waitFor(() => expect(document.querySelector(`[data-node-id="${id}"]`)).not.toBeNull())
  return document.querySelector(`[data-node-id="${id}"]`) as HTMLElement
}

// The map block draws the house's map (E-42): house nodes and edges, its words plain. Replaces 0.6's MapCanvas cases
// (square nodes, node footers dated "who · when"; ledger C6).
describe('the map block', () => {
  it('draws the Organization map in its own graph layout, where its saved layout puts it, and keeps a selection in the address', async () => {
    routes()
    const { loc } = renderAt(<><BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Organization map', source: { map: 'organization' } }} /><Inspector /></>, '/b/organization')
    const node = await nodeOf('project:p1')
    const flow = node.closest('.react-flow__node') as HTMLElement
    await waitFor(() => expect(flow.style.transform).toBe('translate(40px,50px)'))
    expect(screen.getByRole('group', { name: 'Organization map, 2 records' })).toBeTruthy()
    fireEvent.click(flow)
    expect(await screen.findByRole('complementary', { name: 'River Commons inspector' })).toBeTruthy()
    expect(loc.history.at(-1)).toBe('/b/organization?select=project%3Ap1')
  })

  it('says each edge in plain words: a 0.6 lead edge "leads"', async () => {
    routes()
    renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Organization map', source: { map: 'organization' } }} />, '/b/organization')
    const node = await nodeOf('project:p1')
    const desc = document.getElementById(node.getAttribute('aria-describedby')!)!
    expect(desc.textContent).toMatch(/leads/)
  })

  it('draws a 0.6 portal as a linked node, "on Systems map", that opens the other map at its records', async () => {
    routes()
    const { loc } = renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Organization map', source: { map: 'organization' } }} />, '/b/organization')
    const portal = await nodeOf('portal:systems')
    expect(portal.className).toContain('is-linked')
    expect(portal.textContent).toContain('on Systems map')
    fireEvent.keyDown(portal, { key: 'Enter' })
    await waitFor(() => expect(loc.history.at(-1)).toBe('/b/systems?select=module%3Aa'))
  })

  it("marks a staged record's node", async () => {
    routes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'x' }, base: 'h', before: {} }] }) })
    renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Organization map', source: { map: 'organization' } }} />, '/b/organization')
    await waitFor(async () => expect((await nodeOf('project:p1')).className).toContain('is-staged'))
  })

  it('lays the Systems map out by authority: the main Safe big, its facts from its read', async () => {
    routes({ 'GET /api/graph/systems': { board: 'systems', nodes: SYSTEMS, edges: [], portals: [] }, 'GET /api/resources': SYSTEMS })
    renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Systems map', source: { map: 'systems' } }} />, '/b/systems')
    const safe = await nodeOf(TREASURY_SYSTEM.id)
    expect(safe.className).toContain('hnode-big')
    expect(safe.textContent).toContain('4 of 8 · 7 chains')
  })

  it('says the map is empty in its own words, and draws no canvas', async () => {
    routes({ 'GET /api/graph/systems': { board: 'systems', nodes: [], edges: [], portals: [] } })
    renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Systems map', source: { map: 'systems' }, view: { empty: 'Nothing on this map yet.' } }} />, '/b/systems')
    expect(await screen.findByText('Nothing on this map yet.')).toBeTruthy()
    expect(document.querySelector('.hmap')).toBeNull()
  })

  it('draws the records a source names on their map, kept in this browser', async () => {
    routes({ 'GET /api/resources': [p] })
    renderAt(<BlockFrame def={mapBlock} id="mine" cfg={{ title: 'Mine', source: { kind: 'project' }, view: { map: 'organization', mapKey: 'mine' } }} />)
    expect(await screen.findByRole('group', { name: 'Mine map' })).toBeTruthy()
    expect(await nodeOf('project:p1')).toBeTruthy()
  })

  // V1 (fix round 3): a full map fetched no registry entries — `entryOf` answered only for Systems — so a restricted
  // name and status printed raw on /b/organization, undoing A2 and R2 on that board.
  it('masks a restricted name and status on a full map, as a collection’s map does (rule 3, E-70)', async () => {
    const seeded = resource({ id: 'project:p1', kind: 'project', board: 'organization', name: 'Seed Library', status: 'confidential-pivot' })
    routes({
      'GET /api/graph/organization': { board: 'organization', nodes: [seeded], edges: [], portals: [] },
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: 'p1', restricted: { name: 'hat:ops', status: 'hat:ops' } }] },
    })
    const { container } = renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Organization map', source: { map: 'organization' } }} />, '/b/organization')
    const node = await nodeOf('project:p1')
    await waitFor(() => expect(node.textContent).toContain('Ops only'))
    // both read "<hat> only", drawn as restricted fields: the name and the facts line
    expect(node.querySelectorAll('.vis-field')).toHaveLength(2)
    expect(container.textContent).not.toContain('Seed Library')
    expect(container.textContent).not.toContain('confidential-pivot')
  })

  // D-12 (operator, 2026-11-04; C9's final-review carry): the Systems map read the file entry of a System only, so a
  // record of another kind there (a source, a channel) printed a name the gate marks restricted.
  it('masks a restricted name on the Systems map for a record that is not a System (D-12, E-70)', async () => {
    const src = resource({ id: 'source:s1', kind: 'source', board: 'systems', name: 'Council inbox', status: null,
      source: { path: 'data/sources.yaml', editable: true, registry: 'sources', entityId: 's1' } })
    routes({
      'GET /api/graph/systems': { board: 'systems', nodes: [src], edges: [], portals: [] },
      'GET /api/registries/sources': { name: 'sources', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 's1', restricted: { name: 'hat:ops' } }] },
    })
    const { container } = renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Systems map', source: { map: 'systems' } }} />, '/b/systems')
    const node = await nodeOf('source:s1')
    await waitFor(() => expect(node.textContent).toContain('Ops only'))
    expect(container.textContent).not.toContain('Council inbox')
  })

  it("dates a node's read by the block's clock, so /parts draws at its fixed time (final review M-9)", async () => {
    routes()
    const now = new Date('2026-10-17T12:00:00Z')
    const old = { ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts, driver: { ...(TREASURY_SYSTEM.facts.driver as object), state: 'aged', readAt: '2026-10-17T11:22:00Z' } } }
    const ctx = { now, marks: { change: null, jobs: new Map(), selected: null }, stage: async () => {} }
    const graph = { board: 'systems' as const, nodes: [old], edges: [], portals: [] }
    renderAt(<BlockView def={mapBlock} id="full" cfg={{ title: 'Full', source: { map: 'systems' }, view: { select: false } }} ctx={ctx}
      data={{ state: 'ready', count: 1, data: { full: true, board: 'systems', graph, saved: {}, layoutReady: true, entryOf: () => null } }} />)
    const node = await nodeOf(TREASURY_SYSTEM.id)
    await waitFor(() => expect(node.querySelector('.hnode-f')!.textContent).toBe('4 of 8 · 7 chains · 38 min'))
  })
})

// review I-2's follow-up: a map of a section that sorts systems by their data/systems.yaml entry waits for it
describe('a map of the treasury', () => {
  it('draws no Systems map after data/systems.yaml could not be read: the main Safe is its entry\'s, so the read\'s error', async () => {
    routes({ 'GET /api/graph/systems': { board: 'systems', nodes: SYSTEMS, edges: [], portals: [] }, 'GET /api/resources': SYSTEMS,
      'GET /api/registries/systems': SYSTEMS_UNREAD[1][1] })
    renderAt(<BlockFrame def={mapBlock} id="m" cfg={{ title: 'Systems map', source: { map: 'systems' } }} />, '/b/systems')
    await waitFor(() => expect(document.querySelector('[data-block="m"]')!.textContent).toContain('data/systems.yaml cannot be read'))
    expect(document.querySelector('[data-node-id]')).toBeNull()
  })

  for (const [what, answer] of SYSTEMS_UNREAD) {
    it(`draws no empty map while data/systems.yaml ${what}: loading, then the read's error`, async () => {
      const { calls } = routes({ 'GET /api/resources': [entryPlacedSafe], 'GET /api/registries/systems': answer })
      renderAt(<BlockFrame def={mapBlock} id="m" cfg={{ title: 'Treasury', source: { section: 'treasury' } }} />)
      await waitFor(() => expect(calls.some(c => c.path === '/api/resources')).toBe(true))
      await new Promise(r => setTimeout(r, 30))
      const block = document.querySelector('[data-block="m"]')!
      expect(block.getAttribute('data-state')).toBe(what === 'could not be read' ? 'error' : 'loading')
      if (what === 'could not be read') expect(block.textContent).toContain('data/systems.yaml cannot be read')
    })
  }
})
