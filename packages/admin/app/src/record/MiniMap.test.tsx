// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { MiniMap, RADIAL } from './MiniMap.tsx'
import { renderAt } from '../test/render.tsx'
import { resource } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

// B9 replaces 0.6's two-column layout cases ("puts kinds before the record on the left…", "splits the neighbours
// evenly…", "draws the record and its neighbours, one step out…") with §8.6's radial template, and keeps "says so
// when the record touches nothing" (ledger).
const centre = resource({ id: 'project:br', name: 'Local node kit' })
const near = [
  resource({ id: 'partner:bcn', kind: 'partner', name: 'Partner node' }),
  resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A' }),
  resource({ id: 'funding:x', kind: 'funding', name: 'Fund X', attention: { level: 'alert', text: 'deadline' } }),
]
const seven = Array.from({ length: 7 }, (_, i) => resource({ id: `project:n${i}`, kind: 'project', name: `Node ${i}` }))
const css = readFileSync(join(process.cwd(), 'app/src/design/css/map.css'), 'utf8') // vitest runs from packages/admin
const house = readFileSync(join(process.cwd(), 'app/src/design/skins/house.css'), 'utf8')
const bare = readFileSync(join(process.cwd(), 'app/src/design/skins/bare.css'), 'utf8')

describe('MiniMap (§8.6)', () => {
  it('draws the record outlined in ink, and up to six neighbours placed in RADIAL order', () => {
    expect(RADIAL).toEqual(['above-start', 'above-end', 'below-start', 'below-end', 'start', 'end'])
    const six = seven.slice(0, 6)
    const { container } = renderAt(<MiniMap centre={centre} neighbours={six} />, '/r/project/br')
    const me = container.querySelector('.mini-n.is-me')!
    expect(me.textContent).toBe('Local node kit')
    expect(me.getAttribute('aria-current')).toBe('page')
    const placed = [...container.querySelectorAll('.mini-n:not(.is-me)')]
    expect(placed.map(n => n.getAttribute('data-at'))).toEqual([...RADIAL])
    expect(placed.map(n => n.textContent)).toEqual(six.map(n => n.name))
    // one straight line from the record to each neighbour, decoration
    expect(container.querySelector('.mini > svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('.mini > svg line')).toHaveLength(6)
    expect(css).toMatch(/\.mini-n\.is-me \{[^}]*border-color: var\(--ink\);[^}]*font-weight: var\(--fw-strong\);/)
  })

  it('lays the neighbours out in kind order, then by name, and lights the ones that need attention', () => {
    const { container } = renderAt(<MiniMap centre={centre} neighbours={near} />)
    expect([...container.querySelectorAll('.mini-n:not(.is-me)')].map(n => n.textContent)).toEqual(['Steward A', 'Fund X', 'Partner node'])
    expect(container.querySelector('.mini-n.is-attn')!.textContent).toBe('Fund X')
    expect(container.querySelector('.mini-n.is-attn .mini-dot')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('each neighbour is a link to its record; the group says what the record touches', () => {
    const { loc } = renderAt(<MiniMap centre={centre} neighbours={near} />, '/r/project/br')
    expect(screen.getByRole('group', { name: 'What Local node kit touches' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /Partner node/ }))
    expect(loc.history.at(-1)).toBe('/r/partner/bcn')
  })

  it('a seventh neighbour gives "+1 on the map"', () => {
    renderAt(<MiniMap centre={centre} neighbours={seven} />)
    expect(screen.getByRole('link', { name: '+1 on the map' }).getAttribute('href')).toBe('/b/organization?select=project%3Abr')
    expect(document.querySelectorAll('.mini-n:not(.is-me)')).toHaveLength(6)
  })

  it('counts `more` (neighbours not sent) with what is past six', () => {
    renderAt(<MiniMap centre={centre} neighbours={seven} more={3} />)
    expect(screen.getByRole('link', { name: '+4 on the map' })).toBeTruthy()
  })

  it('"Open on the map" links to the map with the record selected', () => {
    const sys = resource({ id: 'system:treasury', kind: 'system', board: 'systems', name: 'Treasury', facts: { kind: 'safe' } })
    const { loc } = renderAt(<MiniMap centre={sys} neighbours={near} />)
    const open = screen.getByRole('link', { name: 'Open on the map' })
    expect(open.getAttribute('href')).toBe('/b/systems?select=system%3Atreasury')
    fireEvent.click(open)
    expect(loc.history.at(-1)).toBe('/b/systems?select=system%3Atreasury')
  })

  it('draws a neighbour the viewer may not see not at all, and does not count it', () => {
    const hidden = resource({ id: 'project:secret', kind: 'project', name: 'Ops only', facts: { visibility: 'hat:ops' } })
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><MiniMap centre={centre} neighbours={[...seven.slice(0, 6), hidden]} /></ViewAsProvider>)
    expect(screen.queryByText('Ops only')).toBeNull()
    expect(screen.queryByRole('link', { name: /^\+\d+ on the map$/ })).toBeNull()
  })

  it('is 188 tall in the inspector and 220 on the record page, from tokens', () => {
    const { container, rerender } = renderAt(<MiniMap centre={centre} neighbours={near} size="inspector" />)
    expect(container.querySelector('.mini')!.className).toBe('mini mini-inspector')
    expect(container.querySelector('.mini-n.is-me')!.getAttribute('aria-current')).toBeNull() // beside a list, not the page
    rerender(<MiniMap centre={centre} neighbours={near} />)
    expect(container.querySelector('.mini')!.className).toBe('mini mini-page') // the record page's, by default (0.6 props)
    const rule = (sel: string) => new RegExp(`${sel.replace(/\./g, '\\.')} \\{[^}]*\\}`).exec(css)?.[0] ?? ''
    expect(rule('.mini-inspector')).toContain('block-size: var(--h-mini);')
    expect(rule('.mini-page')).toContain('block-size: var(--h-mini-page);')
    for (const skin of [house, bare]) {
      expect(skin).toMatch(/--h-mini: 188px;/)
      expect(skin).toMatch(/--h-mini-page: 220px;/)
    }
  })

  it('says so when the record touches nothing', () => {
    renderAt(<MiniMap centre={centre} neighbours={[]} />)
    expect(screen.getByText('Touches nothing yet.')).toBeTruthy()
  })
})
