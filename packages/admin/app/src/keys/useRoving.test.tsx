// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRoving } from './useRoving.ts'

/** Three rows in a list, each a roving item; the third holds a field. */
function Rows({ onOpen, onPreview, clicked = () => {} }: { onOpen?(i: number): void; onPreview?(i: number): void; clicked?(): void }) {
  const list = useRef<HTMLUListElement>(null)
  useRoving(list, { onOpen, onPreview })
  return (
    <>
      <button type="button">Before</button>
      <ul ref={list} aria-label="Rows">
        <li data-row="">Treasury</li>
        <li data-row="">Roles</li>
        <li data-row="">Snapshot<input aria-label="Note" /><button type="button" onClick={() => clicked()}>Pin</button><a href="#x">Source</a></li>
      </ul>
    </>
  )
}
const row = (name: string) => screen.getByText(name, { selector: 'li' })
const stops = () => screen.getAllByRole('listitem').filter(li => li.tabIndex === 0)

describe('useRoving (§5.8: every list is one tab stop, arrows inside)', () => {
  it('is one tab stop: the first row, until another is reached', () => {
    render(<Rows />)
    expect(stops()).toEqual([row('Treasury')])
    expect(row('Roles').tabIndex).toBe(-1)
    row('Roles').focus()
    expect(stops()).toEqual([row('Roles')])
  })

  it('↓ and j move to the next row, ↑ and k to the previous; the ends hold', () => {
    render(<Rows />)
    row('Treasury').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row('Roles'))
    fireEvent.keyDown(document.activeElement!, { key: 'j' })
    expect(document.activeElement).toBe(row('Snapshot'))
    fireEvent.keyDown(document.activeElement!, { key: 'j' })
    expect(document.activeElement).toBe(row('Snapshot'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(row('Roles'))
    fireEvent.keyDown(document.activeElement!, { key: 'k' })
    fireEvent.keyDown(document.activeElement!, { key: 'k' })
    expect(document.activeElement).toBe(row('Treasury'))
    expect(stops()).toEqual([row('Treasury')])
  })

  it('Enter opens the row; Space previews it', () => {
    const onOpen = vi.fn()
    const onPreview = vi.fn()
    render(<Rows onOpen={onOpen} onPreview={onPreview} />)
    row('Roles').focus()
    fireEvent.keyDown(row('Roles'), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(1)
    expect(fireEvent.keyDown(row('Roles'), { key: ' ' })).toBe(false) // the page does not scroll
    expect(onPreview).toHaveBeenCalledWith(1)
  })

  it('Enter and Space on a button or a link inside a row are that control’s, not the row’s', () => {
    const onOpen = vi.fn()
    const onPreview = vi.fn()
    render(<Rows onOpen={onOpen} onPreview={onPreview} />)
    for (const control of [screen.getByRole('button', { name: 'Pin' }), screen.getByRole('link', { name: 'Source' })]) {
      control.focus()
      expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(true) // not prevented: the control's own action runs
      expect(fireEvent.keyDown(control, { key: ' ' })).toBe(true)
    }
    expect(onOpen).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    // the row itself still opens and previews
    fireEvent.keyDown(row('Snapshot'), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('keys typed in a field inside a row stay in the field', () => {
    const onPreview = vi.fn()
    render(<Rows onPreview={onPreview} />)
    const field = screen.getByLabelText('Note')
    field.focus()
    fireEvent.keyDown(field, { key: 'k' })
    fireEvent.keyDown(field, { key: ' ' })
    expect(document.activeElement).toBe(field)
    expect(onPreview).not.toHaveBeenCalled()
  })
})
