import { describe, it, expect } from 'vitest'
import { fieldOf, matches, runQuery } from './query.ts'
import { resource } from '../test/data.ts'

const at = (d: string) => ({ at: `2026-10-${d}T10:00:00Z`, by: 'Steward A' })
const rs = [
  resource({ id: 'project:a', name: 'A', status: 'active', changed: at('10'), facts: { lead: 'steward-a', budget: 10 } }),
  resource({ id: 'project:b', name: 'B', status: 'done', changed: at('12'), facts: { budget: '9' }, attention: { level: 'warn', text: 'w' } }),
  resource({ id: 'project:c', name: 'C', status: null, facts: { lead: 'ana' }, attention: { level: 'alert', text: 'a' } }),
  resource({ id: 'idea:d', kind: 'idea', name: 'D', changed: at('01') }),
  resource({ id: 'absent:crew', kind: 'absent', name: 'Crew', source: null, attention: { level: 'warn', text: 'No crew' } }),
]
const ids = (out: { id: string }[]) => out.map(r => r.id)

describe('fieldOf', () => {
  it("reads the resource's own fields, three derived ones, else a fact", () => {
    expect(fieldOf(rs[2]!, 'needs')).toBe(0)
    expect(fieldOf(rs[1]!, 'needs')).toBe(1)
    expect(fieldOf(rs[0]!, 'needs')).toBe(2)
    expect(fieldOf(rs[0]!, 'changed')).toBe('2026-10-10T10:00:00Z')
    expect(fieldOf(rs[0]!, 'lead')).toBe('steward-a')
    expect(fieldOf(rs[1]!, 'lead')).toBeNull()
    expect(fieldOf(resource({ status: 'free' }), 'free')).toBe(1)
  })
})

describe('matches', () => {
  it('equals by text, so 3 and "3" match; null asks for nothing there', () => {
    expect(matches(3, '3')).toBe(true)
    expect(matches(['a', 'b'], 'b')).toBe(true)
    expect(matches(null, null)).toBe(true)
    expect(matches('x', null)).toBe(false)
  })

  it('not keeps what does not hold the field; in, before, after and has need it (Review Focus 5)', () => {
    expect(matches(null, { not: 'done' })).toBe(true)
    expect(matches('done', { not: 'done' })).toBe(false)
    expect(matches('a', { in: ['a', 'b'] })).toBe(true)
    expect(matches(null, { in: ['a'] })).toBe(false)
    expect(matches('2026-10-01', { before: '2026-10-02' })).toBe(true)
    expect(matches(null, { before: '2026-10-02' })).toBe(false)
    expect(matches('2026-10-03', { after: '2026-10-02', before: '2026-10-04' })).toBe(true)
    expect(matches('', { has: true })).toBe(false)
    expect(matches([], { has: false })).toBe(true)
  })
})

describe('runQuery (Review Focus 5)', () => {
  it('picks by kind, one or several, and keeps every record when no kind is named, absent ones too', () => {
    expect(ids(runQuery({ kind: 'project' }, rs))).toEqual(['project:a', 'project:b', 'project:c'])
    expect(ids(runQuery({ kind: ['idea', 'project'] }, rs))).toHaveLength(4)
    expect(ids(runQuery({ where: { needs: { not: 2 } } }, rs))).toEqual(['project:b', 'project:c', 'absent:crew'])
    expect(ids(runQuery({ kind: '*' }, rs))).toEqual(ids(rs))
  })

  it("picks a built-in section's records the way the section does", () => {
    expect(ids(runQuery({ section: 'projects' }, rs))).toEqual(['project:a', 'project:b', 'project:c'])
    expect(runQuery({ section: 'no-such-section' }, rs)).toEqual([])
  })

  it('sorts on several keys, puts records lacking a key last either way round, and breaks ties by name', () => {
    expect(ids(runQuery({ where: { needs: { not: 2 } }, sort: 'needs, changed' }, rs))).toEqual(['project:c', 'project:b', 'absent:crew'])
    expect(ids(runQuery({ where: { needs: { not: 2 } }, sort: ['needs', 'changed'] }, rs))).toEqual(['project:c', 'project:b', 'absent:crew'])
    expect(ids(runQuery({ kind: 'project', sort: 'status=done, name' }, rs))).toEqual(['project:a', 'project:c', 'project:b'])
    expect(ids(runQuery({ kind: 'project', sort: '-changed' }, rs))).toEqual(['project:b', 'project:a', 'project:c'])
    expect(ids(runQuery({ kind: 'project', sort: 'changed' }, rs))).toEqual(['project:a', 'project:b', 'project:c'])
    expect(ids(runQuery({ kind: 'project', sort: 'lead' }, rs))).toEqual(['project:c', 'project:a', 'project:b'])
  })

  it('compares numbers as numbers and mixed values as text', () => {
    expect(ids(runQuery({ kind: 'project', where: { budget: { has: true } }, sort: 'budget' }, rs))).toEqual(['project:a', 'project:b'])
  })

  it('takes limit as given, 0 included', () => {
    expect(runQuery({ kind: 'project', limit: 0 }, rs)).toEqual([])
    expect(ids(runQuery({ kind: 'project', sort: 'name', limit: 2 }, rs))).toEqual(['project:a', 'project:b'])
  })
})
