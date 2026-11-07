/** The DAO map's fixtures (spec §8): the Example-DAO-shaped map the gallery draws, as `MapItem`s and `MapLink`s, and the
 *  degenerate maps the layout must survive (review focus 1). Ids follow G-7: a System is its Resource id
 *  (`system:<id>`), a hat its ref (`eip155:42220:0x…`). Systems come from `systems.ts`; the relations and the hats'
 *  decides/acts roles are in no record yet (OQ-1), so they are written here. Roles and placeholders only. */
import type { OperationInfo, Resource } from '../../../api.ts'
import { canConnect, type ComposeEdge, type ComposeNode } from '../../../elements/compose/compose.ts'
import type { MapItem, MapLink } from '../../../map/layers.ts'
import type { MapNodeData, NodeState } from '../../../map/HouseNode.tsx'
import { flowSentence, withNeeds, type ValueFlow } from '../../../map/valueFlow.ts'
import { needsFrom, orderNeeds, type NeedItem } from '../../../elements/needs/needs.ts'
import { FIXED_NOW } from '../parts.ts'
import { ACTOR, NEEDS_SYSTEMS, PROPOSALS, PROPOSAL_RESOURCES } from './governance.ts'
import { GARDEN, LOCAL_STARTER, NETWORK_PROJECTS, OPS_WALLET, ROLES, ROLE_HATS, TREASURY_SYSTEM, VOTES, hatRefOf } from './systems.ts'

/** A System as a map item: its Resource id, its driver kind, its name, its section and its facts. */
function fromSystem(r: Resource, over: Partial<MapItem> = {}): MapItem {
  const facts = (r.facts ?? {}) as Record<string, unknown>
  const section = typeof facts.section === 'string' ? facts.section : undefined
  return { id: r.id, kind: String(facts.kind), name: r.name, ...(section ? { section } : {}), facts, ...over }
}

/** A hat of the Roles tree as a map item, by its path under the top hat. It carries the Roles System's facts, so a
 *  Roles System the viewer may not read takes its hats off the map with it (B7 review M-4). */
function hat(role: 'decides' | 'acts', ...path: number[]): MapItem {
  const id = hatRefOf(...path)
  const fact = ROLE_HATS.find(h => h.id === id)!
  return { id, kind: 'hat', name: fact.details, section: 'organization/roles', role, facts: ROLES.facts as Record<string, unknown> }
}

/** A link System: listed, never read. */
const link = (id: string, name: string, url: string): MapItem =>
  ({ id: `system:${id}`, kind: 'link', name, facts: { kind: 'link', url, section: null } })

export const MAP_VOTES = fromSystem(VOTES)
export const MAP_COUNCIL = hat('decides', 1)
export const MAP_OPERATIONS = hat('acts', 2)
export const MAP_SIGNER = hat('acts', 1, 1)
/** The Ops wallet: a link System in the Systems list; on the map it is a wallet the Operations hat holds (layer 1). */
export const MAP_WALLET = fromSystem(OPS_WALLET, { kind: 'wallet' })
export const MAP_TREASURY = fromSystem(TREASURY_SYSTEM)
export const MAP_GARDEN = fromSystem(GARDEN)
export const MAP_NETWORK = fromSystem(NETWORK_PROJECTS)
export const MAP_STARTER = fromSystem(LOCAL_STARTER)
export const MAP_KARMA = link('karma-gap', 'Karma GAP', 'https://gap.karmahq.xyz')
export const MAP_GITCOIN = link('gitcoin', 'Gitcoin', 'https://explorer.gitcoin.co')

/** The house's DAO map, as the gallery draws it: who decides, the roles that act, the Treasury, what it feeds, and
 *  two linked Systems. */
export const MAP_ITEMS: MapItem[] = [
  MAP_VOTES, MAP_COUNCIL, MAP_OPERATIONS, MAP_SIGNER, MAP_WALLET, MAP_TREASURY, MAP_GARDEN, MAP_NETWORK, MAP_STARTER, MAP_KARMA, MAP_GITCOIN,
]

/** Its relations, in plain words (§8.4). */
export const MAP_LINKS: MapLink[] = [
  { from: MAP_VOTES.id, to: MAP_COUNCIL.id, label: 'elects' },
  { from: MAP_COUNCIL.id, to: MAP_OPERATIONS.id, label: 'appoints' },
  { from: MAP_COUNCIL.id, to: MAP_SIGNER.id, label: 'includes' },
  { from: MAP_OPERATIONS.id, to: MAP_WALLET.id, label: 'holds' },
  { from: MAP_SIGNER.id, to: MAP_TREASURY.id, label: 'signs 4 of 8' },
  { from: MAP_TREASURY.id, to: MAP_NETWORK.id, label: 'admin' },
  { from: MAP_TREASURY.id, to: MAP_STARTER.id, label: 'admin' },
  { from: MAP_GARDEN.id, to: MAP_NETWORK.id, label: 'pool' },
  { from: MAP_GARDEN.id, to: MAP_STARTER.id, label: 'pool' },
]

// ---------------------------------------------------------------------------------------------------------------
// The map as B8 draws it: each item with its facts line and its states (§8.3), attention from Needs you (§8.5).

/** What Needs you finds on /parts (the Needs group's list): the map's clay dots are these, one to one. */
export const MAP_NEEDS: NeedItem[] = orderNeeds(needsFrom([...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES], PROPOSALS, ACTOR, FIXED_NOW), FIXED_NOW)

const node = (item: MapItem, facts: string, states: NodeState[] = [], more: Partial<MapNodeData> = {}): MapNodeData =>
  ({ item, facts, states, ...more })

/** The members' DAO map: the Treasury needs signatures, the pools' return is staged and waits on a vote, the Garden's
 *  read failed, the Starter's is old, the Ops wallet and two Systems are linked, not read. */
export const MAP_NODES: MapNodeData[] = withNeeds([
  node(MAP_VOTES, 'Snapshot · Ethereum'),
  node(MAP_COUNCIL, 'hat 13.1 · 5 wear it'),
  node(MAP_OPERATIONS, 'hat 13.2 · 1 wears it'),
  node(MAP_SIGNER, 'hat 13.1.1 · 8 wear it'),
  node(MAP_WALLET, 'Ethereum', ['linked']),
  node(MAP_TREASURY, '4 of 8 · 7 chains'),
  node(MAP_GARDEN, 'couldn’t read · 2 h', ['failed']),
  node(MAP_NETWORK, '1,271 USDGLO', ['staged']),
  node(MAP_STARTER, '3,100 USDGLO · 38 min', ['aged']),
  node(MAP_KARMA, 'impact reports', ['linked']),
  node(MAP_GITCOIN, 'public-goods rounds', ['linked']),
], MAP_NEEDS)

/** The same map with the Roles System readable by the Treasurer hat only: previewed as Members, its three hats and
 *  every edge that touches them are absent (review focus 5). */
export const MAP_NODES_ROLES_RESTRICTED: MapNodeData[] = MAP_NODES.map(d => (d.item.kind === 'hat'
  ? { ...d, item: { ...d.item, facts: { ...d.item.facts, visibility: 'hat:treasury' } } } : d))

/** The door's map: what the public reads, each node a link to its public page. */
export const DOOR_NODES: MapNodeData[] = MAP_NODES.map(d => ({ ...d, href: `/door/systems/${encodeURIComponent(d.item.id)}` }))

/** Transaction 18, prepared: the two pools' funds go back to the Treasury, against the admin edges. */
export const MAP_FLOW: ValueFlow = {
  id: 'p-2026-10-17-001:18:prepared',
  edges: [[MAP_NETWORK.id, MAP_TREASURY.id], [MAP_STARTER.id, MAP_TREASURY.id]],
  sentence: flowSentence({ nonce: 18, phase: 'prepared', amount: '3,100 USDGLO', from: 'the two pools', to: 'the Treasury' }),
}

/** One node in each state of §8.3's table, as the gallery's node anatomy lays them out. */
const REGIONAL: MapItem = { id: hatRefOf(2, 3), kind: 'hat', name: 'Regional coordinator', role: 'acts', facts: ROLES.facts as Record<string, unknown> }
const TEST_TREASURY: MapItem = { id: 'system:test-treasury', kind: 'safe', name: 'Test Treasury', facts: { kind: 'safe' } }
export const MAP_ANATOMY: { state: string; node: MapNodeData }[] = [
  { state: 'default', node: node(MAP_OPERATIONS, 'hat 13.2 · 1 wears it') },
  { state: 'selected', node: node(MAP_NETWORK, '1,271 USDGLO', ['selected']) },
  { state: 'needs you', node: node(MAP_COUNCIL, 'hat 13.1 · 5 wear it', ['needs'], { need: 'Close the spring call for local nodes' }) },
  { state: 'staged change', node: node(MAP_TREASURY, '4 of 9 → 4 of 8', ['staged']) },
  { state: 'old read', node: node(MAP_VOTES, 'exampledao.eth · 38 min', ['aged']) },
  { state: 'failed read', node: node(MAP_GARDEN, 'couldn’t read · 2 h', ['failed']) },
  { state: 'linked, not read', node: node(MAP_KARMA, 'impact reports', ['linked']) },
  { state: 'empty hat', node: node(REGIONAL, 'hat 13.2.3', ['empty-hat']) },
  { state: 'composed, not deployed', node: node(TEST_TREASURY, '2 of 3 · Sepolia', ['draft'], { order: 3 }) },
  { state: 'dimmed (off the path)', node: node(MAP_WALLET, 'Ethereum', ['dim']) },
  { state: 'reading', node: node({ ...MAP_COUNCIL, name: 'Roles' }, 'hats tree 13', ['reading']) },
]

// ---------------------------------------------------------------------------------------------------------------
// Small maps for the layout's edge cases. Placeholder names; generic ids.

const safe = (id: string, name: string, section?: string): MapItem => ({ id: `system:${id}`, kind: 'safe', name, ...(section ? { section } : {}) })
const role = (id: string, name: string, r: 'decides' | 'acts'): MapItem => ({ id: `system:${id}`, kind: 'hat', name, role: r })
const pool = (id: string, name: string): MapItem => ({ id: `system:${id}`, kind: 'gardens-pool', name })
const to = (from: MapItem, target: MapItem, label: string): MapLink => ({ from: from.id, to: target.id, label })

/** One Safe and nothing else. */
export const ONE_SAFE: MapItem[] = [safe('only', 'Only Safe')]

/** Systems with no links between them: one of each layer, and a link System. */
export const UNLINKED: MapItem[] = [
  { id: 'system:space', kind: 'snapshot-space', name: 'space.eth' }, role('ops', 'Ops lead', 'acts'), safe('vault', 'Vault'),
  pool('fund', 'Fund'), { id: 'system:forum', kind: 'link', name: 'Forum' },
]

/** Three pools under one Safe, listed out of order: equal barycentres, so their names order them. */
const TIE_SAFE = safe('tie-safe', 'Vault')
const TIE_POOLS = [pool('pool-c', 'Pool C'), pool('pool-a', 'Pool A'), pool('pool-b', 'Pool B')]
export const TIES: { items: MapItem[]; links: MapLink[] } = {
  items: [TIE_SAFE, ...TIE_POOLS], links: TIE_POOLS.map(p => to(TIE_SAFE, p, 'admin')),
}

/** Two councils that each appoint the other's signer: in name order the edges cross; the layout uncrosses them. */
const COUNCIL_A = role('council-a', 'Council A', 'decides')
const COUNCIL_B = role('council-b', 'Council B', 'decides')
const SIGNER_A = role('signer-a', 'Signer A', 'acts')
const SIGNER_B = role('signer-b', 'Signer B', 'acts')
export const CROSSED: { items: MapItem[]; links: MapLink[] } = {
  items: [COUNCIL_A, COUNCIL_B, SIGNER_A, SIGNER_B],
  links: [to(COUNCIL_A, SIGNER_B, 'appoints'), to(COUNCIL_B, SIGNER_A, 'appoints')],
}

/** A cycle: a hat that admins the Safe that holds its top hat; and two Safes that each sign for the other. */
const TOP_HAT = role('top-hat', 'Top hat', 'decides')
const ADMIN_HAT = role('admin-hat', 'Admin hat', 'acts')
const CYCLE_SAFE = safe('cycle-safe', 'Cycle Safe')
const SAFE_X = safe('safe-x', 'Safe X')
const SAFE_Y = safe('safe-y', 'Safe Y')
export const CYCLE: { items: MapItem[]; links: MapLink[] } = {
  items: [TOP_HAT, ADMIN_HAT, CYCLE_SAFE, SAFE_X, SAFE_Y],
  links: [
    to(TOP_HAT, ADMIN_HAT, 'appoints'), to(ADMIN_HAT, CYCLE_SAFE, 'admin'), to(CYCLE_SAFE, TOP_HAT, 'holds'),
    to(SAFE_X, SAFE_Y, 'signs 1 of 2'), to(SAFE_Y, SAFE_X, 'signs 1 of 2'), to(CYCLE_SAFE, SAFE_X, 'admin'),
  ],
}

/** The main Safe's three rules. `inTreasury`: the one in organization/treasury wins over more incoming links.
 *  `mostLinks`: neither is in organization/treasury; the one more edges point at wins. `tied`: neither, and equal
 *  links; the name breaks the tie (Safe A, listed second). */
const SAFE_A = safe('safe-a', 'Safe A')
const SAFE_B = safe('safe-b', 'Safe B')
const SIGNER_ONE = role('signer-one', 'Signer one', 'acts')
const SIGNER_TWO = role('signer-two', 'Signer two', 'acts')
const TREASURY_SAFE = safe('treasury-safe', 'Treasury Safe', 'organization/treasury')
const SIDE_SAFE = safe('side-safe', 'Side Safe', 'organization/operations')
export const MAIN_SAFE = {
  inTreasury: {
    items: [SIDE_SAFE, TREASURY_SAFE, SIGNER_ONE, SIGNER_TWO],
    links: [to(SIGNER_ONE, SIDE_SAFE, 'signs'), to(SIGNER_TWO, SIDE_SAFE, 'signs'), to(SIGNER_ONE, TREASURY_SAFE, 'signs')],
  },
  mostLinks: {
    items: [SAFE_A, SAFE_B, SIGNER_ONE, SIGNER_TWO],
    links: [to(SIGNER_ONE, SAFE_B, 'signs'), to(SIGNER_TWO, SAFE_B, 'signs'), to(SIGNER_ONE, SAFE_A, 'signs')],
  },
  tied: {
    items: [SAFE_B, SAFE_A, SIGNER_ONE, SIGNER_TWO],
    links: [to(SIGNER_ONE, SAFE_B, 'signs'), to(SIGNER_TWO, SAFE_A, 'signs')],
  },
} as const

/** A Safe the main Safe administers sits with what the treasury feeds (layer 3); one it does not, beside it. */
const MAIN = safe('main', 'Main Safe', 'organization/treasury')
const FED = safe('fed', 'Fed Safe')
const BESIDE = safe('beside', 'Beside Safe')
export const SAFE_UNDER_SAFE: { items: MapItem[]; links: MapLink[] } = {
  items: [MAIN, FED, BESIDE], links: [to(MAIN, FED, 'admin')],
}

// ---------------------------------------------------------------------------------------------------------------
// The small map, the inspector and the compose canvas (B9, §8.6, §5.10, §8.7).

/** The record page's small map: the open proposal and the Systems it touches — seven, so one is "+1 on the map". */
export const MINI_RECORD: Resource = PROPOSAL_RESOURCES[0]!
export const MINI_NEIGHBOURS: Resource[] = [ROLES, TREASURY_SYSTEM, NETWORK_PROJECTS, LOCAL_STARTER, GARDEN, VOTES, OPS_WALLET]

/** The inspector beside the Systems list: the first pool, what it touches, and the one operation it offers. */
export const INSPECTOR_RECORD: Resource = NETWORK_PROJECTS
export const INSPECTOR_NEIGHBOURS: Resource[] = [TREASURY_SYSTEM, GARDEN, PROPOSAL_RESOURCES[0]!, LOCAL_STARTER]
export const INSPECTOR_OPS: OperationInfo[] = [
  { id: 'system.read', label: 'Read now', effect: 'reads', network: true, confirm: false, params: { type: 'object' }, preset: null, unavailable: null },
]

/** The compose canvas: a test DAO on Sepolia — a top hat that appoints the signers, who sign for the Test Treasury
 *  through Hats Signer Gate (transaction 4), a Snapshot space that elects the top hat, and a forum link someone tried
 *  to make sign for the Safe. Five prepared transactions, in order. */
export const COMPOSE_CHAIN = 'eip155:11155111'
export const COMPOSE_SHELF = ['safe', 'hats-tree', 'hat', 'snapshot-space', 'gardens-community', 'link']
export const COMPOSE_NODES: ComposeNode[] = [
  { id: 'top-hat', kind: 'hat', name: 'Top hat', x: 170, y: 64, order: 1 },
  { id: 'signers', kind: 'hat', name: 'Signers', x: 170, y: 200, order: 2 },
  { id: 'test-treasury', kind: 'safe', name: 'Test Treasury', x: 170, y: 336, order: 3 },
  { id: 'votes', kind: 'snapshot-space', name: 'Votes', x: 470, y: 150, order: 5 },
  { id: 'forum', kind: 'link', name: 'Forum', x: 470, y: 280, order: 0 },
]
const refusal = canConnect('link', 'safe')
export const COMPOSE_EDGES: ComposeEdge[] = [
  { from: 'votes', to: 'top-hat', label: 'elects' },
  { from: 'top-hat', to: 'signers', label: 'appoints' },
  { from: 'signers', to: 'test-treasury', label: 'signs' },
  { from: 'forum', to: 'test-treasury', label: '', invalid: refusal === true ? undefined : refusal },
]

