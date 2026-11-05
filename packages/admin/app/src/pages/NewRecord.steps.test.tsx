// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import NewRecord from './NewRecord.tsx'
import type { StageOp } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { annotatedProjectSchema } from '../test/record.tsx'

/** The new-record form, stepped (spec 2026-11-04 §3, Option B): the same groups as Option A, one a screen, on the wizard
 *  frame; asked for with ?steps=1 (the setup checklist), and on every narrow screen. */

const at = (path: string) => renderAt(<Switch>
  <Route path="/new/:registry">{p => <NewRecord registry={p.registry} />}</Route>
  <Route path="/r/:kind/:id">landed</Route>
  <Route path="/:section">a section</Route>
</Switch>, path)
const routes = (seen: unknown[], over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes(),
  'GET /api/schemas/projects': annotatedProjectSchema,
  'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }],
  'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }, { id: 'steward-b', name: 'Steward B' }] },
  'POST /api/changes/ops': (init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { ops: StageOp[] }
    seen.push(body)
    return changeView({ ops: body.ops.map(o => ({ ...o, base: null, before: null })) })
  },
  ...over,
})
const STEPS = '/new/projects?steps=1'
const pills = () => within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem').map(li => li.querySelector('.wiz-step-t')!.textContent)
const step = (name: string) => screen.findByRole('heading', { level: 2, name })
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null
const live = () => screen.getByTestId('live').textContent

afterEach(() => { vi.unstubAllGlobals() })

describe('NewRecord, stepped (spec 2026-11-04 §3, Option B)', () => {
  it('draws the schema’s groups as steps, one a screen, the folded rest one of them, then Check', async () => {
    routes([])
    at(STEPS)
    expect(await step('What it is')).toBeTruthy()
    expect(pills()).toEqual(['What it is', 'Who', 'Where it stands', 'Milestones', 'More', 'Check'])
    expect(document.querySelector('.wiz-k')!.textContent).toBe('New project · 1 of 6')
    expect(screen.getByRole('group', { name: 'What it is' })).toBeTruthy()
    // the other steps are not on screen, and Option A's fold and aside are not drawn
    expect(screen.queryByRole('group', { name: 'Who' })).toBeNull()
    expect(button('Show 3 more')).toBeNull()
    expect(button('Save to changes')).toBeNull()
    press('Next')
    expect(await step('Who')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Who' })).toBeTruthy()
  })

  it('offers Skip only on an optional step, and only while nothing in it is filled', async () => {
    routes([])
    at(STEPS)
    await step('What it is')
    for (const name of ['Who', 'Where it stands', 'Milestones']) {
      expect(button('Skip'), 'a step with no optional mark').toBeNull()
      press('Next')
      await step(name)
    }
    expect(button('Skip')).not.toBeNull()
    press('Skip')
    expect(await step('More')).toBeTruthy()
    const tags = screen.getByLabelText('Tags')
    fireEvent.change(tags, { target: { value: 'seeds' } })
    fireEvent.keyDown(tags, { key: 'Enter' })
    // what was typed would be left out by a Skip: the step reads Next only
    expect(button('Skip')).toBeNull()
    expect(button('Next')).not.toBeNull()
  })

  it('Back keeps what was typed', async () => {
    routes([])
    at(STEPS)
    await step('What it is')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Seeds' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'project' }))
    press('Next')
    await step('Who')
    press('Next')
    await step('Where it stands')
    fireEvent.change(screen.getByLabelText('Started'), { target: { value: '2026-1' } })   // a half-typed date, kept as typed
    press('Back')
    await step('Who')
    press('Back')
    expect(await step('What it is')).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Seeds')
    expect(document.querySelector('.form-id-v')!.textContent).toBe('seeds')
    expect(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'project' }).getAttribute('aria-pressed')).toBe('true')
    press('Next')
    press('Next')
    expect(await step('Where it stands')).toBeTruthy()
    expect((screen.getByLabelText('Started') as HTMLInputElement).value).toBe('2026-1')
  })

  it('Check is Option A’s preview and its governance line, with Save to changes under them', async () => {
    routes([], { 'POST /api/changes/rule': { direct: true, sentence: 'the maintainer decides alone', source: 's' } })
    const { container } = at(STEPS)
    await step('What it is')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Community seed library' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'A lending library of local seeds.' } })
    for (const name of ['Who', 'Where it stands', 'Milestones', 'More', 'Check']) { press('Next'); await step(name) }
    const preview = screen.getByRole('region', { name: 'Preview' })
    expect(within(preview).getByRole('heading', { level: 3 }).textContent).toBe('Community seed library')
    expect(within(preview).getByText('A lending library of local seeds.')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.form-decide')!.textContent).toBe('Saving adds it to Changes. Saves directly · the maintainer decides alone.'))
    const save = screen.getByRole('button', { name: 'Save to changes' })
    expect(save.className).toContain('primary')
    expect([...container.querySelectorAll('.btn.primary')]).toEqual([save])
    // Save follows the governance line in the page's order
    expect(container.querySelector('.form-decide')!.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('.wiz-writes-v')!.textContent).toBe('data/projects.yaml · a new entry, as a staged change')
  })

  it('saving stages the same create as Option A and goes to the new record', async () => {
    const seen: unknown[] = []
    routes(seen)
    const { loc } = at(STEPS)
    await step('What it is')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Seeds' } })
    press('Next')
    await step('Who')
    const lead = screen.getByLabelText('Lead') as HTMLSelectElement
    await waitFor(() => expect([...lead.options].map(o => o.value)).toContain('steward-a'))
    fireEvent.change(lead, { target: { value: 'steward-a' } })
    for (const name of ['Where it stands', 'Milestones']) { press('Next'); await step(name) }
    press('Skip'); await step('More')
    press('Skip'); await step('Check')
    press('Save to changes')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/r/project/seeds'))
    expect(seen).toEqual([{ ops: [{ op: 'create', record: 'projects:seeds', value: { id: 'seeds', title: 'Seeds', lead: 'steward-a' } }] }])
  })

  it('moves focus to each step’s heading and says the step in the page’s one live region', async () => {
    routes([])
    at(STEPS)
    await step('What it is')
    await waitFor(() => expect(live()).toBe('Step 1 of 6: What it is'))
    expect(screen.queryByRole('status')).toBeNull()   // the frame draws no second region
    press('Next')
    const who = await step('Who')
    expect(document.activeElement).toBe(who)
    await waitFor(() => expect(live()).toBe('Step 2 of 6: Who'))
    press('Back')
    expect(document.activeElement).toBe(await step('What it is'))
    await waitFor(() => expect(live()).toBe('Step 1 of 6: What it is'))
  })

  it('is what a narrow screen gets for every new record; a wide one gets it only when asked (?steps=1)', async () => {
    routes([])
    const wide = at('/new/projects')
    expect(await screen.findByRole('region', { name: 'What it is' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull()
    expect(button('Save to changes')).not.toBeNull()
    wide.unmount()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('759px'), media: q, addEventListener() {}, removeEventListener() {} }))
    routes([])
    at('/new/projects')
    expect(await step('What it is')).toBeTruthy()
    expect(pills().at(-1)).toBe('Check')
  })

  it('holds Next while the step has a problem: an id the file already holds', async () => {
    routes([], { 'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'seeds', title: 'Seeds' }] } })
    at(STEPS)
    await step('What it is')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Seeds' } })
    expect(await screen.findByText('projects already has an entry "seeds".')).toBeTruthy()
    expect(button('Next')!.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Seeds two' } })
    await waitFor(() => expect(button('Next')!.disabled).toBe(false))
  })

  it('a refusal on Check goes back to the step that holds the field, and is said under it, as on Option A', async () => {
    routes([], { 'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:p1', field: 'id', message: 'projects already has an entry "p1".' }] }) })
    const { loc } = at(STEPS)
    await step('What it is')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'P1' } })
    for (const name of ['Who', 'Where it stands', 'Milestones', 'More', 'Check']) { press('Next'); await step(name) }
    press('Save to changes')
    const back = await step('What it is')
    expect((await screen.findByText('projects already has an entry "p1".')).closest('.form-id')).not.toBeNull()
    expect(document.activeElement).toBe(back)
    expect(loc.history.at(-1)).toBe(STEPS)
  })

  it('needs an id before it stages anything: Save from Check goes back to the title', async () => {
    const seen: unknown[] = []
    routes(seen)
    at(STEPS)
    await step('What it is')
    for (const name of ['Who', 'Where it stands', 'Milestones', 'More', 'Check']) { press('Next'); await step(name) }
    press('Save to changes')
    expect(await step('What it is')).toBeTruthy()
    expect(screen.getByText('a new record needs an id')).toBeTruthy()
    expect(seen).toEqual([])
  })

  it('keeps Option A’s keys and notes: Esc and Cancel go back to the section; editing off for an unknown actor', async () => {
    routes([])
    const one = at(STEPS)
    await step('What it is')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(one.loc.history.at(-1)).toBe('/b/projects')
    one.unmount()
    routes([])
    const two = at(STEPS)
    await step('What it is')
    press('Cancel')
    expect(two.loc.history.at(-1)).toBe('/b/projects')
    two.unmount()
    routes([], baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }))
    at(STEPS)
    expect(await screen.findByText('Editing is off: the notice above says why.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull()
  })

  it('draws a group of one field named as the group with its label once: the step’s heading', async () => {
    routes([])
    at(STEPS)
    await step('What it is')
    for (const name of ['Who', 'Where it stands', 'Milestones']) { press('Next'); await step(name) }
    const body = document.querySelector('.wiz-body')!
    const shown = [...body.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent === 'Milestones' && !e.closest('[hidden]'))
    expect(shown.map(e => e.tagName)).toEqual(['H2'])
    expect(screen.getByRole('group', { name: 'Milestones' }).className).toContain('form-rows')
  })

  it('keeps two steps that share a label apart: a schema group named "More" beside the folded rest (review M-3)', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const schema = { 'x-groups': [{ label: 'More', fields: ['title'] }],
      properties: { id: { type: 'string' }, title: { type: 'string', title: 'Title' }, summary: { type: 'string', title: 'Summary' } } }
    routes([], { 'GET /api/schemas/projects': schema })
    at(STEPS)
    expect(await step('More')).toBeTruthy()
    expect(pills()).toEqual(['More', 'More', 'Check'])
    press('Next')
    await waitFor(() => expect(screen.getByLabelText('Summary').closest('[hidden]')).toBeNull())
    expect(screen.getByLabelText('Title').closest('[hidden]')).not.toBeNull()
    expect(said.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    said.mockRestore()
  })
})
