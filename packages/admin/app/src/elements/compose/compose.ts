/** The compose canvas's rules (spec §8.7): what may connect to what, how a key moves a node, and the ops each action
 *  stages. Pure. L7 wires the writes; until then a staged op is all an action does (nothing writes). The ops address
 *  the systems registry (`systems:<id>`); a node's position, deployment order and relations (`relates`, Q58) are the
 *  fields L4c/L7 specify, named here as the canvas uses them. */
import type { StageOp } from '../../api.ts'

/** A System on the canvas, composed and not deployed: its kind, name, centre (px on the canvas) and deployment
 *  order (0: never deployed — a link). */
export interface ComposeNode { id: string; kind: string; name: string; x: number; y: number; order: number }
/** A relation drawn on the canvas; `invalid` is the refusal sentence of one that cannot be (drawn clay, never staged). */
export interface ComposeEdge { from: string; to: string; label: string; invalid?: string }

/** A node's drawn box (css/map.css `--w-cmp-node`, `--h-node`), the steps a key moves it, and the canvas's size
 *  when it cannot be measured. */
export const COMPOSE = { nodeW: 190, nodeH: 56, step: 8, bigStep: 40, canvasW: 520, canvasH: 440 } as const

/** A kind as a sentence names it. */
const NOUN: Record<string, string> = {
  safe: 'a Safe', 'hats-tree': 'a Hats tree', hat: 'a hat', 'snapshot-space': 'a Snapshot space', 'gardens-community': 'a Gardens community',
  'gardens-pool': 'a Gardens pool', link: 'a link', wallet: 'a wallet',
}
const noun = (kind: string) => NOUN[kind] ?? `a ${kind.replace(/-/g, ' ')}`
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What may point into each kind, the relation it is (§8.4's words), what the refusal says the source cannot do,
 *  and what fits instead. A kind with no entry takes nothing in. */
const INTO: Record<string, { from: Record<string, string>; cannot: string; fits: string }> = {
  safe: { from: { hat: 'signs', safe: 'signs' }, cannot: 'sign for a Safe', fits: 'a hat or addresses' },
  hat: { from: { hat: 'appoints', 'hats-tree': 'holds', 'snapshot-space': 'elects', safe: 'holds' }, cannot: 'appoint a hat', fits: 'a hat, a Hats tree, a Snapshot space or a Safe' },
  'gardens-pool': { from: { 'gardens-community': 'pool', safe: 'admin' }, cannot: 'feed a Gardens pool', fits: 'a Gardens community or a Safe' },
  'gardens-community': { from: { safe: 'admin' }, cannot: 'admin a Gardens community', fits: 'a Safe' },
  wallet: { from: { hat: 'holds' }, cannot: 'hold a wallet', fits: 'a hat' },
  'hats-tree': { from: { safe: 'holds' }, cannot: 'hold a Hats tree', fits: 'a Safe' },
}
/** Why nothing connects into these. */
const SEALED: Record<string, string> = {
  'snapshot-space': 'Nothing connects into a Snapshot space: it is where the vote is held.',
  link: 'Nothing connects into a link: it is listed, never read.',
}

/** The relation `from` would be to `to`, by kind, or null when it cannot be. */
export function relationOf(from: string, to: string): string | null {
  return INTO[to]?.from[from] ?? null
}

/** True when a `from` may connect to a `to` (by kind); otherwise the sentence that says why not and what fits. */
export function canConnect(from: string, to: string): true | string {
  if (relationOf(from, to) !== null) return true
  const into = INTO[to]
  if (!into) return SEALED[to] ?? `Nothing connects into ${noun(to)}.`
  return `${capital(noun(from))} can’t ${into.cannot}. Connect ${into.fits}.`
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** The node an arrow key moves: 8px, 40px with Shift (the single-pointer alternative to a drag, 2.5.7). A node stays
 *  whole on the canvas: its centre never goes above or before half its box. Any other key leaves it as it was. */
export function moveBy(n: ComposeNode, key: string, shift: boolean): ComposeNode {
  const d = ARROWS[key]
  if (!d) return n
  const step = shift ? COMPOSE.bigStep : COMPOSE.step
  return { ...n, x: Math.max(COMPOSE.nodeW / 2, n.x + d[0] * step), y: Math.max(COMPOSE.nodeH / 2, n.y + d[1] * step) }
}

const record = (id: string) => `systems:${id}`

/** The deployment order a new node takes: after every deployable one. */
export function nextOrder(nodes: ComposeNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.order), 0) + 1
}

/** How many transactions deploying the canvas prepares, in order: one per deployable node (a link is listed, never
 *  deployed) and one per signer gate (a hat that signs for a Safe, through Hats Signer Gate). */
export function preparedCount(nodes: ComposeNode[], edges: ComposeEdge[]): number {
  const kind = new Map(nodes.map(n => [n.id, n.kind]))
  const gates = edges.filter(e => !e.invalid && e.label === 'signs' && kind.get(e.from) === 'hat' && kind.get(e.to) === 'safe').length
  return nodes.filter(n => n.kind !== 'link').length + gates
}

/** Placing a node creates its System. */
export function opsForPlace(n: ComposeNode): StageOp[] {
  return [{ op: 'create', record: record(n.id), value: { id: n.id, kind: n.kind, name: n.name, position: { x: n.x, y: n.y }, order: n.order } }]
}

/** Moving a node stores its position (the compose canvas keeps positions; the DAO map computes its own, §8.2). */
export function opsForMove(n: ComposeNode): StageOp[] {
  return [{ op: 'update', record: record(n.id), set: { position: { x: n.x, y: n.y } } }]
}

const relatesOf = (from: string, edges: ComposeEdge[]) => edges.filter(e => e.from === from && !e.invalid).map(e => ({ to: e.to, label: e.label }))

/** A connection (or a rename of one) sets every relation the source holds, as the edges now stand. */
export function opsForConnect(from: string, edges: ComposeEdge[]): StageOp[] {
  return [{ op: 'update', record: record(from), set: { relates: relatesOf(from, edges) } }]
}

/** Removing a node deletes its System and takes it out of every relation that pointed at it. `edges` are the edges
 *  before the removal. */
export function opsForDelete(id: string, edges: ComposeEdge[]): StageOp[] {
  const left = edges.filter(e => e.from !== id && e.to !== id)
  const sources = [...new Set(edges.filter(e => e.to === id && e.from !== id && !e.invalid).map(e => e.from))]
  return [{ op: 'delete', record: record(id) }, ...sources.flatMap(s => opsForConnect(s, left))]
}

/** Renaming a node. */
export function opsForRename(id: string, name: string): StageOp[] {
  return [{ op: 'update', record: record(id), set: { name } }]
}
