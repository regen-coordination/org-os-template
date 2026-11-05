// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Boards, { slug } from './Boards.tsx'
import { OPEN_NEW_BOARD } from '../keys/useHouseKeys.ts'
import { renderAt } from '../test/render.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { baseRoutes, boardRead, changeView, resource } from '../test/data.ts'
import { BUILTIN_BOARDS } from '../test/builtinBoards.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { expectNoWriteControls } from '../test/publicPreview.tsx'

const ours = [
  boardRead({ id: 'council', name: 'Council', origin: 'instance', layout: 'grid', blocks: [
    { id: 'a', type: 'note', place: { col: 1, span: 6, row: 1 } }, { id: 'b', type: 'note', place: { col: 7, span: 6, row: 1 } }] }),
  boardRead({ id: 'team', name: 'Team', origin: 'instance', layout: 'flow', blocks: [{ id: 'n', type: 'note' }] }),
]
const records = [
  resource(), resource({ id: 'project:p2', name: 'Project two', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'p2' } }),
  resource({ id: 'module:m', kind: 'module', board: 'systems', name: 'A module', source: null }),
]
const routes = (over: Record<string, unknown> = {}) => fetchRoutes(baseRoutes({
  'GET /api/boards': [...BUILTIN_BOARDS, ...ours], 'GET /api/resources': records, 'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }],
  'POST /api/changes/ops': changeView(), ...over,
}))
const rowOf = (list: HTMLElement, name: string) => within(list).getByRole('link', { name: new RegExp(`^${name}`) })

describe('the boards page', () => {
  it('heads the page with what boards are, Search boards and the primary New board, with its key', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    expect((await screen.findByRole('heading', { level: 1, name: 'Boards' }))).toBeTruthy()
    expect(document.querySelector('.rh-about')!.textContent).toBe('Ways of looking at the org’s records. Built-in boards come with the framework; yours are kept in data/boards.yaml.')
    expect(screen.getByRole('searchbox', { name: 'Search boards' })).toBeTruthy()
    const add = await screen.findByRole('button', { name: 'New board' })
    expect(add.className).toMatch(/\bprimary\b/)
    expect(add.querySelector('kbd')!.textContent).toBe('n')
    expect(document.getElementById(add.getAttribute('aria-describedby')!)!.textContent).toBe('Key: n')
  })

  it('lists yours as data rows, each a drawing of its layout and blocks and "<Layout> · n blocks"', async () => {
    routes({ 'GET /api/boards': [...BUILTIN_BOARDS, ...ours, boardRead({ id: 'projects', name: 'Projects', origin: 'instance', overrides: true, blocks: [] })] })
    renderAt(<Boards />, '/boards')
    const yours = await screen.findByRole('list', { name: 'Your boards' })
    const council = rowOf(yours, 'Council')
    expect(council.getAttribute('href')).toBe('/b/council')
    expect(council.querySelector('.drow-s')!.textContent).toBe('Grid · 2 blocks')
    expect(council.querySelectorAll('.bthumb .bthumb-b')).toHaveLength(2)
    expect(council.querySelector('.bthumb')!.getAttribute('aria-hidden')).toBe('true')
    expect(rowOf(yours, 'Team').querySelector('.drow-s')!.textContent).toBe('Flow · 1 block')
    expect(rowOf(yours, 'Projects').querySelector('.drow-s')!.textContent).toBe('Flow · 0 blocks · in place of the built-in')
  })

  it('groups the built-in sections with what each holds and its live count; an empty one says so and links to Set up', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    const list = await screen.findByRole('list', { name: 'Section boards' })
    const projects = rowOf(list, 'Projects')
    expect(projects.getAttribute('href')).toBe('/b/projects')
    expect(projects.querySelector('.drow-s')!.textContent).toBe('The work this org is doing or planning: who leads each piece and where it stands')
    await waitFor(() => expect(projects.querySelector('.brow-n')?.textContent).toBe('2'))
    const funding = rowOf(list, 'Funding')
    expect(funding.querySelector('.drow-end')!.textContent).toBe('empty')
    const setUp = within(list).getByRole('link', { name: 'Set up Funding' })
    expect(setUp.getAttribute('href')).toBe('/b/funding')
    expect(funding.contains(setUp)).toBe(false)
  })

  it('folds the system sections under show all', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    const list = await screen.findByRole('list', { name: 'Section boards' })
    expect(within(list).queryByRole('link', { name: /^Crew/ })).toBeNull()
    const more = screen.getByRole('button', { name: /show all$/ })
    expect(more.textContent).toBe('+ Crew, Modules, Fleet, Sources, Outside systems · show all') // the house's order (SECTIONS)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(rowOf(list, 'Crew')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('lists Maps and money with their live counts, and Home under Pages', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    const maps = await screen.findByRole('list', { name: 'Maps and money' })
    await waitFor(() => expect(rowOf(maps, 'Organization map').querySelector('.brow-n')?.textContent).toBe('2 records'))
    expect(rowOf(maps, 'Organization map').querySelector('.drow-s')!.textContent).toBe('Who’s in what')
    expect(rowOf(maps, 'Systems map').querySelector('.brow-n')!.textContent).toBe('1 record')
    expect(rowOf(maps, 'Treasury').querySelector('.drow-s')!.textContent).toBe('Balances and waiting transactions')
    expect(rowOf(maps, 'Treasury').querySelector('.brow-n')!.textContent).toBe('0 systems')
    expect(rowOf(screen.getByRole('list', { name: 'Pages' }), 'Fixture Org').getAttribute('href')).toBe('/b/home')
  })

  // review I-2: Treasury, Sources and Outside systems count systems by their data/systems.yaml entry
  for (const [what, answer] of [
    ['is still being read', () => new Promise<Response>(() => {})],
    ['could not be read', () => new Response(JSON.stringify({ error: 'data/systems.yaml cannot be read' }), { status: 500 })],
  ] as const) {
    it(`counts no system section while data/systems.yaml ${what}: no "0 systems", no "empty", no Set up (review I-2)`, async () => {
      routes({ 'GET /api/registries/systems': answer })
      renderAt(<Boards />, '/boards')
      const list = await screen.findByRole('list', { name: 'Section boards' })
      await waitFor(() => expect(rowOf(list, 'Projects').querySelector('.brow-n')?.textContent).toBe('2'))
      const counted = (row: HTMLElement) => row.querySelector('.brow-n, .brow-empty')
      expect(counted(rowOf(screen.getByRole('list', { name: 'Maps and money' }), 'Treasury'))).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /show all$/ }))
      for (const name of ['Sources', 'Outside systems']) expect(counted(rowOf(list, name))).toBeNull()
      expect(within(list).queryByRole('link', { name: /^Set up (Sources|Outside systems)/ })).toBeNull()
    })
  }

  it('Copy to yours stages a create of the built-in’s copy, says so, and is not offered again', async () => {
    const { calls } = routes({ 'POST /api/changes/ops': changeView({ ops: [{ op: 'create', record: 'boards:projects', value: {} }] as never }) })
    renderAt(<Boards />, '/boards')
    const list = await screen.findByRole('list', { name: 'Section boards' })
    await waitFor(() => expect(rowOf(list, 'Projects').querySelector('.brow-n')).not.toBeNull())
    fireEvent.click(within(list).getByRole('button', { name: 'Copy to yours: Projects' }))
    expect(await screen.findByText('A copy of Projects is in your changes. Apply it to make it yours.')).toBeTruthy()
    const post = calls.find(c => c.method === 'POST')!.body as { ops: { op: string; record: string; value: { id: string; blocks: unknown[] } }[] }
    expect(post.ops).toHaveLength(1)
    expect(post.ops[0]).toMatchObject({ op: 'create', record: 'boards:projects', value: { id: 'projects', name: 'Projects', layout: 'flow' } })
    await waitFor(() => expect(within(list).queryByRole('button', { name: 'Copy to yours: Projects' })).toBeNull())
  })

  it('Search boards keeps the boards whose name matches, folded ones included', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    await screen.findByRole('list', { name: 'Section boards' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search boards' }), { target: { value: 'crew' } })
    const list = screen.getByRole('list', { name: 'Section boards' })
    expect(within(list).getAllByRole('link').filter(l => l.matches('.drow')).map(l => l.querySelector('.drow-t')!.textContent)).toEqual(['Crew'])
    expect(screen.queryByRole('list', { name: 'Your boards' })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search boards' }), { target: { value: 'nothing like it' } })
    expect(screen.getByText('No board is called “nothing like it”.')).toBeTruthy()
  })

  it('slugs a name to an id', () => expect(slug('  Ação & Conselho ')).toBe('acao-conselho'))
})

describe('the New board sheet', () => {
  const openSheet = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'New board' }))
    return screen.findByRole('dialog', { name: 'New board' })
  }

  it('offers three layouts, each with what it is for, the name with the id that follows it, and where to start from', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    const sheet = await openSheet()
    const radios = within(sheet).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map(r => r.closest('label')!.querySelector('.nb-tn')!.textContent)).toEqual(['Grid', 'Canvas', 'Flow'])
    expect(radios.map(r => r.closest('label')!.querySelector('.nb-tl')!.textContent)).toEqual([
      'Blocks in rows. Dashboards, a council view.', 'Place blocks freely. Workshops, maps.', 'Blocks one under another, in order. A page to read down.'])
    expect(radios[0]!.checked).toBe(true)
    expect(within(sheet).getByRole('group', { name: 'Start from' }).textContent).toBe('BlankCopy a built-in') // no recipe source: DP-20
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Council – Q4' } })
    expect(within(sheet).getByText('council-q4')).toBeTruthy()
    expect(sheet.querySelector('.dialog-note')!.textContent).toBe('Saved to data/boards.yaml as a staged change')
  })

  it('refuses a name whose id another board has, or a staged one', async () => {
    routes({ 'GET /api/changes': changeView({ ops: [{ op: 'create', record: 'boards:later', value: {} }] as never }) })
    renderAt(<Boards />, '/boards')
    const sheet = await openSheet()
    const create = within(sheet).getByRole('button', { name: 'Create board' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Team' } })
    expect(within(sheet).getByText('A board called team is already here: pick another name.')).toBeTruthy()
    expect(create.disabled).toBe(true)
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Later' } })
    expect(create.disabled).toBe(true)
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Fresh' } })
    expect(create.disabled).toBe(false)
  })

  it('Create board stages the create and opens it in Arrange', async () => {
    const { calls } = routes()
    const { loc } = renderAt(<Boards />, '/boards')
    const sheet = await openSheet()
    fireEvent.click(within(sheet).getAllByRole('radio')[1]!)
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Council – Q4' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create board' }))
    await waitFor(() => expect(loc.history.at(-1)).toBe('/b/council-q4?arrange=1'))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'create', record: 'boards:council-q4',
      value: { id: 'council-q4', name: 'Council – Q4', audience: 'members', layout: 'canvas', blocks: [] } }] })
  })

  it("starts from a copy of a built-in's blocks, laid out in the chosen layout", async () => {
    const { calls } = routes()
    renderAt(<Boards />, '/boards')
    const sheet = await openSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy a built-in' }))
    fireEvent.change(within(sheet).getByLabelText('Built-in to copy'), { target: { value: 'treasury' } })
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Money' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create board' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    const value = (calls.find(c => c.method === 'POST')!.body as { ops: { value: { layout: string; blocks: { id: string; place?: unknown }[] } }[] }).ops[0]!.value
    expect(value.layout).toBe('grid')
    expect(value.blocks.map(b => b.id)).toEqual(['balances', 'prepared', 'flow', 'moved', 'list'])
    expect(value.blocks.every(b => b.place !== undefined)).toBe(true)
  })

  it('Cancel closes the sheet and hands focus back to New board', async () => {
    routes()
    renderAt(<Boards />, '/boards')
    const sheet = await openSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New board' })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New board' }))
  })

  it('opens from the page key (n) and from ⌘K’s address, /boards?new=1, which it then drops', async () => {
    routes()
    const { loc } = renderAt(<Boards />, '/boards?new=1')
    expect(await screen.findByRole('dialog', { name: 'New board' })).toBeTruthy()
    await waitFor(() => expect(loc.history.at(-1)).toBe('/boards'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    window.dispatchEvent(new Event(OPEN_NEW_BOARD))
    expect(await screen.findByRole('dialog', { name: 'New board' })).toBeTruthy()
  })
})

describe('the boards page while previewing', () => {
  it('draws no New board, no Copy to yours and no other write control (C-23)', async () => {
    routes()
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Boards /></ViewAsProvider>, '/boards')
    await screen.findByRole('list', { name: 'Your boards' })
    expect(screen.queryByRole('button', { name: 'New board' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Copy to yours/ })).toBeNull()
    window.dispatchEvent(new Event(OPEN_NEW_BOARD))
    expect(screen.queryByRole('dialog')).toBeNull()
    expectNoWriteControls()
  })

  it('under a Public preview a registry-only section (Meetings) is not counted, nor called empty (review M-1, DP-22)', async () => {
    const { calls } = routes({ 'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }, { name: 'meetings', kind: 'collection', count: 3 }] })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Boards /></ViewAsProvider>, '/boards')
    const list = await screen.findByRole('list', { name: 'Section boards' })
    await waitFor(() => expect(calls.some(c => c.path === '/api/registries')).toBe(true))
    await waitFor(() => expect(rowOf(list, 'Projects').querySelector('.brow-n, .brow-empty')).not.toBeNull())
    const meetings = rowOf(list, 'Meetings')
    expect(meetings.querySelector('.brow-n, .brow-empty')).toBeNull()
    expect(meetings.textContent).not.toContain('empty')
  })
})
