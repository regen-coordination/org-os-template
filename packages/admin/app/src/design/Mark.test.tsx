// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Mark } from './Mark.tsx'

describe('Mark', () => {
  it.each(['warn', 'alert'] as const)('draws the %s shape before the text, hidden from a screen reader', level => {
    const { container } = render(<Mark level={level}>deadline in 3 days</Mark>)
    expect(container.querySelector(`.mark.${level} > .mark-shape`)?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('deadline in 3 days').className).toBe('mark-text')
  })

  it('tells a screen reader which level it is', () => {
    const { container } = render(<Mark level="alert">v2 waits for your go</Mark>)
    expect(container.textContent).toBe('Needs you: v2 waits for your go')
  })

  it('keeps its title', () => {
    const { container } = render(<Mark level="warn" title="the whole sentence">the whole…</Mark>)
    expect(container.firstElementChild!.getAttribute('title')).toBe('the whole sentence')
  })
})
