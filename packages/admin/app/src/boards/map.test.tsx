// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { BoardPage } from './Board.tsx'
import Inspector from '../inspector/Inspector.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse, resource } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

// As in HouseMap.test.tsx: watch the map's fitView calls (jsdom has no real geometry).
const fitView = vi.hoisted(() => vi.fn())
vi.mock('@xyflow/react', async importOriginal => {
  const m = await importOriginal<typeof import('@xyflow/react')>()
  return { ...m, useReactFlow: () => {
    const rf = m.useReactFlow()
    return { ...rf, fitView: (o?: Parameters<typeof rf.fitView>[0]) => { fitView(o); return rf.fitView(o) } }
  } }
})

beforeEach(() => { flowEnv(); fitView.mockClear() })
afterEach(() => vi.unstubAllGlobals())
const mod = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', source: null, attention: { level: 'alert', text: 'check fails' } })
const kms = resource({ id: 'module:b', kind: 'module', board: 'systems', name: 'kms', source: null })
const p1 = resource({ id: 'project:p', board: 'organization', name: 'River Commons' })
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({ ...baseRoutes(),
  'GET /api/graph/systems': { board: 'systems', nodes: [mod, kms], edges: [], portals: [{ id: 'portal:organization', toBoard: 'organization', text: '1 link', targets: ['project:p'] }] },
  'GET /api/graph/organization': { board: 'organization', nodes: [p1], edges: [], portals: [] },
  'GET /api/layout/organization': {}, 'PUT /api/layout/organization': (init: RequestInit | undefined) => JSON.parse(String(init?.body)),
  'DELETE /api/layout/organization': { cleared: true }, 'GET /api/jobs': [], 'GET /api/proposals': [],
  'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] },
  'GET /api/resources/module%3Ab': { resource: kms, edges: [], neighbours: [] }, 'GET /api/operations': [], ...over })
const nodeOf = async (id: string) => {
  await waitFor(() => expect(document.querySelector(`[data-node-id="${id}"]`)).not.toBeNull())
  return document.querySelector(`[data-node-id="${id}"]`) as HTMLElement
}

// The map boards draw the house's map (E-42). Replaced (ledger C6): "centres once on the ?select=" (the house map fits
// the whole map; the selection is drawn selected), "saves a move made with the arrow keys" (arrows walk the map along
// its edges, §8.5; a node is moved by dragging it on the Organization map), and the Systems map's saved layout (it is
// laid out by authority, §8.2; only the Organization map keeps a layout).
describe('MapPage', () => {
  it('heads the map with its name, opens the inspector for ?select=, and draws that node selected; a portal is a linked node', async () => {
    routes()
    renderAt(<><BoardPage id="systems" /><Inspector /></>, '/b/systems?select=module%3Aa')
    expect(await screen.findByRole('heading', { level: 1, name: 'Systems map' })).toBeTruthy()
    const node = await nodeOf('module:a')
    expect(await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })).toBeTruthy()
    await waitFor(() => expect(node.getAttribute('aria-current')).toBe('true'))
    const portal = await nodeOf('portal:organization')
    expect(portal.textContent).toContain('on Organization map')
  })

  it('opens the inspector on a node, and keeps the selection in the address', async () => {
    routes()
    const { loc } = renderAt(<><BoardPage id="systems" /><Inspector /></>, '/b/systems')
    fireEvent.click((await nodeOf('module:b')).closest('.react-flow__node')!)
    expect(await screen.findByRole('complementary', { name: 'kms inspector' })).toBeTruthy()
    expect(loc.history.at(-1)).toBe('/b/systems?select=module%3Ab')
  })

  it('fits the map when it is first drawn, and not again on a click (C15)', async () => {
    routes()
    renderAt(<><BoardPage id="systems" /><Inspector /></>, '/b/systems')
    await nodeOf('module:a')
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    const fits = fitView.mock.calls.length
    fireEvent.click((await nodeOf('module:b')).closest('.react-flow__node')!)
    expect(await screen.findByRole('complementary', { name: 'kms inspector' })).toBeTruthy()
    expect(fitView).toHaveBeenCalledTimes(fits)
  })

  it('draws the Organization map where its saved layout puts it, and lets a node be dragged only once that layout has loaded (final 2)', async () => {
    let answer!: (v: unknown) => void
    const { calls } = routes({ 'GET /api/layout/organization': () => new Promise(r => { answer = r }) })
    renderAt(<BoardPage id="organization" />, '/b/organization')
    const flow = (await nodeOf('project:p')).closest('.react-flow__node') as HTMLElement
    expect(flow.classList.contains('draggable')).toBe(false)
    answer({ 'project:p': { x: 100, y: 100 } })
    await waitFor(() => expect(flow.style.transform).toBe('translate(100px,100px)'))
    await waitFor(() => expect(flow.classList.contains('draggable')).toBe(true))
    expect(calls.filter(c => c.method === 'PUT')).toEqual([])
  })

  it('saves a node moved in move mode to the layout: m, the arrows, Enter (C6 fix I-1)', async () => {
    const { calls } = routes({ 'GET /api/layout/organization': { 'project:p': { x: 100, y: 100 } } })
    renderAt(<BoardPage id="organization" />, '/b/organization')
    const node = await nodeOf('project:p')
    const flow = node.closest('.react-flow__node') as HTMLElement
    await waitFor(() => expect(flow.classList.contains('draggable')).toBe(true))
    fireEvent.keyDown(node, { key: 'm' })
    fireEvent.keyDown(node, { key: 'ArrowRight' })
    fireEvent.keyDown(node, { key: 'ArrowDown' })
    fireEvent.keyDown(node, { key: 'Enter' })
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT' && c.path === '/api/layout/organization').map(c => c.body))
      .toEqual([{ 'project:p': { x: 116, y: 116 } }]))
  })

  it('moves a node from its inspector with a single pointer: Move on the map, a nudge, Done (WCAG 2.5.7)', async () => {
    const { calls } = routes({ 'GET /api/layout/organization': { 'project:p': { x: 100, y: 100 } },
      'GET /api/resources/project%3Ap': { resource: p1, edges: [], neighbours: [] } })
    renderAt(<><BoardPage id="organization" /><Inspector /></>, '/b/organization')
    const flow = (await nodeOf('project:p')).closest('.react-flow__node') as HTMLElement
    await waitFor(() => expect(flow.classList.contains('draggable')).toBe(true))
    fireEvent.click(flow)
    fireEvent.click(await screen.findByRole('button', { name: 'Move on the map' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Move left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT').map(c => c.body)).toEqual([{ 'project:p': { x: 84, y: 100 } }]))
  })

  it('names the Organization map by what this viewer may see: a record they may not is not counted (§6.3)', async () => {
    const open = resource({ id: 'project:open', board: 'organization', name: 'Open project', facts: { visibility: 'public' } })
    routes({ 'GET /api/graph/organization': { board: 'organization', nodes: [p1, open], edges: [], portals: [] } })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><BoardPage id="organization" /></ViewAsProvider>, '/b/organization')
    expect(await screen.findByRole('group', { name: 'Organization map, 1 record' })).toBeTruthy()
    expect(document.querySelector('[data-node-id="project:p"]')).toBeNull()
  })

  it('previewing, the Organization map offers no Auto-layout and no move (C-23)', async () => {
    routes()
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><BoardPage id="organization" /></ViewAsProvider>, '/b/organization')
    const node = await nodeOf('project:p')
    fireEvent.keyDown(node, { key: 'm' })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Auto-layout' })).toBeNull()
    expect((node.closest('.react-flow__node') as HTMLElement).classList.contains('draggable')).toBe(false)
  })

  it('Auto-layout clears the saved layout', async () => {
    const { calls } = routes()
    renderAt(<BoardPage id="organization" />, '/b/organization')
    fireEvent.click(await screen.findByRole('button', { name: 'Auto-layout' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/layout/organization')).toBe(true))
  })

  it('sends an operation asked for on the map (the ⌘K path) to the record page that runs it', async () => {
    routes()
    const { loc } = renderAt(<BoardPage id="systems" />, '/b/systems?select=module%3Aa&op=module.checks&opLabel=Re-run+checks')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/r/module/a?op=module.checks&opLabel=Re-run+checks'))
  })

  it('says it is loading, then shows the error alone when the map cannot be read (C16)', async () => {
    routes({ 'GET /api/graph/systems': refuse(500, { error: 'the graph is down' }) })
    renderAt(<BoardPage id="systems" />, '/b/systems')
    // the first frame is a skeleton, never "Loading…" (§6.2; walk 2026-11-04)
    expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(await screen.findByText('the graph is down')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText(/Nothing on this map/)).toBeNull()
  })

  it('says so when the map holds nothing', async () => {
    routes({ 'GET /api/graph/systems': { board: 'systems', nodes: [], edges: [], portals: [] } })
    renderAt(<BoardPage id="systems" />, '/b/systems')
    expect(await screen.findByText(/Nothing on this map yet/)).toBeTruthy()
    expect(document.querySelector('.hmap')).toBeNull()
  })
})
