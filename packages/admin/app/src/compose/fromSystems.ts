/** The compose canvas's adapter (DAO-OS L7 Task 17, spec §4, §7): data/systems.yaml's records, through the actor's own
 *  change, as the canvas's nodes and edges. Pure.
 *
 *  - Every System whose `deployment.status` is `composed` is a node; so is a deployed System the composition names
 *    (the Safe that wears a composed tree's top hat, a tree whose hats sign for a composed Safe, a relation's end), as
 *    `deployed`. Nothing else is: a link or a Safe the composition does not name is the house map's, not the canvas's.
 *  - Each hat of a tree is a node of its own, `<tree>/<key>`, carrying the whole hat as the record holds it (`hat`), a
 *    tree its `deployment`, a Safe its `deployment` and `signer_gate` (`gate`), a System its `relates`: the canvas's ops
 *    rewrite a tree's whole `hats`, a Safe's whole gate and a System's whole `relates`, so every field and entry they do
 *    not change is kept, never put back to a default or dropped.
 *  - Edges are the relations the records state (§4.2): `signer_gate.hats` (the hat signs for the Safe), a hat's
 *    `admin` (appoints), `deployment.top.worn_by` (the Safe holds the tree) and each `relates` entry, whose `to` is a
 *    System id, `system:<id>` or `<tree>/<key>` (PF-R129); a hat ref (a deployed tree's hat) and an end that is not on
 *    the canvas draw no edge.
 *  - A System with no `position` is placed in a column of its own; a hat beside its tree. */
import type { StageOp } from '../api.ts'
import { COMPOSE, relationEnd, type ComposedHat, type ComposeEdge, type ComposeNode } from '../elements/compose/compose.ts'

type Rec = Record<string, unknown>

const SEPOLIA = 'eip155:11155111'
const PREFIX = 'systems:'
/** Where a System with no position of its own goes: a column right of the template's, one row each. */
const SPARE = { x: 640, y: 60, row: 96 } as const
/** A hat beside its tree, one row each. */
const HAT = { dx: -240, row: 96 } as const

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const composed = (s: Rec) => isObj(s.deployment) && s.deployment.status === 'composed'

/** The records as the actor's change leaves them: its creates, updates, replaces and deletes of `systems:` records. */
function projected(systems: readonly Rec[], staged: readonly StageOp[]): Rec[] {
  const out = systems.map(s => ({ ...s }))
  for (const op of staged) {
    const o = op as { op: string; record?: unknown; value?: unknown; set?: unknown }
    if (typeof o.record !== 'string' || !o.record.startsWith(PREFIX)) continue
    const id = o.record.slice(PREFIX.length)
    const at = out.findIndex(s => String(s.id) === id)
    if (o.op === 'create') { if (at < 0 && isObj(o.value)) out.push({ ...o.value }) }
    else if (at < 0) continue
    else if (o.op === 'delete') out.splice(at, 1)
    else if (o.op === 'replace' && isObj(o.value)) out[at] = { ...o.value }
    else if (o.op === 'update' && isObj(o.set)) out[at] = { ...out[at], ...o.set }
  }
  return out
}

const endOf = relationEnd
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const gateHats = (s: Rec): string[] => (isObj(s.signer_gate) ? listOf(s.signer_gate.hats).filter((h): h is string => typeof h === 'string') : [])
const topWearer = (s: Rec): string | undefined => (isObj(s.deployment) && isObj(s.deployment.top) ? str(s.deployment.top.worn_by) : undefined)

/** The hats of a tree as its record holds them, each kept whole. */
const hatsOf = (s: Rec): ComposedHat[] => listOf(s.hats).filter((h): h is ComposedHat => isObj(h) && typeof h.key === 'string' && h.key !== '')

/** The canvas's nodes and edges for the org's composition, as `systems` (data/systems.yaml's entries the viewer may
 *  read) and the actor's `staged` ops leave it; `chain` is the composition's (Sepolia when nothing names one). */
export function composeFromSystems(systems: readonly Rec[], staged: readonly StageOp[]): { nodes: ComposeNode[]; edges: ComposeEdge[]; chain: string } {
  const all = projected(systems, staged).filter(s => str(s.id) !== undefined)
  const plan = all.filter(composed)
  const chain = plan.map(s => str(s.chain) ?? (isObj(s.deployment) ? str(s.deployment.network) : undefined)).find(Boolean) ?? SEPOLIA
  if (plan.length === 0) return { nodes: [], edges: [], chain }

  // the deployed Systems the composition names: a top hat's wearer, a gate's tree, a relation's end
  const byId = new Map(all.map(s => [String(s.id), s]))
  const named = new Set<string>()
  for (const s of plan) {
    const top = topWearer(s)
    if (top) named.add(top)
    for (const h of gateHats(s)) { const end = endOf(h); if (end) named.add(end.split('/')[0]!) }
    for (const r of listOf(s.relates)) {
      const end = isObj(r) && typeof r.to === 'string' ? endOf(r.to) : null
      if (end) named.add(end.split('/')[0]!)
    }
  }
  const drawn = [...plan, ...[...named].filter(id => byId.has(id) && !composed(byId.get(id)!)).map(id => byId.get(id)!)]

  const nodes: ComposeNode[] = []
  let spare = 0
  for (const s of drawn) {
    const id = String(s.id)
    const kind = str(s.kind) ?? 'link'
    const px = isObj(s.position) ? num(s.position.x) : undefined
    const py = isObj(s.position) ? num(s.position.y) : undefined
    const placed = px !== undefined && py !== undefined
    const x = placed ? px : SPARE.x
    const y = placed ? py : SPARE.y + SPARE.row * spare++
    const d = isObj(s.deployment) ? s.deployment : undefined
    const node: ComposeNode = { id, kind, name: str(s.name) ?? id, x, y, order: num(s.order) ?? 0 }
    if (!composed(s)) node.deployed = true
    // L7 gap B1: the inspector shows a deployed System's address read only, and edits any System's description and notes
    for (const k of ['address', 'description', 'notes'] as const) { const v = str(s[k]); if (v !== undefined) node[k] = v }
    if (d) node.deployment = d
    if (Array.isArray(s.relates)) node.relates = s.relates
    if (kind === 'safe') {
      if (d && Array.isArray(d.owners)) node.owners = d.owners.map(String)
      const t = d ? num(d.threshold) : undefined
      if (t !== undefined) node.threshold = t
      if (isObj(s.signer_gate)) node.gate = s.signer_gate
    }
    nodes.push(node)
    if (kind === 'hats-tree') {
      hatsOf(s).forEach((h, i) => {
        nodes.push({
          id: `${id}/${h.key}`, kind: 'hat', tree: id, name: str(h.details) ?? h.key, order: 0,
          x: Math.max(COMPOSE.nodeW / 2, x + HAT.dx), y: Math.max(COMPOSE.nodeH / 2, y + HAT.row * i),
          wearers: Array.isArray(h.wearers) ? h.wearers.map(String) : [], hat: h,
          ...(node.deployed ? { deployed: true } : {}),
        })
      })
    }
  }

  const on = new Set(nodes.map(n => n.id))
  const edges: ComposeEdge[] = []
  const seen = new Set<string>()
  const edge = (from: string, to: string, label: string) => {
    const k = `${from}>${to}`
    if (!on.has(from) || !on.has(to) || from === to || seen.has(k)) return
    seen.add(k)
    edges.push({ from, to, label })
  }
  for (const s of drawn) {
    const id = String(s.id)
    for (const h of gateHats(s)) { const end = endOf(h); if (end) edge(end, id, 'signs') }
    if (s.kind === 'hats-tree') {
      for (const h of hatsOf(s)) if (typeof h.admin === 'string' && h.admin !== 'top') edge(`${id}/${h.admin}`, `${id}/${h.key}`, 'appoints')
      const top = topWearer(s)
      if (top) edge(top, id, 'holds')
    }
    for (const r of listOf(s.relates)) {
      if (!isObj(r) || typeof r.to !== 'string' || typeof r.label !== 'string') continue
      const end = endOf(r.to)
      if (end) edge(id, end, r.label)
    }
  }
  return { nodes, edges, chain }
}
