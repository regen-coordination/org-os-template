// Bringing existing peers lists onto atproto (network N2 Task 12): GET /api/federation/migration lists the public peers
// from the trunk and the caches; POST stages, under the org's rules, one federation.yaml edit setting `did` and/or `link`.
// Nothing here publishes (R28): the fake PDS's write log stays empty until the separate confirmed publish. Every test runs
// in a fresh temp repository with the fake network: nothing reaches a real PDS or plc.directory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { createApp } from '../../server/app.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { mountFederation } from '../../server/federation/routes.ts'
import { remoteCache, wellKnownUrlOf } from '../../server/federation/remote.ts'
import { atprotoCache, checkLinksAndRecords, readRepo } from '../../server/federation/atproto/read.ts'
import { planPublish, type PublishDeps } from '../../server/federation/atproto/publish.ts'
import { runCommand } from '../../server/resources/run.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { MIGRATION_WHY, BINDING } from '../../lib/federation/migrate.mjs'

const CONSENSUS = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [identity], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SELF = plcDid('fixture-org')
const HUB = plcDid('mesh-hub')
const SEAT = plcDid('seat-council')
const QUIET = plcDid('quiet-sibling')
const GROVE = plcDid('grove-sibling')
const HUB_SITE = 'https://mesh-hub.example.org'
const GROVE_SITE = 'https://grove-sibling.example.org'
const ORIGIN = 'https://github.com/fixture/fixture-org'
const NOW = new Date('2026-11-23T12:00:00.000Z')
const PASSWORD = 'zq7-UNMISTAKABLE-app-pass-7781'

const FED = [
  "# the org's federation manifest",
  'identity:', '  name: "Fixture Org"', '  type: "Organization"', '  url: https://fixture-org.example.com', `  did: "${SELF}"`,
  'networks:', `  - { name: Mesh, hub: ${HUB_SITE}, role: node }`,
  'peers:',
  '  # our hub: its DID is only in its federation.json',
  '  - name: Mesh Hub',
  `    url: ${HUB_SITE}`,
  '    relationship: hub',
  '    decision: LD-2026-001',
  '  # a seat we hold',
  `  - { name: Seat Council, url: https://seat-council.example.org, relationship: network-seat, did: "${SEAT}" }`,
  '  - name: Quiet Sibling # kept private',
  '    url: https://quiet-sibling.example.org',
  '    visibility: private',
  `    did: "${QUIET}"`,
  '  - name: Folder Friend',
  '    repo: ../folder-friend',
  '  - name: Grove Sibling',
  `    url: ${GROVE_SITE}`,
  '    relationship: sibling',
  `    did: "${GROVE}"`,
  '',
].join('\n')

let repo: string
let app: ReturnType<typeof createApp>
let net: FakeNetwork

const write = (rel: string, text: string) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text) }
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg) }
const head = () => git('rev-parse', 'HEAD').trim()

const build = () => {
  app = createApp(repo, (a, ctx) => { mountFederation(a, { repo, withLock: ctx.withLock, now: () => NOW, startBranch: 'main' }) })
}
const setup = (governance: string | null = CONSENSUS, fed = FED) => {
  repo = makeChangeRepo(governance)
  git('remote', 'add', 'origin', ORIGIN)
  write('federation.yaml', fed)
  write('kms.yaml', ['adapter: repo-data', 'target: "."', 'atproto:', `  did: "${SELF}"`, '  pds: "https://pds-one.example.com"', '  handle: "fixture-org.example.com"', '  nsid_authority: "org.fixture"', ''].join('\n'))
  commit('the org: identity, peers, kms')
  // what earlier confirmed checks of their files left: the hub's federation.json names its DID; Grove's lists us
  remoteCache(repo).put(wellKnownUrlOf(HUB_SITE)!, { spec: 'org-os/federation/1', name: 'Mesh Hub', did: HUB, networks: [{ name: 'Mesh' }] }, NOW)
  remoteCache(repo).put(wellKnownUrlOf(GROVE_SITE)!, { spec: 'org-os/federation/1', name: 'Grove Sibling', did: GROVE, peers: [{ name: 'Fixture Org', url: ORIGIN }] }, NOW)
  build()
}

beforeEach(() => {
  net = makeFakeNetwork({ hosts: {
    'https://pds-one.example.com': { accounts: {
      [SELF]: { handle: 'fixture-org.example.com', password: PASSWORD },
      [GROVE]: { handle: 'grove-sibling.example.org', password: 'grove-pass' },
    } },
    'https://pds-two.example.net': { accounts: {
      [HUB]: { handle: 'mesh-hub.example.org', password: 'hub-pass' },
      [SEAT]: { handle: 'seat-council.example.org', password: 'seat-pass' },
      [QUIET]: { handle: 'quiet-sibling.example.org', password: 'quiet-pass' },
    } },
  } })
})
afterEach(() => removeFixtureRepo(repo))

const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
type Row = { index: number; name: string; did: string | null; didSource: string | null; didVerified: boolean; relation: string | null; relationSource: string | null; publishable: boolean; why: string | null }
const rows = async () => {
  const res = await app.request('/api/federation/migration')
  const text = await res.text()
  expect(res.status, text).toBe(200)
  return { text, json: JSON.parse(text) as { rows: Row[]; kept: { private: number; noUrl: number } } }
}
const migrate = async (set: unknown) => {
  const res = await post('/api/federation/migration', { set })
  return { res, json: await res.json() as Record<string, unknown> }
}
/** The confirmed `federation.check-links`, run as its job runs it, against the fake network (R7: the only place a handle
 *  or a DID is looked up). */
const lookUp = (params: Record<string, unknown>) =>
  checkLinksAndRecords(repo, params, { fetch: net.fetch, lookup: net.lookup, resolveTxt: net.resolveTxt }, new AbortController().signal, NOW)
const stagedFed = (): string | null => {
  const op = new ChangeStore(repo).all().changes.flatMap(c => c.ops).find(o => o.op === 'file' && o.path === 'federation.yaml') as { text: string | null } | undefined
  return op?.text ?? null
}
const applyStaged = () => {
  const store = new ChangeStore(repo)
  for (const change of store.all().changes) {
    for (const op of change.ops) {
      if (op.op !== 'file') continue
      if (op.text === null) rmSync(join(repo, op.path), { force: true })
      else write(op.path, op.text)
    }
    store.clear(change.actor)
  }
  commit('apply the staged change')
}
const pdeps = (o: Partial<PublishDeps> = {}): PublishDeps => ({
  fetch: net.fetch, lookup: net.lookup, env: { ATPROTO_APP_PASSWORD: PASSWORD }, now: NOW, allowPlaceholderLexicons: true, run: runCommand, startBranch: 'main', ...o,
})
const ownCheck = async () => atprotoCache(repo).put(SELF, await readRepo(SELF, { fetch: net.fetch, lookup: net.lookup, now: NOW }), NOW)

describe('GET /api/federation/migration', () => {
  it('lists exactly the three public peers from the trunk; the private and url-less peers are counted and named nowhere', async () => {
    setup()
    const before = head()
    const { text, json } = await rows()
    expect(json.kept).toEqual({ private: 1, noUrl: 1 })
    expect(json.rows.map(r => r.name)).toEqual(['Mesh Hub', 'Seat Council', 'Grove Sibling'])
    for (const hidden of ['Quiet', 'quiet', QUIET, 'Folder', 'folder']) expect(text).not.toContain(hidden)
    expect(json.rows[0]).toMatchObject({ did: HUB, didSource: 'their federation.json', didVerified: false, relation: 'memberOf', publishable: false, why: MIGRATION_WHY.noDid })
    expect(json.rows[1]).toMatchObject({ did: SEAT, didSource: 'federation.yaml', relation: null, publishable: false, why: "Choose how it's linked." })
    expect(json.rows[2]).toMatchObject({ did: GROVE, relation: null, publishable: false, why: "Choose how it's linked." })
    // reading changes nothing and fetches nothing
    expect(head()).toBe(before)
    expect(git('status', '--porcelain')).toBe('')
    expect(net.requests).toEqual([])
  })

  it('reads the trunk, never the working tree', async () => {
    setup()
    write('federation.yaml', FED.replace('Grove Sibling', 'Renamed Grove'))
    expect((await rows()).json.rows.map(r => r.name)).toEqual(['Mesh Hub', 'Seat Council', 'Grove Sibling'])
  })

  it('a DID is shown verified only after a confirmed check tied it to that peer', async () => {
    setup()
    expect((await rows()).json.rows[0].didVerified).toBe(false)
    await lookUp({ did: HUB })
    expect((await rows()).json.rows[0].didVerified).toBe(true)
  })
})

describe('POST /api/federation/migration', () => {
  it('stages one federation.yaml edit that keeps the comments and touches only the named entries; nothing is published', async () => {
    setup()
    await lookUp({ did: HUB })
    const before = head()
    const { res, json } = await migrate([{ index: 0, did: HUB }, { index: 4, link: 'peerOf' }])
    expect(res.status, JSON.stringify(json)).toBe(200)
    expect(json.staged).toBe(true)
    expect(head()).toBe(before)
    expect(git('status', '--porcelain')).toBe('')
    const ops = new ChangeStore(repo).all().changes.flatMap(c => c.ops)
    expect(ops).toHaveLength(1)
    const text = stagedFed()!
    for (const comment of ["# the org's federation manifest", '# our hub: its DID is only in its federation.json', '# a seat we hold', '# kept private']) expect(text).toContain(comment)
    const was = parse(FED) as { peers: Record<string, unknown>[] }
    const now = parse(text) as { peers: Record<string, unknown>[]; [k: string]: unknown }
    expect(now.peers[0]).toEqual({ ...was.peers[0], did: HUB })
    expect(now.peers[4]).toEqual({ ...was.peers[4], link: 'peerOf' })
    for (const i of [1, 2, 3]) expect(now.peers[i]).toEqual(was.peers[i])
    const { peers: _a, ...restWas } = was as Record<string, unknown>
    const { peers: _b, ...restNow } = now
    expect(restNow).toEqual(restWas)
    // only two lines are added, and no line of the file is changed or lost
    const added = text.split('\n').filter(l => !FED.split('\n').includes(l))
    expect(added).toEqual([`    did: ${HUB}`, '    link: peerOf'])
    expect(text.split('\n').filter(l => !added.includes(l))).toEqual(FED.split('\n'))
    // the seat's flow map and the private peer's lines are byte-identical
    expect(text).toContain(`  - { name: Seat Council, url: https://seat-council.example.org, relationship: network-seat, did: "${SEAT}" }`)
    expect(text).toContain(`  - name: Quiet Sibling # kept private\n    url: https://quiet-sibling.example.org\n    visibility: private\n    did: "${QUIET}"\n`)
    expect(net.writes).toEqual([])
  })

  it('a flow-style entry is written back by the YAML library, comments and every other value kept', async () => {
    setup()
    const { res, json } = await migrate([{ index: 1, link: 'peerOf' }])
    expect(res.status, JSON.stringify(json)).toBe(200)
    const text = stagedFed()!
    for (const comment of ["# the org's federation manifest", '# a seat we hold', '# kept private']) expect(text).toContain(comment)
    const was = parse(FED) as { peers: Record<string, unknown>[] }
    const now = parse(text) as { peers: Record<string, unknown>[] }
    expect(now.peers).toEqual(was.peers.map((p, i) => (i === 1 ? { ...p, link: 'peerOf' } : p)))
  })

  it('under a direct rule it commits, naming the rule, from the actor route (never an in-process commit)', async () => {
    setup(null)
    await lookUp({ did: HUB })
    const { res, json } = await migrate([{ index: 0, did: HUB }])
    expect(res.status, JSON.stringify(json)).toBe(200)
    expect(typeof json.commit).toBe('string')
    expect(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim()).toBe('federation.yaml')
    const trailers = parseTrailers(git('log', '-1', '--format=%B'))
    expect(trailers.actor).toBe('steward-a')
    expect(String(trailers.rule)).toMatch(/\/direct$/)
    expect(net.writes).toEqual([])
  })

  it('a POST naming the private peer, the url-less peer, or no peer at all is refused: Not a public peer.', async () => {
    setup()
    await lookUp({ did: QUIET })
    for (const index of [2, 3, 5, -1, 1.5, '0']) {
      const { res, json } = await migrate([{ index, link: 'peerOf' }])
      expect([res.status, json.error], String(index)).toEqual([400, 'Not a public peer.'])
      expect(JSON.stringify(json)).not.toMatch(/Quiet|quiet|Folder|folder/)
    }
    const { res } = await migrate([{ index: 2, did: QUIET }])
    expect(res.status).toBe(400)
    expect(stagedFed()).toBeNull()
  })

  it('a handle is taken only from the cache of a confirmed check: before it, Look it up first.', async () => {
    setup()
    const before = await migrate([{ index: 0, did: 'mesh-hub.example.org' }])
    expect([before.res.status, before.json.error]).toEqual([400, 'Look it up first.'])
    expect(stagedFed()).toBeNull()
    expect(net.requests).toEqual([])
    await lookUp({ handle: '@Mesh-Hub.example.org' })
    const after = await migrate([{ index: 0, did: 'mesh-hub.example.org' }])
    expect(after.res.status, JSON.stringify(after.json)).toBe(200)
    expect((parse(stagedFed()!) as { peers: Record<string, unknown>[] }).peers[0].did).toBe(HUB)
  })

  it('a handle not resolved both ways is refused, and so is a DID whose handle was never confirmed', async () => {
    setup()
    // the hub's DID document claims a handle that doesn't name it back
    net.editDidDoc(HUB, d => ({ ...d, alsoKnownAs: ['at://seat-council.example.org'] }))
    await expect(lookUp({ handle: 'mesh-hub.example.org' })).rejects.toThrow()
    const byHandle = await migrate([{ index: 0, did: 'mesh-hub.example.org' }])
    expect([byHandle.res.status, byHandle.json.error]).toEqual([400, 'Look it up first.'])
    await lookUp({ did: HUB })
    const byDid = await migrate([{ index: 0, did: HUB }])
    expect([byDid.res.status, byDid.json.error]).toEqual([400, BINDING.notBothWays('seat-council.example.org')])
    // a DID never looked up at all
    const never = await migrate([{ index: 0, did: plcDid('never-seen') }])
    expect([never.res.status, never.json.error]).toEqual([400, 'Look it up first.'])
    expect(stagedFed()).toBeNull()
  })

  it('a DID verified for another peer is never written: the suggestion stays a suggestion', async () => {
    setup()
    await lookUp({ did: HUB })
    // the seat's own federation.json could claim the hub's DID; its handle is the hub's host, not the seat's
    remoteCache(repo).put(wellKnownUrlOf('https://seat-council.example.org')!, { spec: 'org-os/federation/1', did: HUB }, NOW)
    const { res, json } = await migrate([{ index: 1, did: HUB }])
    expect([res.status, json.error]).toEqual([400, BINDING.otherHost('mesh-hub.example.org', 'seat-council.example.org')])
    expect(stagedFed()).toBeNull()
  })

  it('refuses a bad body, an unknown link, a duplicate entry and an entry that sets nothing', async () => {
    setup()
    const cases: [unknown, string][] = [
      [undefined, 'Say which peers to set: set: [{ index, did?, link? }].'],
      [[], 'Say which peers to set: set: [{ index, did?, link? }].'],
      [[{ index: 0, link: 'friendOf' }], 'link must be one of memberOf, hasMember, peerOf, none.'],
      [[{ index: 0 }], 'Give a did or a link for each peer.'],
      [[{ index: 4, link: 'peerOf' }, { index: 4, link: 'none' }], 'Name each peer once.'],
      [[{ index: 0, did: 'not a did or handle!' }], '"not a did or handle!" is not a DID or a handle.'],
    ]
    for (const [set, error] of cases) {
      const { res, json } = await migrate(set)
      expect([res.status, json.error], JSON.stringify(set)).toEqual([400, error])
    }
    expect(stagedFed()).toBeNull()
  })

  it('a second POST builds on the actor\'s staged edit, never replacing it', async () => {
    setup()
    await lookUp({ did: HUB })
    expect((await migrate([{ index: 4, link: 'peerOf' }])).res.status).toBe(200)
    expect((await migrate([{ index: 0, did: HUB }])).res.status).toBe(200)
    const peers = (parse(stagedFed()!) as { peers: Record<string, unknown>[] }).peers
    expect([peers[0].did, peers[4].link]).toEqual([HUB, 'peerOf'])
    const again = await migrate([{ index: 4, link: 'peerOf' }])
    expect([again.res.status, again.json.error]).toEqual([409, 'Nothing to change: those peers already say so.'])
  })

  it('refuses when federation.yaml here no longer matches the trunk at that peer', async () => {
    setup()
    write('federation.yaml', FED.replace('  - name: Grove Sibling', '  - name: Someone Else'))
    const { res, json } = await migrate([{ index: 4, link: 'peerOf' }])
    expect(res.status).toBe(409)
    expect(String(json.error)).toContain('Grove Sibling')
  })

  it('nested-shape and pair-shape files keep their shape after staging', async () => {
    const nested = [
      'identity:', '  name: "Fixture Org"', `  did: "${SELF}"`,
      'federation:', '  network: Mesh', `  hub: ${HUB_SITE}`, '  peers:', '    # the hub', '    - name: Mesh Hub', `      url: ${HUB_SITE}`, '      decision: LD-1', '',
    ].join('\n')
    setup(CONSENSUS, nested)
    await lookUp({ did: HUB })
    expect((await rows()).json.rows.map(r => r.name)).toEqual(['Mesh Hub'])
    let r = await migrate([{ index: 0, did: HUB, link: 'memberOf' }])
    expect(r.res.status, JSON.stringify(r.json)).toBe(200)
    let text = stagedFed()!
    let doc = parse(text) as Record<string, any>
    expect(Object.keys(doc)).toEqual(['identity', 'federation'])
    expect(Object.keys(doc.federation)).toEqual(['network', 'hub', 'peers'])
    expect(doc.federation.peers[0]).toEqual({ name: 'Mesh Hub', url: HUB_SITE, decision: 'LD-1', did: HUB, link: 'memberOf' })
    expect(text).toContain('    # the hub')
    removeFixtureRepo(repo)

    const pair = [
      'identity:', '  name: "Fixture Org"', `  did: "${SELF}"`, 'network: Mesh', `hub: ${HUB_SITE}`,
      'peers:', '  - name: Mesh Hub', `    url: ${HUB_SITE}`, '    decision: LD-1', '',
    ].join('\n')
    setup(CONSENSUS, pair)
    await lookUp({ did: HUB })
    r = await migrate([{ index: 0, did: HUB }])
    expect(r.res.status, JSON.stringify(r.json)).toBe(200)
    text = stagedFed()!
    doc = parse(text) as Record<string, any>
    expect(Object.keys(doc)).toEqual(['identity', 'network', 'hub', 'peers'])
    expect(doc.peers[0]).toEqual({ name: 'Mesh Hub', url: HUB_SITE, decision: 'LD-1', did: HUB })
    expect(text).not.toContain('networks')
  })

  it('after apply, federation.publish-links plans exactly the publishable rows, and nothing was published on the way', async () => {
    setup()
    await lookUp({ did: HUB })
    expect((await migrate([{ index: 0, did: HUB }, { index: 4, link: 'peerOf' }])).res.status).toBe(200)
    applyStaged()
    const after = (await rows()).json.rows
    expect(after.filter(r => r.publishable).map(r => r.name)).toEqual(['Mesh Hub', 'Grove Sibling'])
    expect(after.find(r => r.name === 'Seat Council')!.why).toBe("Choose how it's linked.")
    await ownCheck()
    const { plan } = await planPublish(repo, pdeps())
    expect(plan.create.map(c => [c.record.subject, c.record.relation]).sort()).toEqual(
      after.filter(r => r.publishable).map(r => [r.did, r.relation]).sort())
    expect(plan.withheld).toMatchObject({ private: 1, noUrl: 1 })
    expect(JSON.stringify(plan)).not.toContain(QUIET)
    // every write path so far: none reached a PDS
    expect(net.writes).toEqual([])
    expect(readFileSync(join(repo, 'federation.yaml'), 'utf8')).toContain('link: peerOf')
  })
})
