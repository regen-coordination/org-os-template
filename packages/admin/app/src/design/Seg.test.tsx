// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Seg } from './Seg.tsx'

describe('Seg', () => {
  it('is a labelled group of buttons, the active one pressed', () => {
    const onChange = vi.fn()
    render(<Seg label="View" value="list" onChange={onChange} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />)
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    expect(onChange).toHaveBeenCalledWith('map')
  })
})
