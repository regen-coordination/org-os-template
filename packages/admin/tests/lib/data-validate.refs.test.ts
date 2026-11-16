import { describe, it, expect } from 'vitest'
import { referenceErrors, referrersOf, governanceReferrers } from '../../lib/data-validate.mjs'

const ids = (...systems: string[]) => (target: string) => (target === 'systems' ? new Set(systems) : null)

describe('engine references to Systems (L1-Q1)', () => {
  it('a board block naming a System the engine does not know is a reference error at its path', () => {
    expect(referenceErrors('boards', { blocks: [{ id: 'a', type: 'note' }, { id: 'b', source: { system: 'nope' } }] }, ids('treasury-safe')))
      .toEqual([{ field: 'blocks.1.source.system', message: 'no system with id "nope" in systems' }])
    expect(referenceErrors('boards', { blocks: [{ id: 'b', source: { system: 'treasury-safe' } }] }, ids('treasury-safe'))).toEqual([])
  })

  it('a relation to <tree>/<key> names the System <tree>', () => {
    expect(referenceErrors('systems', { id: 'x', relates: [{ to: 'roles/council' }] }, ids('x')))
      .toEqual([{ field: 'relates.0.to', message: 'no system with id "roles" in systems' }])
    expect(referenceErrors('systems', { id: 'x', relates: [{ to: 'roles/council' }] }, ids('x', 'roles'))).toEqual([])
  })

  // L7 meets L4c (the platform merge): `relates` also takes the map's own forms (E-38): a hat ref (eip155:<n>:0x<64 hex>)
  // names a hat on a chain, no System of this file, so it is not checked here; `system:<id>` names the System <id>.
  it('a relation to a hat ref is not a System reference; system:<id> names the System <id>', () => {
    const hat = `eip155:11155111:0x${'0a'.repeat(32)}`
    expect(referenceErrors('systems', { id: 'x', relates: [{ to: hat }, { to: 'system:treasury-safe' }] }, ids('x', 'treasury-safe'))).toEqual([])
    expect(referenceErrors('systems', { id: 'x', relates: [{ to: 'system:nope' }] }, ids('x')))
      .toEqual([{ field: 'relates.0.to', message: 'no system with id "nope" in systems' }])
    expect(referrersOf('systems', 'treasury-safe', r => (r === 'systems' ? [{ id: 'x', relates: [{ to: 'system:treasury-safe' }] }] : null)))
      .toEqual([{ registry: 'systems', id: 'x', field: 'relates.0.to' }])
  })

  it('referrersOf finds a board block and a System relation', () => {
    const registries: Record<string, any[]> = {
      boards: [{ id: 'desk', blocks: [{ id: 'safe', source: { system: 'treasury-safe' } }] }],
      systems: [{ id: 'treasury-safe' }, { id: 'roles', relates: [{ to: 'treasury-safe/x' }] }],
    }
    expect(referrersOf('systems', 'treasury-safe', r => registries[r] ?? null)).toEqual([
      { registry: 'boards', id: 'desk', field: 'blocks.0.source.system' },
      { registry: 'systems', id: 'roles', field: 'relates.0.to' },
    ])
  })

  it('the existing field references keep working', () => {
    expect(referrersOf('members', 'ana', r => (r === 'projects' ? [{ id: 'p', lead: 'ana' }] : null)))
      .toEqual([{ registry: 'projects', id: 'p', field: 'lead' }])
  })

  it('governanceReferrers names a rule decided by the System and the membership tree', () => {
    const found = governanceReferrers('treasury-safe', { rules: [{ id: 'other', decide: { by: 'role' } }, { id: 'treasury', decide: { by: 'system', system: 'treasury-safe' } }], membership: { tree: 'treasury-safe' } })
    expect(found.map(f => [f.where, f.field])).toEqual([['governance.yaml', 'rules[1].decide.system'], ['governance.yaml', 'membership.tree']])
    expect(governanceReferrers('treasury-safe', null)).toEqual([])
    expect(governanceReferrers('treasury-safe', { rules: [{ decide: { system: 'other' } }] })).toEqual([])
  })
})
