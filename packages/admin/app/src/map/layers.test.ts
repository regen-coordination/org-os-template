import { describe, it, expect } from 'vitest'
import house from '../design/skins/house.css?raw'
import { blockAfter, declarations } from '../design/skins/read.ts'
import {
  CROSSED, CYCLE, MAIN_SAFE, MAP_COUNCIL, MAP_GARDEN, MAP_GITCOIN, MAP_ITEMS, MAP_KARMA, MAP_STARTER, MAP_LINKS, MAP_NETWORK,
  MAP_OPERATIONS, MAP_SIGNER, MAP_TREASURY, MAP_VOTES, MAP_WALLET, ONE_SAFE, SAFE_UNDER_SAFE, TIES, UNLINKED,
} from '../test/fixtures/house/map.ts'
import { LAYOUT, layerOf, layoutMap, mainSafeOf, type MapLayout, type MapLink, type Placed } from './layers.ts'

const byId = (l: MapLayout) => new Map(l.nodes.map(n => [n.id, n]))
const centre = (n: Placed) => n.x + n.w / 2
const height = (n: Placed) => (n.big ? LAYOUT.bigH : LAYOUT.nodeH)

/** Pairs of edges between adjacent layers that cross: their ends are in opposite orders in the two layers. */
function crossings(l: MapLayout, links: MapLink[]): Array<[string, string]> {
  const at = byId(l)
  const spans = links.flatMap(k => {
    const [a, b] = [at.get(k.from), at.get(k.to)]
    if (!a || !b || typeof a.layer !== 'number' || typeof b.layer !== 'number' || Math.abs(a.layer - b.layer) !== 1) return []
    const [up, down] = a.layer < b.layer ? [a, b] : [b, a]
    return [{ name: `${k.from}>${k.to}`, top: up.layer as number, ux: centre(up), dx: centre(down) }]
  })
  const out: Array<[string, string]> = []
  spans.forEach((s, i) => spans.slice(i + 1).forEach(t => {
    if (s.top === t.top && (s.ux - t.ux) * (s.dx - t.dx) < 0) out.push([s.name, t.name])
  }))
  return out
}

/** Two placed nodes whose boxes overlap. */
function overlaps(l: MapLayout): Array<[string, string]> {
  const out: Array<[string, string]> = []
  l.nodes.forEach((a, i) => l.nodes.slice(i + 1).forEach(b => {
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + height(a) <= b.y || b.y + height(b) <= a.y
    if (!apart) out.push([a.id, b.id])
  }))
  return out
}

describe('layerOf (§8.2)', () => {
  it('puts each kind in its layer; a hat goes by its role; a link System is linked', () => {
    expect(layerOf({ id: 's', kind: 'snapshot-space', name: 's' })).toBe(0)
    expect(layerOf({ id: 'h', kind: 'hat', name: 'h', role: 'decides' })).toBe(0)
    expect(layerOf({ id: 'h', kind: 'hat', name: 'h', role: 'acts' })).toBe(1)
    expect(layerOf({ id: 'w', kind: 'wallet', name: 'w' })).toBe(1)
    expect(layerOf({ id: 's', kind: 'safe', name: 's' })).toBe(2)
    expect(layerOf({ id: 'g', kind: 'gardens-community', name: 'g' })).toBe(3)
    expect(layerOf({ id: 'p', kind: 'gardens-pool', name: 'p' })).toBe(3)
    expect(layerOf({ id: 'l', kind: 'link', name: 'l' })).toBe('linked')
    expect(layerOf({ id: 'l', kind: 'link', name: 'l', role: 'decides' })).toBe('linked')
  })

  it('reads a role only on a hat: a pool, a Snapshot space or a wallet given one stays in its kind’s layer (B7 review M-1)', () => {
    expect(layerOf({ id: 'p', kind: 'gardens-pool', name: 'p', role: 'acts' })).toBe(3)
    expect(layerOf({ id: 's', kind: 'snapshot-space', name: 's', role: 'acts' })).toBe(0)
    expect(layerOf({ id: 'w', kind: 'wallet', name: 'w', role: 'decides' })).toBe(1)
    expect(layerOf({ id: 'h', kind: 'hat', name: 'h', role: 'decides' })).toBe(0)
  })

  it('a hat with no role acts; a kind it does not know is fed (layer 3)', () => {
    expect(layerOf({ id: 'h', kind: 'hat', name: 'h' })).toBe(1)
    expect(layerOf({ id: 't', kind: 'hats-tree', name: 't' })).toBe(1)
    expect(layerOf({ id: 'x', kind: 'something-new', name: 'x' })).toBe(3)
  })
})

describe('layoutMap', () => {
  it('the Example-DAO-shaped fixture layers as §8.2 says', () => {
    const l = layoutMap(MAP_ITEMS, MAP_LINKS, { width: 1200 })
    const at = byId(l)
    const layer = (id: string) => at.get(id)!.layer
    expect([MAP_VOTES, MAP_COUNCIL].map(i => layer(i.id))).toEqual([0, 0])
    expect([MAP_OPERATIONS, MAP_SIGNER, MAP_WALLET].map(i => layer(i.id))).toEqual([1, 1, 1])
    expect(layer(MAP_TREASURY.id)).toBe(2)
    expect([MAP_GARDEN, MAP_NETWORK, MAP_STARTER].map(i => layer(i.id))).toEqual([3, 3, 3])
    expect([MAP_KARMA, MAP_GITCOIN].map(i => layer(i.id))).toEqual(['linked', 'linked'])

    const treasury = at.get(MAP_TREASURY.id)!
    expect(l.mainSafe).toBe(MAP_TREASURY.id)
    expect(treasury).toMatchObject({ big: true, w: LAYOUT.big })
    expect(centre(treasury)).toBe(l.width / 2)
    expect(l.nodes.filter(n => n.big).map(n => n.id)).toEqual([MAP_TREASURY.id])
    expect(l.narrow).toBe(false)
    expect(l.width).toBe(1200)

    // top to bottom by authority; the gaps are the layer gap; the linked group to the start side of layers 2–3
    const top = (n: 0 | 1 | 2 | 3) => Math.min(...l.nodes.filter(p => p.layer === n).map(p => p.y))
    expect(top(1) - top(0)).toBe(LAYOUT.nodeH + LAYOUT.layerGap)
    expect(top(2) - top(1)).toBe(LAYOUT.nodeH + LAYOUT.layerGap)
    expect(top(3) - top(2)).toBe(LAYOUT.bigH + LAYOUT.layerGap)
    const linked = l.nodes.filter(n => n.layer === 'linked')
    const lower = l.nodes.filter(n => n.layer === 2 || n.layer === 3)
    for (const n of linked) {
      expect(n.y).toBeGreaterThanOrEqual(top(2))
      expect(n.x + n.w).toBeLessThanOrEqual(Math.min(...lower.map(p => p.x)) - LAYOUT.colGap)
    }
    expect(new Set(linked.map(n => n.x)).size).toBe(1)
    for (const n of l.nodes.filter(p => !p.big)) expect(n.w).toBeGreaterThanOrEqual(LAYOUT.nodeMin), expect(n.w).toBeLessThanOrEqual(LAYOUT.nodeMax)
    expect(overlaps(l)).toEqual([])
    expect(Math.min(...l.nodes.map(n => n.x))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...l.nodes.map(n => n.x + n.w))).toBeLessThanOrEqual(l.width)
    expect(Math.max(...l.nodes.map(n => n.y + height(n)))).toBe(l.height)
  })

  it('a node tied to others in its own layer only sits beside them: a source before, between two', () => {
    const l = layoutMap(MAP_ITEMS, MAP_LINKS, { width: 1200 })
    const row = (n: number) => l.nodes.filter(p => p.layer === n).sort((a, b) => a.x - b.x).map(p => p.id)
    expect(row(0)).toEqual([MAP_VOTES.id, MAP_COUNCIL.id])
    expect(row(1)).toEqual([MAP_OPERATIONS.id, MAP_WALLET.id, MAP_SIGNER.id])
    expect(row(3)).toEqual([MAP_STARTER.id, MAP_GARDEN.id, MAP_NETWORK.id])
  })

  it('fits a narrower map by narrowing its nodes, never below the floor', () => {
    const l = layoutMap(MAP_ITEMS, MAP_LINKS, { width: 1040 })
    expect(l.width).toBe(1040)
    expect(overlaps(l)).toEqual([])
    expect(centre(byId(l).get(MAP_TREASURY.id)!)).toBe(520)
    const w = l.nodes.find(n => !n.big)!.w
    expect(w).toBeLessThan(LAYOUT.nodeMax)
    expect(w).toBeGreaterThanOrEqual(LAYOUT.nodeMin)
    expect(Math.max(...l.nodes.map(n => n.x + n.w))).toBeLessThanOrEqual(1040)
  })

  it('no two edges between adjacent layers cross in the fixture', () => {
    expect(crossings(layoutMap(MAP_ITEMS, MAP_LINKS, { width: 1200 }), MAP_LINKS)).toEqual([])
    expect(crossings(layoutMap(MAP_ITEMS, MAP_LINKS, { width: 390 }), MAP_LINKS)).toEqual([])
    // two councils that each appoint the other's signer: name order would cross them
    const l = layoutMap(CROSSED.items, CROSSED.links, { width: 1200 })
    expect(crossings(l, CROSSED.links)).toEqual([])
    expect(l.nodes.filter(n => n.layer === 1).sort((a, b) => a.x - b.x).map(n => n.id)).toEqual(['system:signer-b', 'system:signer-a'])
  })

  it('ties break by name', () => {
    const l = layoutMap(TIES.items, TIES.links, { width: 1200 })
    expect(l.nodes.filter(n => n.layer === 3).sort((a, b) => a.x - b.x).map(n => n.id)).toEqual(['system:pool-a', 'system:pool-b', 'system:pool-c'])
    // Systems with no links at all: each in its layer, once, the layer in name order
    const u = layoutMap(UNLINKED, [], { width: 1200 })
    expect(u.nodes.map(n => [n.id, n.layer])).toEqual([
      ['system:space', 0], ['system:ops', 1], ['system:vault', 2], ['system:fund', 3], ['system:forum', 'linked'],
    ])
    expect(u.mainSafe).toBe('system:vault')
    expect(overlaps(u)).toEqual([])
  })

  it('an empty map', () => {
    expect(layoutMap([], [], { width: 1200 })).toEqual({ nodes: [], width: 0, height: 0, mainSafe: null, narrow: false })
    expect(layoutMap([], [], { width: 390 })).toEqual({ nodes: [], width: 0, height: 0, mainSafe: null, narrow: true })
    expect(mainSafeOf([], [])).toBeNull()
    expect(mainSafeOf(UNLINKED.filter(i => i.kind !== 'safe'), [])).toBeNull()
  })

  it('one Safe is the main Safe', () => {
    const l = layoutMap(ONE_SAFE, [], { width: 1200 })
    expect(l.mainSafe).toBe('system:only')
    expect(l.nodes).toEqual([{ id: 'system:only', layer: 2, x: 600 - LAYOUT.big / 2, y: 0, w: LAYOUT.big, big: true }])
    expect(l.height).toBe(LAYOUT.bigH)
  })

  it('the main Safe is the one in organization/treasury, else most incoming links, the tie breaks by name', () => {
    expect(mainSafeOf(MAP_ITEMS, MAP_LINKS)).toBe(MAP_TREASURY.id)
    expect(mainSafeOf([...MAIN_SAFE.inTreasury.items], [...MAIN_SAFE.inTreasury.links])).toBe('system:treasury-safe')
    expect(mainSafeOf([...MAIN_SAFE.mostLinks.items], [...MAIN_SAFE.mostLinks.links])).toBe('system:safe-b')
    expect(mainSafeOf([...MAIN_SAFE.tied.items], [...MAIN_SAFE.tied.links])).toBe('system:safe-a')
    // two Safes in organization/treasury: the one more edges point at
    const both = [...MAIN_SAFE.inTreasury.items].map(i => (i.kind === 'safe' ? { ...i, section: 'organization/treasury' } : i))
    expect(mainSafeOf(both, [...MAIN_SAFE.inTreasury.links])).toBe('system:side-safe')
    // a Safe whose read failed never wins the tie (walk 2026-11-04, L4c-fix 1): the name would give it safe-a
    const failedA = [...MAIN_SAFE.tied.items].map(i => (i.id === 'system:safe-a' ? { ...i, failed: true as const } : i))
    expect(mainSafeOf(failedA, [...MAIN_SAFE.tied.links])).toBe('system:safe-b')
    // the tie, laid out: the main Safe centred and big, the other beside it in layer 2
    const l = layoutMap([...MAIN_SAFE.tied.items], [...MAIN_SAFE.tied.links], { width: 1200 })
    const at = byId(l)
    expect(at.get('system:safe-a')).toMatchObject({ layer: 2, big: true, w: LAYOUT.big })
    expect(centre(at.get('system:safe-a')!)).toBe(600)
    expect(at.get('system:safe-b')).toMatchObject({ layer: 2, big: false })
    expect(overlaps(l)).toEqual([])
  })

  it('a Safe another Safe administers goes to layer 3; the main Safe stays in layer 2', () => {
    const l = layoutMap(SAFE_UNDER_SAFE.items, SAFE_UNDER_SAFE.links, { width: 1200 })
    const at = byId(l)
    expect(l.mainSafe).toBe('system:main')
    expect([at.get('system:main')!.layer, at.get('system:fed')!.layer, at.get('system:beside')!.layer]).toEqual([2, 3, 2])
  })

  it('a cycle terminates and places every node once', () => {
    for (const width of [1200, 390]) {
      const l = layoutMap(CYCLE.items, CYCLE.links, { width })
      expect(l.nodes.map(n => n.id).sort()).toEqual(CYCLE.items.map(i => i.id).sort())
      expect(l.mainSafe).toBe('system:safe-x') // two incoming links (Safe Y, the cycle's Safe) against one each
      const at = byId(l)
      expect(at.get('system:safe-x')!.layer).toBe(2)
      expect(at.get('system:safe-y')!.layer).toBe(3) // Safe X administers it
      expect(at.get('system:cycle-safe')!.layer).toBe(2)
      expect(overlaps(l)).toEqual([])
    }
  })

  it('places an item once when listed twice, and ignores links to nodes that are not on the map', () => {
    const l = layoutMap([...ONE_SAFE, ...ONE_SAFE], [{ from: 'system:only', to: 'system:gone', label: 'admin' }, { from: 'system:only', to: 'system:only', label: 'self' }], { width: 1200 })
    expect(l.nodes.map(n => n.id)).toEqual(['system:only'])
    expect(mainSafeOf(ONE_SAFE, [{ from: 'system:gone', to: 'system:only', label: 'signs' }])).toBe('system:only')
  })

  it('narrow at 390 is three columns, the linked group two', () => {
    const l = layoutMap(MAP_ITEMS, MAP_LINKS, { width: 390 })
    expect(l.narrow).toBe(true)
    expect(l.width).toBe(390)
    const layered = l.nodes.filter(n => n.layer !== 'linked')
    const linked = l.nodes.filter(n => n.layer === 'linked')
    expect(new Set(layered.map(n => n.x)).size).toBe(3)
    expect(new Set(linked.map(n => n.x)).size).toBe(2)
    expect(new Set(linked.map(n => n.y)).size).toBe(1)
    expect(Math.min(...linked.map(n => n.y))).toBeGreaterThan(Math.max(...layered.map(n => n.y)))
    // every layer node is one column wide, the main Safe too (it keeps its big face), in the middle column
    expect(new Set(layered.map(n => n.w)).size).toBe(1)
    const treasury = byId(l).get(MAP_TREASURY.id)!
    expect(treasury.big).toBe(true)
    expect(centre(treasury)).toBe(195)
    const gaps = [0, 1, 2, 3].map(n => Math.min(...layered.filter(p => p.layer === n).map(p => p.y)))
    expect(gaps[1]! - gaps[0]!).toBe(LAYOUT.nodeH + LAYOUT.layerGapNarrow)
    expect(overlaps(l)).toEqual([])
    expect(Math.min(...l.nodes.map(n => n.x))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...l.nodes.map(n => n.x + n.w))).toBeLessThanOrEqual(390)
    // a wide map stays wide at the threshold
    expect(layoutMap(MAP_ITEMS, MAP_LINKS, { width: LAYOUT.narrowAt }).narrow).toBe(false)
    expect(layoutMap(MAP_ITEMS, MAP_LINKS, { width: LAYOUT.narrowAt - 1 }).narrow).toBe(true)
  })

  it('a narrow layer with more than three nodes wraps onto more rows of the grid', () => {
    const items = [...TIES.items, { id: 'system:pool-d', kind: 'gardens-pool', name: 'Pool D' }]
    const l = layoutMap(items, TIES.links, { width: 390 })
    const fed = l.nodes.filter(n => n.layer === 3)
    expect(new Set(fed.map(n => n.y)).size).toBe(2)
    expect(overlaps(l)).toEqual([])
  })

  it('the same input gives a deep-equal layout, in any order', () => {
    for (const width of [1200, 390]) {
      const once = layoutMap(MAP_ITEMS, MAP_LINKS, { width })
      expect(layoutMap(MAP_ITEMS, MAP_LINKS, { width })).toEqual(once)
      expect(layoutMap([...MAP_ITEMS].reverse(), [...MAP_LINKS].reverse(), { width })).toEqual(once)
    }
  })
})

describe('LAYOUT', () => {
  it("holds the spec's numbers, its node widths and heights the house's tokens (CC-12)", () => {
    expect(LAYOUT).toMatchObject({ layerGap: 64, layerGapNarrow: 52, colGap: 16, nodeMin: 148, nodeMax: 200, big: 236, narrowAt: 680 })
    const t = declarations(blockAfter(house, ':root[data-skin="house"] {'))
    expect([t['w-node-min'], t['w-node'], t['w-node-big']]).toEqual([`${LAYOUT.nodeMin}px`, `${LAYOUT.nodeMax}px`, `${LAYOUT.big}px`])
    // B7-4: the heights a row is laid out at are the heights the map draws its nodes at
    expect([t['h-node'], t['h-node-big']]).toEqual([`${LAYOUT.nodeH}px`, `${LAYOUT.bigH}px`])
  })
})
