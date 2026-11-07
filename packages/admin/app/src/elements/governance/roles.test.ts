import { describe, it, expect } from 'vitest'
import { DEEP_TREE, ODD_HATS_READ, ROLES_READ, ROLE_TREE } from '../../test/fixtures/house/governance.ts'
import { hatRefOf } from '../../test/fixtures/house/systems.ts'
import { flattenVisible, roleTreeFrom, typeAhead, type RoleNode } from './roles.ts'

const label = (n: RoleNode) => n.name ?? n.prettyId
const everyId = (nodes: RoleNode[]): string[] => nodes.flatMap(n => [n.id, ...everyId(n.children)])

describe('flattenVisible', () => {
  it('walks the tree depth first, an open hat’s hats under it, each with its level (1 at the top) and its parent', () => {
    const rows = flattenVisible(ROLE_TREE, new Set([hatRefOf(), hatRefOf(1)]))
    expect(rows.map(r => label(r.node))).toEqual(['Example DAO', 'Steward Council', 'Treasury signer', 'Operations', 'Local nodes'])
    expect(rows.map(r => r.level)).toEqual([1, 2, 3, 2, 2])
    expect(rows.map(r => r.parent)).toEqual([null, hatRefOf(), hatRefOf(1), hatRefOf(), hatRefOf()])
  })

  it('shows only the top hats when nothing is open, and every hat when all are', () => {
    expect(flattenVisible(ROLE_TREE, new Set()).map(r => label(r.node))).toEqual(['Example DAO'])
    const all = new Set(everyId(DEEP_TREE))
    const rows = flattenVisible(DEEP_TREE, all)
    expect(rows).toHaveLength(everyId(DEEP_TREE).length)
    expect(Math.max(...rows.map(r => r.level))).toBe(6)
  })
})

describe('typeAhead', () => {
  const rows = flattenVisible(ROLE_TREE, new Set(everyId(ROLE_TREE)))
  const at = (name: string) => rows.findIndex(r => label(r.node) === name)

  it('moves to the next hat whose name starts with the letters, from the one after the focus, wrapping', () => {
    expect(typeAhead(rows, 0, 't')).toBe(at('Treasury signer'))
    expect(typeAhead(rows, 0, 'tr')).toBe(at('Treasury signer'))
    expect(typeAhead(rows, at('Treasury signer'), 'tr')).toBe(at('Treasury signer'))
    expect(typeAhead(rows, at('Local node 4'), 'e')).toBe(at('Example DAO'))
    expect(typeAhead(rows, 0, 'L')).toBe(at('Local nodes'))
    expect(typeAhead(rows, at('Local nodes'), 'l')).toBe(at('Local node 1'))
  })

  it('stays where it is when no hat matches, and reads an unnamed hat by its id', () => {
    expect(typeAhead(rows, 3, 'zz')).toBe(3)
    const deep = flattenVisible(DEEP_TREE, new Set(everyId(DEEP_TREE)))
    const unnamed = deep.findIndex(r => r.node.name === null)
    expect(typeAhead(deep, 0, '0x0000000e')).toBe(unnamed)
    expect(typeAhead(deep, 0, 'network')).toBe(0)
  })
})

describe('roleTreeFrom (brief B6)', () => {
  it('builds the tree from the hats driver’s facts by admin: ids are hat refs, pretty ids, levels and names from details', () => {
    const tree = roleTreeFrom(ROLES_READ)
    expect(tree).toHaveLength(1)
    const [top] = tree
    expect(top!.id).toBe(hatRefOf())
    expect(top!.prettyId).toBe('0x0000000d')
    expect(top!.name).toBe('Example DAO')
    expect(top!.level).toBe(0)
    expect(top!.children.map(label)).toEqual(['Steward Council', 'Operations', 'Local nodes'])
    expect(top!.children[1]!.children.map(c => c.prettyId)).toEqual(['0x0000000d.0002.0001', '0x0000000d.0002.0002', '0x0000000d.0002.0003', '0x0000000d.0002.0004'])
    expect(everyId(tree)).toHaveLength((ROLES_READ.facts.hats as unknown[]).length)
  })

  it('wearers are a count from supply, never names: the one holder’s address when there is one, and whether the list is whole', () => {
    const [top] = roleTreeFrom(ROLES_READ)
    expect(top!.wearers).toEqual({ count: 1, shown: null, address: expect.stringMatching(/^eip155:42220:0x6AFFe510/), complete: true })
    const council = top!.children[0]!
    expect(council.wearers).toEqual({ count: 5, shown: null, complete: true })
    expect(council.does).toBe('')
    expect(council.yours).toBe(false)
    const empty = top!.children[1]!.children[2]!
    expect(empty.name).toBe('Regional coordinator')
    expect(empty.wearers.count).toBe(0)
    expect(empty.active).toBe(true)
  })

  it('takes no name from details that are a link, keeps an inactive hat inactive, and roots the tree wherever the top hat is listed', () => {
    const [top] = roleTreeFrom(ODD_HATS_READ)
    expect(top!.id).toBe(hatRefOf())
    const ops = top!.children[1]!
    expect(ops.wearers).toEqual({ count: 1, shown: null, complete: false }) // one wearer, holders not known: no address
    expect(ops.children[0]!.name).toBeNull()
    expect(ops.children[3]!.active).toBe(false)
  })

  it('a read with no hats is no tree', () => {
    expect(roleTreeFrom({ ...ROLES_READ, facts: {} })).toEqual([])
  })
})
