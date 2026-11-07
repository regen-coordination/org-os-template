// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Scroll } from './Scroll.tsx'

const width = (scroll: number, client: number) => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client)
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Scroll', () => {
  it('is a plain block while its content fits: no landmark, no tab stop', () => {
    width(300, 300)
    const { container } = render(<Scroll label="Things"><p>fits</p></Scroll>)
    const box = container.firstElementChild!
    expect(box.className).toBe('scroll')
    expect(box.hasAttribute('tabindex')).toBe(false)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('is a labelled, focusable region once its content is wider than the screen', () => {
    width(620, 390)
    render(<Scroll label="Things"><p>wide</p></Scroll>)
    const region = screen.getByRole('region', { name: 'Things, scrolls sideways' })
    expect(region.getAttribute('tabindex')).toBe('0')
  })
})
