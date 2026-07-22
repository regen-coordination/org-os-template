import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'

export interface GraphArtifact {
  builtAtCommit: string | null
  nodes: Array<{ id: string; label: string; x: number; y: number; size: number; community: number; source: string; kind: string; slug?: string }>
  edges: Array<{ s: string; t: string; kind: string }>
}

/** Deterministic: circular init (insertion order is sorted upstream) + fixed FA2 iterations. */
export function layoutGraph(graph: Graph, iterations = 200): Graph {
  circular.assign(graph)
  forceAtlas2.assign(graph, { iterations, settings: forceAtlas2.inferSettings(graph) })
  graph.forEachNode((id) => {
    const degree = graph.degree(id)
    graph.setNodeAttribute(id, 'size', Math.max(2, Math.min(14, 2 + Math.sqrt(degree) * 2)))
  })
  return graph
}

export function serializeArtifact(graph: Graph): GraphArtifact {
  const nodes: GraphArtifact['nodes'] = []
  graph.forEachNode((id, a) => nodes.push({
    id, label: a.label, x: round(a.x), y: round(a.y), size: a.size ?? 3,
    community: a.community ?? 0, source: a.source ?? '', kind: a.kind ?? 'note',
    ...(a.slug ? { slug: a.slug } : {}),
  }))
  const edges: GraphArtifact['edges'] = []
  graph.forEachEdge((_e, a, s, t) => edges.push({ s, t, kind: a.kind ?? 'wikilink' }))
  nodes.sort((a, b) => a.id.localeCompare(b.id)); edges.sort((a, b) => (a.s + a.t).localeCompare(b.s + b.t))
  return { builtAtCommit: (graph.getAttribute('builtAtCommit') as string) ?? null, nodes, edges }
}

const round = (n: number) => Math.round(n * 100) / 100
