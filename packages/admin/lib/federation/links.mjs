// packages/admin/lib/federation/links.mjs
//
// The link-record contract of network N2 (spec §15, R21–R28): a public membership link is a record each side publishes
// in its own atproto repository. This file holds the names and the parsers every read goes through (Task 3), and
// reciprocity, the relation of a peer, R24's wanted test and the record key (Task 4); and the planner of what this org
// publishes (Task 7). Pure: relative imports only (no node:* and no npm), because the app imports it for the page's words.
//
// Reading never depends on a record's key: it lists a collection and matches fields. A record another client wrote may
// carry more keys; they are ignored when read and never written. A record that does not parse is skipped, never thrown.

import { isDid } from './read.mjs'
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
/** @typedef {{ mutualByFiles?: readonly number[], membersByFiles?: readonly number[] }} ByFiles  what both sides' files say, as peer
 *  indexes computed server-side (R4): `mutualByFiles`, their files list this instance; `membersByFiles`, their files name this
 *  instance as the hub of one of their `networks` */
/** @typedef {{ subject: string, relation: Relation, network?: string }} WantedLink */
/** @typedef {'private' | 'noUrl' | 'noDid' | 'noRelation' | 'undecided'} Withheld */
/** @typedef {{ networks: ProfileNetwork[], rest: Record<string, unknown> }} ProfileRecord */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A did:plc or did:web identifier: the one check, kept in read.mjs so federation.yaml and the records agree. */
export { isDid }

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

/** Whether this instance says it is a hub: a `join` block, or one of its `networks` with `role: hub`.
 *  @param {FedLike} fed */
export const isHub = fed => Boolean(fed.join) || (fed.networks ?? []).some(n => n.role === 'hub')

/** The relation a link record for this peer would state (R24.3), or null:
 *  - an explicit `peer.link` wins, and `none` gives null;
 *  - else a peer that is the hub of one of `fed.networks` (same address) is `memberOf`;
 *  - else, on an instance that is a hub (`isHub`: a `join` block, or one of its `networks` with `role: hub`), a
 *    `relationship: node` peer is `hasMember` when it has a `decision` (a member ratified through the hub's proposal
 *    path carries `decision: request <id>`, R3), or, with no decision, when it is mutual by files and its own files name
 *    this instance as the hub of one of their networks (R4: memberships from before N2 are published). A peer listed
 *    in another role (or with none) never becomes `hasMember` this way;
 *  - else null. Free-form `relationship` values are never mapped.
 *  `where` resolves path refs against the instance folder on the disk; without it only addresses compare by text.
 *  @param {Peer} peer @param {FedLike} fed @param {Where & ByFiles} [where] @returns {Relation | null} */
export function relationOf(peer, fed, where = {}) {
  if (peer.link) return peer.link === 'none' ? null : /** @type {Relation} */ (peer.link)
  if (hubNetworkOf(peer, fed, where)) return 'memberOf'
  if (peer.relationship !== 'node' || !isHub(fed)) return null
  if (peer.decision) return 'hasMember'
  if ((where.mutualByFiles ?? []).includes(peer.index) && (where.membersByFiles ?? []).includes(peer.index)) return 'hasMember'
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
 *  itself the decision. `relation`, when given, is used as it is (the caller worked it out with the disk); otherwise
 *  it is `relationOf` with the same files readings, so an existing member mutual by files is `hasMember` (R4).
 *  @param {Peer} peer @param {FedLike} fed
 *  @param {{ relation?: Relation | null, where?: Where } & ByFiles} [opts]
 *  @returns {{ link: WantedLink } | { withheld: Withheld }} */
export function wantedLink(peer, fed, opts = {}) {
  if (!isPublishedPeer(peer)) return { withheld: peer.private ? 'private' : 'noUrl' }
  if (!peer.did) return { withheld: 'noDid' }
  const relation = opts.relation !== undefined ? opts.relation
    : relationOf(peer, fed, { ...opts.where, mutualByFiles: opts.mutualByFiles, membersByFiles: opts.membersByFiles })
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

/** What federation.yaml allows this org to publish for one peer:
 *  - `wanted`: R24's answer with the files as they read now (`filesSide`);
 *  - `tolerated`: when their files can't be read (`unknown`), the link R24 would want if they still listed this
 *    instance (and named it as hub). A record of it is kept: an unreadable read never makes it "not allowed", so it is
 *    neither urgent drift nor a delete (review focus 10). It never makes a link wanted: nothing is published from it.
 *  `relation` and `where` are the caller's (relationOf with the disk), so the record's network is resolved the same way.
 *  The planner below matches records against both: create from `wanted`, never delete what `tolerated` matches.
 *  (Task 4 wrote it in state.mjs, which re-exports it; it lives here so the planner needs no circular import.)
 *  @param {{ peer: Peer, fed: any, relation: Relation | null, filesSide: string, where?: Where }} input
 *  @returns {{ wanted: ReturnType<typeof wantedLink>, tolerated: WantedLink | null }} */
export function linkVerdict({ peer, fed, relation, filesSide: side, where }) {
  const f = fed ?? { networks: [], join: null }
  const wanted = wantedLink(peer, f, { relation, mutualByFiles: side === 'lists-us' ? [peer.index] : [], where })
  if (side !== 'unknown' || 'link' in wanted) return { wanted, tolerated: null }
  const mine = [peer.index]
  const asIfListed = relation ?? relationOf(peer, f, { ...where, mutualByFiles: mine, membersByFiles: mine })
  const hoped = wantedLink(peer, f, { relation: asIfListed, mutualByFiles: mine, where })
  return { wanted, tolerated: 'link' in hoped ? hoped.link : null }
}

/** @typedef {{ uri: string, cid: string, value: LinkRecord }} OwnLink  one of this org's link records, as read back */
/** @typedef {{ uri: string, cid: string, value: ProfileRecord }} OwnProfile  this org's profile `self`, as read back */
/** @typedef {ByFiles & { unreadByFiles?: readonly number[] }} FilesReadings  `unreadByFiles`: the peers whose files
 *  could not be read here (their files side is unknown), so a record R24 would allow if they still listed this
 *  instance is kept */
/** @typedef {{ private: number, noUrl: number, noDid: number, noRelation: number, undecided: number }} WithheldCounts */
/** @typedef {{ wanted: WantedLink[], create: { rkey: string, record: LinkRecord }[], delete: OwnLink[], keep: OwnLink[],
 *   profile: { record: Record<string, unknown>, swapRecord?: string } | null, profileWithheld: boolean, withheld: WithheldCounts }} LinkPlan */

/** The match of a record or a wanted link: subject, relation and network, never the record's key.
 *  @param {{ subject: string, relation: string, network?: string }} l */
const matchKey = l => `${l.subject}|${l.relation}|${l.network ?? ''}`

/** A record's `createdAt` from a peer's `since`: a date becomes its midnight UTC; a full datetime is kept; anything
 *  else gives way to `now`.  @param {string | null} since @param {string} now @returns {string} */
function createdAtOf(since, now) {
  if (typeof since === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(since) && !Number.isNaN(Date.parse(`${since}T00:00:00.000Z`))) return `${since}T00:00:00.000Z`
    const asRecord = parseLinkRecord({ $type: LINK_NSID, subject: 'did:web:example.org', relation: 'peerOf', createdAt: since })
    if (asRecord) return since
  }
  return now
}

/** The networks this instance is the hub of: its `role: hub` entries; else, on an instance with a `join` block, its
 *  only network when no peer is that network's hub.  @param {FedLike} fed @param {Peer[]} peers @param {Where} where */
function ownNetworks(fed, peers, where) {
  const networks = fed.networks ?? []
  const hubs = networks.filter(n => n.role === 'hub')
  if (hubs.length > 0) return hubs
  if (!fed.join || networks.length !== 1) return []
  return peers.some(p => hubNetworkOf(p, fed, where) === networks[0]) ? [] : networks
}

/** What this org publishes on atproto, from federation.yaml alone (R24, R25). Pure.
 *  - `wanted`: one link per peer that `wantedLink` passes, with the files readings passed in (R4); each once.
 *  - `create`: wanted links no own record matches (on subject, relation and network, never the key), keyed by
 *    `linkKey` and dated by the peer's `since`, else `now`; exactly the five fields.
 *  - `delete`: own records that are neither wanted nor tolerated (their files unreadable here): a peer made private,
 *    a peer removed, a record federation.yaml never listed.
 *  - `keep`: the rest. An unchanged record is never planned again.
 *  - `profile`: `networks` = each network whose hub has a wanted `memberOf` ({ hub: its DID, name }), and on a hub its
 *    own network ({ hub: selfDid, name }); every other key of the existing profile is kept as it is. Planned when the
 *    networks changed, or when there is no profile yet and something is published (a peer reads an org with no profile
 *    as not on atproto). `swapRecord` is the current profile's cid. A new profile also carries `name` and `createdAt`
 *    (the drafted lexicon requires them); an existing one is never given keys it didn't have, other than `networks`.
 *  - `profileWithheld`: `profileUnread` was given (a `self` record is there but didn't parse), so no profile is
 *    planned at all: a record that couldn't be read is never written over blind.
 *  - `withheld`: counts only; no peer is named anywhere in the plan.
 *  @param {{ fed: FedLike & { peers: Peer[] }, selfDid: string | null, ownRecords?: OwnLink[] | null,
 *   ownProfile?: OwnProfile | null, profileUnread?: boolean, now: string | Date, hash?: (text: string) => string, where?: Where,
 *   byFiles?: FilesReadings }} input
 *  @returns {LinkPlan} */
export function planLinks({ fed, selfDid, ownRecords, ownProfile, profileUnread = false, now, hash, where = {}, byFiles = {} }) {
  const at = typeof now === 'string' ? now : now.toISOString()
  const mutual = byFiles.mutualByFiles ?? []
  const members = byFiles.membersByFiles ?? []
  const unread = byFiles.unreadByFiles ?? []
  const peers = fed.peers ?? []
  /** @type {WithheldCounts} */
  const withheld = { private: 0, noUrl: 0, noDid: 0, noRelation: 0, undecided: 0 }
  /** @type {Map<string, { link: WantedLink, createdAt: string }>} */
  const wanted = new Map()
  /** @type {Set<string>} */
  const tolerated = new Set()
  for (const peer of peers) {
    const mine = [peer.index]
    const side = mutual.includes(peer.index) ? 'lists-us' : unread.includes(peer.index) ? 'unknown' : 'silent'
    const relation = relationOf(peer, fed, { ...where, mutualByFiles: side === 'lists-us' ? mine : [], membersByFiles: members.includes(peer.index) ? mine : [] })
    const verdict = linkVerdict({ peer, fed, relation, filesSide: side, where })
    if ('link' in verdict.wanted) {
      const key = matchKey(verdict.wanted.link)
      if (!wanted.has(key)) wanted.set(key, { link: verdict.wanted.link, createdAt: createdAtOf(peer.since, at) })
    } else {
      withheld[verdict.wanted.withheld] += 1
    }
    if (verdict.tolerated) tolerated.add(matchKey(verdict.tolerated))
  }

  const own = Array.isArray(ownRecords) ? ownRecords.filter(r => r && r.value) : []
  const ownKeys = new Set(own.map(r => matchKey(r.value)))
  /** @type {LinkPlan['create']} */
  const create = []
  for (const { link, createdAt } of wanted.values()) {
    if (ownKeys.has(matchKey(link))) continue
    /** @type {LinkRecord} */
    const record = { $type: LINK_NSID, subject: link.subject, relation: link.relation, ...(link.network !== undefined ? { network: link.network } : {}), createdAt }
    create.push({ rkey: linkKey(link.subject, link.relation, link.network, hash), record })
  }
  const allowed = r => wanted.has(matchKey(r.value)) || tolerated.has(matchKey(r.value))
  const keep = own.filter(allowed)
  const del = own.filter(r => !allowed(r))

  /** @type {ProfileNetwork[]} */
  const networks = []
  const seen = new Set()
  const add = (/** @type {ProfileNetwork} */ n) => { const k = `${n.hub}|${n.name}`; if (!seen.has(k)) { seen.add(k); networks.push(n) } }
  for (const { link } of wanted.values()) if (link.relation === 'memberOf' && link.network !== undefined) add({ hub: link.subject, name: link.network })
  if (selfDid) for (const n of ownNetworks(fed, peers, where)) add({ hub: selfDid, name: n.name })
  const sameNetworks = (/** @type {ProfileNetwork[]} */ a) => a.length === networks.length && a.every(n => seen.has(`${n.hub}|${n.name}`))
    && new Set(a.map(n => `${n.hub}|${n.name}`)).size === a.length
  /** @type {LinkPlan['profile']} */
  let profile = null
  if (profileUnread) {
    // A profile `self` is there but didn't parse: it is never written over blind. The plan says it was left as it is.
  } else if (ownProfile && ownProfile.value) {
    if (!sameNetworks(ownProfile.value.networks)) {
      profile = { record: { $type: PROFILE_NSID, ...ownProfile.value.rest, networks }, swapRecord: ownProfile.cid }
    }
  } else if (networks.length > 0 || wanted.size > 0) {
    // A new profile carries what the drafted lexicon requires: `name` (identity.name, else the slug, else the DID) and
    // `createdAt`. An existing one is never given them: it keeps its own keys plus `networks`.
    const identity = /** @type {Record<string, unknown>} */ ((/** @type {any} */ (fed)).identity ?? {})
    const str = (/** @type {unknown} */ v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
    const name = (str(identity.name) ?? str(identity.slug) ?? selfDid ?? '').slice(0, NETWORK_NAME_MAX)
    profile = { record: { $type: PROFILE_NSID, name, networks, createdAt: at } }
  }

  return { wanted: [...wanted.values()].map(w => w.link), create, delete: del, keep, profile, profileWithheld: Boolean(profileUnread), withheld }
}
