// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import type { HouseMapProps } from '../map/HouseMap.tsx'

// The map, replaced by a probe that keeps the props of every render.
const seen: HouseMapProps[] = []
vi.mock('../map/HouseMap.tsx', () => ({
  HouseMap: (p: HouseMapProps) => { seen.push(p); return <div data-testid="map-probe" /> },
}))

const { BlockFrame } = await import('./BlockFrame.tsx')
const { mapBlock, listBlock } = await import('./index.ts')
const { fetchRoutes } = await import('../test/fetchRoutes.ts')
const { renderAt } = await import('../test/render.tsx')
const { baseRoutes, resource } = await import('../test/data.ts')
const { rememberView } = await import('../storage.ts')

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); seen.length = 0 })
const p = resource({ id: 'project:p1', board: 'organization', name: 'River Commons' })
const job = { id: 'j1', op: 'crew.check', resource: 'project:p1', label: 'Check', cmd: null, args: [], writes: [], status: 'running',
  created: new Date().toISOString(), started: new Date().toISOString(), ended: null, exitCode: null, changed: [], surprises: [], sentence: null }
const routes = () => fetchRoutes({ ...baseRoutes(), 'GET /api/jobs': [job], 'GET /api/resources': [p], 'GET /api/proposals': [],
  'GET /api/graph/organization': { board: 'organization', nodes: [p], edges: [], portals: [] }, 'GET /api/layout/organization': {} })

/** Waits for the map to be drawn with its positions, then lets the clock tick three times. */
async function ticks(): Promise<{ before: HouseMapProps['positions']; after: HouseMapProps[] }> {
  await waitFor(() => expect(seen.at(-1)?.positions?.['project:p1']).toBeTruthy())
  await new Promise(r => setTimeout(r, 30))
  const n = seen.length
  const before = seen.at(-1)!.positions
  act(() => { vi.advanceTimersByTime(3000) })
  return { before, after: seen.slice(n) }
}

// Replaces 0.6's "keeps the marks function's identity as the clock ticks" (MapCanvas rebuilt its nodes from it): the
// house map draws a dragged node from its own state until its positions change, so what must hold across the clock's
// ticks is the positions' identity — a tick never drops a drag in progress.
describe('a map block while a job runs (I-1)', () => {
  it("keeps the positions' identity as the clock ticks, so a node being dragged never snaps back", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    routes()
    renderAt(<BlockFrame bare def={mapBlock} id="m" cfg={{ title: 'Organization map', source: { map: 'organization' } }} />, '/b/organization')
    expect(await screen.findByTestId('map-probe')).toBeTruthy()
    const { before, after } = await ticks()
    expect(after.length).toBeGreaterThan(0) // the tick re-rendered the block
    expect(after.every(q => q.positions === before)).toBe(true)
  })

  it('keeps it for a list drawn as a map, too', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    routes()
    rememberView('mine', 'map')
    renderAt(<BlockFrame def={listBlock} id="l" cfg={{ title: 'Mine', source: { kind: 'project' }, view: { switch: true, map: 'organization', mapKey: 'mine' } }} />)
    expect(await screen.findByTestId('map-probe')).toBeTruthy()
    const { before, after } = await ticks()
    expect(after.length).toBeGreaterThan(0)
    expect(after.every(q => q.positions === before)).toBe(true)
  })
})
