/** The map from the records (C6): Resources and their 0.6 graph edges as the map's items and links (spec §8), the DAO
 *  map's relations derived from what the drivers read (E-38), and the nodes' facts and states from each read (E-46).
 *  Pure: the blocks and pages hand it what they hold. Ids follow G-7: a System is its Resource id (`system:<id>`), a
 *  hat its ref. */
import type { GraphEdge, Portal, Resource } from '../api.ts'
import type { HatFact } from '../../../server/systems/hats.ts'
import { driverOf } from '../systems/DriverView.tsx'
import { list, num, record, str, systemFacts, systemKind, systemState } from '../elements/rows/systemState.ts'
import { chainName, formatAmount, unitsToDecimal } from '../elements/atoms/chain.ts'
import { ageText } from '../time.ts'
import { mainSafeOf, type MapItem, type MapLink } from './layers.ts'
import type { MapNodeData, NodeState } from './HouseNode.tsx'
import { restrictedOf } from '../record/restricted.ts'

/** An item of the map as a Resource gives it: the item, and the Resource's own visibility key when it has one, so the
 *  viewer's filter reads it first (CC-14). */
export type RecordItem = MapItem & { visibility?: unknown }

/** The relations a map's edge is drawn with, in plain words (§8.4). The DAO's own (`relates` in systems.yaml, and
 *  what the chain gives) are their own words; 0.6's edge kinds are said as a sentence says them. `held-by` is said the
 *  other way round, from the holder (REVERSED). */
export const EDGE_WORDS: Record<string, string> = {
  elects: 'elects', appoints: 'appoints', includes: 'includes', holds: 'holds', signs: 'signs', admin: 'admin', pool: 'pool',
  'held-by': 'holds', member: 'includes', lead: 'leads', champion: 'champions', submitted: 'submitted', 'works-on': 'works on',
  funds: 'funds', 'partners-with': 'partners with', 'depends-on': 'depends on', 'seat-of': 'seat of', federation: 'federates with',
  touches: 'touches', 'proposed-by': 'proposed by',
}
/** 0.6 edges that point from the held to the holder: the map draws them from the holder, down to what it holds. */
const REVERSED: ReadonlySet<string> = new Set(['held-by'])
/** The words `relates` may give a relation (systems.schema.json). */
export const RELATES: readonly string[] = ['elects', 'appoints', 'includes', 'holds', 'signs', 'admin', 'pool']

const wordOf = (kind: string) => (Object.hasOwn(EDGE_WORDS, kind) ? EDGE_WORDS[kind]! : kind.replace(/-/g, ' '))
const HAT_REF = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:0x[0-9a-fA-F]{64}$/

/** A Resource as a map item: its id, its kind (a System's driver kind, its entry's first), its name, its section (the
 *  entry's, else its facts'), its facts, and its own visibility key. A `name` the viewer is not admitted to never
 *  prints its value (rule 3, E-70): the item reads "<hat> only", named by `hatOf` from the gate's marker, and carries
 *  the word in `nameKept` so the node draws it as every restricted field is (a `RestrictedValue`, not plain text). */
export function mapItemOf(r: Resource, entry: Record<string, unknown> | null, hatOf: (level: string) => string = level => level): MapItem {
  const kind = r.kind === 'system' ? str(entry?.kind) ?? systemKind(r) : r.kind
  const section = str(entry?.section) ?? str(r.facts.section)
  const own = (r as { visibility?: unknown }).visibility
  const level = restrictedOf(entry).name
  const kept = level === undefined ? undefined : hatOf(level)
  const item: RecordItem = { id: r.id, kind, name: kept === undefined ? r.name : `${kept} only`, ...(kept === undefined ? {} : { nameKept: kept }),
    ...(section ? { section } : {}), facts: r.facts, ...(own !== undefined ? { visibility: own } : {}),
    ...(r.kind === 'system' && driverOf(r)?.ok === false ? { failed: true as const } : {}) }
  return item
}

/** Each link once: the first of a pair from → to wins (E-37), and a link from a node to itself is not one. */
function unique(links: MapLink[]): MapLink[] {
  const seen = new Set<string>()
  return links.filter(k => {
    const key = `${k.from}\u0000${k.to}`
    if (k.from === k.to || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** What the map knows of a System beside its 0.6 edges: the Resources (with their reads) and their entries. */
export interface LinkContext { resources?: Resource[]; entryOf?: (r: Resource) => Record<string, unknown> | null }

const bare = (caip10: string | null) => (caip10 === null ? null : caip10.split(':').at(-1)!.toLowerCase())
const factsOf = (r: Resource): Record<string, unknown> => record(driverOf(r)?.facts)
const hatsOf = (r: Resource): HatFact[] => list(factsOf(r).hats) as unknown as HatFact[]

/** A Safe's owners, as bare lower-case addresses: from each chain's read, else from its Signers rows. */
function ownersOf(safe: Resource): Set<string> {
  const df = factsOf(safe)
  const out = new Set<string>()
  for (const c of list(df.chains)) for (const o of Array.isArray(c.owners) ? c.owners : []) { const a = bare(String(o)); if (a) out.add(a) }
  if (out.size === 0) {
    for (const row of driverOf(safe)?.sections.find(s => s.title === 'Signers')?.rows ?? []) {
      for (const ref of row.refs ?? []) { const a = bare(ref); if (a) out.add(a) }
    }
  }
  return out
}

/** The address a System lives at, bare and lower-case: its entry's, else its read's. */
const addressOf = (r: Resource): string | null => bare(str(r.facts.address) ?? str(factsOf(r).address))

/** What the chain gives (E-38): **signs**, the smallest hat every one of a Safe's owners wears signs it ("signs 4 of
 *  8"; a wearer who holds no seat yet, as with a signer gate, does not take the edge away);
 *  **holds**, a System at the address that wears a top hat holds it; **admin**, the Safe a Gardens community or pool
 *  names as its `councilSafe`; **pool**, a Gardens community to each pool that names it. */
export function derivedLinks(resources: Resource[]): MapLink[] {
  const systems = resources.filter(r => r.kind === 'system')
  const of = (kind: string) => systems.filter(r => systemKind(r) === kind)
  const safes = of('safe')
  const trees = of('hats-tree')
  const out: MapLink[] = []
  for (const safe of safes) {
    const owners = ownersOf(safe)
    const df = factsOf(safe)
    const threshold = num(df.threshold)
    const count = num(df.owners) ?? owners.size
    if (owners.size === 0) continue
    // owners ⊆ wearers (review M-1, ruled): of the hats every owner wears, the one with the fewest wearers
    const signer = trees.flatMap(tree => hatsOf(tree)).map(hat => ({ hat, wearers: new Set((hat.holders ?? []).map(h => bare(h)!).filter(Boolean)) }))
      .filter(h => [...owners].every(o => h.wearers.has(o)))
      .sort((a, b) => a.wearers.size - b.wearers.size || (a.hat.id < b.hat.id ? -1 : 1))[0]
    if (signer) out.push({ from: signer.hat.id, to: safe.id, label: threshold !== null ? `signs ${threshold} of ${count}` : 'signs' })
  }
  for (const tree of trees) {
    for (const hat of hatsOf(tree)) {
      if (hat.admin !== null || (hat.holders ?? []).length !== 1) continue
      const holder = bare(hat.holders![0]!)
      const by = systems.find(s => s !== tree && addressOf(s) === holder)
      if (by) out.push({ from: by.id, to: hat.id, label: 'holds' })
    }
  }
  const gardens = [...of('gardens-community'), ...of('gardens-pool')]
  for (const g of gardens) {
    const council = str(factsOf(g).councilSafe)
    const safe = council && safes.find(s => addressOf(s) === bare(council))
    if (safe) out.push({ from: safe.id, to: g.id, label: 'admin' })
  }
  for (const pool of of('gardens-pool')) {
    const community = bare(str(factsOf(pool).community))
    const garden = community && of('gardens-community').find(c => addressOf(c) === community || bare(str(factsOf(c).community)) === community)
    if (garden) out.push({ from: garden.id, to: pool.id, label: 'pool' })
  }
  return out
}

/** A `relates` target as a map id: a hat ref as it is, a `system:` id as it is, else a System's id in systems.yaml. */
const targetOf = (to: string) => (HAT_REF.test(to) || to.includes(':') ? to : `system:${to}`)

/** The relations an entry names itself (`relates`, E-38): each `{ to, label }` whose label is one of RELATES. */
export function relatesOf(r: Resource, entry: Record<string, unknown> | null): MapLink[] {
  return list(entry?.relates).flatMap(x => {
    const to = str(x.to)
    const label = str(x.label)
    return to && label && RELATES.includes(label) ? [{ from: r.id, to: targetOf(to), label }] : []
  })
}

/** The map's links (§8.4): what the chain gives first, then each 0.6 edge in plain words (a `held-by` from the
 *  holder), then what systems.yaml's `relates` adds; each pair once, the first winning. */
export function mapLinksOf(edges: GraphEdge[], ctx: LinkContext = {}): MapLink[] {
  const resources = ctx.resources ?? []
  const fromEdges = edges.map(e => (REVERSED.has(e.kind) ? { from: e.to, to: e.from, label: wordOf(e.kind) } : { from: e.from, to: e.to, label: wordOf(e.kind) }))
  const relates = ctx.entryOf ? resources.filter(r => r.kind === 'system').flatMap(r => relatesOf(r, ctx.entryOf!(r))) : []
  return unique([...derivedLinks(resources), ...fromEdges, ...relates])
}

/** Details that are a name (not a link or JSON), as the role tree reads them. */
const plainName = (details: string): string | null => {
  const t = details.trim()
  return t === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[[{]/.test(t) ? null : t
}

/** The DAO map (§8.2): each System an item, and a Hats tree's hats in its place — the hats its entry's `roles` names
 *  (decides or acts, E-38) and the hats a relation reaches — each carrying the tree's facts, so a tree the viewer may
 *  not read takes its hats with it. A tree none of whose hats is drawn is drawn itself. Any other record given (the
 *  Systems map's crew, modules) is an item as it is. Its links are `mapLinksOf`'s, with the 0.6 `edges` given. */
export function daoMapOf(resources: Resource[], entryOf: (r: Resource) => Record<string, unknown> | null, edges: GraphEdge[] = [],
  hatOf?: (level: string) => string): { items: MapItem[]; links: MapLink[] } {
  const links = mapLinksOf(edges, { resources, entryOf })
  const reached = new Set(links.flatMap(k => [k.from, k.to]))
  const items: MapItem[] = []
  for (const r of resources) {
    // a record of another kind lends only the gate's marker, so a name it keeps reads "<hat> only" here too (D-12, E-70);
    // its other fields stay out of the DAO map's layout, as before
    const entry = entryOf(r)
    const item = mapItemOf(r, r.kind === 'system' ? entry : entry?.restricted === undefined ? null : { restricted: entry.restricted }, hatOf)
    if (r.kind !== 'system' || item.kind !== 'hats-tree') { items.push(item); continue }
    const roles = record(entryOf(r)?.roles)
    const hats = hatsOf(r).filter(h => Object.hasOwn(roles, h.id) || reached.has(h.id))
    if (hats.length === 0) { items.push(item); continue }
    for (const h of hats) {
      const role = roles[h.id] === 'decides' || roles[h.id] === 'acts' ? roles[h.id] as 'decides' | 'acts' : undefined
      items.push({ id: h.id, kind: 'hat', name: plainName(h.details) ?? `hat ${hatNumber(h.pretty)}`, ...(item.section ? { section: item.section } : {}),
        ...(role ? { role } : {}), facts: r.facts, ...((item as RecordItem).visibility !== undefined ? { visibility: (item as RecordItem).visibility } : {}) } as RecordItem)
    }
  }
  const seen = new Set<string>()
  return { items: items.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true))), links }
}

/** The record a map node opens (E-46): its own Resource, or, for a hat, the Hats tree System that holds it. */
export function ownerOf(id: string, resources: Resource[]): string {
  if (resources.some(r => r.id === id)) return id
  return resources.find(r => r.kind === 'system' && hatsOf(r).some(h => h.id === id))?.id ?? id
}

/** The DAO's main Safe among these Resources (§8.2), by the map's own rule: null when there is none. */
export function mainSafeOfResources(resources: Resource[], entryOf: (r: Resource) => Record<string, unknown> | null): Resource | null {
  const { items, links } = daoMapOf(resources, entryOf)
  const id = mainSafeOf(items, links)
  return id === null ? null : resources.find(r => r.id === id) ?? null
}

const hostOf = (href: string | undefined): string | null => {
  try { return href ? new URL(href).host || null : null } catch { return null }
}

/** A System's facts line on its node (E-46, §8.3): a Safe's `4 of 8 · 7 chains`, a tree's hats, a pool's funds, a
 *  community's members, else its chain; an old read adds its age, a failed one says it could not read and when. */
function systemLine(r: Resource, now: Date): string {
  const f = systemFacts(r)
  const df = factsOf(r)
  const read = f.read
  if (read && !read.ok) return read.readAt ? `couldn’t read · ${ageText(read.readAt, now).replace(/ ago$/, '')}` : 'couldn’t read'
  const chains = f.chains.length > 1 ? `${f.chains.length} chains` : f.chains[0] ? chainName(f.chains[0]) : null
  const amount = str(df.amount) && num(df.decimals) !== null
    ? `${formatAmount(unitsToDecimal(String(df.amount), num(df.decimals)!), 0)}${str(df.symbol) ? ` ${df.symbol}` : ''}` : null
  const lead = f.kind === 'safe' && num(df.threshold) !== null && num(df.owners) !== null ? `${df.threshold} of ${df.owners}`
    : f.kind === 'gardens-pool' ? amount
    : f.kind === 'snapshot-space' ? 'Snapshot'
    : f.kind === 'link' ? hostOf(f.open?.href)
    : f.governs
  const parts = [lead, f.kind === 'gardens-pool' || f.kind === 'link' ? null : chains].filter(Boolean)
  if (read?.state === 'aged' && read.readAt) parts.push(ageText(read.readAt, now).replace(/ ago$/, ''))
  return parts.join(' · ')
}

/** A node's states from what was read (§8.3): failed, reading, old read, linked, and staged (`proposed`). */
function systemStates(r: Resource, proposed?: string): NodeState[] {
  const s = systemState(r, { proposed })
  switch (s.mark) {
    case 'failed': return ['failed']
    case 'running': return ['reading']
    case 'aged': return ['aged']
    case 'closed': return ['linked']
    case 'staged': return ['staged']
    default: return proposed !== undefined ? ['staged'] : []
  }
}

/** A hat's pretty id as a person reads it on the map: "13.1.1" for 0x0000000d.0001.0001 (each part in decimal). */
export function hatNumber(pretty: string): string {
  const parts = pretty.split('.')
  const nums = parts.map(p => Number.parseInt(p.replace(/^0x/i, ''), 16))
  return nums.every(n => Number.isFinite(n)) ? nums.join('.') : pretty
}

/** The map's nodes (E-46): each item with its facts line and its states, from the Resource it came from — a System's
 *  read, a hat's wearers (an active hat no one wears is empty), a record's status — and staged when `staged` names it.
 *  `flow` stays null until L7. A portal is the linked-node variant, "on <map>". `restricted` is the gate's marker on
 *  each record's file entry: a `status` the viewer is not admitted to never prints its value (rule 3, E-70) — the line
 *  is empty and `factsKept` carries the word the node draws as every restricted field is. */
export function mapNodesOf(items: MapItem[], resources: Resource[], now: Date,
  o: { staged?: (id: string) => boolean; faint?: Set<string>; restricted?: (r: Resource) => Record<string, string>; hatOf?: (level: string) => string } = {}): MapNodeData[] {
  const byId = new Map(resources.map(r => [r.id, r]))
  const hats = new Map(resources.filter(r => r.kind === 'system').flatMap(r => hatsOf(r).map(h => [h.id, h] as const)))
  return items.map(item => {
    const r = byId.get(item.id)
    const staged = o.staged?.(item.id) === true
    const dim: NodeState[] = o.faint?.has(item.id) ? ['dim'] : []
    if (item.kind === 'hat') {
      const h = hats.get(item.id)
      const empty = h !== undefined && h.active && h.supply === 0
      const facts = h ? `hat ${hatNumber(h.pretty)}${h.supply > 0 ? ` · ${h.supply} ${h.supply === 1 ? 'wears' : 'wear'} it` : ''}` : 'hat'
      return { item, facts, states: [...(empty ? ['empty-hat' as const] : []), ...(staged ? ['staged' as const] : []), ...dim] }
    }
    if (r && r.kind === 'system') {
      const states = systemStates(r, staged ? 'staged' : undefined)
      return { item, facts: systemLine(r, now), states: [...states, ...dim] }
    }
    // A status the viewer is not admitted to never prints its value (rule 3, E-70): the facts line is empty and the node
    // draws "<hat> only" in its place, as the table's status cell does.
    const statusLevel = r === undefined ? undefined : o.restricted?.(r).status
    return { item, facts: statusLevel === undefined ? r?.status ?? '' : '',
      ...(statusLevel === undefined ? {} : { factsKept: o.hatOf?.(statusLevel) ?? statusLevel }),
      states: [...(staged ? ['staged' as const] : []), ...dim] }
  })
}

/** A 0.6 portal (where a map's edges leave for the other map) as the linked-node variant (§14.2): "on <map> ↗". */
export function portalNode(p: Portal): MapNodeData {
  const map = p.toBoard === 'organization' ? 'Organization map' : 'Systems map'
  return { item: { id: p.id, kind: 'link', name: p.text, facts: {} }, facts: `on ${map}`, states: ['linked'] }
}
