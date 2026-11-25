// One link state from every source (network N2 Task 4, spec §15 R22–R24): federation.yaml governs our side, their
// records their side once they are on atproto, their files otherwise; a disagreement is drift, never a write; a failed
// read is unknown, never left. Invented names and DIDs only.
import { describe, it, expect } from 'vitest'
import { combineLinkState, filesSide, unlistedRecords, linkVerdict, DRIFT, LINK_STATES } from '../../lib/federation/state.mjs'
import { LINK_NSID, PROFILE_NSID, relationOf } from '../../lib/federation/links.mjs'
import { readFederation } from '../../lib/federation/read.mjs'

const SELF = 'did:plc:selfselfselfselfselfself'
const HUB = 'did:plc:hubhubhubhubhubhubhubhub'
const OTHER = 'did:plc:otherotherotherotherothe'
const HUB_URL = 'https://mesh-hub.example.org'
const T0 = '2026-11-20T10:00:00.000Z'
const T1 = '2026-11-22T09:00:00.000Z'

/** Our federation.yaml: a node of Regen Mesh, the hub listed as a peer with the given extra fields. */
const fedWith = (hub: Record<string, unknown> = {}, more: Record<string, unknown>[] = []) => readFederation({
  identity: { name: 'Mesa', did: SELF },
  networks: [{ name: 'Regen Mesh', hub: HUB_URL }],
  peers: [{ name: 'Mesh Hub', url: HUB_URL, did: HUB, ...hub }, ...more],
})

type Relation = 'memberOf' | 'hasMember' | 'peerOf'
type Rec = { uri: string; cid: string; value: { $type: string; subject: string; relation: Relation; network?: string; createdAt: string } }
let n = 0
const rec = (owner: string, subject: string, relation: Relation, network?: string): Rec => ({
  uri: `at://${owner}/${LINK_NSID}/k${++n}`, cid: `bafy${n}`,
  value: { $type: LINK_NSID, subject, relation, ...(network ? { network } : {}), createdAt: T0 },
})
const profile = () => ({ uri: `at://${HUB}/${PROFILE_NSID}/self`, cid: 'bafyprofile', value: { networks: [{ hub: HUB, name: 'Regen Mesh' }], rest: {} } })

/** Their atproto reading, as the cache keeps it. */
const reading = (o: { profile?: boolean; links?: Rec[]; at?: string } = {}) => ({
  did: HUB, pds: 'https://pds-b.example.net', handle: null, profile: o.profile === false ? null : profile(),
  links: o.links ?? [], skipped: 0, fetchedAt: o.at ?? T1,
})
const entry = (r: ReturnType<typeof reading> | null, problem: { at: string; text: string } | null = null) => ({ did: HUB, reading: r, lastProblem: problem })

const FILES = {
  lists: { state: 'mutual', path: '/w/mesh-hub', reason: null },
  silent: { state: 'claimed', path: '/w/mesh-hub', reason: null },
  unknown: { state: 'unknown', path: null, reason: "can't read their side from here" },
  notInstance: { state: 'not-an-instance', path: '/w/mesh-hub', reason: null },
}
const ours = (relation: Relation = 'memberOf', network: string | undefined = 'Regen Mesh') => [rec(SELF, HUB, relation, network)]
const theirs = (relation: Relation = 'hasMember') => rec(HUB, SELF, relation, 'Regen Mesh')

/** Combine for the hub peer of `fed`, relation memberOf unless given. */
const combine = (fed: ReturnType<typeof fedWith>, o: Record<string, unknown>) => combineLinkState({
  peer: fed.peers[0], relation: 'memberOf', selfDid: SELF, files: FILES.unknown, remote: null, atproto: null, ownRecords: null, fed, ...o,
} as never)

describe('precedence, case by case', () => {
  it('lists, decision | profile + reciprocal record | their files list us → mutual, no drift', () => {
    const fed = fedWith({ decision: 'proposal 2026-11-01-a' })
    const got = combine(fed, { files: FILES.lists, atproto: entry(reading({ links: [theirs()] })), ownRecords: ours() })
    expect(got).toEqual({ state: 'mutual', sources: { files: 'lists-us', atproto: 'lists-us', checked: T1 }, drift: [], reason: `checked ${T1}` })
  })

  it("lists, decision | profile, no record | their files list us → left, with their side's drift", () => {
    const fed = fedWith({ decision: 'proposal 2026-11-01-a' })
    const got = combine(fed, { files: FILES.lists, atproto: entry(reading()), ownRecords: ours() })
    expect(got.state).toBe('left')
    expect(got.sources).toEqual({ files: 'lists-us', atproto: 'silent', checked: T1 })
    expect(got.drift).toEqual([{ side: 'theirs', text: "Their files list you; their record isn't published." }])
  })

  it('lists, requested | profile, no record | their files are silent → requested', () => {
    const fed = fedWith({ requested: 'req-2026-11-21-a' })
    const got = combine(fed, { files: FILES.silent, atproto: entry(reading()) })
    expect(got.state).toBe('requested')
    expect(got.drift).toEqual([])
  })

  it('lists | no profile | their files list us → mutual (files decide)', () => {
    const got = combine(fedWith(), { files: FILES.lists, atproto: entry(reading({ profile: false })) })
    expect(got.state).toBe('mutual')
    expect(got.sources).toEqual({ files: 'lists-us', atproto: 'not-on-atproto', checked: T1 })
    expect(got.drift).toEqual([])
  })

  it('lists | no profile | their files are silent → claimed', () => {
    const got = combine(fedWith(), { files: FILES.silent, atproto: entry(reading({ profile: false })) })
    expect(got.state).toBe('claimed')
    expect(got.sources.files).toBe('silent')
  })

  it('lists | profile + a record with the wrong relation (peerOf against our memberOf) | their files list us → claimed, drift theirs', () => {
    const got = combine(fedWith(), { files: FILES.lists, atproto: entry(reading({ links: [theirs('peerOf')] })) })
    expect(got.state).toBe('claimed')
    expect(got.sources.atproto).toBe('silent')
    expect(got.drift).toEqual([{ side: 'theirs', text: "Their files list you; their record isn't published." }])
  })

  it('lists, private | any | any → state computed, no record expected, never "Not published yet."', () => {
    const fed = fedWith({ visibility: 'private', link: 'memberOf', decision: 'x' })
    for (const [files, at] of [[FILES.lists, entry(reading({ links: [theirs()] }))], [FILES.silent, entry(reading())], [FILES.unknown, null]] as const) {
      const got = combine(fed, { files, atproto: at, ownRecords: [] })
      expect(LINK_STATES).toContain(got.state)
      expect(got.drift.map((d: { text: string }) => d.text)).not.toContain(DRIFT.notPublished)
      expect(got.drift.filter((d: { side: string }) => d.side === 'ours')).toEqual([])
    }
    expect(combine(fed, { files: FILES.lists, atproto: entry(reading({ links: [theirs()] })), ownRecords: [] }).state).toBe('mutual')
    // A record it got while it was public is the urgent case: published, but federation.yaml keeps it private.
    const old = ours()
    expect(combine(fed, { files: FILES.lists, atproto: entry(reading({ links: [theirs()] })), ownRecords: old }).drift)
      .toEqual([{ side: 'ours', text: 'Published, but federation.yaml lists it as private.', urgent: true, uri: old[0].uri }])
  })

  it('not listed, our record exists | any | any → drift ours "Published, but federation.yaml no longer lists it."', () => {
    const fed = fedWith()
    const stray = rec(SELF, OTHER, 'peerOf')
    expect(unlistedRecords({ peers: fed.peers, ownRecords: [...ours(), stray] }))
      .toEqual([{ side: 'ours', text: 'Published, but federation.yaml no longer lists it.', urgent: true, uri: stray.uri, subject: OTHER }])
    expect(unlistedRecords({ peers: fed.peers, ownRecords: ours() })).toEqual([])
    expect(unlistedRecords({ peers: fed.peers, ownRecords: null })).toEqual([])
  })

  it('lists, decision | read failed, no earlier success | their files unknown → unknown', () => {
    const got = combine(fedWith({ decision: 'x' }), { files: FILES.unknown, atproto: entry(null, { at: T1, text: 'their PDS did not answer' }) })
    expect(got.state).toBe('unknown')
    expect(got.sources).toEqual({ files: 'unknown', atproto: 'unknown', checked: null })
    expect(got.reason).toBe(`couldn't check their records (${T1})`)
  })

  it('lists, decision | read failed, earlier success with the record | their files list us → mutual, checked <date>', () => {
    const got = combine(fedWith({ decision: 'x' }), {
      files: FILES.lists, atproto: entry(reading({ links: [theirs()], at: T0 }), { at: T1, text: 'their PDS did not answer' }), ownRecords: ours(),
    })
    expect(got).toEqual({ state: 'mutual', sources: { files: 'lists-us', atproto: 'lists-us', checked: T0 }, drift: [], reason: `checked ${T0}` })
  })
})

describe('a failed read is unknown, never left', () => {
  const failed = entry(null, { at: T1, text: 'their PDS resolves to a private address' })
  it('with a decision, whatever their files say, a failed read with no earlier success leaves the link unknown', () => {
    for (const hub of [{ decision: 'x' }, { requested: 'req-1' }, {}]) {
      for (const files of Object.values(FILES)) {
        for (const remote of [null, { listsUs: false, fetchedAt: T0 }, { listsUs: true, fetchedAt: T0 }]) {
          const got = combine(fedWith(hub), { files, remote, atproto: failed })
          expect(got.state, JSON.stringify({ hub, files, remote })).toBe('unknown')
          expect(got.sources.atproto).toBe('unknown')
        }
      }
    }
  })

  it('a failure after a good reading keeps that reading, with its date, and never moves the link', () => {
    const before = combine(fedWith({ decision: 'x' }), { files: FILES.silent, atproto: entry(reading({ links: [theirs()], at: T0 })) })
    const after = combine(fedWith({ decision: 'x' }), { files: FILES.silent, atproto: entry(reading({ links: [theirs()], at: T0 }), { at: T1, text: 'down' }) })
    expect(before.state).toBe('mutual')
    expect(after.state).toBe('mutual')
    expect(after.sources.checked).toBe(T0)
  })
})

describe('their side', () => {
  it("their record published while their files don't list us is drift the other way, and the record decides", () => {
    const got = combine(fedWith(), { files: FILES.silent, atproto: entry(reading({ links: [theirs()] })) })
    expect(got.state).toBe('mutual')
    expect(got.drift).toEqual([{ side: 'theirs', text: "Their record is published; their files don't list you." }])
  })

  it('their files, when unreadable, give no cross-check drift', () => {
    expect(combine(fedWith(), { files: FILES.unknown, atproto: entry(reading()) }).drift).toEqual([])
  })

  it('a record about someone else, or a reciprocal record for another DID, does not list us', () => {
    const got = combine(fedWith(), { files: FILES.silent, atproto: entry(reading({ links: [rec(HUB, OTHER, 'hasMember'), rec(HUB, SELF, 'memberOf')] })) })
    expect(got.state).toBe('claimed')
    expect(got.sources.atproto).toBe('silent')
  })

  it('hasMember on our side matches their memberOf, and peerOf matches peerOf', () => {
    const fed = fedWith()
    expect(combine(fed, { relation: 'hasMember', files: FILES.silent, atproto: entry(reading({ links: [theirs('memberOf')] })) }).state).toBe('mutual')
    expect(combine(fed, { relation: 'peerOf', files: FILES.silent, atproto: entry(reading({ links: [theirs('peerOf')] })) }).state).toBe('mutual')
  })

  it("a cache entry for another DID is never read as theirs", () => {
    const wrong = { did: OTHER, reading: { ...reading({ links: [theirs()] }), did: OTHER }, lastProblem: null }
    const got = combine(fedWith(), { files: FILES.silent, atproto: wrong })
    expect(got.state).toBe('claimed')
    expect(got.sources.atproto).toBe('unknown')
  })

  it('selfDid null means their files decide, never a false left (R13)', () => {
    const got = combine(fedWith({ decision: 'x' }), { selfDid: null, files: FILES.lists, atproto: entry(reading()) })
    expect(got.state).toBe('mutual')
    expect(got.drift).toEqual([])
    expect(combine(fedWith({ decision: 'x' }), { selfDid: null, files: FILES.unknown, atproto: entry(null, { at: T1, text: 'x' }) }).state).toBe('unknown')
  })

  it('no relation on our side means no public link: their files decide', () => {
    const got = combine(fedWith({ decision: 'x' }), { relation: null, files: FILES.lists, atproto: entry(reading()) })
    expect(got.state).toBe('mutual')
    expect(got.drift).toEqual([])
  })

  it('a peer without a did is not on atproto; a did never read is unknown there, and the files decide', () => {
    const noDid = readFederation({ networks: [{ name: 'Regen Mesh', hub: HUB_URL }], peers: [{ name: 'Mesh Hub', url: HUB_URL, decision: 'x' }] })
    const a = combine(noDid, { files: FILES.silent })
    expect(a.state).toBe('left')
    expect(a.sources).toEqual({ files: 'silent', atproto: 'not-on-atproto', checked: null })
    const b = combine(fedWith(), { files: FILES.lists, atproto: null })
    expect(b.state).toBe('mutual')
    expect(b.sources).toEqual({ files: 'lists-us', atproto: 'unknown', checked: null })
  })

  it("not-an-instance and unknown come from the files only when the atproto reading doesn't settle it", () => {
    expect(combine(fedWith(), { files: FILES.notInstance, atproto: entry(reading({ profile: false })) }).state).toBe('not-an-instance')
    expect(combine(fedWith(), { files: FILES.notInstance, atproto: entry(reading({ links: [theirs()] })) }).state).toBe('mutual')
    expect(combine(fedWith(), { files: FILES.unknown, atproto: entry(reading({ profile: false })) }).state).toBe('unknown')
    expect(combine(fedWith(), { files: FILES.unknown, atproto: entry(reading({ links: [theirs()] })) }).state).toBe('mutual')
    expect(combine(fedWith({ decision: 'x' }), { files: FILES.unknown, atproto: entry(reading()) }).state).toBe('left')
  })

  it('with no local folder, the remote cache is their files, and its date is the check', () => {
    const got = combine(fedWith(), { files: FILES.unknown, remote: { listsUs: true, fetchedAt: T0 } })
    expect(got).toMatchObject({ state: 'mutual', sources: { files: 'lists-us', atproto: 'unknown', checked: T0 }, reason: `checked ${T0}` })
    expect(combine(fedWith(), { files: FILES.unknown, remote: { listsUs: false, fetchedAt: T0 } }).state).toBe('claimed')
    // A local folder that was read wins over the remote cache.
    expect(combine(fedWith(), { files: FILES.silent, remote: { listsUs: true, fetchedAt: T0 } }).state).toBe('claimed')
  })
})

describe('our side: federation.yaml decides, our records only make drift', () => {
  it('"Not published yet." when R24 wants the link and our record is missing; nothing when ours was never read', () => {
    const fed = fedWith({ decision: 'x' })
    expect(combine(fed, { files: FILES.lists, ownRecords: [] }).drift).toEqual([{ side: 'ours', text: 'Not published yet.' }])
    expect(combine(fed, { files: FILES.lists, ownRecords: null }).drift).toEqual([])
    expect(combine(fed, { files: FILES.lists, ownRecords: ours() }).drift).toEqual([])
  })

  it('a derived relation is wanted when decided or mutual by files, and not otherwise', () => {
    expect(combine(fedWith(), { files: FILES.lists, ownRecords: [] }).drift).toEqual([{ side: 'ours', text: 'Not published yet.' }])
    expect(combine(fedWith(), { files: FILES.silent, ownRecords: [] }).drift).toEqual([])
  })

  it('a record that no longer matches federation.yaml (another relation or network) is urgent drift; the wanted one is still missing', () => {
    const fed = fedWith({ link: 'peerOf' })
    const old = ours('memberOf')
    // The urgent line comes first.
    expect(combine(fed, { relation: 'peerOf', files: FILES.lists, ownRecords: old }).drift).toEqual([
      { side: 'ours', text: 'Published, but federation.yaml no longer lists it.', urgent: true, uri: old[0].uri },
      { side: 'ours', text: 'Not published yet.' },
    ])
    const wrongNet = ours('memberOf', 'Another Mesh')
    expect(combine(fedWith({ decision: 'x' }), { files: FILES.lists, ownRecords: wrongNet }).drift.map((d: { text: string }) => d.text))
      .toEqual(['Published, but federation.yaml no longer lists it.', 'Not published yet.'])
  })

  it('link: none withdraws: an existing record is urgent drift', () => {
    const old = ours()
    expect(combine(fedWith({ link: 'none' }), { relation: null, files: FILES.lists, ownRecords: old }).drift)
      .toEqual([{ side: 'ours', text: 'Published, but federation.yaml no longer lists it.', urgent: true, uri: old[0].uri }])
  })

  it('a disagreement is never resolved: the state is the same with or without our records', () => {
    const fed = fedWith({ decision: 'x' })
    const a = combine(fed, { files: FILES.lists, atproto: entry(reading({ links: [theirs()] })), ownRecords: [] })
    const b = combine(fed, { files: FILES.lists, atproto: entry(reading({ links: [theirs()] })), ownRecords: ours() })
    expect(a.state).toBe(b.state)
  })
})

describe('filesSide', () => {
  it('reads the local folder, else the remote cache', () => {
    expect(filesSide(FILES.lists, null)).toEqual({ side: 'lists-us', checked: null, reason: null })
    expect(filesSide(FILES.silent, null)).toEqual({ side: 'silent', checked: null, reason: null })
    expect(filesSide(FILES.notInstance, null)).toEqual({ side: 'not-an-instance', checked: null, reason: null })
    expect(filesSide(FILES.unknown, null)).toEqual({ side: 'unknown', checked: null, reason: "can't read their side from here" })
    expect(filesSide(FILES.unknown, { listsUs: true, fetchedAt: T0 })).toEqual({ side: 'lists-us', checked: T0, reason: `checked ${T0}` })
    // An unknown with a path means a folder was looked at: the remote cache doesn't replace what was found there.
    expect(filesSide({ state: 'unknown', path: '/w/gone', reason: 'no folder at /w/gone' }, { listsUs: true, fetchedAt: T0 }).side).toBe('unknown')
  })
})

// Review fix round 1, I1: the record's network is resolved with the same disk as the relation.
describe('our record is matched with the disk the relation was worked out with', () => {
  it("a hub named in networks by a form only the disk resolves: the published record is not drift", () => {
    // `hub-os` is a bare folder name found one folder up (vault style): only the disk resolves it.
    const io = { resolve: (b: string, r: string) => { const out: string[] = []; for (const p of (r.startsWith('/') ? r : `${b}/${r}`).split('/')) { if (!p || p === '.') continue; if (p === '..') out.pop(); else out.push(p) } return `/${out.join('/')}` },
      isDir: (a: string) => a === '/vault/hub-os', readFederationAt: () => ({ found: false as const }) }
    const where = { base: '/vault/me', io }
    const fed = readFederation({ identity: { did: SELF }, networks: [{ name: 'Mesh', hub: 'hub-os' }], peers: [{ name: 'Hub', repo: '../hub-os', url: HUB_URL, did: HUB, decision: 'accepted' }] })
    const relation = relationOf(fed.peers[0], fed, where)
    expect(relation).toBe('memberOf')
    const published = [rec(SELF, HUB, 'memberOf', 'Mesh')]
    const got = combineLinkState({ peer: fed.peers[0], relation, selfDid: SELF, files: FILES.lists, ownRecords: published, fed, where } as never)
    expect(got.drift).toEqual([])
    expect(combineLinkState({ peer: fed.peers[0], relation, selfDid: SELF, files: FILES.lists, ownRecords: [], fed, where } as never).drift)
      .toEqual([{ side: 'ours', text: 'Not published yet.' }])
  })
})

// Review fix round 1, I2: an unreadable files side never makes our record of a derived link "not allowed".
describe('an unreadable files side never turns our record urgent', () => {
  const published = () => [rec(SELF, HUB, 'memberOf', 'Regen Mesh')]
  it('derived memberOf, no decision, our record published, their files unknown: no urgent drift, no delete', () => {
    for (const files of [FILES.unknown, { state: 'unknown', path: '/w/mesh-hub', reason: 'no folder at /w/mesh-hub' }]) {
      const own = published()
      const got = combine(fedWith(), { files, ownRecords: own })
      expect(got.drift.filter((d: { urgent?: boolean }) => d.urgent), JSON.stringify(files)).toEqual([])
      expect(got.drift).toEqual([])
      const v = linkVerdict({ peer: fedWith().peers[0], fed: fedWith(), relation: 'memberOf', filesSide: 'unknown' })
      expect(v).toEqual({ wanted: { withheld: 'undecided' }, tolerated: { subject: HUB, relation: 'memberOf', network: 'Regen Mesh' } })
    }
  })

  it('their files read and silent: the undecided record is still urgent (a real read, not a failure)', () => {
    const own = published()
    expect(combine(fedWith(), { files: FILES.silent, ownRecords: own }).drift)
      .toEqual([{ side: 'ours', text: 'Published, but federation.yaml no longer lists it.', urgent: true, uri: own[0].uri }])
  })

  it("a files-derived member (relation null while files are unknown) keeps its record quietly; nothing is wanted from it", () => {
    const MEMBER = 'did:plc:membermembermembermember'
    const hub = readFederation({ identity: { did: SELF }, join: { policy: 'open' }, networks: [{ name: 'Regen Mesh', hub: 'https://self.example.org', role: 'hub' }],
      peers: [{ name: 'Old Member', url: 'https://old.example.org', did: MEMBER, relationship: 'node' }] })
    const own = [rec(SELF, MEMBER, 'hasMember', 'Regen Mesh')]
    const got = combineLinkState({ peer: hub.peers[0], relation: null, selfDid: SELF, files: FILES.unknown, ownRecords: own, fed: hub } as never)
    expect(got.drift).toEqual([])
    // Not tolerated: a record of another relation, or a private peer's record (federation.yaml decides those).
    const other = [rec(SELF, MEMBER, 'peerOf')]
    expect(combineLinkState({ peer: hub.peers[0], relation: null, selfDid: SELF, files: FILES.unknown, ownRecords: other, fed: hub } as never).drift.map((d: { text: string }) => d.text))
      .toEqual(['Published, but federation.yaml no longer lists it.'])
    const priv = fedWith({ visibility: 'private' })
    expect(combine(priv, { files: FILES.unknown, ownRecords: published() }).drift.map((d: { text: string }) => d.text))
      .toEqual(['Published, but federation.yaml lists it as private.'])
  })
})
