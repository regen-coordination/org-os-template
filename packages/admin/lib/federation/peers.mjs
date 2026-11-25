// packages/admin/lib/federation/peers.mjs
//
// Where a peer lives, and whether it lists us back (network N0 spec §12 R4).
// Pure: the only import is ./read.mjs, because the standards builder vendors this file into instances.
// Everything that touches the disk comes in through `io`.

import { readFederation } from './read.mjs'

/** @typedef {{ kind: 'github', owner: string, repo: string, path: string }
 *   | { kind: 'url', href: string } | { kind: 'path', path: string }} Address  path: absolute */
/** @typedef {{ resolve(base: string, rel: string): string, isDir(abs: string): boolean,
 *   readFederationAt(abs: string): { found: false } | { found: true, doc: unknown } | { found: true, error: string } }} PeerIO */

// `requested` and `left` are not computed here: this file reads the local folder only and gives the files reading of
// the other side. The combiner (Task 4) adds the request record and the atproto records and gives the final state.
export const LINK_STATES = Object.freeze(['mutual', 'claimed', 'requested', 'left', 'not-an-instance', 'unknown'])

/** @param {string} s */
const decode = s => { try { return decodeURIComponent(s) } catch { return s } }

/** @param {string} owner @param {string} repo @param {string} path @returns {Address} */
const github = (owner, repo, path) => ({
  kind: 'github', owner: owner.toLowerCase(), repo: repo.replace(/\.git$/i, '').toLowerCase(), path,
})

/** @param {string} ref @param {string} base @param {PeerIO} io @returns {Address | null} */
export function addressOf(ref, base, io) {
  const r = ref.trim()
  if (!r) return null

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)\/?$/i.exec(r)
  if (ssh) return github(ssh[1], ssh[2], '')
  const web = /^(?:https?:\/\/(?:[^/?#@]*@)?)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/?([^?#]*)$/i.exec(r)
  if (web) {
    const tree = /^tree\/[^/]+\/(.+?)\/?$/.exec(web[3])
    return github(web[1], web[2], tree ? decode(tree[1]) : '')
  }

  if (/^https?:\/\//i.test(r)) {
    try {
      const u = new URL(r)
      return { kind: 'url', href: `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '') }
    } catch { return null }
  }

  if (r.startsWith('.') || r.startsWith('/')) return { kind: 'path', path: io.resolve(base, r) }

  // A bare relative ref: under this instance, else under a folder above it (a vault-relative `03 Libraries/…`).
  const found = findUp(base, r, io)
  if (found) return { kind: 'path', path: found }
  if (/\s/.test(r)) return { kind: 'path', path: io.resolve(base, r) }
  if (/^[^/]+\/[^/]+$/.test(r)) return github(...(/** @type {[string, string]} */ (r.split('/'))), '')
  return null
}

/** The first folder `rel` names, looked for under `base` and then under each folder above it up to the root.
 *  @param {string} base @param {string} rel @param {PeerIO} io @returns {string | null} */
function findUp(base, rel, io) {
  let dir = io.resolve(base, '.')
  for (;;) {
    const abs = io.resolve(dir, rel)
    if (io.isDir(abs)) return abs
    const up = io.resolve(dir, '..')
    if (up === dir) return null
    dir = up
  }
}

/** @param {Address} a @param {Address} b */
export function sameAddress(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'github' && b.kind === 'github') return a.owner === b.owner && a.repo === b.repo && a.path === b.path
  if (a.kind === 'url' && b.kind === 'url') return a.href === b.href
  if (a.kind === 'path' && b.kind === 'path') return a.path === b.path
  return false
}

/** Every way another instance could point at this one: its folder and each git remote.
 *  @param {string} root @param {string[]} remotes @param {PeerIO} io @returns {Address[]} */
export function selfAddresses(root, remotes, io) {
  /** @type {Address[]} */
  const out = [{ kind: 'path', path: io.resolve(root, '.') }]
  for (const remote of remotes) {
    const a = addressOf(remote, root, io)
    if (a) out.push(a)
  }
  return out
}

/** An https: URL a stranger could open: a real host with a dot in it (no localhost, .local/.internal names, single
 *  labels or IP literals), no credentials, no query and no fragment.  @param {unknown} url @returns {boolean} */
export function isPublicUrl(url) {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    if (u.protocol !== 'https:' || host === '' || u.username !== '' || u.password !== '') return false
    if (u.search !== '' || u.hash !== '' || url.includes('?') || url.includes('#')) return false
    if (!host.includes('.') && !host.startsWith('[')) return false
    if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false
    if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return false
    return true
  } catch { return false }
}

/** A network hub or a join `where` as it may be published: a public https URL, with `github.com/<owner>[/<repo>]`
 *  written without a scheme read as https; anything else is null.  @param {unknown} v @returns {string | null} */
export function publicHref(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  const href = /^github\.com\/[^/?#\s]+(?:\/[^/?#\s]+)?\/?$/i.test(t) ? `https://${t}` : t
  return isPublicUrl(href) ? href : null
}

/** @param {import('./read.mjs').Peer} peer @param {Address[]} self @param {string} base @param {PeerIO} io
 *  @returns {{ state: 'mutual' | 'claimed' | 'not-an-instance' | 'unknown', path: string | null, reason: string | null }} */
export function linkState(peer, self, base, io) {
  const ref = peer.ref ?? peer.url
  const addr = ref ? addressOf(ref, base, io) : null
  if (!addr || addr.kind !== 'path') return { state: 'unknown', path: null, reason: "can't read their side from here" }
  if (!io.isDir(addr.path)) return { state: 'unknown', path: addr.path, reason: `no folder at ${addr.path}` }

  const theirs = io.readFederationAt(addr.path)
  if (!theirs.found) return { state: 'not-an-instance', path: addr.path, reason: null }
  if ('error' in theirs) {
    return { state: 'unknown', path: addr.path, reason: `their federation.yaml can't be read: ${theirs.error}` }
  }
  // Every address their entry gives counts: a vault path that doesn't match here may sit next to a url that does.
  const back = readFederation(theirs.doc).peers.some(p => [p.ref, p.url].some(r => {
    const a = r ? addressOf(r, addr.path, io) : null
    return a !== null && self.some(s => sameAddress(s, a))
  }))
  return { state: back ? 'mutual' : 'claimed', path: addr.path, reason: null }
}
