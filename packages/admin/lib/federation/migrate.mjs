// packages/admin/lib/federation/migrate.mjs
//
// Bringing existing `peers` lists onto atproto (network N2 Task 12, spec R28). Migration publishes nothing by itself: it
// shows, for each public peer, the DID and the relation a link record would carry and whether R24 would publish it; the
// server stages `did` and `link` through a governed change, and the separate confirmed `federation.publish-links`
// (Task 7) does any publishing once that change is applied.
//
// A DID is written into federation.yaml only when the caches tie it to that peer (`didBinding`): a DID that only the
// peer's own federation.json names is a suggestion, because anyone can claim any DID there.
// Pure: relative imports only (no node:* and no npm), because the app imports it for the page's words.

import { isDid, relationOf, wantedLink } from './links.mjs'
import { isPublicUrl } from './peers.mjs'
import { isPublishedPeer } from '../standards/federation.mjs'

/** @typedef {import('./read.mjs').Peer} Peer */
/** @typedef {import('./links.mjs').Relation} Relation */
/** @typedef {import('./links.mjs').Where} Where */
/** @typedef {{ readingOf: (did: string) => { handle: string | null, names?: string[] } | null, didOfHandle: (handle: string) => string | null }} AtprotoView
 *  what confirmed checks left in the atproto cache: a DID's last reading (the handle its document claims, and `names`, the
 *  addresses its own profiles name: `example.orgosnetwork.profile` `instance`/`homepage`, `app.certified.actor.organization`
 *  `urls[].url`), and a handle's DID, kept only after it was checked both ways (Task 3, R7) */
/** @typedef {{ theirDid?: (peer: Peer) => string | null, atproto?: AtprotoView,
 *   byFiles?: { mutualByFiles?: readonly number[], membersByFiles?: readonly number[] }, where?: Where }} MigrationCaches
 *  `theirDid`: the `did` the peer's own federation.json carried at the last check; `byFiles`: the files readings (R4) */
/** @typedef {{ index: number, name: string, did: string | null, didSource: 'federation.yaml' | 'their federation.json' | null,
 *   didVerified: boolean, relation: Relation | null, relationSource: 'link' | 'derived' | null, publishable: boolean,
 *   why: string | null }} MigrationRow */

/** Why a row isn't publishable, one plain sentence each. */
export const MIGRATION_WHY = Object.freeze({
  noDid: 'No DID yet.',
  noRelation: "Choose how it's linked.",
  undecided: "They don't list you yet. Set the link explicitly to publish anyway.",
  none: 'You chose to keep it off atproto (link: none).',
})

/** Why a DID can't be written for a peer. */
export const BINDING = Object.freeze({
  lookFirst: 'Look it up first.',
  notDid: 'That is not a did:plc or did:web identifier.',
  noUrl: "This peer has no public https address, so no DID can be tied to it.",
  noHandle: "Its DID document names no handle, and its profile doesn't name this peer's address, so it can't be tied to it.",
  /** @param {string} handle */
  notBothWays: handle => `Its handle ${handle} doesn't name it back yet, and its profile doesn't name this peer's address, so it can't be written. Look it up first.`,
  /** @param {string} handle @param {string} host */
  otherHost: (handle, host) => `Its handle is ${handle}, not ${host}, and its profile doesn't name this peer's address, so it isn't this peer's DID.`,
})

/** Hosts many orgs share: an address on one names an org only as the exact url, never by its host. */
export const SHARED_HOSTS = Object.freeze(['github.com', 'gitlab.com', 'codeberg.org', 'bsky.social', 'certified.one'])

/** A host without a leading `www.` and a trailing dot, lowercased.  @param {string} h */
const bareHost = h => h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')

/** A url as the server compares urls (node.ts `normUrl`): trimmed, without trailing slashes, lowercased. */
const normUrl = (/** @type {string} */ u) => u.trim().replace(/\/+$/, '').toLowerCase()

/** Whether an address a DID's own profile names is this peer's url: the same url (normUrl), or a public https url on the
 *  same host, unless that host is a shared one (SHARED_HOSTS), where only the exact url counts.
 *  @param {unknown} name @param {string} url */
export function namesPeer(name, url) {
  if (typeof name !== 'string' || name.trim() === '') return false
  if (normUrl(name) === normUrl(url)) return true
  const href = name.trim()
  if (!isPublicUrl(href)) return false
  const theirs = bareHost(new URL(href).hostname)
  const ours = bareHost(new URL(url).hostname)
  return theirs === ours && !SHARED_HOSTS.includes(ours)
}

/** Whether `did` is this peer's, by what confirmed checks cached (null), or the sentence saying why not. Tied means:
 *  the DID was read (a confirmed check resolved it), and one of
 *  - it is `did:web:<host>` for the peer url's own host (that host serves the document);
 *  - its own repository, read in a confirmed check, holds a profile naming the peer (`namesPeer`): the org says from
 *    its own account which address it is, as atproto and Certified profiles are meant for;
 *  - the handle its document claims was checked both ways (the handle names the DID, the DID names the handle) and is
 *    the peer url's host (a leading `www.` aside).
 *  A DID the peer's federation.json names is only a claim from one side, so it never ties on its own.
 *  @param {{ url: string | null, name?: string }} peer @param {string} did @param {AtprotoView} view @returns {string | null} */
export function didBinding(peer, did, view) {
  if (!isDid(did)) return BINDING.notDid
  if (!isPublicUrl(peer.url)) return BINDING.noUrl
  const url = new URL(/** @type {string} */ (peer.url))
  const reading = view.readingOf(did)
  if (!reading) return BINDING.lookFirst
  if (did.startsWith('did:web:')) {
    const id = did.slice('did:web:'.length)
    let host = null
    try { host = id.includes(':') ? null : decodeURIComponent(id).toLowerCase() } catch { host = null }
    if (host !== null && host === url.host.toLowerCase()) return null
  }
  if ((reading.names ?? []).some(n => namesPeer(n, /** @type {string} */ (peer.url)))) return null
  const handle = typeof reading.handle === 'string' && reading.handle !== '' ? reading.handle.toLowerCase() : null
  if (handle === null) return BINDING.noHandle
  if (view.didOfHandle(handle) !== did) return BINDING.notBothWays(handle)
  if (bareHost(handle) !== bareHost(url.hostname)) return BINDING.otherHost(handle, url.hostname.toLowerCase())
  return null
}

/** The migration list (pure): one row per peer that `isPublishedPeer` passes, by peer index; every other peer is left
 *  out of the list entirely and only counted (`kept.private`: `visibility: private`; `kept.noUrl`: no public https url).
 *  - `did`: the peer entry's, else the `did` its federation.json carried at the last check (`didSource` says which).
 *    `didVerified`: `didBinding` ties it to this peer. A suggestion is never counted as written: `publishable` reads
 *    federation.yaml only, exactly as the publish planner will.
 *  - `relation`: `relationOf` with the files readings (R4); `relationSource` is `link` for an explicit `link` (even
 *    `none`), `derived` for a relation worked out, else null.
 *  - `publishable`: R24's test (`wantedLink`); `why`: one plain sentence when it isn't, else null.
 *  @param {{ peers: Peer[], networks: any[], join: any }} fed readFederation's answer
 *  @param {MigrationCaches} [caches]
 *  @returns {{ rows: MigrationRow[], kept: { private: number, noUrl: number } }} */
export function migrationRows(fed, caches = {}) {
  const byFiles = { mutualByFiles: caches.byFiles?.mutualByFiles ?? [], membersByFiles: caches.byFiles?.membersByFiles ?? [] }
  const where = caches.where ?? {}
  const view = caches.atproto ?? { readingOf: () => null, didOfHandle: () => null }
  const kept = { private: 0, noUrl: 0 }
  /** @type {MigrationRow[]} */
  const rows = []
  for (const peer of fed.peers ?? []) {
    if (!isPublishedPeer(peer)) {
      if (peer.private) kept.private += 1
      else kept.noUrl += 1
      continue
    }
    const claimed = peer.did ? null : caches.theirDid?.(peer) ?? null
    const theirs = isDid(claimed) ? claimed : null
    const did = peer.did ?? theirs
    const relation = relationOf(peer, fed, { ...where, ...byFiles })
    const wanted = wantedLink(peer, fed, { relation, where, ...byFiles })
    let why = null
    if ('withheld' in wanted) {
      if (wanted.withheld === 'noDid') why = MIGRATION_WHY.noDid
      else if (wanted.withheld === 'noRelation') why = peer.link === 'none' ? MIGRATION_WHY.none : MIGRATION_WHY.noRelation
      else why = MIGRATION_WHY.undecided
    }
    rows.push({
      index: peer.index,
      name: peer.name,
      did,
      didSource: peer.did ? 'federation.yaml' : theirs ? 'their federation.json' : null,
      didVerified: did !== null && didBinding(peer, did, view) === null,
      relation,
      relationSource: peer.link ? 'link' : relation ? 'derived' : null,
      publishable: 'link' in wanted,
      why,
    })
  }
  return { rows, kept }
}
