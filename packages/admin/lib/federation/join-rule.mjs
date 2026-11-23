// packages/admin/lib/federation/join-rule.mjs
//
// `Org-Rule: federation/join` (network N2 Task 9, fix rounds 1 and 2): the named rule a hub's own acts on a join
// request are committed under. The authority is the hub's join policy, not the importer's direct rule: a standing
// decision (`join.decision`) or an invite admits a node, and receiving records what came. validate:governance accepts
// such a commit, and judges it no further, only when its Org-Actor is a member at the parent (checked there) and
// `joinCommitProblem` finds nothing:
//   - it changes the hub's files alone (federation.yaml, data/federation-requests.yaml, data/invites.yaml);
//   - it adds exactly one new request record, changes none and removes none (the operator's own decision on a held
//     request is their direct act, never this rule's);
//   - the record names a network the hub lists at the parent (a refusal may name any: it says the hub lists none so);
//   - a record with no acceptance is `refused` or `held`, or `proposed` naming a proposal in the commit's ledger whose
//     `origin.request` is the record's id; it changes neither federation.yaml nor data/invites.yaml;
//   - an acceptance names its decision in `Org-Decision`, and that decision is the record's and is `join.decision` at the
//     parent (with the policy `open`), or `invite <id>` for an invite of the request's type, unused at the parent and not
//     expired at the commit's date, whose `used_by` this commit sets to the record (nothing else in data/invites.yaml
//     changes);
//   - federation.yaml changes nothing but the requesting url's one peer entry. A new entry has exactly `hubPeerOf`'s shape
//     (keys among name, url, type, trust, relationship, since, decision, did; trust read; relationship node; decision the
//     Org-Decision; name, type and url the record's; did, when written, a DID). An existing entry must already be a node,
//     and only its decision (to the Org-Decision) and did (a DID) may be added, each only where it had none. After the
//     commit the entry holds a decision;
//   - an acceptance meets the policy's own asks at the parent: the request's type is among `join.types` (when listed),
//     and every `join.asks` has a non-empty answer; an invite is also for the record's network;
//   - the records are a list: every record at the parent stays, in place and unchanged, and one is appended, whose
//     from has a name, a type and a url.
// Pure: parsed documents in, a sentence or null out. No node:* import.

import { expiryTime } from './invite.mjs'
import { DID_PATTERN } from './read.mjs'

export const JOIN_RULE = 'federation/join'
export const JOIN_FILES = Object.freeze(['federation.yaml', 'data/federation-requests.yaml', 'data/invites.yaml'])
/** The keys `hubPeerOf` writes. */
const PEER_KEYS = Object.freeze(['name', 'url', 'type', 'trust', 'relationship', 'since', 'decision', 'did'])

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {string} */
const canon = v => JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x))
/** @param {unknown} a @param {unknown} b */
const same = (a, b) => canon(a) === canon(b)
/** The url normalisation the server matches peers with (`normUrl`). @param {unknown} u */
const norm = u => (typeof u === 'string' ? u.trim().replace(/\/+$/, '').toLowerCase() : '')
/** @param {unknown} doc @param {string} key @returns {Record<string, unknown>[]} */
const listOf = (doc, key) => (isObj(doc) && Array.isArray(doc[key]) ? doc[key].filter(isObj) : [])
/** @param {unknown} v */
const absent = v => v === undefined || v === null || v === ''

/**
 * @param {{ files: string[], decision?: string, date: string,
 *   before: { fed: unknown, requests: unknown, invites: unknown, proposals?: unknown },
 *   after: { fed: unknown, requests: unknown, invites: unknown, proposals?: unknown } }} commit
 *   `files`: what the commit changes; `decision`: its Org-Decision; `date`: its date (ISO 8601); each document as parsed
 *   at the parent and at the commit ({} when the file is absent).
 * @returns {string | null}
 */
export function joinCommitProblem({ files, decision, date, before, after }) {
  const others = files.filter(f => !JOIN_FILES.includes(f))
  if (others.length > 0) return `it changes ${others.join(', ')}, where a hub's act on a join request changes only ${JOIN_FILES.join(', ')}`
  if (!files.includes('data/federation-requests.yaml')) return 'it records no join request in data/federation-requests.yaml'

  // the records as a list: every one at the parent kept, in place and unchanged (duplicates included), and one appended
  const was = isObj(before.requests) && Array.isArray(before.requests.requests) ? before.requests.requests : []
  const now = isObj(after.requests) && Array.isArray(after.requests.requests) ? after.requests.requests : []
  if (now.length < was.length || was.some((r, i) => !same(r, now[i]))) {
    return 'it removes or changes a recorded join request, which only the hub operator does, under their own rule'
  }
  if (now.length !== was.length + 1) return `it adds ${now.length - was.length} join request records, where one act records one`
  const record = now[now.length - 1]
  if (!isObj(record)) return 'the record it adds is not a mapping'
  if (was.some(r => isObj(r) && r.id === record.id)) return `it records the request ${String(record.id)} a second time`
  const recFrom = isObj(record.from) ? record.from : {}
  if (!['name', 'type', 'url'].every(k => typeof recFrom[k] === 'string' && recFrom[k] !== '')) return "its record's from has no name, type and url"

  // anything but a refusal names a network the hub lists (a refusal may say it lists none by that name)
  const networks = isObj(before.fed) && Array.isArray(before.fed.networks) ? before.fed.networks.filter(isObj).map(n => n.name) : []
  if (record.outcome !== 'refused' && !networks.includes(record.network)) return 'its record names a network the hub does not list at its parent'

  const fedChanged = files.includes('federation.yaml')
  const invitesChanged = files.includes('data/invites.yaml')
  if (record.outcome !== 'accepted') {
    if (fedChanged || invitesChanged) return `it records the request as ${String(record.outcome)} and still changes ${[fedChanged ? 'federation.yaml' : '', invitesChanged ? 'data/invites.yaml' : ''].filter(Boolean).join(' and ')}`
    if (record.outcome === 'held') return null
    if (record.outcome === 'refused') return null
    if (record.outcome === 'proposed') {
      const p = listOf(after.proposals, 'proposals').find(x => String(x.id) === String(record.proposal))
      const origin = p && isObj(p.origin) ? p.origin : null
      return origin && origin.kind === 'federation-request' && origin.request === record.id ? null
        : `its record names proposal ${String(record.proposal)}, which is no proposal of this request in data/proposals.yaml`
    }
    return `it records a request as ${String(record.outcome)}, which no act of the hub's does`
  }

  // the decision: a standing one at the parent, or an invite this commit uses
  if (typeof decision !== 'string' || decision === '') return 'it accepts a request with no Org-Decision'
  if (record.decision !== decision) return `its Org-Decision (${decision}) is not the decision its record names`
  const join = isObj(before.fed) && isObj(before.fed.join) ? before.fed.join : null
  const standing = join !== null && join.policy === 'open' && !absent(join.decision) && String(join.decision) === decision
  const inviteId = /^invite (i-[0-9a-f]{8})$/.exec(decision)?.[1]
  if (!standing && inviteId === undefined) return `its Org-Decision (${decision}) is neither join.decision at its parent nor an invite`
  // what the policy asks, at the parent, as the server's intake asks it (lib/federation/intake.mjs)
  const types = join !== null && Array.isArray(join.types) ? join.types : []
  if (types.length > 0 && !types.includes(recFrom.type)) return `the hub takes ${types.join(', ')} at its parent, and the request is from a ${String(recFrom.type)}`
  const answers = isObj(record.answers) ? record.answers : {}
  for (const ask of join !== null && Array.isArray(join.asks) ? join.asks : []) {
    const answer = Object.hasOwn(answers, ask) ? answers[ask] : undefined
    if (typeof answer !== 'string' || answer.trim() === '') return `its record leaves "${String(ask)}" unanswered, which the hub asks at its parent`
  }
  if (standing && invitesChanged) return 'it accepts under a standing decision and still changes data/invites.yaml'
  if (!standing) {
    if (join === null || join.policy !== 'invite') return 'it accepts by invite where the hub does not join by invite at its parent'
    if (record.invite !== inviteId) return `its record does not name the invite ${inviteId}`
    const invBefore = listOf(before.invites, 'invites')
    const invAfter = listOf(after.invites, 'invites')
    const used = invBefore.find(i => i.id === inviteId)
    if (!used || !absent(used.used_by)) return `the invite ${inviteId} was not unused at its parent`
    if (used.network !== record.network) return `the invite ${inviteId} is for another network than the record's`
    if (used.type !== recFrom.type) return `the invite ${inviteId} is for the type ${String(used.type)}, and the request's type is ${String(recFrom.type)}`
    const expires = typeof used.expires === 'string' ? expiryTime(used.expires) : NaN
    if (!(new Date(date).getTime() <= expires)) return `the invite ${inviteId} had expired at the commit's date`
    const expected = invBefore.map(i => (i.id === inviteId ? { ...i, used_by: record.id } : i))
    if (!same(expected, invAfter)) return `its change to data/invites.yaml is not exactly the invite ${inviteId} used by this request`
  }

  // federation.yaml: only the request's own peer entry
  const { peers: pb, ...restBefore } = isObj(before.fed) ? before.fed : {}
  const { peers: pa, ...restAfter } = isObj(after.fed) ? after.fed : {}
  if (!same(restBefore, restAfter)) return 'it changes federation.yaml beyond its peers'
  const url = norm(recFrom.url)
  const peersBefore = Array.isArray(pb) ? pb : []
  const peersAfter = Array.isArray(pa) ? pa : []
  const othersBefore = peersBefore.filter(p => !(isObj(p) && norm(p.url) === url))
  const othersAfter = peersAfter.filter(p => !(isObj(p) && norm(p.url) === url))
  if (!same(othersBefore, othersAfter)) return 'it changes a peer entry other than the requesting instance\'s'
  const mineBefore = peersBefore.filter(p => isObj(p) && norm(p.url) === url)
  const mineAfter = peersAfter.filter(p => isObj(p) && norm(p.url) === url)
  if (mineAfter.length !== 1 || mineBefore.length > 1) return 'it does not leave exactly one peer entry for the requesting instance'
  const peer = /** @type {Record<string, unknown>} */ (mineAfter[0])
  if (absent(peer.decision)) return 'its peer entry for the requesting instance holds no decision'

  if (mineBefore.length === 0) {
    // a new entry: exactly hubPeerOf's shape, from the record
    const extra = Object.keys(peer).filter(k => !PEER_KEYS.includes(k))
    if (extra.length > 0) return `its new peer entry carries ${extra.join(', ')}, which a hub's acceptance never writes`
    if (peer.trust !== 'read') return `its new peer entry has trust ${String(peer.trust)}, where an acceptance gives read`
    if (peer.relationship !== 'node') return `its new peer entry has relationship ${String(peer.relationship)}, where an acceptance makes a node`
    if (peer.decision !== decision) return `its new peer entry's decision (${String(peer.decision)}) is not its Org-Decision`
    if (peer.did !== undefined && !(typeof peer.did === 'string' && DID_PATTERN.test(peer.did))) return 'its new peer entry\'s did is not a DID'
    for (const key of ['name', 'type', 'url']) {
      if (peer[key] !== recFrom[key]) return `its new peer entry's ${key} is not the one its record holds`
    }
    return null
  }
  // an existing entry: already a node; only decision and did change, each only where it had none (the server fills a
  // missing did on an acceptance, which is the only commit that touches an existing entry here)
  const old = /** @type {Record<string, unknown>} */ (mineBefore[0])
  if (old.relationship !== 'node') return `it gives a decision to the requesting instance's peer entry, whose relationship is ${String(old.relationship ?? 'none')}, not node`
  for (const key of new Set([...Object.keys(old), ...Object.keys(peer)])) {
    if (same(old[key], peer[key])) continue
    if (key === 'did' && absent(old.did) && typeof peer.did === 'string' && DID_PATTERN.test(peer.did)) continue
    if (key === 'decision' && absent(old.decision) && peer.decision === decision) continue
    return `it changes ${key} on the existing peer entry of the requesting instance`
  }
  return null
}
