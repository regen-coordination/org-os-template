// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import type { Viewer } from '../../viewAs/visibility.ts'
import { DataRow } from '../rows/DataRow.tsx'
import { ViewHeader, type ViewHeaderProps } from './ViewHeader.tsx'
import { TableView, type TableViewProps } from './TableView.tsx'
import { ListView } from './ListView.tsx'
import type { Filter } from './filters.ts'
import { taskColumns } from '../../parts/groups/Views.tsx'
import { SAVED_VIEW, TASKS, TASK_FIELDS, TASK_VIEWS, type FixtureTask } from '../../test/fixtures/house/workspace.ts'
import { errorNote } from '../../test/notes.ts'

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

const as = (viewer: Viewer, ui: ReactElement) => render(<ViewAsProvider initial={viewer}>{ui}</ViewAsProvider>)
const NOT_DONE: Filter = { field: 'status', op: 'is-not', value: 'done' }
const EMPTY = { title: 'No tasks yet.', line: 'Tasks link to projects, meetings and proposals.' }

function header(over: Partial<ViewHeaderProps> = {}) {
  const props: ViewHeaderProps = { label: 'Tasks', views: [...TASK_VIEWS], value: 'table', onView: vi.fn(), filters: [NOT_DONE], onFilters: vi.fn(),
    fields: TASK_FIELDS, primary: { label: 'New task', onClick: vi.fn() }, ...over }
  return props
}
function table(over: Partial<TableViewProps<FixtureTask>> = {}): TableViewProps<FixtureTask> {
  return { label: 'Tasks', rows: [...TASKS], columns: taskColumns(), rowKey: t => t.id, empty: EMPTY, ...over }
}
const tasksTable = () => screen.getByRole('table', { name: 'Tasks' })
const tasksGrid = () => screen.getByRole('grid', { name: 'Tasks' })
const cellOf = (title: string, col: number) => screen.getByText(title).closest('tr')!.querySelectorAll('td')[col] as HTMLElement

describe('ViewHeader', () => {
  it('draws the view tabs Table, Board, Calendar, List and Map, each with its glyph, then a saved view without one (E-3)', () => {
    render(<ViewHeader {...header({ views: [...TASK_VIEWS, SAVED_VIEW] })} />)
    const tabs = within(screen.getByRole('tablist', { name: 'Views of Tasks' })).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Table', 'Board', 'Calendar', 'List', 'Map', 'My open tasks'])
    expect(tabs.slice(0, 5).every(t => t.querySelector('svg'))).toBe(true)
    expect(tabs[5]!.querySelector('svg')).toBeNull()
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('chooses a view from its tab', () => {
    const p = header()
    render(<ViewHeader {...p} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    expect(p.onView).toHaveBeenCalledWith('board')
  })

  it('reads a filter chip as "Status is not done", with a remove ×', () => {
    const p = header({ filters: [NOT_DONE, { field: 'project', op: 'is', value: 'Node kit' }] })
    const { container } = render(<ViewHeader {...p} />)
    expect([...container.querySelectorAll('.fchip-t')].map(c => c.textContent)).toEqual(['Status is not done', 'Project is Node kit'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Status is not done' }))
    expect(p.onFilters).toHaveBeenCalledWith([{ field: 'project', op: 'is', value: 'Node kit' }])
    // the chip is a --wash pill, its field mute
    expect(rule('.fchip')).toContain('background: var(--wash);')
    expect(rule('.fchip')).toContain('border-radius: var(--radius-chip);')
    expect(rule('.fchip-k')).toContain('color: var(--mute);')
  })

  it('"+ Filter" is dashed, and opens a form that adds a filter', () => {
    const p = header({ filters: [] })
    render(<ViewHeader {...p} />)
    const add = screen.getByRole('button', { name: 'Filter' })
    expect(add.className).toBe('fchip fchip-add')
    expect(add.querySelector('svg')).toBeTruthy()
    expect(rule('.fchip-add')).toContain('border-style: dashed;')
    expect(rule('.fchip-add')).toContain('border-color: var(--rule-strong);')
    fireEvent.click(add)
    expect(add.getAttribute('aria-expanded')).toBe('true')
    const form = screen.getByRole('form', { name: 'New filter' })
    fireEvent.change(within(form).getByLabelText('Field'), { target: { value: 'status' } })
    fireEvent.change(within(form).getByLabelText('Condition'), { target: { value: 'is-not' } })
    fireEvent.change(within(form).getByLabelText('Value'), { target: { value: 'Done ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add filter' }))
    expect(p.onFilters).toHaveBeenCalledWith([{ field: 'status', op: 'is-not', value: 'Done' }])
    expect(screen.queryByRole('form', { name: 'New filter' })).toBeNull()
    expect(document.activeElement).toBe(add)
  })

  it('compares by contains unless told otherwise, so a fragment finds rows', () => {
    const p = header({ filters: [] })
    render(<ViewHeader {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect((screen.getByLabelText('Condition') as HTMLSelectElement).value).toBe('contains')
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'pool' } })
    fireEvent.submit(screen.getByRole('form', { name: 'New filter' }))
    expect(p.onFilters).toHaveBeenCalledWith([{ field: 'title', op: 'contains', value: 'pool' }])
  })

  it('leaves the filter form on Esc, adding nothing', () => {
    const p = header({ filters: [] })
    render(<ViewHeader {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.keyDown(screen.getByLabelText('Value'), { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'New filter' })).toBeNull()
    expect(p.onFilters).not.toHaveBeenCalled()
  })

  it('has one primary, "New task"', () => {
    const p = header()
    render(<ViewHeader {...p} />)
    const primary = screen.getByRole('button', { name: 'New task' })
    expect(primary.className).toContain('primary')
    expect(document.querySelectorAll('.vhead .btn.primary')).toHaveLength(1)
    fireEvent.click(primary)
    expect(p.primary!.onClick).toHaveBeenCalled()
  })

  it('draws no primary while previewing (C-23)', () => {
    as({ as: 'public' }, <ViewHeader {...header()} />)
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Table' })).toBeTruthy()
  })

  it('sorts by a field from its menu', () => {
    const onSort = vi.fn()
    render(<ViewHeader {...header({ sort: { field: 'title', dir: 'asc' }, onSort })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Due' }))
    expect(onSort).toHaveBeenCalledWith({ field: 'due', dir: 'asc' })
  })

  it('draws where the collection was read from in its meta line (E-2)', () => {
    const { container } = render(<ViewHeader {...header({ from: { file: 'data/tasks.yaml', readAt: '2026-10-17T11:58:00Z' }, now: new Date('2026-10-17T12:00:00Z') })} />)
    expect(container.querySelector('.vhead-meta')!.textContent).toBe('from data/tasks.yaml · read 2 min ago')
  })

  it('draws no tabs for a collection seen one way only', () => {
    render(<ViewHeader {...header({ views: [{ id: 'list', label: 'List' }] })} />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})

describe('TableView', () => {
  it('has a 36px sticky head: 12/500 faint; the sorted column ink, with a chevron and aria-sort', () => {
    render(<TableView {...table()} />)
    const head = screen.getByRole('button', { name: 'Due' })
    expect(head.closest('th')!.hasAttribute('aria-sort')).toBe(false)
    fireEvent.click(head)
    const th = head.closest('th')!
    expect(th.getAttribute('aria-sort')).toBe('ascending')
    expect(th.className).toContain('tv-sorted')
    expect(th.querySelector('.tv-chev svg')).toBeTruthy()
    fireEvent.click(head)
    expect(th.getAttribute('aria-sort')).toBe('descending')
    expect(th.querySelector('.tv-chev')!.className).toBe('tv-chev tv-desc')
    fireEvent.click(head)
    expect(th.hasAttribute('aria-sort')).toBe(false)
    expect(rule('.tv-table th')).toContain('block-size: var(--h-thead);')
    expect(rule('.tv-table th')).toMatch(/font: var\(--fw-medium\) var\(--fs-label\)\/var\(--lh-ui\) var\(--sans\);[\s\S]*color: var\(--faint\);/)
    expect(rule('.tv-table thead th')).toContain('position: sticky;')
    expect(rule('.tv-table th.tv-sorted')).toContain('color: var(--ink);')
    expect(house).toMatch(/--h-thead: 36px;/)
  })

  it('sorts the rows by a column head: ascending, descending, then as given', () => {
    render(<TableView {...table({ rows: TASKS.slice(0, 3) })} />)
    const names = () => within(tasksTable()).getAllByRole('row').slice(1).map(r => r.querySelectorAll('td')[0]!.textContent)
    fireEvent.click(screen.getByRole('button', { name: 'Task' }))
    expect(names()).toEqual(['Collect signer confirmations', 'Draft the pool report for Q3', 'Import the Notion meeting notes'])
    fireEvent.click(screen.getByRole('button', { name: 'Task' }))
    expect(names()).toEqual(['Import the Notion meeting notes', 'Draft the pool report for Q3', 'Collect signer confirmations'])
  })

  it('has 40px rows, and numbers and dates in Mono, end-aligned', () => {
    render(<TableView {...table()} />)
    const due = cellOf('Draft the pool report for Q3', 3)
    expect(due.textContent).toBe('18 Oct')
    expect(due.className).toBe('n r')
    expect(rule('.tv-table td')).toContain('block-size: var(--h-row-1);')
    expect(rule('.tv-table .n')).toContain('font-family: var(--mono);')
    expect(rule('.tv-table .r')).toContain('text-align: end;')
  })

  it('draws group rows on --sunken, each with its name and count', () => {
    render(<TableView {...table({ groupBy: t => t.status })} />)
    const groups = within(tasksTable()).getAllByRole('rowheader').map(h => [h.firstChild!.textContent, h.querySelector('.tv-grp-c')!.textContent])
    expect(groups).toEqual([['Doing', '3'], ['To do', '2'], ['Done', '2']])
    expect(rule('.tv-grp th')).toContain('background: var(--sunken);')
    expect(rule('.tv-grp th')).toContain('block-size: var(--h-trow-grp);')
  })

  it('draws a checkbox column that shows on hover, and for every row once one is picked', () => {
    const { container } = render(<TableView {...table({ selectable: true })} />)
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' })
    expect(boxes).toHaveLength(TASKS.length)
    expect(container.querySelector('.tv')!.hasAttribute('data-picking')).toBe(false)
    fireEvent.click(boxes[1]!)
    expect(container.querySelector('.tv')!.hasAttribute('data-picking')).toBe(true)
    expect(boxes[1]!.closest('tr')!.getAttribute('aria-selected')).toBe('true')
    expect(boxes[1]!.closest('tr')!.className).toBe('tv-sel')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getAllByRole('checkbox', { name: 'Select row' }).every(b => (b as HTMLInputElement).checked)).toBe(true)
    // hidden, where a pointer can hover, until its row is hovered, it is focused or checked, or a row is picked
    expect(css).toContain('@media (hover: hover) { .tv:not([data-picking]) .tv-table tr:not(:hover) .tv-check:not(:checked):not(:focus-visible) { opacity: 0; } }')
    expect(rule('.tv-check')).not.toContain('opacity: 0')
    // a selected row: the soft fill and the moss bar
    expect(rule('.tv-table tr.tv-sel td')).toContain('background: var(--accent-soft);')
  })

  it('edits a cell in place: Enter edits, Esc cancels, Enter stages', () => {
    const onEdit = vi.fn()
    render(<TableView {...table({ onEdit })} />)
    const cell = cellOf('Draft the pool report for Q3', 0)
    fireEvent.keyDown(cell, { key: 'Enter' })
    const input = within(cell).getByRole('textbox', { name: 'Task' }) as HTMLInputElement
    expect(input.value).toBe('Draft the pool report for Q3')
    fireEvent.change(input, { target: { value: 'Draft the pool report' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(within(cell).queryByRole('textbox')).toBeNull()
    expect(onEdit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(cell)
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.change(within(cell).getByRole('textbox'), { target: { value: 'Draft the pool report' } })
    fireEvent.keyDown(within(cell).getByRole('textbox'), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0]!.slice(1)).toEqual(['title', 'Draft the pool report'])
    expect(onEdit.mock.calls[0]![0].id).toBe('task-1')
  })

  it('shows a cell being written, "Saving", or staged, "Staged", over a moss underline', () => {
    const staged = (t: FixtureTask, col: string) => (col !== 'due' ? null : t.id === 'task-1' ? 'saving' : t.id === 'task-2' ? 'staged' : null)
    render(<TableView {...table({ staged })} />)
    const saving = cellOf('Draft the pool report for Q3', 3)
    expect(saving.className).toContain('tv-staged')
    expect(within(saving).getByText('Saving').closest('.smark')!.className).toBe('smark smark-staged')
    expect(within(cellOf('Collect signer confirmations', 3)).getByText('Staged')).toBeTruthy()
    expect(cellOf('Import the Notion meeting notes', 3).className).not.toContain('tv-staged')
    expect(rule('.tv-table td.tv-staged::after')).toMatch(/inset-block-end: 0; block-size: var\(--rule-w-heavy\); background: var\(--accent\);/)
  })

  it('draws an overdue date in clay with its word, not colour alone', () => {
    render(<TableView {...table()} />)
    const late = cellOf('Write the onboarding page', 3)
    expect(late.className).toContain('tv-late')
    expect(late.textContent).toBe('15 Oct overdue')
    // a done task due on the same day is not overdue
    expect(cellOf('Remove the old signer', 3).className).not.toContain('tv-late')
    expect(rule('.tv-table td.tv-late')).toContain('color: var(--attn);')
  })

  it('filtered to nothing is not empty: "No tasks match these filters." and Clear filters, not "No tasks yet." (Review Focus 2)', () => {
    const onClearFilters = vi.fn()
    const { unmount } = render(<TableView {...table({ rows: [], filtered: true, onClearFilters })} />)
    expect(screen.getByText('No tasks match these filters.')).toBeTruthy()
    expect(screen.queryByText('No tasks yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalled()
    unmount()
    render(<TableView {...table({ rows: [] })} />)
    expect(screen.getByText('No tasks yet.')).toBeTruthy()
    expect(screen.getByText('Tasks link to projects, meetings and proposals.')).toBeTruthy()
    expect(screen.queryByText('No tasks match these filters.')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('draws no row the viewer may not see, and counts none: with none left it is empty, not filtered-empty (E-6)', () => {
    const rows = TASKS.map((t, i) => ({ ...t, facts: { visibility: i < 2 ? 'public' : 'members' } }))
    const { unmount } = as({ as: 'public' }, <TableView {...table({ rows, groupBy: t => t.status })} />)
    expect(within(tasksTable()).getAllByRole('row').filter(r => r.querySelector('td'))).toHaveLength(2)
    expect(within(tasksTable()).getByRole('rowheader').textContent).toBe('Doing2')
    unmount()
    const hidden = TASKS.map(t => ({ ...t, facts: { visibility: 'hat:treasury' } }))
    as({ as: 'members' }, <TableView {...table({ rows: hidden, filtered: true })} />)
    expect(screen.getByText('No tasks yet.')).toBeTruthy()
    expect(screen.queryByText('No tasks match these filters.')).toBeNull()
  })

  it('adds a Visibility column only when its rows hold more than one level (E-4)', () => {
    const { unmount } = render(<TableView {...table()} />)
    expect(screen.queryByRole('columnheader', { name: 'Visibility' })).toBeNull()
    unmount()
    const mixed = TASKS.map((t, i) => ({ ...t, facts: { visibility: i === 0 ? 'public' : 'members' } }))
    render(<TableView {...table({ rows: mixed })} />)
    expect(screen.getByRole('columnheader', { name: 'Visibility' })).toBeTruthy()
    expect(cellOf('Draft the pool report for Q3', 5).textContent).toBe('Public')
    expect(cellOf('Collect signer confirmations', 5).textContent).toBe('Members')
  })

  it('first loads as skeleton rows; a failed read is a note with Try again', () => {
    const { unmount } = render(<TableView {...table({ loading: 3 })} />)
    expect(screen.getByRole('region', { name: 'Loading Tasks' }).querySelectorAll('.skel-row-row-1')).toHaveLength(3)
    unmount()
    const onRetry = vi.fn()
    render(<TableView {...table({ error: 'the server didn’t answer.', onRetry })} />)
    const alert = errorNote()
    expect(alert.textContent).toBe('Couldn’t load Tasks: the server didn’t answer. Try again')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('makes its cells a grid: one tab stop, arrows move, Home and End go to the ends, Enter edits', () => {
    const onEdit = vi.fn()
    render(<TableView {...table({ rows: TASKS.slice(0, 3), onEdit })} />)
    expect(tasksGrid().tagName).toBe('TABLE')
    expect(tasksGrid().hasAttribute('aria-readonly')).toBe(false)
    const tabbable = () => [...tasksGrid().querySelectorAll<HTMLElement>('[data-cell]')].filter(c => c.tabIndex === 0)
    expect(tabbable()).toEqual([cellOf('Draft the pool report for Q3', 0)])
    const first = cellOf('Draft the pool report for Q3', 0)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cellOf('Draft the pool report for Q3', 1))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cellOf('Collect signer confirmations', 1))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(cellOf('Collect signer confirmations', 4))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(cellOf('Collect signer confirmations', 0))
    expect(tabbable()).toEqual([document.activeElement])
    const title = document.activeElement as HTMLElement
    fireEvent.keyDown(title, { key: 'Enter' })
    expect((within(title).getByRole('textbox', { name: 'Task' }) as HTMLInputElement).value).toBe('Collect signer confirmations')
  })

  it('selects a row as the arrows reach it, and opens it on Enter in a cell that is not edited', () => {
    const onSelect = vi.fn(), onOpen = vi.fn()
    render(<TableView {...table({ rows: TASKS.slice(0, 3), onSelect, onOpen, onEdit: vi.fn(), selected: 'task-2' })} />)
    expect(cellOf('Collect signer confirmations', 0).closest('tr')!.getAttribute('aria-selected')).toBe('true')
    const cell = cellOf('Draft the pool report for Q3', 1)
    cell.focus()
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('task-2')
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('task-2')
    fireEvent.click(screen.getByText('Import the Notion meeting notes'))
    expect(onSelect).toHaveBeenLastCalledWith('task-3')
  })

  it('edits nothing while previewing (C-23): a read-only grid', () => {
    const onEdit = vi.fn()
    as({ as: 'members' }, <TableView {...table({ onEdit })} />)
    expect(tasksGrid().getAttribute('aria-readonly')).toBe('true')
    const cell = cellOf('Draft the pool report for Q3', 0)
    expect(cell.hasAttribute('data-editable')).toBe(false)
    fireEvent.keyDown(cell, { key: 'Enter' })
    expect(within(cell).queryByRole('textbox')).toBeNull()
  })

  // C1 fix (I-1): a table with nothing to edit, pick or select is a plain table — no grid, no cell stops, links in the
  // Tab order.
  it('is a plain table when nothing in it can be edited, picked or selected, its links in the Tab order', () => {
    const linked = [{ ...taskColumns()[0]!, cell: (t: FixtureTask) => <a href={`/t/${t.id}`}>{t.title}</a> }, ...taskColumns().slice(1)]
    render(<TableView {...table({ rows: TASKS.slice(0, 2), columns: linked })} />)
    expect(screen.queryByRole('grid')).toBeNull()
    expect(tasksTable().querySelector('[data-cell]')).toBeNull()
    expect([...tasksTable().querySelectorAll('td')].some(td => td.hasAttribute('tabindex'))).toBe(false)
    expect(screen.getByRole('link', { name: 'Collect signer confirmations' }).hasAttribute('tabindex')).toBe(false)
  })

  // Ruling (fix round 1 addendum): rows that open by a click open by the keyboard (2.1.1), so onSelect alone is a grid.
  it('is a read-only grid when its rows are only selected: a click or the arrows select, Enter opens', () => {
    const onSelect = vi.fn(), onOpen = vi.fn()
    render(<TableView {...table({ rows: TASKS.slice(0, 2), onSelect, onOpen })} />)
    expect(tasksGrid().getAttribute('aria-readonly')).toBe('true')
    fireEvent.click(screen.getByText('18 Oct'))
    expect(onSelect).toHaveBeenLastCalledWith('task-1')
    const first = cellOf('Draft the pool report for Q3', 0)
    expect(first.tabIndex).toBe(0)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('task-2')
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('task-2')
    expect(within(cellOf('Collect signer confirmations', 0)).queryByRole('textbox')).toBeNull()
  })

  it('is a grid with only the checkbox column to act on', () => {
    render(<TableView {...table({ rows: TASKS.slice(0, 2), selectable: true })} />)
    expect(tasksGrid().getAttribute('aria-readonly')).toBe('true')
  })

  // Ruling (spec "Enter stages"): leaving the cell cancels the edit; only Enter stages.
  it('cancels an edit when focus leaves the cell, staging nothing and leaving focus where it went', () => {
    const onEdit = vi.fn()
    render(<><TableView {...table({ rows: TASKS.slice(0, 2), onEdit })} /><button type="button">Elsewhere</button></>)
    const cell = cellOf('Draft the pool report for Q3', 0)
    fireEvent.keyDown(cell, { key: 'Enter' })
    const input = within(cell).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Changed and left' } })
    const away = screen.getByRole('button', { name: 'Elsewhere' })
    act(() => away.focus())
    expect(onEdit).not.toHaveBeenCalled()
    expect(within(cell).queryByRole('textbox')).toBeNull()
    expect(cell.textContent).toBe('Draft the pool report for Q3')
    expect(document.activeElement).toBe(away)
  })

  // C1 fix (I-2): the narrow card form hides some cells (the checkbox, an empty fact); they are no keyboard stop. jsdom
  // has no layout, so a cell's checkVisibility is stubbed as the card form would answer it.
  describe('under the card form, hidden cells are no stop', () => {
    const hide = (pred: (el: HTMLElement) => boolean) => {
      const proto = HTMLElement.prototype
      const had = Object.getOwnPropertyDescriptor(proto, 'checkVisibility')
      Object.defineProperty(proto, 'checkVisibility', { configurable: true, writable: true, value: function (this: HTMLElement) { return !pred(this) } })
      return () => { if (had) Object.defineProperty(proto, 'checkVisibility', had); else Reflect.deleteProperty(proto, 'checkVisibility') }
    }
    const isCheck = (el: HTMLElement) => el.classList.contains('tv-check')
    const isOwner = (el: HTMLElement) => el.closest('td')?.dataset.c === '2' // the owner fact, as if empty

    it('starts on the first drawn cell, not the hidden checkbox, and Home lands there', () => {
      const restore = hide(isCheck)
      try {
        render(<TableView {...table({ rows: TASKS.slice(0, 2), selectable: true, onEdit: vi.fn() })} />)
        const title = cellOf('Draft the pool report for Q3', 1)
        const stops = [...tasksGrid().querySelectorAll<HTMLElement>('[data-cell]')].filter(c => c.tabIndex === 0)
        expect(stops).toEqual([title])
        title.focus()
        fireEvent.keyDown(title, { key: 'ArrowRight' })
        fireEvent.keyDown(document.activeElement!, { key: 'Home' })
        expect(document.activeElement).toBe(title)
        fireEvent.keyDown(title, { key: 'ArrowLeft' })
        expect(document.activeElement).toBe(title)
        expect(stops[0]!.tabIndex).toBe(0)
      } finally { restore() }
    })

    it('steps over a hidden cell, along a row and between rows', () => {
      const restore = hide(isOwner)
      try {
        render(<TableView {...table({ rows: TASKS.slice(0, 2), onEdit: vi.fn() })} />)
        const project = cellOf('Draft the pool report for Q3', 1)
        project.focus()
        fireEvent.keyDown(project, { key: 'ArrowRight' })
        expect(document.activeElement).toBe(cellOf('Draft the pool report for Q3', 3))
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
        expect(document.activeElement).toBe(project)
        // from the due date of row one, down and left: never onto the hidden owner of row two
        fireEvent.keyDown(project, { key: 'ArrowRight' })
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
        expect(document.activeElement).toBe(cellOf('Collect signer confirmations', 3))
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
        expect(document.activeElement).toBe(cellOf('Collect signer confirmations', 1))
        expect([...tasksGrid().querySelectorAll<HTMLElement>('[data-cell]')].filter(c => c.tabIndex === 0)).toEqual([document.activeElement])
      } finally { restore() }
    })
  })

  it('renders hostile text from data as text', () => {
    const { container } = render(<TableView {...table({ rows: [{ ...TASKS[0]!, title: '<img src=x onerror="alert(1)">' }] })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy()
  })

  it('is cards under 600px of its own width — title, the "project · owner · due" line, the status — never a sideways scroll (E-8)', () => {
    render(<TableView {...table()} />)
    const row = screen.getByText('Draft the pool report for Q3').closest('tr')!
    expect([...row.querySelectorAll('td')].map(td => td.dataset.card)).toEqual(['title', 'meta', 'meta', 'meta', 'status'])
    expect(rule('.tv')).toContain('container: tview / inline-size;')
    const narrow = block('@container tview (max-width: 599px) {')
    expect(narrow).toMatch(/\.tv-table thead, \.tv-table \.tv-cb \{ display: none; \}/)
    expect(narrow).toMatch(/\.tv-table tr \{ display: flex; flex-wrap: wrap;/)
    expect(narrow).toMatch(/\.tv-table td\[data-card="title"\] \{ order: 1;/)
    expect(narrow).toMatch(/\.tv-table td\[data-card="status"\] \{ order: 2;/)
    expect(narrow).toMatch(/\.tv-table td\[data-card="meta"\] \{ order: 4;/)
    expect(narrow).toContain('td[data-card="meta"]:not(:empty) ~ td[data-card="meta"]:not(:empty)::before { content: "· ";')
    expect(css).not.toMatch(/overflow-x: (auto|scroll)/)
    expect(css).not.toMatch(/@media \((max|min)-width/)
  })
})

describe('ListView', () => {
  const row = (t: FixtureTask) => <DataRow key={t.id} kind="task" title={t.title} second={t.project} marks={[]} item={t} />

  it('draws its rows as data rows in a list', () => {
    render(<ListView label="Tasks" rows={TASKS.slice(0, 3)} row={row} empty={EMPTY} />)
    expect(within(screen.getByRole('list', { name: 'Tasks' })).getAllByRole('listitem')).toHaveLength(3)
  })

  it('has the views’ states: loading, error, empty, filtered-empty, and nothing the viewer may not see', () => {
    const { unmount } = render(<ListView label="Tasks" rows={[]} row={row} empty={EMPTY} loading={2} />)
    expect(screen.getByRole('region', { name: 'Loading Tasks' })).toBeTruthy()
    unmount()
    const err = render(<ListView label="Tasks" rows={[]} row={row} empty={EMPTY} error="down" onRetry={() => {}} />)
    expect(errorNote().textContent).toBe('Couldn’t load Tasks: down Try again')
    err.unmount()
    const filtered = render(<ListView label="Tasks" rows={[]} row={row} empty={EMPTY} filtered onClearFilters={() => {}} />)
    expect(screen.getByText('No tasks match these filters.')).toBeTruthy()
    filtered.unmount()
    as({ as: 'public' }, <ListView label="Tasks" rows={[...TASKS]} row={row} empty={EMPTY} filtered />)
    expect(screen.getByText('No tasks yet.')).toBeTruthy()
  })
})
