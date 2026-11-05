// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { column, listColumns } from './columns.tsx'
import { resource } from '../test/data.ts'

const o = { marks: () => [], entry: () => undefined, now: new Date('2026-10-17T12:00:00Z') }

describe('the column library', () => {
  it("is a section's columns by default: kind for a mixed section, the kind's facts for one kind", () => {
    expect(listColumns(['project'], o).map(c => c.label)).toEqual(['name', 'status', 'needs', 'lead', 'started', 'changed'])
    expect(listColumns(['role', 'seat'], o).map(c => c.label)).toEqual(['kind', 'name', 'status', 'needs', 'changed'])
  })

  it("draws ages from the block's now, never the clock", () => {
    const r = resource({ changed: { at: '2026-10-17T11:00:00Z', by: 'Steward A' } })
    render(<Router hook={memoryLocation({ path: '/' }).hook}><span>{column('changed', o)!.cell(r)}</span><span>{column('age', o)!.cell(r)}</span></Router>)
    expect(screen.getByText('1 h ago · Steward A')).toBeTruthy()
    expect(screen.getByText('1 h ago')).toBeTruthy()
  })

  it("reads any other id as a fact column of the record's kind, and nothing for an id no kind has", () => {
    expect(column('lead', o)!.cell(resource({ facts: { lead: 'steward-a' } }))).toBe('steward-a')
    expect(column('lead', o)!.cell(resource({ id: 'idea:x', kind: 'idea' }))).toBe('')
  })
})
