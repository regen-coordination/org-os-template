/** The DAO map's keys (spec §8.2, §8.5): arrows move along edges to the nearest node in that direction, Enter opens,
 *  Space inspects, Esc leaves to the canvas; Fit is ⌘0, ⌘+ / ⌘− zoom within 50–200 %. Every other key is the house's
 *  (`v`, `[`, `?`), so the map leaves it alone. Pure. */
import { LAYOUT, type MapLink, type Placed } from './layers.ts'

export type Dir = 'up' | 'down' | 'left' | 'right'
export type MapKey = { move: Dir } | { act: 'open' | 'inspect' | 'leave' | 'fit' | 'zoom-in' | 'zoom-out' }

/** The zoom's bounds (§8.2) and one ⌘+ step. */
export const ZOOM = { min: 0.5, max: 2, step: 1.25 } as const
export const clampZoom = (z: number): number => Math.min(ZOOM.max, Math.max(ZOOM.min, z))

const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/** What a key press does on the map, or null for a key it leaves to the house. Arrows are physical: the caller
 *  gives positions as drawn (mirrored on a right-to-left page). */
export function mapKeyOf(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): MapKey | null {
  const mod = e.metaKey || e.ctrlKey
  if (e.altKey) return null
  if (mod) {
    if (e.key === '0') return { act: 'fit' }
    if (e.key === '=' || e.key === '+') return { act: 'zoom-in' }
    if (e.key === '-' || e.key === '−') return { act: 'zoom-out' }
    return null
  }
  if (e.key in ARROWS) return { move: ARROWS[e.key]! }
  if (e.key === 'Enter') return { act: 'open' }
  if (e.key === ' ') return { act: 'inspect' }
  if (e.key === 'Escape') return { act: 'leave' }
  return null
}

const centre = (p: Placed) => ({ x: p.x + p.w / 2, y: p.y + (p.big ? LAYOUT.bigH : LAYOUT.nodeH) / 2 })

/** The node an arrow moves to from `from`: of the nodes whose centre lies that way, the nearest one an edge joins
 *  to it (either way along the edge), else the nearest of all. Nearest weighs drift across the arrow twice as much as
 *  distance along it, so ↓ keeps to its column. Null at the map's edge, or for an id not on the map. */
export function nearestInDirection(from: string, dir: Dir, nodes: Placed[], links: MapLink[]): string | null {
  const here = nodes.find(n => n.id === from)
  if (!here) return null
  const c = centre(here)
  const ahead = nodes.filter(n => n.id !== from).map(n => {
    const o = centre(n)
    const [along, across] = dir === 'up' ? [c.y - o.y, o.x - c.x] : dir === 'down' ? [o.y - c.y, o.x - c.x]
      : dir === 'left' ? [c.x - o.x, o.y - c.y] : [o.x - c.x, o.y - c.y]
    return { id: n.id, along, score: along + 2 * Math.abs(across) }
  }).filter(n => n.along > 0.5)
  const joined = new Set(links.flatMap(k => (k.from === from ? [k.to] : k.to === from ? [k.from] : [])))
  const best = (xs: typeof ahead) => [...xs].sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1))[0]?.id ?? null
  return best(ahead.filter(n => joined.has(n.id))) ?? best(ahead)
}
