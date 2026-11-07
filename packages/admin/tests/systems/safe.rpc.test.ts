import { describe, it, expect } from 'vitest'
import { readSafeOnChain, GUARD_SLOT, FALLBACK_HANDLER_SLOT } from '../../server/systems/safe-rpc.ts'
import { safe, prepareSafeTx } from '../../server/systems/safe.ts'
import { guardedFetch, guardedPost, READ_RPC_METHODS, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { encodeArgs, encodeCall } from '../../lib/abi.mjs'
import { keccak256 } from '../../lib/keccak.mjs'

// L7-D15: a Safe read from the chain when the Safe Transaction Service cannot answer (404 for a Safe it has not indexed,
// 403/429 for its keyless quota). Only eth_blockNumber, eth_getCode and eth_call go out; the Safe's own storage is read
// through its `getStorageAt(uint256,uint256)` view (StorageAccessible), called by eth_call. No test touches the network:
// the node is a fake answering recorded-shape JSON-RPC (the answers are the ABI encodings of a synthetic 2-of-2 Safe
// 1.4.1 with no modules and no guard).
//
// Published: the Safe contracts' storage slots and views,
// https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/GuardManager.sol
//   GUARD_STORAGE_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8 (keccak256("guard_manager.guard.address"))
// https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/FallbackManager.sol
//   FALLBACK_HANDLER_STORAGE_SLOT = 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5
// https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/common/StorageAccessible.sol — getStorageAt(offset, length)
// https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/ModuleManager.sol — getModulesPaginated(start, pageSize), SENTINEL_MODULES = 0x1

const SEPOLIA = 'eip155:11155111'
const RPC = `https://${CHAINS[SEPOLIA]!.rpc}`
const ADDR = '0x5Afe000000000000000000000000000000005afe'
const A1 = '0x00000000000000000000000000000000000000A1'
const A2 = '0x00000000000000000000000000000000000000A2'
const HANDLER = '0x000000000000000000000000000000000000F1A1'
const SINGLETON = '0x00000000000000000000000000000000000051e7'
const NOW = new Date('2026-10-30T12:00:00Z')
const SAFE_SEP = { id: 'council-safe', kind: 'safe', name: 'Council Safe', chain: SEPOLIA, address: ADDR, driver: 'safe' }
const word = (address: string | null) => encodeArgs(['bytes'], [`0x${'0'.repeat(24)}${(address ?? `0x${'0'.repeat(40)}`).slice(2).toLowerCase()}`])

/** The Safe's answers by call data, as a node gives them for `eth_call`. */
const SAFE_ANSWERS: Record<string, string> = {
  [encodeCall('getOwners()', [])]: encodeArgs(['address[]'], [[A1, A2]]),
  [encodeCall('getThreshold()', [])]: encodeArgs(['uint256'], [2n]),
  [encodeCall('nonce()', [])]: encodeArgs(['uint256'], [3n]),
  [encodeCall('VERSION()', [])]: encodeArgs(['string'], ['1.4.1']),
  [encodeCall('getModulesPaginated(address,uint256)', ['0x0000000000000000000000000000000000000001', 10n])]:
    encodeArgs(['address[]', 'address'], [[], '0x0000000000000000000000000000000000000001']),
  [encodeCall('getStorageAt(uint256,uint256)', [BigInt(GUARD_SLOT), 1n])]: word(null),
  [encodeCall('getStorageAt(uint256,uint256)', [BigInt(FALLBACK_HANDLER_SLOT), 1n])]: word(HANDLER),
  [encodeCall('getStorageAt(uint256,uint256)', [0n, 1n])]: word(SINGLETON),
}

type Rpc = { id: number; method: string; params: unknown[] }
/** A node: `code` for eth_getCode, `answers` for eth_call by data (a missing one reverts), block 0x6b1a2c. Every
 *  request is kept, with its method and the RPC methods it carried. */
function node(over: { code?: string; answers?: Record<string, string>; status?: number } = {}) {
  const requests: { url: string; method: string; rpc: string[] }[] = []
  const fetch: FetchLike = async (url, init) => {
    const batch = init.body ? (JSON.parse(init.body) as Rpc[]) : []
    requests.push({ url, method: init.method, rpc: (Array.isArray(batch) ? batch : [batch]).map(r => r.method) })
    if (over.status) return { ok: false, status: over.status, json: async () => ({}) }
    const answers = over.answers ?? SAFE_ANSWERS
    const answer = (r: Rpc) => {
      if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x6b1a2c' }
      if (r.method === 'eth_getCode') return { jsonrpc: '2.0', id: r.id, result: over.code ?? '0x6080604052' }
      const data = (r.params[0] as { data: string }).data
      return data in answers ? { jsonrpc: '2.0', id: r.id, result: answers[data] } : { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted' } }
    }
    return { ok: true, status: 200, json: async () => batch.map(answer) }
  }
  return { requests, fetch }
}

/** The Safe Transaction Service answering `status` for everything, and a node behind it; requests to both, in order. */
function both(status: number, n = node()) {
  const service: string[] = []
  const fetch: FetchLike = async (url, init) => {
    if (new URL(url).host === 'api.safe.global') { service.push(url); return { ok: false, status, headers: { get: () => null }, json: async () => ({}) } }
    return n.fetch(url, init)
  }
  return { fetch, service, requests: n.requests }
}

/** What the reader hands the Safe driver: its guarded GET and POST, and the chain's public RPC URL. */
const ctxWith = (fetch: FetchLike, over: Partial<DriverContext> = {}): DriverContext => {
  const signal = new AbortController().signal
  return {
    fetchJson: guardedFetch(safe, fetch, signal), postJson: guardedPost(safe, fetch, signal),
    rpcUrl: chain => (CHAINS[chain]?.rpc ? `https://${CHAINS[chain]!.rpc}` : null), now: () => NOW, members: [], sleep: async () => {}, ...over,
  }
}

describe('readSafeOnChain: a Safe read by eth_call', () => {
  it('the slots are the Safe contracts\' published ones', () => {
    const hex = (s: string) => `0x${Array.from(keccak256(new TextEncoder().encode(s)), b => b.toString(16).padStart(2, '0')).join('')}`
    expect(GUARD_SLOT).toBe('0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8')
    expect(GUARD_SLOT).toBe(hex('guard_manager.guard.address'))
    expect(FALLBACK_HANDLER_SLOT).toBe('0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5')
    expect(FALLBACK_HANDLER_SLOT).toBe(hex('fallback_manager.handler.address'))
  })

  it('reads owners, threshold, nonce, version, modules, guard, fallback handler and singleton in one batch of reads', async () => {
    const { requests, fetch } = node()
    const r = await readSafeOnChain(ctxWith(fetch), SEPOLIA, ADDR)
    expect(r).toEqual({
      chain: SEPOLIA, address: ADDR, owners: [A1, A2], threshold: 2, nonce: 3, version: '1.4.1', modules: [], guard: null,
      fallbackHandler: HANDLER, singleton: SINGLETON, block: 0x6b1a2c,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe(`${RPC}/`)
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.rpc.every(m => READ_RPC_METHODS.includes(m))).toBe(true)
    expect(requests[0]!.rpc.filter(m => m === 'eth_call')).toHaveLength(8)
  })

  it('an address with no code holds no Safe; a contract that answers none of a Safe\'s views is not one', async () => {
    expect(await readSafeOnChain(ctxWith(node({ code: '0x' }).fetch), SEPOLIA, ADDR)).toEqual({ ok: false, error: 'no Safe at this address on Sepolia', missing: true })
    expect(await readSafeOnChain(ctxWith(node({ answers: {} }).fetch), SEPOLIA, ADDR))
      .toEqual({ ok: false, error: 'the contract at this address on Sepolia is not a Safe the Hub can read (getOwners() reverted)' })
  })

  it('an older Safe without the modules page or getStorageAt: those read as not known, not as a failure (fix r1 M2)', async () => {
    const required = ['getOwners()', 'getThreshold()', 'nonce()', 'VERSION()'].map(sig => encodeCall(sig, []))
    const older = Object.fromEntries(Object.entries(SAFE_ANSWERS).filter(([data]) => required.includes(data)))
    expect(await readSafeOnChain(ctxWith(node({ answers: older }).fetch), SEPOLIA, ADDR)).toEqual({
      chain: SEPOLIA, address: ADDR, owners: [A1, A2], threshold: 2, nonce: 3, version: '1.4.1', modules: null, guard: null,
      fallbackHandler: null, singleton: null, block: 0x6b1a2c, unknown: ['modules', 'guard', 'fallbackHandler', 'singleton'],
    })
  })

  it('a node that cannot be reached, or a context with no RPC, throws', async () => {
    await expect(readSafeOnChain(ctxWith(node({ status: 503 }).fetch), SEPOLIA, ADDR)).rejects.toThrow('answered 503')
    await expect(readSafeOnChain(ctxWith(node().fetch, { rpcUrl: () => null }), SEPOLIA, ADDR)).rejects.toThrow(`no RPC host is known for chain ${SEPOLIA}`)
  })
})

describe('the Safe driver reads the chain when the service does not answer', () => {
  it('declares the chains\' public RPC hosts beside the service, so its reads may go there', () => {
    expect(safe.hosts[0]).toBe('api.safe.global')
    expect(safe.hosts).toContain(CHAINS[SEPOLIA]!.rpc)
  })

  it('a 429 on a read falls back to the chain and carries the note', async () => {
    const { fetch, service, requests } = both(429)
    const r = await safe.read(SAFE_SEP, ctxWith(fetch, { timeLeftMs: () => 8000 }))
    expect(service.length).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    expect(r.ok).toBe(true)
    expect(r.facts).toMatchObject({
      chain: SEPOLIA, network: 'Sepolia', address: ADDR, account: `${SEPOLIA}:${ADDR}`, threshold: 2, owners: 2, nonce: 3, version: '1.4.1',
      source: 'chain', note: 'Read from the chain: the Safe Transaction Service did not answer (429)',
    })
    expect(r.sections.find(s => s.title === 'Signers')!.rows.map(row => row.cells[0])).toEqual([A1, A2])
    expect(r.sections.some(s => s.note === 'Read from the chain: the Safe Transaction Service did not answer (429)')).toBe(true)
  })

  it('a 403 falls back too, and says so', async () => {
    const r = await safe.read(SAFE_SEP, ctxWith(both(403).fetch))
    expect(r.facts).toMatchObject({ source: 'chain', note: 'Read from the chain: the Safe Transaction Service did not answer (403)' })
  })

  it('a 404 and an address with no code is no Safe at this address on Sepolia', async () => {
    await expect(safe.read(SAFE_SEP, ctxWith(both(404, node({ code: '0x' })).fetch))).rejects.toThrow('no Safe at this address on Sepolia')
  })

  it('on a 429 or 403 the service\'s failure stands unless the chain is definite: a contract that is not a Safe does not replace it (fix r1 M2)', async () => {
    for (const status of [429, 403]) {
      const { fetch, requests } = both(status, node({ answers: {} }))
      await expect(safe.read(SAFE_SEP, ctxWith(fetch, { timeLeftMs: () => 8000 }))).rejects.toThrow(`answered ${status}`)
      expect(requests).toHaveLength(1) // the chain was asked
    }
    await expect(safe.read(SAFE_SEP, ctxWith(both(429, node({ code: '0x' })).fetch, { timeLeftMs: () => 8000 }))).rejects.toThrow('no Safe at this address on Sepolia')
  })

  it('on a 404 (the service has no such Safe) the chain\'s answer is said, a contract that is not a Safe included', async () => {
    await expect(safe.read(SAFE_SEP, ctxWith(both(404, node({ answers: {} })).fetch)))
      .rejects.toThrow('the contract at this address on Sepolia is not a Safe the Hub can read (getOwners() reverted)')
  })

  it('a read from the chain does not say how many transactions wait: no `pending`, one chain or several (fix r1 M1)', async () => {
    const one = await safe.read(SAFE_SEP, ctxWith(both(429).fetch, { timeLeftMs: () => 8000 }))
    expect(one.facts).not.toHaveProperty('pending')
  })

  it('a 500 is not a quota or a missing Safe: the service\'s failure stands and the chain is not asked', async () => {
    const { fetch, requests } = both(500)
    await expect(safe.read(SAFE_SEP, ctxWith(fetch))).rejects.toThrow('api.safe.global answered 500')
    expect(requests).toEqual([])
  })

  it('when the chain cannot be read either, the service\'s failure stands', async () => {
    await expect(safe.read(SAFE_SEP, ctxWith(both(404, node({ status: 503 })).fetch))).rejects.toThrow('api.safe.global answered 404')
  })

  it('one chain of several read from the chain: its row says so, the others read from the service', async () => {
    const CELO_API = 'https://api.safe.global/tx-service/celo/api'
    const page = { count: 0, next: null, previous: null, results: [] }
    const celo: Record<string, unknown> = {
      [`${CELO_API}/v1/safes/${ADDR}/`]: { address: ADDR, nonce: '3', threshold: 2, owners: [A1, A2], version: '1.4.1' },
      [`${CELO_API}/v2/safes/${ADDR}/balances/`]: page,
      [`${CELO_API}/v1/safes/${ADDR}/multisig-transactions/?limit=25`]: page,
    }
    const n = node()
    const fetch: FetchLike = async (url, init) => {
      if (url in celo) return { ok: true, status: 200, json: async () => celo[url] }
      if (new URL(url).host === 'api.safe.global') return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }
      return n.fetch(url, init)
    }
    const r = await safe.read({ ...SAFE_SEP, chain: 'eip155:42220', chains: [SEPOLIA] }, ctxWith(fetch, { timeLeftMs: () => 30_000 }))
    const chains = r.facts.chains as Record<string, unknown>[]
    expect(chains[0]).not.toHaveProperty('source')
    expect(chains[0]).toMatchObject({ pending: 0 })
    expect(chains[1]).not.toHaveProperty('pending') // not known: the service holds the waiting transactions (fix r1 M1)
    expect(chains[1]).toMatchObject({ chain: SEPOLIA, ok: true, threshold: 2, nonce: 3, source: 'chain', note: 'Read from the chain: the Safe Transaction Service did not answer (429)' })
    expect(r.sections[0]!.rows[1]!.cells).toEqual(['Sepolia', '2 of 2', 'nonce 3', 'read from the chain'])
  })

  // INT-13's rule (review M-2): a chain read from the chain is not asked for its transfers, which are the service's to say;
  // they are not known, so the read's transfers are null though every other chain's were read whole
  it('one chain of several read from the chain: its transfers are not asked for, and the read\'s transfers are null', async () => {
    const CELO_API = 'https://api.safe.global/tx-service/celo/api'
    const page = { count: 0, next: null, previous: null, results: [] }
    const celo: Record<string, unknown> = {
      [`${CELO_API}/v1/safes/${ADDR}/`]: { address: ADDR, nonce: '3', threshold: 2, owners: [A1, A2], version: '1.4.1' },
      [`${CELO_API}/v2/safes/${ADDR}/balances/`]: page,
      [`${CELO_API}/v1/safes/${ADDR}/multisig-transactions/?limit=25`]: page,
    }
    const asked: string[] = []
    const n = node()
    const fetch: FetchLike = async (url, init) => {
      asked.push(url)
      if (url in celo || url.startsWith(`${CELO_API}/v1/safes/${ADDR}/transfers/`)) return { ok: true, status: 200, json: async () => celo[url] ?? page }
      if (new URL(url).host === 'api.safe.global') return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }
      return n.fetch(url, init)
    }
    const r = await safe.read({ ...SAFE_SEP, chain: 'eip155:42220', chains: [SEPOLIA] }, ctxWith(fetch, { timeLeftMs: () => 30_000 }))
    expect(asked.some(u => u.startsWith(`${CELO_API}/v1/safes/${ADDR}/transfers/`))).toBe(true)
    expect(asked.filter(u => u.includes('/transfers/') && !u.startsWith(CELO_API))).toEqual([])
    expect(r.facts.transfers).toBeNull()
  })
})

describe('prepare reads the chain when the service has no Safe', () => {
  it('prepareSafeTx takes the nonce and version from the chain', async () => {
    const tx = { to: A1, value: '0', data: '0x', operation: 0 as const }
    const p = await prepareSafeTx(SAFE_SEP, SEPOLIA, tx, ctxWith(both(404).fetch))
    expect(p).toMatchObject({ ok: true, payload: { nonce: 3 } })
  })

  it('no code there is a refusal naming the chain', async () => {
    const tx = { to: A1, value: '0', data: '0x', operation: 0 as const }
    expect(await prepareSafeTx(SAFE_SEP, SEPOLIA, tx, ctxWith(both(404, node({ code: '0x' })).fetch)))
      .toEqual({ ok: false, error: 'no Safe at this address on Sepolia' })
  })

  it('an owner action on a Safe the service has not indexed is prepared from the chain\'s owners', async () => {
    const r = await safe.prepareAction!(SAFE_SEP, { action: 'add-owner', params: { owner: '0x00000000000000000000000000000000000000a3' }, via: null }, ctxWith(both(404).fetch))
    expect(r).toMatchObject({ ok: true, steps: [{ safe: { payload: { nonce: 3 } } }] })
  })
})

describe('a Safe Transaction Service API key (ORG_OS_SAFE_API_KEY, L7 Q95)', () => {
  const KEY = 'test-key-not-a-real-one-0000'
  /** The service answering `status`, a node behind it; the authorization header each request carried, by host. */
  function seen(status: number) {
    const headers: { host: string; authorization: string | null }[] = []
    const n = node()
    const fetch: FetchLike = async (url, init) => {
      const host = new URL(url).host
      headers.push({ host, authorization: init.headers.authorization ?? null })
      if (host === 'api.safe.global') return { ok: false, status, headers: { get: () => null }, json: async () => ({}) }
      return n.fetch(url, init)
    }
    return { fetch, headers }
  }
  const readerWith = (fetch: FetchLike) =>
    new SystemReader({ repo: '/nonexistent', fetch, drivers: [{ ...safe, minGapMs: 0 }], now: () => NOW, sleep: async () => {}, safeApiKey: KEY })

  it('goes to the service\'s host as a bearer token, and never to an RPC host', async () => {
    const { fetch, headers } = seen(429)
    const r = await readerWith(fetch).read({ ...SAFE_SEP, id: 'keyed-safe' }, [])
    expect(r.facts).toMatchObject({ source: 'chain' })
    const service = headers.filter(h => h.host === 'api.safe.global')
    const rpc = headers.filter(h => h.host !== 'api.safe.global')
    expect(service.length).toBeGreaterThan(0)
    expect(service.every(h => h.authorization === `Bearer ${KEY}`)).toBe(true)
    expect(rpc).toHaveLength(1)
    expect(rpc[0]!.authorization).toBeNull()
  })

  it('a failed read does not say the key', async () => {
    const r = await readerWith(seen(500).fetch).read({ ...SAFE_SEP, id: 'keyed-safe-failing' }, [])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('api.safe.global answered 500')
    expect(JSON.stringify(r)).not.toContain(KEY)
  })
})
