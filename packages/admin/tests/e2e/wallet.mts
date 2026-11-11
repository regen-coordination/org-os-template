// The fake Celo node and the fake wallet the walks that sign in share (signin.mts, workspace.mts): a Hats tree of three
// hats (Top, Council under it, Ops under Council) whose wearers the walk names, and an EIP-1193 provider injected with
// `addInitScript` that signs with a key made by the harness. Nothing is sent on chain; the server only recovers the address.
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { addressOfKey, sign } from '../session/keys.ts'
import type { FetchLike } from '../../server/systems/driver.ts'
import { encodeArgs, selector } from '../../lib/abi.mjs'
import { HATS_SIGNATURES, VIEW_HAT_TYPES, childHatId, topHatId } from '../../lib/hats.mjs'

export const CELO = 'eip155:42220'
export const TOP_ID = topHatId(13)
export const COUNCIL_ID = childHatId(TOP_ID, 1)
export const OPS_ID = childHatId(COUNCIL_ID, 1)

// ── the Celo node and its explorer, faked (as tests/visibility/never-in-git.test.ts fakes them) ──

const word64 = (hex: string) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0')
/** Top, Council under it, Ops under Council. `wearers` maps a hat id to the addresses (lowercase) that wear it. */
export function fakeChain(wearers: Record<string, string[]>): FetchLike {
  const children: Record<string, number> = { [word64(TOP_ID)]: 1, [word64(COUNCIL_ID)]: 1, [word64(OPS_ID)]: 0 }
  const worn = (hat: string) => Object.entries(wearers).find(([id]) => word64(id) === hat)?.[1] ?? []
  const VIEW = selector(HATS_SIGNATURES.viewHat), WEARER = selector(HATS_SIGNATURES.isWearerOfHat)
  const ZERO = '0x0000000000000000000000000000000000000000'
  const call = (data: string): string => {
    const at = (n: number) => data.slice(10 + 64 * n, 10 + 64 * (n + 1))
    if (data.startsWith(VIEW)) {
      const hat = at(0)
      if (!(hat in children)) return encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, ZERO, ZERO, '', 0, true, true])
      return encodeArgs(VIEW_HAT_TYPES, ['a hat of the fixture tree', 10, worn(hat).length, ZERO, ZERO, '', children[hat], true, true])
    }
    if (data.startsWith(WEARER)) return encodeArgs(['bool'], [worn(at(1)).includes(`0x${at(0).slice(24)}`)])
    throw new Error(`the fake node was asked an eth_call it does not know: ${data.slice(0, 10)}`)
  }
  return async (url, init) => {
    if (init.method === 'GET') {
      const m = /\/instances\/(\d+)\/holders$/.exec(url)
      if (!m) return { ok: false, status: 404, json: async () => ({}) }
      const items = worn(word64(BigInt(m[1]!).toString(16))).map(hash => ({ address: { hash } }))
      return { ok: true, status: 200, json: async () => ({ items, next_page_params: null }) }
    }
    const body = JSON.parse(init.body!)
    const answer = (Array.isArray(body) ? body : [body]).map((r: { id: number; method: string; params: [{ data: string }] }) => {
      const result = r.method === 'eth_blockNumber' ? '0x64' : r.method === 'eth_chainId' ? '0xa4ec' : r.method === 'eth_getCode' ? '0x' : call(r.params[0].data)
      return { jsonrpc: '2.0', id: r.id, result }
    })
    return { ok: true, status: 200, json: async () => (Array.isArray(body) ? answer : answer[0]) }
  }
}

// ── the wallet in the page ──

/** A browser context whose page has a wallet that gives `sk`'s address and signs with it, in this process. Every method
 *  the page asks is kept in `asked`. */
export async function withWallet(browser: Browser, sk: Uint8Array, opts: { width: number; scheme: 'light' | 'dark' }): Promise<{ ctx: BrowserContext; page: Page; asked: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: 900 }, colorScheme: opts.scheme, locale: 'en-US', timezoneId: 'UTC' })
  const asked: string[] = []
  await ctx.exposeFunction('__e2eWallet', (method: string, hex: string | null) => {
    asked.push(method)
    return hex === null ? null : sign(sk, Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8'))
  })
  await ctx.addInitScript((address: string) => {
    const ask = (window as unknown as { __e2eWallet: (m: string, hex: string | null) => Promise<string | null> }).__e2eWallet
    ;(window as unknown as { ethereum: unknown }).ethereum = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method === 'personal_sign') return ask(method, String(params?.[0]))
        await ask(method, null)
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address]
        if (method === 'eth_chainId') return '0xa4ec'
        throw new Error(`the e2e wallet does not answer ${method}`)
      },
    }
  }, addressOfKey(sk))
  return { ctx, page: await ctx.newPage(), asked }
}
