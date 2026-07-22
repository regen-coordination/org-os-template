import Graph from 'graphology'

interface NxJson {
  built_at_commit?: string
  nodes: Array<Record<string, unknown> & { id: string }>
  links: Array<{ source: string; target: string } & Record<string, unknown>>
}

/** networkx node-link → graphology; node ids namespaced '<source>:<id>' to avoid cross-source collisions. */
export function convertNetworkx(json: NxJson, sourceId: string): Graph {
  const g = new Graph({ multi: false, type: 'undirected' })
  if (json.built_at_commit) g.setAttribute('builtAtCommit', json.built_at_commit)
  for (const n of [...json.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    g.addNode(`${sourceId}:${n.id}`, {
      label: (n.label as string) ?? n.id,
      community: (n.community as number) ?? 0,
      sourceFile: (n.source_file as string) ?? null,
      kind: 'semantic',
      source: sourceId,
    })
  }
  for (const e of json.links) {
    const s = `${sourceId}:${e.source}`, t = `${sourceId}:${e.target}`
    if (g.hasNode(s) && g.hasNode(t) && !g.hasEdge(s, t)) g.addEdge(s, t, { kind: 'semantic' })
  }
  return g
}
