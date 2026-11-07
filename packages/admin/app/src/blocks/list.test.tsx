// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BlockFrame, BlockView } from './BlockFrame.tsx'
import type { BlockData } from './types.ts'
import { NO_MARKS } from '../parts/marks.ts'
import { filterRows, listBlock } from './index.ts'
import Inspector from '../inspector/Inspector.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse, resource } from '../test/data.ts'
import { flowEnv } from '../test/flowEnv.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { TOGGLE_VIEW } from '../keys/useHouseKeys.ts'

afterEach(() => vi.unstubAllGlobals())
const projects = [
  resource({ id: 'project:br', name: 'River Commons', status: 'develop', facts: { lead: 'steward-a', started: '2026-10-02' }, changed: { at: '2026-10-14T10:00:00Z', by: 'Steward A' },
    source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'br' } }),
  resource({ id: 'project:site', name: 'studio.example', status: 'discovery', attention: { level: 'alert', text: 'v2 waits for your go' },
    source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'site' } }),
]
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [...projects, resource({ id: 'idea:x', kind: 'idea', name: 'venture commune' })],
  'GET /api/resources/project%3Asite': { resource: projects[1], edges: [], neighbours: [] }, 'GET /api/operations': [], 'GET /api/jobs': [], ...over })
const section = { title: 'Projects', source: { section: 'projects' }, view: { switch: true, filter: true, empty: 'No projects yet.', mapKey: 'projects', map: 'organization' } }
/** A filter put on through the header's + Filter form (C1: the free-text filter became the view header's chips). */
function addFilter(field: string, op: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  const form = screen.getByRole('form', { name: 'New filter' })
  fireEvent.change(within(form).getByLabelText('Field'), { target: { value: field } })
  fireEvent.change(within(form).getByLabelText('Condition'), { target: { value: op } })
  fireEvent.change(within(form).getByLabelText('Value'), { target: { value } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add filter' }))
}

describe('the list block', () => {
  it("lists what its source names with the kind's columns, each name linking to its record", async () => {
    routes()
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    const table = await screen.findByRole('grid', { name: 'Projects' })
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['name', 'status', 'needs', 'lead', 'started', 'changed'])
    expect(within(table).getByRole('link', { name: 'River Commons' }).getAttribute('href')).toBe('/r/project/br')
    expect(within(table).queryByText('venture commune')).toBeNull()
  })

  // walk 2026-11-04, L4c-fix 8: the record page names a lead by their member record; the table named them by id
  it('names a lead by the member record they are, as the record page does; masked as the record would be, else the id', async () => {
    const person = (id: string, name: string) => resource({ id: `person:${id}`, kind: 'person', name, source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: id } })
    routes({ 'GET /api/resources': [...projects, person('steward-a', 'Steward A')],
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }] } })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    const table = await screen.findByRole('grid', { name: 'Projects' })
    const row = within(table).getByRole('link', { name: 'River Commons' }).closest('tr')!
    const at = [...table.querySelectorAll('thead th')].findIndex(th => th.textContent === 'lead')
    await waitFor(() => expect(row.querySelectorAll('td, th[scope="row"]')[at]!.textContent).toBe('Steward A'))
  })

  it('names a lead whose member name is restricted "<hat> only", never the name', async () => {
    const lead = resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A', source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'steward-a' } })
    routes({ 'GET /api/resources': [...projects, lead],
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A', restricted: { name: 'hat:ops' } }] } })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    const table = await screen.findByRole('grid', { name: 'Projects' })
    const row = within(table).getByRole('link', { name: 'River Commons' }).closest('tr')!
    const at = [...table.querySelectorAll('thead th')].findIndex(th => th.textContent === 'lead')
    const cell = () => row.querySelectorAll('td, th[scope="row"]')[at]!
    await waitFor(() => expect(cell().textContent).toBe('Ops only'))
  })

  // C1 (ledger): a staged status is also the cell's (E-5): the row's mark and the status cell both say Staged, and
  // the cell shows the value the change leaves.
  it('marks a staged record in its row, and its staged status in the cell', async () => {
    routes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:br', set: { status: 'x' }, base: 'h', before: { status: 'develop' } }] }) })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    const row = (await screen.findByRole('link', { name: 'River Commons' })).closest('tr')!
    await waitFor(() => expect(within(row).getAllByText('Staged')).toHaveLength(2))
    const status = row.querySelector('td[data-card="status"]')!
    expect(status.className).toContain('tv-staged')
    expect(status.textContent).toBe('xStaged')
  })

  it('stages a status changed in its cell, one op through the tray, and the cell then reads Staged (E-5)', async () => {
    const op = { op: 'update', record: 'projects:br', set: { status: 'archive' } }
    const { calls } = routes({ 'POST /api/changes/ops': changeView({ ops: [{ ...op, base: 'h', before: { status: 'develop' } }] as never }) })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    const cell = (await screen.findByText('develop')).closest('td')!
    fireEvent.keyDown(cell, { key: 'Enter' })
    const input = within(cell).getByRole('textbox', { name: 'status' })
    fireEvent.change(input, { target: { value: 'archive' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(within(cell).getByText('Staged')).toBeTruthy())
    expect(calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([{ ops: [op] }])
    expect(cell.textContent).toBe('archiveStaged')
  })

  // D-12 (operator, 2026-11-04; C9's final-review carry): the list drew its rows before the file entries the lead cell's
  // mask reads had answered, so a name the gate keeps printed raw until they came.
  it('draws no row while the entries its mask reads are on their way: no name prints raw first (D-12)', async () => {
    const { calls } = routes({ 'GET /api/registries/projects': () => new Promise(() => {}) })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    await waitFor(() => expect(calls.some(c => c.path === '/api/registries/projects')).toBe(true))
    await waitFor(() => expect(calls.some(c => c.path === '/api/resources')).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(document.body.textContent).not.toContain('River Commons')
  })

  // D-12 (operator, 2026-11-04): the sentence a staged status is said with named the record by a name the gate marks
  // restricted, though its lead cell reads "Ops only" (rule 3, E-70).
  it('says a staged status under the masked name when the record’s name is restricted (D-12)', async () => {
    const op = { op: 'update', record: 'projects:br', set: { status: 'archive' } }
    routes({ 'POST /api/changes/ops': changeView({ ops: [{ ...op, base: 'h', before: { status: 'develop' } }] as never }),
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'br', status: 'develop', restricted: { name: 'hat:ops' } }] } })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    const cell = (await screen.findByText('develop')).closest('td')!
    fireEvent.keyDown(cell, { key: 'Enter' })
    const input = within(cell).getByRole('textbox', { name: 'status' })
    fireEvent.change(input, { target: { value: 'archive' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('Ops only: status archive, staged. It is in your changes.'))
    expect(document.body.textContent).not.toContain('River Commons')
  })

  it('offers no edit in place while previewing', async () => {
    routes()
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><BlockFrame def={listBlock} cfg={section} id="projects" /></ViewAsProvider>)
    const cell = (await screen.findByText('develop')).closest('td')!
    fireEvent.keyDown(cell, { key: 'Enter' })
    expect(within(cell).queryByRole('textbox')).toBeNull()
  })

  // C1 (ledger): the free-text filter became the view header's filter chips; nothing matching is the views' filtered-
  // empty state, "No projects match these filters." with Clear filters.
  it('filtered to nothing, says nothing matches, not that the list is empty (Review Focus 1)', async () => {
    routes()
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    await screen.findByRole('grid', { name: 'Projects' })
    addFilter('name', 'contains', 'nothing like this')
    expect(screen.getByRole('button', { name: 'Remove filter: Name contains nothing like this' })).toBeTruthy()
    // the filtered plate (design pass 2026-11-04): what the filters hid and how many, under the block's own head (h3)
    expect(screen.getByRole('heading', { level: 3, name: 'No projects match “Name contains nothing like this”' })).toBeTruthy()
    expect(screen.getByText('1 is develop and 1 is discovery.')).toBeTruthy()
    expect(screen.queryByText('No projects yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('link', { name: 'River Commons' })).toBeTruthy()
  })

  it('filters by a status, and by a need', async () => {
    routes()
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    await screen.findByRole('grid', { name: 'Projects' })
    addFilter('status', 'is-not', 'develop')
    expect(screen.queryByRole('link', { name: 'River Commons' })).toBeNull()
    expect(screen.getByRole('link', { name: 'studio.example' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Status is not develop' }))
    addFilter('needs', 'contains', 'your go')
    expect(screen.queryByRole('link', { name: 'River Commons' })).toBeNull()
  })

  it('draws, and counts, nothing the viewer may not see; with nothing left it says its empty words (E-6)', async () => {
    routes({ 'GET /api/resources': [{ ...projects[0]!, facts: { ...projects[0]!.facts, visibility: 'public' } }, projects[1]!] })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><BlockFrame def={listBlock} cfg={{ ...section, view: { ...section.view, count: 'title' } }} id="projects" /></ViewAsProvider>)
    const table = await screen.findByRole('grid', { name: 'Projects' })
    expect(within(table).getByRole('link', { name: 'River Commons' })).toBeTruthy()
    expect(within(table).queryByRole('link', { name: 'studio.example' })).toBeNull()
    // C9 (§14.2, ledger): the count sits in the section head beside the title, the region named by both
    expect(screen.getByRole('region', { name: 'Projects · 1' })).toBeTruthy()
  })

  it('says its empty words, not that filters left nothing, when the viewer may see none of it (E-6)', async () => {
    routes()
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><BlockFrame def={listBlock} cfg={section} id="projects" /></ViewAsProvider>)
    expect(await screen.findByText('No projects yet.')).toBeTruthy()
    expect(screen.queryByText('No projects match these filters.')).toBeNull()
    expect(screen.queryByRole('grid')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it("says an absent adapter's words when its section has no records (Review Focus 1)", async () => {
    routes({ 'GET /api/resources': [resource({ id: 'absent:crew', kind: 'absent', name: 'Crew', source: null, attention: { level: 'warn', text: 'No crew: scripts/crew.mjs is missing' } })] })
    renderAt(<BlockFrame def={listBlock} cfg={{ title: 'Crew', source: { section: 'crew' }, view: { absent: 'crew', empty: 'No crew roles or seats here.' } }} id="crew" />)
    expect((await screen.findByRole('note')).textContent).toBe('No crew: scripts/crew.mjs is missing')
  })

  it('shows a failed read alone', async () => {
    routes({ 'GET /api/resources': refuse(500, { error: 'resources are down' }) })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    expect(await screen.findByText('resources are down')).toBeTruthy()
    expect(screen.queryByText('No projects yet.')).toBeNull()
  })

  it('opens the inspector on a selected row unless told not to select', async () => {
    routes()
    renderAt(<><BlockFrame def={listBlock} cfg={section} id="projects" /><Inspector /></>, '/b/projects')
    fireEvent.click(await screen.findByText('discovery'))
    expect(await screen.findByRole('complementary', { name: 'studio.example inspector' })).toBeTruthy()
  })

  it('takes chosen columns, no head, and no selection (Home)', async () => {
    routes()
    renderAt(<BlockFrame def={listBlock} id="p" cfg={{ title: 'Projects', source: { kind: 'project', sort: '-changed', limit: 8 }, view: { columns: ['name', 'stage'], head: false, select: false } }} />)
    // C1 fix (I-1): no editable column, so a plain table, its links in the Tab order
    const table = await screen.findByRole('table', { name: 'Projects' })
    expect(table.querySelector('[data-cell]')).toBeNull()
    expect(table.querySelector('thead')).toBeNull()
    expect(table.getAttribute('tabindex')).toBeNull()
    expect(within(table).getAllByRole('link').map(a => a.textContent)).toEqual(['River Commons', 'studio.example'])
  })

  it('switches to its map: the same records, their neighbours faint', async () => {
    flowEnv()
    routes({ 'GET /api/graph/organization': { board: 'organization', portals: [], nodes: [...projects, resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A' })],
      edges: [{ from: 'project:br', to: 'person:steward-a', kind: 'lead' }] } })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    expect(await screen.findByRole('group', { name: 'Projects map' })).toBeTruthy()
    // the house's map (E-42): a neighbour not in the list is dimmed
    await waitFor(() => expect(document.querySelector('[data-node-id="person:steward-a"]')).not.toBeNull())
    expect(document.querySelector('[data-node-id="person:steward-a"]')!.className).toContain('is-dim')
  })

  // B3 (fix wave): a collection's map view failed its read and said so to nobody; it is an error note now, announced.
  it('says so, and says it out loud, when its map cannot be read', async () => {
    flowEnv()
    routes({ 'GET /api/graph/organization': refuse(500, { error: 'The graph could not be read.' }) })
    renderAt(<BlockFrame def={listBlock} cfg={section} id="projects" />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    const note = (await screen.findByText('The graph could not be read.')).closest('.note-error')
    expect(note).not.toBeNull()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('The graph could not be read.'))
  })

  it('renders the view header, List · Map as its tabs, and v turns between them while focus is in the list', async () => {
    flowEnv()
    routes({ 'GET /api/graph/organization': { board: 'organization', nodes: projects, edges: [], portals: [] } })
    renderAt(<BlockFrame def={listBlock} cfg={{ ...section, view: { ...section.view, mapKey: 'v-turns' } }} id="projects" />)
    const table = await screen.findByRole('grid', { name: 'Projects' })
    expect(within(screen.getByRole('tablist', { name: 'Views of Projects' })).getAllByRole('tab').map(t => t.textContent)).toEqual(['List', 'Map'])
    const cell = table.querySelector<HTMLElement>('td[data-cell]')!
    cell.focus()
    act(() => { cell.dispatchEvent(new Event(TOGGLE_VIEW, { bubbles: true })) })
    expect(await screen.findByRole('group', { name: 'Projects map' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true')
    act(() => { screen.getByRole('tab', { name: 'Map' }).dispatchEvent(new Event(TOGGLE_VIEW, { bubbles: true })) })
    expect(await screen.findByRole('grid', { name: 'Projects' })).toBeTruthy()
  })

  it('filterRows matches name, status and attention text, ignoring case', () => {
    expect(filterRows(projects, 'RIVER').map(r => r.id)).toEqual(['project:br'])
    expect(filterRows(projects, 'your go').map(r => r.id)).toEqual(['project:site'])
  })

  // C1 (ledger): List · Map are the view header's tabs, and the filter its + Filter.
  it('shows the List · Map switch in every state when the list has a map, and the filter only when ready (M-6)', () => {
    routes()
    const ctx = { now: new Date(), marks: NO_MARKS, stage: async () => {} }
    const datas: BlockData[] = [{ state: 'loading' }, { state: 'empty', count: 0 }, { state: 'error', error: 'down' }, { state: 'unavailable', error: 'No crew' }, { state: 'notYet' }]
    for (const data of datas) {
      const { unmount } = renderAt(<BlockView bare def={listBlock} cfg={section} id="projects" data={data} ctx={ctx} />)
      expect(screen.getByRole('tab', { name: 'Map' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
      unmount()
    }
    renderAt(<BlockView bare def={listBlock} cfg={section} id="projects" data={{ state: 'ready', data: projects, count: 2 }} ctx={ctx} />)
    expect(screen.getByRole('tab', { name: 'Map' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
  })

  it('remembers a switch to the map made before the records arrive (M-6)', async () => {
    routes({ 'GET /api/graph/organization': { board: 'organization', nodes: projects, edges: [], portals: [] } })
    const ctx = { now: new Date(), marks: NO_MARKS, stage: async () => {} }
    const { rerender } = renderAt(<BlockView bare def={listBlock} cfg={{ ...section, view: { ...section.view, mapKey: 'early' } }} id="projects" data={{ state: 'loading' }} ctx={ctx} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    flowEnv()
    rerender(<BlockView bare def={listBlock} cfg={{ ...section, view: { ...section.view, mapKey: 'early' } }} id="projects" data={{ state: 'ready', data: projects, count: 2 }} ctx={ctx} />)
    expect(await screen.findByRole('group', { name: 'Projects map' })).toBeTruthy()
    expect(screen.queryByRole('grid', { name: 'Projects' })).toBeNull()
  })
})
