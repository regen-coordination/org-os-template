// packages/admin/server/visibility/gate.ts
//
// The one place reads are judged (L5 spec §9.5). Every route that answers items passes them through `gateItems` or
// `gateRecord`; every WebSocket message through `gateEvent`. A thing's level is its full level (lib/visibility.mjs
// `fullLevel`, on the policy `readConfig` reads through `readFullPolicy`), and a record is admitted before any of its
// fields is (R-L5-2.2). What the public is given stands on L8's `publicView`, so the door, `.well-known` and these routes
// cannot disagree about what is public (§9.5, `publicProjection`).
//
// Two readings this file makes that the spec leaves open (R-L5-13.2, R-L5-13.3):
// - a proposal is public only when its own level is public and every record its ops touch, before and after, is a
//   public record — the ops its revise events recorded included: otherwise its ops would show the public what a
//   members' record holds. Its ops, and its revise events' ops, then carry only the public fields of those records, and
//   the public never sees the hat readings its acts recorded (`opened_as`, an event's `as`, `closed.as`,
//   `closed.checked`): they tie a member id to an address (rule 9; final review MF-1);
// - a resource drawn from a record has that record's level; one drawn from a whole registry (a summary) is public only
//   when every record of it is; the server's own attention is for maintainers (§10.4); anything else is members'.
//   To the public, a resource carries only facts a public field of its record also holds, no attention and no
//   `changed`, and an edge only when one end's public record names the other.

import type { MiddlewareHandler } from 'hono'
import { listRegistriesCached, readRegistryOrEmptyCached, type Entity } from '../registry.ts'
import { REGISTRIES } from '../registries.ts'
import { readLedger } from '../proposals/ledger.ts'
import { listViews, type ProposalView } from '../proposals/view.ts'
import { readResources } from '../resources/index.ts'
import { orgName } from '../resources/util.ts'
import type { Edge, Graph, Resource } from '../resources/types.ts'
import type { GovernanceView, StageOp } from '../changes/types.ts'
import { currentOf } from '../changes/stage.ts'
import { actorOf, viewerOf } from '../request.ts'
import { readConfig, type VisibilityPolicy } from './config.ts'
import { admits, formatLevel, fullLevel, isPublic, publicView, type ParsedLevel, type Viewer } from '../../lib/visibility.mjs'
import { MAINTAINER } from '../../lib/rules.mjs'
import { memberFields, NO_PRIVATE, privateCollections, privateEntries, type PrivateReads } from '../private/reads.ts'
import type { PrivateField } from '../private/store.ts'

export const PUBLIC: ParsedLevel = Object.freeze({ level: 'public' })
export const MEMBERS: ParsedLevel = Object.freeze({ level: 'members' })
/** Who the server's own attention is for (§10.4: "attention for maintainers on Home"): the governance role `maintainer`
 *  (every person when the org does not define it, lib/rules.mjs). */
export const MAINTAINERS: ParsedLevel = Object.freeze({ level: 'role', role: MAINTAINER })

/** The level of the server's own attention (R-L5-13.5): maintainers' when hosted; locally, every member's — a local
 *  server answers 127.0.0.1 only, so whoever asks is at the machine that runs it (a git identity no member holds
 *  included, as 0.6 showed them Home). Unknown: maintainers'. */
export const attentionLevel = (hosted: boolean | undefined): ParsedLevel => (hosted === false ? MEMBERS : MAINTAINERS)
export const PUBLIC_VIEWER: Viewer = Object.freeze({ kind: 'public' })

/** §9.5: the members' side, asked by the public (hosted, no session, or past the grace of §5.2). */
export const MEMBERS_ONLY = 'Sign in to see this: it is for members only.'

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export type Gated<T> = T & { visibility: string }

// ── the gate ────────────────────────────────────────────────────────────────────────────────────────

/** The items `viewer` may see, each with its level as `visibility: "<token>"` (§9.5), in their order. */
export function gateItems<T extends object>(viewer: Viewer, items: readonly T[], levelOf: (t: T) => ParsedLevel): Gated<T>[] {
  const out: Gated<T>[] = []
  for (const item of items) {
    const level = levelOf(item)
    if (admits(level, viewer)) out.push({ ...item, visibility: formatLevel(level) })
  }
  return out
}

/**
 * One record of `registry` as `viewer` may see it, or null. The record is admitted first (its level: `level`, else its
 * full level), then each field (R-L5-2.2). The public is given L8's `publicView` (restricted fields left out); a member,
 * every field they are admitted to, `privateFields` (the store's restricted fields of this record) merged in, and the
 * rest as `restricted: { <field>: "<level>" }` (private/reads.ts). Either way the record carries its level as
 * `visibility`. A proposal shows the public no hat reading (rule 9).
 */
export function gateRecord(viewer: Viewer, registry: string, record: unknown, config: VisibilityPolicy,
  level: ParsedLevel = fullLevel(config, registry, record), privateFields: readonly PrivateField[] = []): Record<string, unknown> | null {
  if (!isObj(record) || !admits(level, viewer)) return null
  if (viewer.kind === 'public') {
    const view = publicView(config, registry, record)
    if (!view) return null
    return { ...(registry === 'proposals' ? publicProposal(config, view) : view), visibility: 'public' }
  }
  return { ...memberFields(viewer, registry, record, config, privateFields), visibility: formatLevel(level) }
}

/** A server event as `viewer` may hear it, or null. `ids` are filtered (null when none is left); a message naming a
 *  `registry` is heard when its level admits the viewer; any other message is members' (§9.5: the public hears only
 *  events naming public items). `levelOf` answers a registry name or a resource id. */
export function gateEvent<M extends { type: string; registry?: string; ids?: string[] }>(viewer: Viewer, msg: M,
  levelOf: (key: string) => ParsedLevel): M | null {
  if (Array.isArray(msg.ids)) {
    const ids = msg.ids.filter(id => admits(levelOf(id), viewer))
    return ids.length > 0 ? { ...msg, ids } : null
  }
  if (typeof msg.registry === 'string') return admits(levelOf(msg.registry), viewer) ? msg : null
  return admits(MEMBERS, viewer) ? msg : null
}

/** A public proposal as the public is shown it: each op's records with their public fields only, the ops a revise event
 *  recorded included (they hold what that revision wrote), and none of the hat readings its acts recorded: an event's
 *  `as`, `closed.as`, and a ratify's fresh readings `closed.checked` (rule 9: the link from a member to an address is
 *  never public; final review MF-1). */
function publicProposal(config: VisibilityPolicy, entry: Record<string, unknown>): Record<string, unknown> {
  const { opened_as: _opened, ...rest } = entry
  if (Array.isArray(rest.ops)) rest.ops = rest.ops.map(op => publicOp(config, op))
  if (Array.isArray(rest.events)) {
    rest.events = rest.events.map(e => {
      if (!isObj(e)) return e
      const { as: _as, ...event } = e
      if (Array.isArray(event.ops)) event.ops = event.ops.map(op => publicOp(config, op))
      return event
    })
  }
  if (isObj(rest.closed)) {
    const { as: _as, checked: _checked, ...closed } = rest.closed
    rest.closed = closed
  }
  return rest
}

/**
 * A record written back as it was read: the `visibility` the gate set on it (its inherited level, for a record whose
 * git entry has no `visibility` of its own) is the gate's echo, not a choice, and is left out of what is written
 * (R-L5-13.4). A `visibility` that differs, or one the entry already holds, is the writer's and is kept.
 */
export function withoutEcho(repo: string, registry: string, current: unknown, value: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(current) || Object.hasOwn(current, 'visibility') || !Object.hasOwn(value, 'visibility')) return value
  if (value.visibility !== formatLevel(fullLevel(readConfig(repo), registry, current))) return value
  const { visibility: _echo, ...rest } = value
  return rest
}

/** A staged op without the gate's echo (`withoutEcho`) in the value or the fields it writes. */
export function withoutEchoOp<O extends StageOp>(repo: string, op: O): O {
  if (op.op !== 'replace' && op.op !== 'update') return op
  const { registry } = recordRef(op.record)
  let current: Entity | null = null
  try { current = currentOf(repo, op.record) } catch { /* staging says why */ }
  return op.op === 'replace'
    ? { ...op, value: withoutEcho(repo, registry, current, op.value) }
    : { ...op, set: withoutEcho(repo, registry, current, op.set) } as O
}

// ── levels, read once per request ───────────────────────────────────────────────────────────────────

/** `<registry>:<id>` read apart; registry '' when it is not. */
export function recordRef(record: unknown): { registry: string; id: string } {
  const text = typeof record === 'string' ? record : ''
  const at = text.indexOf(':')
  return at < 0 ? { registry: '', id: '' } : { registry: text.slice(0, at), id: text.slice(at + 1) }
}

/** An op of a public proposal with only what is public of the records it carries: the record before it, the record it
 *  writes, the fields it sets (each judged on the record it would leave). */
function publicOp(config: VisibilityPolicy, op: unknown): unknown {
  if (!isObj(op)) return op
  const { registry } = recordRef(op.record)
  const out: Record<string, unknown> = { ...op }
  if (isObj(op.before)) out.before = publicView(config, registry, op.before)
  if (isObj(op.value)) out.value = publicView(config, registry, op.value)
  if (isObj(op.set)) {
    const after = { ...(isObj(op.before) ? op.before : {}), ...op.set }
    out.set = Object.fromEntries(Object.entries(op.set).filter(([k]) => isPublic(config, registry, after, k)))
  }
  return out
}

const COLLECTIONS = new Set(REGISTRIES.filter(r => r.kind === 'collection').map(r => r.name))

/** A proposal's `touched` (L9 Ruling T12-1): the strictest level its ops ever touched, `public` or `members` (any level
 *  that is not public reads as members' here, as `Levels.proposal` gives it). Written when it is opened, raised by every
 *  revision, never lowered. */
export type Touched = 'public' | 'members'

/** The stricter of what a proposal touched: `members` when any is not `public` (an unknown value included). */
export const stricterTouched = (...levels: readonly unknown[]): Touched => (levels.every(l => l === 'public') ? 'public' : 'members')

/** A proposal's `touched` after a revision replaces its ops with `next` (L9 Ruling T12-1): only ever raised, from what it
 *  held, what the ops it replaces touch now (a record narrowed since counts), and what `next` touches. An entry with none
 *  was written before it existed: unrevised, its ops are the ones it was opened with; revised, what it was opened on is
 *  unknown, so it is members'. Revise and a replay's Take theirs / Keep mine both write it. */
export function raisedTouched(entry: Record<string, unknown>, next: readonly unknown[], levels: Levels): Touched {
  const was = Object.hasOwn(entry, 'touched') ? entry.touched : touchedPublic(entry) ? 'public' : 'members'
  return stricterTouched(was, levels.touched(Array.isArray(entry.ops) ? entry.ops : []), levels.touched(next))
}

/** Whether a proposal's `touched` lets it be public: `public`; or none written and never revised (its ops are the ones it
 *  was opened with). An entry revised with no `touched` was written before it existed: what it was opened on is unknown. */
function touchedPublic(entry: Record<string, unknown>): boolean {
  if (Object.hasOwn(entry, 'touched')) return entry.touched === 'public'
  const events = Array.isArray(entry.events) ? entry.events : []
  return !events.some(e => isObj(e) && e.kind === 'revise')
}

/** The levels of one repository's things, its registries read at most once (one request, one event), each through the
 *  repository's read cache (L9 §7.6): a file that has not changed since the last request is not parsed again. */
export class Levels {
  private readonly entries = new Map<string, Entity[]>()
  /** `attention`: the level of the server's own attention items (`attentionLevel`). `priv`: the private store's reads
   *  (none: a read that holds only what git holds, as the public projection). */
  constructor(readonly repo: string, readonly config: VisibilityPolicy = readConfig(repo), private readonly attention: ParsedLevel = MAINTAINERS,
    readonly priv: PrivateReads = NO_PRIVATE) {}

  /** A collection's records; [] for one that cannot be read (its records then read as members: nothing is public). */
  records(registry: string): Entity[] {
    let got = this.entries.get(registry)
    if (!got) {
      try { got = COLLECTIONS.has(registry) ? readRegistryOrEmptyCached(this.repo, registry).entries ?? [] : [] } catch { got = [] }
      this.entries.set(registry, got)
    }
    return got
  }

  /** A record's level; a proposal's is `proposal`'s. */
  record(registry: string, record: unknown): ParsedLevel {
    return registry === 'proposals' && isObj(record) ? this.proposal(record) : fullLevel(this.config, registry, record)
  }

  /** A proposal's level (R-L5-13.2): its own, and public only when every record its ops touch is public, as the trunk
   *  holds it, as the op saw it, and as the op would leave it (the public is then shown their public fields only). The
   *  ops its revise events recorded are judged too: a proposal that ever touched a record that is not public stays
   *  members' (final review MF-1). A placeholder for private data never is. A revise event records the new ops only, so
   *  the ops a proposal was opened with are kept as its `touched` (L9 Ruling T12-1): anything but `public` keeps it
   *  members'; an entry revised before `touched` was written cannot say what it was opened on, and is members'. */
  proposal(entry: Record<string, unknown>): ParsedLevel {
    const own = fullLevel(this.config, 'proposals', entry)
    if (own.level !== 'public') return own
    if (!touchedPublic(entry)) return MEMBERS
    const ops = Array.isArray(entry.ops) ? entry.ops : []
    const events = Array.isArray(entry.events) ? entry.events : []
    const revised = events.flatMap(e => (isObj(e) && Array.isArray(e.ops) ? e.ops : []))
    return [...ops, ...revised].every(op => this.opPublic(op)) ? PUBLIC : MEMBERS
  }

  /** What `ops` touch, for a proposal's `touched` (L9 Ruling T12-1): `public` when every op is public as `proposal`
   *  judges it now, else `members`. */
  touched(ops: readonly unknown[]): Touched {
    return ops.every(op => this.opPublic(op)) ? 'public' : 'members'
  }

  private opPublic(op: unknown): boolean {
    if (!isObj(op) || op.op === 'private') return false
    const { registry, id } = recordRef(op.record)
    if (!COLLECTIONS.has(registry)) return false
    const current = this.records(registry).find(e => String(e.id) === id) ?? null
    const before = isObj(op.before) ? op.before : null
    const after = isObj(op.value) ? op.value : isObj(op.set) ? { ...(before ?? current ?? {}), ...op.set } : null
    return [current, before, after].every(r => r === null || isPublic(this.config, registry, r))
  }

  /** A resource's level (R-L5-13.3). */
  resource(node: Resource): ParsedLevel {
    if (node.kind === 'absent') return node.id.startsWith('absent:server:') ? this.attention : MEMBERS
    const src = node.source
    if (!src?.registry) return MEMBERS
    const all = this.records(src.registry)
    if (src.entityId === undefined) {
      return all.length > 0 && all.every(r => this.record(src.registry!, r).level === 'public') ? PUBLIC : MEMBERS
    }
    const found = all.find(e => String(e.id) === src.entityId)
    return found ? this.record(src.registry, found) : MEMBERS
  }

  /** A resource's record as the public may see it, when it is drawn from one. */
  publicRecord(node: Resource): Record<string, unknown> | null {
    const src = node.source
    if (!src?.registry || src.entityId === undefined) return null
    const found = this.records(src.registry).find(e => String(e.id) === src.entityId)
    return found ? gateRecord(PUBLIC_VIEWER, src.registry, found, this.config, this.record(src.registry, found)) : null
  }
}

// ── resources ───────────────────────────────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Does a public record name `id` (an entity id, alone or as `<registry>:<id>`) in any of its values? */
function names(record: Record<string, unknown> | null, id: string | undefined): boolean {
  if (!record || id === undefined || id === '') return false
  const walk = (v: unknown): boolean => {
    if (typeof v === 'string') return v === id || v.endsWith(`:${id}`)
    if (Array.isArray(v)) return v.some(walk)
    if (isObj(v)) return Object.values(v).some(walk)
    return false
  }
  return Object.values(record).some(walk)
}

/** A public resource as the public sees it: no attention, no `changed`, and only the facts its public record holds too
 *  (a proposal's facts are drawn from what is public, R-L5-13.2; a summary's from records that all are). */
function publicResource(node: Gated<Resource>, record: Record<string, unknown> | null): Gated<Resource> {
  const out: Gated<Resource> = { ...node, attention: null, changed: null }
  if (!record || node.kind === 'proposal') return out
  const values = Object.values(record)
  out.facts = Object.fromEntries(Object.entries(node.facts).filter(([k, v]) =>
    v === null || v === undefined || Object.hasOwn(record, k) || values.some(x => same(x, v))))
  if (!values.some(x => x === node.name)) out.name = node.source?.entityId ?? node.id
  if (node.status !== null && record.status !== node.status) out.status = null
  return out
}

/** The graph as `viewer` may see it: never a node, a count or an edge for what they may not see (§9.5). */
export function gateGraph(viewer: Viewer, graph: Graph, levels: Levels): { nodes: Gated<Resource>[]; edges: Edge[] } {
  let nodes = gateItems(viewer, graph.nodes, n => levels.resource(n))
  const records = new Map<string, Record<string, unknown> | null>()
  if (viewer.kind === 'public') {
    nodes = nodes.map(n => {
      const record = levels.publicRecord(n)
      records.set(n.id, record)
      return publicResource(n, record)
    })
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges = graph.edges.filter(e => {
    const a = byId.get(e.from), b = byId.get(e.to)
    if (!a || !b) return false
    if (viewer.kind !== 'public') return true
    return names(records.get(e.from) ?? null, b.source?.entityId) || names(records.get(e.to) ?? null, a.source?.entityId)
  })
  return { nodes, edges }
}

// ── registries ──────────────────────────────────────────────────────────────────────────────────────

type Listed = ReturnType<typeof listRegistriesCached>[number]

/** GET /api/registries for `viewer`: a collection with nothing they may see is absent, and its count is what they may
 *  see; a document is listed when they may see it. */
export function gateRegistryList(viewer: Viewer, repo: string, levels = new Levels(repo)): Listed[] {
  const out: Listed[] = []
  for (const r of listRegistriesCached(repo)) {
    try {
      if (r.kind === 'document') {
        if (gateRecord(viewer, r.name, readRegistryOrEmptyCached(repo, r.name).document ?? {}, levels.config)) out.push(r)
        continue
      }
      const count = gateRegistryEntries(viewer, r.name, levels).length
      if (count > 0 || viewer.kind !== 'public') out.push({ ...r, count })
    } catch {
      if (viewer.kind !== 'public') out.push(r) // a file that cannot be read: GET /api/registries/:name says why, to members
    }
  }
  // The private collections this member is admitted to; any other is not named, nor counted (§9.2).
  for (const c of privateCollections(viewer, levels.priv)) {
    out.push({ name: c.id, kind: 'collection', count: privateEntries(viewer, c.id, levels.priv, levels.config).length })
  }
  return out
}

/** A collection's records as `viewer` may see them: `entries`, else the collection's as `levels` read them. */
export function gateRegistryEntries(viewer: Viewer, registry: string, levels: Levels, entries: readonly Entity[] = levels.records(registry)): Record<string, unknown>[] {
  const member = viewer.kind !== 'public'
  const git = entries.flatMap(e => {
    const fields = member && e.id !== undefined && e.id !== null ? levels.priv.fields(registry, String(e.id)) : []
    const g = gateRecord(viewer, registry, e, levels.config, levels.record(registry, e), fields)
    return g ? [g] : []
  })
  // A member also reads the records of this collection kept private (§9.2), those they are admitted to.
  return member ? [...git, ...privateEntries(viewer, registry, levels.priv, levels.config)] : git
}

/** GET /api/registries/:name for `viewer`: what `readRegistryOrEmpty` answers (through the read cache), its entries or
 *  its document gated. A document they may not see reads as an empty one, as a missing file does. */
export function gateRegistry(viewer: Viewer, repo: string, name: string, levels = new Levels(repo)) {
  // A private collection this member is admitted to; for anyone else its name is no registry, as an unknown one.
  if (privateCollections(viewer, levels.priv).some(c => c.id === name)) {
    return { name, kind: 'collection' as const, schemaVersion: null, entries: privateEntries(viewer, name, levels.priv, levels.config) }
  }
  const read = readRegistryOrEmptyCached(repo, name)
  if (read.kind === 'document') {
    const doc = read.document ?? {}
    // An empty document (no file) has nothing to gate, nor a level to carry.
    return { ...read, document: Object.keys(doc).length === 0 ? {} : gateRecord(viewer, name, doc, levels.config) ?? {} }
  }
  return { ...read, entries: gateRegistryEntries(viewer, name, levels, read.entries ?? []) }
}

// ── proposals ───────────────────────────────────────────────────────────────────────────────────────

/** What a proposal view adds to its ledger entry: these come from the machine, not from the entry. */
const DERIVED = ['derived', 'evaluation', 'rules', 'stale', 'needsYou', 'can', 'cannot', 'check', 'branchState'] as const

/** Proposal views as `viewer` may see them, each with its level. The public is given each one's public record (no hat
 *  reading, no restricted field) and what the machine derived from it. */
export function gateProposals<V extends object>(viewer: Viewer, views: readonly V[], levels: Levels): Gated<V>[] {
  const idOf = (v: V) => String((v as { id?: unknown }).id)
  const entries = new Map(readLedger(levels.repo).entries.map(e => [String(e.id), e as Record<string, unknown>]))
  const level = (v: V) => { const e = entries.get(idOf(v)); return e ? levels.proposal(e) : MEMBERS }
  const gated = gateItems(viewer, views, level)
  if (viewer.kind !== 'public') return gated
  return gated.map(v => {
    const record = gateRecord(PUBLIC_VIEWER, 'proposals', entries.get(idOf(v)), levels.config, PUBLIC) ?? {}
    const derived = Object.fromEntries(DERIVED.filter(k => Object.hasOwn(v, k)).map(k => [k, (v as Record<string, unknown>)[k]]))
    return { ...record, ...derived, visibility: 'public' } as unknown as Gated<V>
  })
}

/** GET /api/proposals/:id's note for the public, in place of the diff: git's diff shows the lines around a change, which
 *  are members'. */
export const PUBLIC_NO_DIFF = 'There is no diff to show here: what this proposal changes is listed in its ops.'

/** A proposal's level by its id; null when the ledger has none. */
export function proposalLevel(levels: Levels, id: string): ParsedLevel | null {
  const entry = readLedger(levels.repo).entries.find(e => String(e.id) === id)
  return entry ? levels.proposal(entry as Record<string, unknown>) : null
}

// ── boards and governance ───────────────────────────────────────────────────────────────────────────

/** A board's level: its `audience` (members unless it says public); an instance's board is also its record's. */
export function boardLevel(levels: Levels, board: { id: string; audience: string; origin: 'builtin' | 'instance' }): ParsedLevel {
  if (board.audience !== 'public') return MEMBERS
  if (board.origin === 'builtin') return PUBLIC
  const record = levels.records('boards').find(e => String(e.id) === board.id)
  return record ? levels.record('boards', record) : MEMBERS
}

/** GET /api/governance for `viewer`. A member reads it as 0.6. The public reads what the governance document's public
 *  record holds and the decisions written in it (DECISIONS.md is members'), and none of its problems. */
export function gateGovernance(viewer: Viewer, view: GovernanceView, levels: Levels): GovernanceView {
  if (viewer.kind !== 'public') return view
  let doc: Record<string, unknown> | null = null
  try { doc = readRegistryOrEmptyCached(levels.repo, 'governance').document ?? {} } catch { doc = null }
  const pub = doc ? gateRecord(PUBLIC_VIEWER, 'governance', doc, levels.config) : null
  if (!doc || !pub) return { model: null, description: null, rules: [], decisions: [], problems: [] }
  const shown = (field: string) => !Object.hasOwn(doc!, field) || Object.hasOwn(pub, field)
  return {
    model: Object.hasOwn(pub, 'model') ? view.model : null,
    description: Object.hasOwn(pub, 'description') ? view.description : null,
    rules: shown('rules') && shown('model') ? view.rules : [],
    decisions: shown('decisions') ? view.decisions.filter(d => d.where === 'governance.yaml') : [],
    problems: [],
  }
}

// ── events ──────────────────────────────────────────────────────────────────────────────────────────

/** What a server event's keys are worth to each connection (§9.5), worked out once per event, not per connection. A
 *  registry is public to an event when what the public sees of it changed; a resource has its level, and one that went
 *  keeps the level it had for one more graph, so whoever could see it hears that it went, and no longer (L9 §7.6): an id
 *  absent from two consecutive graphs is dropped, so a long-running server does not keep every id it ever saw. */
export class EventLevels {
  private readonly publicText = new Map<string, string | null>()
  private readonly resources = new Map<string, ParsedLevel>()
  /** The ids of the graph noted last. */
  private last = new Set<string>()
  constructor(private readonly repo: string, private readonly attention: ParsedLevel = MAINTAINERS) {}

  /** What the public sees of every registry now: the baseline the first change is told apart from. */
  start(): void { for (const r of REGISTRIES) this.publicText.set(r.name, this.publicOf(r.name)) }

  private publicOf(registry: string): string | null {
    try { return JSON.stringify(gateRegistry(PUBLIC_VIEWER, this.repo, registry)) } catch { return null }
  }

  /** The level of each key `msg` names (a registry, or resource ids). Call it once per event. */
  levelsFor(msg: { registry?: string; ids?: string[] }): (key: string) => ParsedLevel {
    if (typeof msg.registry === 'string') {
      const now = this.publicOf(msg.registry)
      const was = this.publicText.get(msg.registry) ?? null
      this.publicText.set(msg.registry, now)
      const level = now !== null && now !== was ? PUBLIC : MEMBERS
      return () => level
    }
    return id => this.resources.get(id) ?? MEMBERS
  }

  /** After a refresh of the graph: each resource's level now. */
  noteGraph(graph: Graph): void {
    const levels = new Levels(this.repo, readConfig(this.repo), this.attention)
    const now = new Set<string>()
    for (const n of graph.nodes) { this.resources.set(n.id, levels.resource(n)); now.add(n.id) }
    for (const id of this.resources.keys()) if (!now.has(id) && !this.last.has(id)) this.resources.delete(id)
    this.last = now
  }

  /** How many resources have a level kept (for tests and for a look at memory). */
  get known(): number { return this.resources.size }
}

// ── the public projection ───────────────────────────────────────────────────────────────────────────

export interface PublicProjection {
  /** Every collection with a public record, its public records (GET /api/registries/:name for the public). */
  registries: Record<string, Record<string, unknown>[]>
  /** GET /api/resources for the public. */
  resources: Gated<Resource>[]
  /** The graph's edges the public may see (L9 spec §3.2), as `gateGraph` gives them: between two of `resources` only,
   *  and only where one end's public record names the other. Additive (L9): the portal's map draws them. */
  edges: Edge[]
  /** GET /api/proposals for the public. */
  proposals: Gated<ProposalView>[]
}

/**
 * The gate's answer for the public viewer (§9.5), for L9's door build and L8: exactly what a public viewer gets from GET
 * /api/registries/:name (each collection GET /api/registries lists), GET /api/resources and GET /api/proposals. Async:
 * the resources and the proposals' evaluation are read as the routes read them. `graph` and `now` are the server's when
 * it asks; the default reads the repository's graph without a server.
 */
export async function publicProjection(repo: string, opts: { graph?: () => Promise<Graph>; now?: Date } = {}): Promise<PublicProjection> {
  const levels = new Levels(repo)
  const registries: Record<string, Record<string, unknown>[]> = {}
  for (const r of gateRegistryList(PUBLIC_VIEWER, repo, levels)) {
    if (r.kind === 'collection') registries[r.name] = gateRegistryEntries(PUBLIC_VIEWER, r.name, levels)
  }
  const graph = await (opts.graph ?? (() => readResources(repo)))()
  const { nodes: resources, edges } = gateGraph(PUBLIC_VIEWER, graph, levels)
  // A ledger that cannot be read fails the projection, as it fails GET /api/proposals: never an empty list in its place.
  const proposals = gateProposals(PUBLIC_VIEWER, await listViews(repo, { unknown: '' }, opts.now ?? new Date()), levels)
  return { registries, resources, edges, proposals }
}

// ── the public's routes ─────────────────────────────────────────────────────────────────────────────

/**
 * The reads the public may ask (§9.5), as Hono writes their paths: each gated in its route, or not secret. Any other
 * address under /api/ is the members' side and answers the public 401 (`publicReads`), so a route added later is closed
 * to the public until it is gated and listed here (the test lists the routes from `app.routes`).
 */
export const PUBLIC_READS: readonly string[] = [
  '/api/health', // { ok } and nothing more (L9 §5.11)
  '/api/status', // the org's name only
  '/api/session',
  '/api/schemas/:name', // not secret
  '/api/registries',
  '/api/registries/:name',
  '/api/resources',
  '/api/resources/:id{.+}',
  '/api/graph/:board',
  '/api/layout/:board',
  '/api/boards',
  '/api/boards/:id',
  '/api/boards/:id/builtin',
  '/api/governance',
  '/api/proposals',
  '/api/proposals/:id',
]

const asPattern = (path: string) => new RegExp(`^${path.split('/').map(s => {
  if (s.startsWith(':')) return s.endsWith('{.+}') ? '.+' : '[^/]+'
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}).join('/')}$`)
const PUBLIC_PATTERNS = PUBLIC_READS.map(asPattern)
const READS = new Set(['GET', 'HEAD'])

/** May the public ask `method path`? Sign-in and sign-out are writes the public makes (request.ts lets them through). */
export function publicMayAsk(method: string, path: string): boolean {
  if (path === '/api/session' || path.startsWith('/api/session/')) return true
  return READS.has(method) && PUBLIC_PATTERNS.some(p => p.test(path))
}

/** A person signed in by emailed link with no Role reads as the public, and reads their own Profile, `GET /api/actor`
 *  (which answers the asker and no one else), all the same (Lane 3 Task 9, Review Focus 2). */
const ownProfile = (c: Parameters<MiddlewareHandler>[0]): boolean => {
  if (!READS.has(c.req.method) || c.req.path !== '/api/actor') return false
  const actor = actorOf(c)
  return actor !== null && 'via' in actor && actor.via === 'email'
}

/** After the request middleware: the public is refused the members' side, 401 `SIGN_IN` (§9.5), before any route. */
export const publicReads: MiddlewareHandler = async (c, next) => {
  if (viewerOf(c).kind === 'public' && !publicMayAsk(c.req.method, c.req.path) && !ownProfile(c)) {
    return c.json({ error: MEMBERS_ONLY, code: 'SIGN_IN' }, 401)
  }
  await next()
}

/** GET /api/status for the public: the org's name only (§9.5). */
export const publicStatus = (repo: string) => ({ org: orgName(repo) })
