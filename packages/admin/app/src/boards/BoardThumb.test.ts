import { describe, it, expect } from 'vitest'
import { thumbBoxes } from './BoardThumb.tsx'

describe('thumbBoxes: a board drawn from its own config', () => {
  it('draws a flow as its blocks one under another', () => {
    expect(thumbBoxes('flow', [{ id: 'a', type: 'note' }, { id: 'b', type: 'note' }])).toEqual([
      { x: 10, y: 10, w: 80, h: 37 }, { x: 10, y: 53, w: 80, h: 37 },
    ])
  })

  it('draws a grid where its places put the blocks: two side by side on a row, one under them across', () => {
    const boxes = thumbBoxes('grid', [
      { id: 'a', type: 'note', place: { col: 1, span: 6, row: 1 } }, { id: 'b', type: 'note', place: { col: 7, span: 6, row: 1 } },
      { id: 'c', type: 'note', place: { col: 1, span: 12, row: 2 } },
    ])
    expect(boxes).toHaveLength(3)
    expect(boxes[0]!.x).toBe(10)
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.w - 1)
    expect(boxes[0]!.y).toBe(boxes[1]!.y)
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.h - 1)
    expect(boxes[2]!.w).toBeGreaterThan(boxes[0]!.w * 1.9)
  })

  it('draws a canvas scaled into the frame, and nothing for a board without blocks', () => {
    expect(thumbBoxes('canvas', [{ id: 'a', type: 'note', place: { x: 0, y: 0, w: 100, h: 50 } }, { id: 'b', type: 'note', place: { x: 100, y: 50, w: 100, h: 50 } }]))
      .toEqual([{ x: 10, y: 10, w: 40, h: 40 }, { x: 50, y: 50, w: 40, h: 40 }])
    expect(thumbBoxes('grid', [])).toEqual([])
  })
})
