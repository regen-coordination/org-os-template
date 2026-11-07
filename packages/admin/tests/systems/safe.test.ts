import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { safe, NETWORKS, formatUnits, ago } from '../../server/systems/safe.ts'
import { guardedFetch, type FetchLike } from '../../server/systems/driver.ts'
import { SystemReader, systemAttention } from '../../server/systems/reader.ts'
import { systems as systemsAdapter } from '../../server/resources/adapters/systems.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { runCommand } from '../../server/resources/run.ts'

const DIR = new URL('./fixtures/safe-celo/', import.meta.url)
const load = (file: string): unknown => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
const ADDR = '0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60'
const API = 'https://api.safe.global/tx-service/celo/api'
const NOW = new Date('2026-10-16T09:00:00Z')
const URLS = {
  info: `${API}/v1/safes/${ADDR}/`,
  balances: `${API}/v2/safes/${ADDR}/balances/`,
  transactions: `${API}/v1/safes/${ADDR}/multisig-transactions/?limit=25`,
  // the 90-day window from NOW (C12, E-85): tests/systems/safe-transfers.test.ts reads it in full
  transfers: `${API}/v1/safes/${ADDR}/transfers/?limit=100&execution_date__gte=2026-07-18T09%3A00%3A00Z`,
}
/** The transfers list, whatever the window: a reader on the real clock asks for another start. */
const TRANSFERS_AT = `${API}/v1/safes/${ADDR}/transfers/?`
const asked = (url: string) => (url.startsWith(TRANSFERS_AT) ? 'transfers' : url)
/** The Safe Transaction Service as the fixtures recorded it; any other address is a 404. */
type Tx = Record<string, unknown>
const rows = (file: string) => (load(file) as { results: Tx[] }).results
/** The one list the service answers: waiting and executed together, newest nonce first. */
const list = (...results: Tx[]) => ({ count: results.length, next: null, previous: null, results })
function service(over: { info?: unknown; balances?: unknown; pending?: Tx[]; executed?: Tx[] } = {}) {
  const routes: Record<string, unknown> = {
    [URLS.info]: over.info ?? load('safe.json'), [URLS.balances]: over.balances ?? load('balances.json'),
    [URLS.transactions]: list(...(over.pending ?? rows('pending.json')), ...(over.executed ?? rows('executed.json'))),
  }
  const calls: string[] = []
  const fetch: FetchLike = async url => {
    calls.push(url)
    const body = url.startsWith(TRANSFERS_AT) ? load('../safe-transfers/celo.json') : routes[url]
    return body === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => body }
  }
  return { calls, fetch }
}
const busy: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) })
const html: FetchLike = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } })

const SAFE = { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: ADDR, driver: 'safe', section: 'organization/treasury' }
const MEMBERS = [
  { id: 'steward-a', name: 'Steward A', handles: { address: ['eip155:42220:0x00000000000000000000000000000000000000a1'] } },
  { id: 'ana', name: 'Ana', handles: { address: 'eip155:1:0x00000000000000000000000000000000000000A2' } }, // another chain
]
const readWith = (fetch: FetchLike, ctx: { sleep?: (ms: number) => Promise<void>; timeLeftMs?: () => number } = {}) =>
  safe.read(SAFE, { fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: MEMBERS, sleep: async () => {}, ...ctx })
const limited = (retryAfter?: string): FetchLike => async () => ({ ok: false, status: 429, headers: { get: () => retryAfter ?? null }, json: async () => ({}) })

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('the safe driver', () => {
  it('makes the four GETs (the Safe, its balances, its transactions and its transfers), one after another, and nothing else', async () => {
    const { calls, fetch } = service()
    await readWith(fetch)
    expect([...calls].sort()).toEqual(Object.values(URLS).sort())
    expect(calls.at(-1)).toBe(URLS.transfers)
    // L7-D15: the service, then each chain's public RPC host, for a read from the chain when the service cannot answer.
    expect(safe.hosts).toEqual(['api.safe.global', 'ethereum-rpc.publicnode.com', 'optimism-rpc.publicnode.com', 'gnosis-rpc.publicnode.com',
      'polygon-bor-rpc.publicnode.com', 'base-rpc.publicnode.com', 'arbitrum-one-rpc.publicnode.com', 'forno.celo.org', 'ethereum-sepolia-rpc.publicnode.com'])
  })

  it('the head facts, and the link to the Safe app', async () => {
    const r = await readWith(service().fetch)
    expect(r).toMatchObject({ ok: true, readAt: NOW.toISOString(), open: { url: `https://app.safe.global/home?safe=celo:${ADDR}`, embeddable: false } })
    const { transfers, ...facts } = r.facts
    expect(facts).toEqual({ chain: 'eip155:42220', network: 'Celo', address: ADDR, shortAddress: '0x967c…cb60', threshold: 2, owners: 4, nonce: 8, pending: 1, version: '1.4.1+L2', account: 'eip155:42220:0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60' })
    expect(transfers).toHaveLength(4) // the recording's, read in safe-transfers.test.ts
  })

  it('the four sections', async () => {
    const r = await readWith(service().fetch)
    expect(r.sections.map(s => s.title)).toEqual(['Waiting on signers', 'Balances', 'Signers', 'Executed'])
    const [waiting, balances, signers, executed] = r.sections
    expect(waiting!.rows).toEqual([{
      cells: ['#8', 'transfer → 0x765D…282a', '1 of 2 signatures', '24 h'], attention: 'alert',
      href: `https://app.safe.global/transactions/tx?safe=celo:${ADDR}&id=multisig_${ADDR}_0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe`,
    }])
    expect(balances!.rows).toEqual([{ cells: ['CELO', '10'] }, { cells: ['cUSD', '2.5'] }])
    expect(signers!.rows.map(row => row.cells)).toEqual([
      ['0x00000000000000000000000000000000000000A2', '—'], // Ana holds this address on another chain
      ['0x00000000000000000000000000000000000000A3', '—'],
      ['0x00000000000000000000000000000000000000A4', '—'],
      ['0x00000000000000000000000000000000000000A1', 'Steward A'], // matched whatever the letter case
    ])
    expect(signers!.note).toBe('2 of 4 needed')
    expect(executed!.rows.map(row => row.cells)).toEqual([['#7', 'multiSend → 0x9641…02e2', '30 d', 'ok'], ['#6', 'fallback → 0x59b3…dE80', '30 d', 'ok']])
  })

  it('nothing pending: the section says so and raises nothing', async () => {
    const r = await readWith(service({ pending: [] }).fetch)
    expect(r.sections[0]).toEqual({ title: 'Waiting on signers', note: 'nothing waiting', rows: [] })
    expect(systemAttention(r)).toBeNull()
  })

  it('an unknown chain is a failed read that names it', async () => {
    const read = await new SystemReader({ repo, fetch: service().fetch }).read({ ...SAFE, chain: 'eip155:999' })
    expect(read.ok).toBe(false)
    expect(read.error).toBe('no Safe Transaction Service network is known for chain eip155:999 (known: eip155:1, eip155:10, eip155:100, eip155:137, eip155:8453, eip155:42161, eip155:42220, eip155:11155111)')
  })

  it('a chain named like an object property is an unknown chain, and nothing is fetched', async () => {
    for (const chain of ['constructor', 'toString', '__proto__']) {
      const { calls, fetch } = service()
      await expect(safe.read({ ...SAFE, chain }, { fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: [] }))
        .rejects.toThrow(`no Safe Transaction Service network is known for chain ${chain} (known:`)
      expect(calls).toEqual([])
    }
  })

  it('counts signatures against the threshold now, not the one at proposal time', async () => {
    const info = { ...(load('safe.json') as object), threshold: 3 }
    const r = await readWith(service({ info }).fetch)
    expect(r.sections[0]!.rows[0]!.cells[2]).toBe('1 of 3 signatures')
    expect(r.sections[0]!.note).toBe('3 of 4 signatures needed')
  })

  it('a transaction hash that is not 32 bytes of hex gets no link', async () => {
    const pending = [{ ...rows('pending.json')[0], safeTxHash: '0x5afe/../../evil' }]
    const r = await readWith(service({ pending }).fetch)
    expect(r.sections[0]!.rows[0]).not.toHaveProperty('href')
    expect(r.sections[0]!.rows[0]!.attention).toBe('alert')
  })

  it('knows the network names the service answers to (checked 2026-10-16)', () => {
    expect(Object.fromEntries(Object.entries(NETWORKS).map(([chain, n]) => [chain, n.slug]))).toEqual({
      'eip155:1': 'eth', 'eip155:10': 'oeth', 'eip155:100': 'gno', 'eip155:137': 'pol', 'eip155:8453': 'base', 'eip155:42161': 'arb1', 'eip155:42220': 'celo', 'eip155:11155111': 'sep',
    })
  })

  it('formats amounts and ages', () => {
    expect(formatUnits('10000000000000000000', 18)).toBe('10')
    expect(formatUnits('1234567', 6)).toBe('1.2345')
    expect(formatUnits('5', 18)).toBe('0')
    expect(ago('2026-10-16T08:59:00Z', NOW)).toBe('1 min')
    expect(ago('2026-10-14T10:00:00Z', NOW)).toBe('47 h')
    expect(ago(null, NOW)).toBe('')
  })
})

describe('the Safe on the map', () => {
  const writeSystems = () => writeFileSync(join(repo, 'data', 'systems.yaml'), `systems:
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "${ADDR}"
    driver: "safe"
    section: "organization/treasury"
`)

  it('a transaction waiting on signers is alert attention on the record, which is how it reaches Home', async () => {
    writeSystems()
    const reader = new SystemReader({ repo, fetch: service().fetch, now: () => NOW })
    const store = new ResourceStore({ repo, now: () => NOW, run: runCommand, lastOk: () => null, systems: reader }, [systemsAdapter])
    const node = (await store.graph()).nodes.find(n => n.id === 'system:treasury-safe')!
    expect(node).toMatchObject({ kind: 'system', board: 'organization', status: 'safe', attention: { level: 'alert', text: 'Waiting on signers: 1' } })
  })

  it('a busy or broken service is a warn on the record, with the last good read kept (Review Focus 5)', async () => {
    vi.useFakeTimers()
    try {
      const sys = { ...SAFE, id: 'rf5-safe' }
      const good = new SystemReader({ repo, fetch: service().fetch, now: () => NOW }).read(sys, MEMBERS) // a good read, kept on disk
      await vi.advanceTimersByTimeAsync(5_000)
      await good
      const rateLimit = `api.safe.global is rate-limiting this read (api.safe.global answered 429 for /tx-service/celo/api/v1/safes/${ADDR}/); it will be read again shortly`
      for (const [fetch, error] of [
        [busy, rateLimit],
        [html, `api.safe.global did not answer JSON for /tx-service/celo/api/v1/safes/${ADDR}/`],
      ] as const) {
        const pending = new SystemReader({ repo, fetch, now: () => NOW }).read(sys, MEMBERS)
        await vi.advanceTimersByTimeAsync(5_000)
        const r = await pending
        expect(r).toMatchObject({ ok: false, error, readAt: NOW.toISOString() })
        expect(r.sections.map(s => s.title)).toEqual(['Waiting on signers', 'Balances', 'Signers', 'Executed'])
        expect(systemAttention(r)).toEqual({ level: 'warn', text: `read failed: ${error}` })
      }
    } finally { vi.useRealTimers() }
  })
})

describe('a service that rate-limits bursts', () => {
  it('asks one thing at a time, with the gap between requests', async () => {
    const { fetch } = service()
    let inFlight = 0, peak = 0
    const slow: FetchLike = async (url, init) => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise(resolve => setImmediate(resolve))
      try { return await fetch(url, init) } finally { inFlight-- }
    }
    const sleeps: number[] = []
    await readWith(slow, { sleep: async ms => { sleeps.push(ms) } })
    expect(peak).toBe(1)
    expect(sleeps).toEqual([1000, 1000, 1000]) // between the four requests
  })

  it('a 429 then a 200 succeeds after one retry, waiting the Retry-After', async () => {
    const { fetch } = service()
    let n = 0
    const flaky: FetchLike = async (url, init) => (++n === 2 ? limited('3')(url, init) : fetch(url, init))
    const sleeps: number[] = []
    const r = await readWith(flaky, { sleep: async ms => { sleeps.push(ms) }, timeLeftMs: () => 8000 })
    expect(r.ok).toBe(true)
    expect(n).toBe(5) // four requests and the one retry
    expect(sleeps).toEqual([1000, 3000, 1000, 1000])
  })

  it('two 429s fail with a sentence that says the service is rate-limiting and when to expect another try', async () => {
    await expect(readWith(limited(), { timeLeftMs: () => 8000 })).rejects.toThrow(
      `api.safe.global is rate-limiting this read (api.safe.global answered 429 for /tx-service/celo/api/v1/safes/${ADDR}/); it will be read again shortly`)
  })

  it('a retry that cannot fit in the time left is not attempted', async () => {
    const sleeps: number[] = []
    await expect(readWith(limited('4'), { sleep: async ms => { sleeps.push(ms) }, timeLeftMs: () => 4000 })).rejects.toThrow('rate-limiting')
    await expect(readWith(limited('60'), { timeLeftMs: () => 8000 })).rejects.toThrow('rate-limiting')
    expect(sleeps).toEqual([])
  })

  it('splits the one list: waiting from this nonce on, the latest five executed, nothing stale', async () => {
    const [done7, done6] = rows('executed.json')
    const executed = [done7!, done6!, ...[5, 4, 3, 2, 1].map(nonce => ({ ...done6!, nonce, safeTxHash: `0x${String(nonce).repeat(64)}` }))]
    const stale = { ...rows('pending.json')[0], nonce: 5, safeTxHash: `0x${'9'.repeat(64)}` } // a replaced proposal below the Safe's nonce
    const later = { ...rows('pending.json')[0], nonce: 9, safeTxHash: `0x${'a'.repeat(64)}` }
    const r = await readWith(service({ pending: [later, ...rows('pending.json'), stale], executed }).fetch)
    expect(r.sections[0]!.rows.map(row => row.cells[0])).toEqual(['#8', '#9'])
    expect(r.sections[3]!.rows.map(row => row.cells[0])).toEqual(['#7', '#6', '#5', '#4', '#3'])
    expect(r.facts.pending).toBe(2)
  })

  it('two Safes read together never overlap and keep the gap between any two requests', async () => {
    vi.useFakeTimers()
    try {
      const { fetch } = service()
      const starts: number[] = []
      let inFlight = 0, peak = 0
      const watched: FetchLike = async (url, init) => {
        starts.push(Date.now()); inFlight++; peak = Math.max(peak, inFlight)
        await Promise.resolve()
        try { return await fetch(url, init) } finally { inFlight-- }
      }
      const reader = new SystemReader({ repo, fetch: watched })
      const both = Promise.all([reader.read({ ...SAFE, id: 'one' }, MEMBERS), reader.read({ ...SAFE, id: 'two' }, MEMBERS)])
      await vi.advanceTimersByTimeAsync(9_000)
      const reads = await both
      expect(reads.map(r => r.ok)).toEqual([true, true])
      expect(starts).toHaveLength(8)
      expect(peak).toBe(1)
      expect(starts.slice(1).map((t, i) => t - starts[i]!).every(d => d >= 1000)).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('three Safes read in one pass all succeed: time spent waiting for a turn is not the read\'s time', async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetch } = service()
      const reader = new SystemReader({ repo, fetch })
      const all = Promise.all(['one', 'two', 'three'].map(id => reader.read({ ...SAFE, id }, MEMBERS)))
      await vi.advanceTimersByTimeAsync(15_000)
      const reads = await all
      expect(reads.map(r => [r.ok, r.error])).toEqual([[true, undefined], [true, undefined], [true, undefined]])
      expect(calls).toHaveLength(12)
    } finally { vi.useRealTimers() }
  })

  it('a read that waits too long for its first turn fails, saying the host is busy, and sends nothing', async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetch } = service()
      const reader = new SystemReader({ repo, fetch, queueLimitMs: 500 })
      const reads = Promise.all([reader.read({ ...SAFE, id: 'one' }, MEMBERS), reader.read({ ...SAFE, id: 'two' }, MEMBERS)])
      await vi.advanceTimersByTimeAsync(10_000)
      const [first, second] = await reads
      expect(first!.ok).toBe(true)
      expect(second).toMatchObject({ ok: false, error: 'api.safe.global is busy: this read waited 0.5 s behind other reads without its turn, so nothing was sent; it will be read again shortly' })
      expect(calls).toHaveLength(4) // the first Safe's four; the second sent none
    } finally { vi.useRealTimers() }
  })

  it('three reads of one Safe at once share one read: one fetch sequence, and a good result for each', async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetch } = service()
      const reader = new SystemReader({ repo, fetch })
      const all = Promise.all([1, 2, 3].map(() => reader.read(SAFE, MEMBERS)))
      await vi.advanceTimersByTimeAsync(15_000)
      const reads = await all
      expect(reads.map(r => r.ok)).toEqual([true, true, true])
      expect(calls.map(asked)).toEqual([URLS.info, URLS.balances, URLS.transactions, 'transfers'])
      expect(reader.hasFailedRead()).toBe(false) // no later-finishing failure overwrote the good read
    } finally { vi.useRealTimers() }
  })

  it('a failed read is asked again after 60 s, a good one only after five minutes', async () => {
    vi.useFakeTimers()
    try {
      let at = NOW.getTime()
      const now = () => new Date(at)
      for (const [name, up] of [['failed', false], ['good', true]] as const) {
        const { fetch } = service()
        let calls = 0
        const flip: FetchLike = async (url, init) => { calls++; return up ? fetch(url, init) : html(url, init) }
        const reader = new SystemReader({ repo, fetch: flip, now })
        const sys = { ...SAFE, id: `ttl-${name}` }
        const run = async () => { const p = reader.read(sys, MEMBERS); await vi.advanceTimersByTimeAsync(5_000); return p }
        await run(); const first = calls
        at += 59_000; await run(); expect(calls).toBe(first) // still inside the minute
        at += 2_000; await run()
        expect(calls > first).toBe(!up) // 61 s on: the failed read goes again, the good one does not
        at += 240_000; await run()
        expect(calls > first).toBe(true) // past five minutes both go again
      }
    } finally { vi.useRealTimers() }
  })
})
