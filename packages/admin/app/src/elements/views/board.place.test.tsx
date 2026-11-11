// @vitest-environment jsdom
// DAO-OS L6 Task 17: the board's moves to a place (`onPlace`) — a card moved within its own column, and a card moved
// across columns to a position. Without `onPlace` the board is L4c's (board.test.tsx): a move takes a column only.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createEvent, fireEvent as rtlFire, render, screen, waitFor, within } from '@testing-library/react'
import { LiveRegion } from '../../parts/live.tsx'
import { BoardCard, BoardView, type BoardViewProps } from './BoardView.tsx'
import { TASKS, TASK_COLUMNS, type FixtureTask } from '../../test/fixtures/house/workspace.ts'

// jsdom has no PointerEvent (as board.test.tsx): the init's fields are set on the event.
const fireEvent = Object.assign((el: Element | Document, ev: Event) => rtlFire(el, ev), rtlFire) as typeof rtlFire
for (const name of ['pointerDown', 'pointerMove', 'pointerUp'] as const) {
  fireEvent[name] = ((el: Element, init: { pointerId?: number; buttons?: number; clientX?: number; clientY?: number } = {}) => {
    const ev = createEvent[name](el, init)
    Object.defineProperty(ev, 'clientX', { value: init.clientX ?? 0 })
    Object.defineProperty(ev, 'clientY', { value: init.clientY ?? 0 })
    Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 })
    Object.defineProperty(ev, 'buttons', { value: init.buttons ?? 0 })
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' })
    return rtlFire(el, ev)
  }) as never
}

const live = () => screen.getByTestId('live').textContent
const ONBOARDING = 'Write the onboarding page' // To do, first
const POOL = 'Ask the Council about the pool'   // To do, second
const cardOf = (title: string) => document.querySelector<HTMLElement>(`li[data-card="${TASKS.find(t => t.title === title)!.id}"]`)!
const column = (name: string) => screen.getByRole('list', { name })
const key = (el: Element, k: string) => act(() => { fireEvent.keyDown(el, { key: k }) })

function board(over: Partial<BoardViewProps<FixtureTask>> = {}): BoardViewProps<FixtureTask> {
  return {
    label: 'Tasks', columns: [...TASK_COLUMNS], cards: [...TASKS], cardKey: t => t.id, cardName: t => t.title, columnOf: t => t.status,
    card: t => <BoardCard title={t.title} />, onMove: vi.fn(async () => true as const), onPlace: vi.fn(async () => true as const), ...over,
  }
}
const draw = (p: BoardViewProps<FixtureTask>) => render(<><LiveRegion /><BoardView {...p} /></>)

afterEach(() => { delete (document as { elementFromPoint?: unknown }).elementFromPoint })

describe('BoardView with onPlace (DAO-OS L6 Task 17)', () => {
  it('moves a card within its own column by the keyboard: Space, Down, Space', async () => {
    const p = board()
    draw(p)
    cardOf(ONBOARDING).focus()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowDown')
    expect(live()).toBe(`${ONBOARDING}: To do, 2 of 2.`)
    key(document.activeElement!, ' ')
    expect(p.onPlace).toHaveBeenCalledWith(TASKS[3], 'To do', 1)
    expect(p.onMove).not.toHaveBeenCalled()
    await waitFor(() => expect(live()).toBe(`Moved ${ONBOARDING} to 2 of 2 in To do.`))
  })

  it('still drops a card where it was lifted as no move at all', () => {
    const p = board()
    draw(p)
    cardOf(ONBOARDING).focus()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, 'ArrowUp')
    key(document.activeElement!, ' ')
    expect(p.onPlace).not.toHaveBeenCalled()
    expect(live()).toBe(`${ONBOARDING} stays in To do.`)
  })

  it('moves a card across columns to the position the arrows chose', async () => {
    const p = board()
    draw(p)
    cardOf(ONBOARDING).focus()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowRight')
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, ' ')
    expect(p.onPlace).toHaveBeenCalledWith(TASKS[3], 'Doing', 1)
    await waitFor(() => expect(live()).toBe(`Moved ${ONBOARDING} to Doing.`))
  })

  it('offers Move up and Move down in Move to…, each the single-pointer path within the column', async () => {
    const p = board()
    draw(p)
    fireEvent.click(screen.getByRole('button', { name: `Move to… ${POOL}` }))
    const menu = screen.getByRole('menu', { name: `Move to… ${POOL}` })
    const [up, down] = within(menu).getAllByRole('menuitem')
    expect(up!.textContent).toBe('Move up')
    // the last card cannot go down, and says why where a hint would be
    expect(down!.textContent).toBe('Move downIt is last in To do.')
    expect(down!.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(up!)
    expect(p.onPlace).toHaveBeenCalledWith(TASKS[4], 'To do', 0)
    await waitFor(() => expect(live()).toBe(`Moved ${POOL} to 1 of 2 in To do.`))
  })

  it('a column picked in Move to… places the card at the end of it', () => {
    const p = board()
    draw(p)
    fireEvent.click(screen.getByRole('button', { name: `Move to… ${ONBOARDING}` }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }))
    expect(p.onPlace).toHaveBeenCalledWith(TASKS[3], 'Done', 2)
  })

  it('moves a card within its column by the pointer, to where it is let go', () => {
    const p = board()
    draw(p)
    const todo = column('To do')
    // the second card's box: the pointer let go below its middle puts the first card after it
    const pool = cardOf(POOL)
    pool.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) })
    document.elementFromPoint = () => todo
    const card = cardOf(ONBOARDING)
    fireEvent.pointerDown(card, { clientX: 0, clientY: 10, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 0, clientY: 135, buttons: 1 })
    expect(todo.querySelector('.kdrop')).toBeTruthy()
    fireEvent.pointerUp(card, { clientX: 0, clientY: 135 })
    expect(p.onPlace).toHaveBeenCalledWith(TASKS[3], 'To do', 1)
  })

  it('a pointer let go where the card was is no move', () => {
    const p = board()
    draw(p)
    const pool = cardOf(POOL)
    pool.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) })
    document.elementFromPoint = () => column('To do')
    const card = cardOf(ONBOARDING)
    fireEvent.pointerDown(card, { clientX: 0, clientY: 10, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 0, clientY: 30, buttons: 1 })
    expect(column('To do').querySelector('.kdrop')).toBeNull()
    fireEvent.pointerUp(card, { clientX: 0, clientY: 30 })
    expect(p.onPlace).not.toHaveBeenCalled()
  })

  it('says a refused place in the server’s words, and the card stays', async () => {
    const p = board({ onPlace: vi.fn(async () => 'This record changed since it was read.') })
    draw(p)
    fireEvent.click(screen.getByRole('button', { name: `Move to… ${POOL}` }))
    fireEvent.click(screen.getAllByRole('menuitem')[0]!)
    await waitFor(() => expect(live()).toBe('Not moved: This record changed since it was read.'))
    expect(within(column('To do')).getAllByRole('listitem')[1]!.textContent).toContain(POOL)
  })
})
