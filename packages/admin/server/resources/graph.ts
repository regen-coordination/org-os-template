import { simpleGit } from 'simple-git'
import type { Adapter, AdapterResult, Board, BoardView, Edge, Graph, Portal, Resource } from './types.ts'

export const isBoard = (v: unknown): v is Board => v === 'organization' || v === 'systems'

const OTHER: Record<Board, Board> = { organization: 'systems', systems: 'organization' }
const TITLE: Record<Board, string> = { organization: 'Organization', systems: 'Systems' }

/** The dashed card an adapter leaves when its source is missing or unreadable. */
/** True when git tracks `rel` (read-only: `ls-files --error-unmatch`). Any error, including
 *  "not a repository", means it is not tracked. */
export async function trackedInGit(repo: string, rel: string): Promise<boolean> {
  try { await simpleGit(repo).raw(['ls-files', '--error-unmatch', '--', rel]); return true } catch { return false }
}

/** The card for a registry that git tracks but the working tree has lost: left unsaid, a save
 *  would quietly begin a new file over the committed one. */
export async function lostRegistryCard(adapter: Pick<Adapter, 'name' | 'board' | 'title'>, repo: string, registry: string): Promise<Resource | null> {
  const rel = `data/${registry}.yaml`
  if (!(await trackedInGit(repo, rel))) return null
  return absentCard({ ...adapter, title: rel }, 'is in git but missing from the working tree — restore it before saving anything', `${adapter.name}:${registry}`)
}

/** `quiet`: the source is simply not here (no modules, no crew), so the card explains itself in `facts.why`
 *  and asks nothing of the person; otherwise it is a warning, for a file that cannot be read. */
export function absentCard(adapter: Pick<Adapter, 'name' | 'board' | 'title'>, why: string, key = adapter.name, quiet = false): Resource {
  return { id: `absent:${key}`, kind: 'absent', board: adapter.board, name: adapter.title, status: 'absent',
    attention: quiet ? null : { level: 'warn', text: why }, changed: null, facts: quiet ? { why } : {}, source: null }
}

/** A seat works on a project when its title or brief names the project: by its id, or by a
 *  name of four characters or more (shorter names match too much ordinary text). */
export function seatLinks(nodes: Resource[]): Edge[] {
  const projects = nodes.filter(n => n.kind === 'project')
  const out: Edge[] = []
  for (const seat of nodes.filter(n => n.kind === 'seat')) {
    const text = `${seat.facts.title ?? ''} ${seat.facts.brief ?? ''}`.toLowerCase()
    if (!text.trim()) continue
    for (const p of projects) {
      const pid = p.id.slice('project:'.length).toLowerCase()
      const name = p.name.toLowerCase()
      if ((pid.length >= 4 && text.includes(pid)) || (name.length >= 4 && text.includes(name))) {
        out.push({ from: seat.id, to: p.id, kind: 'works-on' })
      }
    }
  }
  return out
}

/** One graph from every adapter's answer. An absence becomes a card; an edge is kept only when
 *  both its ends exist; the same edge twice is kept once; an edge between boards is marked. */
export function assemble(results: { adapter: Pick<Adapter, 'name' | 'board' | 'title'>; result: AdapterResult }[]): Graph {
  const nodes: Resource[] = []
  const byId = new Map<string, Resource>()
  const raw: Edge[] = []
  const add = (n: Resource) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n) } }
  for (const { adapter, result } of results) {
    if ('absent' in result) { add(absentCard(adapter, result.absent, adapter.name, !result.failed)); continue }
    result.nodes.forEach(add)
    raw.push(...result.edges)
  }
  const seen = new Set<string>()
  const edges: Edge[] = []
  for (const e of [...raw, ...seatLinks(nodes)]) {
    const a = byId.get(e.from), b = byId.get(e.to)
    if (!a || !b || e.from === e.to) continue
    const key = `${e.from}|${e.to}|${e.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(a.board === b.board ? { from: e.from, to: e.to, kind: e.kind } : { from: e.from, to: e.to, kind: e.kind, crosses: true })
  }
  return { nodes, edges }
}

/** One canvas: its cards, the edges inside it, and one portal gathering every edge that leaves it. */
export function boardView(graph: Graph, board: Board): BoardView {
  const nodes = graph.nodes.filter(n => n.board === board)
  const here = new Set(nodes.map(n => n.id))
  const edges = graph.edges.filter(e => !e.crosses && here.has(e.from))
  const crossing = graph.edges.filter(e => e.crosses && (here.has(e.from) || here.has(e.to)))
  const portals: Portal[] = []
  if (crossing.length > 0) {
    const targets = [...new Set(crossing.map(e => (here.has(e.from) ? e.to : e.from)))]
    const sources = new Set(crossing.map(e => (here.has(e.from) ? e.from : e.to)))
    const other = OTHER[board]
    portals.push({ id: `portal:${other}`, toBoard: other, targets,
      text: `${sources.size} here link to ${targets.length} on ${TITLE[other]}` })
  }
  return { board, nodes, edges, portals }
}
