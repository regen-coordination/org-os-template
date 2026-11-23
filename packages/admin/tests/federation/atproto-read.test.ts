// atproto reading (network N2 Task 3): each DID's link and profile records, read from its own PDS through the guarded
// reader, cached under stateDir, and only inside the confirmed `federation.check-links`. The fake network serves two
// PDS hosts, so every test that reads two accounts proves per-DID resolution. Nothing here touches the network.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { readRepo, atprotoCache, checkLinksAndRecords, MAX_PAGES, type Reading } from '../../server/federation/atproto/read.ts'
import { LINK_NSID, PROFILE_NSID } from '../../lib/federation/links.mjs'
import { stateDir } from '../../server/state.ts'
import { opById, type InProcess } from '../../server/operations/catalogue.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { JobStore, type JobRecord } from '../../server/state.ts'
import { HttpError } from '../../server/errors.ts'
import type { Resource } from '../../server/resources/types.ts'

const ALICE = plcDid('alice') // a hub, on pds-one
const BOB = plcDid('bob') // a node, on pds-two
const SELF = plcDid('fixture-org') // this instance, on pds-two
const QUIET = plcDid('quiet') // a private peer, on pds-one
const ONE = 'pds-one.example.com'
const TWO = 'pds-two.example.net'
const NOW = new Date('2026-11-22T10:00:00Z')
const LATER = new Date('2026-11-22T11:00:00Z')

const network = (pageSize?: number) => makeFakeNetwork({
  pageSize,
  hosts: {
    [`https://${ONE}`]: { accounts: { [ALICE]: { handle: 'alice.example.org', password: 'pw-alice' }, [QUIET]: { handle: 'quiet.example.org', password: 'pw-quiet' } } },
    [`https://${TWO}`]: { accounts: { [BOB]: { handle: 'bob.example.net', password: 'pw-bob' }, [SELF]: { handle: 'fixture.example.net', password: 'pw-self' } } },
  },
})
const link = (subject: string, relation = 'memberOf', o: Record<string, unknown> = {}) => ({ $type: LINK_NSID, subject, relation, createdAt: '2026-11-20T10:00:00.000Z', ...o })
const profile = (networks: { hub: string; name: string }[] = [], o: Record<string, unknown> = {}) => ({ $type: PROFILE_NSID, name: 'X', networks, createdAt: '2026-11-20T10:00:00.000Z', ...o })
const hosts = (net: FakeNetwork) => net.requests.map(r => new URL(r.url).host)
const signal = () => new AbortController().signal

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('readRepo', () => {
  it("reads two accounts' records, each from its own PDS, with each record's uri and cid", async () => {
    const net = network()
    const a = net.seed(ALICE, LINK_NSID, 'k1', link(BOB, 'hasMember', { network: 'Regen Mesh' }))
    net.seed(ALICE, PROFILE_NSID, 'self', profile([{ hub: ALICE, name: 'Regen Mesh' }]))
    const b = net.seed(BOB, LINK_NSID, 'k2', link(ALICE, 'memberOf', { network: 'Regen Mesh' }))

    const alice = await readRepo(ALICE, { ...net, now: NOW }) as Reading
    expect(alice).toEqual({
      did: ALICE, pds: `https://${ONE}`, handle: 'alice.example.org', fetchedAt: NOW.toISOString(), skipped: 0,
      links: [{ uri: a.uri, cid: a.cid, value: link(BOB, 'hasMember', { network: 'Regen Mesh' }) }],
      profile: { uri: `at://${ALICE}/${PROFILE_NSID}/self`, cid: expect.any(String), value: { networks: [{ hub: ALICE, name: 'Regen Mesh' }], rest: { name: 'X', createdAt: '2026-11-20T10:00:00.000Z' } } },
    })
    const bob = await readRepo(BOB, { ...net, now: NOW }) as Reading
    expect(bob).toMatchObject({ did: BOB, pds: `https://${TWO}`, profile: null, links: [{ uri: b.uri, cid: b.cid }] })
    expect(hosts(net)).toEqual(['plc.directory', ONE, ONE, 'plc.directory', TWO, TWO])
    expect(net.requests[1].url).toBe(`https://${ONE}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(ALICE)}&collection=example.orgosnetwork.link&limit=100`)
    expect(net.requests[2].url).toContain('collection=example.orgosnetwork.profile')
  })

  it('pages through cursor, keeps the profile self only, and skips an invalid link record, counting it', async () => {
    const net = network(2)
    for (let i = 1; i <= 5; i++) net.seed(ALICE, LINK_NSID, `k${i}`, link(plcDid(`member-${i}`), 'hasMember'))
    net.seed(ALICE, LINK_NSID, 'k6', link('not-a-did', 'hasMember'))
    net.seed(ALICE, LINK_NSID, 'k7', { $type: LINK_NSID, subject: BOB, relation: 'enemyOf', createdAt: '2026-11-20T10:00:00.000Z' })
    net.seed(ALICE, PROFILE_NSID, 'other', profile([{ hub: BOB, name: 'Not this one' }]))
    net.seed(ALICE, PROFILE_NSID, 'self', profile([{ hub: ALICE, name: 'Regen Mesh' }]))
    const got = await readRepo(ALICE, net) as Reading
    expect(got.links.map(l => l.uri.split('/').pop())).toEqual(['k1', 'k2', 'k3', 'k4', 'k5'])
    expect(got.skipped).toBe(2)
    expect(got.profile?.uri).toBe(`at://${ALICE}/${PROFILE_NSID}/self`)
    expect(got.profile?.value.networks).toEqual([{ hub: ALICE, name: 'Regen Mesh' }])
    expect(net.requests.filter(r => r.url.includes('collection=example.orgosnetwork.link'))).toHaveLength(4)
    expect(net.requests.filter(r => r.url.includes('cursor=k2'))).toHaveLength(1)
  })

  it('an invalid profile self is skipped and counted: no profile', async () => {
    const net = network()
    net.seed(ALICE, PROFILE_NSID, 'self', { $type: PROFILE_NSID, networks: 'Regen Mesh' })
    expect(await readRepo(ALICE, net)).toMatchObject({ profile: null, skipped: 1 })
  })

  it(`stops after ${MAX_PAGES} pages: a reading it cannot finish is refused, never partial`, async () => {
    const net = network(1)
    for (let i = 0; i < MAX_PAGES + 1; i++) net.seed(ALICE, LINK_NSID, `k${String(i).padStart(2, '0')}`, link(plcDid(`m${i}`), 'hasMember'))
    expect(await readRepo(ALICE, net)).toEqual({ problem: `Not read: ${ALICE} has more records than this reads (${MAX_PAGES} pages).` })
  })

  it('refuses a record of another collection, a record with no cid, a cursor that repeats, and an answer that is not a list', async () => {
    const cases: [string, (url: string, body: any) => any, RegExp][] = [
      ['another collection', (_u, b) => ({ ...b, records: [{ uri: `at://${ALICE}/app.bsky.feed.post/k1`, cid: 'bafy', value: link(BOB) }] }), /answered for another repository/],
      ['a uri with no key', (_u, b) => ({ ...b, records: [{ uri: `at://${ALICE}/${LINK_NSID}/`, cid: 'bafy', value: link(BOB) }] }), /answered for another repository/],
      ['a prefix trick', (_u, b) => ({ ...b, records: [{ uri: `at://${ALICE}x/${LINK_NSID}/k1`, cid: 'bafy', value: link(BOB) }] }), /answered for another repository/],
      ['no cid', (_u, b) => ({ ...b, records: [{ uri: `at://${ALICE}/${LINK_NSID}/k1`, value: link(BOB) }] }), /did not answer a list of records/],
      ['a repeating cursor', (_u, b) => ({ ...b, cursor: 'same' }), /repeated a page/],
      ['no list', () => ({ items: [] }), /did not answer a list of records/],
    ]
    for (const [what, rewrite, problem] of cases) {
      const net = network()
      net.seed(ALICE, LINK_NSID, 'k1', link(BOB))
      const fetch: typeof net.fetch = async (url, init) => {
        const res = await net.fetch(url, init)
        if (!url.includes('listRecords')) return res
        const body = JSON.stringify(rewrite(url, JSON.parse(await res.text!())))
        return { ...res, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) }
      }
      const got = await readRepo(ALICE, { ...net, fetch })
      expect(got, what).toHaveProperty('problem')
      expect((got as { problem: string }).problem, what).toMatch(problem)
    }
  })
})

describe('refuses private, redirecting, oversized and mismatched answers', () => {
  /** A good reading first, then the same check against a network that misbehaves: it is refused, before anything is
   *  parsed, and the cache keeps the earlier reading with the problem beside it. */
  const cases: [string, (net: FakeNetwork) => void, RegExp][] = [
    ['a DID document whose PDS is https://10.0.0.1', net => net.editDidDoc(ALICE, d => ({ ...d, service: [{ ...d.service[0], serviceEndpoint: 'https://10.0.0.1' }] })), /not a public https address/],
    ['a PDS host that resolves to 10.0.0.1', net => net.resolveTo(ONE, ['10.0.0.1']), /does not resolve to a public address/],
    ['a PLC directory that resolves to a private address', net => net.resolveTo('plc.directory', ['172.16.4.4']), /does not resolve to a public address/],
    ['a PDS that redirects', net => net.misbehave(ONE, 'redirect'), /answered 302/],
    ['a PLC directory that redirects', net => net.misbehave('plc.directory', 'redirect'), /answered 302/],
    ['a 300 KB listRecords answer', net => net.misbehave(ONE, 'oversized'), /sent more than 256 KB/],
    ['a 300 KB DID document', net => net.misbehave('plc.directory', 'oversized'), /sent more than 64 KB/],
    ['a DID document whose id is another DID', net => net.editDidDoc(ALICE, d => ({ ...d, id: BOB })), /is for another DID/],
    ['a listRecords answer carrying a record of another DID', net => net.misbehave(ONE, { answerFor: BOB }), /answered for another repository/],
    ['a PDS that is down', net => net.setDown(ONE), /could not be reached/],
  ]
  for (const [what, spoil, problem] of cases) {
    it(what, async () => {
      const net = network()
      net.seed(ALICE, LINK_NSID, 'k1', link(BOB, 'hasMember'))
      await checkLinksAndRecords(repo, { did: ALICE }, net, signal(), NOW)
      const earlier = atprotoCache(repo).get(ALICE)?.reading
      expect(earlier?.links).toHaveLength(1)
      spoil(net)
      await expect(checkLinksAndRecords(repo, { did: ALICE }, net, signal(), LATER)).rejects.toThrow(problem)
      const after = atprotoCache(repo).get(ALICE)
      expect(after?.reading).toEqual(earlier)
      expect(after?.lastProblem?.at).toBe(LATER.toISOString())
      expect(after?.lastProblem?.text).toMatch(problem)
    })
  }

  it('a PDS that never answers is refused after 10 s, and the earlier reading stays', async () => {
    const net = network()
    await checkLinksAndRecords(repo, { did: ALICE }, net, signal(), NOW)
    const earlier = atprotoCache(repo).get(ALICE)?.reading
    net.misbehave(ONE, 'slow')
    vi.useFakeTimers()
    try {
      const pending = checkLinksAndRecords(repo, { did: ALICE }, net, signal(), LATER)
      pending.catch(() => {})
      await vi.advanceTimersByTimeAsync(10_001)
      await expect(pending).rejects.toThrow(`Not read: ${ONE} took longer than 10 seconds.`)
    } finally { vi.useRealTimers() }
    expect(atprotoCache(repo).get(ALICE)?.reading).toEqual(earlier)
  })
})

describe('atprotoCache', () => {
  const reading = (o: Partial<Reading> = {}): Reading => ({ did: ALICE, pds: `https://${ONE}`, handle: 'alice.example.org', profile: null, links: [], skipped: 0, fetchedAt: NOW.toISOString(), ...o })

  it('keeps a reading under stateDir/federation/atproto, keyed by the sha256 of the DID', () => {
    const cache = atprotoCache(repo)
    expect(cache.get(ALICE)).toBeNull()
    cache.put(ALICE, reading(), NOW)
    const file = join(stateDir(repo), 'federation', 'atproto', `${createHash('sha256').update(ALICE).digest('hex')}.json`)
    expect(existsSync(file)).toBe(true)
    expect(atprotoCache(repo).get(ALICE)).toEqual({ did: ALICE, reading: reading(), lastProblem: null })
    expect(cache.get(BOB)).toBeNull()
  })

  it('a failure records lastProblem beside the good reading, and the next success clears it', () => {
    const cache = atprotoCache(repo)
    cache.put(ALICE, { problem: 'Not read: plc.directory could not be reached.' }, NOW)
    expect(cache.get(ALICE)).toEqual({ did: ALICE, reading: null, lastProblem: { at: NOW.toISOString(), text: 'Not read: plc.directory could not be reached.' } })
    cache.put(ALICE, reading(), NOW)
    cache.put(ALICE, { problem: 'Not read: it was cancelled.' }, LATER)
    expect(cache.get(ALICE)).toEqual({ did: ALICE, reading: reading(), lastProblem: { at: LATER.toISOString(), text: 'Not read: it was cancelled.' } })
    cache.put(ALICE, reading({ fetchedAt: LATER.toISOString() }), LATER)
    expect(cache.get(ALICE)?.lastProblem).toBeNull()
  })

  it("answers the DID document's PDS and handle for 24 hours after the reading", () => {
    const cache = atprotoCache(repo)
    cache.put(ALICE, reading(), NOW)
    expect(cache.didDoc(ALICE, new Date(NOW.getTime() + 23 * 3600_000))).toEqual({ pds: `https://${ONE}`, handle: 'alice.example.org', fetchedAt: NOW.toISOString() })
    expect(cache.didDoc(ALICE, new Date(NOW.getTime() + 25 * 3600_000))).toBeNull()
    expect(cache.didDoc(BOB, NOW)).toBeNull()
  })

  it('keeps handle → DID, only as written after a check both ways', () => {
    const cache = atprotoCache(repo)
    expect(cache.didOfHandle('alice.example.org')).toBeNull()
    cache.putHandle('Alice.Example.org', ALICE, NOW)
    expect(cache.didOfHandle('@alice.example.org')).toEqual({ did: ALICE, checkedAt: NOW.toISOString() })
  })
})

describe('federation.check-links reads atproto', () => {
  const op = () => opById('federation.check-links')!
  const self = (): Resource => ({ id: 'instance:fixture-org', kind: 'instance', board: 'systems', name: 'x', status: null, attention: null, changed: null, facts: { self: true }, source: null })
  const writeFed = (extra: string[] = []) => writeFileSync(join(repo, 'federation.yaml'), [
    'identity:', '  name: "Fixture Org"', `  did: "${SELF}"`, 'peers:',
    '  - name: Mesh Hub', `    did: "${ALICE}"`, '    url: https://hub.example.org',
    '  - name: Bob Node', `    did: "${BOB}"`, '    repo: ../bob-node',
    '  - name: Quiet One', `    did: "${QUIET}"`, '    url: https://quiet.example.org', '    visibility: private',
    ...extra, '',
  ].join('\n'))

  it('takes an address, a did or a handle, one at a time, and checks them before a nonce', () => {
    expect(op().params).toEqual({ type: 'object', additionalProperties: false, properties: {
      address: { type: 'string', maxLength: 2048 }, did: { type: 'string', maxLength: 2048 }, handle: { type: 'string', maxLength: 253 },
    } })
    const plan = (p: Record<string, unknown>) => () => op().plan(self(), p, repo)
    expect(plan({ did: ALICE, handle: 'alice.example.org' })).toThrow(HttpError)
    expect(plan({ did: ALICE, address: 'https://hub.example.org' })).toThrow('Look up one thing at a time: an address, a DID or a handle.')
    expect(plan({ did: 'did:key:z6Mk' })).toThrow('"did:key:z6Mk" is not a did:plc or did:web identifier this can resolve.')
    expect(plan({ handle: 'not a handle' })).toThrow('"not a handle" is not a handle.')
    expect((op().plan(self(), { did: ALICE }, repo) as InProcess).summary).toBe(`look up ${ALICE} on atproto: a download, it changes no file`)
    expect((op().plan(self(), { handle: 'alice.example.org' }, repo) as InProcess).summary).toBe('look up alice.example.org on atproto, both ways: a download, it changes no file')
    expect((op().plan(self(), {}, repo) as InProcess).summary).toMatch(/atproto records of every DID/)
  })

  it('under a test run, its real InProcess fails with no network in tests', async () => {
    writeFed()
    for (const params of [{}, { did: ALICE }, { handle: 'alice.example.org' }]) {
      const planned = op().plan(self(), params, repo) as InProcess
      await expect(planned.inProcess(repo, signal()), JSON.stringify(params)).rejects.toThrow(/no network in tests/)
    }
  })

  it('every peer with a did, and this instance, each from its own PDS; private peers are only counted', async () => {
    writeFed()
    const net = network()
    net.seed(ALICE, LINK_NSID, 'k1', link(SELF, 'hasMember'))
    net.seed(ALICE, PROFILE_NSID, 'self', profile([{ hub: ALICE, name: 'Regen Mesh' }]))
    net.seed(SELF, LINK_NSID, 'k1', link(ALICE, 'memberOf'))
    // The URL-only hub's federation.json is read too; the fake network has no such host, so that read fails and says so.
    const out = await checkLinksAndRecords(repo, {}, net, signal(), NOW)
    expect(out).toContain('This instance on atproto: read (1 link, no profile).')
    expect(out).toContain('Mesh Hub on atproto: read (1 link, a profile).')
    expect(out).toContain('Bob Node on atproto: read (0 links, no profile).')
    expect(out).toContain('1 private peer was read on atproto.')
    expect(out).not.toMatch(/Quiet|quiet|pw-/)
    expect(out).not.toContain(QUIET)
    for (const did of [ALICE, BOB, SELF, QUIET]) expect(atprotoCache(repo).get(did)?.reading?.fetchedAt, did).toBe(NOW.toISOString())
    expect(atprotoCache(repo).get(SELF)?.reading?.pds).toBe(`https://${TWO}`)
    expect(atprotoCache(repo).get(ALICE)?.reading?.pds).toBe(`https://${ONE}`)
    const listed = net.requests.filter(r => r.url.includes('listRecords')).map(r => [new URL(r.url).host, new URL(r.url).searchParams.get('repo')])
    expect(new Set(listed.map(([h, d]) => `${h} ${d}`))).toEqual(new Set([`${ONE} ${ALICE}`, `${ONE} ${QUIET}`, `${TWO} ${BOB}`, `${TWO} ${SELF}`]))
  })

  it('a per-DID failure is reported by name (a private one only counted), and the others continue', async () => {
    writeFed()
    const net = network()
    net.setDown(ONE) // the hub and the private peer live there
    const out = await checkLinksAndRecords(repo, {}, net, signal(), NOW)
    expect(out).toContain(`Mesh Hub on atproto: Not read: ${ONE} could not be reached.`)
    expect(out).toContain('1 private peer could not be read on atproto.')
    expect(out).toContain('Bob Node on atproto: read (0 links, no profile).')
    expect(out).not.toMatch(/Quiet|quiet/)
    expect(atprotoCache(repo).get(ALICE)).toMatchObject({ reading: null, lastProblem: { text: `Not read: ${ONE} could not be reached.` } })
  })

  it('one DID read twice is read once', async () => {
    writeFed(['  - name: Mesh Hub Again', `    did: "${ALICE}"`, '    repo: ../mesh-hub'])
    const net = network()
    await checkLinksAndRecords(repo, {}, net, signal(), NOW)
    expect(net.requests.filter(r => r.url === `https://plc.directory/${ALICE}`)).toHaveLength(1)
  })

  it('fails when nothing at all could be read, with every line', async () => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', 'peers:', '  - name: Mesh Hub', `    did: "${ALICE}"`, '    repo: ../mesh-hub', ''].join('\n'))
    const net = network()
    net.setDown('plc.directory')
    await expect(checkLinksAndRecords(repo, {}, net, signal(), NOW)).rejects.toThrow('Mesh Hub on atproto: Not read: plc.directory could not be reached.')
  })

  it('says so when there is nothing to look up', async () => {
    expect(await checkLinksAndRecords(repo, {}, network(), signal(), NOW)).toBe('No peer has only a url or a DID, and this instance has no DID: nothing to look up.\n')
  })

  it('a handle: resolved both ways, kept as handle → DID, and its records read', async () => {
    const net = network()
    net.seed(ALICE, LINK_NSID, 'k1', link(BOB, 'hasMember'))
    const out = await checkLinksAndRecords(repo, { handle: '@Alice.Example.org' }, net, signal(), NOW)
    expect(out).toBe(`alice.example.org is ${ALICE}.\nIts records: read (1 link, no profile).\n`)
    expect(atprotoCache(repo).didOfHandle('alice.example.org')).toEqual({ did: ALICE, checkedAt: NOW.toISOString() })
    expect(atprotoCache(repo).get(ALICE)?.reading?.links).toHaveLength(1)
  })

  it('a handle whose DID does not name it back fails the job, and nothing is kept for it', async () => {
    const net = network()
    net.editDidDoc(ALICE, d => ({ ...d, alsoKnownAs: ['at://other.example.org'] }))
    await expect(checkLinksAndRecords(repo, { handle: 'alice.example.org' }, net, signal(), NOW)).rejects.toThrow(`Not read: ${ALICE} does not name alice.example.org back.`)
    expect(atprotoCache(repo).didOfHandle('alice.example.org')).toBeNull()
    expect(atprotoCache(repo).get(ALICE)).toBeNull()
  })

  it('a did: its records read, and its handle checked both ways and kept when it holds', async () => {
    const net = network()
    expect(await checkLinksAndRecords(repo, { did: BOB }, net, signal(), NOW)).toBe(`${BOB}: read (0 links, no profile).\nIts handle is bob.example.net, both ways.\n`)
    expect(atprotoCache(repo).didOfHandle('bob.example.net')).toEqual({ did: BOB, checkedAt: NOW.toISOString() })
    // A DID whose handle does not point back: the records are still read; the handle is not kept.
    const forged = network()
    forged.editDidDoc(ALICE, d => ({ ...d, alsoKnownAs: ['at://bob.example.net'] }))
    expect(await checkLinksAndRecords(repo, { did: ALICE }, forged, signal(), NOW)).toBe(`${ALICE}: read (0 links, no profile).\nIts handle bob.example.net does not point back to it, so it is not kept.\n`)
    expect(atprotoCache(repo).didOfHandle('bob.example.net')).toEqual({ did: BOB, checkedAt: NOW.toISOString() })
  })

  it('the operation, run by the executor on the fake network, changes no file', async () => {
    writeFed()
    const { execSync } = await import('node:child_process')
    execSync('git add federation.yaml && git commit -qm "peers with dids"', { cwd: repo })
    const net = network()
    net.seed(ALICE, LINK_NSID, 'k1', link(SELF, 'hasMember'))
    const finished: JobRecord[] = []
    const exec = new LocalExecutor(repo, new JobStore(repo), { started: () => {}, output: () => {}, finished: j => finished.push(j) })
    const job = exec.submit({ op: op(), resource: self(), planned: { inProcess: (r, s) => checkLinksAndRecords(r, {}, net, s, NOW) } })
    await expect.poll(() => finished.find(j => j.id === job.id), { interval: 20, timeout: 15_000 }).toBeTruthy()
    expect(finished.find(j => j.id === job.id)).toMatchObject({ status: 'ok', changed: [], surprises: [], sentence: 'Done. No file changed.' })
    expect(execSync('git status --porcelain', { cwd: repo }).toString()).toBe('')
  })
})
