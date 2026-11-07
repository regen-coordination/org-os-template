import { describe, it, expect } from 'vitest'
import { addressProblem, idCounts, positionKey, positionOf, unaddressable } from './addressing.ts'

const entries = [{ id: 'a' }, { title: 'no id' }, { id: 'b' }, { id: 'b' }, { id: '' }]

describe('addressing (contract: entries the platform cannot address)', () => {
  it('names an entry with no id by its position, and reads the position back', () => {
    expect(positionKey(1)).toBe('#2')
    expect(positionOf('#2')).toBe(1)
    expect(positionOf('b')).toBeNull()
  })

  it('says why an entry cannot be addressed, in the words the contract gives', () => {
    expect(addressProblem(entries, 0, 'data/projects.yaml')).toBeNull()
    expect(addressProblem(entries, 1, 'data/projects.yaml')).toBe('This entry has no id, so the platform cannot address it: give it one in data/projects.yaml. Until then it is read-only.')
    expect(addressProblem(entries, 2, 'data/projects.yaml')).toBe('id b appears 2 times in data/projects.yaml; fix it in the file.')
    expect(addressProblem(entries, 4, 'data/projects.yaml')).toMatch(/has no id/)
  })

  it('counts ids and the entries it cannot address', () => {
    expect(idCounts(entries).get('b')).toBe(2)
    expect(idCounts(entries).get('a')).toBe(1)
    expect([...idCounts(entries).keys()]).toEqual(['a', 'b']) // no id, and an empty one, hold none
    expect(idCounts([{ id: 7 }, { id: null }]).get('7')).toBe(1) // ids are compared as text (folded from editable.ts's idCount)
    expect(unaddressable(entries)).toBe(4)
  })
})
