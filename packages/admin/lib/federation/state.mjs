// packages/admin/lib/federation/state.mjs
//
// One link state from every source (network N2, spec §15 R22–R24). The state is computed, never stored.
// - Our side: federation.yaml decides. Our own atproto records only make drift; they are never read back into it.
// - Their side: once their atproto reading has a profile record, their records decide (a link record naming our DID
//   with the reciprocal relation), and their files are a cross-check whose disagreement is drift. Without a profile
//   record, their files decide (the local folder, else the remote cache), as in N0.
// - A failed read never moves a link: with no earlier success that side is unknown; with one, that reading is used and
//   its date is said.
// Pure: relative imports only, because the app imports it for the page's words.

import { LINK_STATES } from './peers.mjs'
import { reciprocal, linkVerdict } from './links.mjs'

export { LINK_STATES }
/** `linkVerdict` lives in links.mjs (Task 7's planner needs it there); it is re-exported here, where Task 4 put it. */
export { linkVerdict }

/** Every drift line's words. */
export const DRIFT = Object.freeze({
  theirFilesOnly: "Their files list you; their record isn't published.",
  theirRecordOnly: "Their record is published; their files don't list you.",
  notPublished: 'Not published yet.',
  unlisted: 'Published, but federation.yaml no longer lists it.',
  private: 'Published, but federation.yaml lists it as private.',
})

/** @typedef {import('./read.mjs').Peer} Peer */
/** @typedef {import('./links.mjs').Relation} Relation */
/** @typedef {import('./links.mjs').LinkRecord} LinkRecord */
/** @typedef {{ uri: string, cid: string, value: LinkRecord }} OwnRecord */
/** @typedef {{ state: string, path: string | null, reason: string | null }} FilesReading  peers.mjs linkState's answer */
/** @typedef {{ listsUs: boolean, fetchedAt: string }} RemoteReading  their federation.json, as last read (remote cache) */
/** @typedef {{ did: string, reading: { profile: unknown, links: { value: { subject: string, relation: string } }[], fetchedAt: string } | null,
 *   lastProblem: { at: string, text: string } | null }} AtprotoEntry  the atproto cache's entry for their DID */
/** @typedef {{ side: 'ours' | 'theirs', text: string, urgent?: true, uri?: string, subject?: string }} Drift */
/** @typedef {{ files: 'lists-us' | 'silent' | 'unknown', atproto: 'lists-us' | 'silent' | 'not-on-atproto' | 'unknown',
 *   checked: string | null }} Sources */

/** Their files' reading: the local folder, else (no folder was looked at) the remote cache.
 *  @param {FilesReading | null | undefined} files @param {RemoteReading | null | undefined} remote
 *  @returns {{ side: 'lists-us' | 'silent' | 'not-an-instance' | 'unknown', checked: string | null, reason: string | null }} */
export function filesSide(files, remote) {
  if ((!files || (files.state === 'unknown' && files.path === null)) && remote) {
    return { side: remote.listsUs ? 'lists-us' : 'silent', checked: remote.fetchedAt, reason: `checked ${remote.fetchedAt}` }
  }
  const side = files?.state === 'mutual' ? 'lists-us'
    : files?.state === 'claimed' ? 'silent'
      : files?.state === 'not-an-instance' ? 'not-an-instance' : 'unknown'
  return { side, checked: null, reason: files?.reason ?? null }
}

/** Their atproto reading, for the link `relation` from our side.
 *  @param {Peer} peer @param {Relation | null} relation @param {string | null} selfDid @param {AtprotoEntry | null | undefined} atproto
 *  @returns {{ side: Sources['atproto'], checked: string | null, failedAt: string | null }} */
function atprotoSide(peer, relation, selfDid, atproto) {
  if (!peer.did) return { side: 'not-on-atproto', checked: null, failedAt: null }
  if (!atproto || atproto.did !== peer.did) return { side: 'unknown', checked: null, failedAt: null }
  const r = atproto.reading
  if (!r) return { side: 'unknown', checked: null, failedAt: atproto.lastProblem?.at ?? null }
  if (!r.profile) return { side: 'not-on-atproto', checked: r.fetchedAt, failedAt: null }
  // Their record lists us when it names our DID with the reciprocal relation. With no relation on our side there is no
  // public link to match, so any record naming us is shown (and their files decide). With no DID, nothing can name us.
  const want = reciprocal(relation)
  const lists = selfDid !== null && r.links.some(l => l?.value?.subject === selfDid && (want === null || l.value.relation === want))
  return { side: lists ? 'lists-us' : 'silent', checked: r.fetchedAt, failedAt: null }
}

/** Our side's drift for one peer: our records for its DID that R24 doesn't allow (urgent), then the wanted link when
 *  our record of it is missing. None when our records were never read. A record `tolerated` while their files can't
 *  be read makes no line.
 *  @param {Peer} peer @param {Relation | null} relation @param {any} fed @param {OwnRecord[] | null | undefined} ownRecords
 *  @param {string} side their files' side @param {import('./links.mjs').Where | undefined} where @returns {Drift[]} */
function ourDrift(peer, relation, fed, ownRecords, side, where) {
  if (!Array.isArray(ownRecords)) return []
  const { wanted, tolerated } = linkVerdict({ peer, fed, relation, filesSide: side, where })
  const mine = peer.did ? ownRecords.filter(r => r?.value?.subject === peer.did) : []
  /** @param {LinkRecord} v @param {import('./links.mjs').WantedLink} w */
  const same = (v, w) => v.relation === w.relation && (v.network ?? null) === (w.network ?? null)
  /** @type {Drift[]} */
  const out = []
  const kept = 'withheld' in wanted && (wanted.withheld === 'private' || wanted.withheld === 'noUrl')
  for (const r of mine) {
    if ('link' in wanted && same(r.value, wanted.link)) continue
    if (tolerated && same(r.value, tolerated)) continue
    out.push({ side: 'ours', text: kept ? DRIFT.private : DRIFT.unlisted, urgent: true, uri: r.uri })
  }
  if ('link' in wanted && !mine.some(r => same(r.value, wanted.link))) out.push({ side: 'ours', text: DRIFT.notPublished })
  return out
}

/** The state of one peer's link, from every source.
 *  - `peer`, `relation` (relationOf, worked out with the disk), `selfDid` (identity.did, or null), `fed` (readFederation);
 *  - `files`: peers.mjs linkState (the local folder); `remote`: their federation.json as last read, or null;
 *  - `atproto`: the atproto cache's entry for their DID, or null; `ownRecords`: our link records as last read, or null;
 *  - `where`: the same `{ base, io }` the relation was worked out with, so our record's network resolves the same way.
 *  @param {{ peer: Peer, relation: Relation | null, selfDid: string | null, files: FilesReading | null,
 *   remote?: RemoteReading | null, atproto?: AtprotoEntry | null, ownRecords?: OwnRecord[] | null, fed?: any,
 *   where?: import('./links.mjs').Where }} input
 *  @returns {{ state: string, sources: Sources, drift: Drift[], reason: string | null }} */
export function combineLinkState({ peer, relation, selfDid, files, remote = null, atproto = null, ownRecords = null, fed, where }) {
  const f = filesSide(files, remote)
  const a = atprotoSide(peer, relation, selfDid ?? null, atproto)
  // Their records decide only a public link: we have a DID for them to name, and a relation for them to answer (R13).
  const atprotoCounts = Boolean(selfDid) && relation !== null
  /** @type {Drift[]} */
  const theirs = []
  /** @type {'lists-us' | 'silent' | 'not-an-instance' | 'unknown'} */
  let side
  /** @type {string | null} */
  let reason
  if (atprotoCounts && a.failedAt !== null) {
    side = 'unknown'
    reason = `couldn't check their records (${a.failedAt})`
  } else if (atprotoCounts && (a.side === 'lists-us' || a.side === 'silent')) {
    side = a.side
    reason = `checked ${a.checked}`
    const filesList = f.side === 'lists-us'
    if (f.side !== 'unknown' && filesList !== (a.side === 'lists-us')) {
      theirs.push({ side: 'theirs', text: filesList ? DRIFT.theirFilesOnly : DRIFT.theirRecordOnly })
    }
  } else {
    side = f.side
    reason = f.reason
  }

  const state = side === 'lists-us' ? 'mutual'
    : side === 'silent' ? (peer.decision ? 'left' : peer.requested ? 'requested' : 'claimed')
      : side

  return {
    state,
    sources: { files: f.side === 'not-an-instance' ? 'silent' : f.side, atproto: a.side, checked: a.checked ?? f.checked ?? null },
    drift: [...ourDrift(peer, relation, fed, ownRecords, f.side, where), ...theirs],
    reason,
  }
}

/** Our records whose subject is no peer of federation.yaml: published, but no longer listed (urgent drift, ours).
 *  A record names a public DID, so its subject is said.
 *  @param {{ peers: Peer[], ownRecords: OwnRecord[] | null | undefined }} input @returns {Drift[]} */
export function unlistedRecords({ peers, ownRecords }) {
  if (!Array.isArray(ownRecords)) return []
  const dids = new Set(peers.map(p => p.did).filter(Boolean))
  return ownRecords.filter(r => r?.value && !dids.has(r.value.subject))
    .map(r => ({ side: /** @type {const} */ ('ours'), text: DRIFT.unlisted, urgent: /** @type {const} */ (true), uri: r.uri, subject: r.value.subject }))
}
