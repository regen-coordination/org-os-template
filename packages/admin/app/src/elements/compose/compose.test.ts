import { describe, it, expect } from 'vitest'
import { COMPOSE, canConnect, moveBy, nextOrder, opsForConnect, opsForDelete, opsForMove, opsForPlace, preparedCount, relationOf, type ComposeEdge, type ComposeNode } from './compose.ts'

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
  const nodes = [node('top', 'hat', 100, 60, 1), node('signers', 'hat', 100, 160, 2), node('vault', 'safe', 100, 260, 3), node('forum', 'link', 300, 160, 0)]
  const edges: ComposeEdge[] = [{ from: 'top', to: 'signers', label: 'appoints' }]

  it('a placed node is a created System with its position and deployment order', () => {
    expect(opsForPlace(node('safe-2', 'safe', 200, 150, 4))).toEqual([
      { op: 'create', record: 'systems:safe-2', value: { id: 'safe-2', kind: 'safe', name: 'safe-2', position: { x: 200, y: 150 }, order: 4 } },
    ])
  })

  it('a move updates the position', () => {
    expect(opsForMove(node('vault', 'safe', 108, 260))).toEqual([{ op: 'update', record: 'systems:vault', set: { position: { x: 108, y: 260 } } }])
  })

  it('a connection sets every relation the source holds, the new one last', () => {
    expect(opsForConnect('top', [...edges, { from: 'top', to: 'vault', label: 'holds' }])).toEqual([
      { op: 'update', record: 'systems:top', set: { relates: [{ to: 'signers', label: 'appoints' }, { to: 'vault', label: 'holds' }] } },
    ])
  })

  it('an invalid edge is never staged as a relation', () => {
    expect(opsForConnect('forum', [{ from: 'forum', to: 'vault', label: '', invalid: 'A link can’t sign for a Safe.' }])).toEqual([
      { op: 'update', record: 'systems:forum', set: { relates: [] } },
    ])
  })

  it('a removal deletes the System and takes it out of the relations that pointed at it', () => {
    expect(opsForDelete('signers', edges)).toEqual([
      { op: 'delete', record: 'systems:signers' },
      { op: 'update', record: 'systems:top', set: { relates: [] } },
    ])
  })

  it('a new node takes the next deployment order; a link is never deployed', () => {
    expect(nextOrder(nodes)).toBe(4)
    expect(nextOrder([])).toBe(1)
  })

  it('counts a transaction for every deployable node and every signer gate (a hat that signs for a Safe)', () => {
    expect(preparedCount(nodes, [...edges, { from: 'signers', to: 'vault', label: 'signs' }])).toBe(4)
    expect(preparedCount(nodes, [{ from: 'forum', to: 'vault', label: '', invalid: 'no' }])).toBe(3)
  })
})
