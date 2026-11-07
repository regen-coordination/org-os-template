import { describe, it, expect } from 'vitest'
import type { JsonSchema } from '../api.ts'
import projectsSchema from '../../../schemas/projects.schema.json'
import { choicesOf, formKindOf, groupsOf, helpOf, humanise, idProblem, labelOf, previewFields, titleFieldOf } from './form.ts'

const bare: JsonSchema = {
  required: ['id'], 'x-order': ['id', 'title', 'status', 'lead', 'started'],
  properties: {
    id: { type: 'string' }, title: { type: ['string', 'null'] }, status: { type: ['string', 'null'] }, lead: { type: 'string' },
    started: { type: 'string', format: 'date' }, target_completion: { type: 'string', format: 'date' }, notes: { type: 'string' },
  },
}
const annotated: JsonSchema = {
  ...bare,
  properties: { ...bare.properties, title: { type: 'string', title: 'Title' }, lead: { type: 'string', title: 'Lead', description: 'The person accountable for it.' } },
  'x-groups': [{ label: 'What it is', fields: ['title', 'nope'] }, { label: 'Who', fields: ['lead'] }, { label: 'Milestones', fields: ['target_completion'], optional: true }],
}

describe('the words', () => {
  it('a label is the title, else the id humanised; help is the description, else none', () => {
    expect(humanise('target_completion')).toBe('Target completion')
    expect(humanise('amount-available')).toBe('Amount available')
    expect(labelOf(annotated, 'lead')).toBe('Lead')
    expect(labelOf(bare, 'target_completion')).toBe('Target completion')
    expect(helpOf(annotated, 'lead')).toBe('The person accountable for it.')
    expect(helpOf(bare, 'lead')).toBeNull()
  })
  it('the id follows the name, title or partner; with none of them it is typed', () => {
    expect(titleFieldOf(bare)).toBe('title')
    expect(titleFieldOf({ properties: { id: {}, partner: {} } })).toBe('partner')
    expect(titleFieldOf({ properties: { id: {} } })).toBeNull()
  })
})

describe('groupsOf', () => {
  it('groups by x-groups in order, leaves out fields the schema does not name, and folds the rest', () => {
    expect(groupsOf(annotated, [])).toEqual([
      { label: 'What it is', fields: ['title'], optional: false },
      { label: 'Who', fields: ['lead'], optional: false },
      { label: 'Milestones', fields: ['target_completion'], optional: true },
      { label: 'More', fields: ['status', 'started', 'notes'], optional: true, folded: true },
    ])
  })
  it('without x-groups: one group of what the schema orders or requires, or the entries use; the rest folds', () => {
    expect(groupsOf(bare, [])).toEqual([
      { label: 'Details', fields: ['title', 'status', 'lead', 'started'], optional: false },
      { label: 'More', fields: ['target_completion', 'notes'], optional: true, folded: true },
    ])
    expect(groupsOf(bare, [{ id: 'a', notes: 'x' }])[0]!.fields).toEqual(['title', 'status', 'lead', 'started', 'notes'])
  })
  it('a required field no group names leads the first group, and makes no group optional', () => {
    const s: JsonSchema = { ...annotated, required: ['id', 'notes', 'target_completion'] }
    const g = groupsOf(s, [])
    expect(g[0]!.fields).toEqual(['notes', 'title'])
    expect(g.find(x => x.label === 'Milestones')!.optional).toBe(false)
  })
  it('the id is a field, required and first, only where nothing names the entry', () => {
    const s: JsonSchema = { required: ['id'], properties: { id: { type: 'string' }, url: { type: 'string' } } }
    expect(groupsOf(s, [])).toEqual([{ label: 'Details', fields: ['id'], optional: false }, { label: 'More', fields: ['url'], optional: true, folded: true }])
    expect(groupsOf(bare, []).flatMap(g => g.fields)).not.toContain('id')
  })
})

describe('choicesOf', () => {
  const used = [{ status: 'Develop' }, { status: 'Discovery' }, { status: 'Develop' }, { status: '' }, { status: 3 }]
  it('an enum offers its values and no Other', () => {
    expect(choicesOf('relevance', { enum: ['high', 'low', null] }, [])).toEqual({ options: ['high', 'low'], other: false })
  })
  it('examples, or a status-like field: the values in use, most used first, else the examples, with Other', () => {
    expect(choicesOf('status', { type: 'string', examples: ['idea', 'develop'] }, used)).toEqual({ options: ['Develop', 'Discovery'], other: true })
    expect(choicesOf('status', { type: 'string', examples: ['idea', 'develop'] }, [])).toEqual({ options: ['idea', 'develop'], other: true })
    // one word in use is no vocabulary yet: the examples follow it, each once whatever its case
    expect(choicesOf('status', { type: 'string', examples: ['idea', 'develop'] }, [{ status: 'Develop' }])).toEqual({ options: ['Develop', 'idea'], other: true })
    expect(choicesOf('stage', { type: 'string' }, [{ stage: 'b' }, { stage: 'a' }])).toEqual({ options: ['a', 'b'], other: true })
  })
  it('a field marked x-choices: examples offers its examples first, then the other values in use', () => {
    expect(choicesOf('kind', { type: 'string', examples: ['safe', 'repo'], 'x-choices': 'examples' }, [{ kind: 'notion' }, { kind: 'safe' }]))
      .toEqual({ options: ['safe', 'repo', 'notion'], other: true })
  })
  it('a field with neither offers nothing: a status-like one with no values in use, or any other text', () => {
    expect(choicesOf('status', { type: 'string' }, [])).toBeNull()
    expect(choicesOf('currency', { type: 'string' }, [{ currency: 'EUR' }])).toBeNull()
  })
})

describe('formKindOf', () => {
  const k = (field: string, prop: Parameters<typeof formKindOf>[2], registry = 'projects') => formKindOf(registry, field, prop, choicesOf(field, prop, []))
  it('choices are segmented up to five, else a select', () => {
    expect(k('relevance', { enum: ['a', 'b', 'c', 'd', 'e'] })).toBe('seg')
    expect(k('relevance', { enum: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('select')
    expect(k('type', { type: 'string', examples: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('select')
  })
  it('a reference picks records, a date is a date, a number a number', () => {
    expect(k('lead', { type: 'string' })).toBe('ref')
    expect(k('contributors', { type: 'array', items: { type: 'string' } })).toBe('refs')
    expect(k('started', { type: 'string', format: 'date' })).toBe('date')
    expect(k('votes', { type: ['number', 'null'] })).toBe('number')
  })
  it('a list of strings is tokens (strings or numbers too); a list of objects with named properties is rows; else YAML', () => {
    expect(k('skills', { type: 'array', items: { type: 'string' } })).toBe('tokens')
    expect(k('tags', { type: ['array', 'null'], items: { type: ['string', 'number'] } })).toBe('tokens')
    expect(k('milestones', { type: 'array', items: { type: 'object', properties: { title: {} } } })).toBe('rows')
    expect(k('milestones', { type: 'array', items: { type: 'object' } })).toBe('yaml')
    expect(k('handles', { type: ['object', 'null'] })).toBe('yaml')
  })
  it('a long text asks for room with x-format, else is one line', () => {
    expect(k('summary', { type: 'string', 'x-format': 'textarea' })).toBe('prose')
    expect(k('summary', { type: 'string' })).toBe('text')
  })
})

describe('idProblem', () => {
  it('says an id is taken in the server’s words, refuses a #, and says nothing of an empty one', () => {
    const taken = new Set(['p1'])
    expect(idProblem('projects', 'p1', taken)).toBe('projects already has an entry "p1".')
    expect(idProblem('projects', '#3', taken)).toBe('ids beginning with # are read as positions; choose another')
    expect(idProblem('projects', '', taken)).toBeNull()
    expect(idProblem('projects', 'p2', taken)).toBeNull()
  })
})

describe('previewFields', () => {
  it('the first filled fields of the groups, the title and the id aside', () => {
    const g = groupsOf(bare, [])
    expect(previewFields(bare, g, { id: 'x', title: 'T', lead: 'a', started: '2026-11-04', target_completion: '2027-01-01' }, 2)).toEqual(['lead', 'started'])
  })
})

describe('the framework’s projects schema, as annotated', () => {
  it('draws the approved form: its groups, the three links folded, the words the mockup uses', () => {
    const s = projectsSchema as JsonSchema
    expect(groupsOf(s, []).map(g => [g.label, g.fields])).toEqual([
      ['What it is', ['title', 'description', 'type']], ['Who', ['lead', 'contributors']],
      ['Where it stands', ['status', 'started', 'target_completion']], ['Milestones', ['milestones']],
      ['More', ['related_ideas', 'funding_source', 'tags']],
    ])
    expect(['description', 'type', 'target_completion'].map(f => labelOf(s, f))).toEqual(['Summary', 'Kind', 'Aim to finish'])
    expect(formKindOf('projects', 'milestones', s.properties!.milestones!, null)).toBe('rows')
    expect(formKindOf('projects', 'description', s.properties!.description!, null)).toBe('prose')
  })
})
