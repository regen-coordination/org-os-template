/** The wallet in this browser (L5 spec §4.5): an injected EIP-1193 provider, found through EIP-6963 announcements, else
 *  `window.ethereum`. The Hub asks it only for an address and for a signature over the text the server wrote: the four
 *  methods below, and nothing else ever reaches the provider (no transaction, no typed data, no chain switch; the
 *  signature does not depend on the chain). Browser wallets only: no WalletConnect (§18 Q4). */

/** The only methods the Hub may ask of a wallet. A test pins the list. */
export const WALLET_METHODS = ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'personal_sign'] as const
export type WalletMethod = typeof WALLET_METHODS[number]

/** An EIP-1193 provider, as much of one as the Hub uses. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

/** The wallet gave no address, or something that is not one. */
export const NO_ADDRESS = 'The wallet gave no address. Unlock it and choose an address, then try again.'
/** How long announcements are waited for when none came at once (wallets answer the request as it is made). */
const ANNOUNCE_WAIT_MS = 100

const isWalletMethod = (method: string): method is WalletMethod => (WALLET_METHODS as readonly string[]).includes(method)
const isProvider = (p: unknown): p is Eip1193 => typeof p === 'object' && p !== null && typeof (p as Eip1193).request === 'function'

/** The one way the provider is asked anything: a method outside WALLET_METHODS throws before it reaches the wallet. */
export async function askWallet(p: Eip1193, method: string, params?: unknown[]): Promise<unknown> {
  if (!isWalletMethod(method)) throw new Error(`The Hub does not ask a wallet for ${method}; it asks only for ${WALLET_METHODS.join(', ')}.`)
  return p.request(params === undefined ? { method } : { method, params })
}

/** The wallet in this browser: the first provider to announce itself (EIP-6963), else `window.ethereum`, else null.
 *  With several wallets the first to answer is used: choosing among them is the wallets' own (they let a person pick
 *  which one answers). */
export async function findProvider(): Promise<Eip1193 | null> {
  let found: Eip1193 | null = null
  const heard = (e: Event) => {
    const p = (e as CustomEvent<{ provider?: unknown }>).detail?.provider
    if (!found && isProvider(p)) found = p
  }
  window.addEventListener('eip6963:announceProvider', heard)
  try {
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    if (!found) await new Promise(r => setTimeout(r, ANNOUNCE_WAIT_MS))
  } finally {
    window.removeEventListener('eip6963:announceProvider', heard)
  }
  if (found) return found
  const injected = (window as { ethereum?: unknown }).ethereum
  return isProvider(injected) ? injected : null
}

/** The address the wallet gives (it asks the person to choose one when it has not yet). */
export async function requestAddress(p: Eip1193): Promise<string> {
  const accounts = await askWallet(p, 'eth_requestAccounts')
  const first = Array.isArray(accounts) ? accounts[0] : undefined
  if (typeof first !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(first)) throw new Error(NO_ADDRESS)
  return first
}

/** The wallet's EIP-191 signature of `text` by `address` (personal_sign: the text as UTF-8 hex, then the address). */
export async function signText(p: Eip1193, text: string, address: string): Promise<string> {
  const hex = '0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('')
  const signature = await askWallet(p, 'personal_sign', [hex, address])
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error('The wallet answered with something that is not a signature. Try again.')
  return signature
}
