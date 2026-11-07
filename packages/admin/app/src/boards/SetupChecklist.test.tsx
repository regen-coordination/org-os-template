// @vitest-environment jsdom
// Home's setup checklist (design pass, spec 2026-11-04 §1b): built from the same emptiness the sidebar dots show.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SetupChecklist, setupItems } from './SetupChecklist.tsx'
import { BoardPage } from './Board.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, resource } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

afterEach(() => vi.unstubAllGlobals())

const memory = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  return store
}
const gov = (rules: unknown[]) => ({ model: null, description: null, rules, decisions: [], problems: [] })
/** People and projects set, the rules written; the rest empty: 4 of 9 with the name. */
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({ ...baseRoutes(),
  'GET /api/resources': [
    resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A' }),
    resource({ id: 'project:p', name: 'A project' }),
  ],
  'GET /api/registries': [{ name: 'members', kind: 'collection', count: 1 }, { name: 'projects', kind: 'collection', count: 1 }, { name: 'meetings', kind: 'collection', count: 0 }],
  'GET /api/governance': gov([{ id: 'r1' }]),
  'GET /api/proposals': [],
  ...over,
})
const setup = () => screen.findByRole('region', { name: 'Set up Fixture Org' })

describe("Home's setup checklist", () => {
  it('is shown to a known member who can write: "n of m", each item done or open, the open ones linking to their place', async () => {
    memory()
    routes()
    renderAt(<SetupChecklist />)
    const region = await setup()
    expect(within(region).getByRole('heading', { level: 2, name: 'Set up Fixture Org' })).toBeTruthy()
    expect(within(region).getByText('4 of 9 set')).toBeTruthy()
    const items = within(region).getAllByRole('listitem')
    expect(items.map(li => li.querySelector('.setup-l')!.textContent)).toEqual(
      ['Name and door', 'People', 'Roles and who decides', 'Projects', 'Connect the treasury', 'Track funding', 'Ideas', 'Meetings', 'First proposal'])
    // a done item says so to a screen reader and offers nothing; an open one links to its New, stepped (Option B, spec §1b)
    expect(items[1]!.textContent).toContain('done')
    expect(within(items[1]!).queryByRole('link')).toBeNull()
    const link = (i: number) => within(items[i]!).getByRole('link')
    expect(link(4).getAttribute('href')).toBe('/new/systems?steps=1')
    expect(link(4).textContent).toBe('Connect: Connect the treasury')
    expect(link(5).getAttribute('href')).toBe('/new/funding-opportunities?steps=1')
    expect(link(5).textContent).toBe('Add: Track funding')
    expect(link(6).getAttribute('href')).toBe('/new/ideas?steps=1')
    expect(link(7).getAttribute('href')).toBe('/new/meetings?steps=1')
    expect(link(8).getAttribute('href')).toBe('/governance/proposals')
  })

  it('is never shown to a read-only viewer, nor while previewing as someone else', async () => {
    memory()
    routes({ 'GET /api/actor': { unknown: 'x@example.org' } })
    const { qc, unmount } = renderAt(<SetupChecklist />)
    for (const key of ['proposals', 'resources', 'registries', 'governance', 'status', 'actor']) await waitFor(() => expect(qc.getQueryData([key])).toBeTruthy())
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
    unmount()
    routes()
    const preview = renderAt(<ViewAsProvider initial={{ as: 'members' }}><SetupChecklist /></ViewAsProvider>)
    await waitFor(() => expect(preview.qc.getQueryData(['proposals'])).toBeTruthy())
    await waitFor(() => expect(preview.qc.getQueryData(['actor'])).toBeTruthy())
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
  })

  it('Hide keeps it hidden for this viewer, in this browser, and still draws when storage is refused', async () => {
    const store = memory()
    routes()
    const first = renderAt(<SetupChecklist />)
    fireEvent.click(within(await setup()).getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
    expect(store.get('org-os-admin.setup.hidden.steward-a')).toBe('1')
    first.unmount()
    routes()
    const again = renderAt(<SetupChecklist />)
    for (const key of ['proposals', 'resources', 'registries', 'governance', 'status', 'actor']) await waitFor(() => expect(again.qc.getQueryData([key])).toBeTruthy())
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
    again.unmount()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('refused') }, setItem: () => { throw new Error('refused') }, removeItem: () => {} })
    routes()
    renderAt(<SetupChecklist />)
    fireEvent.click(within(await setup()).getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
  })

  it('reads "Set up the org" while the org has no name (review M-4)', async () => {
    memory()
    routes({ 'GET /api/status': { org: null, branch: 'main', dirty: false } })
    renderAt(<SetupChecklist />)
    const region = await screen.findByRole('region', { name: 'Set up the org' })
    expect(within(region).getByRole('heading', { level: 2 }).textContent).toBe('Set up the org')
  })

  // review I-2: the treasury is counted from data/systems.yaml's entries
  it('waits for data/systems.yaml before it draws; when that read fails it draws no treasury item (review I-2)', async () => {
    memory()
    routes({ 'GET /api/registries/systems': () => new Promise<Response>(() => {}) })
    const waiting = renderAt(<SetupChecklist />)
    for (const key of ['proposals', 'resources', 'registries', 'governance', 'status', 'actor']) await waitFor(() => expect(waiting.qc.getQueryData([key])).toBeTruthy())
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
    waiting.unmount()
    routes({ 'GET /api/registries/systems': () => new Response(JSON.stringify({ error: 'data/systems.yaml cannot be read' }), { status: 500 }) })
    renderAt(<SetupChecklist />)
    const region = await setup()
    expect(within(region).getAllByRole('listitem').map(li => li.querySelector('.setup-l')!.textContent)).not.toContain('Connect the treasury')
    expect(within(region).getByText('4 of 8 set')).toBeTruthy()
  })

  it('is gone once every item is set', () => {
    const all = setupItems({ org: 'Fixture Org', counts: { people: 1, projects: 2, treasury: 1, funding: 1, ideas: 3, meetings: 1 }, rules: 1, proposals: 1 })
    expect(all.every(i => i.done)).toBe(true)
    const some = setupItems({ org: 'Fixture Org', counts: { people: 1 }, rules: 0, proposals: 0 })
    expect(some.filter(i => i.done).map(i => i.id)).toEqual(['door', 'people'])
  })

  it('draws nothing once every item is set, live', async () => {
    memory()
    routes({
      'GET /api/resources': [
        resource({ id: 'person:a', kind: 'person' }), resource({ id: 'project:p' }), resource({ id: 'funding:f', kind: 'funding' }), resource({ id: 'idea:i', kind: 'idea' }),
        resource({ id: 'system:safe', kind: 'system', facts: { section: 'organization/treasury' } }),
      ],
      'GET /api/registries': [{ name: 'meetings', kind: 'collection', count: 2 }],
      'GET /api/proposals': [{ id: 'p-1', state: 'open' }],
    })
    const { qc } = renderAt(<SetupChecklist />)
    for (const key of ['proposals', 'resources', 'registries', 'governance', 'status', 'actor']) await waitFor(() => expect(qc.getQueryData([key])).toBeTruthy())
    expect(screen.queryByRole('region', { name: /^Set up/ })).toBeNull()
  })

  it('sits on Home, under its head', async () => {
    memory()
    routes({ 'GET /api/needs': [] })
    renderAt(<BoardPage id="home" />, '/b/home')
    const region = await setup()
    expect(document.querySelector('.greet')!.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
