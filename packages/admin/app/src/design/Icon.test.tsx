// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, kindIcon, type IconName } from './Icon.tsx'

const css = readFileSync('app/src/design/css/controls.css', 'utf8') // vitest runs from packages/admin
const svgOf = (c: HTMLElement) => c.querySelector('svg') as SVGSVGElement

describe('Icon', () => {
  it('draws an outline glyph: aria-hidden, not focusable, class i i-md, no inline stroke width', () => {
    for (const name of ['home', 'hat'] as IconName[]) {
      const svg = svgOf(render(<Icon name={name} />).container)
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('focusable')).toBe('false')
      expect(svg.getAttribute('class')).toMatch(/(^| )i i-md( |$)/)
      expect(svg.getAttribute('style')).toBeNull()
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.getAttribute('stroke-width')).not.toBe('1.5px')
    }
    expect(css).toMatch(/\.i\s*\{[^}]*stroke-width:\s*var\(--icon-stroke\)/)
  })

  it('a labelled icon is an img with that name', () => {
    const { getByRole } = render(<Icon name="lock" label="Members only" />)
    expect(getByRole('img', { name: 'Members only' })).toBeTruthy()
  })

  it('sizes map to classes', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      expect(svgOf(render(<Icon name="plus" size={size} />).container).getAttribute('class')).toContain(`i-${size}`)
      expect(css).toContain(`.i-${size} {`)
    }
  })

  it('the house glyphs draw their own paths', () => {
    for (const name of ['hat', 'safe', 'pool', 'seal'] as IconName[]) {
      expect(svgOf(render(<Icon name={name} />).container).querySelectorAll('path').length).toBeGreaterThan(0)
    }
    expect(svgOf(render(<Icon name="seal" />).container).getAttribute('class')).toContain('i-solid')
  })

  it('kindIcon follows §3.9', () => {
    const want: Record<string, IconName> = {
      safe: 'safe', 'hats-tree': 'hat', hat: 'hat', 'snapshot-space': 'ballot', 'gardens-community': 'sprout',
      'gardens-pool': 'pool', link: 'link', wallet: 'wallet', proposal: 'proposal', page: 'file',
      meeting: 'people', task: 'check', project: 'file',
    }
    for (const [k, v] of Object.entries(want)) expect(kindIcon(k), k).toBe(v)
  })

  it('only arrows and chevrons mirror', () => {
    for (const n of ['arrow-right', 'chevron-left', 'chevron-right'] as IconName[]) {
      expect(svgOf(render(<Icon name={n} />).container).getAttribute('class')).toContain('i-mirror')
    }
    expect(svgOf(render(<Icon name="external" />).container).getAttribute('class')).not.toContain('i-mirror')
    expect(css).toMatch(/\[dir=rtl\] \.i-mirror\s*\{\s*scale:\s*-1 1/)
  })
})
