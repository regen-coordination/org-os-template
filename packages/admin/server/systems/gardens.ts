import { caip10, checksumAddress, addressOf, isAddress, sameAccount } from '../../lib/caip.mjs'
import { encodeCall, decodeResult } from '../../lib/abi.mjs'
import { CHAINS, chainInfo, chainIdNumber } from './chains.ts'
import { isForeignRef, type ActionInput, type ActionSpec, type Call, type Driver, type DriverContext, type DriverRead, type DriverSection, type ForeignRef, type OutcomeReading, type OutcomeRef, type PreparedAction } from './driver.ts'
import { ethCalls, graphql, type CallResult, type EthCall } from './wire.ts'
import { ago, formatUnits, shortAddress } from './safe.ts'

/** Gardens v2's subgraphs on Graph Studio, as https://github.com/1Hive/gardens-v2/blob/68cd18d8ace3cec4a5715c6d00f9a85369816033/skills/query-subgraph/SKILL.md pins them. */
export const GARDENS_SUBGRAPHS: Record<string, string> = {
  'eip155:42220': 'https://api.studio.thegraph.com/query/102093/gardens-v2---celo/version/latest',
  'eip155:42161': 'https://api.studio.thegraph.com/query/102093/gardens-v2---arbitrum/version/latest',
  'eip155:10': 'https://api.studio.thegraph.com/query/102093/gardens-v2---optimism/version/latest',
  'eip155:137': 'https://api.studio.thegraph.com/query/102093/gardens-v2---polygon/version/latest',
  'eip155:100': 'https://api.studio.thegraph.com/query/102093/gardens-v2---gnosis/version/latest',
  'eip155:8453': 'https://api.studio.thegraph.com/query/102093/gardens-v2---base/version/latest',
}

/** ProposalType (ICVStrategy.sol @ 68cd18d); the subgraph's `config.proposalType` indexes it. */
export const POOL_TYPES: readonly string[] = ['signaling', 'funding', 'streaming']

export const GARDENS_HOST = 'api.studio.thegraph.com'

/** https://app.gardens.fund/gardens/<chain id>/<community>[/<pool>] */
export const gardensAppUrl = (chain: string, community: string, pool?: string): string =>
  `https://app.gardens.fund/gardens/${chainIdNumber(chain) ?? chain}/${community.toLowerCase()}${pool ? `/${pool.toLowerCase()}` : ''}`

/** What a read says when an answer does not fit the 68cd18d interface (coordinator ruling on Q-L2-5): an alert row
 *  with this text and what did not fit, never the value shown as if true. */
export const UNEXPECTED = 'Gardens contract did not answer as expected'
/** Every Gardens read says this: the deployed facet and implementation are unverified on Blockscout (L2-C5 findings). */
export const SOURCE_NOTE = "the deployed contract's source is not verified on the explorer; the platform reads it by the 68cd18d interface"
/** The most characters of a token symbol a cell shows. */
export const SYMBOL_MAX = 12
/** Above this, 10^decimals is not a number a token means (uint256 holds 10^77). */
const DECIMALS_MAX = 77

/** A token symbol as a cell shows it: at most SYMBOL_MAX characters, the last one '…' when cut. */
export function cellSymbol(symbol: string): string {
  const chars = Array.from(symbol)
  return chars.length > SYMBOL_MAX ? chars.slice(0, SYMBOL_MAX - 1).join('') + '…' : symbol
}

/** What did not fit in one read, each said once as an alert row. */
type Odd = string[]
const oddRows = (odd: Odd): DriverSection['rows'] => odd.map(what => ({ cells: [UNEXPECTED, what], attention: 'alert' as const }))

/** A whole number the subgraph gives as a JSON string; null, and noted, when it is not one. */
function whole(v: unknown, what: string, odd: Odd): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : Number.NaN
  if (Number.isSafeInteger(n) && n >= 0) return n
  odd.push(`${what} is ${JSON.stringify(v)}, not a whole number`)
  return null
}

/** An amount in base units the subgraph gives as a JSON string of digits; null, and noted, when it is not one. */
function units(v: unknown, what: string, odd: Odd): string | null {
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v).toString(10)
  odd.push(`${what} is ${JSON.stringify(v)}, not an amount`)
  return null
}

/** A call's answer decoded as `types`. A revert throws (the node refused it: the read fails); an answer that does not
 *  decode is null, and noted. */
function decoded<T>(r: CallResult, what: string, types: string[], odd: Odd): T | null {
  if (!r.ok) throw new Error(`${what} was refused by the node (${r.error})`)
  try { return decodeResult(types, r.data)[0] as T } catch {
    odd.push(`${what} answered ${r.data.length > 20 ? `${r.data.slice(0, 18)}…` : r.data}, not a ${types.join(', ')}`)
    return null
  }
}

/** A token's decimals() answer: null, and noted, when it does not decode or is above DECIMALS_MAX. */
function decimalsOf(r: CallResult, token: string, odd: Odd): number | null {
  const what = `decimals() on token ${shortAddress(token)}`
  const d = decoded<string>(r, what, ['uint8'], odd)
  if (d === null) return null
  if (Number(d) > DECIMALS_MAX) { odd.push(`${what} answered ${d}, more than ${DECIMALS_MAX}`); return null }
  return Number(d)
}

/** A token's symbol() answer; its short address when the call reverts or does not decode (a name, not a value). */
function symbolOf(r: CallResult, token: string): string {
  if (!r.ok) return shortAddress(token)
  try { return String(decodeResult(['string'], r.data)[0]) } catch { return shortAddress(token) }
}

/** A pool's type from `config.proposalType` ("1" = funding): null when no config says it (unknown, no attention); null
 *  and noted when it is not an index of POOL_TYPES. */
function poolType(config: { proposalType?: unknown } | null | undefined, what: string, odd: Odd): string | null {
  const raw = config?.proposalType
  if (raw === undefined || raw === null) return null
  const i = whole(raw, `${what}'s type`, odd)
  if (i === null) return null
  if (i >= POOL_TYPES.length) { odd.push(`${what}'s type is ${i}, not one of ${POOL_TYPES.map((t, j) => `${j} (${t})`).join(', ')}`); return null }
  return POOL_TYPES[i]!
}

/** The subgraph's `chainId` must be the system's chain: another one is a failed read in words. */
function sameChain(answered: unknown, chain: string, name: string, what: string): void {
  const expected = chainIdNumber(chain)
  if (String(answered) !== String(expected)) throw new Error(`Gardens answered ${what} as being on chain ${JSON.stringify(answered)}, not ${name} (${expected})`)
}

const amountCell = (amount: string | null, decimals: number | null, symbol: string): string =>
  amount === null || decimals === null ? 'unknown' : `${formatUnits(amount, decimals)} ${cellSymbol(symbol)}`

/** The system's chain, its name and its subgraph, or the sentence that refuses it. Nothing is requested. */
function whereOf(system: Record<string, unknown>): { chain: string; name: string; subgraph: string } {
  const chain = String(system.chain)
  const info = chainInfo(chain)
  if (!info) throw new Error(`Gardens is read on chains this Hub knows; ${chain} is not one of them`)
  const subgraph = Object.hasOwn(GARDENS_SUBGRAPHS, chain) ? GARDENS_SUBGRAPHS[chain] : null
  if (!subgraph) throw new Error(`Gardens has no subgraph for ${info.name} (${chain}) that this Hub reads`)
  return { chain, name: info.name, subgraph }
}

const HOSTS = [GARDENS_HOST, ...Object.keys(GARDENS_SUBGRAPHS).map(c => CHAINS[c]?.rpc).filter((h): h is string => !!h)]

const QUERY = `query Community($id: ID!) { registryCommunity(id: $id) { id communityName chainId councilSafe pendingNewCouncilSafe membersCount registerStakeAmount registerToken archived garden { id symbol decimals } strategies { id poolId token isEnabled archived metadata { title } config { proposalType pointSystem } } } }`

interface Community {
  id: string; communityName?: string | null; chainId?: unknown; councilSafe?: string | null; pendingNewCouncilSafe?: string | null
  membersCount?: unknown; archived?: boolean
  garden?: { id: string; symbol?: string | null; decimals?: unknown } | null
  strategies: { id: string; poolId: unknown; token: string; isEnabled: boolean; archived: boolean
    metadata?: { title?: string | null } | null; config?: { proposalType?: unknown } | null }[]
}

export const gardensCommunity: Driver = {
  name: 'gardens-community',
  hosts: HOSTS,
  minGapMs: 500,
  async read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
    const { chain, name, subgraph } = whereOf(system)
    const community = addressOf(String(system.address))
    const data = await graphql<{ registryCommunity: Community | null }>(ctx, subgraph, QUERY, { id: community.toLowerCase() })
    const c = data.registryCommunity
    if (!c) throw new Error(`Gardens has no community ${community} on ${name}`)
    sameChain(c.chainId, chain, name, `community ${community}`)

    const odd: Odd = []
    const pools = c.strategies ?? []
    const tokens = [...new Set(pools.map(p => checksumAddress(p.token)))]
    const calls: EthCall[] = [
      ...pools.map(p => ({ to: p.id, data: encodeCall('getPoolAmount()', []) })),
      ...tokens.flatMap(t => [{ to: t, data: encodeCall('symbol()', []) }, { to: t, data: encodeCall('decimals()', []) }]),
    ]
    const { results } = await ethCalls(ctx, chain, calls)
    const amounts = pools.map((p, i) => decoded<string>(results[i]!, `getPoolAmount() on pool ${shortAddress(checksumAddress(p.id))}`, ['uint256'], odd))
    const meta = new Map<string, { symbol: string; decimals: number | null }>()
    tokens.forEach((t, i) => {
      meta.set(t, { symbol: symbolOf(results[pools.length + 2 * i]!, t), decimals: decimalsOf(results[pools.length + 2 * i + 1]!, t, odd) })
    })

    const council = c.councilSafe ? checksumAddress(c.councilSafe) : null
    const pending = c.pendingNewCouncilSafe ? checksumAddress(c.pendingNewCouncilSafe) : null
    const members = whole(c.membersCount, 'the member count', odd)
    let garden: { token: string; symbol: string; decimals: number | null } | null = null
    if (c.garden) garden = { token: caip10(chain, c.garden.id), symbol: c.garden.symbol ?? '', decimals: whole(c.garden.decimals, 'the garden token\'s decimals', odd) }
    else odd.push('the community has no garden token')
    const facts = {
      chain, community: caip10(chain, community), name: c.communityName ?? '',
      councilSafe: council ? caip10(chain, council) : null, members, garden,
      pools: pools.map((p, i) => {
        const token = checksumAddress(p.token), m = meta.get(token)!
        const id = checksumAddress(p.id)
        return {
          id: caip10(chain, id), poolId: whole(p.poolId, `pool ${shortAddress(id)}'s id`, odd), title: p.metadata?.title ?? '',
          type: poolType(p.config, `pool ${shortAddress(id)}`, odd),
          token: caip10(chain, token), amount: amounts[i], symbol: m.symbol, decimals: m.decimals, enabled: p.isEnabled, archived: p.archived,
        }
      }),
      source: 'unverified' as const,
    }
    const sections: DriverSection[] = [
      { title: 'Pools', note: SOURCE_NOTE, rows: [
        ...facts.pools.map(p => ({
          cells: [p.title, p.poolId === null ? '#?' : `#${p.poolId}`, amountCell(p.amount, p.decimals, p.symbol), p.type ?? 'type unknown',
            [p.enabled ? null : 'disabled', p.archived ? 'archived' : null].filter(Boolean).join(', ')],
          href: gardensAppUrl(chain, community, p.id.split(':')[2]), refs: [p.id],
        })),
        ...oddRows(odd),
      ] },
      { title: 'Council', rows: [
        council ? { cells: ['Council Safe', shortAddress(council)], refs: [caip10(chain, council)] } : { cells: ['Council Safe', 'none'] },
        { cells: ['Members', members === null ? 'unknown' : String(members)] },
        ...(pending ? [{ cells: ['Council Safe change waiting', shortAddress(pending)], attention: 'warn' as const, refs: [caip10(chain, pending)] }] : []),
      ] },
    ]
    return { ok: true, readAt: ctx.now().toISOString(), facts, sections, open: { url: gardensAppUrl(chain, community), embeddable: false } }
  },
}

// ---------------------------------------------------------------------------------------------------------------------
// gardens-pool: one CVStrategy pool — its proposals and their conviction, its allowlist changed through the council Safe,
// and a proposal's outcome read back. Interfaces of gardens-v2 @ 68cd18d (the deployed source is unverified: SOURCE_NOTE).
// ---------------------------------------------------------------------------------------------------------------------

/** ProposalStatus (ICVStrategy.sol @ 68cd18d); the subgraph's `proposalStatus` indexes it. */
export const PROPOSAL_STATUS: readonly string[] = ['inactive', 'active', 'paused', 'cancelled', 'executed', 'disputed', 'rejected']

/** CVAdminFacet's 6-argument setPoolParams (selector 0xd5b7cc54): arbitrable config, CV params, sybil threshold, members
 *  to add, members to remove, Superfluid token. Zero configs and a zero threshold leave those as they are (L201–262). */
export const SET_POOL_PARAMS = 'setPoolParams((address,address,uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256),uint256,address[],address[],address)'
const SET_POOL_PARAMS_SELECTOR = '0xd5b7cc54'
const ZERO = '0x0000000000000000000000000000000000000000'
/** Decided proposals shown. */
const DECIDED_SHOWN = 5

const MEMBERS_PARAM = { name: 'members', label: 'Members', type: 'addresses' } as const
/** Who may stake in a pool: changed by the council Safe (ruling K1: class treasury, since a removal withdraws stake). */
export const GARDENS_ACTIONS: ActionSpec[] = [
  { id: 'allowlist-add', label: 'Add members to a pool\'s allowlist', class: 'treasury', params: [MEMBERS_PARAM] },
  { id: 'allowlist-remove', label: 'Remove members from a pool\'s allowlist', class: 'treasury', params: [MEMBERS_PARAM] },
]

const POOL_QUERY = `query Pool($id: ID!, $strategy: String!) { cvstrategy(id: $id) { id poolId token isEnabled archived metadata { title } registryCommunity { id communityName chainId councilSafe } config { proposalType pointSystem maxAmount allowlist } } cvproposals(first: 25, where: { strategy: $strategy }, orderBy: createdAt, orderDirection: desc) { id proposalNumber proposalStatus requestedAmount requestedToken beneficiary convictionLast stakedAmount createdAt executedAt metadata { title } } }`
const ADMIN_QUERY = `query PoolAdmin($id: ID!) { cvstrategy(id: $id) { id poolId registryCommunity { id chainId councilSafe } config { allowlist } } }`
const PROPOSAL_QUERY = `query Proposal($id: ID!) { cvproposal(id: $id) { id proposalNumber proposalStatus createdAt executedAt strategy { id } } }`

interface PoolCommunity { id: string; communityName?: string | null; chainId?: unknown; councilSafe?: string | null }
interface Strategy {
  id: string; poolId?: unknown; token: string; isEnabled?: boolean; archived?: boolean; metadata?: { title?: string | null } | null
  registryCommunity?: PoolCommunity | null; config?: { proposalType?: unknown; allowlist?: unknown } | null
}
interface ProposalAnswer {
  id: string; proposalNumber?: unknown; proposalStatus?: unknown; requestedAmount?: unknown; requestedToken?: string | null
  beneficiary?: string | null; createdAt?: unknown; executedAt?: unknown; metadata?: { title?: string | null } | null
}

/** A proposal's status word; null, and noted, when the number is not one of PROPOSAL_STATUS. */
function statusOf(v: unknown, label: string, odd: Odd): string | null {
  const word = typeof v === 'string' && /^\d+$/.test(v) ? PROPOSAL_STATUS[Number(v)] : undefined
  if (word !== undefined) return word
  odd.push(`${label}'s status is ${JSON.stringify(v)}, not one of 0–${PROPOSAL_STATUS.length - 1} (${PROPOSAL_STATUS.join(', ')})`)
  return null
}

/** The allowlist (`config.allowlist`, lowercase strings): its members checksummed, and whether it holds the zero address
 *  (the pool is open to every member). Null when no config says it; null and noted when it is not a list of addresses. */
function allowlistOf(config: Strategy['config'], odd: Odd): { members: string[]; open: boolean } | null {
  if (!config) return null
  const v = config.allowlist
  if (!Array.isArray(v) || v.some(a => typeof a !== 'string' || !isAddress(a))) {
    odd.push(`the allowlist is ${JSON.stringify(v)?.slice(0, 80)}, not a list of addresses`)
    return null
  }
  const all = [...new Set((v as string[]).map(a => checksumAddress(a)))]
  return { members: all.filter(a => a.toLowerCase() !== ZERO), open: all.some(a => a.toLowerCase() === ZERO) }
}

/** `<pool lowercase>-<n>` (the subgraph's proposal id), or null. */
function parseProposalId(id: unknown): { pool: string; number: number } | null {
  const m = typeof id === 'string' ? /^(0x[0-9a-fA-F]{40})-([1-9][0-9]*)$/.exec(id) : null
  if (!m || !isAddress(m[1]) || !Number.isSafeInteger(Number(m[2]))) return null
  return { pool: m[1]!.toLowerCase(), number: Number(m[2]) }
}

/** The pool a system names and its community, read from the subgraph; the read fails in words when there is none or it
 *  is on another chain. */
async function strategyOf<T extends { cvstrategy: Strategy | null }>(system: Record<string, unknown>, ctx: DriverContext, query: string, variables: (pool: string) => Record<string, unknown>) {
  const { chain, name, subgraph } = whereOf(system)
  const pool = addressOf(String(system.address))
  const data = await graphql<T>(ctx, subgraph, query, variables(pool.toLowerCase()))
  const s = data.cvstrategy
  if (!s) throw new Error(`Gardens has no pool ${pool} on ${name}`)
  const rc = s.registryCommunity
  if (!rc || typeof rc.id !== 'string' || !isAddress(rc.id)) throw new Error(`Gardens answered pool ${pool} with no community`)
  sameChain(rc.chainId, chain, name, `pool ${pool}`)
  return { chain, pool, data, s, rc, community: checksumAddress(rc.id), council: rc.councilSafe && isAddress(rc.councilSafe) ? checksumAddress(rc.councilSafe) : null }
}

async function readPool(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
  const { chain, pool, data, s, rc, community, council } = await strategyOf<{ cvstrategy: Strategy | null; cvproposals: ProposalAnswer[] | null }>(
    system, ctx, POOL_QUERY, id => ({ id, strategy: id }))
  const odd: Odd = []
  const poolId = whole(s.poolId, 'the pool id', odd)
  const type = poolType(s.config, 'the pool', odd)
  const listed = allowlistOf(s.config, odd)
  const token = checksumAddress(s.token)

  const proposals = (Array.isArray(data.cvproposals) ? data.cvproposals : []).map(p => {
    const own: Odd = []
    const number = whole(p.proposalNumber, 'a proposal number', own)
    const label = `proposal #${number ?? '?'}`
    const status = statusOf(p.proposalStatus, label, own)
    const requested = units(p.requestedAmount, `${label}'s requested amount`, own)
    const created = p.createdAt === null || p.createdAt === undefined ? null : whole(p.createdAt, `${label}'s creation time`, own)
    const executed = p.executedAt === null || p.executedAt === undefined ? null : whole(p.executedAt, `${label}'s execution time`, own)
    const otherToken = typeof p.requestedToken === 'string' && isAddress(p.requestedToken) && p.requestedToken.toLowerCase() !== ZERO && p.requestedToken.toLowerCase() !== token.toLowerCase()
      ? checksumAddress(p.requestedToken) : null
    const beneficiary = typeof p.beneficiary === 'string' && isAddress(p.beneficiary) && p.beneficiary.toLowerCase() !== ZERO ? caip10(chain, p.beneficiary) : null
    return { id: String(p.id).toLowerCase(), number, label, status, requested, created, executed, otherToken, beneficiary, title: p.metadata?.title ?? '', own,
      conviction: null as string | null, threshold: null as string | null }
  })

  // One batch: the pool's funds, its token, then each active proposal's conviction and (unless the pool only signals) its
  // threshold — all on the pool itself (their facetAddress is 0: CVStrategy's own functions, L2-C5 findings).
  const signaling = type === 'signaling'
  const active = proposals.filter(p => p.status === 'active' && p.number !== null)
  const calls: EthCall[] = [
    { to: pool, data: encodeCall('getPoolAmount()', []) },
    { to: token, data: encodeCall('symbol()', []) }, { to: token, data: encodeCall('decimals()', []) },
  ]
  const at = new Map<(typeof proposals)[number], { conviction: number; threshold: number | null }>()
  for (const p of active) {
    const conviction = calls.push({ to: pool, data: encodeCall('calculateProposalConviction(uint256)', [p.number!]) }) - 1
    const threshold = !signaling && p.requested !== null ? calls.push({ to: pool, data: encodeCall('calculateThreshold(uint256)', [p.requested]) }) - 1 : null
    at.set(p, { conviction, threshold })
  }
  const { results } = await ethCalls(ctx, chain, calls)
  const amount = decoded<string>(results[0]!, `getPoolAmount() on pool ${shortAddress(pool)}`, ['uint256'], odd)
  const symbol = symbolOf(results[1]!, token)
  const decimals = decimalsOf(results[2]!, token, odd)
  for (const [p, i] of at) {
    p.conviction = callAnswer(results[i.conviction]!, `calculateProposalConviction for ${p.label}`, p.own)
    if (i.threshold !== null) {
      p.threshold = callAnswer(results[i.threshold]!, `calculateThreshold for ${p.label}`, p.own)
      // A threshold of 0 is never shown as true: in a pool of known type it is an odd answer; in one of unknown type it
      // cannot be told from "no threshold", so it is the coordinator's attention too, and the fact is null.
      if (p.threshold === '0') { p.own.push(type !== null ? `calculateThreshold for ${p.label} answered 0 in a ${type} pool` : 'threshold 0 for a pool of unknown type'); p.threshold = null }
    }
  }

  const href = gardensAppUrl(chain, community, pool)
  const amountOf = (p: (typeof proposals)[number]): string =>
    signaling ? '' : p.otherToken ? (p.requested === null ? 'unknown' : `${p.requested} base units of ${shortAddress(p.otherToken)}`) : amountCell(p.requested, decimals, symbol)
  const progress = (p: (typeof proposals)[number]): { text: string; ready: boolean } => {
    // A threshold of 0 was noted above as an alert, and nulled.
    if (signaling) return { text: 'no threshold', ready: false }
    if (p.conviction === null || p.threshold === null) return { text: 'unknown', ready: false }
    const c = BigInt(p.conviction), t = BigInt(p.threshold)
    return { text: `${(c * 100n) / t}% of threshold`, ready: c >= t }
  }
  const shown = proposals.filter(p => p.status === 'active' || p.status === null)
  const proposalRows: DriverSection['rows'] = shown.map(p => {
    const { text, ready } = progress(p)
    return {
      cells: [p.number === null ? '#?' : `#${p.number}`, p.title, amountOf(p), p.own.length > 0 ? `${UNEXPECTED}: ${p.own.join('; ')}` : text],
      href, ...(p.beneficiary ? { refs: [p.beneficiary] } : {}), ...(p.own.length > 0 || ready ? { attention: 'alert' as const } : {}),
    }
  })
  const decided = proposals.filter(p => p.status !== null && p.status !== 'active').slice(0, DECIDED_SHOWN)
  // A decided proposal's oddities (its amount, a time) are not on its row: they are said under Pool.
  for (const p of decided) odd.push(...p.own)
  const when = (p: (typeof proposals)[number]) => { const t = p.executed ?? p.created; return t === null ? null : new Date(t * 1000).toISOString() }

  const facts = {
    chain, pool: caip10(chain, pool), poolId, community: caip10(chain, community), councilSafe: council ? caip10(chain, council) : null, type,
    token: caip10(chain, token), amount, symbol, decimals,
    allowlist: listed ? listed.members.map(a => caip10(chain, a)) : null, open: listed ? listed.open : null,
    enabled: s.isEnabled === true, archived: s.archived === true,
    proposals: proposals.map(p => ({
      id: p.id, number: p.number, status: p.status, title: p.title, requested: p.requested, created: p.created, executed: p.executed,
      ...(at.has(p) ? { conviction: p.conviction, ...(p.threshold !== null || !signaling ? { threshold: p.threshold } : {}) } : {}),
    })),
    source: 'unverified' as const,
  }
  const sections: DriverSection[] = [
    { title: 'Proposals', ...(proposalRows.length === 0 ? { note: 'no proposal is active' } : {}), rows: proposalRows },
    { title: 'Pool', note: SOURCE_NOTE, rows: [
      { cells: ['Funds', amountCell(amount, decimals, symbol)] },
      { cells: ['Community', rc.communityName || shortAddress(community)], href: gardensAppUrl(chain, community), refs: [caip10(chain, community)] },
      council ? { cells: ['Admin', `council Safe ${shortAddress(council)}`], refs: [caip10(chain, council)] } : { cells: ['Admin', 'no council Safe'] },
      { cells: ['Allowlist', listed === null ? 'unknown' : listed.open ? 'open to every member' : `${listed.members.length} member${listed.members.length === 1 ? '' : 's'}`] },
      { cells: ['Type', type ?? 'type unknown'] },
      ...oddRows(odd),
    ] },
    { title: 'Decided', rows: decided.map(p => {
      const w = when(p)
      return { cells: [p.number === null ? '#?' : `#${p.number}`, p.title, p.status!, w ? ago(w, ctx.now()) : ''], href }
    }) },
  ]
  return { ok: true, readAt: ctx.now().toISOString(), facts, sections, open: { url: href, embeddable: false } }
}

/** A uint256 answer of one proposal's call: a revert or an answer that does not decode is noted on that proposal. */
function callAnswer(r: CallResult, what: string, own: Odd): string | null {
  if (!r.ok) { own.push(`${what} was refused by the node (${r.error})`); return null }
  return decoded<string>(r, what, ['uint256'], own)
}

/** A refusal: nothing is prepared, said in a sentence. */
class Refusal extends Error {}

async function preparePoolAction(system: Record<string, unknown>, input: ActionInput, ctx: DriverContext): Promise<PreparedAction> {
  const adding = input.action === 'allowlist-add'
  if (!adding && input.action !== 'allowlist-remove') {
    return { ok: false, error: `the gardens-pool driver has no action "${input.action}" (its actions: ${GARDENS_ACTIONS.map(a => a.id).join(', ')})` }
  }
  try {
    const members = [...new Set((input.params.members as string[]).map(a => addressOf(a)))]
    if (members.some(a => a.toLowerCase() === ZERO)) throw new Refusal('the zero address stands for every member; opening or closing a pool is done in the Gardens app')
    const { chain, pool, s, community, council } = await strategyOf<{ cvstrategy: Strategy | null }>(system, ctx, ADMIN_QUERY, id => ({ id }))
    if (!council) throw new Refusal('this pool\'s community has no council Safe, so the platform knows no one who can change its allowlist')
    if (input.via && !sameAccount(input.via.account, caip10(chain, council))) {
      throw new Refusal(`this pool's admin is the council Safe ${shortAddress(council)}, not ${shortAddress(addressOf(input.via.account))}`)
    }
    const odd: Odd = []
    const listed = allowlistOf(s.config, odd)
    if (!listed) throw new Error(`${UNEXPECTED}: ${odd[0] ?? 'the subgraph gives no allowlist for this pool'}`)

    const { results } = await ethCalls(ctx, chain, [
      { to: pool, data: encodeCall('superfluidToken()', []) },
      { to: pool, data: encodeCall('facetAddress(bytes4)', [SET_POOL_PARAMS_SELECTOR]) },
    ])
    // A pool whose diamond does not route 0xd5b7cc54 (or has no loupe to ask) is not one the platform knows how to change.
    const facet = results[1]!.ok ? decoded<string>(results[1]!, `facetAddress(${SET_POOL_PARAMS_SELECTOR}) on pool ${shortAddress(pool)}`, ['address'], odd) : ZERO
    const superfluid = decoded<string>(results[0]!, `superfluidToken() on pool ${shortAddress(pool)}`, ['address'], odd)
    if (odd.length > 0) throw new Error(`${UNEXPECTED}: ${odd.join('; ')}`)
    if (facet!.toLowerCase() === ZERO) throw new Refusal('this pool\'s contract has no setPoolParams the platform knows; change the allowlist in the Gardens app')

    const on = new Set(listed.members.map(a => a.toLowerCase()))
    const names = (list: string[]) => list.map(shortAddress).join(', ')
    const be = (list: string[]) => (list.length === 1 ? 'is' : 'are')
    if (adding) {
      // Adding anyone revokes the open entry (_addToAllowList): the pool would close to everyone else (Review Focus 5).
      if (listed.open) throw new Refusal('this pool is open to every member; adding names closes it — do that in the Gardens app')
      const already = members.filter(a => on.has(a.toLowerCase()))
      if (already.length > 0) throw new Refusal(`${names(already)} ${be(already)} already on this pool's allowlist`)
    } else {
      const missing = members.filter(a => !on.has(a.toLowerCase()))
      if (missing.length > 0) throw new Refusal(`${names(missing)} ${be(missing)} not on this pool's allowlist`)
      // Emptying the list does not re-open the pool (the source leaves that to the app): no one could stake (Review Focus 5).
      if (!listed.open && listed.members.length === members.length) throw new Refusal('removing every member leaves no one on this pool\'s allowlist; change it in the Gardens app')
    }

    const poolId = whole(s.poolId, 'the pool id', [])
    const name = poolId === null ? `pool ${shortAddress(pool)}` : `pool #${poolId}`
    // Zero configs and a zero sybil threshold leave them as they are; the Superfluid token is set unconditionally, so the
    // current one is passed back (★ Q-L2-5).
    const data = encodeCall(SET_POOL_PARAMS, [[ZERO, ZERO, 0, 0, 0, 0], [0, 0, 0, 0], 0, adding ? members : [], adding ? [] : members, superfluid!])
    const call: Call = {
      chain, to: caip10(chain, pool), value: '0', data, operation: 0,
      summary: adding ? `add ${names(members)} to the allowlist of ${name}` : `remove ${names(members)} from the allowlist of ${name}; their stake in this pool is withdrawn`,
    }
    // The council Safe signs; the reader wraps the call in its Safe transaction when `via` is that Safe (and attaches it).
    return { ok: true, action: input.action, steps: [{ call, signer: { kind: 'safe', account: caip10(chain, council) }, safe: null }], draft: null,
      link: gardensAppUrl(chain, community, pool), attach: null }
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, error: err.message }
    throw err
  }
}

/** The outcome of a Gardens proposal: executed, cancelled or rejected (failed), else pending with its status. */
async function poolOutcome(system: Record<string, unknown>, ref: OutcomeRef, ctx: DriverContext & { opened: string }): Promise<OutcomeReading> {
  if (!isForeignRef(ref) || ref.payload.kind !== 'gardens-proposal') {
    throw new Error('a Gardens pool reads gardens-proposal refs, not a Safe transaction or another system\'s ref')
  }
  const { subgraph } = whereOf(system)
  const pool = addressOf(String(system.address))
  const id = parseProposalId(ref.id)
  if (!id) return { ok: false, error: `${JSON.stringify(ref.id)} is not a Gardens proposal id (<pool address>-<number>)` }
  if (id.pool !== pool.toLowerCase()) return { ok: true, outcome: 'mismatch', detail: `${ref.id.toLowerCase()} is a proposal of pool ${shortAddress(checksumAddress(id.pool))}, not this one` }
  const data = await graphql<{ cvproposal: (ProposalAnswer & { strategy?: { id?: unknown } | null }) | null }>(ctx, subgraph, PROPOSAL_QUERY, { id: `${id.pool}-${id.number}` })
  const p = data.cvproposal
  const label = `proposal #${id.number}`
  if (!p) return { ok: true, outcome: 'pending', detail: `Gardens shows no ${label} in this pool yet`, submitted: false }
  const of = typeof p.strategy?.id === 'string' && isAddress(p.strategy.id) ? checksumAddress(p.strategy.id) : null
  // A pool Gardens does not name is an answer that does not fit (attention), not a fact to record as a mismatch.
  if (!of) return { ok: false, error: `${UNEXPECTED}: ${label} names no pool (its strategy.id is missing or not an address)` }
  if (of.toLowerCase() !== pool.toLowerCase()) return { ok: true, outcome: 'mismatch', detail: `${label} is of pool ${shortAddress(of)}, not this one` }
  const odd: Odd = []
  const number = whole(p.proposalNumber, `${label}'s number`, odd)
  const status = statusOf(p.proposalStatus, label, odd)
  const created = whole(p.createdAt, `${label}'s creation time`, odd)
  if (odd.length > 0) return { ok: false, error: `${UNEXPECTED}: ${odd.join('; ')}` }
  if (number !== id.number) return { ok: true, outcome: 'mismatch', detail: `Gardens answered proposal #${number} for ${label}` }
  const opened = Date.parse(ctx.opened)
  if (!Number.isNaN(opened) && created! * 1000 < opened) return { ok: true, outcome: 'mismatch', detail: `${label} was made before this proposal opened; attach one made for it` }
  if (status === 'executed') return { ok: true, outcome: 'executed', detail: `${label} executed` }
  if (status === 'cancelled' || status === 'rejected') return { ok: true, outcome: 'failed', detail: `${label} ${status}` }
  return { ok: true, outcome: 'pending', detail: `${label} is ${status}` }
}

/** The ref an author attaches, checked with no network: this system, a proposal of this pool (`<pool>-<n>`, n ≥ 1). */
function checkPoolRef(system: Record<string, unknown>, raw: unknown): { ok: true; ref: ForeignRef } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  let pool: string
  try { pool = addressOf(String(system.address)) } catch { return bad(`the pool ${JSON.stringify(system.address)} is not an address`) }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('a Gardens ref is {"system", "id", "payload": {"kind": "gardens-proposal"}}')
  const r = raw as Record<string, unknown>
  const systemId = String(system.id)
  if (r.system !== systemId) return bad(`"system" is ${JSON.stringify(r.system)}; this pool is ${JSON.stringify(systemId)}`)
  const id = parseProposalId(r.id)
  if (!id) return bad(`${JSON.stringify(r.id)} is not a Gardens proposal id (<pool address>-<number from 1>, like ${pool.toLowerCase()}-1)`)
  if (id.pool !== pool.toLowerCase()) return bad(`${id.pool}-${id.number} is a proposal of pool ${shortAddress(checksumAddress(id.pool))}, not this one`)
  const payload = typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : null
  if (payload?.kind !== 'gardens-proposal') return bad(`a Gardens pool attaches a gardens-proposal payload, not ${JSON.stringify(payload?.kind)}`)
  return { ok: true, ref: { system: systemId, id: `${id.pool}-${id.number}`, payload: { kind: 'gardens-proposal' } } }
}

export const gardensPool: Driver = {
  name: 'gardens-pool',
  hosts: HOSTS,
  minGapMs: gardensCommunity.minGapMs,
  read: readPool,
  actions: GARDENS_ACTIONS,
  prepareAction: preparePoolAction,
  outcome: poolOutcome,
  checkRef: checkPoolRef,
}
