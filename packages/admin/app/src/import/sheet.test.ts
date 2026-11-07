import { describe, it, expect } from 'vitest'
import { importPlan, matchHeaders, parseSheet, uniqueId } from './sheet.ts'
import type { JsonSchema } from '../api.ts'
import projectsSchema from '../../../schemas/projects.schema.json'
import fundingSchema from '../../../schemas/funding-opportunities.schema.json'

const funding: JsonSchema = {
  required: ['id', 'deadline'],
  properties: {
    id: { type: 'string' }, title: { type: ['string', 'null'] }, deadline: { type: ['string', 'null'], format: 'date' },
    amount_available: { type: ['number', 'null'], title: 'Amount' }, relevance: { enum: ['high', 'medium', 'low'] },
    tags: { type: 'array', items: { type: 'string' } }, contacts: { type: 'array', items: { type: 'object' } },
  },
}

describe('parseSheet', () => {
  it('reads tab-separated rows pasted from a sheet', () => {
    expect(parseSheet('Title\tDeadline\nSpring round\t2026-12-01\n')).toEqual([['Title', 'Deadline'], ['Spring round', '2026-12-01']])
  })

  it('reads CSV with quoted fields, commas and quotes inside them, line breaks inside them, and CRLF', () => {
    const csv = '﻿title,notes\r\n"Round, spring","said ""yes"""\r\n"Two\r\nlines",x\r\n\r\n'
    expect(parseSheet(csv)).toEqual([['title', 'notes'], ['Round, spring', 'said "yes"'], ['Two\r\nlines', 'x']])
  })

  it('reads nothing from blank text', () => expect(parseSheet(' \n\n')).toEqual([]))
})

describe('matchHeaders', () => {
  it('matches a header to a field id or its schema title, whatever its case and spacing', () => {
    expect(matchHeaders(['Title', 'amount', 'Relevance ', 'Funder', 'deadline'], funding)).toEqual(['title', 'amount_available', 'relevance', null, 'deadline'])
    expect(matchHeaders(['Amount available'], funding)).toEqual(['amount_available'])
  })
  it('matches the framework schemas’ own titles, the words the new-record form shows', () => {
    expect(matchHeaders(['Title', 'Summary', 'Kind', 'Aim to finish', 'Ideas'], projectsSchema as JsonSchema))
      .toEqual(['title', 'description', 'type', 'target_completion', 'related_ideas'])
    expect(matchHeaders(['Link', 'Amount available', 'Application id'], fundingSchema as JsonSchema)).toEqual(['url', 'amount_available', 'application_id'])
  })
})

describe('uniqueId', () => {
  it('keeps an id that is free and numbers one that is taken', () => {
    const taken = new Set(['spring-round', 'spring-round-2'])
    expect(uniqueId('spring-round', taken)).toBe('spring-round-3')
    expect(uniqueId('autumn', taken)).toBe('autumn')
    expect(taken.has('autumn')).toBe(true) // the id it gave is taken from then on
  })
})

describe('importPlan', () => {
  const plan = (text: string, taken: string[] = []) => importPlan(parseSheet(text), funding, 'funding-opportunities', new Set(taken))

  it('gives each row an id that follows its title, unique against the file and the other rows', () => {
    const p = plan('Title,Deadline\nSpring round,2026-12-01\nSpring round,2026-12-02\nAutumn,2027-01-10', ['spring-round'])
    expect(p.rows.map(r => r.id)).toEqual(['spring-round-2', 'spring-round-3', 'autumn'])
    expect(p.rows[0]!.value).toEqual({ id: 'spring-round-2', title: 'Spring round', deadline: '2026-12-01' })
    expect(p.rows.every(r => r.problems.length === 0)).toBe(true)
  })

  it('keeps an id column as given', () => {
    expect(plan('id,title,deadline\nmy-round,Spring,2026-12-01').rows[0]!.id).toBe('my-round')
  })

  it('reads numbers, enums, dates and lists by the schema, and says what does not fit', () => {
    const p = plan('Title,Deadline,Amount,Relevance,tags\nA,2026-12-01,"1,500",high,"a; b"\nB,2026-13-01,lots,huge,')
    expect(p.rows[0]!.value).toEqual({ id: 'a', title: 'A', deadline: '2026-12-01', amount_available: 1500, relevance: 'high', tags: ['a', 'b'] })
    expect(p.rows[1]!.problems).toEqual([
      'Deadline: not a date: month 13', 'Amount: “lots” is not a number', 'Relevance: “huge” is not one of high, medium, low',
    ])
  })

  it('says when a required field is empty, or there is no title for an id to follow', () => {
    const p = plan('Title,Deadline\n,2026-12-01\nB,')
    expect(p.rows[0]!.problems).toEqual(['No title, so no id to follow it'])
    expect(p.rows[1]!.problems).toEqual(['Deadline is required'])
  })

  it('says which columns are left out, and why', () => {
    const p = plan('Title,Funder,contacts,Deadline\nA,Example Fund,x,2026-12-01')
    expect(p.columns.map(c => [c.header, c.field, c.left])).toEqual([
      ['Title', 'title', null], ['Funder', null, 'matches no field'], ['contacts', null, 'holds records of its own: add them on the record'],
      ['Deadline', 'deadline', null],
    ])
    expect(p.rows[0]!.value).toEqual({ id: 'a', title: 'A', deadline: '2026-12-01' })
  })

  it('has no rows without a header row and one row under it', () => {
    expect(plan('Title').rows).toEqual([])
    expect(plan('').columns).toEqual([])
  })
})
