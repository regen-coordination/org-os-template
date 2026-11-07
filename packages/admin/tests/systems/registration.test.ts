import { describe, it, expect } from 'vitest'
import { daoUriRegistration, DAO_URI_SELECTOR } from '../../server/systems/registration.ts'
import { DRIVERS } from '../../server/systems/drivers.ts'
import { hatsTree } from '../../server/systems/hats.ts'
import { guardedFetch, guardedPost, READ_RPC_METHODS, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { selector } from '../../lib/abi.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'
import { MECHANISMS } from '../../lib/standards/validate.mjs'
import { loadSchema } from '../../lib/data-validate.mjs'

// `daoURI()` is ERC-4824's registration getter; its selector is 0x7034731b (4byte.directory signature id 873770:
// https://www.4byte.directory/api/v1/signatures/873770/). A string answer is laid out as the Solidity ABI spec says:
// an offset word (0x20), a length word, then the bytes padded right to 32:
// https://docs.soliditylang.org/en/v0.8.25/abi-spec.html
const CELO = 'eip155:42220'
const ADDRESS = '0x00000000000000000000000000000000000000a1'
const SYSTEM = { id: 'reg', kind: 'daouri-registration', chain: CELO, address: ADDRESS, driver: 'daouri-registration' }
const URI = 'https://dao.example.org/.well-known/dao.json'
const NOW = new Date('2026-10-29T12:00:00Z')

function abiString(text: string): string {
  const bytes = Buffer.from(text, 'utf8')
  const padded = Buffer.concat([bytes, Buffer.alloc((32 - (bytes.length % 32)) % 32)])
  return '0x' + (32).toString(16).padStart(64, '0') + bytes.length.toString(16).padStart(64, '0') + padded.toString('hex')
}

function world(answer: (r: any) => unknown) {
  const seen: { method: string; url: string; body?: any }[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    seen.push({ method: init.method, url, body })
    const out = body.map((r: any) => r.method === 'eth_blockNumber' ? { jsonrpc: '2.0', id: r.id, result: '0x10' } : { jsonrpc: '2.0', id: r.id, ...(answer(r) as object) })
    return { ok: true, status: 200, json: async () => out }
  }
  const ctx = (): DriverContext => ({
    fetchJson: guardedFetch(daoUriRegistration, fetch, new AbortController().signal),
    postJson: guardedPost(daoUriRegistration, fetch, new AbortController().signal),
    rpcUrl: chain => (CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null),
    now: () => NOW, members: [],
  })
  return { seen, ctx }
}

describe('the daouri-registration driver', () => {
  it('DAO_URI_SELECTOR is the selector of daoURI()', () => {
    expect(DAO_URI_SELECTOR).toBe('0x7034731b')
    expect(selector('daoURI()')).toBe(DAO_URI_SELECTOR)
  })

  it('is registered last, with the hats-tree hosts, and prepares nothing', () => {
    expect(DRIVERS[DRIVERS.length - 1]).toBe(daoUriRegistration)
    expect(daoUriRegistration.name).toBe('daouri-registration')
    expect(daoUriRegistration.hosts).toEqual(hatsTree.hosts)
    for (const k of ['actions', 'outcome', 'prepare', 'prepareAction', 'checkRef'] as const) expect(daoUriRegistration[k]).toBeUndefined()
  })

  it('decodes the ABI string answer into facts.daoURI', async () => {
    const w = world(() => ({ result: abiString(URI) }))
    const read = await daoUriRegistration.read(SYSTEM, w.ctx())
    expect(read.ok).toBe(true)
    expect(read.facts).toEqual({ chain: CELO, account: `${CELO}:0x00000000000000000000000000000000000000A1`, daoURI: URI })
    expect(read.sections).toHaveLength(1)
    expect(read.sections[0].title).toBe('Registration')
    expect(read.sections[0].rows[0].cells).toEqual(['daoURI', URI])
    expect(read.open).toEqual({ url: `https://celo.blockscout.com/address/${ADDRESS}`, embeddable: false })
  })

  it('sends one eth_call to the record\'s address on its chain, and nothing else', async () => {
    const w = world(() => ({ result: abiString(URI) }))
    await daoUriRegistration.read(SYSTEM, w.ctx())
    expect(w.seen).toHaveLength(1)
    expect(w.seen[0].method).toBe('POST')
    expect(w.seen[0].url).toBe('https://forno.celo.org/')
    const calls = w.seen[0].body.filter((r: any) => r.method === 'eth_call')
    expect(calls).toHaveLength(1)
    expect(calls[0].params[0].to.toLowerCase()).toBe(ADDRESS)
    expect(calls[0].params[0].data).toBe(DAO_URI_SELECTOR)
    for (const r of w.seen[0].body) expect(READ_RPC_METHODS).toContain(r.method)
  })

  it('an empty answer reads daoURI null with a warn row', async () => {
    const read = await daoUriRegistration.read(SYSTEM, world(() => ({ result: '0x' })).ctx())
    expect(read.ok).toBe(true)
    expect(read.facts.daoURI).toBeNull()
    expect(read.sections[0].rows).toEqual([{ cells: ['daoURI', 'no daoURI at this address'], attention: 'warn' }])
  })

  it('a chain with no RPC host is a failed read naming it', async () => {
    const w = world(() => ({ result: '0x' }))
    await expect(daoUriRegistration.read({ ...SYSTEM, chain: 'eip155:999999' }, w.ctx())).rejects.toThrow(/^a daoURI registration is read on chains this Hub knows \(.*\); eip155:999999 is not one of them$/)
    expect(w.seen).toHaveLength(0)
  })

  it('a node that refuses the call is a failed read', async () => {
    const w = world(() => ({ error: { code: 3, message: 'execution reverted' } }))
    await expect(daoUriRegistration.read(SYSTEM, w.ctx())).rejects.toThrow(/reverted/)
  })
})

describe('the systems schema: daouri-registration and grant_pool', () => {
  const errors = (e: unknown) => validateEntry('systems', e).filter(p => p.level === 'error')
  const POOL = { id: 'pool', kind: 'gardens-pool', name: 'Pool', chain: CELO, address: ADDRESS }

  it('accepts the kind, requires chain and address, and does not warn', () => {
    const e = { id: 'reg', kind: 'daouri-registration', name: 'Registration', chain: CELO, address: ADDRESS }
    expect(validateEntry('systems', e)).toEqual([])
    expect(errors({ id: 'reg', kind: 'daouri-registration', name: 'R' }).map(p => p.path).sort()).toEqual(['address', 'chain'])
  })

  it('refuses a mechanism DAOIP-5 does not list, and passes grant_pool: false', () => {
    expect(errors({ ...POOL, grant_pool: { mechanism: 'Quadratic voting' } }).length).toBeGreaterThan(0)
    expect(errors({ ...POOL, grant_pool: false })).toEqual([])
    expect(errors({ ...POOL, description: 'Funds seed libraries.' })).toEqual([])
  })

  it('accepts a full grant_pool block', () => {
    expect(errors({ ...POOL, grant_pool: {
      mechanism: 'Conviction Voting', description: 'd', is_open: true, close_date: '2027-01-01T00:00:00Z',
      size: [{ amount: 100, denomination: 'USDC' }], usd: { amount: 100, as_of: '2026-10-29T00:00:00Z' },
      email: 'pool@dao.example.org', image: 'https://dao.example.org/pool.png' } })).toEqual([])
  })

  it('lists exactly the mechanisms the standards validator reads (no drift)', () => {
    const s = loadSchema('systems')
    const copy = s.properties.grant_pool.oneOf.find((o: any) => o.type === 'object').properties.mechanism.enum
    expect(copy).toEqual(MECHANISMS)
    expect(MECHANISMS).toHaveLength(31)
  })
})
