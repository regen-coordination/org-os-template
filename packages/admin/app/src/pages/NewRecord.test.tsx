// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import NewRecord from './NewRecord.tsx'
import type { StageOp } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { annotatedProjectSchema as annotated, projectSchema } from '../test/record.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

const at = (path: string) => renderAt(<Switch>
  <Route path="/new/:registry">{p => <NewRecord registry={p.registry} />}</Route>
  <Route path="/r/:kind/:id">landed</Route>
  <Route path="/:section">a section</Route>
</Switch>, path)
const routes = (seen: unknown[], over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes(),
  'GET /api/schemas/projects': projectSchema,
  'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }],
  'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }, { id: 'steward-b', name: 'Steward B' }] },
  'POST /api/changes/ops': (init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { ops: StageOp[] }
    seen.push(body)
    return changeView({ ops: body.ops.map(o => ({ ...o, base: null, before: null })) })
  },
  ...over,
})
const entries = (list: Record<string, unknown>[]) => ({ 'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: list } })

const rich = (seen: unknown[], over: Record<string, unknown> = {}) => routes(seen, { 'GET /api/schemas/projects': annotated, ...over })
const fieldsOf = (group: HTMLElement) => [...group.querySelectorAll('dt')].map(dt => dt.textContent)

describe('NewRecord', () => {
  it('opens an empty record; the id follows the title, and saving stages a create and goes to the new record', async () => {
    const seen: unknown[] = []
    routes(seen)
    const { loc } = at('/new/projects')
    expect(await screen.findByRole('heading', { level: 1, name: 'New project' })).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Site v3' } })
    expect(document.querySelector('.form-id-v')!.textContent).toBe('site-v3')
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(loc.history.at(-1)).toBe('/r/project/site-v3'))
    expect(seen).toEqual([{ ops: [{ op: 'create', record: 'projects:site-v3', value: { id: 'site-v3', title: 'Site v3' } }] }])
  })

  it('heads the page "New <kind>" with its from mark; a schema without words or groups is one group, labelled by its ids humanised', async () => {
    routes([])
    const { container } = at('/new/projects')
    expect(await screen.findByRole('heading', { level: 1, name: 'New project' })).toBeTruthy()
    const head = container.querySelector('header.rh')!
    expect(head.querySelector('.rh-id')!.textContent).toBe('new')
    expect(head.querySelector('.from')!.textContent).toBe('from data/projects.yaml')
    const details = await screen.findByRole('group', { name: 'Details' })
    expect(fieldsOf(details)).toEqual(['Title', 'Status', 'Lead', 'Started'])
    // one primary on the page, Save to changes, after the governance line
    expect([...container.querySelectorAll('.btn.primary')].map(b => b.textContent)).toEqual(['Save to changes'])
    expect(head.querySelector('.btn.primary')).toBeNull()
  })

  it('does not send a field typed and then cleared', async () => {
    const seen: unknown[] = []
    routes(seen)
    at('/new/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the id' }))
    fireEvent.change(screen.getByLabelText('id'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'create', record: 'projects:x', value: { id: 'x' } }] }]))
  })

  it('needs an id before it stages anything', async () => {
    const seen: unknown[] = []
    routes(seen)
    at('/new/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'Save to changes' }))
    expect(await screen.findByText('a new record needs an id')).toBeTruthy()
    expect(seen).toEqual([])
  })

  it('an edited id stops following the title', async () => {
    routes([])
    at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'One' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit the id' }))
    const id = screen.getByLabelText('id') as HTMLInputElement
    expect(id.value).toBe('one')
    fireEvent.change(id, { target: { value: 'first' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Two' } })
    expect((screen.getByLabelText('id') as HTMLInputElement).value).toBe('first')
  })

  it('checks the id as it is typed: one the file or the change holds is taken, and Save waits', async () => {
    routes([], { ...entries([{ id: 'site-v3', title: 'Site v3' }]), 'GET /api/changes': changeView({ ops: [{ op: 'create', record: 'projects:draft-a', value: { id: 'draft-a' }, base: null, before: null }] }) })
    at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Site v3' } })
    expect(await screen.findByText('projects already has an entry "site-v3".')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save to changes' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft A' } })
    expect(await screen.findByText('projects already has an entry "draft-a".')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Site v4' } })
    await waitFor(() => expect(screen.queryByText(/already has an entry/)).toBeNull())
    expect((screen.getByRole('button', { name: 'Save to changes' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Esc goes back to the section', async () => {
    routes([])
    const { loc } = at('/new/projects')
    await screen.findByRole('heading', { level: 1, name: 'New project' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(loc.history.at(-1)).toBe('/b/projects')
  })

  it('Cancel goes back to the section', async () => {
    routes([])
    const { loc } = at('/new/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(loc.history.at(-1)).toBe('/b/projects')
  })

  it('is off for someone whose git email matches no member', async () => {
    routes([], baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }))
    at('/new/projects')
    expect(await screen.findByText('Editing is off: the notice above says why.')).toBeTruthy()
  })

  it('is off while previewing as someone else, even typed as an address: no form, no Save (review M-5, C-23)', async () => {
    const seen: unknown[] = []
    routes(seen)
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><Switch>
      <Route path="/new/:registry">{p => <NewRecord registry={p.registry} />}</Route>
    </Switch></ViewAsProvider>, '/new/projects')
    expect(await screen.findByText('Editing is off: the notice above says why.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()
    fireEvent.keyDown(document.body, { key: 's', metaKey: true })
    expect(seen).toEqual([])
  })

  it('refuses an id beginning with #, which would read as a position (C14), as it is typed', async () => {
    const seen: unknown[] = []
    routes(seen)
    at('/new/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the id' }))
    fireEvent.change(screen.getByLabelText('id'), { target: { value: '#3' } })
    expect(await screen.findByText('ids beginning with # are read as positions; choose another')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    expect(seen).toEqual([])
  })

  it('shows the refusal under the id when the server will not stage the create', async () => {
    routes([], { 'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:p1', field: 'id', message: 'projects already has an entry "p1".' }] }) })
    const { loc } = at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'P1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    expect((await screen.findByText('projects already has an entry "p1".')).closest('.form-id')).not.toBeNull()
    expect(loc.history.at(-1)).toBe('/new/projects')
  })

  it('adds only where a section offers New (C11)', async () => {
    routes([], { 'GET /api/registries': [{ name: 'events', kind: 'collection', count: 0 }], 'GET /api/schemas/events': { properties: {} } })
    at('/new/events')
    expect(await screen.findByText('New is not offered for data/events.yaml: no section adds to it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
  })
})

describe('NewRecord: the form drawn from the schema (spec 2026-11-04 §3, Option A)', () => {
  it('labels and helps from the schema’s titles and descriptions, groups by x-groups, and folds the rest under Show n more', async () => {
    rich([])
    at('/new/projects')
    expect(fieldsOf(await screen.findByRole('group', { name: 'What it is' }))).toEqual(['Title', 'Summary', 'Kind'])
    expect(fieldsOf(screen.getByRole('group', { name: 'Who' }))).toEqual(['Lead', 'Contributors'])
    expect(screen.getByText('The person accountable for it.').id).toBe('f-lead-help')
    expect(screen.getByLabelText('Lead').getAttribute('aria-describedby')).toBe('f-lead-help')
    expect(screen.getByRole('region', { name: 'Milestones' }).textContent).toContain('optional')
    // neither required nor grouped: folded, named, and shown on asking
    expect(screen.queryByRole('group', { name: 'More' })).toBeNull()
    expect(screen.getByText('Tags, Target completion, Handles')).toBeTruthy()
    const more = screen.getByRole('button', { name: 'Show 3 more' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(fieldsOf(screen.getByRole('group', { name: 'More' }))).toEqual(['Tags', 'Target completion', 'Handles (YAML)'])
    expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('a group of one field named as the group draws its label once: the section head, no second row label (DP-41)', async () => {
    rich([])
    at('/new/projects')
    const region = await screen.findByRole('region', { name: 'Milestones' })
    expect(region.querySelector('dt')).toBeNull()
    const said = [...region.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent === 'Milestones')
    expect(said.map(e => e.tagName)).toEqual(['H2'])
    // its rows are still a group named by it, and still add
    expect(within(region).getByRole('group', { name: 'Milestones' }).className).toContain('form-rows')
    fireEvent.click(within(region).getByRole('button', { name: 'Add a milestone' }))
    expect(screen.getByLabelText('What, milestone 1')).toBeTruthy()
  })

  it('an enum is a segmented choice; pressing the chosen one again clears it', async () => {
    rich([])
    at('/new/projects')
    const relevance = await screen.findByRole('group', { name: 'Relevance' })
    expect(within(relevance).getAllByRole('button').map(b => b.textContent)).toEqual(['high', 'medium', 'low'])
    fireEvent.click(within(relevance).getByRole('button', { name: 'medium' }))
    expect(within(relevance).getByRole('button', { name: 'medium' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(relevance).getByRole('button', { name: 'medium' }))
    expect(within(relevance).getByRole('button', { name: 'medium' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('examples are a segmented choice with Other…, which takes free text', async () => {
    const seen: unknown[] = []
    rich(seen)
    at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Seeds' } })
    const kind = screen.getByRole('group', { name: 'Kind' })
    expect(within(kind).getAllByRole('button').map(b => b.textContent)).toEqual(['programme', 'project', 'Other…'])
    fireEvent.click(within(kind).getByRole('button', { name: 'Other…' }))
    fireEvent.change(screen.getByLabelText('Kind, other'), { target: { value: 'library' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'create', record: 'projects:seeds', value: { id: 'seeds', title: 'Seeds', kind: 'library' } }] }]))
  })

  it('a status with neither enum nor examples offers the words the registry already uses, most used first', async () => {
    rich([], entries([{ id: 'a', status: 'Develop' }, { id: 'b', status: 'Discovery' }, { id: 'c', status: 'Develop' }]))
    at('/new/projects')
    const status = await screen.findByRole('group', { name: 'Status' })
    expect(within(status).getAllByRole('button').map(b => b.textContent)).toEqual(['Develop', 'Discovery', 'Other…'])
  })

  it('a reference picks a real record by name; a date is the date field; a list of strings is tokens', async () => {
    const seen: unknown[] = []
    rich(seen)
    at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Seeds' } })
    const lead = screen.getByLabelText('Lead') as HTMLSelectElement
    await waitFor(() => expect([...lead.options].map(o => o.textContent)).toContain('Steward A (steward-a)'))
    fireEvent.change(lead, { target: { value: 'steward-a' } })
    fireEvent.change(screen.getByLabelText('Started'), { target: { value: '2026-11-04' } })
    const people = screen.getByLabelText('Contributors')
    fireEvent.change(people, { target: { value: 'Steward B' } })
    fireEvent.keyDown(people, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove Steward B' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'create', record: 'projects:seeds', value: { id: 'seeds', title: 'Seeds', lead: 'steward-a', started: '2026-11-04', contributors: ['steward-b'] } }] }]))
  })

  it('a list of objects is rows with + Add; an empty row is never sent', async () => {
    const seen: unknown[] = []
    rich(seen)
    at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Seeds' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a milestone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a milestone' }))
    fireEvent.change(screen.getByLabelText('What, milestone 1'), { target: { value: 'First packets' } })
    fireEvent.change(screen.getByLabelText('When, milestone 1'), { target: { value: '2026-12-01' } })
    expect(screen.getByLabelText('What, milestone 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'create', record: 'projects:seeds', value: { id: 'seeds', title: 'Seeds', milestones: [{ title: 'First packets', date: '2026-12-01' }] } }] }]))
  })

  it('the preview reads as the record will: its title, its summary, its first filled fields with records by name', async () => {
    rich([])
    at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Community seed library' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'A lending library of local seeds.' } })
    fireEvent.change(screen.getByLabelText('Lead'), { target: { value: 'steward-a' } })
    const preview = screen.getByRole('region', { name: 'Preview' })
    expect(within(preview).getByRole('heading', { level: 3 }).textContent).toBe('Community seed library')
    expect(within(preview).getByText('A lending library of local seeds.')).toBeTruthy()
    const rows = within(preview).getByRole('group', { name: 'Preview' })
    await waitFor(() => expect([...rows.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['Steward A']))
    expect(fieldsOf(rows)).toEqual(['Lead'])
  })

  it('a member whose name the gate restricts reads "Ops only" in the pickers and the preview, never its id, and is not found by that label (review I-1, D-12)', async () => {
    rich([], { 'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0',
      entries: [{ id: 'steward-a', name: 'Steward A' }, { id: 'ana-silva', restricted: { name: 'hat:ops' } }] } })
    const { container } = at('/new/projects')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Seeds' } })
    // the lead's select names it by the hat that keeps it, with no id beside it
    const lead = screen.getByLabelText('Lead') as HTMLSelectElement
    await waitFor(() => expect([...lead.options].map(o => o.textContent)).toContain('Ops only'))
    expect([...lead.options].map(o => o.textContent).join('|')).not.toContain('ana-silva')
    fireEvent.change(lead, { target: { value: 'ana-silva' } })
    // the preview names it as the select does
    const rows = within(screen.getByRole('region', { name: 'Preview' })).getByRole('group', { name: 'Preview' })
    await waitFor(() => expect([...rows.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['Ops only']))
    // the contributors' list offers no option that would print the id or be matched by its mask
    const people = screen.getByLabelText('Contributors')
    const listed = [...container.querySelectorAll(`[id="${people.id}-list"] option`)]
    expect(listed.map(o => `${o.getAttribute('value')} ${o.textContent}`)).toEqual(['Steward A steward-a'])
    fireEvent.change(people, { target: { value: 'Ops only' } })
    fireEvent.keyDown(people, { key: 'Enter' })
    expect(screen.queryByRole('button', { name: 'Remove Ops only' })).toBeNull()
    // held by its id, the token reads the mask
    fireEvent.change(people, { target: { value: 'ana-silva' } })
    fireEvent.keyDown(people, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove Ops only' })).toBeTruthy()
    expect(container.querySelector('.tokens')!.textContent).not.toContain('ana-silva')
    expect(container.querySelector('.form-prev')!.textContent).not.toContain('ana-silva')
  })

  it('says who decides before saving, from the rule the change would fall under, and stages nothing to ask', async () => {
    const seen: unknown[] = []
    const { calls } = rich(seen, { 'POST /api/changes/rule': { direct: false, proposable: true, sentence: 'Stewards decide new records, 2 of 3. Propose it instead.', source: 'data/governance.yaml: records' } })
    at('/new/projects')
    await waitFor(() => expect(document.querySelector('.form-decide')!.textContent).toBe('Saving adds it to Changes. Stewards decide new records, 2 of 3. Propose it instead.'))
    expect(calls.find(c => c.path === '/api/changes/rule')!.body).toEqual({ ops: [{ op: 'create', record: 'projects:new', value: { id: 'new' } }] })
    expect(seen).toEqual([])
  })

  it('a direct rule reads as the tray says it; a rule that can’t be read sends you to the tray', async () => {
    rich([], { 'POST /api/changes/rule': { direct: true, sentence: 'the maintainer decides alone', source: 's' } })
    const one = at('/new/projects')
    await waitFor(() => expect(document.querySelector('.form-decide')!.textContent).toBe('Saving adds it to Changes. Saves directly · the maintainer decides alone.'))
    one.unmount()
    rich([], { 'POST /api/changes/rule': refuse(500, { error: 'no' }) })
    at('/new/projects')
    await waitFor(() => expect(document.querySelector('.form-decide')!.textContent).toBe('Saving adds it to Changes. The tray says who decides before you propose.'))
  })
})
