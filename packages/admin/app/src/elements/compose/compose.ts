/** The compose canvas's rules (spec §8.7): what may connect to what, how a key moves a node, and the ops each action
 *  stages. Pure. L7 wires the writes; until then a staged op is all an action does (nothing writes). The ops address
 *  the systems registry (`systems:<id>`); a node's position, deployment order and relations (`relates`, Q58) are the
 *  fields L4c/L7 specify, named here as the canvas uses them. */
import type { StageOp } from '../../api.ts'
import { CHAIN_HELD_SENTENCE } from '../../../../lib/chain-held.mjs'

/** A System on the canvas, composed and not deployed: its kind, name, centre (px on the canvas) and deployment
 *  order (0: never deployed — a link). */
export interface ComposeNode {
  id: string; kind: string; name: string; x: number; y: number; order: number
  /** A hat's tree (a hat's canvas id is `<tree id>/<hat key>`, L7-D6). */
  tree?: string
  /** A Safe's CAIP-10 owners and threshold; a hat's wearers (the composed records, spec §4.1). */
  owners?: string[]; threshold?: number; wearers?: string[]
  /** Read back from the chain: no longer a draft. What the chain holds of it is shown, never edited (L7 gap B1). */
  deployed?: boolean
  /** A System's address, description and notes as its record holds them (L7 gap B1: the inspector shows the address
   *  of a deployed one, read only, and edits the description and notes of any). */
  address?: string; description?: string; notes?: string
  /** A Safe's `deployment` and `signer_gate` as the record holds them, so an edit keeps what it does not touch. */
  deployment?: Record<string, unknown>; gate?: Record<string, unknown>
  /** A hat as its tree's record holds it, so an op rewriting the tree's list keeps every field it does not change. */
  hat?: ComposedHat
  /** The System's `relates` as its record holds them: an op rewriting them keeps every entry whose end the canvas does
   *  not draw (a hat ref, a System the viewer cannot read), byte for byte. */
  relates?: unknown[]
}
/** A composed hat as the tree's `hats` holds it (lib/compose.mjs ComposedHat). */
export interface ComposedHat { key: string; details: string; admin: string; max_supply: number; mutable: boolean; wearers: string[]; role?: 'decides' | 'acts'; image?: string; hat: string | null }
/** What the ops need to know of the canvas: every tree's hats as they stand, and the chain new Systems are on. */
export interface ComposeCtx {
  trees: Record<string, ComposedHat[]>; chain: string; gates?: Record<string, Record<string, unknown>>; deployments?: Record<string, Record<string, unknown>>
  /** The canvas's nodes as they stand: which ends it draws, which are deployed, and each System's stored `relates`. */
  nodes?: ComposeNode[]
}
/** What the ops know of a canvas: its trees as `edges` leave them, its Safes' gates, its Systems' deployments, its nodes. */
export function contextOf(nodes: ComposeNode[], edges: ComposeEdge[], chain: string): ComposeCtx {
  return {
    trees: treesOf(nodes, edges), chain, nodes,
    gates: Object.fromEntries(nodes.filter(n => n.gate).map(n => [n.id, n.gate!])),
    deployments: Object.fromEntries(nodes.filter(n => n.deployment).map(n => [n.id, n.deployment!])),
  }
}
export const CROSS_TREE = 'A hat’s admin is a hat of the same tree.'
/** What a deployed System's inspector says (L7 gap B1): what the chain holds is shown as it is, the rest is edited. */
export const DEPLOYED = 'Deployed: what the chain holds is shown as it is; its name, description, notes, place and relations are edited here.'
/** What the inspector of a System still composed in the records says when the chain holds it: every one of its steps is
 *  done, and Read back has not recorded it yet (whole-platform walk I13). */
export const ON_CHAIN = 'The chain holds this System as it was composed. Read back, on the prepared steps, records it as deployed.'
/** Why a deployed System is not removed on the canvas (L7 gap B1). */
export const DEPLOYED_REMOVE = 'A deployed System is not removed on the canvas: the chain still holds it. Delete its record on its own page if the org no longer keeps it.'
/** Why a hat of a deployed tree is not renamed or made to appoint: its details and admin are the chain's (L7 gap B1). */
export const HAT_HELD = CHAIN_HELD_SENTENCE('hats')
/** Why a connection that would write a deployed System's record is not made. */
export const INTO_DEPLOYED = 'That would change a deployed System, and the canvas changes nothing on what the chain holds.'
/** Why no hat is placed into a deployed tree. */
export const DEPLOYED_TREE = 'A hat is placed in a composed Hats tree: this one is deployed, and the canvas changes nothing on it.'
/** Why a Safe is not made the wearer of a tree's top hat when the tree is not known to be composed. */
export const TREE_NOT_COMPOSED = 'A Safe wears the top hat of a composed Hats tree only, and this tree is not known to be composed.'

/** Fewest pixels a pointer travels before a press is a drag (final M-1: jitter stages nothing). */
export const DRAG_THRESHOLD_PX = 4
export const NO_TREE = 'A hat lives in a Hats tree. Place a Hats tree first.'
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
/** A hat is `<tree id>/<hat key>`; nothing else on the canvas has a slash. */
export const isHat = (id: string) => id.includes('/')
export const treeOfHat = (id: string) => id.slice(0, id.indexOf('/'))
export const keyOfHat = (id: string) => id.slice(id.indexOf('/') + 1)

/** The deployment order a new node takes: after every deployable one. */
export function nextOrder(nodes: ComposeNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.order), 0) + 1
}

/** The planner's step count for the composition (spec §8.2): it is the planner that knows, the canvas only says it. */
export function preparedCount(c: { steps: number }): number {
  return c.steps
}

/** A rough count for a canvas with no plan yet: one per deployable node (a link is listed, never deployed) and one per
 *  signer gate (a hat that signs for a Safe). */
export function estimateSteps(nodes: ComposeNode[], edges: ComposeEdge[]): number {
  const kind = new Map(nodes.map(n => [n.id, n.kind]))
  const gates = edges.filter(e => !e.invalid && e.label === 'signs' && kind.get(e.from) === 'hat' && kind.get(e.to) === 'safe').length
  return nodes.filter(n => n.kind !== 'link' && n.kind !== 'hat').length + gates
}

const valid = (edges: ComposeEdge[]) => edges.filter(e => !e.invalid)

/** Each Hats tree on the canvas and its hats, as the records would hold them: a hat appointed by a hat of its tree
 *  takes that hat as its admin, any other is under the top hat. */
export function treesOf(nodes: ComposeNode[], edges: ComposeEdge[]): Record<string, ComposedHat[]> {
  const out: Record<string, ComposedHat[]> = {}
  for (const n of nodes) if (n.kind === 'hats-tree') out[n.id] = []
  for (const n of nodes) {
    if (n.kind !== 'hat' || !isHat(n.id)) continue
    const tree = n.tree ?? treeOfHat(n.id)
    const up = valid(edges).find(e => e.to === n.id && e.label === 'appoints' && isHat(e.from) && treeOfHat(e.from) === tree)
    const base: ComposedHat = n.hat ?? { key: keyOfHat(n.id), details: n.name, admin: 'top', max_supply: 1, mutable: true, wearers: [], role: 'acts', hat: null }
    ;(out[tree] ??= []).push({ ...base, key: keyOfHat(n.id), details: n.name, admin: up ? keyOfHat(up.from) : base.admin, wearers: n.wearers ?? base.wearers })
  }
  return out
}

/** The tree's hats with every appointing edge applied (a child's admin is the hat that appoints it). */
function hatsWithAdmins(tree: string, edges: ComposeEdge[], ctx: ComposeCtx): ComposedHat[] {
  return (ctx.trees[tree] ?? []).map(h => {
    const up = valid(edges).find(e => e.to === `${tree}/${h.key}` && e.label === 'appoints' && isHat(e.from) && treeOfHat(e.from) === tree)
    return up ? { ...h, admin: keyOfHat(up.from) } : h
  })
}

const setHats = (tree: string, hats: ComposedHat[]): StageOp => ({ op: 'update', record: record(tree), set: { hats } })

/** A Safe's gate as the hats pointing at it make it; what the record already held about the gate is kept. */
function gateOps(safe: string, edges: ComposeEdge[], ctx: ComposeCtx, gone: Set<string> = new Set()): StageOp {
  const hats = [...new Set(valid(edges).filter(e => e.to === safe && e.label === 'signs' && isHat(e.from) && !gone.has(e.from)).map(e => e.from))]
  const base = ctx.gates?.[safe] ?? { threshold: { type: 'absolute', min: 1, target: 1 }, claimable_for: false }
  return { op: 'update', record: record(safe), set: { signer_gate: { ...base, hats } } }
}

/** Whether the canvas draws `id` as deployed (a hat of a deployed tree is). */
const deployedOn = (id: string, ctx: ComposeCtx): boolean =>
  !!ctx.nodes?.some(n => n.deployed && (n.id === id || (isHat(id) && n.id === treeOfHat(id))))

/** Placing a node creates its System; placing a hat adds it to its tree's whole list, or is refused when it has no
 *  tree. */
export function opsForPlace(n: ComposeNode, ctx: ComposeCtx): StageOp[] | string {
  if (n.kind === 'hat') {
    const tree = n.tree ?? (isHat(n.id) ? treeOfHat(n.id) : undefined)
    if (!tree || !Object.hasOwn(ctx.trees, tree)) return NO_TREE
    if (deployedOn(tree, ctx)) return DEPLOYED_TREE
    const hat: ComposedHat = { key: keyOfHat(n.id), details: n.name, admin: 'top', max_supply: 1, mutable: true, wearers: [], role: 'acts', hat: null }
    return [setHats(tree, [...ctx.trees[tree]!, hat])]
  }
  const value: Record<string, unknown> = { id: n.id, kind: n.kind, name: n.name, chain: ctx.chain, position: { x: n.x, y: n.y }, order: n.order, deployment: { status: 'composed' } }
  if (n.kind !== 'link') value.driver = n.kind // a link has no driver: it is framed, never read
  return [{ op: 'create', record: record(n.id), value }]
}

/** Moving a node stores its position (the compose canvas keeps positions; the DAO map computes its own, §8.2), a
 *  deployed System's too (L7 gap B1: its place is its record's). A hat's place follows its tree: it stages nothing. */
export function opsForMove(n: ComposeNode): StageOp[] {
  if (isHat(n.id)) return []
  return [{ op: 'update', record: record(n.id), set: { position: { x: n.x, y: n.y } } }]
}

const HAT_REF = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:0x[0-9a-fA-F]{64}$/
/** A `relates` end, or a gate's hat, as a canvas id: `system:<id>` is `<id>`; a hat ref is no node (null). */
export const relationEnd = (to: string): string | null => (HAT_REF.test(to) ? null : to.startsWith('system:') ? to.slice('system:'.length) : to)

/** The source's whole `relates` as the edges now stand. A stored entry whose end the canvas draws stays as written while
 *  its edge does and goes with it; every other stored entry (a hat ref, a System not on the canvas, one that is not a
 *  relation) is kept byte for byte, in its place; a new edge comes last. Without the stored list, the edges alone. */
function relatesOf(from: string, edges: ComposeEdge[], ctx?: ComposeCtx): unknown[] {
  const drawn = valid(edges).filter(e => e.from === from).map(e => ({ to: e.to, label: e.label }))
  const node = ctx?.nodes?.find(n => n.id === from)
  if (!node?.relates) return drawn
  const on = new Set(ctx!.nodes!.map(n => n.id))
  const used = new Set<number>()
  const out: unknown[] = []
  for (const r of node.relates) {
    const o = typeof r === 'object' && r !== null ? r as { to?: unknown; label?: unknown } : null
    const end = o && typeof o.to === 'string' ? relationEnd(o.to) : null
    if (end === null || !on.has(end)) { out.push(r); continue }
    const i = drawn.findIndex((d, k) => !used.has(k) && d.to === end && d.label === o!.label)
    if (i >= 0) { used.add(i); out.push(r) }
  }
  drawn.forEach((d, k) => { if (!used.has(k)) out.push(d) })
  return out
}

/** A connection (or a rename of one) by relation (§4.2): a hat that signs for a Safe sets that Safe's `signer_gate.hats`;
 *  a hat that appoints a hat sets the child's `admin` in the tree's whole list; anything else sets the source's whole
 *  `relates`, as the edges now stand. No connection writes what the chain holds of a deployed System (review I1, L7 gap
 *  B1): a Safe holding a deployed tree is a relation of the Safe's, not the tree's wearer; a hat signing for a deployed
 *  Safe whose gate does not list it is refused in words, as is a hat of a deployed tree made to appoint. A deployed
 *  System's own `relates` are its record's, so a connection from it stages them. */
export function opsForConnect(from: string, edges: ComposeEdge[], ctx: ComposeCtx): StageOp[] | string {
  if (!isHat(from)) {
    const held = valid(edges).filter(e => e.from === from && e.label === 'holds' && Object.hasOwn(ctx.trees, e.to) && !deployedOn(e.to, ctx))
    const rest = edges.filter(e => !held.includes(e))
    // a Safe that holds a composed Hats tree wears its top hat: the tree's `deployment.top.worn_by`, not a relation
    const worn = held.map(e => wornBy(e.to, from, ctx))
    const refused = worn.find((w): w is string => typeof w === 'string')
    if (refused !== undefined) return refused
    return [{ op: 'update', record: record(from), set: { relates: relatesOf(from, rest, ctx) } }, ...worn as StageOp[]]
  }
  const mine = valid(edges).filter(e => e.from === from)
  if (mine.some(e => e.label === 'appoints' && isHat(e.to) && treeOfHat(e.to) !== treeOfHat(from))) return CROSS_TREE
  if (deployedOn(from, ctx) && mine.some(e => e.label === 'appoints' && isHat(e.to))) return HAT_HELD
  const signed = [...new Set(mine.filter(e => e.label === 'signs' && !isHat(e.to)).map(e => e.to))]
  // a deployed Safe's gate is the chain's: one that already lists this hat is left as it is; a new one is refused
  const listed = (safe: string) => { const h = ctx.gates?.[safe]?.hats; return Array.isArray(h) && h.includes(from) }
  if (signed.some(s => deployedOn(s, ctx) && !listed(s))) return INTO_DEPLOYED
  const safes = signed.filter(s => !deployedOn(s, ctx))
  const trees = [...new Set(mine.filter(e => e.label === 'appoints' && isHat(e.to)).map(() => treeOfHat(from)))]
  return [...trees.map(t => setHats(t, hatsWithAdmins(t, edges, ctx))), ...safes.map(s => gateOps(s, edges, ctx))]
}

/** The tree's deployment with its top hat worn by `safe` ('' clears it); the rest of the deployment is kept. Only a tree
 *  known to be composed: anything else is refused in words, never written as composed (review I1). */
function wornBy(tree: string, safe: string, ctx: ComposeCtx): StageOp | string {
  const base = ctx.deployments?.[tree]
  if (!base || base.status !== 'composed' || deployedOn(tree, ctx)) return TREE_NOT_COMPOSED
  const top = typeof base.top === 'object' && base.top !== null ? base.top as Record<string, unknown> : {}
  return { op: 'update', record: record(tree), set: { deployment: { ...base, top: { ...top, worn_by: safe } } } }
}

/** Removing a node deletes its System and takes it out of every relation that pointed at it. A hat goes from its
 *  tree's `hats` with its children (the hats it is admin of, all the way down), and out of every signer gate; a tree
 *  takes its hats with it. `edges` are the edges before the removal. A deployed System is not removed here (L7 gap B1:
 *  its record's page deletes it), and nothing the chain holds of one is rewritten for a removal (review I1): a deployed
 *  Safe's gate or a deployed tree's wearer keeps naming what goes, and the server refuses a delete that leaves a
 *  reference; a deployed System's own `relates` are its record's, and lose the relation as any System's do. */
export function opsForDelete(id: string, edges: ComposeEdge[], ctx: ComposeCtx): StageOp[] | string {
  if (deployedOn(id, ctx)) return DEPLOYED_REMOVE
  const gone = removedWith(id, ctx)
  const ops: StageOp[] = isHat(id)
    ? [setHats(treeOfHat(id), (ctx.trees[treeOfHat(id)] ?? []).filter(h => !gone.has(`${treeOfHat(id)}/${h.key}`)))]
    : [{ op: 'delete', record: record(id) }]
  const live = valid(edges)
  const safes = [...new Set(live.filter(e => e.label === 'signs' && isHat(e.from) && gone.has(e.from) && !isHat(e.to) && !gone.has(e.to) && !deployedOn(e.to, ctx)).map(e => e.to))]
  ops.push(...safes.map(s => gateOps(s, edges, ctx, gone)))
  const left = edges.filter(e => !gone.has(e.from) && !gone.has(e.to))
  const sources = [...new Set(live.filter(e => gone.has(e.to) && !gone.has(e.from) && !isHat(e.from)).map(e => e.from))]
  const cleared = [...new Set(live.filter(e => e.label === 'holds' && gone.has(e.from) && !isHat(e.from) && !gone.has(e.to) && Object.hasOwn(ctx.trees, e.to) && !deployedOn(e.to, ctx)).map(e => e.to))]
  const more = [...cleared.map(t => wornBy(t, '', ctx)), ...sources.map(s => opsForConnect(s, left, ctx))]
  const refused = more.find((m): m is string => typeof m === 'string')
  if (refused !== undefined) return refused
  return [...ops, ...(more as (StageOp | StageOp[])[]).flat()]
}

/** Everything that goes when `id` does: a hat takes the hats it is admin of (all the way down), a tree its hats. */
export function removedWith(id: string, ctx: ComposeCtx): Set<string> {
  const gone = new Set<string>([id])
  if (isHat(id)) {
    const tree = treeOfHat(id)
    const hats = ctx.trees[tree] ?? []
    const dead = new Set([keyOfHat(id)])
    for (let grew = true; grew;) { grew = false; for (const h of hats) if (!dead.has(h.key) && dead.has(h.admin)) { dead.add(h.key); grew = true } }
    for (const k of dead) gone.add(`${tree}/${k}`)
  } else {
    for (const h of ctx.trees[id] ?? []) gone.add(`${id}/${h.key}`)
  }
  return gone
}

/** Renaming a node; a hat's name is its `details` in the tree's `hats`, which a deployed tree's chain holds (L7 gap B1).
 *  A deployed System's name is its record's. */
export function opsForRename(id: string, name: string, ctx: ComposeCtx): StageOp[] | string {
  if (isHat(id)) {
    if (deployedOn(id, ctx)) return HAT_HELD
    const tree = treeOfHat(id)
    return [setHats(tree, (ctx.trees[tree] ?? []).map(h => (h.key === keyOfHat(id) ? { ...h, details: name } : h)))]
  }
  return [{ op: 'update', record: record(id), set: { name } }]
}

/** A System's description or notes as typed (L7 gap B1: a deployed System's too); empty takes the field out. A hat has
 *  neither: its fields are its tree's. */
export function opsForText(id: string, field: 'description' | 'notes', value: string): StageOp[] {
  if (isHat(id)) return []
  return [{ op: 'update', record: record(id), set: { [field]: value.trim() === '' ? null : value.trim() } }]
}

/** A Safe's threshold, stepped between 1 and its owners; the rest of its `deployment` is kept. */
export function opsForThreshold(n: ComposeNode, threshold: number): StageOp[] {
  if (n.deployed) return []
  return [{ op: 'update', record: record(n.id), set: { deployment: { ...(n.deployment ?? { status: 'composed' }), owners: n.owners ?? [], threshold } } }]
}
