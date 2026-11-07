import { describe, it, expect } from 'vitest'
import { nodeName, runningJobs, sectionGraph } from './flow.ts'
import { resource } from '../test/data.ts'
import type { JobRecord } from '../api.ts'

const job = (id: string, resourceId: string, status: JobRecord['status']): JobRecord => ({ id, op: 'x', resource: resourceId, label: 'X', cmd: null, args: [], writes: [],
  status, created: '2026-10-16T10:00:00Z', started: null, ended: null, exitCode: null, changed: [], surprises: [], sentence: null })

describe('flow', () => {
  it('names a node for a screen reader', () => {
    expect(nodeName(resource({ name: 'Ana', kind: 'person', status: null }))).toBe('Ana, person')
  })

  it("a section's map holds its records, their direct neighbours drawn faint, and the edges between them", () => {
    const rows = [resource({ id: 'project:a' })]
    const view = { board: 'organization' as const, portals: [],
      nodes: [rows[0]!, resource({ id: 'person:b', kind: 'person' }), resource({ id: 'idea:far', kind: 'idea' })],
      edges: [{ from: 'project:a', to: 'person:b', kind: 'lead' }, { from: 'idea:far', to: 'person:b', kind: 'champion' }] }
    const g = sectionGraph(rows, view)
    expect(g.nodes.map(n => n.id)).toEqual(['project:a', 'person:b'])
    expect(g.edges).toEqual([{ from: 'project:a', to: 'person:b', kind: 'lead' }])
    expect([...g.faint]).toEqual(['person:b'])
  })

  it("draws no edge to a neighbour the map doesn't hold", () => {
    const rows = [resource({ id: 'project:a' })]
    const g = sectionGraph(rows, { board: 'organization', portals: [], nodes: rows, edges: [{ from: 'project:a', to: 'person:gone', kind: 'lead' }] })
    expect(g.nodes.map(n => n.id)).toEqual(['project:a'])
    expect(g.edges).toEqual([])
    expect(g.faint.size).toBe(0)
  })

  it('knows the first running or waiting job of each resource', () => {
    const m = runningJobs([job('1', 'a', 'ok'), job('2', 'a', 'running'), job('3', 'a', 'queued'), job('4', 'b', 'queued')])
    expect([...m].map(([r, j]) => [r, j.id])).toEqual([['a', '2'], ['b', '4']])
  })
})
