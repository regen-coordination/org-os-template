// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, screen, within, waitFor } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { baseRoutes, changeView, resource } from '../test/data.ts'
import { page, p1, projectRoutes, projectSchema } from '../test/record.tsx'
import { ViewAsProvider, ViewAsControl } from '../viewAs/ViewAs.tsx'
import RecordPage from './Record.tsx'
import { renderAt } from '../test/render.tsx'
import { expectNoWriteControls } from '../test/publicPreview.tsx'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { GARDEN, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import { SAFE } from '../test/fixtures/house/org.ts'
import { proposalView } from '../test/fixtures/proposals.ts'
import { houseSource } from '../session/houseSource.ts'
import type { VisibilityView } from '../api.ts'

const systemRoutes = (system = TREASURY_SYSTEM, extra: Record<string, unknown> = {}) => {
  const id = system.source!.entityId!
  const visibility = typeof system.facts.visibility === 'string' ? { visibility: system.facts.visibility } : {}
  return fetchRoutes({ ...baseRoutes({
    'GET /api/registries/systems': { name: 'systems', kind: 'collection', schemaVersion: '1.0',
      entries: [{ id, kind: system.facts.kind, name: system.name, chain: system.facts.chain, address: system.facts.address, section: system.facts.section, ...visibility }] },
  }),
  [`GET /api/resources/system%3A${id}`]: { resource: system, edges: [], neighbours: [] },
  'GET /api/schemas/systems': { 'x-order': ['id', 'kind', 'name', 'chain', 'address', 'section'], properties: {} },
  'GET /api/operations': [], 'GET /api/jobs': [], ...extra })
}

afterEach(() => { vi.useRealTimers() })

describe('RecordPage, reading', () => {
  it('heads a record with its id, title, kind and from mark (Q70); then field rows, links as data rows, the small map as Touches, and history as events', async () => {
    projectRoutes()
    const { container } = page('/r/project/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Seed Library' })).toBeTruthy()
    const head = container.querySelector('header.rh')!
    expect(head.querySelector('.rh-id')!.textContent).toBe('p1')
    expect(head.querySelector('.rh-meta')!.textContent).toMatch(/^Projectfrom data\/projects\.yaml · read just now$/)
    expect(head.querySelector('.from time')!.getAttribute('datetime')).toMatch(/^\d{4}-\d\d-\d\dT/)
    const fields = screen.getByRole('group', { name: 'Fields' })
    expect(within(fields).getByRole('link', { name: 'Steward A' }).getAttribute('href')).toBe('/r/person/steward-a')
    const links = within(screen.getByRole('region', { name: 'Links' })).getByRole('list', { name: 'Links' })
    const row = within(links).getByRole('link', { name: /Steward A/ })
    expect(row.getAttribute('href')).toBe('/r/person/steward-a')
    expect(row.classList.contains('drow')).toBe(true)
    expect(row.querySelector('.drow-s')!.textContent).toBe('lead · person')
    const touches = screen.getByRole('region', { name: 'Touches' })
    expect(within(touches).getByTestId('minimap')).toBeTruthy()
    expect(within(touches).getByRole('link', { name: 'Open on the map' }).getAttribute('href')).toBe('/b/organization?select=project%3Ap1')
    const history = within(screen.getByRole('region', { name: 'History' })).getByRole('list', { name: 'History' })
    expect(within(history).getByText('Last changed by Steward A')).toBeTruthy()
    expect(within(history).getByText('just now')).toBeTruthy()
  })

  it('heads a System with the System header: its kind, chains, address chip, governing fact, read age, its from mark and its own link-out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW)
    systemRoutes()
    const { container } = page('/r/system/treasury')
    expect(await screen.findByRole('heading', { level: 1, name: 'Treasury' })).toBeTruthy()
    const head = container.querySelector('header.rh-sys')!
    expect(head.querySelector('.rh-eyebrow')!.textContent).toBe('Safe · System')
    expect(head.querySelector('.rh-gov')!.textContent).toBe('4 of 8 signers')
    expect(within(head as HTMLElement).getByRole('button', { name: `Copy address ${SAFE.slice(0, 6)}…${SAFE.slice(-4)}` })).toBeTruthy()
    expect(head.querySelector('.from')!.textContent).toBe('from Treasury · read 4\u00a0min ago')
    // the System's own "Open in …" is the page's only link out of the Hub
    const out = [...container.querySelectorAll('a[href^="http"]')]
    expect(out.map(a => a.textContent)).toEqual(['Open in Safe (opens in a new tab)'])
    expect(screen.getByRole('region', { name: 'Waiting on signers' })).toBeTruthy()
  })

  it('shows a System’s failed read as the header’s failed read age and a note, not an alert (E-67)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW)
    systemRoutes(GARDEN)
    const { container } = page('/r/system/garden')
    await screen.findByRole('heading', { level: 1, name: 'Example DAO Garden' })
    // said once, in the from mark of the System's own read (walk 2026-11-04, L4c-fix 7)
    expect(container.querySelectorAll('.rh-facts .age-failed').length).toBe(1)
    expect(container.querySelector('.rh-facts .from .age-failed')!.textContent).toBe('couldn’t read · last 2\u00a0h ago')
    expect(screen.getByText('Couldn’t read: api.studio.thegraph.com answered 503').closest('.note-error')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('draws a field it may not show as restricted: the lock, "<hat> only", never the value (E-60, §6.3)', async () => {
    projectRoutes({ 'GET /api/schemas/projects': { ...projectSchema, properties: { ...projectSchema.properties, budget: { type: 'string' }, contact: { type: 'string' } } } },
      () => [{ id: 'p1', title: 'Seed Library', status: 'develop', lead: 'steward-a', restricted: { budget: 'hat:ops', contact: 'hat:unknown-hat' } }])
    page('/r/project/p1')
    const fields = await screen.findByRole('group', { name: 'Fields' })
    const budget = within(fields).getByText('Budget').closest('dt')!
    expect(budget.querySelector('svg')).not.toBeNull()
    expect(budget.nextElementSibling!.textContent).toBe('Ops only')
    expect(within(fields).getByText('Contact').closest('dt')!.nextElementSibling!.textContent).toBe('unknown-hat only')
    expect(within(fields).queryByText('restricted')).toBeNull()
  })

  // V5 (fix round 4): the page's small map was given no entryOf, so a name the gate marks restricted printed raw in
  // its centre and in its pills, though the inspector's map masked it (rule 3, E-70). The page reads the entries now,
  // and waits for them, so the raw name never flashes.
  it('masks a name the file marks restricted on the small map: its centre and its neighbour read "Ops only" (E-70)', async () => {
    const near = resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A',
      source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'steward-a' } })
    projectRoutes({
      'GET /api/resources/project%3Ap1': { resource: p1, edges: [], neighbours: [near] },
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: 'p1', title: 'Seed Library', status: 'develop', lead: 'steward-a', restricted: { name: 'hat:ops' } }] },
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: 'steward-a', name: 'Steward A', restricted: { name: 'hat:ops' } }] },
    })
    page('/r/project/p1')
    const touches = await screen.findByRole('region', { name: 'Touches' })
    const small = within(touches).getByRole('group', { name: 'What Ops only touches' })
    const mini = within(small).getByTestId('minimap')
    expect(mini.querySelector('.mini-n.is-me')!.textContent).toBe('Ops only')
    const pill = mini.querySelector('.mini-n:not(.is-me)')!
    expect(pill.textContent).toBe('Ops only')
    // and the raw names are nowhere in the map: not its text, not a link's accessible name
    expect(mini.textContent).not.toContain('Seed Library')
    expect(mini.textContent).not.toContain('Steward A')
    expect(within(small).getByRole('link', { name: 'Ops only' })).toBeTruthy()
    expect(within(small).queryByRole('link', { name: /Steward A/ })).toBeNull()
    expect([...mini.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label')).join(' ')).not.toMatch(/Seed Library|Steward A/)
  })

  // D-12 (operator, 2026-11-04): the record's own heading printed a name the gate marks restricted, though its cells,
  // cards and maps masked it (rule 3, E-70). The heading reads "<hat> only" from the same function the inspector uses.
  it('heads a record whose name the file marks restricted with "Ops only", never its name (D-12, E-70)', async () => {
    projectRoutes({}, () => [{ id: 'p1', status: 'develop', lead: 'steward-a', restricted: { name: 'hat:ops' } }])
    const { container } = page('/r/project/p1')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Ops only' })
    expect(h1.textContent).toBe('Ops only')
    expect(container.querySelector('header.rh')!.textContent).not.toContain('Seed Library')
  })

  it('heads a System whose name the file marks restricted with "Ops only", in its heading and its from mark (D-12, E-70)', async () => {
    const id = TREASURY_SYSTEM.source!.entityId!
    fetchRoutes({ ...baseRoutes({
      'GET /api/registries/systems': { name: 'systems', kind: 'collection', schemaVersion: '1.0',
        entries: [{ id, kind: TREASURY_SYSTEM.facts.kind, chain: TREASURY_SYSTEM.facts.chain, address: TREASURY_SYSTEM.facts.address, restricted: { name: 'hat:ops' } }] },
    }),
    [`GET /api/resources/system%3A${id}`]: { resource: TREASURY_SYSTEM, edges: [], neighbours: [] },
    'GET /api/schemas/systems': { 'x-order': ['id', 'kind', 'name', 'chain', 'address', 'section'], properties: {} },
    'GET /api/operations': [], 'GET /api/jobs': [] })
    const { container } = page('/r/system/treasury')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Ops only' })
    expect(h1.textContent).toBe('Ops only')
    expect(container.querySelector('header.rh-sys')!.textContent).not.toContain('Treasury')
  })

  it('keeps a restricted field restricted while editing: no input for it, and the marker is never staged back', async () => {
    projectRoutes({ 'GET /api/schemas/projects': { ...projectSchema, properties: { ...projectSchema.properties, budget: { type: 'string' } } } },
      () => [{ id: 'p1', title: 'Seed Library', status: 'develop', restricted: { budget: 'hat:ops' } }])
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.queryByLabelText('Budget')).toBeNull()
    expect(screen.queryByLabelText(/^restricted/)).toBeNull()
    expect(screen.getByText('Budget').closest('dt')!.nextElementSibling!.textContent).toBe('Ops only')
  })

  it('marks a staged field whose value moved on the trunk as stale: the clay bar and "now <value> on the trunk"', async () => {
    projectRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'execute' }, base: 'h', before: { id: 'p1', status: 'idea' } }] }) })
    page('/r/project/p1')
    const cell = (await screen.findByText('execute')).closest('dd')!
    expect(cell.className).toBe('stale')
    expect(cell.textContent).toContain('now develop on the trunk')
    // the header's state says so too, in clay, not "Staged" in moss (walk 2026-11-04, L4c-fix 11)
    const head = document.querySelector('header.rh')!
    expect(head.querySelector('.smark-word')!.textContent).toBe('Changed since staged')
    expect(head.textContent).not.toMatch(/\bStaged\b/)
  })

  it('previewed as Public, a public record offers nothing that writes: no Edit, no operation, no dialog from ?op=, no Cancel (C8 fix I-1, C-23)', async () => {
    const created = new Date().toISOString()
    const doctor = { id: 'module.doctor', label: 'Run doctor', effect: 'reads', network: true, confirm: true, params: { type: 'object' }, preset: null, unavailable: null }
    projectRoutes({
      'GET /api/resources/project%3Ap1': { resource: { ...p1, facts: { visibility: 'public' } }, edges: [], neighbours: [] },
      'GET /api/operations': [doctor],
      'GET /api/jobs': [{ id: 'j0', op: 'module.doctor', resource: 'project:p1', label: 'Run doctor', cmd: null, args: [], writes: [], status: 'running',
        created, started: created, ended: null, exitCode: null, changed: [], surprises: [], sentence: null }],
      'GET /api/jobs/j0': { job: { id: 'j0', label: 'Run doctor', status: 'running', sentence: null, created, started: created }, log: '' },
    })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><RecordPage kind="project" id="p1" /></ViewAsProvider>, '/r/project/p1?op=module.doctor&opLabel=Run+doctor')
    expect(await screen.findByRole('heading', { level: 1, name: 'Seed Library' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /^Run doctor · running/ }))
    await screen.findByRole('group', { name: 'Run doctor log' })
    expect(screen.queryByRole('region', { name: 'Operations' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run doctor' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expectNoWriteControls()
  })

  // V3 (fix round 3): R7 fixed the block; the page twin still drew its inputs and a disabled Save when a preview began
  // mid-edit. A preview ends the edit's drawing (C-23: hidden, never disabled): the read rows and only Cancel.
  it('a preview that begins mid-edit draws the read rows and only Cancel, not the inputs nor a disabled Save (R7)', async () => {
    projectRoutes({ 'GET /api/resources/project%3Ap1': { resource: { ...p1, facts: { ...p1.facts, visibility: 'public' } }, edges: [], neighbours: [] } })
    renderAt(<ViewAsProvider><ViewAsControl /><RecordPage kind="project" id="p1" /></ViewAsProvider>, '/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('button', { name: 'Save to changes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^View as/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    // the fields are the read rows again, not inputs
    expect(await screen.findByRole('group', { name: 'Fields' })).toBeTruthy()
    expect(screen.queryByLabelText('Status')).toBeNull()
    // and the edit can still be put down
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull())
    expectNoWriteControls()
  })

  it('is not there for a viewer who may not see it: the not-found page, no header and no count (E-62)', async () => {
    projectRoutes()
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><RecordPage kind="project" id="p1" /></ViewAsProvider>, '/r/project/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'No page at /r/project/p1.' })).toBeTruthy()
    expect(screen.queryByText('Seed Library')).toBeNull()
    expect(document.querySelector('.rh-id, .rh-meta, .sect-n')).toBeNull()
  })

  it('shows staged values marked, with what the file holds struck beside them', async () => {
    projectRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'execute' }, base: 'h', before: { id: 'p1', status: 'develop' } }] }) })
    page('/r/project/p1')
    const cell = (await screen.findByText('execute')).closest('dd')!
    expect(cell.className).toBe('staged')
    expect(cell.querySelector('.was s')!.textContent).toBe('develop')
  })

  it("shows the entry's YAML on source", async () => {
    projectRoutes()
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'source' }))
    const well = screen.getByLabelText('YAML')
    expect(well.textContent).toBe('id: p1\ntitle: Seed Library\nstatus: develop\nlead: steward-a\n')
    expect(well.className).toBe('mono-well')
  })

  it('reads a registry-only record from its registry', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off', participants: ['steward-a'] }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title', 'participants'], properties: {} } })
    page('/r/meetings/m-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Kick-off' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'steward-a' }).getAttribute('href')).toBe('/r/person/steward-a')
    expect(screen.queryByTestId('minimap')).toBeNull()
  })

  it("shows an adapter's facts in their own State section, named by source", async () => {
    const seat = resource({ id: 'seat:s1', kind: 'seat', board: 'systems', name: 'reviewer', source: { path: 'memory/crew/s1.md', editable: false },
      facts: { state: 'dialog', branch: 'crew/x', pane: null } })
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/seat%3As1': { resource: seat, edges: [], neighbours: [] }, 'GET /api/operations': [], 'GET /api/jobs': [] })
    page('/r/seat/s1')
    const state = await screen.findByRole('region', { name: 'State' })
    expect(within(state).getByText('from memory/crew/s1.md')).toBeTruthy()
    expect(within(state).getByText('dialog')).toBeTruthy()
    expect(within(state).queryByText('pane')).toBeNull()
  })

  it("keeps P1's accessible name for the State table: State (M-5)", async () => {
    const seat = resource({ id: 'seat:s1', kind: 'seat', board: 'systems', name: 'reviewer', source: { path: 'memory/crew/s1.md', editable: false }, facts: { state: 'dialog' } })
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/seat%3As1': { resource: seat, edges: [], neighbours: [] }, 'GET /api/operations': [], 'GET /api/jobs': [] })
    page('/r/seat/s1')
    const state = await screen.findByRole('region', { name: 'State' })
    expect(within(state).getByRole('group', { name: 'State' })).toBeTruthy()
  })

  it('reads a record at an encoded id: spaces, slashes and colons round-trip (Review Focus 4)', async () => {
    const odd = resource({ id: 'person:github:a b/c', kind: 'person', name: 'Odd One', source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'github:a b/c' } })
    const { calls } = fetchRoutes({ ...baseRoutes(),
      'GET /api/resources/person%3Agithub%3Aa%20b%2Fc': { resource: odd, edges: [], neighbours: [] },
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'github:a b/c', name: 'Odd One' }] },
      'GET /api/schemas/members': { 'x-order': ['id', 'name'], properties: {} }, 'GET /api/operations': [], 'GET /api/jobs': [] })
    page('/r/person/github%3Aa%20b%2Fc')
    expect(await screen.findByRole('heading', { level: 1, name: 'Odd One' })).toBeTruthy()
    expect(calls.some(c => c.path === '/api/resources/person%3Agithub%3Aa%20b%2Fc')).toBe(true)
  })

  it('shows a staged create that is not in the file yet', async () => {
    fetchRoutes({ ...baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'create', record: 'projects:new-one', value: { id: 'new-one', title: 'New one' }, base: null, before: null }] }) }),
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [] },
      'GET /api/schemas/projects': projectSchema, 'GET /api/operations': [], 'GET /api/jobs': [] })
    page('/r/project/new-one')
    expect(await screen.findByRole('heading', { level: 1, name: 'New one' })).toBeTruthy()
    expect(screen.getByText(/Staged as a new record/)).toBeTruthy()
  })

  it("names an entry it can't address: an id two entries share (contract)", async () => {
    projectRoutes({}, () => [{ id: 'p1', title: 'Seed Library' }, { id: 'p1', title: 'A second p1' }])
    page('/r/project/p1')
    expect(await screen.findByText('id p1 appears 2 times in data/projects.yaml; fix it in the file.')).toBeTruthy()
  })

  it('opens an entry with no id by its position, and says why it is read-only (contract)', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off' }, { title: 'Untitled notes' }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title'], properties: {} } })
    page('/r/meetings/%232')
    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled notes' })).toBeTruthy()
    expect(screen.getByText(/This entry has no id, so the platform cannot address it/)).toBeTruthy()
  })

  it('offers Edit only to a known member on an addressable, editable record (C11)', async () => {
    projectRoutes()
    page('/r/project/p1')
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('offers no Edit when the id is shared, the actor is unknown, or the source is read-only', async () => {
    projectRoutes({}, () => [{ id: 'p1', title: 'A' }, { id: 'p1', title: 'B' }])
    const shared = page('/r/project/p1')
    await screen.findByText(/appears 2 times/)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    shared.unmount()
    projectRoutes({ 'GET /api/actor': { unknown: 'x@y.z' } })
    const unknown = page('/r/project/p1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    unknown.unmount()
    projectRoutes({ 'GET /api/resources/project%3Ap1': { resource: { ...p1, source: { ...p1.source!, editable: false } }, edges: [], neighbours: [] } })
    page('/r/project/p1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('never links a fact url in State', async () => {
    const sys = resource({ id: 'seat:s2', kind: 'seat', board: 'systems', name: 'r', source: { path: 'x.md', editable: false }, facts: { url: 'https://evil.example/x' } })
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/seat%3As2': { resource: sys, edges: [], neighbours: [] }, 'GET /api/operations': [], 'GET /api/jobs': [] })
    page('/r/seat/s2')
    const state = await screen.findByRole('region', { name: 'State' })
    expect(within(state).queryByRole('link')).toBeNull()
  })

  it('says why when there is no such record', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [] },
      'GET /api/schemas/projects': projectSchema })
    page('/r/project/ghost')
    expect(await screen.findByText('no stub for GET /api/resources/project%3Aghost')).toBeTruthy()
  })

  // The L5 × L4c merge (INT): the record's visibility control (L5 §9.7, §11.4) sits among the record header's actions for
  // a member who may write the collection, and the header's marker gives way to it, so the level is drawn once; anyone
  // else reads the header's marker, with a level in flight beside it.
  describe('its visibility, in the record header (L5 §9.7, §11.4)', () => {
    const OPS = `eip155:42220:0x0000000d0002${'0'.repeat(52)}`
    const VIEW: VisibilityView = { tree: [{ hat: OPS, name: 'Ops', above: [] }], worn: [OPS], levels: ['public', 'members', `hat:${OPS}`],
      config: { collections: {}, defaults: {} }, writable: ['projects'] }
    const members = { 'GET /api/resources/project%3Ap1': { resource: { ...p1, facts: { ...p1.facts, visibility: 'members' } }, edges: [], neighbours: [] } }
    const entries = () => [{ id: 'p1', title: 'Seed Library', status: 'develop', lead: 'steward-a', visibility: 'members' }]
    const draw = (view: VisibilityView) =>
      renderAt(<ViewAsProvider source={houseSource(view)}><RecordPage kind="project" id="p1" /></ViewAsProvider>, '/r/project/p1')

    it('a member who may write the collection gets the control among the actions, and no second marker', async () => {
      projectRoutes({ ...members, 'GET /api/visibility': VIEW, 'GET /api/proposals': [] }, entries)
      draw(VIEW)
      const control = await screen.findByRole('button', { name: /^Members/ })
      expect(control.closest('header.rh .rh-acts')).toBeTruthy()
      expect(document.querySelectorAll('header.rh .vis')).toHaveLength(1)
    })

    it('a reader who may not change it reads the header\'s marker, with an open proposal\'s level beside it', async () => {
      const open = proposalView({ id: 'p-9', author: 'steward-b', ops: [{ op: 'update', record: 'projects:p1', set: { visibility: 'public' }, base: 'h1' }] as never })
      const view = { ...VIEW, writable: [] }
      projectRoutes({ ...members, 'GET /api/visibility': view, 'GET /api/proposals': [open] }, entries)
      draw(view)
      await waitFor(() => expect(document.querySelector('header.rh .vis')?.textContent).toBe('Members → Public, proposed'))
      expect(within(document.querySelector('header.rh') as HTMLElement).queryByRole('button', { name: /^Members/ })).toBeNull()
    })

    // A System is a record too (review I-1): the writer gets the control among the actions beside the System header, and
    // anyone else the System header's marker with the level in flight, as feat/dao-os drew it before the merge.
    const SYS_VIEW = { ...VIEW, writable: ['systems'] }
    const treasury = { ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts, visibility: 'members' } }
    const drawSystem = (view: VisibilityView) =>
      renderAt(<ViewAsProvider source={houseSource(view)}><RecordPage kind="system" id="treasury" /></ViewAsProvider>, '/r/system/treasury')

    it('a System: a member who may write the systems gets the control beside the System header, and no second marker', async () => {
      systemRoutes(treasury, { 'GET /api/visibility': SYS_VIEW, 'GET /api/proposals': [] })
      drawSystem(SYS_VIEW)
      const control = await screen.findByRole('button', { name: /^Members/ })
      expect(control.closest('.rh-acts')).toBeTruthy()
      expect(document.querySelectorAll('.vis')).toHaveLength(1)
    })

    it('a System: a reader who may not change it reads the System header\'s marker, with an open proposal\'s level beside it', async () => {
      const open = proposalView({ id: 'p-9', author: 'steward-b', ops: [{ op: 'update', record: 'systems:treasury', set: { visibility: 'public' }, base: 'h1' }] as never })
      const view = { ...SYS_VIEW, writable: [] }
      systemRoutes(treasury, { 'GET /api/visibility': view, 'GET /api/proposals': [open] })
      drawSystem(view)
      await screen.findByRole('heading', { level: 1, name: 'Treasury' })
      await waitFor(() => expect(document.querySelector('header.rh-sys .vis')?.textContent).toBe('Members → Public, proposed'))
      expect(screen.queryByRole('button', { name: /^Members/ })).toBeNull()
    })
  })
})
