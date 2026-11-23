// Bringing existing peers lists onto atproto (network N2 Task 12): the rows of the migration list, from federation.yaml
// and the caches, and the test of whether a DID is this peer's (the binding a DID needs before it is ever written).
// Pure: every reading is passed in.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { migrationRows, didBinding, MIGRATION_WHY, BINDING } from '../../lib/federation/migrate.mjs'
import { planLinks } from '../../lib/federation/links.mjs'
import { readFederation } from '../../lib/federation/read.mjs'

const HUB = 'did:plc:hubhubhubhubhubhubhubhub'
const SEAT = 'did:plc:seatseatseatseatseatseat'
const QUIET = 'did:plc:quietquietquietquietquie'
const GROVE = 'did:plc:grovegrovegrovegrovegrov'
const SELF = 'did:plc:selfselfselfselfselfself'

/** Five invented peers: a hub whose DID is only in its federation.json, a network seat, a private peer with a DID, a
 *  peer with no url, and a mutual sibling. */
const doc = (peers = [
  { name: 'Mesh Hub', url: 'https://mesh-hub.example.org', relationship: 'hub', decision: 'LD-2026-001' },
  { name: 'Seat Council', url: 'https://seat-council.example.org', relationship: 'network-seat', did: SEAT },
  { name: 'Quiet Sibling', url: 'https://quiet-sibling.example.org', visibility: 'private', did: QUIET, link: 'peerOf' },
  { name: 'Folder Friend', repo: '../folder-friend' },
  { name: 'Grove Sibling', url: 'https://grove-sibling.example.org', relationship: 'sibling', did: GROVE },
] as Record<string, unknown>[]) => ({
  identity: { name: 'Fixture Org', url: 'https://fixture-org.example.com', did: SELF },
  networks: [{ name: 'Mesh', hub: 'https://mesh-hub.example.org', role: 'node' }],
  peers,
})

/** What the confirmed checks left behind: Mesh Hub's federation.json names HUB; HUB's document names its own host as its
 *  handle, checked both ways; Grove's files list this instance. */
const theirDids: Record<string, string> = { 'https://mesh-hub.example.org': HUB }
const handles: Record<string, string | null> = { [HUB]: 'mesh-hub.example.org', [GROVE]: 'grove-sibling.example.org', [SEAT]: null }
const both: Record<string, string> = { 'mesh-hub.example.org': HUB, 'grove-sibling.example.org': GROVE }
const atproto = {
  readingOf: (did: string) => (did in handles ? { handle: handles[did] } : null),
  didOfHandle: (h: string) => both[h] ?? null,
}
const caches = (o: Record<string, unknown> = {}) => ({
  theirDid: (p: { url: string | null }) => (p.url ? theirDids[p.url] ?? null : null),
  atproto,
  byFiles: { mutualByFiles: [4], membersByFiles: [] },
  ...o,
})

describe('migrationRows', () => {
  it('one row per public peer; the private and url-less peers are only counted, and named nowhere', () => {
    const fed = readFederation(doc())
    const out = migrationRows(fed, caches())
    expect(out.kept).toEqual({ private: 1, noUrl: 1 })
    expect(out.rows.map(r => r.index)).toEqual([0, 1, 4])
    const shown = JSON.stringify(out)
    for (const hidden of ['Quiet', 'quiet', QUIET, 'Folder', 'folder']) expect(shown).not.toContain(hidden)
  })

  it('each row says where its DID and its relation come from, whether it is publishable, and why not', () => {
    const out = migrationRows(readFederation(doc()), caches())
    expect(out.rows).toEqual([
      { index: 0, name: 'Mesh Hub', did: HUB, didSource: 'their federation.json', didVerified: true,
        relation: 'memberOf', relationSource: 'derived', publishable: false, why: MIGRATION_WHY.noDid },
      { index: 1, name: 'Seat Council', did: SEAT, didSource: 'federation.yaml', didVerified: false,
        relation: null, relationSource: null, publishable: false, why: MIGRATION_WHY.noRelation },
      { index: 4, name: 'Grove Sibling', did: GROVE, didSource: 'federation.yaml', didVerified: true,
        relation: null, relationSource: null, publishable: false, why: MIGRATION_WHY.noRelation },
    ])
  })

  it('the three sentences, verbatim', () => {
    expect(MIGRATION_WHY.noDid).toBe('No DID yet.')
    expect(MIGRATION_WHY.noRelation).toBe("Choose how it's linked.")
    expect(MIGRATION_WHY.undecided).toBe("They don't list you yet. Set the link explicitly to publish anyway.")
  })

  it('the free-form relationship gives "Choose how it\'s linked."; setting link: peerOf makes the sibling publishable', () => {
    const before = migrationRows(readFederation(doc()), caches()).rows.find(r => r.index === 4)!
    expect(before.why).toBe("Choose how it's linked.")
    const peers = doc().peers
    peers[4] = { ...peers[4], link: 'peerOf' }
    const after = migrationRows(readFederation(doc(peers)), caches()).rows.find(r => r.index === 4)!
    expect(after).toMatchObject({ relation: 'peerOf', relationSource: 'link', publishable: true, why: null })
  })

  it('a derived relation nobody decided and their files don\'t confirm is "They don\'t list you yet…"', () => {
    const peers = doc().peers
    peers[0] = { name: 'Mesh Hub', url: 'https://mesh-hub.example.org', relationship: 'hub', did: HUB }
    const row = migrationRows(readFederation(doc(peers)), caches()).rows[0]
    expect(row).toMatchObject({ did: HUB, didSource: 'federation.yaml', relation: 'memberOf', relationSource: 'derived', publishable: false })
    expect(row.why).toBe("They don't list you yet. Set the link explicitly to publish anyway.")
    // mutual by their files, it is publishable without a decision (R4)
    const mutual = migrationRows(readFederation(doc(peers)), caches({ byFiles: { mutualByFiles: [0], membersByFiles: [] } })).rows[0]
    expect(mutual).toMatchObject({ publishable: true, why: null })
  })

  it('link: none keeps a peer off atproto and says so', () => {
    const peers = doc().peers
    peers[1] = { ...peers[1], link: 'none' }
    const row = migrationRows(readFederation(doc(peers)), caches()).rows[1]
    expect(row).toMatchObject({ relation: null, relationSource: 'link', publishable: false, why: MIGRATION_WHY.none })
  })

  it('publishable is exactly what the publish planner wants from the same files', () => {
    const peers = doc().peers
    peers[0] = { ...peers[0], did: HUB }
    peers[4] = { ...peers[4], link: 'peerOf' }
    const fed = readFederation(doc(peers))
    const c = caches()
    const rows = migrationRows(fed, c).rows
    const plan = planLinks({ fed: fed as never, selfDid: SELF, ownRecords: [], ownProfile: null, now: '2026-11-23T00:00:00.000Z', byFiles: c.byFiles })
    expect(plan.wanted.map(w => w.subject).sort()).toEqual(rows.filter(r => r.publishable).map(r => r.did).sort())
  })

  it('a DID from their federation.json never counts as written: it is a suggestion until it is in federation.yaml', () => {
    const row = migrationRows(readFederation(doc()), caches()).rows[0]
    expect(row.didSource).toBe('their federation.json')
    expect(row.publishable).toBe(false)
  })

  it('reads the nested and the pair shapes as N0 reads them', () => {
    const nested = { identity: { name: 'Fixture Org' }, federation: { network: 'Mesh', hub: 'https://mesh-hub.example.org', peers: [
      { name: 'Mesh Hub', url: 'https://mesh-hub.example.org', decision: 'LD-1', did: HUB },
    ] } }
    expect(migrationRows(readFederation(nested), caches()).rows).toEqual([expect.objectContaining({ index: 0, relation: 'memberOf', publishable: true })])
    const pair = { identity: { name: 'Fixture Org' }, network: 'Mesh', hub: 'https://mesh-hub.example.org', peers: [
      { name: 'Mesh Hub', url: 'https://mesh-hub.example.org', decision: 'LD-1' },
    ] }
    expect(migrationRows(readFederation(pair), caches()).rows).toEqual([expect.objectContaining({ index: 0, did: HUB, didSource: 'their federation.json', relation: 'memberOf' })])
  })

  it('with no caches at all, rows still come out, with no suggestion and nothing verified', () => {
    const out = migrationRows(readFederation(doc()), {})
    expect(out.rows[0]).toMatchObject({ did: null, didSource: null, didVerified: false, publishable: false, why: MIGRATION_WHY.noDid })
  })
})

describe('didBinding: a DID is written for a peer only when the cache ties it to that peer', () => {
  const peer = { name: 'Mesh Hub', url: 'https://mesh-hub.example.org' }
  it('its handle, checked both ways, is the peer\'s host', () => {
    expect(didBinding(peer, HUB, atproto)).toBeNull()
    expect(didBinding({ ...peer, url: 'https://www.mesh-hub.example.org/' }, HUB, atproto)).toBeNull()
  })
  it('never looked up: Look it up first.', () => {
    expect(didBinding(peer, 'did:plc:nevernevernevernevernever', atproto)).toBe(BINDING.lookFirst)
    expect(BINDING.lookFirst).toBe('Look it up first.')
  })
  it('a handle its document claims but that was not checked both ways is refused', () => {
    const view = { readingOf: () => ({ handle: 'mesh-hub.example.org' }), didOfHandle: () => null }
    expect(didBinding(peer, HUB, view)).toBe(BINDING.notBothWays('mesh-hub.example.org'))
    const other = { readingOf: () => ({ handle: 'mesh-hub.example.org' }), didOfHandle: () => GROVE }
    expect(didBinding(peer, HUB, other)).toBe(BINDING.notBothWays('mesh-hub.example.org'))
  })
  it('a DID whose verified handle is another host is someone else\'s', () => {
    expect(didBinding(peer, GROVE, atproto)).toBe(BINDING.otherHost('grove-sibling.example.org', 'mesh-hub.example.org'))
    // a subdomain is another host, either way round
    expect(didBinding({ ...peer, url: 'https://evil.mesh-hub.example.org' }, HUB, atproto)).not.toBeNull()
    expect(didBinding({ ...peer, url: 'https://example.org' }, HUB, atproto)).not.toBeNull()
  })
  it('a document naming no handle is refused, unless it is did:web on the peer\'s own host', () => {
    expect(didBinding({ name: 'Seat', url: 'https://seat-council.example.org' }, SEAT, atproto)).toBe(BINDING.noHandle)
    const web = 'did:web:seat-council.example.org'
    const view = { readingOf: (d: string) => (d === web ? { handle: null } : null), didOfHandle: () => null }
    expect(didBinding({ name: 'Seat', url: 'https://seat-council.example.org' }, web, view)).toBeNull()
    expect(didBinding({ name: 'Other', url: 'https://other.example.org' }, web, view)).toBe(BINDING.noHandle)
    // did:web with a path is not the host's own DID
    const pathed = 'did:web:seat-council.example.org:people:ana'
    expect(didBinding({ name: 'Seat', url: 'https://seat-council.example.org' }, pathed, { readingOf: () => ({ handle: null }), didOfHandle: () => null })).toBe(BINDING.noHandle)
  })
  it('a peer without a public url, or a value that is not a DID, binds nothing', () => {
    expect(didBinding({ name: 'X', url: null }, HUB, atproto)).not.toBeNull()
    expect(didBinding(peer, 'mesh-hub.example.org', atproto)).not.toBeNull()
  })
})

it('migrate.mjs imports nothing from node: or npm, because the app imports it', () => {
  const src = readFileSync(new URL('../../lib/federation/migrate.mjs', import.meta.url), 'utf8')
  const froms = [...src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
  for (const s of froms) expect(s).toMatch(/^\.\.?\//)
})
