import { describe, it, expect } from 'vitest'
import { checkVisibilityPolicy } from '../../lib/visibility.mjs'

// PF-R230 (operator, 2026-11-07: refuse) meets PF-R227. A field's level holds for every record of its collection, and
// address is required of every deployed Hats tree, Safe, Gardens community and pool, so PF-R227 already refuses keeping a
// tree's address above members at all: PF-R230's case (the address kept, its hats or deployment readable, the tree's
// number still in its hat ids) cannot arise in a policy. Keeping hats and deployment too does not make it acceptable, so
// PF-R230 adds no second sentence: PF-R227's is the one refusal, and it names what to do (members or public).
const CTX = { registries: ['members', 'systems', 'governance'], roles: ['ops'], tree: 'eip155:42220:13' }
const errors = (fields: Record<string, string>) =>
  checkVisibilityPolicy({ collections: { systems: { fields } } }, CTX).filter(p => p.level === 'error')
const REFUSED = [{ level: 'error', path: 'visibility.collections.systems.fields.address', message:
  'A deployed System must keep its address in the repository, so address cannot be kept above members: give it members or public.' }]

describe("a Hats tree's address kept above members (PF-R230, held by PF-R227)", () => {
  it('kept while its hats and deployment stay readable: refused', () => {
    expect(errors({ address: 'role:ops' })).toEqual(REFUSED)
    expect(errors({ address: 'role:ops', hats: 'members' })).toEqual(REFUSED)
  })

  it('kept with its hats, or with its hats and deployment: still refused, by the same sentence', () => {
    expect(errors({ address: 'role:ops', hats: 'role:ops' })).toEqual(REFUSED)
    expect(errors({ address: 'role:ops', hats: 'role:ops', deployment: 'role:ops' })).toEqual(REFUSED)
  })

  it('its hats kept while the address stays in git: no refusal (the number is in git either way)', () => {
    expect(errors({ hats: 'role:ops' })).toEqual([])
  })
})
