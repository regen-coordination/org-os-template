// packages/admin/lib/federation/join-rule.mjs
//
// `Org-Rule: federation/join` (network N2 Task 9, fix round 1): the named rule a hub's own acts on a join request are
// committed under. The authority is the hub's join policy, not the importer's direct rule: a standing decision
// (`join.decision`) or an invite admits a node, and receiving records what came. validate:governance accepts such a
// commit, and judges it no further, only when `joinCommitProblem` finds nothing:
//   - it changes the hub's files alone (federation.yaml, data/federation-requests.yaml, data/invites.yaml);
//   - it adds or changes exactly one request record and removes none;
//   - a record with no acceptance (refused, held, proposed; or held → refused) changes neither federation.yaml nor
//     data/invites.yaml;
//   - an acceptance names its decision in `Org-Decision`, and that decision is `join.decision` at the parent (with the
//     policy `open`), or `invite <id>` for an invite that was unused at the parent and whose `used_by` this commit sets
//     to the request (and nothing else in data/invites.yaml changes);
//   - federation.yaml changes nothing but the one peer entry whose url is the request's: added, or given a decision or a
//     did it lacked; after the commit that peer holds a decision.
// Pure: parsed documents in, a sentence or null out. No node:* import.

export const JOIN_RULE = 'federation/join'
export const JOIN_FILES = Object.freeze(['federation.yaml', 'data/federation-requests.yaml', 'data/invites.yaml'])

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {string} */
const canon = v => JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x))
/** @param {unknown} a @param {unknown} b */
const same = (a, b) => canon(a) === canon(b)
/** @param {unknown} u */
const norm = u => (typeof u === 'string' ? u.trim().replace(/\/+$/, '').toLowerCase() : '')
/** @param {unknown} doc @param {string} key @returns {Record<string, unknown>[]} */
const listOf = (doc, key) => (isObj(doc) && Array.isArray(doc[key]) ? doc[key].filter(isObj) : [])

/**
 * @param {{ files: string[], decision?: string,
 *   before: { fed: unknown, requests: unknown, invites: unknown },
 *   after: { fed: unknown, requests: unknown, invites: unknown } }} commit
 *   `files`: what the commit changes; `decision`: its Org-Decision; each document as parsed at the parent and at the commit
 *   ({} when the file is absent).
 * @returns {string | null}
 */
export function joinCommitProblem({ files, decision, before, after }) {
  const others = files.filter(f => !JOIN_FILES.includes(f))
  if (others.length > 0) return `it changes ${others.join(', ')}, where a hub's act on a join request changes only ${JOIN_FILES.join(', ')}`
  if (!files.includes('data/federation-requests.yaml')) return 'it records no join request in data/federation-requests.yaml'

  // exactly one record added or changed, none removed
  const was = new Map(listOf(before.requests, 'requests').map(r => [String(r.id), r]))
  const now = listOf(after.requests, 'requests')
  const nowIds = new Set(now.map(r => String(r.id)))
  if ([...was.keys()].some(id => !nowIds.has(id))) return 'it removes a join request record'
  const touched = now.filter(r => !was.has(String(r.id)) || !same(was.get(String(r.id)), r))
  if (touched.length !== 1) return `it adds or changes ${touched.length} join request records, where one act records one`
  const record = touched[0]
  const prior = was.get(String(record.id))
  const fedChanged = files.includes('federation.yaml')
  const invitesChanged = files.includes('data/invites.yaml')

  if (record.outcome !== 'accepted') {
    if (fedChanged || invitesChanged) return `it records the request as ${String(record.outcome)} and still changes ${[fedChanged ? 'federation.yaml' : '', invitesChanged ? 'data/invites.yaml' : ''].filter(Boolean).join(' and ')}`
    if (prior === undefined) return ['refused', 'held', 'proposed'].includes(String(record.outcome)) ? null : `it records a request as ${String(record.outcome)}, which no act of the hub's does`
    return prior.outcome === 'held' && record.outcome === 'refused' ? null : 'it changes a recorded request other than to refuse a held one'
  }
  if (prior !== undefined) return 'it accepts a request recorded before, which only the hub operator decides under their own rule'

  // the decision: a standing one at the parent, or an invite this commit uses
  if (typeof decision !== 'string' || decision === '') return 'it accepts a request with no Org-Decision'
  if (record.decision !== decision) return `its Org-Decision (${decision}) is not the decision its record names`
  const join = isObj(before.fed) && isObj(before.fed.join) ? before.fed.join : null
  const standing = join !== null && join.policy === 'open' && join.decision !== undefined && join.decision !== null && String(join.decision) === decision
  const inviteId = /^invite (i-[0-9a-f]{8})$/.exec(decision)?.[1]
  if (!standing && inviteId === undefined) return `its Org-Decision (${decision}) is neither join.decision at its parent nor an invite`
  if (standing && invitesChanged) return 'it accepts under a standing decision and still changes data/invites.yaml'
  if (!standing) {
    if (join === null || join.policy !== 'invite') return 'it accepts by invite where the hub does not join by invite at its parent'
    if (record.invite !== inviteId) return `its record does not name the invite ${inviteId}`
    const invBefore = listOf(before.invites, 'invites')
    const invAfter = listOf(after.invites, 'invites')
    const used = invBefore.find(i => i.id === inviteId)
    if (!used || (used.used_by !== null && used.used_by !== undefined)) return `the invite ${inviteId} was not unused at its parent`
    const expected = invBefore.map(i => (i.id === inviteId ? { ...i, used_by: record.id } : i))
    if (!same(expected, invAfter)) return `its change to data/invites.yaml is not exactly the invite ${inviteId} used by this request`
  }

  // federation.yaml: only the request's own peer entry
  const { peers: pb, ...restBefore } = isObj(before.fed) ? before.fed : {}
  const { peers: pa, ...restAfter } = isObj(after.fed) ? after.fed : {}
  if (!same(restBefore, restAfter)) return 'it changes federation.yaml beyond its peers'
  const url = norm(isObj(record.from) ? record.from.url : '')
  const peersBefore = Array.isArray(pb) ? pb : []
  const peersAfter = Array.isArray(pa) ? pa : []
  const othersBefore = peersBefore.filter(p => !(isObj(p) && norm(p.url) === url))
  const othersAfter = peersAfter.filter(p => !(isObj(p) && norm(p.url) === url))
  if (!same(othersBefore, othersAfter)) return 'it changes a peer entry other than the requesting instance\'s'
  const mineBefore = peersBefore.filter(p => isObj(p) && norm(p.url) === url)
  const mineAfter = peersAfter.filter(p => isObj(p) && norm(p.url) === url)
  if (mineAfter.length !== 1 || mineBefore.length > 1) return 'it does not leave exactly one peer entry for the requesting instance'
  const peer = /** @type {Record<string, unknown>} */ (mineAfter[0])
  if (peer.decision === undefined || peer.decision === null || peer.decision === '') return 'its peer entry for the requesting instance holds no decision'
  if (mineBefore.length === 1) {
    const old = /** @type {Record<string, unknown>} */ (mineBefore[0])
    for (const key of new Set([...Object.keys(old), ...Object.keys(peer)])) {
      if (same(old[key], peer[key])) continue
      if ((key === 'decision' || key === 'did') && (old[key] === undefined || old[key] === null)) continue
      return `it changes ${key} on the existing peer entry of the requesting instance`
    }
  }
  return null
}
