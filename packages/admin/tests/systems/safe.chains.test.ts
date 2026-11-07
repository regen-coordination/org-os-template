import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { safe, chainsOf, signerName, NETWORKS, DISAGREE_LEVEL } from '../../server/systems/safe.ts'
import { guardedFetch, type FetchLike } from '../../server/systems/driver.ts'
import { systemAttention } from '../../server/systems/reader.ts'
import { checksumAddress, caip10 } from '../../lib/caip.mjs'

// Synthetic fixtures in the Transaction Service's exact shapes (see tests/systems/fixtures/safe-celo/, recorded
// from a real Safe on 2026-10-29): a 4-of-8 Safe on seven chains, Optimism with a ninth owner and a threshold of 5.
const DIR = new URL('./fixtures/safe-chains/', import.meta.url)
const load = (slug: string) => JSON.parse(readFileSync(new URL(`${slug}.json`, DIR), 'utf8')) as { info: unknown; balances: unknown; transactions: unknown }
// EIP-55 form of 0x5afe…c0de, written out (not computed here).
const ADDR = '0x5aFE00000000000000000000000000000000C0De'
const A1 = '0x00000000000000000000000000000000000000A1'
const A9 = '0x00000000000000000000000000000000000000A9'
const SLUGS = ['celo', 'eth', 'oeth', 'arb1', 'gno', 'pol', 'base']
const SLUG_OF: Record<string, string> = {
  'eip155:42220': 'celo', 'eip155:1': 'eth', 'eip155:10': 'oeth', 'eip155:42161': 'arb1', 'eip155:100': 'gno', 'eip155:137': 'pol', 'eip155:8453': 'base',
}
const NOW = new Date('2026-10-29T12:00:00Z')

function service(over: { missing?: string[]; broken?: string[]; all404?: boolean } = {}) {
  const routes: Record<string, unknown> = {}
  for (const slug of SLUGS) {
    const f = load(slug)
    const api = `https://api.safe.global/tx-service/${slug}/api`
    routes[`${api}/v1/safes/${ADDR}/`] = f.info
    routes[`${api}/v2/safes/${ADDR}/balances/`] = f.balances
    routes[`${api}/v1/safes/${ADDR}/multisig-transactions/?limit=25`] = f.transactions
  }
  const calls: { url: string; method: string }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method })
    const slug = /tx-service\/([a-z0-9]+)\//.exec(url)?.[1] ?? ''
    if (over.broken?.includes(slug)) return { ok: false, status: 500, json: async () => ({}) }
    const body = over.all404 || over.missing?.includes(slug) ? undefined : routes[url]
    return body === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => body }
  }
  return { calls, fetch }
}

const SAFE7 = { id: 'treasury', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: ADDR, driver: 'safe',
  chains: ['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453'] }
const MEMBERS = [{ id: 'ana', name: 'Ana', handles: { address: A1.toLowerCase() } }]
const readWith = (system: Record<string, unknown>, fetch: FetchLike, ctx: { sleep?: (ms: number) => Promise<void> } = {}) =>
  safe.read(system, { fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: MEMBERS, sleep: async () => {}, ...ctx })

describe('the safe driver on several chains', () => {
  it('reads every chain, four GETs each (the fourth its transfers), one at a time with the gap', async () => {
    const { calls, fetch } = service(); const sleeps: number[] = []
    const r = await readWith(SAFE7, fetch, { sleep: async ms => { sleeps.push(ms) } })
    expect(calls).toHaveLength(28); expect(sleeps).toEqual(Array(27).fill(1000)); expect(calls.every(c => c.method === 'GET')).toBe(true)
    expect(calls.filter(c => c.url.includes('/transfers/?limit=100&execution_date__gte=2026-07-31T12%3A00%3A00Z'))).toHaveLength(7)
    expect((r.facts.chains as { chain: string }[]).map(c => c.chain)).toEqual(['eip155:42220', ...SAFE7.chains])
  })

  it('the head facts: counts from the first chain read, pending summed, no chain called home', async () => {
    const r = await readWith(SAFE7, service().fetch)
    expect(r).toMatchObject({ ok: true, open: { embeddable: false } })
    expect(r.facts).toMatchObject({
      chain: 'eip155:42220', address: ADDR, account: `eip155:42220:${ADDR}`, shortAddress: '0x5aFE…C0De', network: 'Celo',
      threshold: 4, owners: 8, nonce: 9, pending: 1, version: '1.3.0+L2', agree: false,
    })
    expect(JSON.stringify([r.facts, r.sections.map(x => [x.note, x.rows.map(row => row.cells)])])).not.toMatch(/home/i)
  })

  it('the five sections, in order', async () => {
    const r = await readWith(SAFE7, service().fetch)
    expect(r.sections.map(s => s.title)).toEqual(['Chains', 'Waiting on signers', 'Balances', 'Signers', 'Executed'])
    const waiting = r.sections[1]!
    expect(waiting.rows).toHaveLength(1)
    expect(waiting.rows[0]).toMatchObject({ cells: ['Celo', '#9', 'transfer → 0x0000…00C1', '1 of 4 signatures', '4 h'], attention: 'alert' })
    expect(waiting.rows[0]!.href).toMatch(/^https:\/\/app\.safe\.global\/transactions\/tx\?safe=celo:0x5aFE/)
    const balances = r.sections[2]!
    expect(balances.rows).toHaveLength(14)
    expect(balances.rows[0]).toEqual({ cells: ['Celo', 'CELO', '0.9'] })
    expect(balances.rows[1]).toEqual({ cells: ['Celo', 'tUSD', '2.5'] })
    const executed = r.sections[4]!
    // the latest five by execution date across the seven chains
    expect(executed.rows.map(row => row.cells)).toEqual([
      ['Celo', '#8', 'transfer → 0x0000…00d8', '27 h', 'ok'],
      ['Ethereum', '#13', 'transfer → 0x0000…00D3', '2 d', 'ok'],
      ['Optimism', '#10', 'addOwnerWithThreshold → 0x0000…00d0', '3 d', 'ok'],
      ['Arbitrum', '#5', 'transfer → 0x0000…00D5', '4 d', 'failed'],
      ['Gnosis', '#20', 'multiSend → 0x0000…00d0', '5 d', 'ok'],
    ])
  })

  it('flags the chain that disagrees, and the owner that is not everywhere', async () => {
    const r = await readWith(SAFE7, service().fetch)
    const chains = r.sections.find(s => s.title === 'Chains')!
    expect(DISAGREE_LEVEL).toBe('alert')
    expect(chains.note).toBe('chains disagree: Optimism')
    expect(chains.rows.map(row => row.cells[0])).toEqual(['Celo', 'Ethereum', 'Optimism', 'Arbitrum', 'Gnosis', 'Polygon', 'Base'])
    expect(chains.rows.find(row => row.cells[0] === 'Optimism')).toMatchObject({ cells: ['Optimism', '5 of 9', 'nonce 11', '0 waiting'], attention: 'alert', refs: [`eip155:10:${ADDR}`] })
    expect(chains.rows.find(row => row.cells[0] === 'Celo')).toMatchObject({ cells: ['Celo', '4 of 8', 'nonce 9', '1 waiting'], href: `https://app.safe.global/home?safe=celo:${ADDR}` })
    expect(chains.rows.filter(row => row.attention).map(row => row.cells[0])).toEqual(['Optimism'])
    const signers = r.sections.find(s => s.title === 'Signers')!
    expect(signers.rows).toHaveLength(9)
    expect(signers.rows[0]).toMatchObject({ cells: [A1, 'Ana', 'all chains'], refs: [`eip155:42220:${A1}`] })
    expect(signers.rows.at(-1)).toMatchObject({ cells: [A9, '—', 'Optimism'], attention: 'alert', refs: [`eip155:42220:${A9}`] })
    expect(signers.rows.filter(row => row.attention)).toHaveLength(1)
    expect(r.facts.agree).toBe(false)
    // systemAttention names the first section holding alert rows (order: Chains, Waiting on signers, …). Chains is first
    // and holds one alert row (Optimism); Waiting on signers also holds one, but a later section never outranks it.
    expect(systemAttention(r)).toEqual({ level: 'alert', text: 'Chains: 1' })
  })

  it('chains that agree say so, and raise only what is waiting', async () => {
    const { fetch } = service()
    const r = await readWith({ ...SAFE7, chains: ['eip155:1', 'eip155:42161'] }, fetch)
    const chains = r.sections.find(s => s.title === 'Chains')!
    expect(chains.note).toBe('all 3 chains agree')
    expect(chains.rows.every(row => row.attention === undefined)).toBe(true)
    expect(r.facts.agree).toBe(true)
    // no section but Waiting on signers holds an alert or warn row, with one alert row there (Celo's #9)
    expect(systemAttention(r)).toEqual({ level: 'alert', text: 'Waiting on signers: 1' })
  })

  it('a chain without the Safe is a warn row, not a failed read', async () => {
    const r = await readWith(SAFE7, service({ missing: ['base'] }).fetch)
    expect(r.ok).toBe(true)
    const base = r.sections.find(s => s.title === 'Chains')!.rows.find(row => row.cells[0] === 'Base')!
    expect(base).toMatchObject({ cells: ['Base', 'no Safe at this address on Base'], attention: 'warn' })
    expect((r.facts.chains as { chain: string }[]).find(c => c.chain === 'eip155:8453')).toMatchObject({ ok: false, error: 'no Safe at this address on Base' })
    expect(r.facts.agree).toBe(false)
    // a signer is "everywhere" over the chains that were read
    expect(r.sections.find(s => s.title === 'Signers')!.rows[0]!.cells[2]).toBe('all chains')
  })

  it('a chain whose requests fail is a warn row too', async () => {
    const r = await readWith(SAFE7, service({ broken: ['pol'] }).fetch)
    expect(r.ok).toBe(true)
    const row = r.sections.find(s => s.title === 'Chains')!.rows.find(x => x.cells[0] === 'Polygon')!
    expect(row.cells[1]).toMatch(/^read failed: /)
    expect(row.attention).toBe('warn')
  })

  it('every chain failing fails the read with the first sentence', async () => {
    await expect(readWith(SAFE7, service({ all404: true }).fetch)).rejects.toThrow('no Safe at this address on Celo')
  })

  it('every address it emits is CAIP-10, checksummed', async () => {
    const r = await readWith(SAFE7, service().fetch)
    const CAIP10 = /^eip155:\d+:0x[0-9a-fA-F]{40}$/
    expect(r.facts.account).toBe(`eip155:42220:${ADDR}`)
    for (const c of r.facts.chains as { chain: string; account: string; owners: string[] }[]) {
      expect(c.account).toMatch(CAIP10); expect(c.account).toBe(caip10(c.chain, ADDR))
      for (const o of c.owners) { expect(o).toMatch(CAIP10); expect(o).toBe(caip10(c.chain, checksumAddress(o.split(':')[2]!))) }
    }
    for (const s of r.sections) for (const row of s.rows) for (const ref of row.refs ?? []) { expect(ref).toMatch(CAIP10); expect(ref).toBe(caip10(ref.split(':').slice(0, 2).join(':'), ref.split(':')[2]!)) }
  })

  it('gives a seven-chain Safe 56 s and a one-chain Safe 11 s: 0.6\'s 8 s for its three requests, then 1.5 s for each more', () => {
    expect(safe.timeoutMs!(SAFE7)).toBe(56_000)
    expect(safe.timeoutMs!({ ...SAFE7, chains: undefined })).toBe(11_000)
  })

  it('refuses a chain with no Safe service, or not CAIP-2, before fetching', async () => {
    for (const chains of [['eip155:999'], ['celo']]) {
      const { calls, fetch } = service()
      await expect(readWith({ ...SAFE7, chains }, fetch)).rejects.toThrow()
      expect(calls).toEqual([])
    }
    expect(() => chainsOf({ ...SAFE7, chains: ['celo'] })).toThrow('"celo" is not a CAIP-2 chain id')
    expect(() => chainsOf({ ...SAFE7, chains: ['eip155:999'] })).toThrow(/eip155:999/)
  })

  it('chainsOf lists the record chain first, without repeats', () => {
    expect(chainsOf(SAFE7)).toEqual(['eip155:42220', ...SAFE7.chains])
    expect(chainsOf({ ...SAFE7, chains: ['eip155:1', 'eip155:42220', 'eip155:1'] })).toEqual(['eip155:42220', 'eip155:1'])
    expect(chainsOf({ ...SAFE7, chains: undefined })).toEqual(['eip155:42220'])
  })

  it('NETWORKS holds the eight chains with a Safe service', () => {
    expect(Object.keys(NETWORKS)).toHaveLength(8)
    expect(NETWORKS['eip155:137']).toEqual({ slug: 'pol', name: 'Polygon', native: 'POL' })
  })

  it('signerName is exported and matches without case', () => {
    expect(signerName(A9.toLowerCase(), 'eip155:10', [{ id: 'x', name: 'Xi', handles: { address: `eip155:10:${A9}` } }])).toBe('Xi')
    expect(signerName(A9, 'eip155:1', [{ id: 'x', name: 'Xi', handles: { address: `eip155:10:${A9}` } }])).toBeNull()
  })

  it('a one-record chain reads as in 0.6, with account added', async () => {
    const { calls, fetch } = service()
    const r = await readWith({ ...SAFE7, chains: undefined }, fetch)
    expect(calls).toHaveLength(4)
    expect(r.sections.map(s => s.title)).toEqual(['Waiting on signers', 'Balances', 'Signers', 'Executed'])
    // these synthetic chains hold no transfers list (the service's 404 here): the transfers were not read
    expect(r.facts).toEqual({ chain: 'eip155:42220', network: 'Celo', address: ADDR, account: `eip155:42220:${ADDR}`, shortAddress: '0x5aFE…C0De', threshold: 4, owners: 8, nonce: 9, pending: 1, version: '1.3.0+L2', transfers: null })
  })
})
