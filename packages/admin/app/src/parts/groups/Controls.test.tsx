// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderAt } from '../../test/render.tsx'
import Controls from './Controls.tsx'

describe('/parts/controls', () => {
  it('draws every button variant and state, as the gallery does', () => {
    renderAt(<Controls />, '/parts/controls')
    const primary = screen.getByRole('region', { name: 'Button · primary' })
    for (const state of ['default', 'hover', 'focus', 'pressed', 'busy', 'disabled']) expect(primary.textContent).toContain(state)
    expect(within(primary).getByRole('button', { name: 'Proposing…' }).getAttribute('aria-busy')).toBe('true')
    const others = screen.getByRole('region', { name: 'Button · secondary, ghost, icon' })
    expect(within(others).getByRole('button', { name: 'Copy' }).classList.contains('icon')).toBe(true)
    expect(within(others).getByRole('button', { name: 'Withdraw' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('draws every input state: plain, focus with a hint, invalid, staged; then the stepper and the choices', () => {
    renderAt(<Controls />, '/parts/controls')
    const input = screen.getByRole('region', { name: 'Input' })
    expect(within(input).getByLabelText('Amount').getAttribute('aria-invalid')).toBe('true')
    expect(input.querySelector('s.was')!.textContent).toBe('Return the Gardens pools')
    const more = screen.getByRole('region', { name: 'Input · stepper, choices, select' })
    expect(within(more).getByRole('group', { name: 'Threshold' }).textContent).toContain('of 8')
    expect(within(more).getAllByRole('radio').length).toBeGreaterThan(1)
    expect(within(more).getByRole('checkbox')).toBeTruthy()
  })

  it('draws segmented, tabs with counts and an overflowing bar, and an open menu with radio and an unavailable item', () => {
    renderAt(<Controls />, '/parts/controls')
    const card = screen.getByRole('region', { name: 'Segmented · tabs · menu' })
    expect(within(card).getByRole('group', { name: 'View' })).toBeTruthy()
    expect(within(card).getByRole('tab', { name: 'Decided 14' })).toBeTruthy()
    const menu = within(card).getByRole('menu', { name: 'Visibility' })
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3)
    expect(within(menu).getByRole('menuitem', { name: /Hat: Treasurer/ }).getAttribute('aria-disabled')).toBe('true')
    const overflow = screen.getByRole('region', { name: 'Tabs · overflow, small buttons' })
    expect(within(overflow).getAllByRole('tab').length).toBeGreaterThan(6)
  })

  it('draws every note state, the empty block, a tooltip shown and kbd', () => {
    renderAt(<Controls />, '/parts/controls')
    const notes = screen.getByRole('region', { name: 'Note · the one line for every state' })
    for (const cls of ['note-empty', 'note-loading', 'note-error', 'note-unavailable', 'note-notYet']) expect(notes.querySelector(`.${cls}`), cls).not.toBeNull()
    const misc = screen.getByRole('region', { name: 'Empty block · tooltip · kbd' })
    expect(misc.querySelector('.note-block')).not.toBeNull()
    expect(within(misc).getByRole('tooltip').hidden).toBe(false)
    expect(misc.querySelectorAll('kbd').length).toBe(6)
  })
})
