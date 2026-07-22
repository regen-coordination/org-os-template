import { describe, it, expect } from 'vitest'
import Graph from 'graphology'
import { layoutGraph, serializeArtifact } from '../src/graph/layout.ts'

function tinyGraph() {
  const g = new Graph({ type: 'undirected' })
  g.addNode('a', { label: 'A', kind: 'note', source: 's', community: 1 })
  g.addNode('b', { label: 'B', kind: 'note', source: 's', community: 1 })
  g.addEdge('a', 'b', { kind: 'wikilink' })
  return g
}

describe('layout', () => {
  it('assigns finite deterministic positions', () => {
    const g1 = layoutGraph(tinyGraph()); const g2 = layoutGraph(tinyGraph())
    expect(g1.getNodeAttribute('a', 'x')).toBeCloseTo(g2.getNodeAttribute('a', 'x'), 10)
    expect(Number.isFinite(g1.getNodeAttribute('b', 'y'))).toBe(true)
  })
  it('serializes a compact artifact', () => {
    const artifact = serializeArtifact(layoutGraph(tinyGraph()))
    expect(artifact.nodes[0]).toMatchObject({ id: 'a', label: 'A', community: 1 })
    expect(typeof artifact.nodes[0].x).toBe('number')
    expect(artifact.edges).toEqual([{ s: 'a', t: 'b', kind: 'wikilink' }])
  })
})
