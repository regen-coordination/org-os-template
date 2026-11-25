// packages/admin/server/federation/link-state.ts
//
// Every peer's link state from every source (network N2 Task 4): the local folder (peers.mjs linkState), their
// federation.json as last read (the remote cache) and both sides' atproto records as last read (the atproto cache),
// combined by the pure lib/federation/state.mjs. Reads the disk and the caches under stateDir only: it never fetches
// and never writes. The fleet draws the cards from it; publishing (Task 7) and migration (Task 12) take `byFiles`
// from it (`mutualByFiles`, `membersByFiles`), the files readings R24 needs (ruling R4).
import { readFederation } from '../../lib/federation/read.mjs'
import { linkState, addressOf, sameAddress, isPublicUrl, publicHref, selfAddresses, type Address } from '../../lib/federation/peers.mjs'
import { relationOf, isDid, type Relation } from '../../lib/federation/links.mjs'
import { combineLinkState, filesSide, unlistedRecords, type Drift, type Sources, type FilesReading, type RemoteReading } from '../../lib/federation/state.mjs'
import { nodePeerIO } from '../federation-io.ts'
import { remoteCache, wellKnownUrlOf } from './remote.ts'
import { atprotoCache } from './atproto/read.ts'
import type { Runner } from '../resources/types.ts'

type Fed = ReturnType<typeof readFederation>
type Peer = Fed['peers'][number]

/** Every way another instance could point at this one: its folder and its `origin` remote (none when git fails).
 *  Only `origin` is this instance: an `upstream` (the framework template every instance carries) or any other remote
 *  is someone else's repository, and a peer that lists or names it must never read as listing this one. */
export async function selfAddressesOf(repo: string, run: Runner): Promise<Address[]> {
  let remotes: string[] = []
  try {
    const r = await run('git', ['remote', '-v'], { cwd: repo, timeoutMs: 5000 })
    if (r.code === 0) {
      remotes = [...new Set(r.stdout.split('\n').map(l => l.trim().split(/\s+/)).filter(([name, url]) => name === 'origin' && url).map(([, url]) => url))]
    }
  } catch { /* no remotes */ }
  return selfAddresses(repo, remotes, nodePeerIO)
}

/** Their files, as this machine can read them: the local folder, and (when no folder was looked at and the peer has a
 *  url) what their federation.json said when it was last read. A remote file's claims are read as public urls only:
 *  a `repo` or a relative path in it is never a folder here. `namesUsAsHub`: the same files name this instance as the
 *  hub of one of their `networks`. */
export function filesReadingOf(repo: string, peer: Peer, self: Address[]): { files: FilesReading; remote: RemoteReading | null; namesUsAsHub: boolean } {
  const isUs = (a: Address | null) => a !== null && self.some(s => sameAddress(s, a))
  const files = linkState(peer, self, repo, nodePeerIO)
  if (files.path !== null && (files.state === 'mutual' || files.state === 'claimed')) {
    const theirs = nodePeerIO.readFederationAt(files.path)
    const doc = theirs.found && 'doc' in theirs ? theirs.doc : null
    const folder = files.path
    const namesUsAsHub = readFederation(doc).networks.some(n => n.hub !== null && isUs(addressOf(n.hub, folder, nodePeerIO)))
    return { files, remote: null, namesUsAsHub }
  }
  if (files.state !== 'unknown' || files.path !== null || !peer.url) return { files, remote: null, namesUsAsHub: false }
  const key = wellKnownUrlOf(peer.url)
  const cached = key ? remoteCache(repo).get(key) : null
  if (!cached) return { files, remote: null, namesUsAsHub: false }
  const doc = readFederation(cached.doc)
  const listsUs = doc.peers.some(p => isUs(isPublicUrl(p.url) ? addressOf(p.url as string, repo, nodePeerIO) : null))
  const namesUsAsHub = doc.networks.some(n => {
    const href = publicHref(n.hub)
    return isUs(href ? addressOf(href, repo, nodePeerIO) : null)
  })
  return { files, remote: { listsUs, fetchedAt: cached.fetched_at }, namesUsAsHub }
}

/** What both sides' files say, as peer indexes (ruling R4): `mutualByFiles`, their files list this instance;
 *  `membersByFiles`, their files name this instance as the hub of one of their networks. Pass both to `relationOf`
 *  and `wantedLink`, so an existing member mutual by files is `hasMember` and published without a decision.
 *  `unreadByFiles`: their files could not be read here (side unknown), so the publish planner keeps a record R24 would
 *  allow if they still listed this instance (Task 4's `tolerated`, Task 7). */
export function byFiles(repo: string, fed: Fed, self: Address[]): { mutualByFiles: number[]; membersByFiles: number[]; unreadByFiles: number[] } {
  const mutual: number[] = []
  const members: number[] = []
  const unread: number[] = []
  for (const p of fed.peers) {
    const { files, remote, namesUsAsHub } = filesReadingOf(repo, p, self)
    const side = filesSide(files, remote).side
    if (side === 'lists-us') mutual.push(p.index)
    if (side === 'unknown') unread.push(p.index)
    if (namesUsAsHub) members.push(p.index)
  }
  return { mutualByFiles: mutual, membersByFiles: members, unreadByFiles: unread }
}

/** The indexes of the peers whose files list this instance at the last reading (R24's "mutual by files", ruling R4). */
export function mutualByFiles(repo: string, fed: Fed, self: Address[]): number[] {
  return byFiles(repo, fed, self).mutualByFiles
}

export interface PeerLinkState {
  relation: Relation | null
  state: string
  sources: Sources
  drift: Drift[]
  reason: string | null
  /** The local folder looked at, if any (its findings are the reason when the state is unknown). */
  path: string | null
  /** Their atproto read failed with no earlier success. */
  failed: boolean
}

/** Every peer's combined link state (by peer index), this instance's DID, and our records no peer accounts for. */
export function linkStatesOf(repo: string, fed: Fed, self: Address[]): { selfDid: string | null; peers: Map<number, PeerLinkState>; unlisted: Drift[] } {
  const did = fed.identity.did
  const selfDid = isDid(did) ? did : null
  const cache = atprotoCache(repo)
  const own = selfDid ? cache.get(selfDid)?.reading?.links ?? null : null
  const peers = new Map<number, PeerLinkState>()
  for (const peer of fed.peers) {
    const { files, remote, namesUsAsHub } = filesReadingOf(repo, peer, self)
    const mine = [peer.index]
    const where = { base: repo, io: nodePeerIO }
    const relation = relationOf(peer, fed, { ...where,
      mutualByFiles: filesSide(files, remote).side === 'lists-us' ? mine : [], membersByFiles: namesUsAsHub ? mine : [] })
    const atproto = peer.did ? cache.get(peer.did) : null
    const combined = combineLinkState({ peer, relation, selfDid, files, remote, atproto, ownRecords: own, fed, where })
    peers.set(peer.index, { relation, ...combined, path: files.path, failed: !!atproto && !atproto.reading && !!atproto.lastProblem })
  }
  return { selfDid, peers, unlisted: unlistedRecords({ peers: fed.peers, ownRecords: own }) }
}
