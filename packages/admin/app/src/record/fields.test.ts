import { describe, it, expect } from 'vitest'
import { controlKind, dateProblem, entryName, orderedKeys, same, shown, stagedView } from './fields.ts'
import type { JsonSchema, Op } from '../api.ts'

const schema: JsonSchema = { 'x-order': ['id', 'title', 'status'], properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, lead: { type: 'string' } } }
const op = (o: Partial<Op> & Pick<Op, 'op'>): Op => ({ record: 'projects:p1', base: 'h', before: { id: 'p1', title: 'Old', status: 'idea' }, ...o } as Op)

describe('orderedKeys', () => {
  it('reads in schema order, then the fields the schema does not name, so nothing is hidden', () => {
    expect(orderedKeys(schema, { id: 'p1', title: 'T', extra: 1, tags: ['a'] }, false)).toEqual(['id', 'title', 'status', 'tags', 'extra'])
  })
  it('offers every schema property while editing', () => {
    expect(orderedKeys(schema, { id: 'p1' }, true)).toEqual(['id', 'title', 'status', 'tags', 'lead'])
  })
  it('never draws a field named __proto__', () => {
    expect(orderedKeys(schema, JSON.parse('{"id":"a","__proto__":{"x":1}}') as Record<string, unknown>, false)).not.toContain('__proto__')
  })
})

describe('stagedView', () => {
  const entry = { id: 'p1', title: 'Old', status: 'idea' }
  it('applies staged updates and says what each changed field was', () => {
    const v = stagedView(entry, [op({ op: 'update', set: { status: 'develop' } }), op({ op: 'update', set: { tags: ['a'] } })])
    expect(v.value).toEqual({ id: 'p1', title: 'Old', status: 'develop', tags: ['a'] })
    expect(v.was).toEqual({ status: 'idea', tags: undefined })
    expect(Object.hasOwn(v.was, 'tags')).toBe(true)
  })
  it('shows a staged create, a whole-entry replace and a delete', () => {
    expect(stagedView(null, [op({ op: 'create', value: { id: 'n', title: 'New' }, before: null, base: null })])).toMatchObject({ value: { id: 'n', title: 'New' }, created: true, was: {} })
    expect(stagedView(entry, [op({ op: 'replace', value: { id: 'p1', title: 'Whole' } })]).was).toEqual({ title: 'Old', status: 'idea' })
    expect(stagedView(entry, [op({ op: 'delete' })]).deleted).toBe(true)
  })
  it('is the entry itself when nothing is staged', () => {
    expect(stagedView(entry, [])).toEqual({ value: entry, was: {}, created: false, deleted: false })
  })
})

describe('shown, same, entryName', () => {
  it('writes values for a reader', () => {
    expect(shown(undefined)).toBe('—')
    expect(shown(['a', 'b'])).toBe('a, b')
    expect(shown({ a: 1 })).toBe('{"a":1}')
    expect(same({ a: [1] }, { a: [1] })).toBe(true)
    expect(entryName({ id: 'x', title: 'T' })).toBe('T')
    expect(entryName({ id: 'x', partner: 'Example Coop' })).toBe('Example Coop')
    expect(entryName(null)).toBeNull()
  })
})
describe('controlKind', () => {
  it('chooses the input from the schema and the reference table', () => {
    expect(controlKind('projects', 'status', { enum: ['a'] })).toBe('enum')
    expect(controlKind('projects', 'started', { type: ['string', 'null'], format: 'date' })).toBe('date')
    expect(controlKind('projects', 'title', { type: 'string' })).toBe('text')
    expect(controlKind('projects', 'budget', { type: 'number' })).toBe('number')
    expect(controlKind('projects', 'public', { type: 'boolean' })).toBe('boolean')
    expect(controlKind('projects', 'tags', { type: 'array', items: { type: 'string' } })).toBe('list')
    expect(controlKind('projects', 'lead', { type: ['string', 'null'] })).toBe('ref')
    expect(controlKind('projects', 'contributors', { type: ['array', 'null'], items: { type: 'string' } })).toBe('refs')
    expect(controlKind('projects', 'milestones', { type: 'array', items: { type: 'object' } })).toBe('yaml')
    expect(controlKind('projects', 'toString', {})).toBe('yaml')
  })
})

describe('dateProblem', () => {
  it('says in words why a text is not a date', () => {
    expect(dateProblem('')).toBeNull()
    expect(dateProblem('2026-10-16')).toBeNull()
    expect(dateProblem('2026-13-01')).toBe('not a date: month 13')
    expect(dateProblem('2026-02-30')).toBe('not a date: day 30 (month 2 has 28)')
    expect(dateProblem('16/10/2026')).toBe('not a date: write it as YYYY-MM-DD')
  })
})
