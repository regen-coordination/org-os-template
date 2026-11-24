// The match rule (spec docs/specs/2026-11-24-refi-dao-network-app-design.md §5.4, Q19 in refi-dao-os).
//
// Signing in with a node's account proves control of that account, not that the account is the node's: anyone can
// create `refi-somewhere.bsky.social`. So an account added through the Hub goes live by itself only when it matches
// the node:
//   - domain: its handle is the host of the node's own website (`url`, or `links.web`), without `www.`, or a subdomain
//     of it; and only when the website sits at the root of its host, so a site on a shared platform's path
//     (`github.com/…`, `linktr.ee/…`) never matches;
//   - record: the node's Dec 9 network entry already names this DID with a passing check, or one of the node's links is
//     a `bsky.app` / `certified.app` profile link naming this DID, or a handle that resolves to it.
// Anything else is pending for a steward. Nothing here throws: a junk address is simply not a match.

export type Account = { did: string; handle: string }
export type OrgLinks = { url?: string | null; links?: Record<string, string | null | undefined> | null }
/** The node's Dec 9 `data/nodes/network.yaml` entry, if it has one. */
export type Known = { did: string; check: 'pass' | 'fail' } | null
export type MatchDeps = { resolveHandle: (handle: string) => Promise<string | null> }
export type Match = { match: true; why: 'domain' | 'record' } | { match: false }

const NO: Match = { match: false }
const PROFILE_HOSTS = new Set(['bsky.app', 'certified.app'])

function parseWebAddress(address: unknown): URL | null {
  if (typeof address !== 'string' || address.trim() === '') return null
  let u: URL
  try { u = new URL(address.trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return u
}

function bareHost(u: URL): string {
  let host = u.hostname.toLowerCase()
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host.startsWith('www.')) host = host.slice(4)
  return host
}

/** The website's host without `www.`, only when the address is an http(s) website at the root of its host. */
export function websiteHost(address: string): string | null {
  const u = parseWebAddress(address)
  if (!u) return null
  if (u.pathname !== '/' && u.pathname !== '') return null
  const host = bareHost(u)
  return host === '' ? null : host
}

/** `<x>` from a `bsky.app/profile/<x>` or `certified.app/profile/<x>` link (a DID or a handle), else null. */
function profileTarget(address: unknown): string | null {
  const u = parseWebAddress(address)
  if (!u || !PROFILE_HOSTS.has(bareHost(u))) return null
  const m = /^\/profile\/([^/]+)\/?$/.exec(u.pathname)
  if (!m) return null
  let x: string
  try { x = decodeURIComponent(m[1]) } catch { return null }
  return x.startsWith('did:') ? x : x.toLowerCase()
}

function nodeAddresses(org: OrgLinks): unknown[] {
  const links = org?.links && typeof org.links === 'object' ? Object.values(org.links) : []
  return [org?.url, ...links]
}

export async function matchesNode(account: Account, org: OrgLinks, known: Known, deps: MatchDeps): Promise<Match> {
  const did = typeof account?.did === 'string' ? account.did : ''
  const handle = typeof account?.handle === 'string' ? account.handle.trim().toLowerCase().replace(/\.$/, '') : ''
  if (!did) return NO

  // 1 · Domain: the node's own website, at the root of its host.
  if (handle) {
    for (const address of [org?.url, org?.links?.web]) {
      const host = typeof address === 'string' ? websiteHost(address) : null
      if (host && (handle === host || handle.endsWith('.' + host))) return { match: true, why: 'domain' }
    }
  }

  // 2 · The node's Dec 9 entry already names this DID, and its check passed.
  if (known && known.check === 'pass' && known.did === did) return { match: true, why: 'record' }

  // 3 · A profile link on the node's record names this DID (resolving a handle is the only network call, so last).
  const targets = nodeAddresses(org).map(profileTarget).filter((x): x is string => x !== null)
  if (targets.includes(did)) return { match: true, why: 'record' }
  for (const target of targets) {
    if (target.startsWith('did:')) continue
    try {
      if ((await deps.resolveHandle(target)) === did) return { match: true, why: 'record' }
    } catch { /* a resolver that is down is not a match */ }
  }
  return NO
}
