export interface ChainInfo { name: string; native: string; safe: string | null; rpc: string | null; explorer: string | null }

/** The chains the drivers know, by CAIP-2 id. Every RPC host was checked with `eth_chainId` and every Safe slug with
 *  `GET /tx-service/<slug>/api/v1/about/` on 2026-10-29; an explorer is a Blockscout host that answers `/api/v2/stats`
 *  without a challenge. */
export const CHAINS: Record<string, ChainInfo> = {
  'eip155:1': { name: 'Ethereum', native: 'ETH', safe: 'eth', rpc: 'ethereum-rpc.publicnode.com', explorer: 'eth.blockscout.com' },
  'eip155:10': { name: 'Optimism', native: 'ETH', safe: 'oeth', rpc: 'optimism-rpc.publicnode.com', explorer: null },
  'eip155:100': { name: 'Gnosis', native: 'xDAI', safe: 'gno', rpc: 'gnosis-rpc.publicnode.com', explorer: null },
  'eip155:137': { name: 'Polygon', native: 'POL', safe: 'pol', rpc: 'polygon-bor-rpc.publicnode.com', explorer: null },
  'eip155:8453': { name: 'Base', native: 'ETH', safe: 'base', rpc: 'base-rpc.publicnode.com', explorer: null },
  'eip155:42161': { name: 'Arbitrum', native: 'ETH', safe: 'arb1', rpc: 'arbitrum-one-rpc.publicnode.com', explorer: null },
  'eip155:42220': { name: 'Celo', native: 'CELO', safe: 'celo', rpc: 'forno.celo.org', explorer: 'celo.blockscout.com' },
  'eip155:11155111': { name: 'Sepolia', native: 'ETH', safe: 'sep', rpc: 'ethereum-sepolia-rpc.publicnode.com', explorer: 'eth-sepolia.blockscout.com' },
}

/** The chain's entry, or null for anything not in the table ('constructor' and '__proto__' included). */
export function chainInfo(chain: unknown): ChainInfo | null {
  return typeof chain === 'string' && Object.hasOwn(CHAINS, chain) ? CHAINS[chain] : null
}

/** 'eip155:42220' → 42220; null for anything else. */
export function chainIdNumber(chain: string): number | null {
  const m = /^eip155:([1-9][0-9]*)$/.exec(chain)
  return m && Number.isSafeInteger(Number(m[1])) ? Number(m[1]) : null
}

/** The env value `ORG_OS_RPC`: comma-separated `<CAIP-2>=<https URL>` pairs that replace a chain's public RPC host
 *  (so a keyed URL stays out of git). Throws a sentence naming the entry that is wrong. */
export function parseRpcConfig(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/
  let n = 0
  for (const raw of (text ?? '').split(',')) {
    const entry = raw.trim()
    if (entry === '') continue
    n += 1
    // The URL may carry a key in its path or query, so a sentence never quotes the URL or the entry: it names the entry
    // by its chain when that is a CAIP-2 id (which holds no "/", "@" or "?"), else by its place, and the URL by its host.
    const eq = entry.indexOf('=')
    if (eq < 0) throw new Error(`ORG_OS_RPC has an entry with no \`=\` (entry ${n}); each is <chain>=<https URL>`)
    const chain = entry.slice(0, eq).trim()
    const url = entry.slice(eq + 1).trim()
    let host = ''
    try { host = new URL(url).hostname } catch { /* named without a host */ }
    const bad = (why: string) => new Error(`ORG_OS_RPC ${CAIP2.test(chain) ? `entry for "${chain}"` : `entry ${n}`}${host ? ` (${host})` : ''} ${why}`)
    if (!CAIP2.test(chain)) throw bad('does not start with a CAIP-2 chain id (like eip155:42220) before its `=`')
    if (!chainInfo(chain)) throw bad(`names ${chain}, which is not a chain this Hub knows (${Object.keys(CHAINS).join(', ')})`)
    if (Object.hasOwn(out, chain)) throw bad('is given twice')
    let u: URL
    try { u = new URL(url) } catch { throw bad('has a URL that is not an address') }
    if (u.protocol !== 'https:') throw bad('must be an https URL')
    if (u.username !== '' || u.password !== '') throw bad('must not carry a login in the address (put a key in the path)')
    if (u.port !== '') throw bad('must use the default https port')
    out[chain] = u.href
  }
  return out
}
