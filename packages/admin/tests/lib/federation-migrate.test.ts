// Bringing existing peers lists onto atproto (network N2 Task 12): the rows of the migration list, from federation.yaml
// and the caches, and the test of whether a DID is this peer's (the binding a DID needs before it is ever written).
// Pure: every reading is passed in.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { migrationRows, didBinding, namesPeer, isSharedHost, MIGRATION_WHY, BINDING, SHARED_HOSTS, PROFILE_TTL_MS } from '../../lib/federation/migrate.mjs'
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

describe('didBinding: both sides name each other, the peer\'s federation.json and the DID\'s own profile', () => {
  const REPO = 'https://github.com/fixture-coop/fixture-os'
  const CERT = 'did:plc:certcertcertcertcertcert'
  const NOW = new Date('2026-11-23T12:00:00.000Z')
  const READ = '2026-11-23T11:00:00.000Z'
  /** The DID's profile names `names` (read at `at`); the peer url's federation.json names `theirs`. */
  const view = (names: string[], o: { theirs?: string | null; at?: string | null; handle?: string } = {}) => {
    const handle = o.handle ?? 'fixture-coop.certified.one'
    const at = o.at === undefined ? READ : o.at
    return {
      readingOf: (d: string) => (d === CERT ? { handle, names: names.map(url => ({ url, at })) } : null),
      didOfHandle: (h: string) => (h === handle ? CERT : null),
      theirDid: () => (o.theirs === undefined ? CERT : o.theirs),
      now: NOW,
    }
  }
  const peer = { name: 'Fixture OS', url: REPO }

  it('the real member case: their federation.json names the DID and its Certified profile lists the exact repo url', () => {
    expect(didBinding(peer, CERT, view([REPO]))).toBeNull()
    expect(didBinding(peer, CERT, view(['https://GitHub.com/fixture-coop/fixture-os/']))).toBeNull()
  })
  it('the attack: the DID\'s profile lists the url, but their federation.json names another DID, or none', () => {
    expect(didBinding(peer, CERT, view([REPO], { theirs: 'did:plc:otherotherotherotherothe' }))).toBe(BINDING.otherHost('fixture-coop.certified.one', 'github.com'))
    expect(didBinding(peer, CERT, view([REPO], { theirs: null }))).not.toBeNull()
    const acme = { name: 'Acme', url: 'https://acme.example.org' }
    expect(didBinding(acme, CERT, view(['https://acme.example.org'], { theirs: null }))).not.toBeNull()
  })
  it('their federation.json naming the DID is not enough without the profile naming them back', () => {
    expect(didBinding(peer, CERT, view([]))).not.toBeNull()
    expect(didBinding(peer, CERT, view(['https://github.com/other/repo']))).toBe(BINDING.otherHost('fixture-coop.certified.one', 'github.com'))
  })
  it('a profile naming a different host is not; another page on the peer\'s own unshared host is, with both sides agreeing', () => {
    const acme = { name: 'Acme', url: 'https://acme.example.org' }
    expect(didBinding(acme, CERT, view(['https://other.example.org']))).not.toBeNull()
    expect(didBinding(acme, CERT, view(['https://www.acme.example.org/about']))).toBeNull()
  })
  it('subdomains of shared hosts are shared: gist.github.com matches only its exact url', () => {
    const gist = { name: 'Gist', url: 'https://gist.github.com/fixture-coop/abc123' }
    expect(didBinding(gist, CERT, view(['https://gist.github.com/fixture-coop/abc123']))).toBeNull()
    expect(didBinding(gist, CERT, view(['https://gist.github.com/someone/else']))).not.toBeNull()
    expect(isSharedHost('gist.github.com')).toBe(true)
    for (const h of ['bitbucket.org', 'gitea.com', 'git.sr.ht', 'sites.google.com', 'opencollective.com', 'huggingface.co', 'acme.github.io']) expect(isSharedHost(h), h).toBe(true)
    expect(isSharedHost('acme.example.org')).toBe(false)
    expect(isSharedHost('notgithub.com')).toBe(false)
  })
  it('a profile read more than a day ago no longer ties it: Look it up again.', () => {
    expect(BINDING.lookAgain).toContain('Look it up again.')
    expect(PROFILE_TTL_MS).toBe(24 * 3600_000)
    expect(didBinding(peer, CERT, view([REPO], { at: '2026-11-22T11:59:00.000Z' }))).toBe(BINDING.lookAgain)
    expect(didBinding(peer, CERT, view([REPO], { at: null }))).toBe(BINDING.lookAgain)
    expect(didBinding(peer, CERT, view([REPO], { at: '2026-11-22T12:01:00.000Z' }))).toBeNull()
  })
  it('a DID never read is Look it up first., however both files name it', () => {
    expect(didBinding(peer, 'did:plc:nevernevernevernevernever', view([REPO]))).toBe(BINDING.lookFirst)
  })
  it('migrationRows passes each row its own federation.json DID, so a DID in federation.yaml is checked the same way', () => {
    const fed = readFederation({ peers: [{ name: 'Fixture OS', url: REPO, did: CERT }] })
    const v = view([REPO])
    const yes = migrationRows(fed, { atproto: v, theirDid: () => CERT }).rows[0]
    expect(yes).toMatchObject({ did: CERT, didSource: 'federation.yaml', didVerified: true })
    const no = migrationRows(fed, { atproto: v, theirDid: () => null }).rows[0]
    expect(no.didVerified).toBe(false)
  })
  it('namesPeer: shared hosts match only the exact url', () => {
    for (const host of SHARED_HOSTS) {
      expect(namesPeer(`https://${host}/a/b`, `https://${host}/a/b`)).toBe(true)
      expect(namesPeer(`https://${host}/a/c`, `https://${host}/a/b`)).toBe(false)
      expect(namesPeer(`https://www.${host}/x`, `https://${host}/a/b`)).toBe(false)
    }
    expect(namesPeer('http://acme.example.org', 'https://acme.example.org')).toBe(false)
    expect(namesPeer(42, 'https://acme.example.org')).toBe(false)
    expect(namesPeer('', 'https://acme.example.org')).toBe(false)
  })
})

it('migrate.mjs imports nothing from node: or npm, because the app imports it', () => {
  const src = readFileSync(new URL('../../lib/federation/migrate.mjs', import.meta.url), 'utf8')
  const froms = [...src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
  for (const s of froms) expect(s).toMatch(/^\.\.?\//)
})
