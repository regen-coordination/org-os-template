// @vitest-environment jsdom
// C9: a Workspace collection (`/b/projects`, `/b/people` …) is a page frame, the collection's view header and the
// chosen view (spec §14.1, §10.2); People's restricted fields read "<hat> only" in place of their value (rule 3, E-70).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BoardPage } from './Board.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, resource } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { expectNoWriteControls } from '../test/publicPreview.tsx'
import { flowEnv } from '../test/flowEnv.ts'

afterEach(() => vi.unstubAllGlobals())

const person = (id: string, name: string, facts: Record<string, unknown> = {}) => resource({
  id: `person:${id}`, kind: 'person', name, status: null, facts,
  source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: id },
})

describe('a Workspace collection', () => {
  it('is a page frame, the view header with its from mark, and the chosen view (§14.1, E-77)', async () => {
    flowEnv()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource({ id: 'project:br', name: 'River Commons', facts: { lead: 'steward-a' } })],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'br', title: 'River Commons' }] },
    })
    renderAt(<BoardPage id="projects" />, '/b/projects')
    const head = await waitFor(() => { const v = document.querySelector('.vhead'); expect(v).not.toBeNull(); return v! })
    const title = screen.getByRole('heading', { level: 1, name: 'Projects' })
    expect(title.closest('.rh')).not.toBeNull()
    expect(within(head as HTMLElement).getByRole('tablist', { name: 'Views of Projects' })).toBeTruthy()
    // where the collection was read from, in the view header's meta line (Q70)
    expect(head.querySelector('.vhead-meta')!.textContent).toMatch(/^from data\/projects\.yaml · read /)
    // the page head names the page once and carries no second from mark
    expect(title.closest('.rh')!.querySelector('.from')).toBeNull()
    const table = await screen.findByRole('grid', { name: 'Projects' })
    expect(head.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("draws People's restricted fields as “Ops only” in the table's cells and the narrow cards, never their value (rule 3, E-70)", async () => {
    flowEnv()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [person('steward-a', 'Steward A', { layer: 'core' }), person('steward-b', 'Steward B', { role: 'Treasury steward', layer: 'core' }),
        person('steward-c', 'Steward C', { layer: 'core' })],
      'GET /api/registries': [{ name: 'members', kind: 'collection', count: 3 }],
      // the gate's marker (R-L5-14.5): the field the viewer is not admitted to, with the level that keeps them out
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [
        { id: 'steward-a', name: 'Steward A', layer: 'core', restricted: { role: 'hat:ops' } },
        { id: 'steward-c', name: 'Steward C', layer: 'core', restricted: { name: 'hat:ops' } },
        { id: 'steward-b', name: 'Steward B', role: 'Treasury steward', layer: 'core' }] },
    })
    renderAt(<BoardPage id="people" />, '/b/people')
    const table = await screen.findByRole('grid', { name: 'People' })
    const roleAt = [...table.querySelectorAll('thead th')].findIndex(th => th.textContent === 'role')
    expect(roleAt).toBeGreaterThan(0)
    const roleOf = (name: string) => within(table).getByRole('link', { name }).closest('tr')!.querySelectorAll('td')[roleAt]!
    const restricted = await vi.waitFor(() => { const td = roleOf('Steward A'); if (!td.textContent) throw new Error('not yet'); return td })
    expect(restricted.textContent).toBe('Ops only')
    // the narrow form draws the same cell as one of the card's facts (TableView's data-card)
    expect(restricted.getAttribute('data-card')).toBe('meta')
    expect(restricted.querySelector('.vis-field')).not.toBeNull()
    expect(roleOf('Steward B').textContent).toBe('Treasury steward')
    // a restricted `name` too: the lead cell reads "Ops only" and the value is on the page nowhere (A2)
    const lead = await vi.waitFor(() => {
      const td = table.querySelector<HTMLElement>('tbody td[data-card="title"].tv-lead, tbody td[data-card="title"] .vis-field')?.closest('td')
      if (!td?.textContent) throw new Error('not yet')
      return td
    })
    expect(lead.textContent).toBe('Ops only')
    expect(lead.querySelector('.vis-field')).not.toBeNull()
    // R6 (fix wave): the cell keeps the row's link — a mouse user's only pointer path to the record — so it is named by
    // the words it shows and never by the value, and it opens Steward C's page like every other row's lead does.
    const kept = within(lead).getByRole('link', { name: 'Ops only' })
    expect(kept.getAttribute('href')).toBe('/r/person/steward-c')
    expect(kept.getAttribute('title')).toBeNull()
    expect(table.textContent).not.toContain('Steward C')
  })

  // C9 fix round 1 (ruling I-1, §10.2) moved New out of the block's foot; the design pass (2026-11-04) moves it on, to the
  // page head as "Add <noun>", the page's one primary once records exist; an empty one's plate adds "Add the first".
  it("puts Add in the page head as its primary, with the empty plate's Add the first, and draws neither while previewing", async () => {
    flowEnv()
    const routes = () => fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 0 }],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [] },
    })
    routes()
    const page = renderAt(<BoardPage id="projects" />, '/b/projects')
    const add = await screen.findByRole('link', { name: 'Add project' })
    expect(add.getAttribute('href')).toBe('/new/projects')
    expect(add.closest('.rh')).not.toBeNull()
    expect(add.className).toContain('primary')
    expect(add.closest('.vhead')).toBeNull()
    expect(add.closest('.bf-foot')).toBeNull()
    const first = await screen.findByRole('link', { name: 'Add the first project' })
    // the plate's Add is Option A, as the head's: B is for phones and the setup checklist (DP-47, the operator's call)
    expect(first.getAttribute('href')).toBe('/new/projects')
    expect(first.closest('.plate')).not.toBeNull()
    expect([...document.querySelectorAll('.btn.primary')]).toEqual([add, first])
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
    page.unmount()
    routes()
    // previewing as Members: the plate a viewer who can't add sees, and no write control
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><BoardPage id="projects" /></ViewAsProvider>, '/b/projects')
    expect(await screen.findByRole('heading', { level: 2, name: 'No projects yet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Who decides?' }).getAttribute('href')).toBe('/governance/rules')
    expect(screen.queryByRole('link', { name: 'Add project' })).toBeNull()
    expectNoWriteControls()
  })

  it('keeps Add the one primary once the collection has records', async () => {
    flowEnv()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource({ id: 'project:br', name: 'River Commons' })],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'br', title: 'River Commons' }] },
    })
    renderAt(<BoardPage id="projects" />, '/b/projects')
    await screen.findByRole('grid', { name: 'Projects' })
    const add = await screen.findByRole('link', { name: 'Add project' })
    expect([...document.querySelectorAll('.btn.primary')]).toEqual([add])
    expect(document.querySelector('.plate')).toBeNull()
  })

  it('says, previewing as Public, how many records it keeps from that viewer and the hat that may read them, never a name (D-12)', async () => {
    flowEnv()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource({ id: 'project:a', name: 'Secret Alpha', facts: { visibility: 'hat:ops' } }), resource({ id: 'project:b', name: 'Secret Beta', facts: { visibility: 'hat:ops' } })],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'a' }, { id: 'b' }] },
    })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><BoardPage id="projects" /></ViewAsProvider>, '/b/projects')
    expect(await screen.findByRole('heading', { level: 2, name: '2 projects you can’t see' })).toBeTruthy()
    expect(document.querySelector('.plate-l')!.textContent).toBe('They’re marked Ops only. People wearing the Ops hat can open them.')
    expect(screen.getByRole('link', { name: 'Ask for access' }).getAttribute('href')).toBe('/roles')
    expect(document.body.textContent).not.toMatch(/Secret/)
  })

  it("draws a registry-only section's plate (Meetings), and its file's read error as the broken plate", async () => {
    flowEnv()
    const routes = (registry: unknown) => fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [],
      'GET /api/registries': [{ name: 'meetings', kind: 'collection', count: 0 }],
      'GET /api/registries/meetings': registry,
      'GET /api/schemas/meetings': { type: 'object', properties: { id: { type: 'string' } } },
    })
    routes({ name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [] })
    const page = renderAt(<BoardPage id="meetings" />, '/b/meetings')
    expect(await screen.findByRole('heading', { level: 2, name: 'Keep a record of every meeting' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add the first meeting' }).getAttribute('href')).toBe('/new/meetings')
    expect(screen.getByRole('link', { name: 'Add meeting' }).closest('.rh')).not.toBeNull()
    expect(document.querySelector('.plate-foot')!.textContent).toContain('data/meetings.yaml')
    page.unmount()
    routes(() => new Response(JSON.stringify({ error: 'data/meetings.yaml cannot be read: at line 4, column 3, *x reuses a value marked &x.' }), { status: 409 }))
    renderAt(<BoardPage id="meetings" />, '/b/meetings')
    expect(await screen.findByRole('heading', { level: 2, name: 'Meetings can’t be read' })).toBeTruthy()
    expect(document.querySelector('.plate .note-error')!.textContent).toBe('Line 4 of data/meetings.yaml: *x reuses a value marked &x.')
  })

  it("says a section's file cannot be read, with its line and reason, from the records adapter's card (walk R-6)", async () => {
    flowEnv()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource({ id: 'absent:records:projects', kind: 'absent', name: 'data/projects.yaml', source: null,
        attention: { level: 'warn', text: 'cannot be read: data/projects.yaml cannot be read: at line 12, column 5, *a reuses a value marked &a, and no value before it in the file carries that mark. In the file, write the value in place of *a, then try again.' } })],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 0 }],
      'GET /api/registries/projects': () => new Response(JSON.stringify({ error: 'data/projects.yaml cannot be read' }), { status: 409 }),
    })
    renderAt(<BoardPage id="projects" />, '/b/projects')
    expect(await screen.findByRole('heading', { level: 2, name: 'Projects can’t be read' })).toBeTruthy()
    expect(document.querySelector('.plate .note-error')!.textContent).toBe(
      'Line 12 of data/projects.yaml: *a reuses a value marked &a, and no value before it in the file carries that mark. In the file, write the value in place of *a, then try again.')
    expect(document.querySelector('[data-plate="add"]')).toBeNull()
  })

  // C9 fix round 1 (check 2, rule 3): /api/resources gates whole records, never fields (server/visibility/gate.ts
  // gateGraph), so a record may still carry a value its marker restricts. A filter reads what the viewer is shown.
  it('never filters on a restricted value: the field matches only its restricted state', async () => {
    flowEnv()
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource({ id: 'project:p1', name: 'Seed Library', status: 'confidential-pivot' }), resource({ id: 'project:p2', name: 'Open Garden', status: 'develop', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'p2' } })],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [
        { id: 'p1', title: 'Seed Library', restricted: { status: 'hat:ops' } }, { id: 'p2', title: 'Open Garden', status: 'develop' }] },
    })
    renderAt(<BoardPage id="projects" />, '/b/projects')
    const table = await screen.findByRole('grid', { name: 'Projects' })
    const cellOf = (name: string) => within(table).getByRole('link', { name }).closest('tr')!.querySelector('td[data-card="status"]')!
    await waitFor(() => expect(cellOf('Seed Library').textContent).toBe('Ops only'))
    expect(table.textContent).not.toContain('confidential')
    const filter = (value: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
      const form = screen.getByRole('form', { name: 'New filter' })
      fireEvent.change(within(form).getByLabelText('Field'), { target: { value: 'status' } })
      fireEvent.change(within(form).getByLabelText('Value'), { target: { value } })
      fireEvent.click(within(form).getByRole('button', { name: 'Add filter' }))
    }
    filter('confidential')
    // the filtered plate reads each hidden row's status as the viewer is shown it: the kept one as "Ops only" (rule 3)
    expect(await screen.findByRole('heading', { name: 'No projects match “Status contains confidential”' })).toBeTruthy()
    expect(screen.getByText('1 is Ops only and 1 is develop.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('confidential-pivot')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    filter('Ops only')
    const left = await screen.findByRole('grid', { name: 'Projects' })
    expect(within(left).getAllByRole('row').slice(1).map(tr => tr.querySelector('a')!.textContent)).toEqual(['Seed Library'])
  })
})
