import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { guardedFetch, guardedPost, type Driver, type DriverContext, type DriverRead, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { safe } from '../../server/systems/safe.ts'
import { hatsTree } from '../../server/systems/hats.ts'
import { snapshotSpace } from '../../server/systems/snapshot.ts'
import { gardensCommunity, gardensPool } from '../../server/systems/gardens.ts'
import { link } from '../../server/systems/link.ts'
import { SystemReader, systemAttention } from '../../server/systems/reader.ts'
import { systems as systemsAdapter } from '../../server/resources/adapters/systems.ts'
import { runCommand } from '../../server/resources/run.ts'
import { childHatId, topHatId } from '../../lib/hats.mjs'
import type { Graph } from '../../server/resources/types.ts'
import type { Resource } from '../../app/src/api.ts'
import { SYSTEMS } from '../../app/src/test/fixtures/house/systems.ts'

// The drift guard (L4b brief §3, CC-17). The house's System fixtures (app/src/test/fixtures/house/systems.ts) stand in
// for what the systems adapter and the drivers give; the Systems row, the record header and later the role tree read
// them. Here each driver reads L2's committed recordings offline, as the driver tests do, and every key and section
// title a fixture uses must be in that real output: a driver that renames a fact fails here, not silently in /parts.

const NOW = new Date('2026-10-29T12:00:00Z')
const CELO = 'eip155:42220'
const load = (dir: string, file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${dir}/${file}`, import.meta.url), 'utf8'))
const ctxOf = (driver: Driver, fetch: FetchLike): DriverContext => ({
  fetchJson: guardedFetch(driver, fetch, new AbortController().signal),
  postJson: guardedPost(driver, fetch, new AbortController().signal),
  rpcUrl: chain => (CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null),
  now: () => NOW, members: [], sleep: async () => {},
})

/** A Safe on seven chains, as tests/systems/safe.chains.test.ts serves it (tests/systems/fixtures/safe-chains/), with
 *  its transfers (C12, CC-17): the recorded list on Celo (tests/systems/fixtures/safe-transfers/), none elsewhere. */
const SAFE_ADDR = '0x5aFE00000000000000000000000000000000C0De'
const SAFE_SLUGS = ['celo', 'eth', 'oeth', 'arb1', 'gno', 'pol', 'base']
const safeFetch: FetchLike = async url => {
  const transfers = /\/tx-service\/([a-z0-9]+)\/api\/v1\/safes\/0x[0-9a-fA-F]{40}\/transfers\/\?/.exec(url)
  if (transfers) {
    const body = transfers[1] === 'celo' ? load('safe-transfers', 'celo.json') : { count: 0, next: null, previous: null, results: [] }
    return { ok: true, status: 200, json: async () => body }
  }
  for (const slug of SAFE_SLUGS) {
    const f = load('safe-chains', `${slug}.json`)
    const api = `https://api.safe.global/tx-service/${slug}/api`
    const body = { [`${api}/v1/safes/${SAFE_ADDR}/`]: f.info, [`${api}/v2/safes/${SAFE_ADDR}/balances/`]: f.balances,
      [`${api}/v1/safes/${SAFE_ADDR}/multisig-transactions/?limit=25`]: f.transactions }[url]
    if (body !== undefined) return { ok: true, status: 200, json: async () => body }
  }
  return { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) }
}

/** Hats tree 13 on Celo, as tests/systems/hats.test.ts serves it (tests/systems/fixtures/hats-celo/). */
const TOP = topHatId(13), C1 = childHatId(TOP, 1)
const HOLDERS: Record<string, string> = { [TOP]: '13.json', [C1]: '13.1.json', [childHatId(C1, 1)]: '13.1.1.json', [childHatId(TOP, 3)]: '13.3.json' }
const hatsFetch: FetchLike = async (url, init) => {
  if (init.method === 'GET') {
    const m = /\/instances\/(\d+)\/holders(\?.*)?$/.exec(url)
    const hex = m ? `0x${BigInt(m[1]!).toString(16).padStart(64, '0')}` : ''
    const file = m ? (m[2] ? HOLDERS[hex]?.replace('.json', '.page2.json') : HOLDERS[hex]) : undefined
    return { ok: !!file, status: file ? 200 : 404, json: async () => (file ? load('hats-celo', `holders/${file}`) : {}) }
  }
  const calls = load('hats-celo', 'calls.json') as Record<string, string>
  const answer = (JSON.parse(init.body!) as any[]).map(r => r.method === 'eth_blockNumber'
    ? { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
    : calls[`${r.params[0].to.toLowerCase()}|${r.params[0].data}`] === undefined
      ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } }
      : { jsonrpc: '2.0', id: r.id, result: calls[`${r.params[0].to.toLowerCase()}|${r.params[0].data}`] })
  return { ok: true, status: 200, json: async () => answer }
}

/** The Snapshot hub's answer for example-dao.eth (tests/systems/fixtures/snapshot/). */
const snapshotFetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => load('snapshot', 'space.json') })

/** Gardens on Celo: the subgraph and the pools' calls (tests/systems/fixtures/gardens-celo/). */
const gardensFetch: FetchLike = async (_url, init) => {
  const body = JSON.parse(init.body!)
  if (typeof body.query === 'string') {
    const data = body.query.includes('registryCommunity(') ? load('gardens-celo', 'community.json')
      : body.query.includes('cvproposal(') ? load('gardens-celo', 'proposal-1.json') : load('gardens-celo', 'pool.json')
    return { ok: true, status: 200, json: async () => ({ data }) }
  }
  const calls = load('gardens-celo', 'calls.json') as Record<string, string>
  const answer = (body as any[]).map(r => {
    if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x4d9410e' }
    const to = r.params[0].to.toLowerCase(), data = r.params[0].data
    const hit = calls[`${to}:${data}`] ?? calls[`${to}:${data.slice(0, 10)}`]
    return hit == null ? { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: hit }
  })
  return { ok: true, status: 200, json: async () => answer }
}

/** Each fixture System's real counterpart: the entry the driver tests read, the driver, and the network it answers from. */
const COMMUNITY = '0x6a4de0000000000000000000000000000000c0de'
const POOL = '0x0000000000000000000000000000000000000001'
const REAL: Record<string, { entry: Record<string, unknown>; driver: Driver; fetch: FetchLike }> = {
  treasury: { entry: { id: 'treasury', kind: 'safe', chain: CELO, address: SAFE_ADDR, driver: 'safe',
    chains: ['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453'] }, driver: safe, fetch: safeFetch },
  'council-safe': { entry: { id: 'council-safe', kind: 'safe', chain: CELO, address: SAFE_ADDR, driver: 'safe' }, driver: safe, fetch: safeFetch },
  roles: { entry: { id: 'roles', kind: 'hats-tree', chain: CELO, address: '13', driver: 'hats-tree' }, driver: hatsTree, fetch: hatsFetch },
  votes: { entry: { id: 'votes', kind: 'snapshot-space', url: 'https://snapshot.box/#/s:example-dao.eth', driver: 'snapshot-space' }, driver: snapshotSpace, fetch: snapshotFetch },
  garden: { entry: { id: 'garden', kind: 'gardens-community', chain: CELO, address: COMMUNITY, driver: 'gardens-community' }, driver: gardensCommunity, fetch: gardensFetch },
  'network-projects': { entry: { id: 'network-projects', kind: 'gardens-pool', chain: CELO, address: POOL, driver: 'gardens-pool' }, driver: gardensPool, fetch: gardensFetch },
  'local-starter': { entry: { id: 'local-starter', kind: 'gardens-pool', chain: CELO, address: POOL, driver: 'gardens-pool' }, driver: gardensPool, fetch: gardensFetch },
  'ops-wallet': { entry: { id: 'ops-wallet', kind: 'link', url: 'https://etherscan.io/address/0x0000000000000000000000000000000000000001' }, driver: link, fetch: async () => { throw new Error('no network') } },
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** The keys under `path` a fixture uses and the real value does not have. An array of objects is held to the union of
 *  the real items' keys. */
function missing(fixture: unknown, real: unknown, path: string): string[] {
  if (isObject(fixture)) {
    if (!isObject(real)) return [`${path} (not an object in the real read)`]
    return Object.entries(fixture).flatMap(([k, v]) => (k in real ? missing(v, real[k], `${path}.${k}`) : [`${path}.${k}`]))
  }
  if (Array.isArray(fixture) && fixture.some(isObject)) {
    const items = Array.isArray(real) ? real.filter(isObject) : []
    if (items.length === 0) return [`${path}[] (no items in the real read to hold them to)`]
    const union = Object.assign({}, ...items) as Record<string, unknown>
    return fixture.flatMap((item, i) => missing(item, union, `${path}[${i}]`))
  }
  return []
}

const idOf = (r: Resource) => r.source!.entityId!
const driverOf = (r: Resource) => r.facts.driver as DriverRead
const reads = new Map<string, DriverRead>()
beforeAll(async () => {
  for (const [id, { entry, driver, fetch }] of Object.entries(REAL)) reads.set(id, await driver.read(entry, ctxOf(driver, fetch)))
})

describe('the house System fixtures hold to what the drivers read (drift guard)', () => {
  it('every fixture has a real counterpart, read offline from the recordings', () => {
    expect(SYSTEMS.map(idOf).sort()).toEqual(Object.keys(REAL).sort())
    for (const [id, read] of reads) expect(read.ok, id).toBe(true)
  })

  it.each(SYSTEMS.map(r => [idOf(r), r] as const))('%s: its driver facts have the real keys, all of them, and nothing else', (id, r) => {
    expect(Object.keys(driverOf(r).facts).sort()).toEqual(Object.keys(reads.get(id)!.facts).sort())
    expect(missing(driverOf(r).facts, reads.get(id)!.facts, 'facts')).toEqual([])
  })

  it("the Treasury's transfers are held item by item: the fixture lists some, the recording reads some, the keys agree", () => {
    const fixture = driverOf(SYSTEMS.find(r => idOf(r) === 'treasury')!).facts.transfers as Record<string, unknown>[]
    const real = reads.get('treasury')!.facts.transfers as Record<string, unknown>[]
    expect(fixture.length).toBeGreaterThan(0)
    expect(real.length).toBeGreaterThan(0)
    for (const t of fixture) expect(Object.keys(t).sort()).toEqual(Object.keys(real[0]!).sort())
  })

  it.each(SYSTEMS.map(r => [idOf(r), r] as const))('%s: its sections carry the real titles, in order', (id, r) => {
    expect(driverOf(r).sections.map(s => s.title)).toEqual(reads.get(id)!.sections.map(s => s.title))
  })

  it.each(SYSTEMS.map(r => [idOf(r), r] as const))('%s: the read is a DriverRead, its attention what the reader would raise', (_id, r) => {
    const keys = ['ok', 'readAt', 'error', 'facts', 'sections', 'open', 'state']
    expect(Object.keys(driverOf(r)).filter(k => !keys.includes(k))).toEqual([])
    expect(r.attention).toEqual(systemAttention(driverOf(r)))
  })
})

describe('the house System fixtures hold to what the systems adapter makes', () => {
  let repo: string
  let nodes: Graph['nodes']
  beforeAll(async () => {
    repo = makeFixtureRepo()
    const entries = SYSTEMS.map(r => ({
      id: idOf(r), kind: r.facts.kind, name: r.name, ...(r.facts.chain ? { chain: r.facts.chain } : {}), ...(r.facts.address ? { address: r.facts.address } : {}),
      ...(r.facts.url ? { url: r.facts.url } : {}), ...(r.facts.section ? { section: r.facts.section } : {}), driver: REAL[idOf(r)]!.driver.name,
    }))
    writeFileSync(join(repo, 'data', 'systems.yaml'), `schema_version: "1.0"\nsystems: ${JSON.stringify(entries)}\n`)
    // Each driver stands in with its real read of the recordings: the adapter wraps whatever the reader gives.
    const stand = (name: string): Driver => ({ name, hosts: [], read: async system => reads.get(String(system.id))! })
    const reader = new SystemReader({ repo, now: () => NOW, drivers: ['safe', 'hats-tree', 'snapshot-space', 'gardens-community', 'gardens-pool', 'link'].map(stand) })
    nodes = ((await systemsAdapter.read({ repo, now: () => NOW, run: runCommand, lastOk: () => null, systems: reader })) as Graph).nodes
  })
  afterAll(() => removeFixtureRepo(repo))

  it.each(SYSTEMS.map(r => [r.id, r] as const))('%s: the same id, kind, board, status, source and outer facts keys', (id, r) => {
    const node = nodes.find(n => n.id === id)
    expect(node, `the adapter made no ${id}`).toBeDefined()
    expect({ kind: r.kind, board: r.board, status: r.status, source: r.source }).toEqual({ kind: node!.kind, board: node!.board, status: node!.status, source: node!.source })
    expect(Object.keys(r.facts).sort()).toEqual(Object.keys(node!.facts).sort())
  })
})
