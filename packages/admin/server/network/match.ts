// The match rule (spec docs/specs/2026-11-24-refi-dao-network-app-design.md §5.4, Q19 in refi-dao-os).
//
// Signing in with a node's account proves control of that account, not that the account is the node's: anyone can
// create `refi-somewhere.bsky.social`. So an account added through the Hub goes live by itself only when it matches
// the node:
//   - domain: its handle is exactly the host of the node's own website (`url`, or `links.web`), without `www.`; and
//     only when the website sits at the root of its host, so a site on a shared platform's path (`github.com/…`,
//     `linktr.ee/…`) never matches. A subdomain handle (`someone.refi-x.org`) is pending: orgs hand members handles
//     under their domain, and a person's own account must not go live as the node's (Luiz, 2026-11-24);
//   - record: the node's Dec 9 network entry already names this DID with a passing check, or one of the node's links is
//     a `bsky.app` / `certified.app` profile link naming this DID, or a handle that resolves to it.
// Anything else is pending for a steward. Nothing here throws: a junk address is simply not a match.
//
// PRECONDITION: `account.handle` must already have passed the two-way check (the handle resolves to `account.did` and
// the DID document names the handle back; check-network.mjs `checkEntry`, or its port). A DID document can claim any
// handle, so an unchecked handle would let anyone "match" any node's domain. The caller (Phase B5) checks first.

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
  if (host.startsWith('www.') && host.split('.').length > 2) host = host.slice(4)
  return host
}

// Hosts whose subdomains belong to other people: AT Proto handle providers and hosting platforms. A node whose website
// sits at one of these roots (a placeholder, a typo) must not let `anyone.<host>` match it by domain.
const SHARED_HOSTS = new Set([
  'bsky.social', 'bsky.app', 'certified.one', 'certified.app', 'github.io', 'gitlab.io', 'netlify.app', 'vercel.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'railway.app',
  'wordpress.com', 'blogspot.com', 'substack.com', 'medium.com', 'notion.site', 'super.site', 'carrd.co', 'wixsite.com',
  'squarespace.com', 'webflow.io', 'framer.website', 'gitbook.io', 'linktr.ee',
])
// The common second-level labels of country suffixes (`co.uk`, `com.br`, `org.au`): a bare `<label>.<cc>` is a suffix.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nom', 'ltd', 'plc'])

/** A host a website can stand on as its own: two labels or more, not a bare country suffix, not a shared host. */
function ownHost(host: string): boolean {
  const labels = host.split('.')
  if (labels.length < 2 || labels.some(l => l === '')) return false
  if (labels.length === 2 && SECOND_LEVEL.has(labels[0]) && /^[a-z]{2}$/.test(labels[1])) return false
  return !SHARED_HOSTS.has(host)
}

/** The website's host without `www.`, only when the address is an http(s) website at the root of its host, on the
 *  default port, and the host is one a website can own (not a bare suffix, not a host that gives out subdomains). */
export function websiteHost(address: string): string | null {
  const u = parseWebAddress(address)
  if (!u) return null
  if (u.pathname !== '/' && u.pathname !== '') return null
  if (u.port !== '') return null
  const host = bareHost(u)
  return ownHost(host) ? host : null
}

/** `<x>` from a `bsky.app/profile/<x>` or `certified.app/profile/<x>` link (a DID or a handle), else null. */
export function profileTarget(address: unknown): string | null {
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

  // 1 · Domain: exactly the node's own website host, at the root of it (a subdomain handle is pending).
  if (handle) {
    for (const address of [org?.url, org?.links?.web]) {
      const host = typeof address === 'string' ? websiteHost(address) : null
      if (host && handle === host) return { match: true, why: 'domain' }
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
