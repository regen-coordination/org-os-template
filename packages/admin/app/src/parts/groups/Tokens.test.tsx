// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import house from '../../design/skins/house.css?raw'
import { blockAfter, coloursIn, declarations } from '../../design/skins/read.ts'
import { renderAt } from '../../test/render.tsx'
import Tokens from './Tokens.tsx'

const light = declarations(blockAfter(house, ':root[data-skin="house"] {'))
const HEX = Object.keys(light).filter(n => /^#[0-9a-f]{6}$/i.test(light[n]!))
const dark = coloursIn(house, 'house', 'dark')

describe('/parts/tokens', () => {
  it('every colour token is a swatch with its name, light and dark hex, and its measured ratio on paper', () => {
    renderAt(<Tokens />, '/parts/tokens')
    const colour = screen.getByRole('region', { name: 'Colour' })
    const swatches = within(colour).getAllByRole('listitem')
    expect(HEX).toHaveLength(21)
    expect(swatches).toHaveLength(21)
    expect(swatches.map(s => s.dataset.token).sort()).toEqual([...HEX].sort())
    for (const s of swatches) {
      const name = s.dataset.token!
      expect(s.textContent, name).toContain(`--${name}`)
      expect(s.textContent, name).toContain(light[name])
      expect(s.textContent, name).toContain(dark[name])
    }
    const ink = swatches.find(s => s.dataset.token === 'ink')!
    expect(ink.textContent).toContain('15.13')
    expect(ink.textContent).toContain('15.50')
  })

  it('sets the type scale in its own tokens: the families, and a sample per step', () => {
    renderAt(<Tokens />, '/parts/tokens')
    const type = screen.getByRole('region', { name: 'Type' })
    for (const words of ['Fraunces', 'Geist', 'Geist Mono']) expect(type.textContent).toContain(words)
    for (const sample of ['Practised', 'What we fund', 'Three things wait on you.', 'Return the Gardens pools to the treasury', 'eip155:42220:0x6AFFe5105DE869fE4A27b3353468eFb51a55343a']) {
      expect(type.textContent).toContain(sample)
    }
  })

  it('space, corners, the four depth levels, and motion as words', () => {
    renderAt(<Tokens />, '/parts/tokens')
    const space = screen.getByRole('region', { name: 'Space' })
    expect(within(space).getAllByRole('listitem').length).toBeGreaterThanOrEqual(12)
    const corners = screen.getByRole('region', { name: 'Corners' })
    for (const r of ['xs 4', 'sm 6', 'ctl 7', 'pop 12', 'lg 16', 'plate 22']) expect(corners.textContent).toContain(r)
    const depth = screen.getByRole('region', { name: 'Depth' })
    expect(within(depth).getAllByRole('listitem').map(li => li.textContent)).toEqual(['flat · rule', 'card', 'raise · node', 'pop · menu'])
    const motion = screen.getByRole('region', { name: 'Motion' })
    for (const t of ['dur-1', 'dur-press', 'dur-2', 'dur-3', 'dur-flow', 'ease']) {
      expect(motion.textContent, t).toContain(`--${t}`)
      expect(motion.textContent, t).toContain(light[t]!)
    }
  })
})
