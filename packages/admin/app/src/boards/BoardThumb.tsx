import type { BlockEntry, CanvasPlace, Layout } from '../api.ts'
import { convert } from './layout.ts'

/** A box of a thumbnail, in percent of its frame. */
export interface Box { x: number; y: number; w: number; h: number }

/** Each layout's name and what it is for (the New board sheet's tiles, a row's "<Layout> · n blocks"). The flow line
 *  says what the house's flow is — blocks one under another (views.css `.board.flow`) — not the mockup's "stages left
 *  to right", which the house does not draw (DP-2's rule: a claim the Hub does not keep is not said). */
export const LAYOUT_WORDS: Record<Layout, { name: string; line: string }> = {
  grid: { name: 'Grid', line: 'Blocks in rows. Dashboards, a council view.' },
  canvas: { name: 'Canvas', line: 'Place blocks freely. Workshops, maps.' },
  flow: { name: 'Flow', line: 'Blocks one under another, in order. A page to read down.' },
}

const PAD = 10
const SPAN = 100 - 2 * PAD
const MOST = 8 // a thumbnail is a picture, not a census
const isCanvas = (p: unknown): p is CanvasPlace => typeof p === 'object' && p !== null && Number.isFinite((p as CanvasPlace).x) && Number.isFinite((p as CanvasPlace).w)
const round = (n: number) => Math.round(n * 10) / 10

/** A board's blocks as boxes, from its own config (never a screenshot): a grid and a canvas where their places put
 *  them, scaled into the frame; a flow one under another. */
export function thumbBoxes(layout: Layout, blocks: BlockEntry[]): Box[] {
  const some = blocks.slice(0, MOST)
  if (some.length === 0) return []
  if (layout === 'flow') {
    const gap = 6
    const h = (SPAN - gap * (some.length - 1)) / some.length
    return some.map((_, i) => ({ x: PAD, y: round(PAD + i * (h + gap)), w: SPAN, h: round(h) }))
  }
  const placed = (layout === 'canvas' ? some : convert(some, 'grid', 'canvas')).map(b => b.place).filter(isCanvas)
  if (placed.length === 0) return []
  const right = Math.max(...placed.map(p => p.x + p.w))
  const bottom = Math.max(...placed.map(p => p.y + p.h))
  const sx = right > 0 ? SPAN / right : 0
  const sy = bottom > 0 ? SPAN / bottom : 0
  return placed.map(p => ({ x: round(PAD + p.x * sx), y: round(PAD + p.y * sy), w: round(Math.max(p.w * sx, 4)), h: round(Math.max(p.h * sy, 4)) }))
}

/** What each layout looks like with a few blocks: the New board sheet's tiles. */
export const SAMPLE: Record<Layout, Box[]> = {
  grid: [{ x: 10, y: 12, w: 38, h: 34 }, { x: 52, y: 12, w: 38, h: 34 }, { x: 10, y: 54, w: 38, h: 34 }, { x: 52, y: 54, w: 38, h: 34 }],
  canvas: [{ x: 14, y: 18, w: 32, h: 36 }, { x: 54, y: 44, w: 30, h: 40 }],
  flow: [{ x: 10, y: 10, w: 80, h: 22 }, { x: 10, y: 39, w: 80, h: 22 }, { x: 10, y: 68, w: 80, h: 22 }],
}

/** A small drawing of a board: its frame and its blocks as boxes. Decoration (the row or the tile says the layout and
 *  the count in words), so hidden from assistive tech; drawn with borders, which forced colours keep. */
export function BoardThumb({ boxes, size = 'row' }: { boxes: Box[]; size?: 'row' | 'tile' }) {
  return (
    <span className={`bthumb bthumb-${size}`} aria-hidden="true">
      {boxes.map((b, i) => (
        <span key={i} className="bthumb-b" style={{ insetInlineStart: `${b.x}%`, insetBlockStart: `${b.y}%`, inlineSize: `${b.w}%`, blockSize: `${b.h}%` }} />
      ))}
    </span>
  )
}
