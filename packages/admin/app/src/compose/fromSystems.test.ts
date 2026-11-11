import { describe, it, expect } from 'vitest'
import { composeFromSystems } from './fromSystems.ts'
import { DEPLOYED, DEPLOYED_REMOVE, DEPLOYED_TREE, INTO_DEPLOYED, contextOf, opsForConnect, opsForDelete, opsForMove, opsForPlace, opsForRename, opsForText, opsForThreshold, treesOf } from '../elements/compose/compose.ts'
import { CHAIN_HELD_SENTENCE } from '../../../lib/chain-held.mjs'
import { membershipTree } from '../../../lib/rules.mjs'
import { COMPOSED_SAFE, COMPOSED_SYSTEMS, COMPOSED_TREE, COUNCIL_HAT, OWNERS, SEPOLIA } from '../test/fixtures/house/composed.ts'
import type { StageOp } from '../api.ts'

const ids = (c: ReturnType<typeof composeFromSystems>) => c.nodes.map(n => n.id)

describe('composeFromSystems (L7 Task 17): the canvas on the org’s composed Systems', () => {
  it('turns spec §4.1’s records into five nodes — Safe, tree, its hat, space, registration — and none for a link or a System the composition does not name', () => {
    const c = composeFromSystems(COMPOSED_SYSTEMS, [])
    expect(ids(c)).toEqual(['test-dao-safe', 'test-dao-roles', 'test-dao-roles/council', 'test-dao-votes', 'test-dao-registration'])
    expect(c.nodes.map(n => n.kind)).toEqual(['safe', 'hats-tree', 'hat', 'snapshot-space', 'daouri-registration'])
    expect(c.chain).toBe(SEPOLIA)
  })

  it('draws the relations the records state: the hat signs for the Safe, the Safe holds the tree, the space elects the hat', () => {
    const c = composeFromSystems(COMPOSED_SYSTEMS, [])
    expect(c.edges).toEqual([
      { from: 'test-dao-roles/council', to: 'test-dao-safe', label: 'signs' },
      { from: 'test-dao-safe', to: 'test-dao-roles', label: 'holds' },
      { from: 'test-dao-votes', to: 'test-dao-roles/council', label: 'elects' },
    ])
  })

  it('reads a relation written `system:<id>` as that System, and leaves out one to a hat ref or to no System', () => {
    const votes = { ...COMPOSED_SYSTEMS[2] as Record<string, unknown>, relates: [{ to: 'system:test-dao-safe', label: 'elects' }, { to: 'nowhere', label: 'elects' }, { to: `${SEPOLIA}:0x${'0'.repeat(64)}`, label: 'elects' }] }
    const c = composeFromSystems(COMPOSED_SYSTEMS.map(s => (s.id === 'test-dao-votes' ? votes : s)), [])
    expect(c.edges.filter(e => e.from === 'test-dao-votes')).toEqual([{ from: 'test-dao-votes', to: 'test-dao-safe', label: 'elects' }])
  })

  it('draws a deployed System a composed one relates to, as deployed, with its edge', () => {
    const votes = { ...COMPOSED_SYSTEMS[2] as Record<string, unknown>, relates: [{ to: 'forum', label: 'elects' }] }
    const c = composeFromSystems(COMPOSED_SYSTEMS.map(s => (s.id === 'test-dao-votes' ? votes : s)), [])
    expect(c.nodes.find(n => n.id === 'forum')).toMatchObject({ kind: 'link', deployed: true })
    expect(c.edges).toContainEqual({ from: 'test-dao-votes', to: 'forum', label: 'elects' })
  })

  it('a hat node carries the whole hat, a tree its deployment and a Safe its gate, so an edit keeps every field it does not touch', () => {
    const c = composeFromSystems(COMPOSED_SYSTEMS, [])
    const hat = c.nodes.find(n => n.id === 'test-dao-roles/council')!
    expect(hat).toMatchObject({ kind: 'hat', tree: 'test-dao-roles', name: 'Council', order: 0, wearers: OWNERS, hat: COUNCIL_HAT })
    expect(c.nodes.find(n => n.id === 'test-dao-roles')!.deployment).toEqual(COMPOSED_TREE.deployment)
    const safe = c.nodes.find(n => n.id === 'test-dao-safe')!
    expect(safe).toMatchObject({ owners: OWNERS, threshold: 2, order: 1, x: 360, y: 220, deployment: COMPOSED_SAFE.deployment, gate: COMPOSED_SAFE.signer_gate })
    // a rename of the hat rewrites the tree's whole list, every stored field kept (max_supply 5, role, image)
    const trees = treesOf(c.nodes, c.edges)
    expect(opsForRename('test-dao-roles/council', 'Stewards', { trees, chain: c.chain })).toEqual([
      { op: 'update', record: 'systems:test-dao-roles', set: { hats: [{ ...COUNCIL_HAT, details: 'Stewards' }] } },
    ])
    // a Safe's threshold keeps its salt and on_deploy
    expect(opsForThreshold(safe, 3)).toEqual([{ op: 'update', record: 'systems:test-dao-safe', set: { deployment: { ...COMPOSED_SAFE.deployment, threshold: 3 } } }])
    // connecting the hat again sets the gate's whole list, its threshold and claimable_for kept
    const gates = { 'test-dao-safe': safe.gate! }
    expect(opsForConnect('test-dao-roles/council', c.edges, { trees, chain: c.chain, gates })).toEqual([
      { op: 'update', record: 'systems:test-dao-safe', set: { signer_gate: { ...COMPOSED_SAFE.signer_gate, hats: ['test-dao-roles/council'] } } },
    ])
  })

  it('shows what the actor’s change stages at once: a rename, a new composed System, a removal', () => {
    const staged: StageOp[] = [
      { op: 'update', record: 'systems:test-dao-safe', set: { name: 'Council Safe' } },
      { op: 'create', record: 'systems:safe-2', value: { id: 'safe-2', kind: 'safe', driver: 'safe', name: 'New Safe', chain: SEPOLIA, position: { x: 100, y: 400 }, order: 7, deployment: { status: 'composed' } } },
      { op: 'delete', record: 'systems:test-dao-registration' },
      { op: 'update', record: 'boards:test-dao-council', set: { name: 'Not a System' } },
    ]
    const c = composeFromSystems(COMPOSED_SYSTEMS, staged)
    expect(c.nodes.find(n => n.id === 'test-dao-safe')!.name).toBe('Council Safe')
    expect(ids(c)).toContain('safe-2')
    expect(ids(c)).not.toContain('test-dao-registration')
  })

  it('a deployed System the composition names is drawn as deployed; with nothing composed there is nothing to draw', () => {
    const tree = { ...COMPOSED_TREE, deployment: { status: 'deployed', read_back: '2026-11-05' }, address: '42' }
    const c = composeFromSystems(COMPOSED_SYSTEMS.map(s => (s.id === 'test-dao-roles' ? tree : s)), [])
    expect(c.nodes.find(n => n.id === 'test-dao-roles')).toMatchObject({ deployed: true })
    expect(composeFromSystems([COMPOSED_SYSTEMS[4]!, COMPOSED_SYSTEMS[5]!], [])).toEqual({ nodes: [], edges: [], chain: SEPOLIA })
  })

  it('places a System with no position of its own, and each hat beside its tree, never off the canvas', () => {
    const c = composeFromSystems(COMPOSED_SYSTEMS, [])
    for (const n of c.nodes) { expect(n.x).toBeGreaterThanOrEqual(95); expect(n.y).toBeGreaterThanOrEqual(28) }
    const votes = c.nodes.find(n => n.id === 'test-dao-votes')!
    expect(c.nodes.filter(n => n.id !== votes.id).some(n => n.x === votes.x && n.y === votes.y)).toBe(false)
  })
})

// The paired review of Tasks 19 and 17 (probe-l7t1917/p1): records the canvas draws only in part.
describe('the canvas’s ops on records it draws only in part (L7 Tasks 19/17 review)', () => {
  const HATREF = `${SEPOLIA}:0x${'0000000100010000'.padEnd(64, '0')}`
  const systems: Record<string, unknown>[] = [
    // deployed, framed by hand: no `deployment` (as the seed's systems are)
    { id: 'dao-hats', kind: 'hats-tree', name: 'DAO hats', chain: SEPOLIA, address: '42', driver: 'hats-tree' },
    { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: SEPOLIA, address: `0x${'1'.repeat(40)}`, driver: 'safe',
      relates: [{ to: HATREF, label: 'holds' }, { to: 'hidden-system', label: 'admin' }] },
    { id: 'council', kind: 'hats-tree', name: 'Council', chain: SEPOLIA, position: { x: 300, y: 100 }, order: 2,
      deployment: { status: 'composed', top: { details: 'Top', worn_by: 'treasury-safe' } },
      hats: [{ key: 'signers', details: 'Signers', admin: 'top', max_supply: 3, mutable: true, wearers: [], role: 'acts', hat: null }] },
    { id: 'council-safe', kind: 'safe', name: 'Council Safe', chain: SEPOLIA, position: { x: 300, y: 300 }, order: 1,
      deployment: { status: 'composed', owners: [`0x${'2'.repeat(40)}`], threshold: 1 },
      relates: [{ to: HATREF, label: 'holds', note: 'kept as written' }, { to: 'hidden-system', label: 'admin' }, { to: 'system:council', label: 'holds' }] },
  ]
  const at = (list: Record<string, unknown>[]) => {
    const c = composeFromSystems(list, [])
    return { ...c, ctx: (edges: typeof c.edges) => contextOf(c.nodes, edges, c.chain) }
  }

  it('I2: a connect keeps every stored relation whose end the canvas does not draw, byte for byte, and the drawn ones as written', () => {
    const c = at(systems.map(s => (s.id === 'council-safe' ? { ...s, relates: [(s.relates as unknown[])[0], (s.relates as unknown[])[1], { to: 'system:treasury-safe', label: 'admin' }] } : s)))
    const next = [...c.edges, { from: 'council-safe', to: 'council/signers', label: 'holds' }]
    const ops = opsForConnect('council-safe', next, c.ctx(next)) as StageOp[]
    expect(ops).toEqual([{ op: 'update', record: 'systems:council-safe', set: { relates: [
      { to: HATREF, label: 'holds', note: 'kept as written' }, { to: 'hidden-system', label: 'admin' }, { to: 'system:treasury-safe', label: 'admin' },
      { to: 'council/signers', label: 'holds' },
    ] } }])
  })

  it('I2: a delete drops only the relation to what goes, and keeps the rest', () => {
    const c = at(systems.map(s => (s.id === 'council-safe' ? { ...s, relates: [(s.relates as unknown[])[0], (s.relates as unknown[])[1], { to: 'council/signers', label: 'holds' }] } : s)))
    const ops = opsForDelete('council/signers', c.edges, c.ctx(c.edges)) as StageOp[]
    expect(ops).toContainEqual({ op: 'update', record: 'systems:council-safe', set: { relates: [{ to: HATREF, label: 'holds', note: 'kept as written' }, { to: 'hidden-system', label: 'admin' }] } })
  })

  const after = (list: Record<string, unknown>[], ops: StageOp[]) => list.map(r => {
    const o = ops.find(x => 'record' in x && x.record === `systems:${String(r.id)}`) as { op: string; set?: Record<string, unknown> } | undefined
    return o?.op === 'update' ? { ...r, ...o.set } : r
  })
  const touches = (ops: StageOp[] | string, id: string) => typeof ops !== 'string' && ops.some(o => 'record' in o && o.record === `systems:${id}`)
  const gov = { membership: { tree: 'dao-hats' } }

  it('I1 (probe 2b): an unrelated connect from a composed Safe that relates to the deployed tree stages nothing on the tree; the membership tree stands', () => {
    const list = systems.map(s => (s.id === 'council-safe' ? { ...s, relates: [{ to: 'dao-hats', label: 'holds' }] } : s))
    const c = at(list)
    const next = [...c.edges, { from: 'council-safe', to: 'council/signers', label: 'holds' }]
    const ops = opsForConnect('council-safe', next, c.ctx(next)) as StageOp[]
    expect(touches(ops, 'dao-hats')).toBe(false)
    expect(ops).toEqual([{ op: 'update', record: 'systems:council-safe', set: { relates: [{ to: 'dao-hats', label: 'holds' }, { to: 'council/signers', label: 'holds' }] } }])
    expect(membershipTree(gov, after(list, ops))).toEqual(membershipTree(gov, list))
    expect(membershipTree(gov, list)).toMatchObject({ id: 'dao-hats' })
  })

  it('I1 (probe 2): a composed Safe connected to a deployed tree writes its own relates only', () => {
    const list = systems.map(s => (s.id === 'council-safe' ? { ...s, relates: [] } : s))
    const c = at(list.map(s => (s.id === 'council' ? { ...s, relates: [{ to: 'dao-hats', label: 'holds' }] } : s)))
    expect(c.nodes.find(n => n.id === 'dao-hats')).toMatchObject({ deployed: true })
    const next = [...c.edges, { from: 'council-safe', to: 'dao-hats', label: 'holds' }]
    const ops = opsForConnect('council-safe', next, c.ctx(next)) as StageOp[]
    expect(ops).toEqual([{ op: 'update', record: 'systems:council-safe', set: { relates: [{ to: 'dao-hats', label: 'holds' }] } }])
  })

  it('B1 (was I1 probe 1, 3): a deployed System is moved, renamed and connected from like any record; it is not removed on the canvas', () => {
    const c = at(systems)
    const next = [...c.edges, { from: 'treasury-safe', to: 'council/signers', label: 'holds' }]
    // its relates as the edges stand, every stored entry the canvas does not draw kept byte for byte
    const connected = opsForConnect('treasury-safe', next, c.ctx(next)) as StageOp[]
    expect(connected[0]).toEqual({ op: 'update', record: 'systems:treasury-safe', set: { relates: [
      { to: HATREF, label: 'holds' }, { to: 'hidden-system', label: 'admin' }, { to: 'council/signers', label: 'holds' },
    ] } })
    // the rest is the composed tree it already wears, kept as it is: nothing else of a deployed record is written
    expect(connected.slice(1).map(o => (o as { record: string }).record)).toEqual(['systems:council'])
    expect(opsForDelete('treasury-safe', c.edges, c.ctx(c.edges))).toBe(DEPLOYED_REMOVE)
    expect(opsForMove({ ...c.nodes.find(n => n.id === 'treasury-safe')!, x: 999 })).toEqual([{ op: 'update', record: 'systems:treasury-safe', set: { position: { x: 999, y: c.nodes.find(n => n.id === 'treasury-safe')!.y } } }])
    expect(opsForRename('treasury-safe', 'Vault', c.ctx(c.edges))).toEqual([{ op: 'update', record: 'systems:treasury-safe', set: { name: 'Vault' } }])
    expect(opsForText('treasury-safe', 'notes', '  Signs.  ')).toEqual([{ op: 'update', record: 'systems:treasury-safe', set: { notes: 'Signs.' } }])
    expect(opsForText('treasury-safe', 'description', '')).toEqual([{ op: 'update', record: 'systems:treasury-safe', set: { description: null } }])
  })

  it('B1: a deployed tree\'s hats are the chain\'s: a hat of it is not renamed, nor made to appoint', () => {
    const list = systems.map(s => (s.id === 'council-safe' ? { ...s, relates: [{ to: 'dao-hats', label: 'holds' }] }
      : s.id === 'dao-hats' ? { ...s, deployment: { status: 'deployed', read_back: '2026-11-05' }, hats: [{ key: 'member', hat: HATREF }, { key: 'guest', hat: HATREF.replace('0001', '0002') }] } : s))
    const c = at(list)
    expect(opsForRename('dao-hats/member', 'Members', c.ctx(c.edges))).toBe(CHAIN_HELD_SENTENCE('hats'))
    const next = [...c.edges, { from: 'dao-hats/member', to: 'dao-hats/guest', label: 'appoints' }]
    expect(opsForConnect('dao-hats/member', next, c.ctx(next))).toBe(CHAIN_HELD_SENTENCE('hats'))
  })

  it('B1: removing a composed System rewrites the relates of a deployed one that names it', () => {
    const list = systems.map(s => (s.id === 'treasury-safe' ? { ...s, relates: [...(s.relates as unknown[]), { to: 'council-safe', label: 'admin' }] } : s))
    const c = at(list)
    const ops = opsForDelete('council-safe', c.edges, c.ctx(c.edges)) as StageOp[]
    expect(ops).toContainEqual({ op: 'update', record: 'systems:treasury-safe', set: { relates: [{ to: HATREF, label: 'holds' }, { to: 'hidden-system', label: 'admin' }] } })
  })

  it('I1: a connect that would write a deployed record (a hat that signs for a deployed Safe) is refused in words', () => {
    const c = at(systems)
    const next = [...c.edges, { from: 'council/signers', to: 'treasury-safe', label: 'signs' }]
    expect(opsForConnect('council/signers', next, c.ctx(next))).toBe(INTO_DEPLOYED)
  })

  it('I1: no hat is placed into a deployed tree', () => {
    const c = at(systems.map(s => (s.id === 'council-safe' ? { ...s, relates: [{ to: 'dao-hats', label: 'holds' }] } : s)))
    const ctx = c.ctx(c.edges)
    expect(Object.hasOwn(ctx.trees, 'dao-hats')).toBe(true)
    expect(opsForPlace({ id: 'dao-hats/new-hat', kind: 'hat', tree: 'dao-hats', name: 'New hat', x: 0, y: 0, order: 0 }, ctx)).toBe(DEPLOYED_TREE)
  })

  it('I1: a Safe holding a tree whose deployment is not known to be composed is refused, never written as composed', () => {
    const c = at(systems)
    const nodes = c.nodes.map(n => (n.id === 'council' ? { ...n, deployment: undefined } : n))
    const next = [...c.edges, { from: 'council-safe', to: 'council', label: 'holds' }]
    expect(typeof opsForConnect('council-safe', next, contextOf(nodes, next, c.chain))).toBe('string')
  })
})

