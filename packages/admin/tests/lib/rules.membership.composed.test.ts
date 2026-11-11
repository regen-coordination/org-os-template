import { describe, it, expect } from 'vitest'
import { membershipTree } from '../../lib/rules.mjs'
import { composedTree } from './compose.fixtures.ts'

const deployed = { id: 'live-roles', kind: 'hats-tree', name: 'Live', chain: 'eip155:11155111', address: '13' }

describe('membershipTree and composed trees', () => {
  it('membershipTree ignores a composed tree', () => {
    expect(membershipTree(null, [composedTree()])).toBeNull()
    expect(membershipTree({ membership: { tree: 'test-dao-roles' } }, [composedTree()])).toBeNull()
  })
  it('a deployed tree beside a composed one is the membership tree, with no SEVERAL_TREES', () => {
    expect(membershipTree(null, [composedTree(), deployed])).toEqual(membershipTree(null, [deployed]))
    expect(membershipTree(null, [deployed, composedTree()])).not.toBeNull()
  })
})

describe('checkGovernance and composed trees', () => {
  it('a composed tree beside one deployed tree is not SEVERAL_TREES', async () => {
    const { checkGovernance, SEVERAL_TREES } = await import('../../lib/rules.mjs')
    const r = (checkGovernance as any)({ roles: {}, rules: [] }, { members: [], systems: [composedTree(), deployed], classes: null })
    expect(JSON.stringify(r)).not.toContain(SEVERAL_TREES)
  })
})
