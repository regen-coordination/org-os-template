// packages/admin/lib/federation/read.mjs
//
// Reads federation.yaml in every shape the instances really use (network N0 spec §12 R2).
// Pure: no node:* and no npm import, because the standards builder vendors this file into instances.
// It takes the parsed YAML and never throws; anything odd becomes a warning in `problems`, never an error.

export const JOIN_POLICIES = Object.freeze(['closed', 'invite', 'open-with-approval', 'open'])
export const TRUST_LEVELS = Object.freeze(['full', 'read', 'read-write', 'none'])
/** A peer's `link`: the relation a published link record states, or `none` to keep the peer off atproto (R24). */
export const LINK_RELATIONS = Object.freeze(['memberOf', 'hasMember', 'peerOf', 'none'])
/** An atproto DID this module accepts: did:plc or did:web. */
export const DID_PATTERN = /^did:(plc|web):/

/** @typedef {{ name: string, hub: string | null, role: string | null }} Network */
/** @typedef {{ index: number, name: string, ref: string | null, url: string | null, type: string | null,
 *   trust: string | null, relationship: string | null, since: string | null, decision: string | null,
 *   requested: string | null, did: string | null, link: string | null, private: boolean }} Peer */
/** @typedef {{ policy: string, types: string[], asks: string[], where: string | null, decision: string | null }} Join */
/** @typedef {{ level: 'warn', text: string }} FederationProblem */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A non-empty string, or null.  @param {unknown} v @returns {string | null} */
const str = v => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** A string, or null. YAML turns a bare date into a Date, so that becomes YYYY-MM-DD.
 *  @param {unknown} v @returns {string | null} */
const strOrDate = v => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  return str(v)
}

/** Only the string items of a list.  @param {unknown} v @returns {string[]} */
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])

/** A hub is a string, or an object that gives a url or a repo.  @param {unknown} v @returns {string | null} */
const hubOf = v => (isObj(v) ? str(v.url) ?? str(v.repo) : str(v))

/** @param {unknown} doc parsed YAML
 *  @returns {{ identity: Record<string, unknown>, networks: Network[], peers: Peer[], join: Join | null,
 *   problems: FederationProblem[] }} */
export function readFederation(doc) {
  const d = isObj(doc) ? doc : {}
  /** @type {FederationProblem[]} */
  const problems = []
  const warn = (/** @type {string} */ text) => problems.push({ level: 'warn', text })

  const identity = isObj(d.identity) ? d.identity : {}
  if (identity.did !== undefined && !(typeof identity.did === 'string' && DID_PATTERN.test(identity.did))) {
    warn('federation.yaml: identity.did is not a did:plc or did:web identifier.')
  }

  // The framework's v3 shape nests network, hub, networks and peers under `federation:`. They are read from there
  // only when the top level has none of them, and each one read that way says to move it up.
  const nested = isObj(d.federation) ? d.federation : {}
  const topHasNetwork = d.network !== undefined || d.hub !== undefined || d.networks !== undefined
  /** @type {Record<string, unknown>} */
  const src = { network: d.network, hub: d.hub, networks: d.networks, peers: d.peers }
  for (const key of /** @type {const} */ (['network', 'hub', 'networks', 'peers'])) {
    if (nested[key] === undefined || (key === 'peers' ? d.peers !== undefined : topHasNetwork)) continue
    src[key] = nested[key]
    warn(`federation.yaml: federation.${key} is read as ${key}; move it to the top level.`)
  }

  /** @type {Network[]} */
  let networks = []
  if (Array.isArray(src.networks)) {
    src.networks.forEach((n, index) => {
      const name = isObj(n) ? str(n.name) : null
      if (!isObj(n) || !name) {
        warn(`federation.yaml: networks #${index + 1} has no name; it is skipped.`)
        return
      }
      networks.push({ name, hub: hubOf(n.hub ?? n.url), role: str(n.role) })
    })
    if (src.network !== undefined || src.hub !== undefined) warn('federation.yaml: network and hub are ignored because networks is set.')
  } else if (str(src.network)) {
    networks = [{ name: /** @type {string} */ (str(src.network)), hub: hubOf(src.hub), role: null }]
  }

  /** @type {Peer[]} */
  const peers = []
  if (Array.isArray(src.peers)) {
    src.peers.forEach((p, index) => {
      const name = isObj(p) ? str(p.name) : null
      if (!isObj(p) || !name) {
        warn(`federation.yaml: peers #${index + 1} has no name; it is skipped.`)
        return
      }
      const trust = str(p.trust)
      if (trust && !TRUST_LEVELS.includes(trust)) {
        warn(`federation.yaml: peer "${name}" has trust "${trust}"; expected one of ${TRUST_LEVELS.join(', ')}.`)
      }
      let did = null
      if (p.did !== undefined) {
        if (typeof p.did === 'string' && DID_PATTERN.test(p.did)) did = p.did
        else warn(`federation.yaml: peer "${name}" has a did that is not a did:plc or did:web identifier; it is ignored.`)
      }
      let link = null
      if (p.link !== undefined) {
        if (typeof p.link === 'string' && LINK_RELATIONS.includes(p.link)) link = p.link
        else warn(`federation.yaml: peer "${name}" has link "${String(p.link)}"; expected one of ${LINK_RELATIONS.join(', ')}.`)
      }
      peers.push({
        index, name, ref: str(p.repo), url: str(p.url), type: str(p.type), trust,
        relationship: str(p.relationship), since: strOrDate(p.since), decision: strOrDate(p.decision),
        requested: str(p.requested), did, link,
        private: p.visibility === 'private',
      })
    })
  }

  /** @type {Join | null} */
  let join = null
  if (isObj(d.join)) {
    const policy = str(d.join.policy)
    if (policy && JOIN_POLICIES.includes(policy)) {
      join = { policy, types: strings(d.join.types), asks: strings(d.join.asks), where: str(d.join.where), decision: strOrDate(d.join.decision) }
    } else {
      warn(`federation.yaml: join.policy "${policy ?? ''}" is not one of ${JOIN_POLICIES.join(', ')}; join is ignored.`)
    }
  }

  return { identity, networks, peers, join, problems }
}
