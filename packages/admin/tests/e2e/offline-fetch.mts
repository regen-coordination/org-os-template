// The fetch the e2e servers read outside systems with (ruling L4-R8): the Safe Transaction Service
// answered from the recorded fixtures in tests/systems/fixtures/safe-celo/ (and the Safe's transfers from
// tests/systems/fixtures/safe-transfers/, so the e2e Treasury draws its fund flow), and every other host refused.
// A screen that depends on the network can then never differ between two runs, or reach out at all.
import { readFileSync } from 'node:fs'
import type { FetchLike } from '../../server/systems/driver.ts'
import { NETWORKS, SAFE_HOST } from '../../server/systems/safe.ts'

const DIR = new URL('../systems/fixtures/safe-celo/', import.meta.url)
const TRANSFERS = new URL('../systems/fixtures/safe-transfers/celo.json', import.meta.url)
const load = (file: string): unknown => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
const rows = (file: string) => (load(file) as { results: unknown[] }).results

/** The Safe the fixtures recorded (on Celo). Any network the service knows answers for it. */
export const RECORDED_SAFE = (load('safe.json') as { address: string }).address

const SLUGS = new Set(Object.values(NETWORKS).map(n => n.slug))
const json = (status: number, body: unknown) => ({ ok: status === 200, status, headers: { get: () => null }, json: async () => body })

/** The service's four reads of the recorded Safe, as `safe.read` asks for them (its transfers whatever the window: the
 *  recording is the service's answer, served as it was recorded, so the flow does not move with the clock); a 404 for any other
 *  path or address on the service (as the service itself would answer); `offline: <host>` for any
 *  other host. */
export const offlineFetch: FetchLike = async url => {
  const u = new URL(url)
  if (u.hostname !== SAFE_HOST) throw new Error(`offline: ${u.hostname}`)
  const m = /^\/tx-service\/([a-z0-9-]+)\/api\/(v1|v2)\/safes\/(0x[0-9a-fA-F]{40})\/(|balances\/|multisig-transactions\/|transfers\/)$/.exec(u.pathname)
  if (!m || !SLUGS.has(m[1]!) || m[3]!.toLowerCase() !== RECORDED_SAFE.toLowerCase()) return json(404, { detail: 'Not found.' })
  const [, , version, , rest] = m
  if (version === 'v1' && rest === '') return json(200, load('safe.json'))
  if (version === 'v2' && rest === 'balances/') return json(200, load('balances.json'))
  if (version === 'v1' && rest === 'multisig-transactions/') {
    const results = [...rows('pending.json'), ...rows('executed.json')]
    return json(200, { count: results.length, next: null, previous: null, results })
  }
  if (version === 'v1' && rest === 'transfers/') return json(200, JSON.parse(readFileSync(TRANSFERS, 'utf8')))
  return json(404, { detail: 'Not found.' })
}
