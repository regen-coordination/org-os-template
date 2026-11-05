// @vitest-environment jsdom
// The board and the calendar views (§10.2): their DOM and their sheet. calendar.test.ts holds the month's arithmetic.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createEvent, fireEvent as rtlFire, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { LiveRegion } from '../../parts/live.tsx'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import type { Viewer } from '../../viewAs/visibility.ts'
import { BoardCard, BoardView, type BoardViewProps } from './BoardView.tsx'
import { CalEvent, CalendarView, type CalendarViewProps } from './CalendarView.tsx'
import { calendarItems, calEvent, calRow, dueText, type CalItem } from '../../parts/groups/Views.tsx'
import { TASKS, TASK_COLUMNS, TASK_PRESENCE, type FixtureTask } from '../../test/fixtures/house/workspace.ts'

const design = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design')
const css = readFileSync(join(design, 'css', 'views.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const house = readFileSync(join(design, 'skins', 'house.css'), 'utf8')
/** The declarations of the first rule whose selector list holds `sel`, outside or inside an at-rule. */
const rule = (sel: string, sheet = css) => {
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.split(',').map(s => s.trim()).includes(sel)) return m[2]!
  return ''
}
/** The body of an at-rule block, from its condition to its closing brace at the start of a line. */
const block = (at: string) => {
  const i = css.indexOf(at)
  expect(i, at).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('\n}', i))
}

// jsdom has no PointerEvent: the init's pointerId, pointerType and buttons are dropped, so they are set on the event.
const fireEvent = Object.assign((el: Element | Document, ev: Event) => rtlFire(el, ev), rtlFire) as typeof rtlFire
for (const name of ['pointerDown', 'pointerMove', 'pointerUp'] as const) {
  fireEvent[name] = ((el: Element, init: { pointerId?: number; buttons?: number; pointerType?: string; clientX?: number; clientY?: number } = {}) => {
    const ev = createEvent[name](el, init)
    Object.defineProperty(ev, 'clientX', { value: init.clientX ?? 0 })
    Object.defineProperty(ev, 'clientY', { value: init.clientY ?? 0 })
    Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 })
    Object.defineProperty(ev, 'buttons', { value: init.buttons ?? 0 })
    Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse' })
    return rtlFire(el, ev)
  }) as never
}

const as = (viewer: Viewer, ui: ReactElement) => render(<ViewAsProvider initial={viewer}>{ui}</ViewAsProvider>)
const live = () => screen.getByTestId('live').textContent
const ONBOARDING = 'Write the onboarding page'

function board(over: Partial<BoardViewProps<FixtureTask>> = {}): BoardViewProps<FixtureTask> {
  return {
    label: 'Tasks', columns: [...TASK_COLUMNS], cards: [...TASKS], cardKey: t => t.id, cardName: t => t.title, columnOf: t => t.status,
    card: t => <BoardCard title={t.title} facts={[dueText(t.due), t.project, 'a third fact']} presence={[...(TASK_PRESENCE[t.id] ?? [])]} />,
    onMove: vi.fn(async () => true as const), onNew: vi.fn(), ...over,
  }
}
const drawBoard = (p: BoardViewProps<FixtureTask>) => render(<><LiveRegion /><BoardView {...p} /></>)
const column = (name: string) => screen.getByRole('list', { name })
/** A card's own item, found by its key: the ghost a lift leaves and the card that follows the pointer carry none. */
const cardOf = (title: string) => document.querySelector<HTMLElement>(`li[data-card="${TASKS.find(t => t.title === title)!.id}"]`)!
const key = (el: Element, k: string) => act(() => { fireEvent.keyDown(el, { key: k }) })

afterEach(() => { delete (document as { elementFromPoint?: unknown }).elementFromPoint })

describe('BoardView', () => {
  it('draws columns 240–280 wide on --sunken, each head its mark, name, count and + New', () => {
    const p = board()
    const { container } = drawBoard(p)
    expect(screen.getAllByRole('list').map(l => l.getAttribute('aria-label'))).toEqual(['To do', 'Doing', 'Done'])
    const heads = [...container.querySelectorAll('.kcol-h')]
    expect(heads.map(h => h.querySelector('.kcol-n')!.textContent)).toEqual(['To do', 'Doing', 'Done'])
    expect(heads.map(h => h.querySelector('.kcol-c')!.textContent)).toEqual(['2', '3', '2'])
    expect(heads.map(h => h.querySelector('.smark')!.className)).toEqual(['smark smark-open', 'smark smark-open', 'smark smark-done'])
    expect(heads[0]!.querySelector('.smark')!.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'New in Doing' }))
    expect(p.onNew).toHaveBeenCalledWith('Doing')
    expect(rule('.kb-cols')).toContain('grid-template-columns: repeat(auto-fill, minmax(var(--w-kcol-min), var(--w-kcol)));')
    expect(house).toMatch(/--w-kcol-min: 240px;/)
    expect(house).toMatch(/--w-kcol: 280px;/)
    expect(rule('.kcol')).toContain('background: var(--sunken);')
    expect(rule('.kcol')).toContain('border-radius: var(--radius);')
    // it wraps its columns rather than scrolling sideways (§13)
    expect(css).not.toMatch(/overflow-x: (auto|scroll)/)
  })

  it('draws a card raised, radius 8: its title, two facts and who has it open', () => {
    drawBoard(board())
    const card = cardOf('Draft the pool report for Q3')
    expect(card.className).toBe('kcard')
    expect(card.querySelector('.kcard-t')!.textContent).toBe('Draft the pool report for Q3')
    expect([...card.querySelectorAll('.kcard-f > .kcard-fact')].map(f => f.textContent)).toEqual(['18 Oct', 'Node kit'])
    expect(within(card).getByRole('img', { name: 'Ops lead is editing' })).toBeTruthy()
    expect(rule('.kcard')).toContain('background: var(--raised);')
    expect(rule('.kcard')).toContain('border-radius: var(--radius-kcard);')
    expect(house).toMatch(/--radius-kcard: 8px;/)
  })

  it('lifts with Space, moves between columns and positions with the arrows, drops with Space; each step is announced', async () => {
    const p = board()
    drawBoard(p)
    const card = cardOf(ONBOARDING)
    card.focus()
    key(card, ' ')
    expect(live()).toBe(`Lifted ${ONBOARDING}: To do, 1 of 2. Arrows move it, Space drops it, Escape cancels.`)
    expect(cardOf(ONBOARDING).className).toContain('kcard-lift')
    key(document.activeElement!, 'ArrowRight')
    expect(live()).toBe(`${ONBOARDING}: Doing, 1 of 4.`)
    expect(within(column('Doing')).getByText(ONBOARDING)).toBeTruthy()
    expect(document.activeElement).toBe(cardOf(ONBOARDING))
    // its origin keeps a ghost, hidden from a screen reader
    expect(column('To do').querySelector('.kcard-ghost')!.getAttribute('aria-hidden')).toBe('true')
    key(document.activeElement!, 'ArrowDown')
    expect(live()).toBe(`${ONBOARDING}: Doing, 2 of 4.`)
    key(document.activeElement!, 'ArrowRight')
    expect(live()).toBe(`${ONBOARDING}: Done, 2 of 3.`)
    key(document.activeElement!, 'ArrowLeft')
    key(document.activeElement!, ' ')
    expect(p.onMove).toHaveBeenCalledTimes(1)
    expect(p.onMove).toHaveBeenCalledWith(TASKS[3], 'Doing')
    await waitFor(() => expect(live()).toBe(`Moved ${ONBOARDING} to Doing.`))
  })

  it('cancels a lift with Escape, or when focus leaves the card: back in its column, nothing moved', () => {
    const p = board()
    drawBoard(p)
    cardOf(ONBOARDING).focus()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowRight')
    key(document.activeElement!, 'Escape')
    expect(live()).toBe(`Not moved: ${ONBOARDING} is back in To do.`)
    expect(within(column('To do')).getByText(ONBOARDING)).toBeTruthy()
    expect(document.activeElement).toBe(cardOf(ONBOARDING))
    expect(document.querySelector('.kcard-ghost, .kcard-lift')).toBeNull()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowRight')
    act(() => { cardOf(ONBOARDING).blur() })
    expect(within(column('To do')).getByText(ONBOARDING)).toBeTruthy()
    expect(p.onMove).not.toHaveBeenCalled()
  })

  it('drops a card on its own column as no move at all', () => {
    const p = board()
    drawBoard(p)
    cardOf(ONBOARDING).focus()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, ' ')
    expect(p.onMove).not.toHaveBeenCalled()
    expect(live()).toBe(`${ONBOARDING} stays in To do.`)
  })

  it('draws a staged move with the moss bar and "Staged move"', () => {
    drawBoard(board({ staged: t => t.id === 'task-6' }))
    const card = cardOf('Read the Hats tree for the first time')
    expect(card.className).toContain('kcard-staged')
    expect(within(card).getByText('Staged move').closest('.smark')!.className).toBe('smark smark-staged')
    expect(cardOf('Remove the old signer').className).not.toContain('kcard-staged')
    expect(rule('.kcard-staged::before')).toMatch(/inset-inline-start: 0; inline-size: var\(--rule-w-heavy\); background: var\(--accent\);/)
  })

  it('says why a drop was refused, politely, and leaves the card in its column (E-11)', async () => {
    const onMove = vi.fn(async () => 'status must be one of To do, Doing, Done')
    const { container } = drawBoard(board({ onMove }))
    cardOf(ONBOARDING).focus()
    key(cardOf(ONBOARDING), ' ')
    key(document.activeElement!, 'ArrowRight')
    key(document.activeElement!, ' ')
    await waitFor(() => expect(live()).toBe('Not moved: status must be one of To do, Doing, Done'))
    // and shows it, under the board
    expect(container.querySelector('.kb-refused')!.textContent).toBe('Not moved: status must be one of To do, Doing, Done')
    expect(within(column('To do')).getByText(ONBOARDING)).toBeTruthy()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('moves by the pointer: the lifted card pops and tilts −1° (not under reduced motion), its origin a dashed ghost, the target moss dashed on --accent-soft', async () => {
    const p = board()
    drawBoard(p)
    const card = cardOf(ONBOARDING)
    document.elementFromPoint = () => column('Done')
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, buttons: 1 })
    expect(card.className).toContain('kcard-ghost')
    const lifted = document.querySelector('.kcard-lift')!
    expect(lifted.getAttribute('aria-hidden')).toBe('true')
    expect(lifted.textContent).toContain(ONBOARDING)
    expect(column('Done').querySelector('.kdrop')).toBeTruthy()
    expect(column('Doing').querySelector('.kdrop')).toBeNull()
    fireEvent.pointerUp(card, { clientX: 40, clientY: 0 })
    expect(p.onMove).toHaveBeenCalledWith(TASKS[3], 'Done')
    await waitFor(() => expect(live()).toBe(`Moved ${ONBOARDING} to Done.`))
    expect(rule('.kcard-lift')).toMatch(/box-shadow: var\(--shadow-pop\);[^}]*rotate: var\(--lift-rotate\);/)
    expect(house).toMatch(/--lift-rotate: -1deg;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\.kcard-lift \{ rotate: none; \}/)
    expect(rule('.kcard-ghost')).toMatch(/opacity: var\(--o-dim\); border-style: dashed;/)
    expect(rule('.kdrop')).toMatch(/border: var\(--stroke-w\) dashed var\(--accent\);[^}]*background: var\(--accent-soft\);/)
  })

  it('leaves a touch alone (it scrolls), and starts no drag from the card’s link or its Move to… button', () => {
    const p = board({ card: t => <BoardCard title={t.title} href={`/r/${t.id}`} facts={[t.project]} /> })
    drawBoard(p)
    document.elementFromPoint = () => column('Done')
    const card = cardOf(ONBOARDING)
    for (const [el, pointerType] of [[card, 'touch'], [within(card).getByRole('link'), 'mouse'], [within(card).getByRole('button'), 'mouse']] as const) {
      fireEvent.pointerDown(el, { clientX: 0, clientY: 0, buttons: 1, pointerType })
      fireEvent.pointerMove(el, { clientX: 40, clientY: 0, buttons: 1, pointerType })
      fireEvent.pointerUp(el, { clientX: 40, clientY: 0, pointerType })
    }
    expect(p.onMove).not.toHaveBeenCalled()
  })

  it('moves a card through its Move to… menu at any width, the single-pointer path (E-9)', async () => {
    const p = board()
    drawBoard(p)
    fireEvent.click(screen.getByRole('button', { name: `Move to… ${ONBOARDING}` }))
    const menu = screen.getByRole('menu', { name: `Move to… ${ONBOARDING}` })
    expect(within(menu).getAllByRole('menuitemradio').map(i => i.textContent)).toEqual(['To do', 'Doing', 'Done'])
    expect(within(menu).getByRole('menuitemradio', { name: 'To do' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Done' }))
    expect(p.onMove).toHaveBeenCalledWith(TASKS[3], 'Done')
    await waitFor(() => expect(live()).toBe(`Moved ${ONBOARDING} to Done.`))
  })

  it('moves once when a second move comes while the first is in flight', () => {
    const onMove = vi.fn(() => new Promise<true>(() => {}))
    drawBoard(board({ onMove }))
    for (const to of ['Doing', 'Done']) {
      fireEvent.click(screen.getByRole('button', { name: `Move to… ${ONBOARDING}` }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: to }))
    }
    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('offers no locked column as a target, and moves a card out of it', () => {
    const p = board({ columns: [...TASK_COLUMNS, { id: 'other', name: 'other', locked: true }], columnOf: t => (t.id === 'task-5' ? 'other' : t.status) })
    drawBoard(p)
    fireEvent.click(screen.getByRole('button', { name: `Move to… ${ONBOARDING}` }))
    expect(screen.getAllByRole('menuitemradio').map(i => i.textContent)).toEqual(['To do', 'Doing', 'Done'])
    // the arrows pass it by
    const card = cardOf(ONBOARDING)
    card.focus()
    key(card, ' ')
    key(document.activeElement!, 'ArrowRight')
    key(document.activeElement!, 'ArrowRight')
    key(document.activeElement!, 'ArrowRight')
    expect(live()).toBe(`${ONBOARDING}: Done, 1 of 3.`)
    key(document.activeElement!, 'Escape')
    const out = cardOf('Ask the Council about the pool')
    out.focus()
    key(out, ' ')
    key(document.activeElement!, 'ArrowLeft')
    expect(live()).toBe('Ask the Council about the pool: Done, 1 of 3.')
  })

  it('cannot move a card that says why, and says so', () => {
    const p = board({ fixed: t => (t.id === 'task-4' ? 'This record has no id in its file, so it cannot be moved here.' : undefined) })
    drawBoard(p)
    const card = cardOf(ONBOARDING)
    card.focus()
    key(card, ' ')
    expect(live()).toBe(`${ONBOARDING} can’t be moved: This record has no id in its file, so it cannot be moved here.`)
    expect(card.className).not.toContain('kcard-lift')
    fireEvent.click(screen.getByRole('button', { name: `Move to… ${ONBOARDING}` }))
    for (const item of screen.getAllByRole('menuitemradio')) expect(item.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }))
    expect(p.onMove).not.toHaveBeenCalled()
  })

  it('while previewing, lifts nothing and draws no + New and no Move to… (E-10, C-23)', () => {
    const p = board()
    as({ as: 'members' }, <><LiveRegion /><BoardView {...p} /></>)
    expect(screen.queryByRole('button', { name: /^New in / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Move to… / })).toBeNull()
    const card = cardOf(ONBOARDING)
    expect(card.hasAttribute('tabindex')).toBe(false)
    key(card, ' ')
    document.elementFromPoint = () => column('Done')
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0, buttons: 1 })
    fireEvent.pointerMove(card, { clientX: 40, clientY: 0, buttons: 1 })
    fireEvent.pointerUp(card, { clientX: 40, clientY: 0 })
    expect(document.querySelector('.kcard-lift, .kcard-ghost')).toBeNull()
    expect(p.onMove).not.toHaveBeenCalled()
  })

  it('draws no card the viewer may not see, and counts none', () => {
    const cards = TASKS.map(t => (t.status === 'To do' ? { ...t, facts: { visibility: 'hat:treasury' } } : t))
    const { container } = as({ as: 'members' }, <BoardView {...board({ cards })} />)
    expect(within(column('To do')).queryAllByRole('listitem')).toHaveLength(0)
    expect(container.querySelector('.kcol-c')!.textContent).toBe('0')
  })

  it('is a grouped list under 600px of its own width, each card with its Move to… menu', () => {
    drawBoard(board())
    expect(screen.getAllByRole('button', { name: /^Move to… / })).toHaveLength(TASKS.length)
    expect(rule('.kb')).toContain('container: kb / inline-size;')
    const narrow = block('@container kb (max-width: 599px) {')
    expect(narrow).toMatch(/\.kb-cols \{ display: block;/)
    expect(narrow).toMatch(/\.kcol \{ display: block; padding: 0; border-radius: 0; background: transparent; \}/)
    expect(narrow).toMatch(/\.kcard \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*border-radius: 0;[^}]*box-shadow: none;/)
    expect(narrow).toMatch(/\.kmv-t \{ display: inline; \}/)
    expect(css).not.toMatch(/@media \((max|min)-width/)
  })
})

function cal(over: Partial<CalendarViewProps<CalItem>> = {}): CalendarViewProps<CalItem> {
  return { label: 'Tasks and meetings', year: 2026, month: 10, today: '2026-10-17', events: calendarItems(), dateOf: e => e.date,
    event: calEvent, row: calRow, onOpenDay: vi.fn(), ...over }
}
const grid = () => screen.getByRole('grid')
const day = (date: string) => grid().querySelector<HTMLElement>(`td[data-date="${date}"]`)!

describe('CalendarView', () => {
  it('draws the month as day cells, Monday first, the date in a 22px circle, today an ink disc', () => {
    render(<CalendarView {...cal()} />)
    expect(grid().getAttribute('aria-labelledby')).toBeTruthy()
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy()
    expect(within(grid()).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(within(grid()).getAllByRole('gridcell')).toHaveLength(35)
    expect(day('2026-10-17').getAttribute('aria-current')).toBe('date')
    expect(day('2026-10-17').className).toContain('cal-today')
    expect(grid().querySelectorAll('[aria-current]')).toHaveLength(1)
    expect(day('2026-09-28').className).toContain('cal-out')
    expect(day('2026-10-17').querySelector('.cal-d')!.textContent).toBe('17')
    expect(rule('.cal-d')).toMatch(/inline-size: var\(--h-cal-date\); block-size: var\(--h-cal-date\); border-radius: var\(--radius-chip\);/)
    expect(house).toMatch(/--h-cal-date: 22px;/)
    expect(rule('.cal-today .cal-d')).toContain('background: var(--solid); color: var(--on-solid);')
    expect(rule('.cal-out')).toContain('background: var(--sunken);')
    expect(rule('.cal-day')).toContain('block-size: var(--h-cal-day);')
    expect(house).toMatch(/--h-cal-day: 96px;/)
    // seven columns parted by 1px rules
    expect(rule('.cal-grid th')).toContain('border: var(--rule-w) solid var(--rule);')
    expect(rule('.cal-grid td')).toContain('border: var(--rule-w) solid var(--rule);')
  })

  it('draws events as pills, a glyph and a truncated title; an overdue task clay with its word; a staged one with the moss bar (E-12)', () => {
    render(<CalendarView {...cal()} />)
    const pills = [...day('2026-10-15').querySelectorAll('.cal-ev')]
    expect(pills.map(p => p.querySelector('.cal-ev-t')!.textContent)).toEqual(['Council call', ONBOARDING, 'Remove the old signer'])
    expect(pills.every(p => p.querySelector('svg[aria-hidden="true"]'))).toBe(true)
    const late = pills[1]!
    expect(late.className).toContain('cal-ev-late')
    expect(late.textContent).toBe(`${ONBOARDING}Overdue`)
    expect(late.querySelector('.sr-only')!.textContent).toBe('Overdue')
    expect(pills[2]!.className).not.toContain('cal-ev-late')
    expect(day('2026-10-25').querySelector('.cal-ev')!.className).toContain('cal-ev-staged')
    expect(rule('.cal-ev')).toContain('block-size: var(--h-ev);')
    expect(house).toMatch(/--h-ev: 20px;/)
    expect(rule('.cal-ev-t')).toContain('overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expect(rule('.cal-ev-late')).toContain('background: var(--attn-soft); color: var(--attn);')
    expect(rule('.cal-ev-staged::before')).toMatch(/inset-inline-start: 0; inline-size: var\(--rule-w-heavy\); background: var\(--accent\);/)
  })

  it('shows three events of a fuller day and "+2 more", which opens the day', () => {
    const p = cal()
    render(<CalendarView {...p} />)
    expect(day('2026-10-17').querySelectorAll('.cal-ev')).toHaveLength(3)
    fireEvent.click(within(day('2026-10-17')).getByRole('button', { name: '+2 more' }))
    expect(p.onOpenDay).toHaveBeenCalledWith('2026-10-17')
  })

  it('moves by day with the arrows and by month with Page Up and Page Down; Enter opens the day', () => {
    const p = cal()
    render(<CalendarView {...p} />)
    expect(day('2026-10-17').tabIndex).toBe(0)
    expect(within(grid()).getAllByRole('gridcell').filter(c => c.tabIndex === 0)).toHaveLength(1)
    day('2026-10-17').focus()
    key(day('2026-10-17'), 'ArrowRight')
    expect(document.activeElement).toBe(day('2026-10-18'))
    key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(day('2026-10-25'))
    key(document.activeElement!, 'ArrowUp')
    key(document.activeElement!, 'ArrowLeft')
    expect(document.activeElement).toBe(day('2026-10-17'))
    key(document.activeElement!, 'PageDown')
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeTruthy()
    expect(document.activeElement).toBe(day('2026-11-17'))
    key(document.activeElement!, 'PageUp')
    key(document.activeElement!, 'PageUp')
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeTruthy()
    expect(document.activeElement).toBe(day('2026-09-17'))
    // an arrow past the month's last day turns the month
    for (let i = 0; i < 14; i++) key(document.activeElement!, 'ArrowRight')
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy()
    expect(document.activeElement).toBe(day('2026-10-01'))
    key(document.activeElement!, 'Enter')
    expect(p.onOpenDay).toHaveBeenCalledWith('2026-10-01')
  })

  it('turns the month to a day outside it that is focused (a click), and says so through onMonth', () => {
    const onMonth = vi.fn()
    render(<CalendarView {...cal({ year: 2026, month: 11, onMonth })} />)
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeTruthy()
    act(() => { day('2026-10-30').focus() })
    expect(onMonth).toHaveBeenCalledWith(2026, 10)
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy()
    expect(document.activeElement).toBe(day('2026-10-30'))
    expect(day('2026-10-30').tabIndex).toBe(0)
    // a day of the shown month changes nothing but the focus
    act(() => { day('2026-10-12').focus() })
    expect(onMonth).toHaveBeenCalledTimes(1)
  })

  it('turns the month by its buttons, and Today comes back', () => {
    render(<CalendarView {...cal()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy()
  })

  it('draws no event the viewer may not see', () => {
    const events = calendarItems().map(e => (e.date === '2026-10-17' ? { ...e, facts: { visibility: 'hat:treasury' } } : e))
    as({ as: 'members' }, <CalendarView {...cal({ events })} />)
    expect(day('2026-10-17').querySelectorAll('.cal-ev')).toHaveLength(0)
    expect(within(day('2026-10-17')).queryByRole('button')).toBeNull()
  })

  it('is an agenda under 600px of its own width: day headings ("Today · Sat 17 Oct") over data rows', () => {
    const { container } = render(<CalendarView {...cal()} />)
    const agenda = container.querySelector('.cal-agenda')!
    const heads = [...agenda.querySelectorAll('.agenda-day')]
    expect(heads.map(h => h.textContent)).toEqual(['Thu 1 Oct', 'Mon 12 Oct', 'Thu 15 Oct', 'Today · Sat 17 Oct', 'Sun 18 Oct', 'Wed 21 Oct', 'Thu 22 Oct', 'Sun 25 Oct', 'Thu 29 Oct'])
    expect(heads[3]!.className).toContain('agenda-today')
    const today = within(agenda as HTMLElement).getByRole('list', { name: 'Today · Sat 17 Oct' })
    expect(within(today).getAllByRole('listitem')).toHaveLength(5)
    expect(today.querySelector('.drow-t')!.textContent).toBe('Ops sync')
    expect(rule('.cal')).toContain('container: cal / inline-size;')
    const narrow = block('@container cal (max-width: 599px) {')
    expect(narrow).toContain('.cal-box { display: none; }')
    expect(narrow).toContain('.cal-agenda { display: grid;')
    expect(rule('.cal-agenda')).toContain('display: none;')
    expect(rule('.agenda-today')).toContain('color: var(--ink);')
  })
})

describe('CalEvent', () => {
  it('is a pill: the glyph hidden, the title, and Overdue for a screen reader when late', () => {
    const { container } = render(<CalEvent glyph="check" title="Pool report" late />)
    expect(container.querySelector('.cal-ev')!.className).toBe('cal-ev cal-ev-late')
    expect(screen.getByText('Overdue').className).toBe('sr-only')
  })
})
