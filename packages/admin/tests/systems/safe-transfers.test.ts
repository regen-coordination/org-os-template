import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { safe } from '../../server/systems/safe.ts'
import { NATIVE_TOKEN, TRANSFER_PAGES, TRANSFER_PAGE_SIZE, TRANSFER_WINDOW_DAYS, TransfersIncomplete, readTransfers, transferOf, transfersUrl, windowStart, type Transfer } from '../../server/systems/safe-transfers.ts'
import { guardedFetch, type FetchLike } from '../../server/systems/driver.ts'

// The Safe's transfers (rulings Q59, E-85), read offline. The recording, tests/systems/fixtures/safe-transfers/celo.json,
// is the service's answer to GET /api/v1/safes/<address>/transfers/ for the Safe the safe-celo recording holds. It was
// written by hand to the service's documented shape (count, next, previous, results of type, executionDate,
// transactionHash, from, to, value, tokenAddress, tokenInfo), keeping only the fields the read uses: the one fetch made
// for it on 2026-10-31 was answered 429 "Monthly quota exceeded". Counterparties are placeholders (0x…b1); the outgoing
// pair is the executed multiSend of safe-celo/executed.json. It also holds what the read must not draw (C12 review I-1,
// I-2): an NFT, a token of no trusted decimals, a zero-value "transfer from the Safe" to a look-alike of 0x…b3 (address
// poisoning), an untrusted "USDC" at another address, the CELO movement indexed again through GoldToken, and a row from
// before the window (a service that ignored its filter).
const load = (dir: string, file: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${dir}/${file}`, import.meta.url), 'utf8'))
const RECORDING = load('safe-transfers', 'celo.json') as { results: Record<string, unknown>[]; next: string | null }
const ADDR = '0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60'
const API = 'https://api.safe.global/tx-service/celo/api'
const NOW = new Date('2026-10-16T09:00:00Z')
const CELO = 'eip155:42220'
const TRANSFERS = `${API}/v1/safes/${ADDR}/transfers/?limit=100&execution_date__gte=2026-07-18T09%3A00%3A00Z`

const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a'
/** What the read makes of the recording: four of its ten rows move value the Hub draws. */
const READ: Transfer[] = [
  { chain: CELO, from: '0x00000000000000000000000000000000000000B1', to: ADDR, value: '2500000000000000000000', unit: 'cUSD', decimals: 18, token: CUSD, at: '2026-10-12T14:03:11Z', txHash: `0x${'7a1e'.repeat(16)}` },
  { chain: CELO, from: '0x00000000000000000000000000000000000000b2', to: ADDR, value: '10000000000000000000', unit: 'CELO', decimals: 18, token: null, at: '2026-09-30T10:12:09Z', txHash: `0x${'7a3e'.repeat(16)}` },
  { chain: CELO, from: ADDR, to: '0x00000000000000000000000000000000000000b3', value: '600000000000000000000', unit: 'cUSD', decimals: 18, token: CUSD, at: '2026-09-15T14:01:17Z', txHash: '0x337a578e281306764c2d818188a24a000fbaa9ca32d035f9363bac1c45f1711f' },
  { chain: CELO, from: ADDR, to: '0x00000000000000000000000000000000000000B4', value: '412500000000000000000', unit: 'cUSD', decimals: 18, token: CUSD, at: '2026-09-15T14:01:17Z', txHash: '0x337a578e281306764c2d818188a24a000fbaa9ca32d035f9363bac1c45f1711f' },
]
const row = (pred: (r: Record<string, unknown>) => boolean) => RECORDING.results.find(pred)!

const page = (results: unknown[], next: string | null = null) => ({ count: results.length, next, previous: null, results })
/** A getter that answers by URL and keeps what it was asked. */
function getter(routes: Record<string, unknown>) {
  const asked: string[] = []
  const get = async (url: string) => {
    asked.push(url)
    if (!(url in routes)) throw new Error(`404 ${url}`)
    return routes[url]
  }
  return { asked, get }
}
const AT = { api: API, address: ADDR, chain: CELO, native: 'CELO' }
const ALWAYS = () => Infinity

describe('the Safe transfers read', () => {
  it('asks the service once for the 90-day window, on its host, and keeps what moves value', async () => {
    const { asked, get } = getter({ [TRANSFERS]: RECORDING })
    expect(await readTransfers(get, AT, NOW, ALWAYS, 0)).toEqual(READ)
    expect(asked).toEqual([TRANSFERS])
    expect(TRANSFER_WINDOW_DAYS).toBe(90)
    expect(windowStart(NOW)).toBe('2026-07-18T09:00:00Z')
    expect(transfersUrl(API, ADDR, windowStart(NOW))).toBe(TRANSFERS)
  })

  it('pages with an offset while the service says there is more, and reads the window whole within the cap', async () => {
    const since = windowStart(NOW)
    const one = RECORDING.results[0]!
    const { asked, get } = getter({
      [transfersUrl(API, ADDR, since)]: page([one], 'https://api.safe.global/next'), [transfersUrl(API, ADDR, since, 100)]: page([one]),
    })
    expect(await readTransfers(get, AT, NOW, ALWAYS, 0)).toHaveLength(2)
    expect(TRANSFER_PAGES).toBe(2)
    expect(asked).toEqual([transfersUrl(API, ADDR, since), `${transfersUrl(API, ADDR, since)}&offset=100`])
  })

  it('a window the cap cannot hold is not read: never part of it as the whole (I-1)', async () => {
    const since = windowStart(NOW)
    const routes: Record<string, unknown> = {}
    for (let p = 0; p < TRANSFER_PAGES + 1; p++) routes[transfersUrl(API, ADDR, since, p * TRANSFER_PAGE_SIZE)] = page([RECORDING.results[0]!], 'https://api.safe.global/next')
    const { asked, get } = getter(routes)
    await expect(readTransfers(get, AT, NOW, ALWAYS, 0)).rejects.toThrow(TransfersIncomplete)
    expect(asked).toHaveLength(TRANSFER_PAGES) // the page past the cap is not asked
  })

  it('drops a row from before the window, whatever the service\'s filter did (I-1)', async () => {
    const old = row(r => r.executionDate === '2026-07-01T00:00:00Z')
    expect(transferOf(old as never, CELO, 'CELO')).not.toBeNull() // a good row in itself
    const { get } = getter({ [TRANSFERS]: page([old]) })
    expect(await readTransfers(get, AT, NOW, ALWAYS, 0)).toEqual([])
  })

  it('draws nothing a stranger can send: a zero-value row, an untrusted token, a look-alike "USDC" (I-2)', () => {
    const poisoned = row(r => r.value === '0')
    expect(poisoned.from).toBe(ADDR) // "from the Safe", to an address with 0x…b3's ends
    expect(transferOf(poisoned as never, CELO, 'CELO')).toBeNull()
    const fake = row(r => (r.tokenInfo as { symbol?: string } | null)?.symbol === 'USDC')
    expect(transferOf(fake as never, CELO, 'CELO')).toBeNull()
    // the same row, were the service to trust that token, keys on its own address, never on "USDC"
    expect(transferOf({ ...fake, tokenInfo: { symbol: 'USDC', decimals: 6, trusted: true } } as never, CELO, 'CELO'))
      .toMatchObject({ unit: 'USDC', token: '0x00000000000000000000000000000000000000C9' })
    // a trusted token with no trusted flag, or the flag false, is not drawn
    const good = RECORDING.results[0]!
    expect(transferOf({ ...good, tokenInfo: { symbol: 'cUSD', decimals: 18 } } as never, CELO, 'CELO')).toBeNull()
    expect(transferOf({ ...good, tokenInfo: { symbol: 'cUSD', decimals: 18, trusted: false } } as never, CELO, 'CELO')).toBeNull()
  })

  it('counts a CELO movement once when the service indexes it both natively and through GoldToken (I-2)', async () => {
    const native = row(r => r.type === 'ETHER_TRANSFER' && r.executionDate === '2026-09-30T10:12:09Z')
    const viaToken = row(r => r.tokenAddress === NATIVE_TOKEN[CELO])
    const { get } = getter({ [TRANSFERS]: page([native, viaToken]) })
    expect(await readTransfers(get, AT, NOW, ALWAYS, 0)).toEqual([READ[1]])
    // read through GoldToken alone, it is CELO, the native unit, not a token
    const alone = getter({ [TRANSFERS]: page([viaToken]) })
    expect(await readTransfers(alone.get, AT, NOW, ALWAYS, 0)).toEqual([READ[1]])
  })

  it('does not start a page the read has no time left for', async () => {
    const { asked, get } = getter({ [TRANSFERS]: RECORDING })
    await expect(readTransfers(get, AT, NOW, () => 1_000, 2_500)).rejects.toThrow('no time was left in this read for the transfers')
    expect(asked).toEqual([])
  })

  it('refuses an answer that is not a page of results', async () => {
    const { get } = getter({ [TRANSFERS]: { detail: 'odd' } })
    await expect(readTransfers(get, AT, NOW, ALWAYS, 0)).rejects.toThrow('the transfers were answered in a shape the Hub does not read')
  })

  it('never guesses an amount: no value, no decimals, no time, a bad hash or a bad address is left out', () => {
    const good = RECORDING.results[0]!
    expect(transferOf(good as never, CELO, 'CELO')).toEqual(READ[0])
    for (const over of [{ value: null }, { value: '1.5' }, { value: '0' }, { tokenInfo: { symbol: 'X', trusted: true } }, { executionDate: 'soon' }, { transactionHash: '0x12' },
      { from: 'nobody' }, { to: null }, { tokenAddress: null }, { type: 'ERC721_TRANSFER' }, { type: 'SOMETHING_ELSE' }]) {
      expect(transferOf({ ...good, ...over } as never, CELO, 'CELO')).toBeNull()
    }
    // a token without a symbol is named by its address
    expect(transferOf({ ...good, tokenInfo: { decimals: 6, trusted: true } } as never, CELO, 'CELO')).toMatchObject({ unit: '0x765D…282a', decimals: 6, token: CUSD })
  })
})

describe('the Safe driver reads the transfers beside the Safe', () => {
  const SAFE = { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: CELO, address: ADDR, driver: 'safe' }
  const safeCelo = (file: string) => load('safe-celo', file)
  const routes = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    [`${API}/v1/safes/${ADDR}/`]: safeCelo('safe.json'), [`${API}/v2/safes/${ADDR}/balances/`]: safeCelo('balances.json'),
    [`${API}/v1/safes/${ADDR}/multisig-transactions/?limit=25`]: page([...(safeCelo('pending.json') as { results: unknown[] }).results]),
    [TRANSFERS]: RECORDING, ...over,
  })
  const serve = (r: Record<string, unknown>, status: Record<string, number> = {}) => {
    const calls: { url: string; method: string }[] = []
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, method: init.method })
      if (status[url]) return { ok: false, status: status[url]!, json: async () => ({}) }
      return r[url] === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => r[url] }
    }
    return { calls, fetch }
  }
  const read = (system: Record<string, unknown>, fetch: FetchLike) =>
    safe.read(system, { fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: [], sleep: async () => {} })

  it('as a fourth GET after the gap, its facts the transfers newest first', async () => {
    const { calls, fetch } = serve(routes())
    const r = await read(SAFE, fetch)
    expect(calls.map(c => c.url)).toEqual([`${API}/v1/safes/${ADDR}/`, `${API}/v2/safes/${ADDR}/balances/`, `${API}/v1/safes/${ADDR}/multisig-transactions/?limit=25`, TRANSFERS])
    expect(calls.every(c => c.method === 'GET')).toBe(true)
    expect(r.facts.transfers).toEqual(READ)
    expect(r.sections.map(s => s.title)).toEqual(['Waiting on signers', 'Balances', 'Signers', 'Executed'])
  })

  it('a window with nothing in it is an empty list', async () => {
    const r = await read(SAFE, serve(routes({ [TRANSFERS]: page([]) })).fetch)
    expect(r.facts.transfers).toEqual([])
  })

  it('transfers that cannot be read are null, and the Safe is still read', async () => {
    for (const status of [500, 429]) {
      const r = await read(SAFE, serve(routes(), { [TRANSFERS]: status }).fetch)
      expect(r.ok).toBe(true)
      expect(r.facts.transfers).toBeNull()
      expect(r.facts.threshold).toBe(2)
    }
  })

  it('on several chains: every chain asked, one list newest first; a chain whose transfers fail makes it null', async () => {
    const GNO = 'https://api.safe.global/tx-service/gno/api'
    const gnoTransfer = { ...RECORDING.results[2], executionDate: '2026-10-01T00:00:00Z' }
    // readMany checksums every owner: the recording's placeholder owners in lower case, the same on both chains
    const info = { ...(safeCelo('safe.json') as { owners: string[] }), owners: (safeCelo('safe.json') as { owners: string[] }).owners.map(o => o.toLowerCase()) }
    const gno = {
      [`${API}/v1/safes/${ADDR}/`]: info,
      [`${GNO}/v1/safes/${ADDR}/`]: info, [`${GNO}/v2/safes/${ADDR}/balances/`]: page([]),
      [`${GNO}/v1/safes/${ADDR}/multisig-transactions/?limit=25`]: page([]),
      [`${GNO}/v1/safes/${ADDR}/transfers/?limit=100&execution_date__gte=2026-07-18T09%3A00%3A00Z`]: page([gnoTransfer]),
    }
    const both = { ...SAFE, chains: ['eip155:100'] }
    const r = await read(both, serve({ ...routes(), ...gno }).fetch)
    const got = r.facts.transfers as Transfer[]
    expect(got.map(t => [t.chain, t.unit, t.at])).toEqual([
      [CELO, 'cUSD', '2026-10-12T14:03:11Z'], ['eip155:100', 'xDAI', '2026-10-01T00:00:00Z'], [CELO, 'CELO', '2026-09-30T10:12:09Z'],
      [CELO, 'cUSD', '2026-09-15T14:01:17Z'], [CELO, 'cUSD', '2026-09-15T14:01:17Z'],
    ])
    const broken = await read(both, serve({ ...routes(), ...gno }, { [`${GNO}/v1/safes/${ADDR}/transfers/?limit=100&execution_date__gte=2026-07-18T09%3A00%3A00Z`]: 500 }).fetch)
    expect(broken.ok).toBe(true)
    expect(broken.facts.transfers).toBeNull()
  })

  // C12 review I-3, I-1: the transfers come last and are never retried, so a rate limit there costs the Safe nothing
  describe('on several chains', () => {
    const GNO = 'https://api.safe.global/tx-service/gno/api'
    const GNO_TRANSFERS = `${GNO}/v1/safes/${ADDR}/transfers/?limit=100&execution_date__gte=2026-07-18T09%3A00%3A00Z`
    const info = { ...(safeCelo('safe.json') as { owners: string[] }), owners: (safeCelo('safe.json') as { owners: string[] }).owners.map(o => o.toLowerCase()) }
    const world = () => ({
      ...routes(), [`${API}/v1/safes/${ADDR}/`]: info, [`${GNO}/v1/safes/${ADDR}/`]: info, [`${GNO}/v2/safes/${ADDR}/balances/`]: page([]),
      [`${GNO}/v1/safes/${ADDR}/multisig-transactions/?limit=25`]: page([]), [GNO_TRANSFERS]: page([]),
    })
    const both = { ...SAFE, chains: ['eip155:100'] }

    it('reads every chain\'s own three first, then the transfers; a 429 there is not retried, the Safe is read, the transfers null', async () => {
      const { calls, fetch } = serve(world(), { [TRANSFERS]: 429, [GNO_TRANSFERS]: 429 })
      const sleeps: number[] = []
      const r = await safe.read(both, { fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: [],
        sleep: async ms => { sleeps.push(ms) }, timeLeftMs: () => 60_000 })
      expect(calls.map(c => (c.url.includes('/transfers/') ? 'transfers' : 'own'))).toEqual(['own', 'own', 'own', 'own', 'own', 'own', 'transfers', 'transfers'])
      expect(sleeps).toEqual(Array(7).fill(1000)) // the gap only: no wait for a retry
      expect(r.ok).toBe(true)
      expect(r.facts).toMatchObject({ threshold: 2, agree: true, transfers: null })
    })

    it('a chain whose Safe could not be read leaves the transfers unread; a chain with no Safe there does not (I-1)', async () => {
      const failed = await read(both, serve(world(), { [`${GNO}/v1/safes/${ADDR}/`]: 500 }).fetch)
      expect(failed.ok).toBe(true)
      expect(failed.facts.transfers).toBeNull()
      const none: Record<string, unknown> = world()
      delete none[`${GNO}/v1/safes/${ADDR}/`]
      const missing = await read(both, serve(none).fetch)
      expect(missing.facts.transfers).toEqual(READ)
    })

    it('a chain whose window the cap cannot hold leaves the transfers unread (I-1)', async () => {
      const full = page([RECORDING.results[0]!], 'https://api.safe.global/next')
      const r = await read(both, serve({ ...world(), [GNO_TRANSFERS]: full, [`${GNO_TRANSFERS}&offset=100`]: full }).fetch)
      expect(r.facts.transfers).toBeNull()
    })
  })

  it('gives the read the time the transfers need: 3 requests and 2 pages a chain, after the gap', () => {
    expect(safe.timeoutMs!(SAFE)).toBe(8_000 + 2 * 1_500)
    expect(safe.timeoutMs!({ ...SAFE, chains: ['eip155:100'] })).toBe(8_000 + 7 * 1_500)
  })
})
