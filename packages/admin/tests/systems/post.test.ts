import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { guardedPost, readOnlyBody, READ_RPC_METHODS, type Driver, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS, chainInfo, chainIdNumber, parseRpcConfig } from '../../server/systems/chains.ts'
import { ethCalls, graphql, RPC_BATCH_LIMIT } from '../../server/systems/wire.ts'
import { SystemReader } from '../../server/systems/reader.ts'

type Seen = { url: string; method: string; body: unknown; headers: Record<string, string>; redirect: string }
/** A fake FetchLike that records every request and answers with `answer(body, url)`. */
const fake = (answer: (body: any, url: string) => unknown = () => ({})) => {
  const seen: Seen[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body)
    seen.push({ url, method: init.method, body, headers: init.headers, redirect: init.redirect })
    return { ok: true, status: 200, json: async () => answer(body, url) }
  }
  return { seen, fetch }
}
const signal = () => new AbortController().signal
const HUB = { name: 'hub', hosts: ['hub.snapshot.org'] }
const CELO = CHAINS['eip155:42220'].rpc!
const RPC_DRIVER = { name: 'rpcd', hosts: [CELO] }
const post = (driver: Pick<Driver, 'name' | 'hosts'>, f: FetchLike, rpc?: Record<string, string>) => guardedPost(driver, f, signal(), rpc)

describe('readOnlyBody', () => {
  it('lists the read methods', () => {
    expect([...READ_RPC_METHODS]).toEqual(['eth_call', 'eth_blockNumber', 'eth_chainId', 'eth_getCode'])
  })
})

describe('postJson refuses writes before sending', () => {
  const bodies: [string, unknown][] = [
    ['a raw transaction', { jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x00'] }],
    ['a batch with one eth_sign', [{ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] }, { jsonrpc: '2.0', id: 2, method: 'eth_sign', params: [] }, { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [] }]],
    ['a mutation', { query: 'mutation { x }' }],
    ['a subscription', { query: '  subscription S { x }' }],
    ['a query followed by a mutation', { query: 'query { a } mutation M { b }' }],
    ['a string', 'eth_call'],
    ['an empty object', {}],
    ['a mutation hidden behind a comment holding triple quotes', { query: 'query { a }\n# \"\"\"\nmutation { x }\n# \"\"\"' }],
    ['a body with both method and query', { method: 'eth_call', query: 'mutation { x }' }],
    ['a JSON-RPC request with an extra key', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [], query: '{ a }' }],
    ['a GraphQL body with extensions', { query: '{ a }', extensions: {} }],
    ['an object whose toJSON gives a mutation', { toJSON: () => ({ query: 'mutation { x }' }) }],
  ]
  for (const [label, body] of bodies) {
    it(`refuses ${label}`, async () => {
      const { seen, fetch } = fake()
      await expect(post(RPC_DRIVER, fetch)(`https://${CELO}/`, body)).rejects.toThrow(/^refused:/)
      expect(seen).toEqual([])
      expect(readOnlyBody(body)).toMatch(/^refused:/)
    })
  }
  it('checks what is sent, not what a getter says the second time', async () => {
    const { seen, fetch } = fake()
    let n = 0
    const sly = { toJSON: () => (n++ === 0 ? { query: '{ a }' } : { query: 'mutation { x }' }) }
    await post(HUB, fetch)('https://hub.snapshot.org/graphql', sly)
    expect(seen[0].body).toEqual({ query: '{ a }' })
  })
  it('allows variables and operationName beside a query', async () => {
    const { seen, fetch } = fake()
    await post(HUB, fetch)('https://hub.snapshot.org/graphql', { query: 'query Q($i: ID!) { a }', variables: { i: 'x' }, operationName: 'Q' })
    expect(seen).toHaveLength(1)
  })
  it('allows the word mutation inside a string or a comment', async () => {
    const { seen, fetch } = fake()
    await post(HUB, fetch)('https://hub.snapshot.org/graphql', { query: '{ space(id: "mutation") { id } } # subscription' })
    expect(seen).toHaveLength(1)
    expect(readOnlyBody({ query: '{ a }' })).toBeNull()
  })
})

describe('postJson has the same host guard as GET', () => {
  for (const url of ['http://hub.snapshot.org/graphql', 'https://hub.snapshot.org:8443/graphql', 'https://user@hub.snapshot.org/graphql', 'https://evil.example.org/graphql', 'nonsense']) {
    it(`refuses ${url}`, async () => {
      const { seen, fetch } = fake()
      await expect(post(HUB, fetch)(url, { query: '{ a }' })).rejects.toThrow(/^refused:/)
      expect(seen).toEqual([])
    })
  }
  it('sends a declared host as a JSON POST with no redirect', async () => {
    const { seen, fetch } = fake(() => ({ data: {} }))
    await expect(post(HUB, fetch)('https://hub.snapshot.org/graphql', { query: '{ a }' })).resolves.toEqual({ data: {} })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ url: 'https://hub.snapshot.org/graphql', method: 'POST', redirect: 'error', body: { query: '{ a }' } })
    expect(seen[0].headers['content-type']).toBe('application/json')
  })
})

const ctxOf = (f: FetchLike, rpc?: Record<string, string>, driver: Pick<Driver, 'name' | 'hosts'> = { name: 'd', hosts: [CELO, 'hub.snapshot.org'] }): DriverContext => ({
  fetchJson: async () => ({}), postJson: guardedPost(driver, f, signal(), rpc), now: () => new Date(0), members: [],
  rpcUrl: chain => rpc?.[chain] ?? (chainInfo(chain)?.rpc ? `https://${chainInfo(chain)!.rpc}` : null),
})
const A = '0x' + '12'.repeat(20) // no letters, so its EIP-55 form is itself
const call = (i: number) => ({ to: `eip155:42220:${A}`, data: '0x' + i.toString(16).padStart(8, '0') })

describe('ethCalls', () => {
  it('matches batch answers by id, whatever the order', async () => {
    const { seen, fetch } = fake((batch: any[]) => batch.map(r => r.method === 'eth_blockNumber' ? { jsonrpc: '2.0', id: r.id, result: '0x10' } : { jsonrpc: '2.0', id: r.id, result: r.params[0].data }).reverse())
    const out = await ethCalls(ctxOf(fetch), 'eip155:42220', [call(1), call(2), call(3)])
    expect(out.block).toBe(16)
    expect(out.results).toEqual([{ ok: true, data: '0x00000001' }, { ok: true, data: '0x00000002' }, { ok: true, data: '0x00000003' }])
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(`https://${CELO}/`)
    expect(seen[0].body).toEqual([
      { jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] },
      { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: A, data: '0x00000001' }, 'latest'] },
      { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: A, data: '0x00000002' }, 'latest'] },
      { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: A, data: '0x00000003' }, 'latest'] },
    ])
  })
  it('a missing answer is a failed read', async () => {
    const { fetch } = fake((batch: any[]) => batch.filter(r => r.id !== 2).map(r => ({ jsonrpc: '2.0', id: r.id, result: '0x1' })))
    await expect(ethCalls(ctxOf(fetch), 'eip155:42220', [call(1), call(2), call(3)])).rejects.toThrow(`${CELO} gave no answer for call 2`)
  })
  it('a reverted call is that call\'s failure beside the others\' successes', async () => {
    const { fetch } = fake((batch: any[]) => batch.map(r => r.id === 2 ? { jsonrpc: '2.0', id: 2, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id: r.id, result: '0x1' }))
    const out = await ethCalls(ctxOf(fetch), 'eip155:42220', [call(1), call(2), call(3)])
    expect(out.results).toEqual([{ ok: true, data: '0x1' }, { ok: false, error: 'execution reverted' }, { ok: true, data: '0x1' }])
  })
  it('a non-array answer is refused as not a batch', async () => {
    const { fetch } = fake(() => ({ error: 'nope' }))
    await expect(ethCalls(ctxOf(fetch), 'eip155:42220', [call(1)])).rejects.toThrow(`${CELO} did not answer a JSON-RPC batch`)
  })
  it('sends 120 calls as three POSTs, the block from the first', async () => {
    let n = 0
    const { seen, fetch } = fake((batch: any[]) => batch.map(r => ({ jsonrpc: '2.0', id: r.id, result: r.method === 'eth_blockNumber' ? '0x' + (100 + n++).toString(16) : '0x1' })))
    const out = await ethCalls(ctxOf(fetch), 'eip155:42220', Array.from({ length: 120 }, (_, i) => call(i)))
    expect(RPC_BATCH_LIMIT).toBe(50)
    expect(seen).toHaveLength(3)
    expect(seen.map(s => (s.body as unknown[]).length)).toEqual([51, 51, 21])
    expect(out.block).toBe(100)
    expect(out.results).toHaveLength(120)
  })
  it('refuses an unknown chain before any request', async () => {
    const { seen, fetch } = fake()
    for (const c of ['eip155:999', 'constructor']) await expect(ethCalls(ctxOf(fetch), c, [call(1)])).rejects.toThrow(`no RPC host is known for chain ${c}`)
    expect(seen).toEqual([])
  })
})

describe('graphql', () => {
  it('errors beside data fail the read', async () => {
    const { fetch } = fake(() => ({ data: { space: null }, errors: [{ message: 'boom' }] }))
    await expect(graphql(ctxOf(fetch), 'https://hub.snapshot.org/graphql', '{ space { id } }')).rejects.toThrow('hub.snapshot.org answered a GraphQL error: boom')
  })
  it('an answer without data fails, and data comes back with its variables sent', async () => {
    const none = fake(() => ({}))
    await expect(graphql(ctxOf(none.fetch), 'https://hub.snapshot.org/graphql', '{ a }')).rejects.toThrow('hub.snapshot.org answered no data')
    const ok = fake(() => ({ data: { a: 1 } }))
    await expect(graphql(ctxOf(ok.fetch), 'https://hub.snapshot.org/graphql', 'query($i:String){ a }', { i: 'x' })).resolves.toEqual({ a: 1 })
    expect(ok.seen[0].body).toEqual({ query: 'query($i:String){ a }', variables: { i: 'x' } })
  })
})

describe('configured RPC hosts (ruling K5)', () => {
  const KEYED = 'https://celo.example.org/v1/abcdef'
  it('uses a configured URL and allows its host', async () => {
    const rpc = parseRpcConfig(`eip155:42220=${KEYED}`)
    expect(rpc).toEqual({ 'eip155:42220': KEYED })
    const { seen, fetch } = fake((b: any[]) => b.map(r => ({ jsonrpc: '2.0', id: r.id, result: '0x1' })))
    await ethCalls(ctxOf(fetch, rpc), 'eip155:42220', [call(1)])
    expect(seen[0].url).toBe(KEYED)
  })
  it('falls back to the table host when none is configured for the chain', async () => {
    const rpc = parseRpcConfig(`eip155:42220=${KEYED}`)
    const { seen, fetch } = fake((b: any[]) => b.map(r => ({ jsonrpc: '2.0', id: r.id, result: '0x1' })))
    await ethCalls(ctxOf(fetch, rpc, { name: 'd', hosts: [CHAINS['eip155:1'].rpc!] }), 'eip155:1', [call(1)])
    expect(seen[0].url).toBe(`https://${CHAINS['eip155:1'].rpc}/`)
  })
  it('refuses a chain with neither a configured URL nor a table host', async () => {
    const { seen, fetch } = fake()
    const ctx = { ...ctxOf(fetch), rpcUrl: () => null }
    await expect(ethCalls(ctx, 'eip155:42220', [call(1)])).rejects.toThrow('no RPC host is known for chain eip155:42220')
    expect(seen).toEqual([])
  })
  it('a configured host is not allowed for a driver that declares no table RPC host', async () => {
    const { seen, fetch } = fake()
    const rpc = parseRpcConfig(`eip155:42220=${KEYED}`)
    await expect(guardedPost(HUB, fetch, signal(), rpc)(KEYED, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' })).rejects.toThrow(/^refused:/)
    expect(seen).toEqual([])
    await expect(guardedPost(RPC_DRIVER, fetch, signal(), rpc)(KEYED, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' })).resolves.toBeDefined()
    expect(seen).toHaveLength(1)
  })
  it('names an entry by chain and host, never its URL, and refuses a chain given twice', () => {
    const secret = 'https://celo.example.org:8545/v1/s3cr3tkey'
    let message = ''
    try { parseRpcConfig(`eip155:42220=${secret}`) } catch (e) { message = (e as Error).message }
    expect(message).toContain('eip155:42220')
    expect(message).toContain('celo.example.org')
    expect(message).not.toContain('s3cr3tkey')
    expect(() => parseRpcConfig('eip155:1=https://a.example.org/x,eip155:1=https://b.example.org/y')).toThrow(/eip155:1.*twice/)
  })
  it('refuses a chain the Hub does not know, saying so in the Hub’s words (C12, Q66)', () => {
    expect(() => parseRpcConfig('eip155:999999=https://a.example.org/x'))
      .toThrow(`ORG_OS_RPC entry for "eip155:999999" (a.example.org) names eip155:999999, which is not a chain this Hub knows (${Object.keys(CHAINS).join(', ')})`)
  })
  it('a keyed URL that answers non-2xx, non-JSON or not at all names its host only, never a part of the key', async () => {
    const keyed = 'https://celo.example.org/v3/k3yS3cr3t?apikey=Qq9Zz'
    const rpc = parseRpcConfig(`eip155:42220=${keyed}`)
    const answers: FetchLike[] = [
      async () => ({ ok: false, status: 401, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token < at ${keyed}`) } }),
      async () => { throw new TypeError(`fetch failed for ${keyed}`) },
    ]
    for (const f of answers) {
      let message = ''
      try { await ethCalls(ctxOf(f, rpc), 'eip155:42220', [call(1)]) } catch (e) { message = (e as Error).message }
      expect(message).toMatch(/^celo\.example\.org /)
      for (const part of ['k3yS3cr3t', 'Qq9Zz', '/v3', 'apikey']) expect(message).not.toContain(part)
    }
  })
  it('an entry\'s sentence never quotes its URL path or a login, whatever is wrong with it', () => {
    const secrets = ['k3yS3cr3t', 'pw0rd']
    const entries = [
      'https://celo.example.org/v3/k3yS3cr3t', // no `=`
      'https://celo.example.org/v3/k3yS3cr3t=x', // the URL where the chain should be
      'eip155:1=https://celo.example.org/v3/k3yS3cr3t, https://celo.example.org/v3/k3yS3cr3t', // the second entry has no `=`
      'eip155:1=http://celo.example.org/v3/k3yS3cr3t',
      'eip155:1=https://user:pw0rd@celo.example.org/v3/k3yS3cr3t',
      'eip155:999=https://celo.example.org/v3/k3yS3cr3t',
      'eip155:1=https://celo.example.org:8545/v3/k3yS3cr3t',
    ]
    for (const entry of entries) {
      let message = ''
      try { parseRpcConfig(entry) } catch (e) { message = (e as Error).message }
      expect(message).toMatch(/^ORG_OS_RPC /)
      for (const s of secrets) expect(message).not.toContain(s)
      expect(message).not.toContain('/v3')
    }
    expect(() => parseRpcConfig(entries[2])).toThrow('ORG_OS_RPC has an entry with no `=` (entry 2)')
  })
  it('parses several entries, and an empty or missing value is {}', () => {
    expect(parseRpcConfig(undefined)).toEqual({})
    expect(parseRpcConfig('')).toEqual({})
    expect(parseRpcConfig('  ')).toEqual({})
    expect(parseRpcConfig(`eip155:1=https://a.example.org/x, eip155:10=https://b.example.org/y`)).toEqual({ 'eip155:1': 'https://a.example.org/x', 'eip155:10': 'https://b.example.org/y' })
  })
  const bad: [string, string][] = [
    ['http', 'eip155:1=http://a.example.org/x'],
    ['a non-CAIP-2 chain', 'celo=https://a.example.org/x'],
    ['a chain not in the table', 'eip155:999=https://a.example.org/x'],
    ['credentials', 'eip155:1=https://user:pw@a.example.org/x'],
    ['a port', 'eip155:1=https://a.example.org:8545/x'],
    ['no equals sign', 'eip155:1'],
    ['a URL that is not one', 'eip155:1=not a url'],
  ]
  for (const [label, entry] of bad) {
    it(`throws a sentence naming the entry for ${label}`, () => {
      // An entry is named by its chain when that is a CAIP-2 id and by its place otherwise; a missing `=` by its place.
      const chain = entry.split('=')[0]
      const named = entry.includes('=') && /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(chain) ? `"${chain}"` : 'entry 1'
      expect(() => parseRpcConfig(entry)).toThrow(new RegExp(`^ORG_OS_RPC .*${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    })
  }
})

describe('a driver\'s time limit', () => {
  let repo: string
  beforeEach(() => { repo = makeFixtureRepo(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); removeFixtureRepo(repo) })
  const slowFetch: FetchLike = (_u, init) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ n: 1 }) }), 20_000)
    init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) })
  })
  const driver = (timeoutMs?: Driver['timeoutMs']): Driver => ({
    name: 'slow', hosts: ['api.example.org'], timeoutMs,
    async read(_s, ctx) { await ctx.fetchJson('https://api.example.org/x'); return { ok: true, readAt: null, facts: {}, sections: [], open: null } },
  })
  const SYS = { id: 'box', driver: 'slow' }
  it('reads ok inside the driver\'s own limit', async () => {
    const p = new SystemReader({ repo, fetch: slowFetch, drivers: [driver(() => 30_000)] }).read(SYS)
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await p).ok).toBe(true)
  })
  it('fails at the default limit without one', async () => {
    const p = new SystemReader({ repo, fetch: slowFetch, drivers: [driver()] }).read(SYS)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(await p).toMatchObject({ ok: false, error: 'no answer within 8 s' })
  })
  it('opts.timeoutMs wins over the driver\'s', async () => {
    const p = new SystemReader({ repo, fetch: slowFetch, drivers: [driver(() => 30_000)], timeoutMs: 5_000 }).read(SYS)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await p).toMatchObject({ ok: false, error: 'no answer within 5 s' })
  })
  it('a declared limit that is not a positive finite number falls back to the default', async () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = new SystemReader({ repo, fetch: slowFetch, drivers: [driver(() => bad)] }).read({ id: `bad${String(bad)}`, driver: 'slow' })
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await p).toMatchObject({ ok: false, error: 'no answer within 8 s' })
    }
  })
  it('hands the driver postJson through the same pacer, and the reader\'s rpc config', async () => {
    const calls: string[] = []
    const f: FetchLike = async (url, init) => { calls.push(`${init.method} ${url}`); return { ok: true, status: 200, json: async () => ({ result: '0x1' }) } }
    let seenCtx: DriverContext | undefined
    const d: Driver = { name: 'p', hosts: [CELO], minGapMs: 0,
      async read(_s, ctx) { seenCtx = ctx; await ctx.postJson!(ctx.rpcUrl!('eip155:42220')!, { jsonrpc: '2.0', id: 1, method: 'eth_chainId' }); return { ok: true, readAt: null, facts: {}, sections: [], open: null } } }
    const reader = new SystemReader({ repo, fetch: f, drivers: [d], rpc: { 'eip155:42220': `https://${CELO}/keyed` } })
    expect((await reader.read({ id: 'p1', driver: 'p' })).ok).toBe(true)
    expect(calls).toEqual([`POST https://${CELO}/keyed`])
    expect(seenCtx!.rpcUrl!('eip155:1')).toBe(`https://${CHAINS['eip155:1'].rpc}`)
  })
})

describe('the chain table', () => {
  it('is exactly the table', () => {
    expect(Object.entries(CHAINS)).toEqual([
      ['eip155:1', { name: 'Ethereum', native: 'ETH', safe: 'eth', rpc: 'ethereum-rpc.publicnode.com', explorer: 'eth.blockscout.com' }],
      ['eip155:10', { name: 'Optimism', native: 'ETH', safe: 'oeth', rpc: 'optimism-rpc.publicnode.com', explorer: null }],
      ['eip155:100', { name: 'Gnosis', native: 'xDAI', safe: 'gno', rpc: 'gnosis-rpc.publicnode.com', explorer: null }],
      ['eip155:137', { name: 'Polygon', native: 'POL', safe: 'pol', rpc: 'polygon-bor-rpc.publicnode.com', explorer: null }],
      ['eip155:8453', { name: 'Base', native: 'ETH', safe: 'base', rpc: 'base-rpc.publicnode.com', explorer: null }],
      ['eip155:42161', { name: 'Arbitrum', native: 'ETH', safe: 'arb1', rpc: 'arbitrum-one-rpc.publicnode.com', explorer: null }],
      ['eip155:42220', { name: 'Celo', native: 'CELO', safe: 'celo', rpc: 'forno.celo.org', explorer: 'celo.blockscout.com' }],
      ['eip155:11155111', { name: 'Sepolia', native: 'ETH', safe: 'sep', rpc: 'ethereum-sepolia-rpc.publicnode.com', explorer: 'eth-sepolia.blockscout.com' }],
    ])
  })
  it('guards prototype names and reads the numeric id', () => {
    expect(chainInfo('__proto__')).toBeNull()
    expect(chainInfo('constructor')).toBeNull()
    expect(chainInfo(5)).toBeNull()
    expect(chainInfo('eip155:42220')?.name).toBe('Celo')
    expect(chainIdNumber('eip155:42220')).toBe(42220)
    expect(chainIdNumber('celo')).toBeNull()
  })
})
