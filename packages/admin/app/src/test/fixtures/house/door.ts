/** The public door's fixture (spec §12, §17): Example DAO's public facts, the house fixtures' Systems and hats, and
 *  placeholders. `DOOR_FIXTURE` is the model before `publicOnly`: beside the public entries it holds a members-level
 *  pool and decision and a members-level map node, which `DOOR_RECORDS` (the records they were read from, with their
 *  visibility) marks so, and which the door must never draw. The facts are computed (`doorFacts`), never written. No
 *  wearer, no real person's name; balances and dates are fixture values, read against FIXED_NOW. */
import { doorFacts, publicOnly, type DoorModel } from '../../../door/door.ts'
import type { MapNodeData } from '../../../map/HouseNode.tsx'
import type { MapItem } from '../../../map/layers.ts'
import { unitsToDecimal } from '../../../elements/atoms/chain.ts'
import { ORG, SAFE, SAFE_CHAINS, fakeAddress } from './org.ts'
import {
  MAP_COUNCIL, MAP_GARDEN, MAP_GITCOIN, MAP_KARMA, MAP_STARTER, MAP_LINKS, MAP_NETWORK, MAP_OPERATIONS, MAP_SIGNER, MAP_TREASURY, MAP_VOTES,
  MAP_WALLET,
} from './map.ts'
import { LOCAL_STARTER, NETWORK_PROJECTS, ROLE_HATS, TREASURY_SIGNERS, minutesBefore } from './systems.ts'
import type { Resource } from '../../../api.ts'

const CELO = 'eip155:42220'

/** A grant pool from its System: the read's amount in the token's units, as a decimal. */
function pool(r: Resource, purpose: string): DoorModel['pools'][number] {
  const facts = r.facts as { chain: string; address: string; driver: { facts: { amount: string; symbol: string; decimals: number } } }
  const read = facts.driver.facts
  return { id: r.id, name: r.name, chain: facts.chain, balance: unitsToDecimal(read.amount, read.decimals), unit: read.symbol, purpose, address: facts.address }
}

/** A map node on the door: its item, its public facts line, and the section that shows it. */
const node = (item: MapItem, facts: string, href: string | undefined, linked = false): MapNodeData =>
  ({ item, facts, states: linked ? ['linked'] : [], ...(href ? { href } : {}) })

/** A members-level System: on the members' map, never on the door. */
const STIPENDS: MapItem = { id: 'system:steward-stipends', kind: 'gardens-pool', name: 'Steward stipends', section: 'organization/treasury', facts: { kind: 'gardens-pool' } }

/** The stipends pool's own record: members-level, and an id no map node shares, so dropping the pool is the pool's
 *  own record's doing. */
const STIPENDS_POOL = 'pool:steward-stipends'

const hatLine = (n: number) => `${n} ${n === 1 ? 'wears' : 'wear'} it`

const BASE: Omit<DoorModel, 'facts'> = {
  org: {
    ...ORG, kind: 'A network society', tagline: 'Regenerative finance, practised together.', phrase: 'practised together.', since: '2022',
    description: 'A network society coordinating global and local regenerative finance through shared governance, local autonomy and public goods. Everything here is read from the DAO’s own records and its accounts on chain.',
  },
  map: {
    readAt: minutesBefore(4),
    items: [
      node(MAP_VOTES, 'Snapshot · Ethereum', '#decisions'),
      node(MAP_COUNCIL, '5 wear it', '#who'),
      node(MAP_OPERATIONS, '1 wears it', '#who'),
      node(MAP_SIGNER, '8 wear it', '#who'),
      node(MAP_WALLET, 'Ethereum', '#who', true),
      node(MAP_TREASURY, '4 of 8 · 7 chains', '#treasury'),
      node(MAP_GARDEN, 'Gardens · Celo', '#fund'),
      node(MAP_NETWORK, '1,271 USDGLO', '#fund'),
      node(MAP_STARTER, '3,100 USDGLO', '#fund'),
      node(STIPENDS, '900 USDGLO', '#fund'),
      node(MAP_KARMA, 'impact reports', undefined, true),
      node(MAP_GITCOIN, 'public-goods rounds', undefined, true),
    ],
    links: [...MAP_LINKS, { from: MAP_TREASURY.id, to: STIPENDS.id, label: 'admin' }],
  },
  // the tree below its top hat (the top hat is the org itself), as the Roles System reads it
  hats: ROLE_HATS.filter(h => h.level > 0).map(h => ({ id: h.id, name: h.details, level: h.level, line: hatLine(h.supply), open: h.active && h.supply === 0 })),
  pools: [
    pool(NETWORK_PROJECTS, 'Work that serves the whole network'),
    pool(LOCAL_STARTER, 'Seed funding for new local nodes'),
    { id: STIPENDS_POOL, name: 'Steward stipends', chain: CELO, balance: '900', unit: 'USDGLO', purpose: 'Stipends for the stewards', address: fakeAddress(74) },
  ],
  openNote: { text: 'The Council is considering returning both pools to the treasury.', id: 'DR-2026-010' },
  treasury: { threshold: 4, signers: TREASURY_SIGNERS.length, address: SAFE, chains: [...SAFE_CHAINS], readAt: minutesBefore(4) },
  decisions: [
    { id: 'DR-2026-010', title: 'Return the Gardens pools to the treasury', route: 'Council · route T3', date: '2026-09-28', state: 'open' },
    { id: 'DR-2026-011', title: 'Return the G$ to the treasury', route: 'Council · route T2', date: '2026-10-08', state: 'executed' },
    { id: 'DR-2026-012', title: 'Pay the Q4 steward stipends', route: 'Council · route T2', date: '2026-10-10', state: 'decided' },
    { id: 'DR-2026-009', title: 'A change to a restricted collection', route: 'Ops lead · route T1', date: '2026-09-14', state: 'decided' },
  ],
  writing: [
    { id: 'page:how-the-treasury-is-signed', title: 'How the treasury is signed', date: '2026-10-02', href: '#writing' },
    { id: 'page:spring-call-outcome', title: 'The spring call for local nodes: what was funded', date: '2026-09-21', href: '#writing' },
  ],
  also: [
    { name: 'Snapshot', href: 'https://snapshot.box/#/s:exampledao.eth' },
    { name: 'Karma GAP', href: 'https://gap.karmahq.xyz' },
    { name: 'Gitcoin', href: 'https://explorer.gitcoin.co' },
  ],
  daoUri: 'https://door.example.org/.well-known/dao.json',
  membersOrigin: '',
}

/** The door's model as read, before `publicOnly`: members-level entries included. */
export const DOOR_FIXTURE: DoorModel = { ...BASE, facts: doorFacts(BASE as DoorModel) }

/** The records the model's entries were read from, with their visibility: the stipends pool (its own record), its map
 *  node and the stipends decision are members-level; every other one is public. A pool read from a map node's System
 *  shares that System's record. */
export const DOOR_RECORDS: unknown[] = [
  ...BASE.map.items.map(d => ({ id: d.item.id, facts: { visibility: d.item.id === STIPENDS.id ? 'members' : 'public' } })),
  ...BASE.hats.map(h => ({ id: h.id, facts: { visibility: 'public' } })),
  ...BASE.pools.filter(p => p.id !== undefined && !BASE.map.items.some(d => d.item.id === p.id))
    .map(p => ({ id: p.id, facts: { visibility: p.id === STIPENDS_POOL ? 'members' : 'public' } })),
  ...BASE.decisions.map(d => ({ id: d.id, facts: { visibility: d.id === 'DR-2026-012' ? 'members' : 'public' } })),
  ...BASE.writing.map(w => ({ id: w.id, facts: { visibility: 'public' } })),
]

/** The door as it is drawn: public entries only. */
export const DOOR_PUBLIC: DoorModel = publicOnly(DOOR_FIXTURE, DOOR_RECORDS)
