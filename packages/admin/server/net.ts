import { lookup as dnsLookup } from 'node:dns/promises'
import type { FetchLike } from './systems/driver.ts'

/** The one real network call. Under a test run (vitest sets VITEST) it refuses, so a test that
 *  forgot to inject a fake fetch fails loudly instead of reaching out (ruling S13). */
export const networkFetch: FetchLike = async (url, init) => {
  if (process.env.VITEST) throw new Error(`no network in tests: ${url} (inject a fake fetch)`)
  return globalThis.fetch(url, init)
}

/** Every address a host name resolves to. The other real network call; it refuses under a test run for the same reason. */
export async function networkLookup(host: string): Promise<string[]> {
  if (process.env.VITEST) throw new Error(`no network in tests: DNS for ${host} (inject a fake lookup)`)
  return (await dnsLookup(host, { all: true })).map(a => a.address)
}
