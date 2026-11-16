// @vitest-environment jsdom
// DAO-OS L6 Task 17: a collection in the Hub (/c/:collection, /c/:collection/:view) — its saved views and view state, the
// five views on one set of filters, record writes through the batch (direct) or the tray (raised), the board's moves and
// "+ New", Record a meeting, New collection, and a field kept from the viewer (rule 3, rule 7).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { findErrorNote } from '../test/notes.ts'
import { SAVE_WORDS } from '../elements/workspace/SaveState.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'
import CollectionPage, { MEETING_STAGED, VIEW_STAGED } from './CollectionPage.tsx'
import { HubCollections } from './HubCollections.tsx'
import { clientWith, statusRoute } from '../test/writesOff.ts'

const TODAY = new Date().toISOString().slice(0, 10)
const MONTH = TODAY.slice(0, 8)
const TASKS = [
  { id: 'write-onboarding', title: 'Write the onboarding page', status: 'To do', owner: 'ops-lead', due: `${MONTH}03`, visibility: 'members' },
  { id: 'ask-council', title: 'Ask the Council about the pool', status: 'To do', due: null, visibility: 'members' },
  { id: 'pool-report', title: 'Draft the pool report', status: 'Doing', owner: 'steward-a', due: `${MONTH}05`, visibility: 'members' },
  { id: 'old-signer', title: 'Remove the old signer', status: 'Done', due: `${MONTH}01`, visibility: 'members' },
]
const OPEN_VIEW = { id: 'open', name: 'Open', kind: 'table', filters: [{ field: 'status', op: 'is-not', value: 'Done' }] }
const COLLECTIONS = { collections: [{ id: 'tasks', builtin: true, visibility: 'members', views: [OPEN_VIEW] }], problems: [] }

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear() })

function routes(over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/registries': [{ name: 'tasks', kind: 'collection', count: TASKS.length }],
    'GET /api/collections': COLLECTIONS,
    'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: null, entries: TASKS },
    'GET /api/view-state/tasks': { collection: 'tasks', state: null },
    'PUT /api/view-state/tasks': (init: RequestInit) => ({ collection: 'tasks', state: JSON.parse(String(init.body)).state }),
    'POST /api/workspace/records': { save: 'direct' },
    ...over,
  })
}

/** The page as App routes it: the address's view goes in, a tab's navigation changes it. */
function draw(path = '/c/tasks') {
  const ui = (
    <Switch>
      <Route path="/c/:collection">{p => <CollectionPage key={p.collection} collection={p.collection} />}</Route>
      <Route path="/c/:collection/:view">{p => <CollectionPage key={p.collection} collection={p.collection} view={p.view} />}</Route>
    </Switch>
  )
  return renderAt(ui, path)
}
const tab = (name: string) => screen.getByRole('tab', { name })
const selected = () => screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')?.textContent
const chips = () => [...document.querySelectorAll('.fchip-t')].map(c => c.textContent)
const live = () => screen.getByTestId('live').textContent
const posts = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter(c => c.method !== 'GET' && c.path === path)

describe('/c/:collection — a collection and its views', () => {
  // walk W3, D3: no file path on a member's page — how a record's change goes, in words
  it('heads the page with how its records change, and no file path', async () => {
    routes()
    draw()
    await screen.findByRole('grid', { name: 'Tasks' })
    const text = document.body.textContent ?? ''
    expect(document.querySelector('.rh-meta')!.textContent).toContain('Workspace write')
    expect(text).not.toMatch(/data\/[a-z-/]+\.yaml/)
  })

  it('Tasks opens on its saved view; switching to Board, Calendar, List and Map keeps the filters', async () => {
    const { calls } = routes()
    const { loc } = draw()
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(selected()).toBe('Open')
    expect(chips()).toEqual(['Status is not Done'])
    expect(screen.queryByText('Remove the old signer')).toBeNull()
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Table', 'Board', 'Calendar', 'List', 'Map', 'Open'])
    for (const [name, path] of [['Board', '/c/tasks/board'], ['Calendar', '/c/tasks/calendar'], ['List', '/c/tasks/list'], ['Map', '/c/tasks/map']] as const) {
      fireEvent.click(tab(name))
      await waitFor(() => expect(loc.history.at(-1)).toBe(path))
      expect(selected()).toBe(name)
      expect(chips()).toEqual(['Status is not Done'])
    }
    // the member's own view state: the view and the filters, never in git
    await waitFor(() => expect(posts(calls, '/api/view-state/tasks').at(-1)?.body).toEqual({ state: { view: 'map', filters: [OPEN_VIEW.filters[0]], sort: null } }))
  })

  it('Back between two saved views brings each one’s own filters (fix round 1, review Minor 5)', async () => {
    const MINE = { id: 'mine', name: 'Mine', kind: 'table', filters: [{ field: 'owner', op: 'is', value: 'ops-lead' }] }
    routes({ 'GET /api/collections': { collections: [{ id: 'tasks', builtin: true, visibility: 'members', views: [OPEN_VIEW, MINE] }], problems: [] } })
    const { loc } = draw('/c/tasks/open')
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(chips()).toEqual(['Status is not Done'])
    fireEvent.click(tab('Mine'))
    await waitFor(() => expect(chips()).toEqual(['Owner is ops-lead']))
    // the browser's Back: the address changes, not through a tab
    act(() => { loc.navigate('/c/tasks/open') })
    await waitFor(() => expect(selected()).toBe('Open'))
    expect(chips()).toEqual(['Status is not Done'])
    expect(screen.queryByText(/^Unsaved changes/)).toBeNull()
  })

  it('opens on the member’s own view state when there is one, its filters with it', async () => {
    routes({ 'GET /api/view-state/tasks': { collection: 'tasks', state: { view: 'list', filters: [{ field: 'owner', op: 'is', value: 'ops-lead' }], sort: null } } })
    draw()
    await screen.findByRole('list', { name: 'Tasks' })
    expect(selected()).toBe('List')
    expect(chips()).toEqual(['Owner is ops-lead'])
    expect(screen.getByText('Write the onboarding page')).toBeTruthy()
    expect(screen.queryByText('Draft the pool report')).toBeNull()
  })

  it('a view state not sent yet goes when the page is left; one the server holds is not sent again', async () => {
    const { calls } = routes({ 'GET /api/view-state/tasks': { collection: 'tasks', state: { view: 'view:open', filters: [OPEN_VIEW.filters[0]], sort: null } } })
    const { unmount } = draw()
    await screen.findByRole('grid', { name: 'Tasks' })
    await new Promise(r => setTimeout(r, 700))
    expect(posts(calls, '/api/view-state/tasks')).toHaveLength(0)
    fireEvent.click(tab('Board'))
    await screen.findByRole('group', { name: 'Tasks' })
    unmount()
    expect(posts(calls, '/api/view-state/tasks').map(c => c.body)).toEqual([{ state: { view: 'board', filters: [OPEN_VIEW.filters[0]], sort: null } }])
  })

  it('an inline edit in a cell saves through the batch: Saving, then Saved · direct; the cell keeps the new value', async () => {
    let answer!: (v: unknown) => void
    const { calls } = routes({ 'POST /api/workspace/records': () => new Promise(r => { answer = r }) })
    draw('/c/tasks/table')
    const grid = await screen.findByRole('grid', { name: 'Tasks' })
    const cell = within(grid).getByText('Draft the pool report').closest('tr')!.querySelectorAll('td')[1]!
    fireEvent.doubleClick(cell)
    const input = within(cell).getByRole('textbox', { name: 'Status' })
    fireEvent.change(input, { target: { value: 'Done' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/api/workspace/records')).toHaveLength(1))
    expect(posts(calls, '/api/workspace/records')[0]!.body).toEqual({ ops: [{ op: 'update', record: 'tasks:pool-report', set: { status: 'Done' } }] })
    await waitFor(() => expect(cell.textContent).toContain('Saving'))
    expect(document.querySelector('.save-w')!.textContent).toBe(SAVE_WORDS.saving)
    await act(async () => { answer({ save: 'direct' }) })
    await waitFor(() => expect(document.querySelector('.save-w')!.textContent).toBe(SAVE_WORDS.direct))
    // the batch commits within 10 s; until the read holds it, the cell shows what was written
    expect(cell.textContent).toBe('Done')
  })

  it('under a raised collection an inline edit is staged: Staged · needs approval, the cell marked Staged', async () => {
    let staged = false
    const op = { op: 'update', record: 'tasks:pool-report', set: { status: 'Done' }, base: 'b', before: TASKS[2] }
    routes({
      'POST /api/workspace/records': () => { staged = true; return { save: 'staged' } },
      'GET /api/changes': () => changeView(staged ? { ops: [op] } as never : {}),
    })
    draw('/c/tasks/table')
    const grid = await screen.findByRole('grid', { name: 'Tasks' })
    const cell = within(grid).getByText('Draft the pool report').closest('tr')!.querySelectorAll('td')[1]!
    fireEvent.doubleClick(cell)
    fireEvent.change(within(cell).getByRole('textbox'), { target: { value: 'Done' } })
    fireEvent.keyDown(within(cell).getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(document.querySelector('.save-w')!.textContent).toBe(SAVE_WORDS.staged))
    await waitFor(() => expect(cell.textContent).toBe('DoneStaged'))
  })

  it('a board move on a workspace collection saves; a refused drop announces the server’s sentence', async () => {
    const { calls } = routes({
      'POST /api/workspace/records': (init: RequestInit) => {
        const ops = JSON.parse(String(init.body)).ops as { record: string }[]
        return ops.some(o => o.record === 'tasks:old-signer') ? refuse(409, { error: 'A record changed since it was written.' })() : { save: 'direct' }
      },
    })
    draw('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    expect(screen.getAllByRole('list').map(l => l.getAttribute('aria-label'))).toEqual(['To do', 'Doing', 'Done'])
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Write the onboarding page' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Doing' }))
    await waitFor(() => expect(posts(calls, '/api/workspace/records')).toHaveLength(1))
    expect(posts(calls, '/api/workspace/records')[0]!.body).toEqual({ ops: [
      { op: 'update', record: 'tasks:pool-report', set: { order: 1000 } },
      { op: 'update', record: 'tasks:write-onboarding', set: { status: 'Doing', order: 2000 } },
    ] })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Doing' })).getByText('Write the onboarding page')).toBeTruthy())
    expect(live()).toBe('Moved Write the onboarding page to Doing.')
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Remove the old signer' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'To do' }))
    await waitFor(() => expect(live()).toBe('Not moved: A record changed since it was written.'))
    expect(within(screen.getByRole('list', { name: 'Done' })).getByText('Remove the old signer')).toBeTruthy()
  })

  it('a card moves within its column: Move up gives it an order before its neighbour', async () => {
    const { calls } = routes()
    draw('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Ask the Council about the pool' }))
    fireEvent.click(screen.getAllByRole('menuitem').find(i => i.textContent === 'Move up')!)
    await waitFor(() => expect(posts(calls, '/api/workspace/records')).toHaveLength(1))
    expect(posts(calls, '/api/workspace/records')[0]!.body).toEqual({ ops: [
      { op: 'update', record: 'tasks:ask-council', set: { order: 1000 } },
      { op: 'update', record: 'tasks:write-onboarding', set: { order: 2000 } },
    ] })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'To do' })).getAllByRole('listitem')[0]!.textContent).toContain('Ask the Council'))
  })

  it('on a raised collection a board move stages, and the card is drawn as a staged move', async () => {
    let staged = false
    const op = { op: 'update', record: 'tasks:write-onboarding', set: { status: 'Doing', order: 2000 }, base: 'b', before: TASKS[0] }
    routes({
      'POST /api/workspace/records': () => { staged = true; return { save: 'staged' } },
      'GET /api/changes': () => changeView(staged ? { ops: [op] } as never : {}),
    })
    draw('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Write the onboarding page' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Doing' }))
    await waitFor(() => expect(document.querySelector('.save-w')!.textContent).toBe(SAVE_WORDS.staged))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Doing' })).getByText('Staged move')).toBeTruthy())
  })

  it('+ New in a column adds a card there, through the batch, and a reload still shows it', async () => {
    const { calls } = routes()
    const first = draw('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'New in Doing' }))
    const form = screen.getByRole('form', { name: 'New in Doing' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Title' }), { target: { value: 'Count the signers' } })
    fireEvent.submit(form)
    await waitFor(() => expect(posts(calls, '/api/workspace/records')).toHaveLength(1))
    const sent = posts(calls, '/api/workspace/records')[0]!.body as { ops: { op: string; record: string; value: Record<string, unknown> }[] }
    expect(sent.ops[0]).toMatchObject({ op: 'create', value: { title: 'Count the signers', status: 'Doing' } })
    expect(sent.ops[0]!.record).toMatch(/^tasks:count-the-signers-[0-9a-f]{4}$/)
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Doing' })).getByText('Count the signers')).toBeTruthy())
    // a reload before the batch commits: the read does not hold it yet, this tab does
    first.unmount()
    draw('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    expect(within(screen.getByRole('list', { name: 'Doing' })).getByText('Count the signers')).toBeTruthy()
  })

  it('the calendar places tasks by `due` and meetings by `date`', async () => {
    routes({
      'GET /api/collections': { collections: [], problems: [] },
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: null,
        entries: [{ id: 'council-call', title: 'Council call', date: `${MONTH}07`, notes: 'council-call-notes-a1b2', visibility: 'members' }] },
      'GET /api/view-state/meetings': { collection: 'meetings', state: null },
    })
    const tasks = draw('/c/tasks/calendar')
    await screen.findByRole('grid', { name: /\d{4}$/ })
    expect(document.querySelector(`td[data-date="${MONTH}03"]`)!.textContent).toContain('Write the onboarding page')
    expect(document.querySelector(`td[data-date="${MONTH}05"]`)!.textContent).toContain('Draft the pool report')
    tasks.unmount()
    draw('/c/meetings/calendar')
    await screen.findByRole('grid', { name: /\d{4}$/ })
    expect(document.querySelector(`td[data-date="${MONTH}07"]`)!.textContent).toContain('Council call')
  })

  it('the calendar on the month of today is marked volatile (the route shots mask it); another month is not', async () => {
    routes({ 'GET /api/collections': { collections: [], problems: [] } })
    draw('/c/tasks/calendar')
    await screen.findByRole('grid', { name: /\d{4}$/ })
    expect(document.querySelector('.cal')!.hasAttribute('data-volatile')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() => expect(document.querySelector('.cal')!.hasAttribute('data-volatile')).toBe(false))
  })

  it('the map draws the records the view holds', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
    routes({ 'GET /api/proposals': [] })
    draw('/c/tasks/map')
    // the five views keep no saved view's filters: every task is on it (collectionGraph's tests hold the edges and rule 7)
    expect(await screen.findByRole('group', { name: 'Tasks map, 4 records' })).toBeTruthy()
  })

  it('saving a view writes it to data/collections.yaml and opens it; unsaved filter changes are the member’s view state', async () => {
    let defs = COLLECTIONS
    const { calls, fn } = routes({
      'GET /api/collections': () => defs,
      'PUT /api/collections/tasks/views/mine': (init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        defs = { ...COLLECTIONS, collections: [{ ...COLLECTIONS.collections[0]!, views: [OPEN_VIEW, { id: 'mine', ...body }] }] }
        return { id: 'tasks', view: 'mine', commit: 'c1' }
      },
    })
    const { loc } = draw('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    // a filter added: the view state keeps it
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const filter = screen.getByRole('form', { name: 'New filter' })
    fireEvent.change(within(filter).getByLabelText('Field'), { target: { value: 'owner' } })
    fireEvent.change(within(filter).getByLabelText('Condition'), { target: { value: 'is' } })
    fireEvent.change(within(filter).getByLabelText('Value'), { target: { value: 'ops-lead' } })
    fireEvent.submit(filter)
    await waitFor(() => expect(posts(calls, '/api/view-state/tasks').at(-1)?.body).toEqual({ state: { view: 'board', filters: [{ field: 'owner', op: 'is', value: 'ops-lead' }], sort: null } }))
    fireEvent.click(screen.getByRole('button', { name: 'Save view…' }))
    const form = screen.getByRole('form', { name: 'Save this view' })
    expect(within(form).getByText('A saved view is written to the repository: every member can read it.')).toBeTruthy()
    fireEvent.change(within(form).getByRole('textbox', { name: 'View name' }), { target: { value: 'Mine' } })
    fireEvent.submit(form)
    await waitFor(() => expect(posts(calls, '/api/collections/tasks/views/mine')).toHaveLength(1))
    expect(posts(calls, '/api/collections/tasks/views/mine')[0]!.body).toEqual({ name: 'Mine', kind: 'board', filters: [{ field: 'owner', op: 'is', value: 'ops-lead' }], board: { field: 'status' } })
    await waitFor(() => expect(loc.history.at(-1)).toBe('/c/tasks/mine'))
    await waitFor(() => expect(selected()).toBe('Mine'))
    expect(fn).toHaveBeenCalled()
  })

  it('a view saved under a raised rule is said to be staged', async () => {
    routes({ 'PUT /api/collections/tasks/views/mine': { id: 'tasks', view: 'mine', staged: true } })
    draw('/c/tasks/table')
    await screen.findByRole('grid', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Save view…' }))
    const form = screen.getByRole('form', { name: 'Save this view' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'View name' }), { target: { value: 'Mine' } })
    fireEvent.submit(form)
    expect(await screen.findByText(VIEW_STAGED)).toBeTruthy()
  })

  // The final review's M-1 (PF-R116): a view by a restricted field is refused 422 with a sentence; the form shows that
  // sentence as its field's error note (not the count "the change has 1 error"), described by the name's input.
  it('a view the server refuses for a restricted field shows the refusal\'s sentence as the field\'s note', async () => {
    const sentence = 'A saved view is written to data/collections.yaml, which every member reads, and budget is kept above members: ' +
      'a saved view cannot filter, sort, group, board or date by it. Nothing was written.'
    routes({ 'PUT /api/collections/tasks/views/mine': refuse(422, { error: 'Not saved: the change has 1 error. Nothing was written.',
      errors: [{ record: 'collections:tasks', field: 'views.mine.filters.0.field', message: sentence }] }) })
    draw('/c/tasks/table')
    await screen.findByRole('grid', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Save view…' }))
    const form = screen.getByRole('form', { name: 'Save this view' })
    const input = within(form).getByRole('textbox', { name: 'View name' })
    fireEvent.change(input, { target: { value: 'Mine' } })
    fireEvent.submit(form)
    const note = await findErrorNote(form)
    expect(note.textContent).toBe(sentence)
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe(sentence)
  })

  it('Record a meeting creates the meeting and opens its notes page', async () => {
    const { calls } = routes({
      'GET /api/collections': { collections: [], problems: [] },
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: null, entries: [] },
      'GET /api/view-state/meetings': { collection: 'meetings', state: null },
      'POST /api/meetings': { meeting: 'ops-sync', page: 'ops-sync-notes-a1b2', commit: 'c1' },
    })
    const { loc } = draw('/c/meetings')
    await screen.findByText('No meetings yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Record a meeting' }))
    const form = screen.getByRole('form', { name: 'Record a meeting' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Title' }), { target: { value: 'Ops sync' } })
    fireEvent.submit(form)
    await waitFor(() => expect(loc.history.at(-1)).toBe('/p/ops-sync-notes-a1b2'))
    expect(posts(calls, '/api/meetings')[0]!.body).toEqual({ title: 'Ops sync', date: TODAY })
  })

  it('Record a meeting under a raised rule says both are staged', async () => {
    routes({
      'GET /api/collections': { collections: [], problems: [] },
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: null, entries: [] },
      'GET /api/view-state/meetings': { collection: 'meetings', state: null },
      'POST /api/meetings': { meeting: 'ops-sync', page: 'ops-sync-notes-a1b2', commit: null, staged: true },
    })
    draw('/c/meetings')
    await screen.findByText('No meetings yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Record a meeting' }))
    const form = screen.getByRole('form', { name: 'Record a meeting' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Title' }), { target: { value: 'Ops sync' } })
    fireEvent.submit(form)
    expect(await screen.findByText(MEETING_STAGED)).toBeTruthy()
  })

  it('an `email` field renders "Ops only" for a member not admitted, and is never filtered by its value nor edited', async () => {
    const circles = { id: 'circles', name: 'Circles', builtin: false, visibility: 'members',
      fields: [{ id: 'name', type: 'text' }, { id: 'email', type: 'email' }] }
    routes({
      'GET /api/collections': { collections: [circles], problems: [] },
      'GET /api/registries/circles': { name: 'circles', kind: 'collection', schemaVersion: null, entries: [
        { id: 'c1', name: 'Ops circle', visibility: 'members', restricted: { email: 'hat:ops' } },
        { id: 'c2', name: 'Open circle', email: 'open@example.test', visibility: 'members' },
      ] },
      'GET /api/view-state/circles': { collection: 'circles', state: { view: 'table', filters: [{ field: 'email', op: 'contains', value: 'example' }], sort: null } },
    })
    renderAt(<ViewAsProvider source={FIXTURE_SOURCE}><CollectionPage collection="circles" /></ViewAsProvider>, '/c/circles')
    const grid = await screen.findByRole('grid', { name: 'Circles' })
    // the filter reads the kept field as "Ops only", never its value: only the open circle passes
    expect(within(grid).queryByText('Ops circle')).toBeNull()
    expect(within(grid).getByText('Open circle')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Email contains example' }))
    const row = await within(grid).findByText('Ops circle')
    const cell = row.closest('tr')!.querySelectorAll('td')[1]!
    expect(cell.textContent).toBe('Ops only')
    expect(cell.hasAttribute('data-editable')).toBe(false)
  })
})

// DAO-OS L6 Task 17 fix round 1 (rule 7, review I1 and Minor 1): the board's kept fields, and a name kept from the viewer.
describe('/c/:collection — what is kept from the viewer', () => {
  const KEPT_STATUS = { id: 'kept-status', title: 'Rotate the signer keys', due: null, visibility: 'members', restricted: { status: 'hat:ops' } }
  const KEPT_NAME = { id: 'secret-plan-a1b2', status: 'To do', visibility: 'members', restricted: { title: 'hat:ops' } }
  const keptRoutes = (over: Record<string, unknown> = {}) => routes({
    'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: null, entries: [...TASKS, KEPT_STATUS, KEPT_NAME] },
    ...over,
  })
  const drawAs = (path: string) => renderAt(
    <ViewAsProvider source={FIXTURE_SOURCE}>
      <Switch><Route path="/c/:collection/:view">{p => <CollectionPage collection={p.collection} view={p.view} />}</Route></Switch>
    </ViewAsProvider>, path)

  it('a card whose board field is kept sits in a locked “Ops only” column: it cannot be moved, takes no + New, and no op carries its value', async () => {
    const { calls } = keptRoutes()
    drawAs('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    expect(screen.getAllByRole('list').map(l => l.getAttribute('aria-label'))).toEqual(['To do', 'Doing', 'Done', 'Ops only'])
    const locked = screen.getByRole('list', { name: 'Ops only' })
    expect(within(locked).getByText('Rotate the signer keys')).toBeTruthy()
    // no + New on the locked column; the others keep theirs
    expect(screen.queryByRole('button', { name: 'New in Ops only' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New in Doing' })).toBeTruthy()
    // the keys: refused in words, nothing lifted
    const card = document.querySelector<HTMLElement>('li[data-card="kept-status"]')!
    card.focus()
    fireEvent.keyDown(card, { key: ' ' })
    expect(live()).toBe('Rotate the signer keys can’t be moved: Its status is kept at Ops: it cannot be moved here.')
    // the menu: every place unavailable
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Rotate the signer keys' }))
    const menu = screen.getByRole('menu', { name: 'Move to… Rotate the signer keys' })
    for (const item of [...within(menu).getAllByRole('menuitemradio'), ...within(menu).getAllByRole('menuitem')]) expect(item.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'To do' }))
    // no other column is a target for it, and no card can be moved into its column
    expect(within(menu).queryByRole('menuitemradio', { name: 'Ops only' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Draft the pool report' }))
    expect(screen.getAllByRole('menuitemradio').map(i => i.textContent)).not.toContain('Ops only')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    // a move beside it, within To do, sends order only
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Ask the Council about the pool' }))
    fireEvent.click(screen.getAllByRole('menuitem').find(i => i.textContent === 'Move up')!)
    await waitFor(() => expect(posts(calls, '/api/workspace/records')).toHaveLength(1))
    const sent = posts(calls, '/api/workspace/records').flatMap(c => (c.body as { ops: { record: string; set: Record<string, unknown> }[] }).ops)
    expect(sent.every(o => Object.keys(o.set).every(k => k === 'order'))).toBe(true)
    expect(sent.some(o => o.record === 'tasks:kept-status')).toBe(false)
  })

  it('a record whose name is kept reads “Ops only” on the board, the list and the calendar, never its id, and opens nowhere', async () => {
    keptRoutes({ 'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: null,
      entries: [...TASKS, { ...KEPT_NAME, due: `${MONTH}09` }] } })
    const board = drawAs('/c/tasks/board')
    await screen.findByRole('group', { name: 'Tasks' })
    const card = document.querySelector<HTMLElement>('li[data-card="secret-plan-a1b2"]')!
    expect(card.querySelector('.kcard-t')!.textContent).toBe('Ops only')
    expect(card.querySelector('a')).toBeNull()
    expect(document.body.textContent).not.toContain('secret-plan')
    expect([...document.querySelectorAll('a')].some(a => a.getAttribute('href')!.includes('secret-plan'))).toBe(false)
    board.unmount()
    const list = drawAs('/c/tasks/list')
    await screen.findByRole('list', { name: 'Tasks' })
    expect(screen.getByText('Ops only')).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret-plan')
    list.unmount()
    drawAs('/c/tasks/calendar')
    await screen.findByRole('grid', { name: /\d{4}$/ })
    expect(document.querySelector(`td[data-date="${MONTH}09"]`)!.textContent).toContain('Ops only')
    expect(document.body.textContent).not.toContain('secret-plan')
  })
})

describe('/workspace — the Hub’s collections', () => {
  it('lists Tasks, Meetings and each defined collection, each opening at /c/<id>', async () => {
    routes({ 'GET /api/collections': { collections: [{ id: 'circles', name: 'Circles', builtin: false, visibility: 'members' }], problems: [] } })
    renderAt(<HubCollections />, '/workspace')
    const list = await screen.findByRole('list', { name: 'Collections in the Hub' })
    await waitFor(() => expect(within(list).getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Tasks4 records', '/c/tasks'], ['Meetings0 records', '/c/meetings'], ['Circles0 records', '/c/circles'],
    ]))
  })

  it('New collection asks for a name and fields, and refuses tree-x with its sentence', async () => {
    const sentence = 'tree-x cannot name a collection: an id beginning with tree- names a tree of pages.'
    const { calls } = routes({ 'POST /api/collections': refuse(422, { errors: [{ record: 'collections:tree-x', field: 'id', message: sentence }] }) })
    renderAt(<HubCollections />, '/workspace')
    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }))
    const form = screen.getByRole('form', { name: 'New collection' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Tree x' } })
    expect((within(form).getByRole('textbox', { name: 'Id' }) as HTMLInputElement).value).toBe('tree-x')
    fireEvent.click(within(form).getByRole('button', { name: 'Field' }))
    const names = within(form).getAllByRole('textbox', { name: 'Field name' })
    fireEvent.change(names[1]!, { target: { value: 'Status' } })
    fireEvent.change(within(form).getAllByRole('combobox', { name: 'Type' })[1]!, { target: { value: 'select' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Options, comma between' }), { target: { value: 'active, paused' } })
    fireEvent.submit(form)
    expect((await findErrorNote(form)).textContent).toBe(sentence) // a clay error note, not an alert (C10, E-81)
    expect(posts(calls, '/api/collections')[0]!.body).toEqual({ id: 'tree-x', name: 'Tree x', fields: [
      { id: 'name', type: 'text', name: 'Name' }, { id: 'status', type: 'select', name: 'Status', options: ['active', 'paused'] },
    ] })
  })

  it('a collection made opens at /c/<id>', async () => {
    routes({ 'POST /api/collections': { id: 'circles', commit: 'c1' } })
    const { loc } = renderAt(<HubCollections />, '/workspace')
    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }))
    const form = screen.getByRole('form', { name: 'New collection' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Circles' } })
    fireEvent.submit(form)
    await waitFor(() => expect(loc.history.at(-1)).toBe('/c/circles'))
  })
})

// R2 (plan D-6): while the Hub's writes are off a collection is read, never written — no cell edit, no + New in a
// column, no Record a meeting, no New collection — but the member's own view state, kept in the private store, is
// still kept. With writes on, each control is offered.
describe('a collection while the Hub\'s writes are off', () => {
  const drawWith = (path: string, off: boolean) => {
    const ui = (
      <Switch>
        <Route path="/c/:collection">{p => <CollectionPage key={p.collection} collection={p.collection} />}</Route>
        <Route path="/c/:collection/:view">{p => <CollectionPage key={p.collection} collection={p.collection} view={p.view} />}</Route>
      </Switch>
    )
    return renderAt(ui, path, { queryClient: clientWith(off) })
  }
  const MEETINGS = {
    'GET /api/collections': { collections: [], problems: [] },
    'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: null, entries: [] },
    'GET /api/view-state/meetings': { collection: 'meetings', state: null },
  }
  for (const off of [true, false]) {
    it(off ? 'off: a cell does not open for editing and the board offers no + New' : 'on: a cell opens for editing and each column offers + New', async () => {
      routes(statusRoute(off))
      const first = drawWith('/c/tasks/table', off)
      const grid = await screen.findByRole('grid', { name: 'Tasks' })
      const cell = within(grid).getByText('Draft the pool report').closest('tr')!.querySelectorAll('td')[1]!
      fireEvent.doubleClick(cell)
      expect(within(cell).queryAllByRole('textbox', { name: 'Status' })).toHaveLength(off ? 0 : 1)
      first.unmount()
      drawWith('/c/tasks/board', off)
      await screen.findByRole('group', { name: 'Tasks' })
      expect(screen.queryAllByRole('button', { name: /^New in / }).length > 0).toBe(!off)
    })

    it(off ? 'off: no Record a meeting' : 'on: Record a meeting', async () => {
      routes({ ...statusRoute(off), ...MEETINGS })
      drawWith('/c/meetings', off)
      await screen.findByText('No meetings yet.')
      expect(screen.queryAllByRole('button', { name: 'Record a meeting' })).toHaveLength(off ? 0 : 1)
    })

    it(off ? 'off: no New collection; the collections are listed' : 'on: New collection', async () => {
      routes(statusRoute(off))
      renderAt(<HubCollections />, '/workspace', { queryClient: clientWith(off) })
      await screen.findByRole('list', { name: 'Collections in the Hub' })
      expect(screen.queryAllByRole('button', { name: 'New collection' })).toHaveLength(off ? 0 : 1)
    })
  }

  it('off: a filter added is still kept as the member\'s view state (it is theirs, in the private store)', async () => {
    const { calls } = routes(statusRoute(true))
    drawWith('/c/tasks/board', true)
    await screen.findByRole('group', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const filter = screen.getByRole('form', { name: 'New filter' })
    fireEvent.change(within(filter).getByLabelText('Field'), { target: { value: 'owner' } })
    fireEvent.change(within(filter).getByLabelText('Condition'), { target: { value: 'is' } })
    fireEvent.change(within(filter).getByLabelText('Value'), { target: { value: 'ops-lead' } })
    fireEvent.submit(filter)
    await waitFor(() => expect(posts(calls, '/api/view-state/tasks').at(-1)?.body).toEqual({ state: { view: 'board', filters: [{ field: 'owner', op: 'is', value: 'ops-lead' }], sort: null } }))
    expect(screen.queryByRole('button', { name: 'Save view…' })).toBeNull() // a saved view is the collection's: not while off
  })
})
