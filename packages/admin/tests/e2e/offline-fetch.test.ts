import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { offlineFetch, RECORDED_SAFE } from './offline-fetch.mts'
import { safe } from '../../server/systems/safe.ts'
import { guardedFetch } from '../../server/systems/driver.ts'

const DIR = new URL('../systems/fixtures/safe-celo/', import.meta.url)
const load = (file: string): unknown => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
const API = 'https://api.safe.global/tx-service/celo/api'
const init = { method: 'GET' as const, headers: {}, redirect: 'error' as const, signal: new AbortController().signal }
const get = async (url: string) => { const r = await offlineFetch(url, init); return { ok: r.ok, status: r.status, body: await r.json() } }

describe('the offline fetch the e2e servers read outside systems with', () => {
  it('serves the recorded Safe as the Safe Transaction Service answers it', async () => {
    expect(RECORDED_SAFE).toBe((load('safe.json') as { address: string }).address)
    expect(await get(`${API}/v1/safes/${RECORDED_SAFE}/`)).toEqual({ ok: true, status: 200, body: load('safe.json') })
    expect(await get(`${API}/v2/safes/${RECORDED_SAFE}/balances/`)).toEqual({ ok: true, status: 200, body: load('balances.json') })
    const list = await get(`${API}/v1/safes/${RECORDED_SAFE}/multisig-transactions/?limit=25`)
    const rows = (f: string) => (load(f) as { results: unknown[] }).results
    const results = [...rows('pending.json'), ...rows('executed.json')]
    expect(list.body).toEqual({ count: results.length, next: null, previous: null, results })
    const transfers = JSON.parse(readFileSync(new URL('../systems/fixtures/safe-transfers/celo.json', import.meta.url), 'utf8'))
    expect(await get(`${API}/v1/safes/${RECORDED_SAFE}/transfers/?limit=100&execution_date__gte=2026-07-18T09%3A00%3A00Z`)).toEqual({ ok: true, status: 200, body: transfers })
  })

  it('answers the address in any case, and on any network the service knows', async () => {
    expect((await get(`https://api.safe.global/tx-service/gno/api/v1/safes/${RECORDED_SAFE.toLowerCase()}/`)).status).toBe(200)
  })

  it('is a 404 for another address or another path on the service, as the service would be', async () => {
    expect(await get(`${API}/v1/safes/0x0000000000000000000000000000000000000001/`)).toMatchObject({ ok: false, status: 404 })
    expect(await get(`${API}/v1/about/`)).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses every other host, by name', async () => {
    await expect(offlineFetch('https://example.org/x', init)).rejects.toThrow('offline: example.org')
    await expect(offlineFetch('https://app.safe.global/home', init)).rejects.toThrow('offline: app.safe.global')
  })

  it('reads through the Safe driver like the network would', async () => {
    const SAFE = { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: RECORDED_SAFE, driver: 'safe', section: 'organization/treasury' }
    const r = await safe.read(SAFE, { fetchJson: guardedFetch(safe, offlineFetch, new AbortController().signal), now: () => new Date('2026-10-16T09:00:00Z'), members: [], sleep: async () => {} })
    expect(r.ok).toBe(true)
    expect(r.facts).toMatchObject({ threshold: 2, owners: 4, nonce: 8, pending: 1 })
    // the Treasury's fund flow: the recording's four value transfers, two in and two out
    expect((r.facts.transfers as { to: string }[]).map(t => t.to === RECORDED_SAFE)).toEqual([true, true, false, false])
  })
})
