import Graph from 'graphology'
import type { NoteFile } from '../scan.ts'
import type { RenderedNote } from '../markdown.ts'

export function buildWikilinkGraph(notes: NoteFile[], rendered: Map<string, RenderedNote>): Graph {
  const g = new Graph({ multi: false, type: 'undirected' })
  for (const n of [...notes].sort((a, b) => a.slug.localeCompare(b.slug))) {
    g.addNode(`note:${n.slug}`, { label: n.title, kind: 'note', source: n.source, slug: n.slug, community: 0 })
  }
  for (const n of notes) {
    for (const link of rendered.get(n.slug)?.links ?? []) {
      if (link.status !== 'ok' || !link.to) continue
      const s = `note:${n.slug}`, t = `note:${link.to}`
      if (s !== t && g.hasNode(t) && !g.hasEdge(s, t)) g.addEdge(s, t, { kind: 'wikilink' })
    }
  }
  return g
}

/** Merge semantic graphs + wikilink graph. Semantic nodes matching a scanned note (by source_file suffix) gain slug + a bridge edge. */
export function mergeGraphs(semantic: Graph[], wikilink: Graph, notes: NoteFile[]): Graph {
  const merged = new Graph({ multi: false, type: 'undirected' })
  const copy = (from: Graph) => {
    from.forEachNode((id, attrs) => { if (!merged.hasNode(id)) merged.addNode(id, { ...attrs }) })
    from.forEachEdge((_e, attrs, s, t) => { if (!merged.hasEdge(s, t)) merged.addEdge(s, t, { ...attrs }) })
  }
  for (const g of semantic) {
    copy(g)
    if (g.getAttribute('builtAtCommit')) merged.setAttribute('builtAtCommit', g.getAttribute('builtAtCommit'))
  }
  copy(wikilink)
  const byPath = new Map(notes.map(n => [`${n.source}|${n.relPath}`, n]))
  merged.forEachNode((id, attrs) => {
    if (attrs.kind !== 'semantic' || !attrs.sourceFile) return
    const note = byPath.get(`${attrs.source}|${attrs.sourceFile}`)
    if (!note) return
    merged.setNodeAttribute(id, 'slug', note.slug)
    const noteId = `note:${note.slug}`
    if (merged.hasNode(noteId) && !merged.hasEdge(id, noteId)) merged.addEdge(id, noteId, { kind: 'bridge' })
  })
  return merged
}
