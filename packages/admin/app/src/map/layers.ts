/** The DAO map's layout (spec §8.2), in code so a skin cannot move a node (L4-R2): layered top to bottom by
 *  authority, ordered within a layer to keep edges from crossing, the main Safe big at the centre, linked Systems
 *  to the start side. Pure and deterministic: the same items and links give the same layout, in any order.
 *  Coordinates are each node's top-left corner, left to right; the renderer mirrors them for a right-to-left page. */

export type Layer = 0 | 1 | 2 | 3 | 'linked'
/** A node of the map. `id` is the Resource id (`system:<id>`) or a hat's ref (G-7); `section` is the Resource's
 *  `facts.section`; `facts` are the source Resource's, for visibility. `role` is a hat's: council → decides,
 *  signer and operations → acts. */
export interface MapItem {
  id: string; kind: string; name: string; section?: string; role?: 'decides' | 'acts'; facts?: Record<string, unknown>
  /** The hat word when the viewer is not admitted to the record's `name` (rule 3, E-70): `name` then reads
   *  "<hat> only" and the node draws it as every restricted field is drawn. */
  nameKept?: string
  /** A System whose last read failed: it never wins the main Safe's tie (walk 2026-11-04). */
  failed?: true
}
export interface MapLink { from: string; to: string; label: string }
export interface Placed { id: string; layer: Layer; x: number; y: number; w: number; big: boolean }
export interface MapLayout { nodes: Placed[]; width: number; height: number; mainSafe: string | null; narrow: boolean }

/** The spec's numbers. The node widths equal house.css's `--w-node-min`, `--w-node` and `--w-node-big` (CC-12).
 *  `nodeH` and `bigH` are the heights a node and the big node are laid out at, and drawn at (house.css's `--h-node`
 *  and `--h-node-big`): a name and a line of facts; the big one adds its eyebrow and the display face. */
export const LAYOUT = {
  layerGap: 64, layerGapNarrow: 52, colGap: 16, nodeMin: 148, nodeMax: 200, big: 236, narrowAt: 680, nodeH: 56, bigH: 84,
} as const

const TREASURY = 'organization/treasury'
const ROW_LAYERS = [0, 1, 2, 3] as const
type RowLayer = (typeof ROW_LAYERS)[number]
const EPSILON = 1e-9

const byName = (a: MapItem, b: MapItem) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** §8.2's layer for an item on its own: Snapshot spaces and the hats that decide at the top (0); the roles that act
 *  and the wallets they hold (1); Safes (2); what the treasuries feed, and any kind the map does not know (3); link
 *  Systems in the linked group. Only a hat reads its role; a hat with no role acts. */
export function layerOf(item: MapItem): Layer {
  if (item.kind === 'link') return 'linked'
  if (item.kind === 'safe') return 2
  if (item.kind === 'hat' && item.role === 'decides') return 0
  if (item.kind === 'hat' && item.role === 'acts') return 1
  if (item.kind === 'snapshot-space') return 0
  if (item.kind === 'hat' || item.kind === 'hats-tree' || item.kind === 'wallet') return 1
  return 3
}

/** Each id once, the first listing winning. */
const unique = (items: MapItem[]) => {
  const seen = new Map<string, MapItem>()
  for (const i of items) if (!seen.has(i.id)) seen.set(i.id, i)
  return [...seen.values()]
}

/** Links between two different items that are both on the map. */
const linksAmong = (items: MapItem[], links: MapLink[]) => {
  const known = new Set(items.map(i => i.id))
  return links.filter(k => k.from !== k.to && known.has(k.from) && known.has(k.to))
}

/** The DAO's main Safe: the Safe in `organization/treasury` (if several, the one more edges point at), else the Safe
 *  most edges point at; never a Safe whose read failed while one was read; a tie goes by name. `null` when the map
 *  has no Safe. */
export function mainSafeOf(items: MapItem[], links: MapLink[]): string | null {
  const all = unique(items)
  const safes = all.filter(i => i.kind === 'safe')
  if (!safes.length) return null
  const known = new Set(all.map(i => i.id))
  const incoming = (id: string) => links.filter(k => k.to === id && k.from !== id && known.has(k.from)).length
  const inTreasury = safes.filter(s => s.section === TREASURY)
  const pool = inTreasury.length ? inTreasury : safes
  const failed = (i: MapItem) => (i.failed ? 1 : 0)
  // a Safe that was read always goes before one whose read failed, whatever points at it (review I-1)
  return [...pool].sort((a, b) => failed(a) - failed(b) || incoming(b.id) - incoming(a.id) || byName(a, b))[0]!.id
}

/** Lays the map out for a canvas `width` wide. */
export function layoutMap(items: MapItem[], links: MapLink[], opts: { width: number }): MapLayout {
  const narrow = opts.width < LAYOUT.narrowAt
  const all = unique(items).sort(byName)
  if (!all.length) return { nodes: [], width: 0, height: 0, mainSafe: null, narrow }
  const edges = linksAmong(all, links)
  const main = mainSafeOf(all, edges)
  const item = new Map(all.map(i => [i.id, i]))

  // Layers: §8.2's, except that a Safe another Safe administers sits with what the treasury feeds.
  const layer = new Map<string, Layer>(all.map(i => {
    const fed = i.kind === 'safe' && i.id !== main && edges.some(k => k.to === i.id && item.get(k.from)!.kind === 'safe')
    return [i.id, fed ? 3 : layerOf(i)]
  }))
  const near = new Map<string, Set<string>>(all.map(i => [i.id, new Set<string>()]))
  for (const k of edges) { near.get(k.from)!.add(k.to); near.get(k.to)!.add(k.from) }

  const order = new Map<RowLayer, MapItem[]>(ROW_LAYERS.map(n => [n, all.filter(i => layer.get(i.id) === n)]))
  const linked = all.filter(i => layer.get(i.id) === 'linked')
  for (const n of [1, 2, 3] as const) sweep(order, n, n - 1, layer, near, edges)
  for (const n of [2, 1, 0] as const) sweep(order, n, n + 1, layer, near, edges)

  const placed = narrow
    ? placeNarrow(order, linked, main, opts.width)
    : placeWide(order, linked, main, opts.width)
  const rank = (p: Placed) => (p.layer === 'linked' ? 4 : p.layer)
  const nodes = placed.nodes.sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x)
  const height = Math.max(...nodes.map(p => p.y + (p.big ? LAYOUT.bigH : LAYOUT.nodeH)))
  return { nodes, width: placed.width, height, mainSafe: main, narrow }
}

/** One pass of the barycentre heuristic over layer `n`, against layer `ref`: each node goes by the mean position of
 *  its neighbours in `ref` (a node with none keeps its own), ties by name. Then a node tied only to others in its
 *  own layer moves beside them (`settle`). */
function sweep(order: Map<RowLayer, MapItem[]>, n: RowLayer, ref: number, layer: Map<string, Layer>, near: Map<string, Set<string>>,
  edges: MapLink[]) {
  const row = order.get(n)!
  if (!row.length) return
  const pos = (id: string) => {
    const l = layer.get(id)
    if (typeof l !== 'number') return null
    const r = order.get(l)!
    return (r.findIndex(i => i.id === id) + 0.5) / r.length
  }
  const key = new Map(row.map(i => {
    const at = [...near.get(i.id)!].filter(o => layer.get(o) === ref).map(o => pos(o)!)
    return [i.id, at.length ? at.reduce((s, p) => s + p, 0) / at.length : pos(i.id)!]
  }))
  row.sort((a, b) => {
    const d = key.get(a.id)! - key.get(b.id)!
    return Math.abs(d) > EPSILON ? d : byName(a, b)
  })
  settle(row, layer, near, edges)
}

/** A node whose only neighbours are in its own layer sits beside them: before the one it points at, after the one
 *  that points at it, and between two or more (after the lower median). The barycentre cannot place these. */
function settle(row: MapItem[], layer: Map<string, Layer>, near: Map<string, Set<string>>, edges: MapLink[]) {
  const n = layer.get(row[0]!.id)
  const lone = row.filter(i => {
    const others = [...near.get(i.id)!].filter(o => typeof layer.get(o) === 'number')
    return others.length > 0 && others.every(o => layer.get(o) === n)
  }).sort(byName)
  for (const node of lone) {
    row.splice(row.indexOf(node), 1)
    const at = row.map((i, idx) => (near.get(node.id)!.has(i.id) ? idx : -1)).filter(idx => idx >= 0)
    let slot: number
    if (at.length === 1) {
      const points = edges.some(k => k.from === node.id && k.to === row[at[0]!]!.id)
      slot = points ? at[0]! : at[0]! + 1
    } else slot = at[Math.floor((at.length - 1) / 2)]! + 1
    row.splice(slot, 0, node)
  }
}

/** A layer's row with the main Safe at its centre: the others split, the first half before it. */
function aroundMain(row: MapItem[], main: string | null) {
  const m = row.find(i => i.id === main)
  if (!m) return null
  const others = row.filter(i => i !== m)
  const half = Math.floor(others.length / 2)
  return { main: m, before: others.slice(0, half), after: others.slice(half) }
}

/** Wide: each layer one centred row, the main Safe at the canvas's centre; the widest node width (`nodeMin`–`nodeMax`)
 *  that fits; the linked group a column at the start side of layers 2–3. A map that cannot fit overflows to the end
 *  (and to the start only as far as it must). */
function placeWide(order: Map<RowLayer, MapItem[]>, linked: MapItem[], main: string | null, width: number) {
  const { colGap: g, big, nodeMin, nodeMax, nodeH, bigH, layerGap } = LAYOUT
  const rows = ROW_LAYERS.filter(n => order.get(n)!.length)
  const extents = (w: number) => {
    const ext = new Map(rows.map(n => {
      const split = aroundMain(order.get(n)!, main)
      if (split) return [n, { left: big / 2 + split.before.length * (w + g), right: big / 2 + split.after.length * (w + g) }]
      const half = (order.get(n)!.length * (w + g) - g) / 2
      return [n, { left: half, right: half }]
    }))
    const lower = rows.filter(n => n >= 2).map(n => ext.get(n)!.left)
    const linkLeft = linked.length ? (lower.length ? Math.max(...lower) + g + w : w) : 0
    const left = Math.max(0, linkLeft, ...[...ext.values()].map(e => e.left))
    const right = Math.max(0, ...[...ext.values()].map(e => e.right))
    return { ext, linkLeft, left, right }
  }
  let w = nodeMax
  while (w > nodeMin) {
    const e = extents(w)
    if (e.left <= width / 2 && e.right <= width / 2) break
    w -= 1
  }
  const { linkLeft, left, right } = extents(w)
  const c = Math.max(width / 2, left)
  const nodes: Placed[] = []
  let top = 0
  let linkTop: number | null = null
  for (const n of rows) {
    const row = order.get(n)!
    const split = aroundMain(row, main)
    const rowH = split ? bigH : nodeH
    if (n >= 2 && linkTop === null) linkTop = top
    const at = (i: MapItem, x: number, isBig = false) =>
      nodes.push({ id: i.id, layer: n, x, y: top + (rowH - (isBig ? bigH : nodeH)) / 2, w: isBig ? big : w, big: isBig })
    if (split) {
      at(split.main, c - big / 2, true)
      split.before.forEach((i, k) => at(i, c - big / 2 - (split.before.length - k) * (w + g)))
      split.after.forEach((i, k) => at(i, c + big / 2 + g + k * (w + g)))
    } else {
      const x0 = c - (row.length * (w + g) - g) / 2
      row.forEach((i, k) => at(i, x0 + k * (w + g)))
    }
    top += rowH + layerGap
  }
  const start = linkTop ?? (rows.length ? top : 0)
  const lx = c - Math.max(width / 2, linkLeft)
  linked.forEach((i, k) => nodes.push({ id: i.id, layer: 'linked', x: lx, y: start + k * (nodeH + g), w, big: false }))
  return { nodes, width: Math.max(width, c + right) }
}

/** Narrow: each layer on a three-column grid (one node in the middle column, two in the outer ones), wrapping onto
 *  more grid rows; the main Safe in the middle column of layer 2's first; the linked group a two-column row under
 *  the last layer. */
function placeNarrow(order: Map<RowLayer, MapItem[]>, linked: MapItem[], main: string | null, width: number) {
  const { colGap: g, nodeMax, nodeH, bigH, layerGapNarrow } = LAYOUT
  const w = Math.max(1, Math.min(nodeMax, Math.floor((width - 2 * g) / 3)))
  const grid = 3 * w + 2 * g
  const x0 = Math.max(0, (width - grid) / 2)
  const COLS: Record<number, number[]> = { 1: [1], 2: [0, 2], 3: [0, 1, 2] }
  const nodes: Placed[] = []
  let top = 0
  const gridRow = (n: Layer, cells: Array<[MapItem, number]>, cw: number, step: number) => {
    const isBig = cells.some(([i]) => i.id === main)
    const rowH = isBig ? bigH : nodeH
    for (const [i, col] of cells) {
      const b = i.id === main
      nodes.push({ id: i.id, layer: n, x: x0 + col * step, y: top + (rowH - (b ? bigH : nodeH)) / 2, w: cw, big: b })
    }
    return rowH
  }
  const chunks = (row: MapItem[]) => Array.from({ length: Math.ceil(row.length / 3) }, (_, k) => row.slice(k * 3, k * 3 + 3))
  let any = false
  for (const n of ROW_LAYERS) {
    const row = order.get(n)!
    if (!row.length) continue
    if (any) top += layerGapNarrow
    any = true
    const split = aroundMain(row, main)
    const lines: Array<Array<[MapItem, number]>> = []
    if (split) {
      const before = split.before.at(-1)
      const after = split.after[0]
      lines.push([...(before ? [[before, 0] as [MapItem, number]] : []), [split.main, 1], ...(after ? [[after, 2] as [MapItem, number]] : [])])
      const rest = [...split.before.slice(0, -1), ...split.after.slice(1)]
      for (const c of chunks(rest)) lines.push(c.map((i, k) => [i, COLS[c.length]![k]!]))
    } else for (const c of chunks(row)) lines.push(c.map((i, k) => [i, COLS[c.length]![k]!]))
    lines.forEach((cells, k) => { if (k) top += g; top += gridRow(n, cells, w, w + g) })
  }
  if (linked.length) {
    if (any) top += layerGapNarrow
    const w2 = Math.max(1, Math.floor((grid - g) / 2))
    for (let k = 0; k < linked.length; k += 2) {
      if (k) top += g
      top += gridRow('linked', linked.slice(k, k + 2).map((i, c) => [i, c]), w2, w2 + g)
    }
  }
  return { nodes, width: Math.max(width, x0 + grid) }
}
