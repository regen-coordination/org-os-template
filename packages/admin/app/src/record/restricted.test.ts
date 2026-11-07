import { describe, it, expect } from 'vitest'
import { restrictedHat, restrictedOf, withoutRestricted } from './restricted.ts'
import { FIXTURE_SOURCE, type VisibilitySource } from '../viewAs/visibility.ts'

/** A source whose tree holds a hat by its ref and a role (L5 §11.2: an org without a tree lists its roles). */
const source: VisibilitySource = {
  ...FIXTURE_SOURCE,
  hats: () => [{ hat: 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000', name: 'Steward Council' }, { hat: 'role:ops', name: 'Ops' }],
}

describe('restricted fields (E-60, R-L5-14.5)', () => {
  it('reads the gate’s marker: each field the viewer is not admitted to, with the level that keeps them out', () => {
    expect(restrictedOf({ id: 'a', email: null, restricted: { email: 'hat:ops', phone: 'role:ops' } })).toEqual({ email: 'hat:ops', phone: 'role:ops' })
    expect(restrictedOf({ id: 'a' })).toEqual({})
    expect(restrictedOf({ id: 'a', restricted: 'everything' })).toEqual({})
    expect(restrictedOf({ id: 'a', restricted: { email: 3, phone: 'hat:x' } })).toEqual({ phone: 'hat:x' })
    expect(restrictedOf(null)).toEqual({})
  })

  it('names the hat from the source’s tree, else shows its raw id; a role by the tree, else its id', () => {
    expect(restrictedHat('hat:eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000', source)).toBe('Steward Council')
    expect(restrictedHat('hat:eip155:42220:0x0000000d00020000000000000000000000000000000000000000000000000000', source))
      .toBe('eip155:42220:0x0000000d00020000000000000000000000000000000000000000000000000000')
    expect(restrictedHat('role:ops', source)).toBe('Ops')
    expect(restrictedHat('role:treasury', source)).toBe('treasury')
    expect(restrictedHat('members', source)).toBe('Members')
    expect(restrictedHat('hat:ops', FIXTURE_SOURCE)).toBe('Ops')
  })

  it('takes the marker off the entry, so an editor never stages it back', () => {
    expect(withoutRestricted({ id: 'a', title: 'T', restricted: { email: 'hat:ops' } })).toEqual({ id: 'a', title: 'T' })
    const plain = { id: 'a' }
    expect(withoutRestricted(plain)).toBe(plain)
    expect(withoutRestricted(null)).toBeNull()
  })
})
