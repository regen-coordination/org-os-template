import type { BoardView, GraphEdge, JobRecord, Resource } from '../api.ts'
import { nodeName } from '../parts/marks.ts'

export { nodeName }

/** Each resource's first running or waiting job, for "running N s" on its node. */
export function runningJobs(jobs: JobRecord[]): Map<string, JobRecord> {
  const m = new Map<string, JobRecord>()
  for (const j of jobs) if ((j.status === 'running' || j.status === 'queued') && !m.has(j.resource)) m.set(j.resource, j)
  return m
}


/** A section's map (spec §6.2): its records, plus their direct edges and the neighbours at the far
 *  ends, drawn faint because they are not in the list. An edge is drawn only when both of its ends
 *  are on the map. */
export function sectionGraph(rows: Resource[], view: BoardView): { nodes: Resource[]; edges: GraphEdge[]; faint: Set<string> } {
  const here = new Set(rows.map(r => r.id))
  const direct = view.edges.filter(e => here.has(e.from) || here.has(e.to))
  const near = new Set(direct.flatMap(e => [e.from, e.to]).filter(id => !here.has(id)))
  const extra = view.nodes.filter(n => near.has(n.id))
  const drawn = new Set([...here, ...extra.map(n => n.id)])
  return { nodes: [...rows, ...extra], edges: direct.filter(e => drawn.has(e.from) && drawn.has(e.to)), faint: new Set(extra.map(n => n.id)) }
}
