// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { ReactElement } from 'react'
import { Card } from './Card.tsx'
import { resource } from '../test/data.ts'

const inRouter = (ui: ReactElement) => render(<Router hook={memoryLocation({ path: '/' }).hook}>{ui}</Router>)
const r = resource({ id: 'project:br', name: 'Seed Library', status: 'develop', facts: { lead: 'steward-b', started: '2026-10-02' },
  changed: { at: '2026-10-17T11:00:00Z', by: 'Steward B' } })

// C10 (ledger): the row, tile, node and chip densities are gone with their callers, and so are their cases and
// footer()'s; a card is the record's fields. The hostile-text case keeps its one density.
describe('Card', () => {
  it("full: every field the entry holds, in its order, read-only, its marks said above them", () => {
    const entry = { id: 'br', title: 'Seed Library', status: 'develop', partners: ['example-os', 'regen'], empty: '', driver: { ok: true } }
    inRouter(<Card record={r} marks={['needs', 'staged']} entry={entry} />)
    const table = screen.getByRole('group', { name: 'Fields of Seed Library' })
    expect([...table.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['id', 'title', 'status', 'partners'])
    expect(table.textContent).toContain('example-os, regen')
    expect(screen.getByText('Needs you')).toBeTruthy()
  })

  it('full: a resource with no entry shows its facts, never the driver', () => {
    inRouter(<Card record={resource({ id: 'seat:s', kind: 'seat', name: 'reviewer', source: null, facts: { state: 'dialog', pane: null, driver: { ok: true } } })} marks={[]} />)
    const table = screen.getByRole('group', { name: 'Fields of reviewer' })
    expect([...table.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['state'])
  })

  it('full: takes the name its page gives the table (M-5)', () => {
    inRouter(<Card record={resource({ id: 'seat:s', kind: 'seat', name: 'reviewer', source: null, facts: { state: 'dialog' } })} marks={[]} label="State" />)
    expect(screen.getByRole('group', { name: 'State' })).toBeTruthy()
  })

  it('renders hostile text as text (Review Focus 3)', () => {
    const name = `<img src=x onerror="alert(1)"> ${'very long name '.repeat(140)}\nsecond line`
    const hostile = resource({ name, attention: { level: 'warn', text: '<b>bold?</b>' }, facts: { lead: '<script>x</script>' } })
    const { container } = inRouter(<Card record={hostile} marks={['needs']} />)
    expect(container.querySelector('img, b, script')).toBeNull()
    expect(container.textContent).toContain('<script>x</script>')
  })
})

describe('Card for a proposal', () => {
  const p = resource({ id: 'proposal:p-2026-10-16-001', kind: 'proposal', name: 'Move the garden seat', status: 'approving',
    attention: { level: 'warn', text: 'open: needs 1 more approval' }, facts: { author: 'carla', closesAt: '2026-10-22T12:00:00Z', stale: [0] },
    source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: 'p-2026-10-16-001' } })

  it('full: the proposal\'s fields, with its marks said', () => {
    const { container } = inRouter(<Card record={p} marks={['needs', 'stale']} entry={{ author: 'carla', ops: 1 }} />)
    expect([...container.querySelectorAll('.smark-word')].map(e => e.textContent)).toEqual(['Needs you', 'Changed since staged'])
    expect(screen.getByText('carla')).toBeTruthy()
  })
})
