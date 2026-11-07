import { describe, it, expect } from 'vitest'
import { mentionables, type Mentionable } from './mentions.ts'
import { MENTIONABLES } from '../../test/fixtures/house/workspace.ts'

const ids = (items: Mentionable[]) => items.map(m => m.id)

describe('mentionables (§10.4, C-21)', () => {
  it('offers people, roles and the records the author may see; a member who may not see the page stays, last, to be drawn disabled', () => {
    expect(ids(mentionables(MENTIONABLES, ''))).toEqual(['ops-lead', 'council-steward', 'ops', 'system:treasury', 'steward-b', 'treasury-steward'])
  })

  it('never offers a record, a page or a role the author may not see (§6.3: absent, not disabled)', () => {
    const offered = mentionables(MENTIONABLES, '')
    expect(offered.find(m => m.id === 'page:grants-draft')).toBeUndefined()
    expect(offered.find(m => m.id === 'treasury')).toBeUndefined()
    expect(mentionables([{ kind: 'record', id: 'r', label: 'Hidden', canSee: false }], 'hid')).toEqual([])
  })

  it('matches the start of any word of the name, or the id, whatever the case; the leading @ is not part of the query', () => {
    expect(ids(mentionables(MENTIONABLES, 'st'))).toEqual(['council-steward', 'steward-b', 'treasury-steward'])
    expect(ids(mentionables(MENTIONABLES, '@Tre'))).toEqual(['system:treasury', 'treasury-steward'])
    expect(ids(mentionables(MENTIONABLES, 'OPS'))).toEqual(['ops-lead', 'ops'])
    expect(ids(mentionables(MENTIONABLES, 'system:'))).toEqual(['system:treasury'])
    expect(mentionables(MENTIONABLES, 'eward')).toEqual([])
    expect(mentionables(MENTIONABLES, '  ')).toHaveLength(6)
  })

  it('keeps the order it was given, within those who may see and those who may not', () => {
    const people: Mentionable[] = [
      { kind: 'person', id: 'a', label: 'A', canSee: false },
      { kind: 'person', id: 'b', label: 'B', canSee: true },
      { kind: 'person', id: 'c', label: 'C', canSee: false },
      { kind: 'person', id: 'd', label: 'D', canSee: true },
    ]
    expect(ids(mentionables(people, ''))).toEqual(['b', 'd', 'a', 'c'])
  })
})
