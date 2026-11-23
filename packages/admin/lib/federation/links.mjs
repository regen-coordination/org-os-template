// packages/admin/lib/federation/links.mjs
//
// The link-record contract of network N2 (spec §15, R21–R28): a public membership link is a record each side publishes
// in its own atproto repository. This file holds the names and the parsers every read goes through (Task 3), and
// reciprocity, the relation of a peer, R24's wanted test and the record key (Task 4); Task 7 adds the planner of what
// this org publishes. Pure: relative imports only (no node:* and no npm), because the app imports it for the page's words.
//
// Reading never depends on a record's key: it lists a collection and matches fields. A record another client wrote may
// carry more keys; they are ignored when read and never written. A record that does not parse is skipped, never thrown.

import { DID_PATTERN } from './read.mjs'
import { addressOf, sameAddress } from './peers.mjs'
import { isPublishedPeer } from '../standards/federation.mjs'
import { sha256Hex } from '../sha256.mjs'

/** The lexicon authority of the network's records, until the network's own domain is fixed (knowledge-network phase 2). */
export const NETWORK_AUTHORITY = 'example.orgosnetwork'
/** A link: { subject: did, relation, network?, createdAt }. */
export const LINK_NSID = `${NETWORK_AUTHORITY}.link`
/** The org's profile, key `self`: { name, …, networks: [{ hub: did, name }], createdAt }. */
export const PROFILE_NSID = `${NETWORK_AUTHORITY}.profile`
/** The relations a link record states. A peer's `link: none` in federation.yaml is not one: it means no record. */
export const RELATIONS = Object.freeze(['memberOf', 'hasMember', 'peerOf'])
/** The longest network name a record may carry. */
export const NETWORK_NAME_MAX = 200

/** @typedef {'memberOf' | 'hasMember' | 'peerOf'} Relation */
/** @typedef {{ $type: string, subject: string, relation: Relation, network?: string, createdAt: string }} LinkRecord */
/** @typedef {{ hub: string, name: string }} ProfileNetwork */
/** @typedef {import('./read.mjs').Peer} Peer */
/** @typedef {Pick<ReturnType<typeof import('./read.mjs').readFederation>, 'networks' | 'join'>} FedLike */
/** @typedef {{ base?: string, io?: import('./peers.mjs').PeerIO }} Where  how a path ref is resolved (the instance folder and the disk) */
/** @typedef {{ subject: string, relation: Relation, network?: string }} WantedLink */
/** @typedef {'private' | 'noUrl' | 'noDid' | 'noRelation' | 'undecided'} Withheld */
/** @typedef {{ networks: ProfileNetwork[], rest: Record<string, unknown> }} ProfileRecord */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A did:plc or did:web identifier, as a record may name one: the method, then DID characters only.
 *  @param {unknown} v @returns {v is string} */
export function isDid(v) {
  return typeof v === 'string' && v.length <= 2048 && DID_PATTERN.test(v) && /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(v) && !v.endsWith(':')
}

/** An atproto datetime: RFC 3339 with a time and a zone, that names a real moment.  @param {unknown} v @returns {v is string} */
function isDatetime(v) {
  if (typeof v !== 'string' || v.length > 64) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(v)
  if (!m) return false
  const [mo, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return false
  return !Number.isNaN(Date.parse(v))
}

/** A network name a record may carry: a non-empty string of at most 200 characters.  @param {unknown} v @returns {v is string} */
const isNetworkName = v => typeof v === 'string' && v.trim() !== '' && v.length <= NETWORK_NAME_MAX

/** A link record's value, keeping exactly `$type`, `subject`, `relation`, `network` (when set) and `createdAt`, or null.
 *  @param {unknown} value @returns {LinkRecord | null} */
export function parseLinkRecord(value) {
  if (!isObj(value) || value.$type !== LINK_NSID) return null
  const { subject, relation, network, createdAt } = value
  if (!isDid(subject) || typeof relation !== 'string' || !RELATIONS.includes(relation) || !isDatetime(createdAt)) return null
  if (network !== undefined && !isNetworkName(network)) return null
  /** @type {LinkRecord} */
  const out = { $type: LINK_NSID, subject, relation: /** @type {Relation} */ (relation), createdAt }
  if (network !== undefined) out.network = network
  return out
}

/** A profile record's value: its `networks` (entries that do not read are dropped) and every other key as it is
 *  (`rest`, without `$type`), or null when it is not a profile or its `networks` is not a list.
 *  @param {unknown} value @returns {ProfileRecord | null} */
export function parseProfileRecord(value) {
  if (!isObj(value) || value.$type !== PROFILE_NSID) return null
  if (value.networks !== undefined && !Array.isArray(value.networks)) return null
  /** @type {ProfileNetwork[]} */
  const networks = []
  for (const n of /** @type {unknown[]} */ (value.networks ?? [])) {
    if (isObj(n) && isDid(n.hub) && isNetworkName(n.name)) networks.push({ hub: n.hub, name: n.name })
  }
  /** @type {Record<string, unknown>} */
  const rest = {}
  for (const [k, v] of Object.entries(value)) if (k !== '$type' && k !== 'networks') rest[k] = v
  return { networks, rest }
}

/** The relation the other side's record states for the same link: memberOf ↔ hasMember, peerOf ↔ peerOf; else null.
 *  @param {unknown} relation @returns {Relation | null} */
export function reciprocal(relation) {
  if (relation === 'memberOf') return 'hasMember'
  if (relation === 'hasMember') return 'memberOf'
  if (relation === 'peerOf') return 'peerOf'
  return null
}

/** A plain POSIX resolve, for comparing path refs when no disk is given: `rel` against `base`, `.` and `..` folded.
 *  @param {string} base @param {string} rel @returns {string} */
function posixResolve(base, rel) {
  /** @type {string[]} */
  const out = []
  for (const part of (rel.startsWith('/') ? rel : `${base}/${rel}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

/** The disk when none is given: paths resolve by text, and no folder is ever found (a bare name is not looked up). */
const INERT_IO = /** @type {import('./peers.mjs').PeerIO} */ ({
  resolve: posixResolve, isDir: () => false, readFederationAt: () => ({ found: false }),
})

/** The network of `fed` whose hub is this peer (same address, by `sameAddress`), or null.
 *  @param {Peer} peer @param {FedLike} fed @param {Where} [where] */
function hubNetworkOf(peer, fed, where = {}) {
  const base = where.base ?? '/'
  const io = where.io ?? INERT_IO
  const mine = [peer.url, peer.ref].flatMap(r => {
    const a = r ? addressOf(r, base, io) : null
    return a ? [a] : []
  })
  if (mine.length === 0) return null
  for (const n of fed.networks ?? []) {
    const hub = n.hub ? addressOf(n.hub, base, io) : null
    if (hub && mine.some(a => sameAddress(a, hub))) return n
  }
  return null
}

/** The relation a link record for this peer would state (R24.3), or null:
 *  - an explicit `peer.link` wins, and `none` gives null;
 *  - else a peer that is the hub of one of `fed.networks` (same address) is `memberOf`;
 *  - else a `relationship: node` peer with a `decision`, on an instance with a `join` block, is `hasMember` (a member
 *    ratified through the hub's proposal path carries `decision: request <id>`, R3);
 *  - else null. Free-form `relationship` values are never mapped.
 *  `where` resolves path refs against the instance folder on the disk; without it only addresses compare by text.
 *  @param {Peer} peer @param {FedLike} fed @param {Where} [where] @returns {Relation | null} */
export function relationOf(peer, fed, where = {}) {
  if (peer.link) return peer.link === 'none' ? null : /** @type {Relation} */ (peer.link)
  if (hubNetworkOf(peer, fed, where)) return 'memberOf'
  if (peer.relationship === 'node' && peer.decision && fed.join) return 'hasMember'
  return null
}

/** The network name a link record carries: for `memberOf`, the network whose hub is this peer; for `hasMember`, the
 *  network this instance is the hub of (its one `role: hub` entry, else its only network); never for `peerOf`, and
 *  never when it is ambiguous.
 *  @param {Peer} peer @param {Relation | null} relation @param {FedLike} fed @param {Where} [where] @returns {string | undefined} */
export function networkOf(peer, relation, fed, where = {}) {
  const networks = fed.networks ?? []
  if (relation === 'memberOf') return hubNetworkOf(peer, fed, where)?.name ?? undefined
  if (relation === 'hasMember') {
    const hubs = networks.filter(n => n.role === 'hub')
    if (hubs.length === 1) return hubs[0].name
    if (hubs.length === 0 && networks.length === 1) return networks[0].name
  }
  return undefined
}

/** R24's test for one peer: the link this org publishes for it, or why it is withheld (counted, never named).
 *  A peer is published when it is public (R3: a public https `url`, not `visibility: private`), has a `did`, has a
 *  relation, and, when that relation is derived, is decided (`decision`) or mutual by files (`mutualByFiles`: the
 *  indexes of peers whose files list this instance at the last check, computed server-side, R4). An explicit `link` is
 *  itself the decision. `relation`, when given, is used as it is (the caller worked it out with the disk).
 *  @param {Peer} peer @param {FedLike} fed
 *  @param {{ relation?: Relation | null, mutualByFiles?: readonly number[], where?: Where }} [opts]
 *  @returns {{ link: WantedLink } | { withheld: Withheld }} */
export function wantedLink(peer, fed, opts = {}) {
  if (!isPublishedPeer(peer)) return { withheld: peer.private ? 'private' : 'noUrl' }
  if (!peer.did) return { withheld: 'noDid' }
  const relation = opts.relation !== undefined ? opts.relation : relationOf(peer, fed, opts.where)
  if (!relation) return { withheld: 'noRelation' }
  const explicit = peer.link !== null && peer.link !== 'none'
  if (!explicit && !peer.decision && !(opts.mutualByFiles ?? []).includes(peer.index)) return { withheld: 'undecided' }
  const network = networkOf(peer, relation, fed, opts.where)
  return { link: { subject: peer.did, relation, ...(network !== undefined ? { network } : {}) } }
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** A link record's key when the lexicon's key is `any`: base32 (RFC 4648, lowercase, no padding) of the first 10 bytes
 *  of the SHA-256 of `subject|relation|network` (an absent network is the empty string). 16 characters, a valid rkey.
 *  `hash` gives the hex SHA-256 of a string; it defaults to the pure `lib/sha256.mjs`, and the server may pass its own.
 *  @param {string} subject @param {Relation} relation @param {string | undefined} network
 *  @param {(text: string) => string} [hash] @returns {string} */
export function linkKey(subject, relation, network, hash = sha256Hex) {
  const hex = hash(`${subject}|${relation}|${network ?? ''}`).slice(0, 20)
  let bits = ''
  for (let i = 0; i < 20; i += 2) bits += parseInt(hex.slice(i, i + 2), 16).toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}
