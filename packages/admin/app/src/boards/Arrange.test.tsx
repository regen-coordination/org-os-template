// @vitest-environment jsdom
// packages/admin/app/src/boards/Arrange.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, createEvent, fireEvent as rtlFire, screen, waitFor, within } from '@testing-library/react'
import App from '../App.tsx'
import { renderAt } from '../test/render.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { baseRoutes, boardRead, changeView } from '../test/data.ts'
import { arrangeStore } from './arrangeStore.ts'
import { flowEnv } from '../test/flowEnv.ts'
import { defineBlock } from '../blocks/index.ts'

// jsdom has no PointerEvent: the init's pointerId, buttons and coordinates are dropped, so they are set on the event itself (as kanban.test).
const fireEvent = Object.assign((el: Element | Document, ev: Event) => rtlFire(el, ev), rtlFire) as typeof rtlFire
for (const name of ['pointerDown', 'pointerMove', 'pointerUp', 'pointerCancel'] as const) {
  fireEvent[name] = ((el: Element, init: { pointerId?: number; buttons?: number; clientX?: number; clientY?: number } = {}) => {
    const ev = createEvent[name](el, init)
    Object.defineProperty(ev, 'pointerId', { value: init.pointerId })
    Object.defineProperty(ev, 'buttons', { value: init.buttons ?? 0 })
    Object.defineProperty(ev, 'clientX', { value: init.clientX ?? 0 })
    Object.defineProperty(ev, 'clientY', { value: init.clientY ?? 0 })
    return rtlFire(el, ev)
  }) as never
}
// A block that throws while it renders: one block must not blank the board.
defineBlock<{ title?: string }>({
  type: 'test-throws', label: 'Throws', config: [], title: c => c.title ?? 'Throws',
  useData: () => ({ state: 'ready', count: 1, data: null }),
  Body: () => { throw new Error('boom') },
})

// What Arrange says is shown on the page and said again through the live region: read the shown line.
const shown = () => document.querySelector('.arr-said')?.textContent ?? ''

let calls: { method: string; path: string; body: unknown }[]
const team = boardRead({ id: 'team', name: 'Team', layout: 'grid', origin: 'instance', blocks: [{ id: 'n', type: 'note', title: 'Hello', text: 'hi', place: { col: 1, span: 6, row: 1 } }] })

beforeEach(() => {
  vi.unstubAllGlobals()
  arrangeStore.end()
  flowEnv()
  ;({ calls } = fetchRoutes(baseRoutes({
    'GET /api/boards': [team, boardRead({ id: 'home', name: '{org}', origin: 'builtin', layout: 'flow', blocks: [] })],
    'GET /api/resources': [], 'GET /api/registries': [],
    'POST /api/changes/ops': (init: RequestInit | undefined) => changeView({ ops: [{ ...JSON.parse(String(init!.body)).ops[0], base: 'h', before: null }] }),
  })))
})

describe('Arrange', () => {
  it('moves and resizes a block by keyboard, reviews, and stages one update', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const cell = await screen.findByRole('group', { name: 'Hello, block 1 of 1' })
    cell.focus()
    fireEvent.keyDown(cell, { key: ' ' })
    expect(shown()).toMatch(/^Picked up Hello/)
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    fireEvent.keyDown(cell, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(cell, { key: ' ' })
    expect(shown()).toBe('Dropped Hello at column 2, 7 wide, row 1.')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('moved n')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'update', record: 'boards:team',
      set: { name: 'Team', layout: 'grid', blocks: [{ id: 'n', type: 'note', title: 'Hello', text: 'hi', place: { col: 2, span: 7, row: 1 } }] } }] })
  })

  it('puts a picked block back on Escape, and Cancel leaves the board as it was', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const cell = await screen.findByRole('group', { name: 'Hello, block 1 of 1' })
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    fireEvent.keyDown(cell, { key: 'Escape' })
    expect(shown()).toBe('Put Hello back.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Arrange' })).toBeTruthy()
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('adds a note and writes it in its settings', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.change(screen.getByLabelText('Add block'), { target: { value: 'note' } })
    const settings = await screen.findAllByRole('button', { name: 'Settings' })
    fireEvent.click(settings[1]!)
    const panel = await screen.findByRole('complementary', { name: /^Block settings/ })
    fireEvent.change(panel.querySelector('textarea')!, { target: { value: '## Hi' } })
    expect(arrangeStore.get()!.board.blocks[1]).toMatchObject({ id: 'note-1', type: 'note', text: '## Hi' })
  })

  // B2 (fix wave): a preview ends an arrange — the toolbar with its Done, and the block settings that write the draft.
  it('ends an arrange, and an open Block settings, when a preview begins (C6, C-23)', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.change(screen.getByLabelText('Add block'), { target: { value: 'note' } })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Settings' }))[1]!)
    expect(await screen.findByRole('complementary', { name: /^Block settings/ })).toBeTruthy()
    expect(arrangeStore.get()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^View as/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    await waitFor(() => expect(arrangeStore.get()).toBeNull())
    expect(screen.queryByRole('toolbar', { name: 'Arrange' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: /^Block settings/ })).toBeNull()
    expect(calls.some(c => c.method !== 'GET')).toBe(false) // nothing was staged on the way out
  })

  // the label (walk 2026-11-04, L4c-fix 13; the operator's word): "Copy to yours", not 0.6's "Make this board ours"
  it('offers Copy to yours on a built-in, staging a create of its copy', async () => {
    renderAt(<App />, '/b/home')
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to yours' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')!.body).toEqual({ ops: [{ op: 'create', record: 'boards:home',
      value: { id: 'home', name: '{org}', audience: 'members', layout: 'flow', blocks: [] } }] }))
  })

  it('shows the refusal under the review when staging is refused, and stays arranging', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/boards': [team], 'GET /api/resources': [], 'GET /api/registries': [],
      'POST /api/changes/ops': () => new Response(JSON.stringify({ errors: [{ record: 'boards:team', field: 'blocks', message: 'block "n": span 2 is under the minimum of 3' }] }), { status: 422 }),
    }))
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const cell = await screen.findByRole('group', { name: 'Hello, block 1 of 1' })
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stage' }))
    expect(await screen.findByText('block "n": span 2 is under the minimum of 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  it('ends Arrange on Done when nothing changed, staging nothing (the machine\'s changed guard)', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(shown()).toBe('Nothing changed; the board is as it was.')
    expect(screen.getByRole('button', { name: 'Arrange' })).toBeTruthy()
    expect(arrangeStore.get()).toBeNull()
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('is not offered below 760px, and a board that narrows while arranged draws no cells', async () => {
    let narrow = true
    let changed = () => {}
    vi.stubGlobal('matchMedia', (q: string) => ({ get matches() { return narrow && q.includes('759px') }, addEventListener: (_: string, f: () => void) => { changed = f }, removeEventListener() {} }))
    const first = renderAt(<App />, '/b/team')
    await screen.findByRole('heading', { name: 'Team' })
    expect(screen.queryByRole('button', { name: 'Arrange' })).toBeNull()
    first.unmount()
    narrow = false
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    expect(screen.getByRole('group', { name: 'Hello, block 1 of 1' })).toBeTruthy()
    narrow = true
    act(() => changed())
    expect(screen.queryByRole('group', { name: /block 1 of 1/ })).toBeNull()
    expect(screen.getByText('hi')).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: 'Arrange' })).toBeNull()
  })

  it('starts once from ?arrange=1 and drops it from the address, so a breakpoint crossing does not start it again (final review M-4)', async () => {
    let narrow = false
    let changed = () => {}
    vi.stubGlobal('matchMedia', (q: string) => ({ get matches() { return narrow && q.includes('759px') }, addEventListener: (_: string, f: () => void) => { changed = f }, removeEventListener() {} }))
    const { loc } = renderAt(<App />, '/b/team?arrange=1')
    expect(await screen.findByRole('toolbar', { name: 'Arrange' })).toBeTruthy()
    await waitFor(() => expect(loc.history.at(-1)).toBe('/b/team'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('toolbar', { name: 'Arrange' })).toBeNull()
    narrow = true
    act(() => changed())
    narrow = false
    act(() => changed())
    expect(await screen.findByRole('button', { name: 'Arrange' })).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: 'Arrange' })).toBeNull()
  })

  it('Escape on a picked-up block puts it back and leaves block settings open; the next Escape closes them', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByRole('complementary', { name: 'Block settings: Hello' })
    const cell = screen.getByRole('group', { name: 'Hello, block 1 of 1' })
    cell.focus()
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    fireEvent.keyDown(cell, { key: 'Escape' })
    expect(shown()).toBe('Put Hello back.')
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 1, span: 6, row: 1 })
    expect(screen.getByRole('complementary', { name: 'Block settings: Hello' })).toBeTruthy()
    fireEvent.keyDown(cell, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /^Block settings/ })).toBeNull())
    expect(arrangeStore.get()).not.toBeNull()
  })

  it('moves a block by its grip with the pointer, and a cancelled drag puts it back', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const grip = (await screen.findByRole('group', { name: 'Hello, block 1 of 1' })).querySelector('.arr-grip')!
    // jsdom has no layout: the grid's width is 0, so a column is a canvas cell (88 px)
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(grip, { clientX: 180, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(grip, { clientX: 400, clientY: 0, pointerId: 2, buttons: 1 })   // another pointer is ignored
    fireEvent.pointerUp(grip, { clientX: 180, clientY: 0, pointerId: 1 })
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 3, span: 6, row: 1 })
    expect(shown()).toBe('Hello: column 3, 6 wide, row 1.')
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(grip, { clientX: 90, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerCancel(grip, { pointerId: 1 })
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 3, span: 6, row: 1 })
    const corner = screen.getByRole('group', { name: 'Hello, block 1 of 1' }).querySelector('.arr-size')!
    fireEvent.pointerDown(corner, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(corner, { clientX: -100, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 3, span: 6, row: 1 })
  })

  it('removes a block, and closes its settings with it', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByRole('complementary', { name: 'Block settings: Hello' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(shown()).toBe('Removed Hello.')
    expect(arrangeStore.get()!.board.blocks).toEqual([])
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /^Block settings/ })).toBeNull())
  })

  it('leaving the board ends its draft, and its block settings close with it', async () => {
    const { loc } = renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByRole('complementary', { name: 'Block settings: Hello' })
    act(() => loc.navigate('/b/home'))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /^Block settings/ })).toBeNull())
    expect(arrangeStore.get()).toBeNull()
    // and the slot itself is closed: no hidden panel is left for Escape to close (fireEvent answers !defaultPrevented)
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true)
  })

  it('keeps focus on a picked flow block when a move reorders it (the DOM node moves)', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/boards': [boardRead({ id: 'team', name: 'Team', layout: 'flow', blocks: [
        { id: 'a', type: 'note', title: 'First', text: 'one' }, { id: 'b', type: 'note', title: 'Second', text: 'two' }] })],
      'GET /api/resources': [], 'GET /api/registries': [],
    }))
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const cell = screen.getByRole('group', { name: 'First, block 1 of 2' })
    cell.focus()
    fireEvent.keyDown(cell, { key: ' ' })
    // Chrome and Firefox drop focus to the body when a focused node is moved; jsdom keeps it, so drop it here
    cell.blur()
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(arrangeStore.get()!.board.blocks.map(b => b.id)).toEqual(['b', 'a'])
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'First, block 2 of 2' }))
  })

  it('takes a list of fields as typed, commas and spaces included, and stores the list on blur', async () => {
    fetchRoutes(baseRoutes({
      'GET /api/boards': [boardRead({ id: 'team', name: 'Team', layout: 'grid', blocks: [
        { id: 'l', type: 'list', title: 'Projects', source: { kind: 'project' }, place: { col: 1, span: 6, row: 1 } }] })],
      'GET /api/resources': [], 'GET /api/registries': [],
    }))
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const columns = await screen.findByLabelText('columns') as HTMLInputElement
    let typed = ''
    for (const ch of ['a', ',', ' ', 'b']) { typed += ch; fireEvent.change(columns, { target: { value: typed } }); expect(columns.value).toBe(typed) }
    fireEvent.blur(columns)
    expect(arrangeStore.get()!.board.blocks[0]!.view).toEqual({ columns: ['a', 'b'] })
  })

  it('locks the cells while reviewing: no settings, removing or moving until Back', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const cell = screen.getByRole('group', { name: 'Hello, block 1 of 1' })
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByRole('button', { name: 'Stage' })
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(cell, { key: ' ' })
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    const grip = cell.querySelector('.arr-grip')!
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(grip, { clientX: 200, clientY: 0, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(grip, { clientX: 200, clientY: 0, pointerId: 1 })
    expect(arrangeStore.get()!.picked).toBeNull()
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 1, span: 6, row: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('draws a block that throws as an error note naming it, and the rest of the board stays', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchRoutes(baseRoutes({
      'GET /api/boards': [boardRead({ id: 'team', name: 'Team', layout: 'grid', blocks: [
        { id: 'bad', type: 'test-throws', title: 'Broken', place: { col: 1, span: 6, row: 1 } },
        { id: 'n', type: 'note', title: 'Hello', text: 'still here', place: { col: 7, span: 6, row: 1 } }] })],
      'GET /api/resources': [], 'GET /api/registries': [],
    }))
    renderAt(<App />, '/b/team')
    expect(await screen.findByText('Block “Broken” could not be drawn (boom); Arrange can remove it.')).toBeTruthy()
    expect(screen.getByText('still here')).toBeTruthy()
    quiet.mockRestore()
  })
})

// C9 (§14.2, E-71, E-72): Arrange keeps 0.6's machine, redrawn — a grip on every block that moves it by keyboard as
// well as by pointer, a "Move to…" menu for a single pointer, the picked block a moss drop target, and the block's
// settings in the inspector's frame, on the house's inputs.
describe('Arrange in the house', () => {
  const two = boardRead({ id: 'team', name: 'Team', layout: 'flow', blocks: [
    { id: 'a', type: 'note', title: 'First', text: 'one' }, { id: 'b', type: 'note', title: 'Second', text: 'two' }] })
  const routesWith = (board: ReturnType<typeof boardRead>) => fetchRoutes(baseRoutes({ 'GET /api/boards': [board], 'GET /api/resources': [], 'GET /api/registries': [] }))

  it("moves a block from its focused grip: Space lifts, the arrows move, Esc puts it back, each step said (E-72)", async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const grip = screen.getByRole('button', { name: 'Move Hello' })
    expect(grip.closest('.arr')).toBe(screen.getByRole('group', { name: 'Hello, block 1 of 1' }))
    grip.focus()
    fireEvent.keyDown(grip, { key: ' ' })
    expect(shown()).toMatch(/^Picked up Hello/)
    expect(grip.closest('.arr')!.className).toContain('picked')
    fireEvent.keyDown(grip, { key: 'ArrowRight' })
    expect(shown()).toBe('Hello: column 2, 6 wide, row 1.')
    fireEvent.keyDown(grip, { key: 'Escape' })
    expect(shown()).toBe('Put Hello back.')
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 1, span: 6, row: 1 })
    fireEvent.keyDown(grip, { key: ' ' })
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    fireEvent.keyDown(grip, { key: ' ' })
    expect(shown()).toBe('Dropped Hello at column 1, 6 wide, row 2.')
    expect(document.activeElement).toBe(grip)
  })

  it('moves a block with its Move to… menu, one step at a time, and says where it went (E-72)', async () => {
    routesWith(two)
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to… First' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Place 2/ }))
    expect(arrangeStore.get()!.board.blocks.map(b => b.id)).toEqual(['b', 'a'])
    expect(shown()).toBe('First: place 2 of 2.')
  })

  it('offers a grid block the four directions in its Move to… menu', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to… Hello' }))
    expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual(['One column left', 'One column right', 'One row up', 'One row down'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'One row down' }))
    expect(arrangeStore.get()!.board.blocks[0]!.place).toEqual({ col: 1, span: 6, row: 2 })
    expect(shown()).toBe('Hello: column 1, 6 wide, row 2.')
  })

  it('opens block settings in the inspector, on the house inputs (E-71)', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const panel = await screen.findByRole('complementary', { name: 'Block settings: Hello' })
    expect(panel.className).toContain('insp')
    expect(panel.className).toContain('insp-settings')
    expect(within(panel).getByRole('heading', { level: 2, name: 'Hello' })).toBeTruthy()
    for (const field of panel.querySelectorAll('input, select, textarea')) expect(field.className).toMatch(/\binput\b/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /^Block settings/ })).toBeNull())
  })

  it('locks the grip and hides Move to… while the review is up', async () => {
    renderAt(<App />, '/b/team')
    fireEvent.click(await screen.findByRole('button', { name: 'Arrange' }))
    const grip = screen.getByRole('button', { name: 'Move Hello' })
    fireEvent.keyDown(grip, { key: ' ' })
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    fireEvent.keyDown(grip, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByRole('button', { name: 'Stage' })
    expect((screen.getByRole('button', { name: 'Move Hello' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Move to… Hello' })).toBeNull()
  })
})
