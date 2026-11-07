/** The house's Systems (spec §17), as /parts draws them: typed Resources in the shape the systems adapter gives
 *  (`server/resources/adapters/systems.ts`), each with its driver's read in `facts.driver`, in the drivers' own keys
 *  and section titles (tests/systems/house-fixtures.test.ts holds them to the drivers' real output). Between them
 *  they are in every state a Systems row shows: signatures waiting, empty hats, up to date, a failed read, a read
 *  in flight, an old read, a link that is not read, and (given `proposed` on /parts) a staged return.
 *  Example DAO's public facts, placeholder names and generated addresses only; times are minutes before FIXED_NOW. */
import type { Attention, Resource } from '../../../api.ts'
import type { DriverRead, DriverSection, ReadingState } from '../../../../../server/systems/driver.ts'
import type { HatFact } from '../../../../../server/systems/hats.ts'
import { childHatId, hatRef, prettyHatId, topHatId, treeRef } from '../../../../../lib/hats.mjs'
import { FIXED_NOW } from '../parts.ts'
import { SAFE, SAFE_CHAINS, fakeAddress } from './org.ts'

/** An instant this many minutes before the fixtures' clock. */
export const minutesBefore = (minutes: number) => new Date(FIXED_NOW.getTime() - minutes * 60_000).toISOString()
/** The same moment in Unix seconds, as Snapshot reports times. */
const unixMinutesBefore = (minutes: number) => Math.floor((FIXED_NOW.getTime() - minutes * 60_000) / 1000)

const ETH = 'eip155:1'
const CELO = 'eip155:42220'
/** The networks' names as the Safe driver writes them (server/systems/chains.ts). */
const NETWORK: Record<string, string> = {
  'eip155:1': 'Ethereum', 'eip155:10': 'Optimism', 'eip155:42161': 'Arbitrum', 'eip155:100': 'Gnosis', 'eip155:137': 'Polygon',
  'eip155:8453': 'Base', 'eip155:42220': 'Celo',
}
/** The Safe app's prefix for each chain (server/systems/chains.ts `safe`). */
const SLUG: Record<string, string> = {
  'eip155:1': 'eth', 'eip155:10': 'oeth', 'eip155:42161': 'arb1', 'eip155:100': 'gno', 'eip155:137': 'pol', 'eip155:8453': 'base', 'eip155:42220': 'celo',
}
const at = (chain: string, address: string) => `${chain}:${address}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const safeApp = (chain: string, address: string) => `https://app.safe.global/home?safe=${SLUG[chain]}:${address}`
const VERSION = '1.3.0'
const SOURCE_NOTE = "the deployed contract's source is not verified on the explorer; the platform reads it by the 68cd18d interface"

/** One entry of data/systems.yaml, as the adapter passes it on. */
interface Entry { id: string; kind: string; name: string; chain?: string; address?: string; url?: string; section?: string }

/** A System as the systems adapter makes it: `system:<id>`, its kind as the status, the entry's facts and the read. */
function system(e: Entry, driver: DriverRead & { state: ReadingState }, attention: Attention | null): Resource {
  return {
    id: `system:${e.id}`, kind: 'system', board: e.section?.startsWith('organization') ? 'organization' : 'systems', name: e.name,
    status: e.kind, attention, changed: null,
    facts: {
      kind: e.kind, chain: e.chain ?? null, address: e.address ?? null, ...(e.url ? { url: e.url } : {}),
      section: e.section ?? null, embeddable: false, notes: null, driver,
    },
    source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: e.id },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Treasury: Example DAO's Safe, 4 of 8 on seven chains, every chain agreeing; one transaction waits on Celo.

/** The Treasury's eight owners (generated). */
export const TREASURY_SIGNERS = Array.from({ length: 8 }, (_, i) => fakeAddress(11 + i))
/** Two of them, for its field rows (the other six are "+6"). */
export const TREASURY_OWNERS = [TREASURY_SIGNERS[0]!, TREASURY_SIGNERS[1]!] as const
const NONCE: Record<string, number> = { 'eip155:42220': 18 }
const PENDING_ON = CELO

const treasuryChains = SAFE_CHAINS.map(chain => ({
  chain, network: NETWORK[chain]!, account: at(chain, SAFE), ok: true, threshold: 4, owners: TREASURY_SIGNERS.map(o => at(chain, o)),
  nonce: NONCE[chain] ?? 3, pending: chain === PENDING_ON ? 1 : 0, version: VERSION,
}))

/** What moved through the Treasury in the window (the Safe driver's `transfers`, C12): in from the Ops wallet and a
 *  Gitcoin round, out to the Network Projects pool, in USDGLO (its token, the Garden's USDGLO) on Celo, newest first.
 *  Base units, 18 decimals. */
export const TREASURY_TRANSFERS = [
  { chain: CELO, from: fakeAddress(81), to: SAFE, value: '2500000000000000000000', unit: 'USDGLO', decimals: 18, token: fakeAddress(91), at: minutesBefore(12 * 1440), txHash: `0x${'a1'.repeat(32)}` },
  { chain: CELO, from: SAFE, to: fakeAddress(72), value: '1271000000000000000000', unit: 'USDGLO', decimals: 18, token: fakeAddress(91), at: minutesBefore(20 * 1440), txHash: `0x${'a2'.repeat(32)}` },
  { chain: CELO, from: fakeAddress(61), to: SAFE, value: '412000000000000000000', unit: 'USDGLO', decimals: 18, token: fakeAddress(91), at: minutesBefore(30 * 1440), txHash: `0x${'a3'.repeat(32)}` },
]

/** The Treasury's read, 4 minutes old (the safe driver on several chains). */
export const TREASURY_READ: DriverRead & { state: ReadingState } = {
  ok: true, state: 'fresh', readAt: minutesBefore(4),
  facts: {
    chain: SAFE_CHAINS[0], address: SAFE, account: at(SAFE_CHAINS[0], SAFE), shortAddress: short(SAFE), network: NETWORK[SAFE_CHAINS[0]],
    threshold: 4, owners: 8, nonce: 3, version: VERSION, pending: 1, agree: true, chains: treasuryChains, transfers: TREASURY_TRANSFERS,
  },
  sections: [
    { title: 'Chains', note: 'all 7 chains agree', rows: treasuryChains.map(c => ({
      cells: [c.network, '4 of 8', `nonce ${c.nonce}`, `${c.pending} waiting`], href: safeApp(c.chain, SAFE), refs: [c.account],
    })) },
    { title: 'Waiting on signers', note: '1 waiting across 7 chains', rows: [
      { cells: ['Celo', '#18', `transfer → ${short(fakeAddress(19))} · 1271 CELO`, '2 of 4 signatures', '3 hours ago'], attention: 'alert' },
    ] },
    { title: 'Balances', note: '1 balance on 7 chains', rows: [{ cells: ['Celo', 'USDGLO', '3100'] }] },
    { title: 'Signers', note: '8 signers; 4 of 8 needed on Ethereum', rows: TREASURY_SIGNERS.map(o => ({ cells: [o, '—', 'all chains'], refs: [at(SAFE_CHAINS[0], o)] })) },
    { title: 'Executed', note: 'the latest 0', rows: [] },
  ],
  open: { url: safeApp(SAFE_CHAINS[0], SAFE), embeddable: false },
}

export const TREASURY_SYSTEM = system(
  { id: 'treasury', kind: 'safe', name: 'Treasury', chain: SAFE_CHAINS[0], address: SAFE, section: 'organization/treasury' },
  TREASURY_READ, { level: 'alert', text: 'Waiting on signers: 1' },
)

// ---------------------------------------------------------------------------------------------------------------
// The Garden's council Safe: one chain, 3 of 5; being read again now (its last read is 41 minutes old).

const COUNCIL = fakeAddress(2)
const COUNCIL_OWNERS = Array.from({ length: 5 }, (_, i) => fakeAddress(21 + i))
export const COUNCIL_SAFE = system(
  { id: 'council-safe', kind: 'safe', name: 'Council Safe', chain: CELO, address: COUNCIL, section: 'organization/treasury' },
  {
    ok: true, state: 'reading', readAt: minutesBefore(41),
    facts: { chain: CELO, network: 'Celo', address: COUNCIL, account: at(CELO, COUNCIL), shortAddress: short(COUNCIL), threshold: 3, owners: 5, nonce: 7, pending: 0, version: VERSION, transfers: [] },
    sections: [
      { title: 'Waiting on signers', note: 'nothing waiting', rows: [] },
      { title: 'Balances', note: '0 tokens', rows: [] },
      { title: 'Signers', note: '3 of 5 needed', rows: COUNCIL_OWNERS.map(o => ({ cells: [o, '—'] })) },
      { title: 'Executed', note: 'the latest 0', rows: [] },
    ],
    open: { url: safeApp(CELO, COUNCIL), embeddable: false },
  },
  null,
)

// ---------------------------------------------------------------------------------------------------------------
// Roles: Hats tree #13 on Celo, its hats walked depth first as the driver walks them. Three active hats have no
// wearer. B6 draws its role tree from these.

const TOP = topHatId(13)
const hatId = (...path: number[]) => path.reduce((id, n) => childHatId(id, n), TOP)
/** Each hat: its path under the top hat, its name (the hat's details), its wearers and its cap. */
const HAT_LIST: { path: number[]; name: string; wearers: string[]; max: number }[] = [
  { path: [], name: 'Example DAO', wearers: [SAFE], max: 1 },
  { path: [1], name: 'Steward Council', wearers: COUNCIL_OWNERS, max: 9 },
  { path: [1, 1], name: 'Treasury signer', wearers: TREASURY_SIGNERS, max: 9 },
  { path: [2], name: 'Operations', wearers: [fakeAddress(31)], max: 3 },
  { path: [2, 1], name: 'Finance', wearers: [fakeAddress(32)], max: 2 },
  { path: [2, 2], name: 'Events', wearers: [fakeAddress(33), fakeAddress(34)], max: 4 },
  { path: [2, 3], name: 'Regional coordinator', wearers: [], max: 1 },
  { path: [2, 4], name: 'Comms', wearers: [], max: 2 },
  { path: [3], name: 'Local nodes', wearers: Array.from({ length: 12 }, (_, i) => fakeAddress(41 + i)), max: 50 },
  { path: [3, 1], name: 'Local node 1', wearers: [fakeAddress(41), fakeAddress(42), fakeAddress(43)], max: 5 },
  { path: [3, 2], name: 'Local node 2', wearers: [], max: 5 },
  { path: [3, 3], name: 'Local node 3', wearers: [fakeAddress(44), fakeAddress(45)], max: 5 },
  { path: [3, 4], name: 'Local node 4', wearers: [fakeAddress(46)], max: 5 },
]
const childrenOf = (path: number[]) => HAT_LIST.filter(h => h.path.length === path.length + 1 && path.every((n, i) => h.path[i] === n)).length

/** The tree's hats, in the hats driver's facts (HatFact). */
export const ROLE_HATS: HatFact[] = HAT_LIST.map(h => {
  const id = hatId(...h.path)
  return {
    id: hatRef(CELO, id), pretty: prettyHatId(id), admin: h.path.length === 0 ? null : hatRef(CELO, hatId(...h.path.slice(0, -1))), level: h.path.length,
    details: h.name, imageURI: '', maxSupply: h.max, supply: h.wearers.length, eligibility: null, toggle: null,
    mutable: h.path.length > 0, active: true, lastHatId: childrenOf(h.path), holders: h.wearers.map(w => at(CELO, w)), holdersComplete: true,
  }
})
/** A hat's ref by its path under the top hat: `hatRefOf(2, 3)` is 13.2.3, Regional coordinator. */
export const hatRefOf = (...path: number[]) => hatRef(CELO, hatId(...path))

const ROLES_SECTIONS: DriverSection[] = [
  { title: 'Roles', rows: ROLE_HATS.map(h => ({
    cells: [h.pretty, h.details, `${h.supply} of ${h.maxSupply}`, h.supply === 0 ? 'no one' : `${h.supply} holders`],
    ...(h.active && h.supply === 0 ? { attention: 'warn' as const } : {}), refs: [h.id],
  })) },
  { title: 'Wearers', note: 'static holders from celo.blockscout.com; membership is checked on chain', rows: ROLE_HATS.flatMap(h =>
    (h.holders ?? []).map(holder => ({ cells: [h.pretty, holder.split(':')[2]!, '—'], refs: [holder, h.id] }))) },
  { title: 'Modules', rows: [] },
]

export const ROLES = system(
  { id: 'roles', kind: 'hats-tree', name: 'Roles', chain: CELO, address: '13', section: 'organization/roles' },
  {
    ok: true, state: 'fresh', readAt: minutesBefore(4),
    facts: { chain: CELO, tree: 13, ref: treeRef(CELO, 13), topHat: hatRef(CELO, TOP), block: 31204118, hats: ROLE_HATS },
    sections: ROLES_SECTIONS,
    open: { url: 'https://app.hatsprotocol.xyz/trees/42220/13', embeddable: false },
  },
  { level: 'warn', text: 'Roles: 3' },
)

// ---------------------------------------------------------------------------------------------------------------
// Votes: the exampledao.eth Snapshot space, read 4 minutes ago, nothing open.

export const VOTES = system(
  { id: 'votes', kind: 'snapshot-space', name: 'exampledao.eth', url: 'https://snapshot.box/#/s:exampledao.eth', section: 'organization/governance' },
  {
    ok: true, state: 'fresh', readAt: minutesBefore(4),
    facts: {
      space: 'exampledao.eth', name: 'Example DAO', chain: ETH, admins: [at(ETH, fakeAddress(61))],
      voting: { type: 'single-choice', period: 432000, delay: 0, quorum: 0, privacy: 'any' },
      strategies: ['erc20-balance-of'], validation: 'basic', open: 0,
      proposals: [{
        id: '0x1', title: 'Fund the local node kit', state: 'closed', type: 'single-choice',
        start: unixMinutesBefore(12 * 1440 + 7200), end: unixMinutesBefore(12 * 1440), created: unixMinutesBefore(12 * 1440 + 7200),
      }],
    },
    sections: [
      { title: 'Open votes', rows: [] },
      { title: 'Recent results', rows: [{ cells: ['Fund the local node kit', 'For 81%', '42 votes', '12 days ago'], href: 'https://snapshot.box/#/s:exampledao.eth/proposal/0x1' }] },
      { title: 'Settings', rows: [['Voting', 'single-choice'], ['Period', '5 days'], ['Delay', 'none'], ['Quorum', '0'], ['Strategies', 'erc20-balance-of'],
        ['Validation', 'basic'], ['Admins', '1']].map(cells => ({ cells })) },
    ],
    open: { url: 'https://snapshot.box/#/s:exampledao.eth', embeddable: false },
  },
  null,
)

// ---------------------------------------------------------------------------------------------------------------
// The Garden (a Gardens community on Celo) and its two pools. The Garden's last read failed; its last good read,
// two hours old, is kept.

const GARDEN_ADDRESS = fakeAddress(71)
const USDGLO = fakeAddress(91)
const POOLS = [
  { id: 'network-projects', title: 'Network Projects', address: fakeAddress(72), poolId: 1, amount: '1271000000000000000000' },
  { id: 'local-starter', title: 'Local Starter', address: fakeAddress(73), poolId: 2, amount: '3100000000000000000000' },
] as const
const gardensApp = (pool?: string) => `https://app.gardens.fund/gardens/42220/${GARDEN_ADDRESS}${pool ? `/${pool}` : ''}`

export const GARDEN = system(
  { id: 'garden', kind: 'gardens-community', name: 'Example DAO Garden', chain: CELO, address: GARDEN_ADDRESS, section: 'organization/treasury' },
  {
    ok: false, state: 'failed', readAt: minutesBefore(120), error: 'api.studio.thegraph.com answered 503',
    facts: {
      chain: CELO, community: at(CELO, GARDEN_ADDRESS), name: 'Example DAO Garden', councilSafe: at(CELO, COUNCIL), members: 42,
      garden: { token: at(CELO, USDGLO), symbol: 'USDGLO', decimals: 18 },
      pools: POOLS.map(p => ({
        id: at(CELO, p.address), poolId: p.poolId, title: p.title, type: 'funding', token: at(CELO, USDGLO), amount: p.amount, symbol: 'USDGLO',
        decimals: 18, enabled: true, archived: false,
      })),
      source: 'unverified',
    },
    sections: [
      { title: 'Pools', note: SOURCE_NOTE, rows: POOLS.map(p => ({ cells: [p.title, `#${p.poolId}`, '', 'funding', ''], href: gardensApp(p.address), refs: [at(CELO, p.address)] })) },
      { title: 'Council', rows: [{ cells: ['Council Safe', short(COUNCIL)], refs: [at(CELO, COUNCIL)] }, { cells: ['Members', '42'] }] },
    ],
    open: { url: gardensApp(), embeddable: false },
  },
  { level: 'warn', text: 'read failed: api.studio.thegraph.com answered 503' },
)

function pool(p: (typeof POOLS)[number], state: ReadingState, minutes: number): Resource {
  return system(
    { id: p.id, kind: 'gardens-pool', name: p.title, chain: CELO, address: p.address, section: 'organization/treasury' },
    {
      ok: true, state, readAt: minutesBefore(minutes),
      facts: {
        chain: CELO, pool: at(CELO, p.address), poolId: p.poolId, community: at(CELO, GARDEN_ADDRESS), councilSafe: at(CELO, COUNCIL), type: 'funding',
        token: at(CELO, USDGLO), amount: p.amount, symbol: 'USDGLO', decimals: 18, allowlist: null, open: null, enabled: true, archived: false, proposals: [], source: 'unverified',
      },
      sections: [
        { title: 'Proposals', note: 'no proposal is active', rows: [] },
        { title: 'Pool', note: SOURCE_NOTE, rows: [{ cells: ['Funds', `${p.amount.slice(0, -18)} USDGLO`] }, { cells: ['Admin', `council Safe ${short(COUNCIL)}`] }] },
        { title: 'Decided', rows: [] },
      ],
      open: { url: gardensApp(p.address), embeddable: false },
    },
    null,
  )
}
/** Read 4 minutes ago; on /parts a proposal to return its funds is staged against it. */
export const NETWORK_PROJECTS = pool(POOLS[0], 'fresh', 4)
/** Read 38 minutes ago: past the reader's time to live, an old read. */
export const LOCAL_STARTER = pool(POOLS[1], 'aged', 38)

// ---------------------------------------------------------------------------------------------------------------
// The Ops wallet: a link, not read.

const OPS_WALLET_ADDRESS = fakeAddress(81)
const OPS_WALLET_URL = `https://etherscan.io/address/${OPS_WALLET_ADDRESS}`
export const OPS_WALLET = system(
  { id: 'ops-wallet', kind: 'link', name: 'Ops wallet', chain: ETH, address: OPS_WALLET_ADDRESS, url: OPS_WALLET_URL },
  { ok: true, state: 'fresh', readAt: minutesBefore(4), facts: { url: OPS_WALLET_URL }, sections: [], open: { url: OPS_WALLET_URL, embeddable: false } },
  null,
)

/** The Systems list, in the order /parts draws it. */
export const SYSTEMS: Resource[] = [TREASURY_SYSTEM, COUNCIL_SAFE, ROLES, VOTES, GARDEN, NETWORK_PROJECTS, LOCAL_STARTER, OPS_WALLET]
