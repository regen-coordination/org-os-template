import type { Positions } from '../api.ts'
import { KIND_ORDER } from '../kinds.ts'

export const COL_W = 240
export const ROW_H = 120

interface LayoutNode { id: string; kind: string; name: string; attention: { level: 'warn' | 'alert' } | null }
const order = (kind: string) => { const i = KIND_ORDER.indexOf(kind); return i < 0 ? KIND_ORDER.length : i }
const rank = (n: LayoutNode) => (n.attention?.level === 'alert' ? 0 : n.attention ? 1 : 2)

/** Columns by kind. The first column reads by attention, then name; each later column is pulled
 *  towards the rows of its neighbours already placed, which uncrosses most lines without a
 *  layout library (spec §12.7). Positions the operator dragged win, for cards still on the board. */
export function layoutBoard(nodes: LayoutNode[], edges: { from: string; to: string }[], portals: { id: string }[], saved: Positions): Positions {
  const kinds = [...new Set(nodes.map(n => n.kind))].sort((a, b) => order(a) - order(b))
  const near = new Map<string, string[]>()
  const link = (a: string, b: string) => { const l = near.get(a) ?? []; l.push(b); near.set(a, l) }
  for (const e of edges) { link(e.from, e.to); link(e.to, e.from) }
  const row = new Map<string, number>()
  const out: Positions = {}
  kinds.forEach((kind, col) => {
    const column = nodes.filter(n => n.kind === kind).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    const pull = (n: LayoutNode) => {
      const rows = (near.get(n.id) ?? []).map(id => row.get(id)).filter((r): r is number => r !== undefined)
      return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : Number.POSITIVE_INFINITY
    }
    const placed = col === 0 ? column : [...column].sort((a, b) => { const pa = pull(a), pb = pull(b); return pa === pb ? 0 : pa - pb })
    placed.forEach((n, i) => { row.set(n.id, i); out[n.id] = { x: col * COL_W, y: i * ROW_H } })
  })
  portals.forEach((p, i) => { out[p.id] = { x: kinds.length * COL_W, y: i * ROW_H } })
  for (const [id, pos] of Object.entries(saved)) if (id in out) out[id] = pos
  return out
}
