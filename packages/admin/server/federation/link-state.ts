// packages/admin/server/federation/link-state.ts
//
// Every peer's link state from every source (network N2 Task 4): the local folder (peers.mjs linkState), their
// federation.json as last read (the remote cache) and both sides' atproto records as last read (the atproto cache),
// combined by the pure lib/federation/state.mjs. Reads the disk and the caches under stateDir only: it never fetches
// and never writes. The fleet draws the cards from it; publishing (Task 7) and migration (Task 12) take
// `mutualByFiles` from it, the files reading R24 needs (ruling R4).
import { readFederation } from '../../lib/federation/read.mjs'
import { linkState, addressOf, sameAddress, isPublicUrl, selfAddresses, type Address } from '../../lib/federation/peers.mjs'
import { relationOf, isDid, type Relation } from '../../lib/federation/links.mjs'
import { combineLinkState, filesSide, unlistedRecords, type Drift, type Sources, type FilesReading, type RemoteReading } from '../../lib/federation/state.mjs'
import { nodePeerIO } from '../federation-io.ts'
import { remoteCache, wellKnownUrlOf } from './remote.ts'
import { atprotoCache } from './atproto/read.ts'
import type { Runner } from '../resources/types.ts'

type Fed = ReturnType<typeof readFederation>
type Peer = Fed['peers'][number]

/** Every way another instance could point at this one: its folder and each git remote (none when git fails). */
export async function selfAddressesOf(repo: string, run: Runner): Promise<Address[]> {
  let remotes: string[] = []
  try {
    const r = await run('git', ['remote', '-v'], { cwd: repo, timeoutMs: 5000 })
    if (r.code === 0) remotes = [...new Set(r.stdout.split('\n').map(l => l.split(/\s+/)[1]).filter(Boolean))]
  } catch { /* no remotes */ }
  return selfAddresses(repo, remotes, nodePeerIO)
}

/** Their files, as this machine can read them: the local folder, and (when no folder was looked at and the peer has a
 *  url) what their federation.json said when it was last read. A remote file's claims are read as public urls only:
 *  a `repo` or a relative path in it is never a folder here. */
export function filesReadingOf(repo: string, peer: Peer, self: Address[]): { files: FilesReading; remote: RemoteReading | null } {
  const files = linkState(peer, self, repo, nodePeerIO)
  if (files.state !== 'unknown' || files.path !== null || !peer.url) return { files, remote: null }
  const key = wellKnownUrlOf(peer.url)
  const cached = key ? remoteCache(repo).get(key) : null
  if (!cached) return { files, remote: null }
  const listsUs = readFederation(cached.doc).peers.some(p => {
    const a = isPublicUrl(p.url) ? addressOf(p.url as string, repo, nodePeerIO) : null
    return a !== null && self.some(s => sameAddress(s, a))
  })
  return { files, remote: { listsUs, fetchedAt: cached.fetched_at } }
}

/** The indexes of the peers whose files list this instance at the last reading (R24's "mutual by files", ruling R4). */
export function mutualByFiles(repo: string, fed: Fed, self: Address[]): number[] {
  return fed.peers.filter(p => {
    const { files, remote } = filesReadingOf(repo, p, self)
    return filesSide(files, remote).side === 'lists-us'
  }).map(p => p.index)
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
    const relation = relationOf(peer, fed, { base: repo, io: nodePeerIO })
    const { files, remote } = filesReadingOf(repo, peer, self)
    const atproto = peer.did ? cache.get(peer.did) : null
    const combined = combineLinkState({ peer, relation, selfDid, files, remote, atproto, ownRecords: own, fed })
    peers.set(peer.index, { relation, ...combined, path: files.path, failed: !!atproto && !atproto.reading && !!atproto.lastProblem })
  }
  return { selfDid, peers, unlisted: unlistedRecords({ peers: fed.peers, ownRecords: own }) }
}
