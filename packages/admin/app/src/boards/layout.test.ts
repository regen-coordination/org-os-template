import { describe, it, expect } from 'vitest'
import { convert, flowOrder, CELL, GAP, ROW } from './layout.ts'
import type { BlockEntry } from '../api.ts'

const b = (id: string, place?: BlockEntry['place']): BlockEntry => ({ id, type: 'note', text: '', ...(place ? { place } : {}) })

describe('flowOrder (spec §5.4: the phone order)', () => {
  it('reads a grid by row, then column, whatever the list order', () => {
    expect(flowOrder([b('c', { col: 7, span: 6, row: 2 }), b('b', { col: 7, span: 6, row: 1 }), b('a', { col: 1, span: 6, row: 1 })], 'grid').map(x => x.id))
      .toEqual(['a', 'b', 'c'])
  })
  it('reads a canvas top to bottom, then left to right', () => {
    expect(flowOrder([b('r', { x: 500, y: 0, w: 240, h: 120 }), b('d', { x: 0, y: 400, w: 240, h: 120 }), b('l', { x: 0, y: 0, w: 240, h: 120 })], 'canvas').map(x => x.id))
      .toEqual(['l', 'r', 'd'])
  })
  it('keeps a flow as it is, and puts blocks with no place last', () => {
    expect(flowOrder([b('x'), b('y')], 'flow').map(x => x.id)).toEqual(['x', 'y'])
    expect(flowOrder([b('none'), b('a', { col: 1, span: 3, row: 1 })], 'grid').map(x => x.id)).toEqual(['a', 'none'])
  })
})

describe('convert (spec §5.1: switching layout keeps the blocks)', () => {
  const grid = [b('a', { col: 1, span: 4, row: 1 }), b('b', { col: 5, span: 8, row: 1 }), b('c', { col: 1, span: 12, row: 2 })]
  it('grid → flow: by row then column, places removed', () => {
    expect(convert(grid, 'grid', 'flow')).toEqual([b('a'), b('b'), b('c')])
  })
  it('flow → grid: one block per row at span 12', () => {
    expect(convert([b('x'), b('y')], 'flow', 'grid').map(x => x.place)).toEqual([{ col: 1, span: 12, row: 1 }, { col: 1, span: 12, row: 2 }])
  })
  it('grid → canvas: a cell is CELL wide and a row ROW high, less the gap', () => {
    expect(convert(grid, 'grid', 'canvas')[1]!.place).toEqual({ x: 4 * CELL, y: 0, w: 8 * CELL - GAP, h: ROW - GAP })
  })
  it('canvas → grid round-trips a grid, and never overlaps', () => {
    expect(convert(convert(grid, 'grid', 'canvas'), 'canvas', 'grid').map(x => x.place)).toEqual(grid.map(x => x.place))
    const stacked = [b('p', { x: 0, y: 0, w: 600, h: 200 }), b('q', { x: 10, y: 20, w: 600, h: 200 })]
    const places = convert(stacked, 'canvas', 'grid').map(x => x.place as { row: number })
    expect(places[0]!.row).not.toBe(places[1]!.row)
  })
})
