// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { filterRows } from '../blocks/index.ts'
import { BoardPage } from './Board.tsx'
import { sectionBoardId } from '../../../lib/board-query.mjs'
import Inspector from '../inspector/Inspector.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse, resource } from '../test/data.ts'
import { flowEnv } from '../test/flowEnv.ts'

/** A filter put on through the view header's + Filter form (C1: the free-text filter became its filter chips). */
function addFilter(field: string, op: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  const form = screen.getByRole('form', { name: 'New filter' })
  fireEvent.change(within(form).getByLabelText('Field'), { target: { value: field } })
  fireEvent.change(within(form).getByLabelText('Condition'), { target: { value: op } })
  fireEvent.change(within(form).getByLabelText('Value'), { target: { value } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add filter' }))
}

const projects = [
  resource({ id: 'project:br', name: 'River Commons', status: 'develop', facts: { lead: 'steward-a', started: '2026-10-02' }, changed: { at: '2026-10-14T10:00:00Z', by: 'Steward A' } }),
  resource({ id: 'project:site', name: 'studio.example', status: 'discovery', attention: { level: 'alert', text: 'v2 waits for your go' } }),
]
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes(),
  'GET /api/resources': [...projects, resource({ id: 'idea:x', kind: 'idea', name: 'venture commune' })],
  'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }],
  'GET /api/resources/project%3Asite': { resource: projects[1], edges: [], neighbours: [] },
  'GET /api/operations': [],
  ...over,
})

describe('filterRows', () => {
  it('matches name, status and attention text, ignoring case', () => {
    expect(filterRows(projects, 'RIVER').map(r => r.id)).toEqual(['project:br'])
    expect(filterRows(projects, 'discovery').map(r => r.id)).toEqual(['project:site'])
    expect(filterRows(projects, 'your go').map(r => r.id)).toEqual(['project:site'])
    expect(filterRows(projects, '  ')).toHaveLength(2)
  })
})

describe('SectionPage', () => {
  it("lists the section's records with the kind's columns, each name linking to its record", async () => {
    routes()
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    const table = await screen.findByRole('grid', { name: 'Projects' })
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['name', 'status', 'needs', 'lead', 'started', 'changed'])
    expect(within(table).getByRole('link', { name: 'River Commons' }).getAttribute('href')).toBe('/r/project/br')
    expect(within(table).queryByText('venture commune')).toBeNull()
    expect(within(table).getByText('v2 waits for your go')).toBeTruthy()
    expect(within(table).getByText(/· Steward A$/)).toBeTruthy()
  })

  // C1 (ledger): the filter is the view header's (+ Filter, a chip per filter), and nothing matching is the views'
  // filtered-empty state; Enter opens the record from a cell of its row, the table's cells being its grid.
  it('filters by a chip, and says when nothing matches', async () => {
    routes()
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    await screen.findByRole('grid', { name: 'Projects' })
    addFilter('name', 'contains', 'river')
    expect(screen.queryByRole('link', { name: 'studio.example' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Name contains river' }))
    addFilter('name', 'contains', 'nothing like this')
    // the filtered plate (design pass 2026-11-04), under the page's h1: what the filters hid, and how many
    expect(screen.getByRole('heading', { level: 2, name: 'No projects match “Name contains nothing like this”' })).toBeTruthy()
    expect(screen.getByText('1 is develop and 1 is discovery.')).toBeTruthy()
  })

  it('opens the inspector on a selected row, and the record on Enter', async () => {
    routes()
    const { loc } = renderAt(<><BoardPage id={sectionBoardId('projects')} /><Inspector /></>, '/b/projects')
    fireEvent.click(await screen.findByText('discovery'))
    expect(await screen.findByRole('complementary', { name: 'studio.example inspector' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('link', { name: 'studio.example' }).closest('td')!, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/r/project/site')
  })

  // design pass 2026-11-04: Add is the page head's primary, with records too; the view header keeps none
  it('offers Add to a member where the registry is a writable collection, in the page head, and not otherwise', async () => {
    routes()
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    const add = await screen.findByRole('link', { name: 'Add project' })
    expect(add.getAttribute('href')).toBe('/new/projects')
    expect(add.closest('.rh')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
  })

  it('offers no New when your git email matches no member', async () => {
    routes(baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }))
    const { qc } = renderAt(<BoardPage id={sectionBoardId('projects')} />)
    await screen.findByRole('grid', { name: 'Projects' })
    await waitFor(() => expect(qc.getQueryData(['actor'])).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add project' })).toBeNull()
  })

  it('shows a mixed section with a kind column and the shared columns only', async () => {
    routes({ 'GET /api/resources': [resource({ id: 'role:lead', kind: 'role', board: 'systems', name: 'lead', source: null }),
      resource({ id: 'seat:s1', kind: 'seat', board: 'systems', name: 'reviewer', source: null })] })
    renderAt(<BoardPage id={sectionBoardId('crew')} />)
    const table = await screen.findByRole('grid', { name: 'Crew' })
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['kind', 'name', 'status', 'needs', 'changed'])
    expect(within(table).getByText('crew seat')).toBeTruthy()
  })

  // design pass 2026-11-04: an unconnected treasury is the connect plate, under its block's head (h3)
  it('says the treasury is not connected, what connecting gives, and Connect a Safe where you can add a system', async () => {
    routes({ 'GET /api/resources': [], 'GET /api/registries': [{ name: 'systems', kind: 'collection', count: 0 }] })
    renderAt(<BoardPage id={sectionBoardId('treasury')} />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Treasury isn’t connected' })).toBeTruthy()
    expect(screen.getByText(/the Hub reads its balances .* Read only: the Hub never signs\./)).toBeTruthy()
    expect((await screen.findByRole('link', { name: 'Connect a Safe' })).getAttribute('href')).toBe('/new/systems')
  })

  // review I-2: Treasury and Outside systems sort systems by their data/systems.yaml entry, so neither is drawn before it
  it('draws the treasury as loading while data/systems.yaml is read, never "isn’t connected" (review I-2)', async () => {
    const systems = resource({ id: 'system:safe', kind: 'system', name: 'Main Safe', facts: {}, source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'safe' } })
    routes({ 'GET /api/resources': [systems], 'GET /api/registries': [{ name: 'systems', kind: 'collection', count: 1 }],
      'GET /api/registries/systems': () => new Promise<Response>(() => {}) })
    renderAt(<BoardPage id={sectionBoardId('treasury')} />)
    await waitFor(() => expect(document.querySelector('[data-block] .skel[aria-busy="true"]')).not.toBeNull())
    expect(screen.queryByRole('heading', { name: 'Treasury isn’t connected' })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Connect/ })).toBeNull()
  })

  it('says a failed read of data/systems.yaml as the list’s error, never "nothing connected" (review I-2)', async () => {
    routes({ 'GET /api/resources': [], 'GET /api/registries': [{ name: 'systems', kind: 'collection', count: 0 }],
      'GET /api/registries/systems': refuse(500, { error: 'data/systems.yaml cannot be read: a bad indent' }) })
    renderAt(<BoardPage id={sectionBoardId('systems')} />)
    expect(await screen.findByText('data/systems.yaml cannot be read: a bad indent')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Connect/ })).toBeNull()
    expect(document.querySelector('.plate')).toBeNull()
  })

  it("explains an empty section by its adapter's absence", async () => {
    routes({ 'GET /api/resources': [resource({ id: 'absent:crew', kind: 'absent', name: 'Crew', source: null, attention: { level: 'warn', text: 'No crew: scripts/crew.mjs is missing' } })] })
    renderAt(<BoardPage id={sectionBoardId('crew')} />)
    expect((await screen.findByRole('note')).textContent).toBe('No crew: scripts/crew.mjs is missing')
  })

  it("says when the file holds entries it can't address, and links to them", async () => {
    routes({ 'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'br' }, { title: 'no id' }, { id: 'site' }] } })
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    expect(await screen.findByText(/1 entry in data\/projects\.yaml cannot be addressed/)).toBeTruthy()
    expect(screen.getByRole('link', { name: "see the file's list →" }).getAttribute('href')).toBe('/all/projects')
  })

  it('shows no empty sentence while loading or after a failed read (C16)', async () => {
    routes({ 'GET /api/resources': refuse(500, { error: 'resources are down' }) })
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    expect(await screen.findByText('resources are down')).toBeTruthy()
    expect(screen.queryByText(/No projects yet/)).toBeNull()
  })

  it('says it is loading before the first answer, not that it is empty', async () => {
    routes({ 'GET /api/resources': () => new Promise<Response>(() => {}) })
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    // a skeleton of the list's rows, never "Loading…" (§6.2; walk 2026-11-04)
    await waitFor(() => expect(document.querySelector('[data-block] .skel[aria-busy="true"]')).not.toBeNull())
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText(/No projects yet/)).toBeNull()
  })

  it('says the section is empty once the answer is in: its plate, under the page head and its about line', async () => {
    routes({ 'GET /api/resources': [] })
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Keep every piece of work in one place' })).toBeTruthy()
    expect(document.querySelector('.rh-about')!.textContent).toBe('The work this org is doing or planning: who leads each piece and where it stands')
  })

  // spec 2026-11-04 §1c: the plate's Import from a sheet opens the import sheet; Cancel closes it and focus goes back
  it("opens Import from a sheet from an empty section's plate, and Cancel hands focus back", async () => {
    routes({ 'GET /api/resources': [], 'GET /api/schemas/projects': { properties: { id: { type: 'string' }, name: { type: 'string' } } } })
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    const open = await screen.findByRole('button', { name: 'Import from a sheet' })
    open.focus()
    fireEvent.click(open)
    const sheet = await screen.findByRole('dialog', { name: 'Import from a sheet' })
    expect(within(sheet).getByText(/data\/projects\.yaml/)).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import from a sheet' })).toBeNull())
    expect(document.activeElement).toBe(open)
  })

  it("offers Import from a sheet in the section head's menu, where it offers Add", async () => {
    routes()
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    fireEvent.click(await screen.findByRole('button', { name: 'More for Projects' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import from a sheet' }))
    expect(await screen.findByRole('dialog', { name: 'Import from a sheet' })).toBeTruthy()
  })

  it('offers no import where it offers no Add', async () => {
    routes(baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }))
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    await screen.findByRole('grid', { name: 'Projects' })
    expect(screen.queryByRole('button', { name: 'More for Projects' })).toBeNull()
  })
})

// The section's map is the house's map in the collection's own graph layout (E-42): nodes found by their
// `data-node-id`, a neighbour dimmed, the canvas a group. "keeps an arrow-key move" is now move mode's (C6 fix I-1):
// outside it the arrows walk the map (§8.5).
const nodeOf = async (id: string) => {
  await waitFor(() => expect(document.querySelector(`[data-node-id="${id}"]`)).not.toBeNull())
  return document.querySelector(`[data-node-id="${id}"]`) as HTMLElement
}
const nodeIn = (id: string) => document.querySelector(`[data-node-id="${id}"]`)

describe('SectionPage, List · Map', () => {
  afterEach(() => vi.unstubAllGlobals())
  const graph = { 'GET /api/graph/organization': { board: 'organization', portals: [],
    nodes: [...projects, resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A' })],
    edges: [{ from: 'project:br', to: 'person:steward-a', kind: 'lead' }] } }
  const memory = (init: Record<string, string> = {}) => {
    const store = new Map(Object.entries(init))
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    return store
  }

  it('switches to the map: the same records, their direct neighbours faint, and the choice remembered', async () => {
    flowEnv()
    const store = memory()
    routes(graph)
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    expect(await screen.findByRole('group', { name: 'Projects map' })).toBeTruthy()
    expect((await nodeOf('person:steward-a')).className).toContain('is-dim')
    expect((await nodeOf('project:br')).className).not.toContain('is-dim')
    expect(store.get('org-os-admin.view.projects')).toBe('map')
  })

  it('opens on the map when that was the last choice, and keeps working with storage refused (Review Focus 5)', async () => {
    flowEnv()
    vi.stubGlobal('localStorage', { getItem: () => 'map', setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } })
    routes(graph)
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    expect(await screen.findByRole('group', { name: 'Projects map' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Auto-layout' }))
    fireEvent.click(screen.getByRole('tab', { name: 'List' }))
    expect(await screen.findByRole('grid', { name: 'Projects' })).toBeTruthy()
  })

  it("keeps the section's positions in this browser, never in the board's layout routes (C-1)", async () => {
    flowEnv()
    const store = memory({ 'org-os-admin.view.projects': 'map', 'org-os-admin.layout.projects': JSON.stringify({ 'project:br': { x: 999, y: 7 } }) })
    const { calls } = routes(graph)
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    const node = (await nodeOf('project:br')).closest('.react-flow__node') as HTMLElement
    await waitFor(() => expect(node.style.transform).toContain('translate(999px,7px)'))
    fireEvent.click(screen.getByRole('button', { name: 'Auto-layout' }))
    expect(store.has('org-os-admin.layout.projects')).toBe(false)
    await waitFor(() => expect(node.style.transform).not.toContain('translate(999px,7px)'))
    expect(calls.some(c => c.path.startsWith('/api/layout'))).toBe(false)
  })

  it("keeps a node moved in move mode in this browser's positions for the section (m, an arrow, Enter); it can be dragged too", async () => {
    flowEnv()
    const store = memory({ 'org-os-admin.view.projects': 'map', 'org-os-admin.layout.projects': JSON.stringify({ 'project:br': { x: 999, y: 7 } }) })
    routes(graph)
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    const node = await nodeOf('project:br')
    await waitFor(() => expect((node.closest('.react-flow__node') as HTMLElement).classList.contains('draggable')).toBe(true))
    fireEvent.keyDown(node, { key: 'm' })
    fireEvent.keyDown(node, { key: 'ArrowLeft' })
    fireEvent.keyDown(node, { key: 'Enter' })
    await waitFor(() => expect(JSON.parse(store.get('org-os-admin.layout.projects')!)).toEqual({ 'project:br': { x: 983, y: 7 } }))
  })

  it('opens the inspector on a node of the section map', async () => {
    flowEnv()
    memory({ 'org-os-admin.view.projects': 'map' })
    routes(graph)
    renderAt(<><BoardPage id={sectionBoardId('projects')} /><Inspector /></>, '/b/projects')
    fireEvent.click((await nodeOf('project:site')).closest('.react-flow__node')!)
    expect(await screen.findByRole('complementary', { name: 'studio.example inspector' })).toBeTruthy()
  })

  it('maps only what the filter leaves, and says when nothing matches', async () => {
    flowEnv()
    memory({ 'org-os-admin.view.projects': 'map' })
    routes(graph)
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    await nodeOf('project:site')
    addFilter('name', 'contains', 'river')
    await waitFor(() => expect(nodeIn('project:site')).toBeNull())
    expect(nodeIn('project:br')).toBeTruthy()
    addFilter('name', 'contains', 'nothing like this')
    expect(screen.getByRole('heading', { name: 'No projects match “Name contains river, Name contains nothing like this”' })).toBeTruthy()
    expect(screen.getByText('1 is develop and 1 is discovery.')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Projects map' })).toBeNull()
  })

  it("shows the map's read error alone, never an empty line (C16)", async () => {
    flowEnv()
    memory({ 'org-os-admin.view.projects': 'map' })
    routes({ 'GET /api/graph/organization': refuse(500, { error: 'the graph is down' }) })
    renderAt(<BoardPage id={sectionBoardId('projects')} />)
    expect(await screen.findByText('the graph is down')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })
})
