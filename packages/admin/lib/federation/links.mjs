// packages/admin/lib/federation/links.mjs
//
// The link-record contract of network N2 (spec §15, R21–R28): a public membership link is a record each side publishes
// in its own atproto repository. This file holds the names and the parsers every read goes through (Task 3); Task 4
// adds reciprocity, the relation of a peer and the record key; Task 7 the planner of what this org publishes.
// Pure: no node:* and no npm import, because the app imports it for the page's words.
//
// Reading never depends on a record's key: it lists a collection and matches fields. A record another client wrote may
// carry more keys; they are ignored when read and never written. A record that does not parse is skipped, never thrown.

import { DID_PATTERN } from './read.mjs'

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
