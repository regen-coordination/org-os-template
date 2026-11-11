import { describe, it, expect } from 'vitest'
import { COMPOSE, CROSS_TREE, DRAG_THRESHOLD_PX, canConnect, treesOf, moveBy, nextOrder, opsForConnect, opsForDelete, opsForMove, opsForPlace, opsForRename, preparedCount, relationOf, type ComposeEdge, type ComposeNode, type ComposedHat } from './compose.ts'

const node = (id: string, kind: string, x = 100, y = 100, order = 1): ComposeNode => ({ id, kind, name: id, x, y, order })

describe('canConnect (§8.7): what may connect to what, by kind', () => {
  it('lets a hat sign for a Safe, a Snapshot space elect a hat, a hat appoint a hat, a Safe admin a pool', () => {
    expect(canConnect('hat', 'safe')).toBe(true)
    expect(canConnect('snapshot-space', 'hat')).toBe(true)
    expect(canConnect('hat', 'hat')).toBe(true)
    expect(canConnect('safe', 'gardens-pool')).toBe(true)
    expect(canConnect('hats-tree', 'hat')).toBe(true)
  })

  it('refuses a link signing for a Safe with the spec’s sentence: why, then what fits', () => {
    expect(canConnect('link', 'safe')).toBe('A link can’t sign for a Safe. Connect a hat or addresses.')
  })

  it('refuses every other pair with a sentence that names both kinds and what fits', () => {
    expect(canConnect('gardens-pool', 'hat')).toBe('A Gardens pool can’t appoint a hat. Connect a hat, a Hats tree, a Snapshot space or a Safe.')
    expect(canConnect('hat', 'snapshot-space')).toBe('Nothing connects into a Snapshot space: it is where the vote is held.')
    expect(canConnect('safe', 'link')).toBe('Nothing connects into a link: it is listed, never read.')
  })

  it('names each allowed relation in plain words (§8.4)', () => {
    expect(relationOf('hat', 'safe')).toBe('signs')
    expect(relationOf('snapshot-space', 'hat')).toBe('elects')
    expect(relationOf('safe', 'gardens-pool')).toBe('admin')
    expect(relationOf('link', 'safe')).toBeNull()
  })
})

describe('moveBy (§8.7, 2.5.7): arrows move a node 8px, Shift+arrows 40px', () => {
  const n = node('a', 'hat', 200, 200)
  it('moves by 8 along the arrow', () => {
    expect(moveBy(n, 'ArrowRight', false)).toEqual({ ...n, x: 208 })
    expect(moveBy(n, 'ArrowLeft', false)).toEqual({ ...n, x: 192 })
    expect(moveBy(n, 'ArrowUp', false)).toEqual({ ...n, y: 192 })
    expect(moveBy(n, 'ArrowDown', false)).toEqual({ ...n, y: 208 })
  })
  it('moves by 40 with Shift', () => {
    expect(moveBy(n, 'ArrowRight', true)).toEqual({ ...n, x: 240 })
    expect(moveBy(n, 'ArrowUp', true)).toEqual({ ...n, y: 160 })
  })
  it('never moves a node off the canvas’s top or start, and leaves other keys alone', () => {
    expect(moveBy(node('b', 'hat', 4, 4), 'ArrowLeft', true)).toMatchObject({ x: COMPOSE.nodeW / 2 })
    expect(moveBy(node('b', 'hat', 4, 4), 'ArrowUp', true)).toMatchObject({ y: COMPOSE.nodeH / 2 })
    expect(moveBy(n, 'Enter', false)).toBe(n)
  })
})

describe('the ops each action stages (nothing writes)', () => {
  const hat = (key: string, admin = 'top', over: Partial<ComposedHat> = {}): ComposedHat => ({ key, details: key, admin, max_supply: 1, mutable: true, wearers: [], role: 'acts', hat: null, ...over })
  const CHAIN = 'eip155:11155111'
  const ctx = { trees: { roles: [hat('council'), hat('stewards', 'council')] } as Record<string, ComposedHat[]>, chain: CHAIN }
  const nodes = [node('roles', 'hats-tree', 100, 60, 1), node('vault', 'safe', 100, 260, 3), node('forum', 'link', 300, 160, 0)]
  const edges: ComposeEdge[] = [{ from: 'roles', to: 'vault', label: 'holds' }]

  it('placing a Safe stages a create with its driver, chain and a composed deployment', () => {
    expect(opsForPlace(node('safe-2', 'safe', 200, 150, 4), ctx)).toEqual([
      { op: 'create', record: 'systems:safe-2', value: { id: 'safe-2', kind: 'safe', driver: 'safe', name: 'safe-2', chain: CHAIN, position: { x: 200, y: 150 }, order: 4, deployment: { status: 'composed' } } },
    ])
  })

  it('placing a hat with no Hats tree is refused in words', () => {
    expect(opsForPlace({ ...node('roles/new-hat', 'hat', 0, 0, 0), tree: undefined }, { trees: {}, chain: CHAIN })).toBe('A hat lives in a Hats tree. Place a Hats tree first.')
    expect(opsForPlace({ ...node('ghost/new-hat', 'hat', 0, 0, 0), tree: 'ghost' }, ctx)).toBe('A hat lives in a Hats tree. Place a Hats tree first.')
  })

  it('placing a hat in a tree stages the tree’s whole hats list with the new hat last', () => {
    expect(opsForPlace({ ...node('roles/treasurer', 'hat', 0, 0, 0), name: 'Treasurer', tree: 'roles' }, ctx)).toEqual([
      { op: 'update', record: 'systems:roles', set: { hats: [hat('council'), hat('stewards', 'council'), hat('treasurer', 'top', { details: 'Treasurer' })] } },
    ])
  })

  it('a move updates the position; a hat moves nothing', () => {
    expect(opsForMove(node('vault', 'safe', 108, 260))).toEqual([{ op: 'update', record: 'systems:vault', set: { position: { x: 108, y: 260 } } }])
    expect(opsForMove(node('roles/council', 'hat', 108, 260))).toEqual([])
  })

  it('a System’s connection sets every relation the source holds, the new one last', () => {
    expect(opsForConnect('roles', [...edges, { from: 'roles', to: 'forum', label: 'holds' }], ctx)).toEqual([
      { op: 'update', record: 'systems:roles', set: { relates: [{ to: 'vault', label: 'holds' }, { to: 'forum', label: 'holds' }] } },
    ])
  })

  it('an invalid edge is never staged as a relation', () => {
    expect(opsForConnect('forum', [{ from: 'forum', to: 'vault', label: '', invalid: 'A link can’t sign for a Safe.' }], ctx)).toEqual([
      { op: 'update', record: 'systems:forum', set: { relates: [] } },
    ])
  })

  it('connecting a hat to a Safe sets the Safe’s signer_gate.hats', () => {
    const ops = opsForConnect('roles/council', [{ from: 'roles/council', to: 'vault', label: 'signs' }], ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'update', record: 'systems:vault', set: { signer_gate: { hats: ['roles/council'] } } })
  })

  it('connecting a hat to a hat sets the child’s admin, in the tree’s whole list', () => {
    expect(opsForConnect('roles/stewards', [{ from: 'roles/stewards', to: 'roles/council', label: 'appoints' }], ctx)).toEqual([
      { op: 'update', record: 'systems:roles', set: { hats: [hat('council', 'stewards'), hat('stewards', 'council')] } },
    ])
  })

  it('deleting a hat drops it and its children from hats, and out of the gate', () => {
    const ops = opsForDelete('roles/council', [{ from: 'roles/council', to: 'vault', label: 'signs' }, { from: 'roles/stewards', to: 'vault', label: 'signs' }], ctx)
    expect(ops[0]).toEqual({ op: 'update', record: 'systems:roles', set: { hats: [] } })
    expect(ops[1]).toMatchObject({ op: 'update', record: 'systems:vault', set: { signer_gate: { hats: [] } } })
    expect(ops).toHaveLength(2)
  })

  it('a removal deletes the System and takes it out of the relations that pointed at it', () => {
    expect(opsForDelete('vault', edges, ctx)).toEqual([
      { op: 'delete', record: 'systems:vault' },
      { op: 'update', record: 'systems:roles', set: { relates: [] } },
    ])
  })

  it('renaming a hat sets its details in the tree; a System, its name', () => {
    expect(opsForRename('roles/council', 'Council of stewards', ctx)).toEqual([
      { op: 'update', record: 'systems:roles', set: { hats: [hat('council', 'top', { details: 'Council of stewards' }), hat('stewards', 'council')] } },
    ])
    expect(opsForRename('vault', 'Treasury', ctx)).toEqual([{ op: 'update', record: 'systems:vault', set: { name: 'Treasury' } }])
  })

  it('a tree rebuilt from canvas nodes keeps every field of a hat it does not change', () => {
    const kept = hat('stewards', 'council', { role: 'decides', max_supply: 3, image: 'ipfs://x', hat: '0xabc', mutable: false })
    const ns: ComposeNode[] = [
      node('roles', 'hats-tree'),
      { ...node('roles/council', 'hat'), tree: 'roles', hat: hat('council') },
      { ...node('roles/stewards', 'hat'), tree: 'roles', hat: kept, wearers: [] },
    ]
    const trees = treesOf(ns, [])
    expect(trees.roles!.find(h => h.key === 'stewards')).toEqual({ ...kept, details: 'roles/stewards' })
    const ops = opsForRename('roles/council', 'Council of stewards', { trees, chain: CHAIN })
    expect((ops[0] as unknown as { set: { hats: ComposedHat[] } }).set.hats.find(h => h.key === 'stewards')).toMatchObject({ role: 'decides', max_supply: 3, image: 'ipfs://x', hat: '0xabc', mutable: false, admin: 'council' })
  })

  it('a Safe that holds a Hats tree sets the tree’s deployment.top.worn_by, keeping the rest', () => {
    const c = { ...ctx, deployments: { roles: { status: 'composed', salt: '1', top: { details: 'd', image: 'i', worn_by: '' } } } }
    const ops = opsForConnect('vault', [{ from: 'vault', to: 'roles', label: 'holds' }], c)
    expect(ops).toEqual([
      { op: 'update', record: 'systems:vault', set: { relates: [] } },
      { op: 'update', record: 'systems:roles', set: { deployment: { status: 'composed', salt: '1', top: { details: 'd', image: 'i', worn_by: 'vault' } } } },
    ])
  })

  it('deleting that Safe clears worn_by', () => {
    // a tree known to be composed (review I1: worn_by is never written on a tree whose deployment is not known)
    const ops = opsForDelete('vault', [{ from: 'vault', to: 'roles', label: 'holds' }], { ...ctx, deployments: { roles: { status: 'composed' } } })
    expect(ops).toEqual([
      { op: 'delete', record: 'systems:vault' },
      { op: 'update', record: 'systems:roles', set: { deployment: { status: 'composed', top: { worn_by: '' } } } },
    ])
  })

  it('a hat appointing a hat of another tree is refused in words', () => {
    const two = { ...ctx, trees: { ...ctx.trees, other: [hat('x')] } }
    expect(opsForConnect('roles/council', [{ from: 'roles/council', to: 'other/x', label: 'appoints' }], two)).toBe(CROSS_TREE)
  })

  it('a new node takes the next deployment order; a link is never deployed', () => {
    expect(nextOrder(nodes)).toBe(4)
    expect(nextOrder([])).toBe(1)
  })

  it('counts the planner’s steps, not nodes', () => {
    expect(preparedCount({ steps: 7 })).toBe(7)
    expect(DRAG_THRESHOLD_PX).toBe(4)
  })
})
