import { GRID_COLUMNS, MIN_SPAN } from '../../../lib/board-query.mjs'
import type { BlockEntry, CanvasPlace, GridPlace, Layout } from '../api.ts'

/** A grid column and a grid row as a canvas measures them (spec §5.1: switching layout recomputes places).
 *  A span-3 block is 3 × 88 − 16 = 248 px, above the canvas minimum of 240. */
export const CELL = 88
export const ROW = 360
export const GAP = 16

const isGrid = (p: unknown): p is GridPlace => typeof p === 'object' && p !== null && Number.isFinite((p as GridPlace).row) && Number.isFinite((p as GridPlace).col)
const isCanvas = (p: unknown): p is CanvasPlace => typeof p === 'object' && p !== null && Number.isFinite((p as CanvasPlace).x) && Number.isFinite((p as CanvasPlace).y)
const placed = (b: BlockEntry, place: BlockEntry['place'] | undefined): BlockEntry => {
  const { place: _drop, ...rest } = b
  return place === undefined ? rest : { ...rest, place }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The order a phone reads a board in (spec §5.4): a grid by row then column, a canvas by y then x, a flow
 *  as it is. A block with no usable place goes last, in list order. */
export function flowOrder(blocks: BlockEntry[], layout: Layout): BlockEntry[] {
  const at = blocks.map((b, i) => ({ b, i }))
  const inf = Number.POSITIVE_INFINITY
  if (layout === 'grid') {
    const k = (b: BlockEntry) => (isGrid(b.place) ? [b.place.row, b.place.col] : [inf, inf])
    at.sort((x, y) => k(x.b)[0]! - k(y.b)[0]! || k(x.b)[1]! - k(y.b)[1]! || x.i - y.i)
  } else if (layout === 'canvas') {
    const k = (b: BlockEntry) => (isCanvas(b.place) ? [b.place.y, b.place.x] : [inf, inf])
    at.sort((x, y) => k(x.b)[0]! - k(y.b)[0]! || k(x.b)[1]! - k(y.b)[1]! || x.i - y.i)
  }
  return at.map(x => x.b)
}

/** Canvas places onto the grid: nearest column and span, then the first row from the nearest band where
 *  the block fits beside what is already placed (spec §5.1: never an overlap). */
function canvasToGrid(blocks: BlockEntry[]): BlockEntry[] {
  const taken = new Set<string>()
  const fits = (row: number, col: number, span: number) => { for (let c = col; c < col + span; c++) if (taken.has(`${row}:${c}`)) return false; return true }
  return blocks.map(b => {
    const p = isCanvas(b.place) ? b.place : { x: 0, y: 0, w: GRID_COLUMNS * CELL - GAP, h: ROW - GAP }
    const span = clamp(Math.round((p.w + GAP) / CELL), MIN_SPAN, GRID_COLUMNS)
    const col = Math.min(clamp(Math.round(p.x / CELL) + 1, 1, GRID_COLUMNS), GRID_COLUMNS - span + 1)
    let row = Math.max(1, Math.round(p.y / ROW) + 1)
    while (!fits(row, col, span)) row++
    for (let c = col; c < col + span; c++) taken.add(`${row}:${c}`)
    return placed(b, { col, span, row })
  })
}

/** The same blocks, placed for another layout. */
export function convert(blocks: BlockEntry[], from: Layout, to: Layout): BlockEntry[] {
  if (from === to) return blocks
  const ordered = flowOrder(blocks, from)
  if (to === 'flow') return ordered.map(b => placed(b, undefined))
  if (to === 'grid') return from === 'canvas' ? canvasToGrid(ordered) : ordered.map((b, i) => placed(b, { col: 1, span: GRID_COLUMNS, row: i + 1 }))
  const grid = from === 'grid' ? blocks : ordered.map((b, i) => placed(b, { col: 1, span: GRID_COLUMNS, row: i + 1 }))
  return grid.map(b => {
    const p = isGrid(b.place) ? b.place : { col: 1, span: GRID_COLUMNS, row: 1 }
    return placed(b, { x: (p.col - 1) * CELL, y: (p.row - 1) * ROW, w: p.span * CELL - GAP, h: ROW - GAP })
  })
}
