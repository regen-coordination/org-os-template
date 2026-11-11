import { describe, it, expect } from 'vitest'
import { flowOf } from './flow.ts'
import type { ComposeEdge } from './compose.ts'

const EDGES: ComposeEdge[] = [
  { from: 'roles/council', to: 'vault', label: 'signs' },
  { from: 'roles/council', to: 'roles/stewards', label: 'appoints' },
  { from: 'votes', to: 'roles/council', label: 'elects' },
  { from: 'forum', to: 'vault', label: '', invalid: 'A link can’t sign for a Safe.' },
  { from: 'pool', to: 'other', label: 'admin' },
]

describe('flowOf: the edges a prepared step touches', () => {
  it('takes every valid edge with an end in a step’s System, a hat counting as its tree', () => {
    const f = flowOf([{ system: 'vault' }], EDGES)
    expect(f.edges).toEqual([['roles/council', 'vault']])
    const g = flowOf([{ system: 'roles' }], EDGES)
    expect(g.edges).toEqual([['roles/council', 'vault'], ['roles/council', 'roles/stewards'], ['votes', 'roles/council']])
  })
  it('never takes an invalid edge, and says once what it touches', () => {
    const f = flowOf([{ system: 'vault' }, { system: 'vault' }], EDGES)
    expect(f.edges.some(([a]) => a === 'forum')).toBe(false)
    expect(f.sentence).toBe('2 prepared transactions touch 1 relation on the map.')
    expect(f.id).toBe('compose:vault')
  })
  it('with nothing prepared, nothing lights', () => {
    expect(flowOf([], EDGES).edges).toEqual([])
  })
})
