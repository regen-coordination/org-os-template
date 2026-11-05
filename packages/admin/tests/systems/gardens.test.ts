import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gardensCommunity, gardensPool, gardensAppUrl, GARDENS_ACTIONS, GARDENS_SUBGRAPHS, POOL_TYPES, PROPOSAL_STATUS, SET_POOL_PARAMS, SOURCE_NOTE, UNEXPECTED } from '../../server/systems/gardens.ts'
import { guardedPost, readOnlyBody, type DriverContext, type FetchLike, type ForeignRef } from '../../server/systems/driver.ts'
import { DRIVERS } from '../../server/systems/drivers.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { safe } from '../../server/systems/safe.ts'
import { checksumAddress } from '../../lib/caip.mjs'
import { safeTxHash } from '../../lib/safe-tx.mjs'
import { CHAINS } from '../../server/systems/chains.ts'
import { encodeArgs, encodeCall, selector } from '../../lib/abi.mjs'

// Synthetic fixtures in the exact shapes Gardens v2's subgraph (Graph Studio) and the pools answered on 2026-10-29
// (see tests/systems/fixtures/gardens-celo/). The subgraph's numbers come back as JSON strings.
// Selectors: https://github.com/1Hive/gardens-v2/blob/68cd18d8ace3cec4a5715c6d00f9a85369816033/pkg/contracts/src/CVStrategy/CVStrategy.sol
// (getPoolAmount()), and the ERC-20 symbol()/decimals() selectors 0x95d89b41 / 0x313ce567 (https://eips.ethereum.org/EIPS/eip-20).
const DIR = new URL('./fixtures/gardens-celo/', import.meta.url)
const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as T
const COMMUNITY = '0x6A4de0000000000000000000000000000000C0De'
const SAFE = '0x5aFE00000000000000000000000000000000C0De'
const POOL1 = '0x0000000000000000000000000000000000000001'
const POOL2 = '0x0000000000000000000000000000000000000002'
const TOKEN = '0x00000000000000000000000000000000000006C0'
const NOW = new Date('2026-10-29T12:00:00Z')
const SYSTEM = { id: 'gardens', kind: 'gardens-community', chain: 'eip155:42220', address: COMMUNITY.toLowerCase(), driver: 'gardens-community' }
const CELO_RPC = `https://${CHAINS['eip155:42220'].rpc}/`

type Seen = { url: string; body: any }
function world(over: { community?: unknown; graphqlAnswer?: unknown } = {}) {
  const seen: Seen[] = []
  const calls = load<Record<string, string>>('calls.json')
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body!)
    seen.push({ url, body })
    let answer: unknown
    if (typeof body.query === 'string') answer = over.graphqlAnswer ?? { data: over.community ?? load('community.json') }
    else answer = body.map((r: any) => r.method === 'eth_blockNumber'
      ? { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
      : { jsonrpc: '2.0', id: r.id, result: calls[`${r.params[0].to.toLowerCase()}:${r.params[0].data.slice(0, 10)}`] })
    return { ok: true, status: 200, json: async () => answer }
  }
  const ctx = (): DriverContext => ({
    fetchJson: async () => { throw new Error('no GET') },
    postJson: guardedPost(gardensCommunity, fetch, new AbortController().signal),
    rpcUrl: chain => CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null,
    now: () => NOW, members: [],
  })
  return { seen, ctx }
}

describe('the gardens-community driver', () => {
  it('declares its hosts: Graph Studio and the RPC hosts of the chains it has subgraphs for', () => {
    expect(gardensCommunity.name).toBe('gardens-community')
    expect(gardensCommunity.minGapMs).toBe(500)
    expect(gardensCommunity.hosts).toContain('api.studio.thegraph.com')
    for (const chain of Object.keys(GARDENS_SUBGRAPHS)) expect(gardensCommunity.hosts).toContain(CHAINS[chain].rpc)
    expect(gardensCommunity.hosts).not.toContain(CHAINS['eip155:1'].rpc)
    expect([...POOL_TYPES]).toEqual(['signaling', 'funding', 'streaming'])
  })

  it('makes one GraphQL POST, then one RPC POST, and nothing else', async () => {
    const { seen, ctx } = world()
    await gardensCommunity.read(SYSTEM, ctx())
    expect(seen).toHaveLength(2)
    expect(seen[0].url).toBe(GARDENS_SUBGRAPHS['eip155:42220'])
    expect(seen[0].body.query).toContain('registryCommunity')
    expect(seen[0].body.variables ?? seen[0].body.query).toBeTruthy()
    expect(JSON.stringify(seen[0].body)).toContain(COMMUNITY.toLowerCase())
    expect(seen[1].url).toBe(CELO_RPC)
    // eth_blockNumber, getPoolAmount x2, symbol, decimals
    expect(seen[1].body.map((r: any) => r.method)).toEqual(['eth_blockNumber', 'eth_call', 'eth_call', 'eth_call', 'eth_call'])
    expect(seen[1].body.slice(1, 3).map((r: any) => r.params[0].data)).toEqual(['0x4ab4ba42', '0x4ab4ba42'])
  })

  it('reads the community: every address CAIP-10, amounts in base units', async () => {
    const { ctx } = world()
    const read = await gardensCommunity.read(SYSTEM, ctx())
    expect(read.ok).toBe(true)
    expect(read.readAt).toBe(NOW.toISOString())
    expect(read.facts).toEqual({
      chain: 'eip155:42220', community: `eip155:42220:${COMMUNITY}`, name: 'Synthetic Commons',
      councilSafe: `eip155:42220:${SAFE}`, members: 9,
      garden: { token: `eip155:42220:${TOKEN}`, symbol: 'USDGLO', decimals: 18 },
      pools: [
        { id: `eip155:42220:${POOL1}`, poolId: 48, title: 'Fund one', type: 'funding', token: `eip155:42220:${TOKEN}`, amount: '1270570000000000000000', symbol: 'USDGLO', decimals: 18, enabled: true, archived: false },
        { id: `eip155:42220:${POOL2}`, poolId: 49, title: 'Fund two', type: 'funding', token: `eip155:42220:${TOKEN}`, amount: '300000000000000000000', symbol: 'USDGLO', decimals: 18, enabled: true, archived: false },
      ],
      source: 'unverified',
    })
    expect(read.open).toEqual({ url: `https://app.gardens.fund/gardens/42220/${COMMUNITY.toLowerCase()}`, embeddable: false })
  })

  it('shows the pools and the council as sections', async () => {
    const { ctx } = world()
    const read = await gardensCommunity.read(SYSTEM, ctx())
    const [pools, council] = read.sections
    expect(pools.title).toBe('Pools')
    expect(pools.note).toBe(SOURCE_NOTE)
    expect(pools.rows).toEqual([
      { cells: ['Fund one', '#48', '1270.57 USDGLO', 'funding', ''], href: gardensAppUrl('eip155:42220', COMMUNITY, POOL1), refs: [`eip155:42220:${POOL1}`] },
      { cells: ['Fund two', '#49', '300 USDGLO', 'funding', ''], href: gardensAppUrl('eip155:42220', COMMUNITY, POOL2), refs: [`eip155:42220:${POOL2}`] },
    ])
    expect(council.title).toBe('Council')
    expect(council.rows).toEqual([
      { cells: ['Council Safe', '0x5aFE…C0De'], refs: [`eip155:42220:${SAFE}`] },
      { cells: ['Members', '9'] },
    ])
  })

  it('app links end at the community, then the pool', () => {
    expect(gardensAppUrl('eip155:42220', COMMUNITY)).toBe(`https://app.gardens.fund/gardens/42220/${COMMUNITY.toLowerCase()}`)
    expect(gardensAppUrl('eip155:42220', COMMUNITY, POOL1)).toBe(`https://app.gardens.fund/gardens/42220/${COMMUNITY.toLowerCase()}/${POOL1}`)
  })

  it('a disabled pool says so', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.strategies[1].isEnabled = false
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.sections[0].rows[1].cells[4]).toBe('disabled')
    expect((read.facts.pools as any[])[1].enabled).toBe(false)
  })

  it('a pending council change is a warn row', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.pendingNewCouncilSafe = '0x00000000000000000000000000000000000000b1'
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.sections[1].rows.at(-1)).toEqual({
      cells: ['Council Safe change waiting', '0x0000…00B1'], attention: 'warn', refs: ['eip155:42220:0x00000000000000000000000000000000000000B1'],
    })
  })

  it('a community with no council Safe has councilSafe null', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.councilSafe = null
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.facts.councilSafe).toBeNull()
  })

  it('a chain with no subgraph fails with a sentence, before any request', async () => {
    const { seen, ctx } = world()
    // C12 (Q66): the sentences say the Hub
    await expect(gardensCommunity.read({ ...SYSTEM, chain: 'eip155:1' }, ctx())).rejects.toThrow('Gardens has no subgraph for Ethereum (eip155:1) that this Hub reads')
    await expect(gardensCommunity.read({ ...SYSTEM, chain: 'eip155:999999' }, ctx())).rejects.toThrow('Gardens is read on chains this Hub knows; eip155:999999 is not one of them')
    expect(seen).toEqual([])
  })

  it('a missing community is a failed read with its sentence', async () => {
    const { seen, ctx } = world({ community: { registryCommunity: null } })
    await expect(gardensCommunity.read(SYSTEM, ctx())).rejects.toThrow(`Gardens has no community ${COMMUNITY} on Celo`)
    expect(seen).toHaveLength(1)
  })

  it('GraphQL errors beside data fail the read', async () => {
    const { seen, ctx } = world({ graphqlAnswer: { data: load('community.json'), errors: [{ message: 'indexing_error' }] } })
    await expect(gardensCommunity.read(SYSTEM, ctx())).rejects.toThrow(/indexing_error/)
    expect(seen).toHaveLength(1)
  })

  it('a pool whose amount call reverted fails the read rather than showing zero', async () => {
    const { ctx } = world()
    const c = ctx()
    const post = c.postJson!
    c.postJson = async (url, body) => {
      const a = (await post(url, body)) as any
      if (Array.isArray(a)) a[1] = { jsonrpc: '2.0', id: 1, error: { message: 'execution reverted' } }
      return a
    }
    await expect(gardensCommunity.read(SYSTEM, c)).rejects.toThrow(/getPoolAmount/)
  })
})

// Task 10's review (folded into Task 11) and the coordinator's ruling on Q-L2-5: what does not fit is said, never shown as true.
describe('the gardens-community driver, when the answers do not fit', () => {
  const unexpected = (read: Awaited<ReturnType<typeof gardensCommunity.read>>) =>
    read.sections.flatMap(s => s.rows).filter(r => r.attention === 'alert').map(r => r.cells.join(' '))

  it('says the source is unverified, in the facts and a plain note', async () => {
    expect(SOURCE_NOTE).toBe("the deployed contract's source is not verified on the explorer; the platform reads it by the 68cd18d interface")
    expect(UNEXPECTED).toBe('Gardens contract did not answer as expected')
  })

  it('a pool with no config says its type is unknown, without attention', async () => {
    const community = load<any>('community.json')
    delete community.registryCommunity.strategies[0].config
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.sections[0].rows[0].cells[3]).toBe('type unknown')
    expect(read.sections[0].rows[0].attention).toBeUndefined()
    expect((read.facts.pools as any[])[0].type).toBeNull()
    expect(unexpected(read)).toEqual([])
  })

  it('a type outside POOL_TYPES or a non-number is an alert, never a guess', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.strategies[0].config.proposalType = '7'
    community.registryCommunity.strategies[1].config.proposalType = 'funding'
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.sections[0].rows.slice(0, 2).map(r => r.cells[3])).toEqual(['type unknown', 'type unknown'])
    const alerts = unexpected(read)
    expect(alerts).toHaveLength(2)
    for (const a of alerts) expect(a.startsWith(UNEXPECTED)).toBe(true)
    expect(alerts[0]).toContain('7')
    expect(alerts[1]).toContain('"funding"')
  })

  it('a null garden is a sentence, not a TypeError', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.garden = null
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.ok).toBe(true)
    expect(read.facts.garden).toBeNull()
    expect(unexpected(read)).toEqual([`${UNEXPECTED} the community has no garden token`])
  })

  it('a subgraph on another chain is a failed read in words', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.chainId = '10'
    await expect(gardensCommunity.read(SYSTEM, world({ community }).ctx())).rejects.toThrow(`Gardens answered community ${COMMUNITY} as being on chain "10", not Celo (42220)`)
    delete community.registryCommunity.chainId
    await expect(gardensCommunity.read(SYSTEM, world({ community }).ctx())).rejects.toThrow(/as being on chain undefined, not Celo \(42220\)/)
  })

  it('a long token symbol is cut to 12 characters in cells, kept whole in the facts', async () => {
    const { ctx } = world()
    const c = ctx()
    const post = c.postJson!
    const long = 'VERYLONGSYMBOLTOKEN'
    c.postJson = async (url, body) => {
      const a = (await post(url, body)) as any
      if (Array.isArray(a)) a[3] = { ...a[3], result: '0x' + encodeArgs(['string'], [long]).slice(2) }
      return a
    }
    const read = await gardensCommunity.read(SYSTEM, c)
    expect(read.sections[0].rows[0].cells[2]).toBe('1270.57 VERYLONGSYM…')
    expect('VERYLONGSYM…').toHaveLength(12)
    expect((read.facts.pools as any[])[0].symbol).toBe(long)
  })

  it('an archived pool is shown, marked archived', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.strategies[1].archived = true
    community.registryCommunity.strategies[1].isEnabled = false
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.sections[0].rows[1].cells[4]).toBe('disabled, archived')
    expect((read.facts.pools as any[])[1].archived).toBe(true)
  })

  it('a garbled getPoolAmount answer is an alert, the amount unknown, the read still ok', async () => {
    const { ctx } = world()
    const c = ctx()
    const post = c.postJson!
    c.postJson = async (url, body) => {
      const a = (await post(url, body)) as any
      if (Array.isArray(a)) a[1] = { ...a[1], result: '0x1234' }
      return a
    }
    const read = await gardensCommunity.read(SYSTEM, c)
    expect(read.ok).toBe(true)
    expect(read.sections[0].rows[0].cells[2]).toBe('unknown')
    expect((read.facts.pools as any[])[0].amount).toBeNull()
    expect(unexpected(read)).toEqual([`${UNEXPECTED} getPoolAmount() on pool 0x0000…0001 answered 0x1234, not a uint256`])
  })

  it('decimals above 77 are an alert, every amount unknown', async () => {
    const { ctx } = world()
    const c = ctx()
    const post = c.postJson!
    c.postJson = async (url, body) => {
      const a = (await post(url, body)) as any
      if (Array.isArray(a)) a[4] = { ...a[4], result: '0x' + (200).toString(16).padStart(64, '0') }
      return a
    }
    const read = await gardensCommunity.read(SYSTEM, c)
    expect(read.sections[0].rows.slice(0, 2).map(r => r.cells[2])).toEqual(['unknown', 'unknown'])
    expect((read.facts.pools as any[])[0].decimals).toBeNull()
    expect(unexpected(read)).toEqual([`${UNEXPECTED} decimals() on token 0x0000…06C0 answered 200, more than 77`])
  })

  it('a member count that is not a number is an alert, never shown as a count', async () => {
    const community = load<any>('community.json')
    community.registryCommunity.membersCount = 'nine'
    const read = await gardensCommunity.read(SYSTEM, world({ community }).ctx())
    expect(read.facts.members).toBeNull()
    expect(read.sections[1].rows[1]).toEqual({ cells: ['Members', 'unknown'] })
    expect(unexpected(read)).toEqual([`${UNEXPECTED} the member count is "nine", not a whole number`])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The gardens-pool driver (Task 11). Synthetic fixtures in Example DAO's recorded shape (2026-10-29): a funding pool,
// pointSystem 0, an allowlist of nine (…a1–…a8 and the council Safe), one executed proposal of 1500 tokens.
// ProposalStatus: https://github.com/1Hive/gardens-v2/blob/68cd18d8ace3cec4a5715c6d00f9a85369816033/pkg/contracts/src/CVStrategy/ICVStrategy.sol
// setPoolParams (6 arguments, selector 0xd5b7cc54, onlyCouncilSafe; zero configs and a zero sybil threshold leave them as
// they are; the Superfluid token is set unconditionally; a removed member's points are deactivated):
// https://github.com/1Hive/gardens-v2/blob/68cd18d8ace3cec4a5715c6d00f9a85369816033/pkg/contracts/src/CVStrategy/facets/CVAdminFacet.sol
// (L62, L201–262). calculateThreshold 0x59a5db8b, calculateProposalConviction 0x60b0645a, getPoolAmount 0x4ab4ba42 and
// superfluidToken 0x05caa7f3 are CVStrategy's own (CVStrategy.sol L649, L660, L884), called on the pool; facetAddress
// 0xcdffacc6 is the diamond loupe's (EIP-2535, https://eips.ethereum.org/EIPS/eip-2535).
// ---------------------------------------------------------------------------------------------------------------------
const CELO = 'eip155:42220'
const POOL = POOL1
const POOL_SYSTEM = { id: 'fund-one', kind: 'gardens-pool', chain: CELO, address: POOL.toLowerCase(), driver: 'gardens-pool' }
const VIA = { id: 'council', kind: 'safe', name: 'Council', chain: CELO, address: SAFE, driver: 'safe' }
const OTHER_SAFE = { id: 'other', kind: 'safe', name: 'Other', chain: CELO, address: '0x5afe0000000000000000000000000000000000b0', driver: 'safe' }
const Z = '0x0000000000000000000000000000000000000000'
const SUPERFLUID = '0x0000000000000000000000000000000000005f00'
const M = (n: number) => checksumAddress(`0x${'0'.repeat(38)}a${n}`)
const treasury = { proposal: { classes: ['treasury'] } }
const safeInfo = (JSON.parse(readFileSync(new URL('./fixtures/safe-chains/celo.json', import.meta.url), 'utf8')) as { info: unknown }).info

function poolWorld(over: { pool?: unknown; proposal?: unknown; calls?: Record<string, string | null> } = {}) {
  const seen: { method: 'GET' | 'POST'; url: string; body?: any }[] = []
  const calls: Record<string, string | null> = { ...load<Record<string, string>>('calls.json'), ...over.calls }
  const fetch: FetchLike = async (url, init) => {
    if (init.method === 'GET') {
      seen.push({ method: 'GET', url })
      return url === `https://api.safe.global/tx-service/celo/api/v1/safes/${SAFE}/`
        ? { ok: true, status: 200, json: async () => safeInfo } : { ok: false, status: 404, json: async () => ({}) }
    }
    const body = JSON.parse(init.body!)
    seen.push({ method: 'POST', url, body })
    let answer: unknown
    if (typeof body.query === 'string') {
      answer = { data: body.query.includes('cvproposal(') ? (over.proposal === undefined ? load('proposal-1.json') : over.proposal) : (over.pool ?? load('pool.json')) }
    } else {
      answer = [...body].reverse().map((r: any) => {
        if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
        const to = r.params[0].to.toLowerCase(), data = r.params[0].data
        const key = Object.hasOwn(calls, `${to}:${data}`) ? `${to}:${data}` : `${to}:${data.slice(0, 10)}`
        const hit = calls[key]
        return hit == null ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: hit }
      })
    }
    return { ok: true, status: 200, json: async () => answer }
  }
  const ctx = (): DriverContext => ({
    fetchJson: async () => { throw new Error('no GET') },
    postJson: guardedPost(gardensPool, fetch, new AbortController().signal),
    rpcUrl: chain => CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null,
    now: () => NOW, members: [],
  })
  const reader = () => new SystemReader({ repo: '/nonexistent', fetch, drivers: [{ ...gardensPool, minGapMs: 0 }, { ...safe, minGapMs: 0 }], now: () => NOW, sleep: async () => {} })
  const prepare = (action: string, params: Record<string, unknown>, via: typeof VIA | null = null, proposal = treasury) =>
    reader().prepareAction(POOL_SYSTEM, { ...proposal, action, params }, via)
  return { seen, ctx, prepare, posts: () => seen.filter(s => s.method === 'POST'), gets: () => seen.filter(s => s.method === 'GET') }
}
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`); return r as Extract<T, { ok: true }> }
const refused = <T extends { ok: boolean }>(r: T): string => { if (r.ok) throw new Error(`expected a refusal: ${JSON.stringify(r)}`); return (r as unknown as { error: string }).error }
const short = (a: string) => { const c = checksumAddress(a); return `${c.slice(0, 6)}…${c.slice(-4)}` }

describe('the gardens-pool driver: what it is', () => {
  it('has the same hosts and gap as the community driver, and is installed', () => {
    expect(gardensPool.name).toBe('gardens-pool')
    expect(gardensPool.hosts).toEqual(gardensCommunity.hosts)
    expect(gardensPool.minGapMs).toBe(gardensCommunity.minGapMs)
    expect(DRIVERS.map(d => d.name)).toContain('gardens-pool')
  })
  it('names the proposal statuses of ICVStrategy.sol @ 68cd18d, in order', () => {
    expect([...PROPOSAL_STATUS]).toEqual(['inactive', 'active', 'paused', 'cancelled', 'executed', 'disputed', 'rejected'])
  })
  it('prepares two allowlist actions of class treasury (ruling K1), each taking a list of addresses', () => {
    expect(gardensPool.actions).toBe(GARDENS_ACTIONS)
    expect(GARDENS_ACTIONS.map(a => [a.id, a.class, a.params.map(p => `${p.name}:${p.type}`).join()])).toEqual([
      ['allowlist-add', 'treasury', 'members:addresses'], ['allowlist-remove', 'treasury', 'members:addresses'],
    ])
  })
  it('setPoolParams is the 6-argument overload, selector 0xd5b7cc54 (L2-C5 findings, cast sig)', () => {
    expect(SET_POOL_PARAMS).toBe('setPoolParams((address,address,uint256,uint256,uint256,uint256),(uint256,uint256,uint256,uint256),uint256,address[],address[],address)')
    expect(selector(SET_POOL_PARAMS)).toBe('0xd5b7cc54')
  })
})

describe('the gardens-pool driver: a read', () => {
  it('reads proposals and conviction: one GraphQL POST, one RPC POST, both reads', async () => {
    const w = poolWorld()
    const read = await gardensPool.read(POOL_SYSTEM, w.ctx())
    expect(read.ok).toBe(true)
    expect(w.seen.map(s => s.url)).toEqual([GARDENS_SUBGRAPHS[CELO], CELO_RPC])
    for (const s of w.seen) expect(readOnlyBody(s.body)).toBeNull()
    expect(w.seen[0]!.body.query).toContain('cvstrategy(id: $id)')
    expect(w.seen[0]!.body.query).toContain('cvproposals(first: 25')
    expect(w.seen[0]!.body.variables).toEqual({ id: POOL.toLowerCase(), strategy: POOL.toLowerCase() })
    // eth_blockNumber; getPoolAmount, symbol, decimals; then conviction and threshold of #3 and #2 (the active ones)
    expect(w.seen[1]!.body.map((r: any) => `${r.params[0]?.to ?? ''}:${r.params[0]?.data.slice(0, 10) ?? r.method}`)).toEqual([
      ':eth_blockNumber', `${POOL}:0x4ab4ba42`, `${TOKEN}:0x95d89b41`, `${TOKEN}:0x313ce567`,
      `${POOL}:0x60b0645a`, `${POOL}:0x59a5db8b`, `${POOL}:0x60b0645a`, `${POOL}:0x59a5db8b`,
    ])
    const [proposals, pool, decided] = read.sections
    expect(proposals.title).toBe('Proposals')
    const href = gardensAppUrl(CELO, COMMUNITY, POOL)
    expect(proposals.rows).toEqual([
      { cells: ['#3', 'Seed library', '100 USDGLO', '50% of threshold'], href, refs: [`${CELO}:${checksumAddress('0x00000000000000000000000000000000000000b3')}`] },
      { cells: ['#2', 'Water tanks', '200 USDGLO', '104% of threshold'], href, refs: [`${CELO}:${checksumAddress('0x00000000000000000000000000000000000000b2')}`], attention: 'alert' },
    ])
    expect(pool.title).toBe('Pool')
    expect(pool.note).toBe(SOURCE_NOTE)
    expect(pool.rows).toEqual([
      { cells: ['Funds', '1270.57 USDGLO'] },
      { cells: ['Community', 'Synthetic Commons'], href: gardensAppUrl(CELO, COMMUNITY), refs: [`${CELO}:${COMMUNITY}`] },
      { cells: ['Admin', 'council Safe 0x5aFE…C0De'], refs: [`${CELO}:${SAFE}`] },
      { cells: ['Allowlist', '9 members'] },
      { cells: ['Type', 'funding'] },
    ])
    expect(decided.title).toBe('Decided')
    expect(decided.rows).toEqual([{ cells: ['#1', 'Shared tools', 'executed', '44 d'], href }])
    expect(read.open).toEqual({ url: href, embeddable: false })
  })

  it('facts: every address CAIP-10, amounts in base units, the source unverified', async () => {
    const read = await gardensPool.read(POOL_SYSTEM, poolWorld().ctx())
    expect(read.facts).toEqual({
      chain: CELO, pool: `${CELO}:${POOL}`, poolId: 48, community: `${CELO}:${COMMUNITY}`, councilSafe: `${CELO}:${SAFE}`, type: 'funding',
      token: `${CELO}:${TOKEN}`, amount: '1270570000000000000000', symbol: 'USDGLO', decimals: 18,
      allowlist: [1, 2, 3, 4, 5, 6, 7, 8].map(n => `${CELO}:${M(n)}`).concat(`${CELO}:${SAFE}`), open: false,
      enabled: true, archived: false,
      proposals: [
        { id: `${POOL.toLowerCase()}-3`, number: 3, status: 'active', title: 'Seed library', requested: '100000000000000000000', conviction: '500', threshold: '1000', created: 1792922400, executed: null },
        { id: `${POOL.toLowerCase()}-2`, number: 2, status: 'active', title: 'Water tanks', requested: '200000000000000000000', conviction: '1040', threshold: '1000', created: 1792490400, executed: null },
        { id: `${POOL.toLowerCase()}-1`, number: 1, status: 'executed', title: 'Shared tools', requested: '1500000000000000000000', created: 1788256800, executed: 1789466400 },
      ],
      source: 'unverified',
    })
  })

  it('an open pool says so', async () => {
    const read = await gardensPool.read(POOL_SYSTEM, poolWorld({ pool: load('pool-open.json') }).ctx())
    expect(read.facts.open).toBe(true)
    expect(read.facts.allowlist).toEqual([])
    expect(read.sections[1].rows[3]).toEqual({ cells: ['Allowlist', 'open to every member'] })
  })

  it('a signaling pool has no threshold, and none is asked', async () => {
    const pool = load<any>('pool.json')
    pool.cvstrategy.config.proposalType = '0'
    const w = poolWorld({ pool })
    const read = await gardensPool.read(POOL_SYSTEM, w.ctx())
    expect(read.sections[0].rows.map(r => [r.cells[3], r.attention])).toEqual([['no threshold', undefined], ['no threshold', undefined]])
    expect(w.seen[1]!.body.filter((r: any) => r.params[0]?.data.startsWith('0x59a5db8b'))).toEqual([])
  })

  it('the Decided list keeps the latest five', async () => {
    const pool = load<any>('pool.json')
    const one = pool.cvproposals[2]
    pool.cvproposals = [pool.cvproposals[0], ...[9, 8, 7, 6, 5, 4].map(n => ({ ...one, id: `${POOL.toLowerCase()}-${n}`, proposalNumber: String(n), proposalStatus: n % 2 ? '3' : '6' }))]
    const read = await gardensPool.read(POOL_SYSTEM, poolWorld({ pool }).ctx())
    expect(read.sections[2].rows.map(r => `${r.cells[0]} ${r.cells[2]}`)).toEqual(['#9 cancelled', '#8 rejected', '#7 cancelled', '#6 rejected', '#5 cancelled'])
  })

  it('a missing pool, a pool of another chain: failed reads in words', async () => {
    await expect(gardensPool.read(POOL_SYSTEM, poolWorld({ pool: { cvstrategy: null, cvproposals: [] } }).ctx())).rejects.toThrow(`Gardens has no pool ${POOL} on Celo`)
    const pool = load<any>('pool.json')
    pool.cvstrategy.registryCommunity.chainId = '10'
    await expect(gardensPool.read(POOL_SYSTEM, poolWorld({ pool }).ctx())).rejects.toThrow(`Gardens answered pool ${POOL} as being on chain "10", not Celo (42220)`)
  })
})

describe('the gardens-pool driver: answers that do not fit (coordinator ruling on Q-L2-5)', () => {
  const alerts = (read: Awaited<ReturnType<typeof gardensPool.read>>) =>
    read.sections.flatMap(s => s.rows).filter(r => r.attention === 'alert').map(r => r.cells.join(' | '))

  it('a garbled getPoolAmount answer is an alert, the funds unknown, never zero', async () => {
    const read = await gardensPool.read(POOL_SYSTEM, poolWorld({ calls: { [`${POOL.toLowerCase()}:0x4ab4ba42`]: '0x00ff' } }).ctx())
    expect(read.ok).toBe(true)
    expect(read.facts.amount).toBeNull()
    expect(read.sections[1].rows[0]).toEqual({ cells: ['Funds', 'unknown'] })
    expect(alerts(read)).toContain(`${UNEXPECTED} | getPoolAmount() on pool 0x0000…0001 answered 0x00ff, not a uint256`)
  })

  it('a proposal status outside PROPOSAL_STATUS is an alert row, never placed under Decided', async () => {
    const pool = load<any>('pool.json')
    pool.cvproposals[2].proposalStatus = '9'
    const read = await gardensPool.read(POOL_SYSTEM, poolWorld({ pool }).ctx())
    expect(read.sections[2].rows).toEqual([])
    const row = read.sections[0].rows.find(r => r.cells[0] === '#1')!
    expect(row.attention).toBe('alert')
    expect(row.cells[3]).toBe(`${UNEXPECTED}: proposal #1's status is "9", not one of 0–6 (${PROPOSAL_STATUS.join(', ')})`)
    expect((read.facts.proposals as any[])[2].status).toBeNull()
  })

  it('a threshold of 0 in a funding pool and a non-numeric amount are alerts on their rows', async () => {
    const pool = load<any>('pool.json')
    pool.cvproposals[0].requestedAmount = 'a hundred'
    const zero = '0x' + '0'.repeat(64)
    const w = poolWorld({ pool, calls: { [`${POOL.toLowerCase()}:${encodeCall('calculateThreshold(uint256)', ['200000000000000000000'])}`]: zero } })
    const read = await gardensPool.read(POOL_SYSTEM, w.ctx())
    const [r3, r2] = read.sections[0].rows
    expect(r3!.cells.slice(2)).toEqual(['unknown', `${UNEXPECTED}: proposal #3's requested amount is "a hundred", not an amount`])
    expect(r3!.attention).toBe('alert')
    expect(r2!.cells[3]).toBe(`${UNEXPECTED}: calculateThreshold for proposal #2 answered 0 in a funding pool`)
    expect(r2!.attention).toBe('alert')
  })
  it('a pool of unknown type with a threshold of 0 is an alert, the threshold unknown, and the allowlist unknown, without a crash', async () => {
    const pool = load<any>('pool.json')
    delete pool.cvstrategy.config
    const zero = '0x' + '0'.repeat(64)
    const read = await gardensPool.read(POOL_SYSTEM, poolWorld({ pool, calls: { [`${POOL.toLowerCase()}:${encodeCall('calculateThreshold(uint256)', ['200000000000000000000'])}`]: zero } }).ctx())
    expect(read.sections[0].rows.map(r => [r.cells[3], r.attention])).toEqual([
      ['50% of threshold', undefined], ['Gardens contract did not answer as expected: threshold 0 for a pool of unknown type', 'alert'],
    ])
    expect((read.facts.proposals as any[])[1]).toMatchObject({ number: 2, threshold: null })
    expect(read.sections[1].rows.slice(3)).toEqual([{ cells: ['Allowlist', 'unknown'] }, { cells: ['Type', 'type unknown'] }])
    expect(read.facts).toMatchObject({ type: null, allowlist: null, open: null })
  })
})

describe('allowlist actions, prepared for the council Safe (never signed)', () => {
  const data = (add: string[], remove: string[]) => encodeCall(SET_POOL_PARAMS, [[Z, Z, 0, 0, 0, 0], [0, 0, 0, 0], 0, add, remove, SUPERFLUID])

  it('allowlist-add through the council Safe: one step, a Safe transaction on its Celo nonce, attached as the Safe ref', async () => {
    const A9 = checksumAddress(`0x${'0'.repeat(38)}a9`)
    const w = poolWorld()
    const r = ok(await w.prepare('allowlist-add', { members: [A9.toLowerCase()] }, VIA))
    expect(r.steps).toHaveLength(1)
    const s = r.steps[0]!
    expect(s.call).toEqual({ chain: CELO, to: `${CELO}:${POOL}`, value: '0', operation: 0, data: data([A9], []), summary: `add ${short(A9)} to the allowlist of pool #48` })
    expect(s.call.data.slice(0, 10)).toBe('0xd5b7cc54')
    expect(s.signer).toEqual({ kind: 'safe', account: `${CELO}:${SAFE}` })
    expect(s.safe!.payload).toMatchObject({ to: POOL, value: '0', data: s.call.data, operation: 0, nonce: 9 })
    expect(s.safe!.ref.id).toBe(safeTxHash({ chainId: 42220, safe: SAFE, ...s.safe!.payload }))
    expect(r.attach).toEqual(s.safe!.ref)
    expect(r).toMatchObject({ action: 'allowlist-add', draft: null, link: gardensAppUrl(CELO, COMMUNITY, POOL) })
    // reads only: the subgraph and forno (POST, read-only bodies), the Safe service once (GET)
    for (const p of w.posts()) expect(readOnlyBody(p.body)).toBeNull()
    expect(w.posts().map(p => p.url)).toEqual([GARDENS_SUBGRAPHS[CELO], CELO_RPC])
    expect(w.posts()[1]!.body.slice(1).map((c: any) => c.params[0].data)).toEqual(['0x05caa7f3', encodeCall('facetAddress(bytes4)', ['0xd5b7cc54'])])
    expect(w.gets().map(g => g.url)).toEqual([`https://api.safe.global/tx-service/celo/api/v1/safes/${SAFE}/`])
  })

  it('without via, the council Safe is named as signer and nothing is attached', async () => {
    const A9 = checksumAddress(`0x${'0'.repeat(38)}a9`)
    const w = poolWorld()
    const r = ok(await w.prepare('allowlist-add', { members: [A9] }))
    expect(r.steps[0]!.signer).toEqual({ kind: 'safe', account: `${CELO}:${SAFE}` })
    expect(r.steps[0]!.safe).toBeNull()
    expect(r.attach).toBeNull()
    expect(w.gets()).toEqual([])
  })

  it('allowlist-remove says the stake is withdrawn', async () => {
    const r = ok(await poolWorld().prepare('allowlist-remove', { members: [M(1), M(2)] }, VIA))
    const s = r.steps[0]!
    expect(s.call.data).toBe(data([], [M(1), M(2)]))
    expect(s.call.summary).toBe(`remove ${short(M(1))}, ${short(M(2))} from the allowlist of pool #48; their stake in this pool is withdrawn`)
  })

  it('needs a treasury proposal', async () => {
    expect(refused(await poolWorld().prepare('allowlist-add', { members: [M(1)] }, VIA, { proposal: { classes: ['governance'] } })))
      .toBe('"allowlist-add" is an action of class treasury; this proposal is of class governance')
  })

  // Review Focus 5, and the rest: each a sentence, nothing prepared, no Safe read.
  const nineRemoved = [1, 2, 3, 4, 5, 6, 7, 8].map(M).concat(SAFE)
  const cases: { what: string; over?: Parameters<typeof poolWorld>[0]; action: string; members: string[]; via?: typeof VIA; says: string }[] = [
    { what: 'adding to an open pool', over: { pool: load('pool-open.json') }, action: 'allowlist-add', members: [M(9)],
      says: 'this pool is open to every member; adding names closes it — do that in the Gardens app' },
    { what: 'removing every member', action: 'allowlist-remove', members: nineRemoved,
      says: "removing every member leaves no one on this pool's allowlist; change it in the Gardens app" },
    { what: 'a contract with no setPoolParams', over: { calls: { [`${POOL.toLowerCase()}:${encodeCall('facetAddress(bytes4)', ['0xd5b7cc54'])}`]: '0x' + '0'.repeat(64) } },
      action: 'allowlist-add', members: [M(9)], says: "this pool's contract has no setPoolParams the platform knows; change the allowlist in the Gardens app" },
    { what: 'a member already listed', action: 'allowlist-add', members: [M(9), M(3)], says: `${short(M(3))} is already on this pool's allowlist` },
    { what: 'a member not listed', action: 'allowlist-remove', members: [M(9)], says: `${short(M(9))} is not on this pool's allowlist` },
    { what: 'the zero address', action: 'allowlist-add', members: [Z], says: 'the zero address stands for every member; opening or closing a pool is done in the Gardens app' },
    { what: 'a via that is not the council Safe', action: 'allowlist-add', members: [M(9)], via: OTHER_SAFE,
      says: `this pool's admin is the council Safe 0x5aFE…C0De, not ${short(OTHER_SAFE.address)}` },
  ]
  for (const c of cases) {
    it(`${c.what}: a sentence, nothing prepared`, async () => {
      const w = poolWorld(c.over)
      const r = await w.prepare(c.action, { members: c.members }, c.via ?? VIA)
      expect(refused(r)).toBe(c.says)
      expect(r).not.toHaveProperty('failed')
      expect(w.gets()).toEqual([])
    })
  }

  it('a community with no council Safe is refused: no one is known who can change the allowlist', async () => {
    const pool = load<any>('pool.json')
    pool.cvstrategy.registryCommunity.councilSafe = null
    expect(refused(await poolWorld({ pool }).prepare('allowlist-add', { members: [M(9)] }))).toBe("this pool's community has no council Safe, so the platform knows no one who can change its allowlist")
  })
})

describe('gardens-proposal outcomes', () => {
  const ref = (n: number, pool = POOL): ForeignRef => ({ system: 'fund-one', id: `${pool.toLowerCase()}-${n}`, payload: { kind: 'gardens-proposal' } })
  const out = (w: ReturnType<typeof poolWorld>, r: ForeignRef, opened = '2026-08-01T00:00:00Z') => gardensPool.outcome!(POOL_SYSTEM, r, { ...w.ctx(), opened })
  const cancelled = () => { const p = load<any>('proposal-2.json'); p.cvproposal.proposalStatus = '3'; return p }

  it('#1 executed → executed; one read-only POST', async () => {
    const w = poolWorld({ proposal: load('proposal-1.json') })
    expect(await out(w, ref(1))).toEqual({ ok: true, outcome: 'executed', detail: 'proposal #1 executed' })
    expect(w.seen).toHaveLength(1)
    expect(w.seen[0]!.body.variables).toEqual({ id: `${POOL.toLowerCase()}-1` })
    expect(readOnlyBody(w.seen[0]!.body)).toBeNull()
  })
  it('cancelled or rejected → failed', async () => {
    expect(await out(poolWorld({ proposal: cancelled() }), ref(2))).toEqual({ ok: true, outcome: 'failed', detail: 'proposal #2 cancelled' })
    const rejected = cancelled(); rejected.cvproposal.proposalStatus = '6'
    expect(await out(poolWorld({ proposal: rejected }), ref(2))).toEqual({ ok: true, outcome: 'failed', detail: 'proposal #2 rejected' })
  })
  it('#2 active → pending, with its status', async () => {
    expect(await out(poolWorld({ proposal: load('proposal-2.json') }), ref(2))).toEqual({ ok: true, outcome: 'pending', detail: 'proposal #2 is active' })
  })
  it('a proposal of another pool → mismatch', async () => {
    const other = load<any>('proposal-2.json'); other.cvproposal.strategy.id = POOL2.toLowerCase()
    expect(await out(poolWorld({ proposal: other }), ref(2))).toEqual({ ok: true, outcome: 'mismatch', detail: 'proposal #2 is of pool 0x0000…0002, not this one' })
    const w = poolWorld()
    expect(await out(w, ref(2, POOL2))).toEqual({ ok: true, outcome: 'mismatch', detail: `${POOL2.toLowerCase()}-2 is a proposal of pool 0x0000…0002, not this one` })
    expect(w.seen).toEqual([])
  })
  it('a proposal whose pool Gardens does not name (strategy.id missing or not an address) is attention, never a recorded mismatch', async () => {
    const error = `${UNEXPECTED}: proposal #2 names no pool (its strategy.id is missing or not an address)`
    for (const strategy of [null, {}, { id: 'not-an-address' }, { id: 7 }]) {
      const p = load<any>('proposal-2.json'); p.cvproposal.strategy = strategy
      expect(await out(poolWorld({ proposal: p }), ref(2))).toEqual({ ok: false, error })
    }
  })
  it('one created before the proposal opened → mismatch', async () => {
    expect(await out(poolWorld({ proposal: load('proposal-2.json') }), ref(2), '2026-10-21T00:00:00Z'))
      .toEqual({ ok: true, outcome: 'mismatch', detail: 'proposal #2 was made before this proposal opened; attach one made for it' })
  })
  it('none yet → pending, not submitted', async () => {
    expect(await out(poolWorld({ proposal: { cvproposal: null } }), ref(4))).toEqual({ ok: true, outcome: 'pending', detail: 'Gardens shows no proposal #4 in this pool yet', submitted: false })
  })
  it('a status outside PROPOSAL_STATUS is a read that could not be made, never pending', async () => {
    const odd = load<any>('proposal-2.json'); odd.cvproposal.proposalStatus = '9'
    expect(await out(poolWorld({ proposal: odd }), ref(2))).toEqual({ ok: false, error: `${UNEXPECTED}: proposal #2's status is "9", not one of 0–6 (${PROPOSAL_STATUS.join(', ')})` })
  })
  it('refuses a Safe transaction ref', async () => {
    await expect(gardensPool.outcome!(POOL_SYSTEM, { system: 'fund-one', id: '0x1', payload: { to: POOL, value: '0', data_hash: '0x', operation: 0, nonce: 1 } }, { ...poolWorld().ctx(), opened: '' }))
      .rejects.toThrow('a Gardens pool reads gardens-proposal refs')
  })
})

describe('gardens-pool checkRef', () => {
  const check = (raw: unknown) => gardensPool.checkRef!(POOL_SYSTEM, raw)
  it('takes this pool\'s proposal, in either case, and answers the subgraph id', () => {
    expect(check({ system: 'fund-one', id: `${POOL}-2`, payload: { kind: 'gardens-proposal' } }))
      .toEqual({ ok: true, ref: { system: 'fund-one', id: `${POOL.toLowerCase()}-2`, payload: { kind: 'gardens-proposal' } } })
  })
  it('refuses another pool, a number that is not positive, another system, another kind', () => {
    const bad = (raw: unknown) => { const r = check(raw); expect(r.ok).toBe(false); return (r as { error: string }).error }
    expect(bad({ system: 'fund-one', id: `${POOL2}-2`, payload: { kind: 'gardens-proposal' } })).toBe(`${POOL2.toLowerCase()}-2 is a proposal of pool 0x0000…0002, not this one`)
    for (const id of [`${POOL}-0`, `${POOL}-01`, `${POOL}--1`, `${POOL}-1.5`, `${POOL}-`, '2']) expect(bad({ system: 'fund-one', id, payload: { kind: 'gardens-proposal' } })).toMatch(/is not a Gardens proposal id/)
    expect(bad({ system: 'other', id: `${POOL}-2`, payload: { kind: 'gardens-proposal' } })).toMatch(/"system" is "other"/)
    expect(bad({ system: 'fund-one', id: `${POOL}-2`, payload: { kind: 'snapshot-proposal', choice: 'For' } })).toMatch(/gardens-proposal/)
    expect(bad(null)).toMatch(/a Gardens ref is/)
  })
})
