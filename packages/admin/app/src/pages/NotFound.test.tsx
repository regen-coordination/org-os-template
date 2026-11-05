// @vitest-environment jsdom
// C9 (§14.1, E-73): the not-found page is a note block — "No page at /x." — with the ⌘K hint.
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import NotFound from './NotFound.tsx'
import { renderAt } from '../test/render.tsx'

describe('NotFound', () => {
  it('is a note block naming the address, its title the page’s one heading, with the ⌘K hint', () => {
    renderAt(<NotFound />, '/b/gone')
    const h = screen.getByRole('heading', { level: 1, name: 'No page at /b/gone.' })
    const block = h.closest('.note-block')!
    expect(h.className).toBe('note-block-t')
    expect(block.querySelector('.note-block-l')!.textContent).toBe('⌘K finds every page, record and command.')
    expect(block.querySelector('kbd')!.textContent).toBe('⌘K')
  })
})
