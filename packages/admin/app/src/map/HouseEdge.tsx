import { EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react'
import type { MapLink } from './layers.ts'

/** A node's box on the canvas, as drawn. */
export interface Box { x: number; y: number; w: number; h: number }

/** An edge as drawn (§8.4): the SVG path from its source to its target, how long it is, the point its label sits on
 *  and the edge's direction there (a unit vector), which says how much of the label lies along it. */
export interface EdgeGeometry { d: string; length: number; x: number; y: number; dx: number; dy: number }

/** §8.2's edges: two nodes side by side in a row are joined by a straight line between their facing sides; any
 *  other two by a vertical cubic from the upper node's bottom centre to the lower one's top centre. The path runs from
 *  `src` to `tgt`, so a dash moving along it moves the edge's way. */
export function edgeGeometry(src: Box, tgt: Box): EdgeGeometry {
  const sideBySide = src.y < tgt.y + tgt.h && tgt.y < src.y + src.h && (src.x + src.w <= tgt.x || tgt.x + tgt.w <= src.x)
  if (sideBySide) {
    const right = src.x < tgt.x
    const [x1, y1] = [right ? src.x + src.w : src.x, src.y + src.h / 2]
    const [x2, y2] = [right ? tgt.x : tgt.x + tgt.w, tgt.y + tgt.h / 2]
    const length = Math.hypot(x2 - x1, y2 - y1)
    return { d: `M${x1} ${y1} L${x2} ${y2}`, length, x: (x1 + x2) / 2, y: (y1 + y2) / 2, dx: length ? (x2 - x1) / length : 1, dy: length ? (y2 - y1) / length : 0 }
  }
  const down = src.y + src.h / 2 <= tgt.y + tgt.h / 2
  const [x1, y1] = [src.x + src.w / 2, down ? src.y + src.h : src.y]
  const [x2, y2] = [tgt.x + tgt.w / 2, down ? tgt.y : tgt.y + tgt.h]
  const my = (y1 + y2) / 2
  // the cubic's direction halfway: (1.5 Δx, .75 Δy)
  const [tx, ty] = [1.5 * (x2 - x1), 0.75 * (y2 - y1)]
  const t = Math.hypot(tx, ty) || 1
  return { d: `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`, length: Math.hypot(x2 - x1, y2 - y1), x: (x1 + x2) / 2, y: my, dx: tx / t, dy: ty / t }
}

/** A label's size: Mono 11 (about .6em a character) on its 3px 5px pill. */
export function labelSize(text: string): { w: number; h: number } {
  return { w: Math.ceil(text.length * 6.6) + 10, h: 17 }
}

/** How much of the edge a label covers: its width along a level edge, its height along an upright one. */
export const labelAlong = (g: Pick<EdgeGeometry, 'dx' | 'dy'>, size: { w: number; h: number }): number =>
  Math.abs(g.dx) * size.w + Math.abs(g.dy) * size.h

/** §8.4: a label is drawn only when its edge is at least the label plus 16px; otherwise it is dropped, and the
 *  relation stays in both nodes' descriptions. */
export function labelFits(edgeLength: number, labelWidth: number): boolean {
  return edgeLength >= labelWidth + 16
}

/** A relation in a sentence, for both nodes' descriptions: the verbs read as written ("elects", "appoints",
 *  "includes", "holds"), a signing threshold signs for its Safe, and the nouns say whose ("is admin of", "has the
 *  pool"). */
export function relationSentence(from: string, label: string, to: string): string {
  if (/^signs\b/.test(label)) return `${from} ${label} for ${to}`
  if (label === 'admin') return `${from} is admin of ${to}`
  if (label === 'pool') return `${from} has the pool ${to}`
  return `${from} ${label} ${to}`
}

export const edgeId = (k: Pick<MapLink, 'from' | 'to'>): string => `${k.from}>${k.to}`

/** The selected node's path (§8.3): up through what points at it, and down through what it points at. The edges
 *  walked are on the path; so are the nodes they reach. */
export function selectedPath(selected: string, links: MapLink[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([selected])
  const edges = new Set<string>()
  const walk = (step: (k: MapLink) => [string, string]) => {
    const queue = [selected]
    const seen = new Set([selected])
    while (queue.length) {
      const at = queue.shift()!
      for (const k of links) {
        const [here, next] = step(k)
        if (here !== at) continue
        edges.add(edgeId(k))
        nodes.add(next)
        if (!seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
  }
  walk(k => [k.to, k.from])
  walk(k => [k.from, k.to])
  return { nodes, edges }
}

/** What the map gives each edge: its drawn path, its label when it fits (and where), and its treatment: on the
 *  selected path, dimmed off it, invalid (compose), and a flow travelling or done (the path). */
export interface HouseEdgeData extends Record<string, unknown> {
  d: string
  label: string | null
  labelX: number
  labelY: number
  on: boolean
  dim: boolean
  invalid?: boolean
  flow: { dir: 'along' | 'against'; phase: 'travelling' | 'path' } | null
}

/** An edge of the house map, for React Flow (§8.4, §8.5): the path in `--edge`, moss on the selected path or a
 *  flow's path, the travelling dash over it while value moves, and its label on a canvas-coloured pill. */
export function HouseEdge({ data }: EdgeProps<Edge<HouseEdgeData>>) {
  const e = data!
  const cls = ['hedge', e.on ? 'is-on' : null, e.dim ? 'is-dim' : null, e.invalid ? 'is-bad' : null,
    e.flow?.phase === 'travelling' ? 'is-travelling' : null, e.flow?.phase === 'path' ? 'is-path' : null].filter(Boolean).join(' ')
  return <>
    <path className={cls} d={e.d} />
    {e.flow?.phase === 'travelling' && <path className={`hedge-dash is-${e.flow.dir}`} d={e.d} />}
    {e.label !== null && (
      <EdgeLabelRenderer>
        <div className={['hlabel', e.on || e.flow ? 'is-on' : null, e.dim ? 'is-dim' : null].filter(Boolean).join(' ')}
          style={{ transform: `translate(-50%, -50%) translate(${e.labelX}px, ${e.labelY}px)` }}>{e.label}</div>
      </EdgeLabelRenderer>
    )}
  </>
}
