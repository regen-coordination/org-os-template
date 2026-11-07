import { describe, it, expect } from 'vitest'
import { clampZoom, mapKeyOf, nearestInDirection, ZOOM } from './mapKeys.ts'
import type { MapLink, Placed } from './layers.ts'

const at = (id: string, x: number, y: number, big = false): Placed => ({ id, layer: 0, x, y, w: 100, big })
// a  .  b        (row 0)
// .  c  .        (row 1)
// d  .  e        (row 2)
const NODES = [at('a', 0, 0), at('b', 300, 0), at('c', 150, 120), at('d', 0, 240), at('e', 300, 240)]
const LINKS: MapLink[] = [{ from: 'a', to: 'c', label: 'x' }, { from: 'c', to: 'e', label: 'y' }]

describe('nearestInDirection (§8.5: arrows move along edges to the nearest node in that direction)', () => {
  it('prefers a node an edge joins, in that direction, over a nearer one with no edge', () => {
    // from a, down: c (joined) rather than d (straight below, not joined)
    expect(nearestInDirection('a', 'down', NODES, LINKS)).toBe('c')
    // edges count both ways: from c, up is a; down is e
    expect(nearestInDirection('c', 'up', NODES, LINKS)).toBe('a')
    expect(nearestInDirection('c', 'down', NODES, LINKS)).toBe('e')
  })

  it('falls back to the nearest node in that direction when no edge leads there', () => {
    expect(nearestInDirection('b', 'left', NODES, LINKS)).toBe('a')
    expect(nearestInDirection('d', 'right', NODES, LINKS)).toBe('e')
    // while an edge that way wins over the nearer one in line: from e, left is c (joined), not d
    expect(nearestInDirection('e', 'left', NODES, LINKS)).toBe('c')
    expect(nearestInDirection('b', 'down', [at('b', 300, 0), at('far', 0, 240), at('near', 290, 240)], [])).toBe('near')
  })

  it('is null at an edge of the map, and for an id not on it', () => {
    expect(nearestInDirection('a', 'up', NODES, LINKS)).toBeNull()
    expect(nearestInDirection('a', 'left', NODES, LINKS)).toBeNull()
    expect(nearestInDirection('nope', 'down', NODES, LINKS)).toBeNull()
  })

  it('reads a node by its centre, so the big node in a row is level with its neighbours', () => {
    const row = [at('small', 0, 14), at('big', 200, 0, true), at('right', 500, 14)]
    expect(nearestInDirection('small', 'right', row, [])).toBe('big')
    expect(nearestInDirection('big', 'up', row, [])).toBeNull()
  })
})

describe('the map’s keys (§8.2, §8.5)', () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    mapKeyOf({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
  it('arrows move; Enter opens; Space inspects; Esc leaves', () => {
    expect(k('ArrowUp')).toEqual({ move: 'up' })
    expect(k('ArrowRight')).toEqual({ move: 'right' })
    expect(k('Enter')).toEqual({ act: 'open' })
    expect(k(' ')).toEqual({ act: 'inspect' })
    expect(k('Escape')).toEqual({ act: 'leave' })
  })
  it('Fit is ⌘0 (Ctrl-0 too); ⌘+ and ⌘− zoom', () => {
    expect(k('0', { metaKey: true })).toEqual({ act: 'fit' })
    expect(k('0', { ctrlKey: true })).toEqual({ act: 'fit' })
    expect(k('0')).toBeNull()
    expect(k('=', { metaKey: true })).toEqual({ act: 'zoom-in' })
    expect(k('+', { metaKey: true, shiftKey: true })).toEqual({ act: 'zoom-in' })
    expect(k('-', { ctrlKey: true })).toEqual({ act: 'zoom-out' })
  })
  it('leaves every other key to the house (v, [, ?) and arrows with a modifier', () => {
    for (const key of ['v', '[', '?', 'j', 'Tab']) expect(k(key)).toBeNull()
    expect(k('ArrowDown', { altKey: true })).toBeNull()
    expect(k('ArrowDown', { metaKey: true })).toBeNull()
  })
  it('zoom stays within 50–200 %', () => {
    expect(ZOOM).toMatchObject({ min: 0.5, max: 2 })
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(1.2)).toBe(1.2)
    expect(clampZoom(9)).toBe(2)
  })
})
