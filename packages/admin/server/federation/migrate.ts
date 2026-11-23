// Bringing existing peers lists onto atproto (network N2 Task 12, spec R28): the server's side of the migration list.
//
// - `migrationOf` reads federation.yaml on the trunk and the caches the confirmed `federation.check-links` left (their
//   federation.json, the atproto cache's readings and checked handles), and never fetches (R7, R16).
// - `resolveSets` checks what a POST asks to set: a peer from the list (a private peer can never be set here), a link
//   from LINK_RELATIONS, and a DID that the cache ties to that peer (`didBinding`). A handle is resolved only from the
//   cache of a confirmed check.
// - `migratedText` adds `did` and `link` where each peer already sits, comments and shape kept (top-level `peers`, or
//   the old `federation:` nesting; the `network`/`hub` pair is never touched).
// Nothing here writes git or the network: routes.ts stages the edit under the org's rules (`commitOrStage`).
import { isDeepStrictEqual } from 'node:util'
import { isMap, isSeq, parse, type YAMLMap, type YAMLSeq } from 'yaml'
import { HttpError } from '../errors.ts'
import { STRINGIFY, spliceUpdate } from '../splice.ts'
import { readFederation, LINK_RELATIONS, DID_PATTERN } from '../../lib/federation/read.mjs'
import { isDid } from '../../lib/federation/links.mjs'
import { didBinding, migrationRows, BINDING, type AtprotoView, type MigrationRow } from '../../lib/federation/migrate.mjs'
import { nodePeerIO } from '../federation-io.ts'
import type { Runner } from '../resources/types.ts'
import { remoteCache, wellKnownUrlOf } from './remote.ts'
import { atprotoCache, type Reading } from './atproto/read.ts'
import { normalHandle } from './atproto/resolve.ts'
import { byFiles, selfAddressesOf } from './link-state.ts'
import { readTrunkFederation, type TrunkFederation } from './trunk.ts'
import { federationDoc, normUrl } from './node.ts'

type Fed = TrunkFederation['fed']
type Peer = Fed['peers'][number]

export const MIGRATION_SENTENCES = {
  notPublic: 'Not a public peer.',
  noSet: 'Say which peers to set: set: [{ index, did?, link? }].',
  nothingGiven: 'Give a did or a link for each peer.',
  once: 'Name each peer once.',
  badLink: `link must be one of ${LINK_RELATIONS.join(', ')}.`,
  notDidOrHandle: (v: string) => `"${v.slice(0, 100)}" is not a DID or a handle.`,
  unchanged: 'Nothing to change: those peers already say so.',
  noPeers: "federation.yaml here has no peers list, so nothing was changed.",
  differs: (name: string) => `federation.yaml here no longer matches the trunk at "${name}", so nothing was changed. Apply or discard that change first.`,
}

/** The DID a peer's own federation.json carried at the last check, or null. A claim from their side only: it ties to
 *  nothing until `didBinding` says so. Never fetches. */
export function claimedDid(repo: string, url: string | null): string | null {
  const wk = url ? wellKnownUrlOf(url) : null
  const doc = wk === null ? null : remoteCache(repo).get(wk)?.doc
  return doc && typeof doc.did === 'string' && DID_PATTERN.test(doc.did) ? doc.did : null
}

/** The addresses a DID's own profiles name, as its last reading kept them: `example.orgosnetwork.profile` `instance` and
 *  `homepage`, and the Certified organization profile's `urls[].url`. */
export function profileNames(r: Reading): string[] {
  const rest = r.profile?.value.rest ?? {}
  const own = [rest.instance, rest.homepage].filter((v): v is string => typeof v === 'string')
  return [...own, ...(r.organization?.urls ?? [])]
}

/** The atproto cache, as `didBinding` reads it. */
export function bindingView(repo: string): AtprotoView {
  const cache = atprotoCache(repo)
  return {
    readingOf: did => { const r = cache.get(did)?.reading; return r ? { handle: r.handle, names: profileNames(r) } : null },
    didOfHandle: h => cache.didOfHandle(h)?.did ?? null,
  }
}

/** The DID a peer's federation.json names, when the atproto cache ties it to that peer's url (`didBinding`); else null.
 *  What the hub writes into an accepted member's entry (Task 9), so an asker can't have a DID it doesn't hold written. */
export function verifiedDid(repo: string, url: string): string | null {
  const did = claimedDid(repo, url)
  return did !== null && didBinding({ url }, did, bindingView(repo)) === null ? did : null
}

export interface Migration { rows: MigrationRow[]; kept: { private: number; noUrl: number }; fed: Fed }

/** The migration list from the trunk's federation.yaml and the caches; never fetches. */
export async function migrationOf(repo: string, run: Runner, startBranch?: string): Promise<Migration | { problem: string }> {
  const t = await readTrunkFederation(repo, startBranch)
  if ('problem' in t) return t
  const files = byFiles(repo, t.fed, await selfAddressesOf(repo, run))
  const { rows, kept } = migrationRows(t.fed, {
    theirDid: p => claimedDid(repo, p.url),
    atproto: bindingView(repo),
    byFiles: files,
    where: { base: repo, io: nodePeerIO },
  })
  return { rows, kept, fed: t.fed }
}

export interface PeerSet { index: number; did?: string; link?: string }

/** What a POST asks to set, checked against the list and the cache; each entry's DID resolved and tied to its peer.
 *  Every refusal is a 400 with its sentence. A private or url-less peer is refused exactly as an index out of range,
 *  so the answer never says one is there. */
export function resolveSets(raw: unknown, m: Migration, view: AtprotoView): { peer: Peer; did?: string; link?: string }[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) throw new HttpError(400, MIGRATION_SENTENCES.noSet)
  const listed = new Set(m.rows.map(r => r.index))
  const seen = new Set<number>()
  const out: { peer: Peer; did?: string; link?: string }[] = []
  for (const entry of raw) {
    const e = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {}
    const index = e.index
    if (typeof index !== 'number' || !Number.isInteger(index) || !listed.has(index)) throw new HttpError(400, MIGRATION_SENTENCES.notPublic)
    if (seen.has(index)) throw new HttpError(400, MIGRATION_SENTENCES.once)
    seen.add(index)
    const peer = m.fed.peers.find(p => p.index === index) as Peer
    if (e.did === undefined && e.link === undefined) throw new HttpError(400, MIGRATION_SENTENCES.nothingGiven)
    const set: { peer: Peer; did?: string; link?: string } = { peer }
    if (e.link !== undefined) {
      if (typeof e.link !== 'string' || !LINK_RELATIONS.includes(e.link)) throw new HttpError(400, MIGRATION_SENTENCES.badLink)
      set.link = e.link
    }
    if (e.did !== undefined) {
      const given = typeof e.did === 'string' ? e.did.trim() : ''
      let did: string
      if (isDid(given)) did = given
      else {
        const handle = normalHandle(given)
        if (handle === null) throw new HttpError(400, MIGRATION_SENTENCES.notDidOrHandle(String(e.did)))
        // A handle becomes a DID only from the cache of a confirmed check, which kept it after checking it both ways (R7).
        const known = view.didOfHandle(handle)
        if (known === null) throw new HttpError(400, BINDING.lookFirst)
        did = known
      }
      const why = didBinding(peer, did, view)
      if (why !== null) throw new HttpError(400, why)
      set.did = did
    }
    out.push(set)
  }
  return out
}

/** The peers list where readFederation reads it: top-level `peers`, else the old `federation.peers` (never moved up). */
function peersSeq(doc: ReturnType<typeof federationDoc>): YAMLSeq | null {
  const top = doc.get('peers')
  if (top !== undefined) return isSeq(top) ? top : null
  const nested = doc.get('federation')
  const inner = isMap(nested) ? nested.get('peers') : undefined
  return isSeq(inner) ? inner : null
}

/** The keys to set on one peer entry that differ from what it holds. */
function changesOf(map: YAMLMap, did?: string, link?: string): [string, string][] {
  const out: [string, string][] = []
  if (did !== undefined && map.get('did') !== did) out.push(['did', did])
  if (link !== undefined && map.get('link') !== link) out.push(['link', link])
  return out
}

/** federation.yaml with `did` and/or `link` set on the named peers, where they already sit. The peer at each index must
 *  still be the trunk's (same name and url), or nothing changes. Only the lines of the named entries change where their
 *  layout allows it (`spliceUpdate`, block-style entries); otherwise the document is written back by the YAML library,
 *  comments kept. Either way the result is parsed back and must equal the edit exactly. */
export function migratedText(text: string, sets: { peer: Peer; did?: string; link?: string }[]): { text: string; changed: number } {
  const doc = federationDoc(text)
  const here = readFederation(doc.toJS() ?? {})
  const seq = peersSeq(doc)
  if (seq === null) throw new HttpError(409, MIGRATION_SENTENCES.noPeers)
  let changed = 0
  for (const { peer, did, link } of sets) {
    const now = here.peers.find(p => p.index === peer.index)
    const item = seq.items[peer.index]
    if (!now || !isMap(item) || now.name !== peer.name || normUrl(now.url) !== normUrl(peer.url)) {
      throw new HttpError(409, MIGRATION_SENTENCES.differs(peer.name))
    }
    for (const [k, v] of changesOf(item as YAMLMap, did, link)) { (item as YAMLMap).set(k, v); changed += 1 }
  }
  if (changed === 0) return { text, changed }
  const whole = doc.toString(STRINGIFY)
  // The narrow edit: each named entry spliced in turn, the rest of the file byte for byte.
  let src: string | null = text
  for (const { peer, did, link } of sets) {
    if (src === null) break
    const d = federationDoc(src)
    const item = peersSeq(d)?.items[peer.index]
    if (!isMap(item)) { src = null; break }
    const todo = changesOf(item, did, link)
    if (todo.length === 0) continue
    src = spliceUpdate(src, item, () => { for (const [k, v] of todo) item.set(k, v); return new Set(todo.map(([k]) => k)) })
  }
  if (src !== null && isDeepStrictEqual(parse(src), parse(whole))) return { text: src, changed }
  return { text: whole, changed }
}
