// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Rows, type Column } from './Rows.tsx'

interface Thing { id: string; name: string; n: number }
const things: Thing[] = [{ id: 'b', name: 'Beta', n: 2 }, { id: 'a', name: 'Alpha', n: 10 }, { id: 'c', name: 'Gamma', n: 1 }]
const columns: Column<Thing>[] = [
  { key: 'name', label: 'name', cell: t => t.name, sort: t => t.name },
  { key: 'n', label: 'count', mono: true, right: true, cell: t => String(t.n), sort: t => t.n },
]
const names = () => screen.getAllByRole('row').slice(1).map(tr => tr.querySelector('td')!.textContent)

describe('Rows', () => {
  it('is a labelled table with column heads and mono cells', () => {
    render(<Rows label="Things" rows={things} columns={columns} rowKey={t => t.id} />)
    const table = screen.getByRole('table', { name: 'Things' })
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(2)
    expect(table.querySelector('tbody td.n.r')!.textContent).toBe('2')
  })

  it('sorts by a column head: ascending, descending, then as given', () => {
    render(<Rows label="Things" rows={things} columns={columns} rowKey={t => t.id} />)
    const head = screen.getByRole('button', { name: 'count' })
    fireEvent.click(head)
    expect(names()).toEqual(['Gamma', 'Beta', 'Alpha'])
    expect(head.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(head)
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(head.closest('th')!.getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(head)
    expect(names()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  // C1 (ledger; fix I-1 and its addendum): Rows is drawn as the table view. With rows to select it is a read-only grid
  // whose cells are the stops — the table itself is not; ↓ ↑ move between rows' cells and select the row reached, and
  // Enter opens the focused cell's row. Without onSelect it is a plain table.
  it('moves the selection with the arrow keys, opens on Enter, and selects on a click', () => {
    const onSelect = vi.fn(), onOpen = vi.fn()
    const { rerender } = render(<Rows label="Things" rows={things} columns={columns} rowKey={t => t.id} selected={null} onSelect={onSelect} onOpen={onOpen} />)
    const grid = screen.getByRole('grid', { name: 'Things' })
    expect(grid.hasAttribute('tabindex')).toBe(false)
    const first = screen.getByText('Beta').closest('td')!
    expect(first.tabIndex).toBe(0)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
    expect(document.activeElement).toBe(screen.getByText('Alpha').closest('td'))
    rerender(<Rows label="Things" rows={things} columns={columns} rowKey={t => t.id} selected="b" onSelect={onSelect} onOpen={onOpen} />)
    expect(screen.getAllByRole('row')[1]!.getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('row')[1]!.className).toBe('tv-sel')
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByText('Gamma'))
    expect(onSelect).toHaveBeenLastCalledWith('c')
  })

  it('is a plain table without rows to select, its links in the Tab order', () => {
    const cols: Column<Thing>[] = [{ key: 'name', label: 'name', cell: t => <a href={`#${t.id}`}>{t.name}</a> }, columns[1]!]
    render(<Rows label="Things" rows={things} columns={cols} rowKey={t => t.id} />)
    expect(screen.getByRole('table', { name: 'Things' }).querySelector('[data-cell]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Beta' }).hasAttribute('tabindex')).toBe(false)
  })

  it('leaves arrow keys alone while typing in a field', () => {
    const onSelect = vi.fn()
    const cols: Column<Thing>[] = [{ key: 'name', label: 'name', cell: t => <input aria-label={t.name} defaultValue={t.name} /> }]
    render(<Rows label="Things" rows={things} columns={cols} rowKey={t => t.id} selected={null} onSelect={onSelect} />)
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    screen.getByLabelText('Beta').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows its empty line instead of an empty table', () => {
    render(<Rows label="Things" rows={[]} columns={columns} rowKey={t => t.id} empty={<p>Nothing matches.</p>} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Nothing matches.')).toBeTruthy()
  })

  it('renders hostile text from data as text (Review Focus 3)', () => {
    const hostile = [{ id: 'x', name: '<img src=x onerror="alert(1)">', n: 0 }]
    const { container } = render(<Rows label="Things" rows={hostile} columns={columns} rowKey={t => t.id} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy()
  })
})
