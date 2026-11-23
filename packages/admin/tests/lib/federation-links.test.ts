// The link-record contract (network N2): the constants and the parsers every atproto read goes through (Task 3), and
// reciprocity, the relation of a peer, the record key and R24's wanted test (Task 4). Task 7 adds the planner.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { NETWORK_AUTHORITY, LINK_NSID, PROFILE_NSID, RELATIONS, parseLinkRecord, parseProfileRecord,
  reciprocal, relationOf, linkKey, networkOf, wantedLink } from '../../lib/federation/links.mjs'
import { readFederation } from '../../lib/federation/read.mjs'

const SUBJECT = 'did:plc:abcdefghijklmnopqrstuvwx'
const link = (o: Record<string, unknown> = {}) => ({ $type: LINK_NSID, subject: SUBJECT, relation: 'memberOf', createdAt: '2026-11-22T10:00:00.000Z', ...o })

describe('the constants', () => {
  it('one authority, two collections, three relations', () => {
    expect(NETWORK_AUTHORITY).toBe('example.orgosnetwork')
    expect(LINK_NSID).toBe('example.orgosnetwork.link')
    expect(PROFILE_NSID).toBe('example.orgosnetwork.profile')
    expect(RELATIONS).toEqual(['memberOf', 'hasMember', 'peerOf'])
    expect(Object.isFrozen(RELATIONS)).toBe(true)
  })
})

describe('parseLinkRecord', () => {
  it('keeps exactly the five fields, and ignores keys another client added', () => {
    expect(parseLinkRecord(link({ network: 'Regen Mesh', note: 'extra', subjectName: 'x' }))).toEqual(link({ network: 'Regen Mesh' }))
    expect(parseLinkRecord(link())).toEqual(link())
    expect(parseLinkRecord(link({ relation: 'peerOf', subject: 'did:web:peer.example.org' }))).toEqual(link({ relation: 'peerOf', subject: 'did:web:peer.example.org' }))
  })

  it('refuses a non-DID subject, an unknown relation, another type, a bad date or a bad network', () => {
    for (const bad of [
      link({ subject: 'alice.example.org' }), link({ subject: 'did:key:z6Mk' }), link({ subject: 42 }), link({ subject: undefined }),
      link({ relation: 'friendOf' }), link({ relation: 'none' }), link({ relation: undefined }),
      link({ $type: 'app.bsky.feed.post' }), link({ $type: undefined }),
      link({ createdAt: 'yesterday' }), link({ createdAt: '2026-11-22' }), link({ createdAt: '2026-13-40T99:00:00Z' }), link({ createdAt: undefined }),
      link({ network: 7 }), link({ network: '' }), link({ network: 'x'.repeat(201) }),
      null, 'record', [], 42,
    ]) {
      expect(parseLinkRecord(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(parseLinkRecord(link({ network: 'x'.repeat(200) }))).not.toBeNull()
  })
})

describe('parseProfileRecord', () => {
  const profile = (o: Record<string, unknown> = {}) => ({ $type: PROFILE_NSID, name: 'Mesa', createdAt: '2026-11-22T10:00:00.000Z', networks: [{ hub: SUBJECT, name: 'Regen Mesh' }], ...o })

  it('reads its networks and keeps every other key as it is', () => {
    expect(parseProfileRecord(profile({ displayName: 'X' }))).toEqual({
      networks: [{ hub: SUBJECT, name: 'Regen Mesh' }],
      rest: { name: 'Mesa', createdAt: '2026-11-22T10:00:00.000Z', displayName: 'X' },
    })
    expect(parseProfileRecord(profile({ networks: undefined }))).toEqual({ networks: [], rest: { name: 'Mesa', createdAt: '2026-11-22T10:00:00.000Z' } })
  })

  it('drops a network entry it cannot read, and refuses another type or a networks that is not a list', () => {
    expect(parseProfileRecord(profile({ networks: [{ hub: 'nope', name: 'A' }, { hub: SUBJECT }, { hub: SUBJECT, name: 'B', extra: 1 }, 'x'] }))?.networks)
      .toEqual([{ hub: SUBJECT, name: 'B' }])
    for (const bad of [profile({ $type: LINK_NSID }), profile({ networks: 'Regen Mesh' }), profile({ networks: {} }), null, [], 'x']) {
      expect(parseProfileRecord(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('reciprocal', () => {
  it('memberOf and hasMember answer each other, peerOf answers itself, anything else is null', () => {
    expect(reciprocal('memberOf')).toBe('hasMember')
    expect(reciprocal('hasMember')).toBe('memberOf')
    expect(reciprocal('peerOf')).toBe('peerOf')
    for (const r of RELATIONS) expect(reciprocal(reciprocal(r))).toBe(r)
    for (const bad of ['none', 'friendOf', null, undefined, '']) expect(reciprocal(bad as never)).toBeNull()
  })
})

// A federation.yaml as readFederation reads it, with invented names only.
const fedOf = (doc: Record<string, unknown>) => readFederation(doc)
const HUB_URL = 'https://github.com/regen-mesh/mesh-hub'

describe('relationOf', () => {
  it('an explicit link wins, and none gives null', () => {
    const fed = fedOf({ networks: [{ name: 'Regen Mesh', hub: HUB_URL }], peers: [
      { name: 'Mesh Hub', url: HUB_URL, link: 'peerOf' },
      { name: 'Mesh Hub again', url: HUB_URL, link: 'none' },
      { name: 'Plain', url: 'https://plain.example.org', link: 'hasMember' },
    ] })
    expect(fed.peers.map(p => relationOf(p, fed))).toEqual(['peerOf', null, 'hasMember'])
  })

  it("a network's hub is memberOf, by the same address however it is written", () => {
    const fed = fedOf({ networks: [{ name: 'Regen Mesh', hub: 'github.com/Regen-Mesh/mesh-hub' }, { name: 'Other', hub: 'https://other-hub.example.org/' }], peers: [
      { name: 'Mesh Hub', url: 'https://github.com/regen-mesh/mesh-hub.git' },
      { name: 'Mesh Hub by repo', repo: 'git@github.com:regen-mesh/mesh-hub.git' },
      { name: 'Other Hub', url: 'https://other-hub.example.org' },
      { name: 'Stranger', url: 'https://stranger.example.org' },
    ] })
    expect(fed.peers.map(p => relationOf(p, fed))).toEqual(['memberOf', 'memberOf', 'memberOf', null])
  })

  it('a path hub matches a path peer, resolved from the instance folder when one is given', () => {
    const fed = fedOf({ networks: [{ name: 'Local', hub: '../mesh-hub' }], peers: [{ name: 'Hub', repo: '../mesh-hub/' }, { name: 'Else', repo: '../else' }] })
    expect(fed.peers.map(p => relationOf(p, fed))).toEqual(['memberOf', null])
    const io = { resolve: (b: string, r: string) => resolve(b, r), isDir: () => false, readFederationAt: () => ({ found: false as const }) }
    expect(relationOf(fed.peers[0], fed, { base: '/w/me', io })).toBe('memberOf')
  })

  it("a node with a decision, on an instance with a join block, is hasMember; R3's ratified member reads the same way", () => {
    const join = { policy: 'open-with-approval' }
    const fed = fedOf({ join, peers: [
      { name: 'Decided', url: 'https://decided.example.org', relationship: 'node', decision: 'proposal 2026-11-20-a' },
      { name: 'Ratified', url: 'https://ratified.example.org', relationship: 'node', decision: 'request req-2026-11-21-x' },
      { name: 'Undecided', url: 'https://undecided.example.org', relationship: 'node' },
      { name: 'Asked', url: 'https://asked.example.org', relationship: 'node', requested: 'req-1' },
    ] })
    expect(fed.peers.map(p => relationOf(p, fed))).toEqual(['hasMember', 'hasMember', null, null])
    const noJoin = fedOf({ peers: [{ name: 'Decided', url: 'https://decided.example.org', relationship: 'node', decision: 'x' }] })
    expect(relationOf(noJoin.peers[0], noJoin)).toBeNull()
  })

  it("free-form relationship values are never mapped (relationship: 'network-seat' is null)", () => {
    const fed = fedOf({ join: { policy: 'open' }, peers: [
      { name: 'Seat', url: 'https://seat.example.org', relationship: 'network-seat', decision: 'x' },
      { name: 'Host', url: 'https://host.example.org', relationship: 'host-cooperative', decision: 'x' },
      { name: 'Hub word', url: 'https://hubword.example.org', relationship: 'hub', decision: 'x' },
      { name: 'Member word', url: 'https://memberword.example.org', relationship: 'memberOf', decision: 'x' },
    ] })
    expect(fed.peers.map(p => relationOf(p, fed))).toEqual([null, null, null, null])
  })
})

describe('linkKey', () => {
  const hex = (s: string) => createHash('sha256').update(s).digest('hex')
  it('is base32 (lowercase, no padding) of the first 10 bytes of the SHA-256 of subject|relation|network', () => {
    const k = linkKey(SUBJECT, 'memberOf', 'Regen Mesh')
    expect(k).toMatch(/^[a-z2-7]{16}$/)
    // RFC 4648 base32 of the first 10 bytes, by hand.
    const bytes = Buffer.from(hex(`${SUBJECT}|memberOf|Regen Mesh`).slice(0, 20), 'hex')
    let bits = ''
    for (const b of bytes) bits += b.toString(2).padStart(8, '0')
    const want = bits.match(/.{5}/g)!.map(c => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(c, 2)]).join('')
    expect(k).toBe(want)
  })

  it('is stable, differs per network, relation and subject, and takes the hash the server passes in', () => {
    expect(linkKey(SUBJECT, 'memberOf', 'Regen Mesh')).toBe(linkKey(SUBJECT, 'memberOf', 'Regen Mesh'))
    const keys = new Set([
      linkKey(SUBJECT, 'memberOf', 'Regen Mesh'), linkKey(SUBJECT, 'memberOf', 'Other Mesh'), linkKey(SUBJECT, 'memberOf', undefined),
      linkKey(SUBJECT, 'peerOf', 'Regen Mesh'), linkKey('did:web:peer.example.org', 'memberOf', 'Regen Mesh'),
    ])
    expect(keys.size).toBe(5)
    expect(linkKey(SUBJECT, 'peerOf', undefined)).toBe(linkKey(SUBJECT, 'peerOf', ''))
    expect(linkKey(SUBJECT, 'memberOf', 'Regen Mesh', hex)).toBe(linkKey(SUBJECT, 'memberOf', 'Regen Mesh'))
  })
})

describe('wantedLink (R24) and networkOf', () => {
  const PEER_DID = 'did:plc:peerpeerpeerpeerpeerpeer'
  const HUB_DID = 'did:plc:hubhubhubhubhubhubhubhub'

  it('the network: the hub network for memberOf, the one this instance is hub of for hasMember, none for peerOf or when ambiguous', () => {
    const node = fedOf({ networks: [{ name: 'Regen Mesh', hub: HUB_URL }, { name: 'Other', hub: 'https://other.example.org' }], peers: [{ name: 'Hub', url: HUB_URL, did: HUB_DID }] })
    expect(networkOf(node.peers[0], 'memberOf', node)).toBe('Regen Mesh')
    expect(networkOf(node.peers[0], 'peerOf', node)).toBeUndefined()
    expect(networkOf(node.peers[0], 'hasMember', node)).toBeUndefined() // two networks, none of them role: hub
    const hub = fedOf({ join: { policy: 'open' }, networks: [{ name: 'Regen Mesh', hub: 'https://self.example.org', role: 'hub' }, { name: 'Else', hub: 'https://else.example.org' }], peers: [] })
    expect(networkOf({ ...node.peers[0] }, 'hasMember', hub)).toBe('Regen Mesh')
    const only = fedOf({ networks: [{ name: 'Only One', hub: 'https://self.example.org' }], peers: [] })
    expect(networkOf(node.peers[0], 'hasMember', only)).toBe('Only One')
  })

  it('a public peer with a did and a decided relation is wanted; everything else is withheld by its reason', () => {
    const fed = fedOf({ join: { policy: 'open' }, networks: [{ name: 'Regen Mesh', hub: HUB_URL }], peers: [
      { name: 'Hub', url: HUB_URL, did: HUB_DID },                                                        // derived memberOf, undecided
      { name: 'Hub decided', url: HUB_URL, did: HUB_DID, decision: 'x' },                                 // derived, decided
      { name: 'Explicit', url: 'https://explicit.example.org', did: PEER_DID, link: 'peerOf' },           // explicit = decision
      { name: 'Private', url: 'https://private.example.org', did: PEER_DID, link: 'peerOf', visibility: 'private' },
      { name: 'No url', repo: '../local', did: PEER_DID, link: 'peerOf' },
      { name: 'Http', url: 'http://plain.example.org', did: PEER_DID, link: 'peerOf' },
      { name: 'No did', url: 'https://nodid.example.org', link: 'peerOf' },
      { name: 'No relation', url: 'https://norel.example.org', did: PEER_DID, relationship: 'network-seat' },
      { name: 'None', url: 'https://none.example.org', did: PEER_DID, link: 'none' },
    ] })
    const got = fed.peers.map(p => wantedLink(p, fed))
    expect(got).toEqual([
      { withheld: 'undecided' },
      { link: { subject: HUB_DID, relation: 'memberOf', network: 'Regen Mesh' } },
      { link: { subject: PEER_DID, relation: 'peerOf' } },
      { withheld: 'private' }, { withheld: 'noUrl' }, { withheld: 'noUrl' }, { withheld: 'noDid' },
      { withheld: 'noRelation' }, { withheld: 'noRelation' },
    ])
  })

  it('a derived relation mutual by files is wanted without a decision (R4: peer indexes passed in)', () => {
    const fed = fedOf({ networks: [{ name: 'Regen Mesh', hub: HUB_URL }], peers: [{ name: 'Other', url: 'https://o.example.org' }, { name: 'Hub', url: HUB_URL, did: HUB_DID }] })
    expect(wantedLink(fed.peers[1], fed)).toEqual({ withheld: 'undecided' })
    expect(wantedLink(fed.peers[1], fed, { mutualByFiles: [0] })).toEqual({ withheld: 'undecided' })
    expect(wantedLink(fed.peers[1], fed, { mutualByFiles: [1] })).toEqual({ link: { subject: HUB_DID, relation: 'memberOf', network: 'Regen Mesh' } })
    // A relation the caller already worked out (with the disk) is used as given.
    expect(wantedLink(fed.peers[0], fed, { relation: 'peerOf' })).toEqual({ withheld: 'noDid' })
  })
})

describe('purity', () => {
  it('links.mjs and state.mjs import nothing from node: or npm, because the app imports them', () => {
    for (const f of ['links.mjs', 'state.mjs']) {
      const src = readFileSync(new URL(`../../lib/federation/${f}`, import.meta.url), 'utf8')
      const froms = [...src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
      for (const s of froms) expect(s, `${f} imports ${s}`).toMatch(/^\.\.?\//)
    }
  })
})
