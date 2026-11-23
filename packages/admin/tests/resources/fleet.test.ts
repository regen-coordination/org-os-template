import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'
import { atprotoCache } from '../../server/federation/atproto/read.ts'
import { mutualByFiles, byFiles, linkStatesOf, selfAddressesOf } from '../../server/federation/link-state.ts'
import { readFederation } from '../../lib/federation/read.mjs'
import { LINK_NSID, PROFILE_NSID } from '../../lib/federation/links.mjs'

let repo: string
let sibling: string
beforeEach(() => {
  repo = makeFixtureRepo()
  sibling = join(dirname(repo), `${basename(repo)}-sibling`)
  mkdirSync(sibling)
  // A real file, not an empty commit: `git log -- .` only sees commits that touch files.
  execSync('git init -q -b main && echo x > README.md && git add README.md && git -c user.name=Peer -c user.email=p@x commit -q -m init', { cwd: sibling })
})
afterEach(() => { removeFixtureRepo(repo); rmSync(sibling, { recursive: true, force: true }) })

const ctx = (r = repo): AdapterContext => ({ repo: r, now: () => new Date(2026, 9, 15, 12), run: runCommand, lastOk: () => null })

describe('fleet adapter', () => {
  it("draws this instance's own card alone when there is no fleet", async () => {
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.map(n => n.id)).toEqual(['instance:fixture-org'])
    expect(g.nodes[0]).toMatchObject({ name: 'Fixture Org', status: 'this instance', facts: expect.objectContaining({ self: true, localPath: repo }) })
    expect(g.edges).toEqual([])
  })

  // Final review M4: a peer whose id is this instance's own (a federation.yaml that lists itself) replaced the self card
  // with a peer one, and Sync and Share, offered on the self card, went with it.
  it('skips a federation peer whose id is this instance\'s own: one card for it, the self one', async () => {
    writeFileSync(join(repo, 'federation.yaml'), [
      'identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'peers:',
      '  - name: Fixture Org itself', '    repo: someone/fixture-org', '    trust: read',
      '  - name: Far Away', '    repo: someone/far-away', '    trust: read', '',
    ].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.filter(n => n.id === 'instance:fixture-org')).toHaveLength(1)
    expect(g.nodes.find(n => n.id === 'instance:fixture-org')).toMatchObject({ status: 'this instance', facts: expect.objectContaining({ self: true }) })
    expect(g.nodes.map(n => n.id)).toEqual(['instance:fixture-org', 'instance:far-away'])
    expect(g.edges).toEqual([{ from: 'instance:far-away', to: 'instance:fixture-org', kind: 'federation' }])
  })

  it('reads federation peers, with this instance as the hub they link to', async () => {
    writeFileSync(join(repo, 'federation.yaml'), [
      'identity:', '  name: "Fixture Org"', '  slug: fixture-org', '  type: PersonalNode', 'peers:',
      `  - name: Sibling`, `    repo: ../${basename(sibling)}`, '    trust: read', '    relationship: host-cooperative',
      '  - name: Far Away', '    repo: someone/far-away', '    url: https://github.com/someone/far-away', '    trust: read', '',
    ].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:fixture-org')).toMatchObject({ name: 'Fixture Org', status: 'this instance',
      facts: expect.objectContaining({ self: true, localPath: repo }) })
    expect(g.nodes.find(n => n.id === `instance:${basename(sibling)}`)).toMatchObject({ name: 'Sibling', status: 'a repo, not an instance',
      changed: expect.objectContaining({ by: 'Peer' }), facts: expect.objectContaining({ localPath: sibling, link: 'not-an-instance', relationship: 'host-cooperative', trust: 'read' }) })
    expect(g.nodes.find(n => n.id === 'instance:far-away')).toMatchObject({ status: 'not checked', attention: null, changed: null,
      facts: expect.objectContaining({ localPath: null, link: 'unknown' }) })
    expect(g.edges).toContainEqual({ from: 'instance:far-away', to: 'instance:fixture-org', kind: 'federation' })
  })

  const linked = (siblingPeers: string) => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'peers:',
      '  - name: Sibling', `    repo: ../${basename(sibling)}`, ''].join('\n'))
    writeFileSync(join(sibling, 'federation.yaml'), siblingPeers)
  }

  it('a sibling that lists this instance back is mutual', async () => {
    linked(`peers:\n  - name: Fixture Org\n    repo: ../${basename(repo)}\n`)
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === `instance:${basename(sibling)}`)).toMatchObject({ status: 'mutual', attention: null, facts: expect.objectContaining({ link: 'mutual' }) })
  })

  it('a sibling instance that does not list this one is claimed, with the ask', async () => {
    linked('peers: []\n')
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === `instance:${basename(sibling)}`)).toMatchObject({ status: 'claimed',
      attention: { level: 'warn', text: 'Only this side lists the link. Ask them to add this instance.' }, facts: expect.objectContaining({ link: 'claimed' }) })
  })

  // Final review M1: a folder was looked at, so the card says what was found there, not "not checked".
  it('a missing folder or a broken federation.yaml reads "can\'t read their side", with the reason', async () => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'peers:',
      '  - name: Gone', '    repo: ../gone-peer-folder', '  - name: Sibling', `    repo: ../${basename(sibling)}`, ''].join('\n'))
    writeFileSync(join(sibling, 'federation.yaml'), 'peers: [\n  bad: : :\n')
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:gone-peer-folder')).toMatchObject({ status: "can't read their side",
      attention: { level: 'warn', text: `No folder at ${join(dirname(repo), 'gone-peer-folder')}.` }, facts: expect.objectContaining({ link: 'unknown' }) })
    const broken = g.nodes.find(n => n.id === `instance:${basename(sibling)}`)!
    expect(broken).toMatchObject({ status: "can't read their side", facts: expect.objectContaining({ link: 'unknown' }) })
    expect(broken.attention).toMatchObject({ level: 'warn', text: expect.stringMatching(/^Their federation\.yaml can't be read: .+\.$/) })
  })

  it('reads peers nested under federation: when there are none at the top level (final review C1)', async () => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'federation:', '  peers:',
      '    - name: Far Away', '      repo: someone/far-away', ''].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.map(n => n.id)).toEqual(['instance:fixture-org', 'instance:far-away'])
    expect(g.nodes[1]).toMatchObject({ status: 'not checked', attention: null })
  })

  it('prefers data/instances.yaml, skips its own entry, and warns on drift', async () => {
    writeFileSync(join(repo, 'data', 'instances.yaml'), [
      'instances:', '  - id: fixture-org', '    name: Me', '  - id: example-coop-os', '    name: Example Coop', '    maturity: production',
      `    local_path: ../${basename(sibling)}`, '    last_sync: "2026-10-14"', '    drift: ["framework_version behind"]', '',
    ].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.map(n => n.id).sort()).toEqual(['instance:example-coop-os', 'instance:fixture-org'])
    expect(g.nodes.find(n => n.id === 'instance:example-coop-os')).toMatchObject({ status: 'production',
      attention: { level: 'warn', text: '1 drift item' }, facts: expect.objectContaining({ localPath: sibling }) })
  })

  it('reads this repository\'s real fleet', async () => {
    const g = (await fleet.read(ctx(REAL_REPO))) as Graph
    expect(g.nodes.filter(n => n.kind === 'instance').length).toBeGreaterThan(1)
  })
})

// N2 Task 4: the card's state comes from combineLinkState, fed by the files, the remote cache and the atproto cache.
describe('fleet adapter: one link state from every source', () => {
  const SELF = 'did:plc:selfselfselfselfselfself'
  const HUB = 'did:plc:hubhubhubhubhubhubhubhub'
  const GONE = 'did:plc:gonegonegonegonegonegone'
  const HUB_URL = 'https://mesh-hub.example.org'
  const T0 = '2026-11-20T10:00:00.000Z'
  let k = 0
  const link = (owner: string, subject: string, relation: string, network?: string) => ({
    uri: `at://${owner}/${LINK_NSID}/r${++k}`, cid: `bafy${k}`,
    value: { $type: LINK_NSID, subject, relation, ...(network ? { network } : {}), createdAt: T0 },
  })
  const reading = (did: string, links: ReturnType<typeof link>[], profile = true) => ({
    did, pds: 'https://pds.example.net', handle: null, skipped: 0, fetchedAt: T0, links,
    profile: profile ? { uri: `at://${did}/${PROFILE_NSID}/self`, cid: 'bafyp', value: { networks: [], rest: {} } } : null,
  })
  const writeFed = (extra: string[] = []) => writeFileSync(join(repo, 'federation.yaml'), [
    'identity:', '  name: "Fixture Org"', '  slug: fixture-org', `  did: ${SELF}`,
    'networks:', '  - name: Regen Mesh', `    hub: ${HUB_URL}`,
    'peers:', '  - name: Mesh Hub', `    url: ${HUB_URL}`, `    did: ${HUB}`, '    decision: proposal 2026-11-01-a', ...extra, '',
  ].join('\n'))
  const card = (g: Graph, id = 'instance:mesh-hub') => g.nodes.find(n => n.id === id)!

  it("their reciprocal record makes the link mutual; its absence after our decision is left; the card carries sources and drift", async () => {
    writeFed()
    let g = (await fleet.read(ctx())) as Graph
    expect(card(g)).toMatchObject({ status: 'not checked', facts: expect.objectContaining({ link: 'unknown',
      sources: { files: 'unknown', atproto: 'unknown', checked: null }, drift: [], relation: 'memberOf' }) })

    atprotoCache(repo).put(HUB, reading(HUB, [link(HUB, SELF, 'hasMember', 'Regen Mesh')]) as never)
    g = (await fleet.read(ctx())) as Graph
    expect(card(g)).toMatchObject({ status: 'mutual', attention: null, facts: expect.objectContaining({ link: 'mutual', linkReason: `checked ${T0}`, checked: T0,
      sources: { files: 'unknown', atproto: 'lists-us', checked: T0 } }) })

    atprotoCache(repo).put(HUB, reading(HUB, []) as never)
    g = (await fleet.read(ctx())) as Graph
    expect(card(g)).toMatchObject({ status: 'left', attention: { level: 'warn', text: 'They no longer list this instance.' },
      facts: expect.objectContaining({ link: 'left', sources: { files: 'unknown', atproto: 'silent', checked: T0 } }) })
  })

  it('a failed read with no earlier success is unknown, never left, and says why', async () => {
    writeFed()
    atprotoCache(repo).put(HUB, { problem: 'Not read: their PDS did not answer.' }, new Date('2026-11-22T09:00:00Z'))
    const g = (await fleet.read(ctx())) as Graph
    expect(card(g)).toMatchObject({ status: "can't read their side", attention: { level: 'warn', text: "Couldn't check their records (2026-11-22T09:00:00.000Z)." },
      facts: expect.objectContaining({ link: 'unknown', sources: { files: 'unknown', atproto: 'unknown', checked: null } }) })
  })

  it("our own records only make drift: not published yet on the peer, and a record no peer has on this instance's card (warn)", async () => {
    writeFed()
    atprotoCache(repo).put(HUB, reading(HUB, [link(HUB, SELF, 'hasMember', 'Regen Mesh')]) as never)
    atprotoCache(repo).put(SELF, reading(SELF, []) as never)
    let g = (await fleet.read(ctx())) as Graph
    expect(card(g)).toMatchObject({ status: 'mutual', facts: expect.objectContaining({ drift: [{ side: 'ours', text: 'Not published yet.' }] }) })
    expect(card(g, 'instance:fixture-org').facts).toMatchObject({ drift: [] })

    const stray = link(SELF, GONE, 'peerOf')
    atprotoCache(repo).put(SELF, reading(SELF, [link(SELF, HUB, 'memberOf', 'Regen Mesh'), stray]) as never)
    const before = readFileSync(join(repo, 'federation.yaml'), 'utf8')
    g = (await fleet.read(ctx())) as Graph
    expect(card(g).facts).toMatchObject({ drift: [] })
    expect(card(g, 'instance:fixture-org')).toMatchObject({ status: 'this instance',
      attention: { level: 'warn', text: 'Published, but federation.yaml no longer lists it.' },
      facts: expect.objectContaining({ drift: [{ side: 'ours', text: 'Published, but federation.yaml no longer lists it.', urgent: true, uri: stray.uri, subject: GONE }] }) })
    // federation.yaml is never written to settle it.
    expect(readFileSync(join(repo, 'federation.yaml'), 'utf8')).toBe(before)
  })

  it('a peer made private with a record still published is the urgent case on its card', async () => {
    writeFed(['    visibility: private'])
    atprotoCache(repo).put(SELF, reading(SELF, [link(SELF, HUB, 'memberOf', 'Regen Mesh')]) as never)
    const g = (await fleet.read(ctx())) as Graph
    expect(card(g)).toMatchObject({ attention: { level: 'warn', text: 'Published, but federation.yaml lists it as private.' } })
  })

  it('without identity.did, their files decide (no false left)', async () => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'peers:',
      '  - name: Sibling', `    repo: ../${basename(sibling)}`, `    did: ${HUB}`, '    link: peerOf', '    decision: x', ''].join('\n'))
    writeFileSync(join(sibling, 'federation.yaml'), `peers:\n  - name: Fixture Org\n    repo: ../${basename(repo)}\n`)
    atprotoCache(repo).put(HUB, reading(HUB, []) as never)
    const g = (await fleet.read(ctx())) as Graph
    expect(card(g, `instance:${basename(sibling)}`)).toMatchObject({ status: 'mutual', facts: expect.objectContaining({ link: 'mutual' }) })
  })

  it('mutualByFiles gives the indexes of peers whose files list this instance (R4), local folder or remote cache', async () => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', 'peers:',
      '  - name: Far', '    url: https://far.example.org',
      '  - name: Sibling', `    repo: ../${basename(sibling)}`,
      '  - name: Quiet', '    url: https://quiet.example.org', ''].join('\n'))
    writeFileSync(join(sibling, 'federation.yaml'), `peers:\n  - name: Fixture Org\n    repo: ../${basename(repo)}\n`)
    const fed = readFederation((await import('yaml')).parse(readFileSync(join(repo, 'federation.yaml'), 'utf8')))
    const self = await selfAddressesOf(repo, runCommand)
    expect(mutualByFiles(repo, fed, self)).toEqual([1])
    execSync('git remote add origin https://github.com/acme/fixture-org', { cwd: repo })
    const { remoteCache } = await import('../../server/federation/remote.ts')
    remoteCache(repo).put('https://far.example.org/.well-known/federation.json', { spec: 'org-os/federation/1', peers: [{ name: 'Fixture Org', url: 'https://github.com/acme/fixture-org' }] })
    remoteCache(repo).put('https://quiet.example.org/.well-known/federation.json', { spec: 'org-os/federation/1', peers: [] })
    expect(mutualByFiles(repo, fed, await selfAddressesOf(repo, runCommand))).toEqual([0, 1])
    const states = linkStatesOf(repo, fed, await selfAddressesOf(repo, runCommand))
    expect(states.selfDid).toBeNull()
    expect([...states.peers.values()].map(s => s.state)).toEqual(['mutual', 'mutual', 'claimed'])
  })

  it("a hub's existing member with no decision, mutual by files and naming this instance as hub, is hasMember and wanted (R4)", async () => {
    const MEMBER = 'did:plc:membermembermembermember'
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', `  did: ${SELF}`, 'join:', '  policy: open-with-approval',
      'peers:', '  - name: Sibling', `    repo: ../${basename(sibling)}`, '    url: https://sibling.example.org', `    did: ${MEMBER}`, '    relationship: node', ''].join('\n'))
    const back = `peers:\n  - name: Fixture Org\n    repo: ../${basename(repo)}\n`
    writeFileSync(join(sibling, 'federation.yaml'), `networks:\n  - name: Fixture Mesh\n    hub: ../${basename(repo)}\n${back}`)
    atprotoCache(repo).put(SELF, reading(SELF, []) as never)
    const fed = () => readFederation(parseYaml(readFileSync(join(repo, 'federation.yaml'), 'utf8')))
    const self = await selfAddressesOf(repo, runCommand)
    expect(byFiles(repo, fed(), self)).toEqual({ mutualByFiles: [0], membersByFiles: [0] })
    let g = (await fleet.read(ctx())) as Graph
    expect(card(g, `instance:${basename(sibling)}`).facts).toMatchObject({ link: 'mutual', relation: 'hasMember', drift: [{ side: 'ours', text: 'Not published yet.' }] })

    // The same member whose files list this instance but don't name it as hub: no hasMember, nothing to publish.
    writeFileSync(join(sibling, 'federation.yaml'), `networks:\n  - name: Elsewhere\n    hub: https://elsewhere.example.org\n${back}`)
    expect(byFiles(repo, fed(), self)).toEqual({ mutualByFiles: [0], membersByFiles: [] })
    g = (await fleet.read(ctx())) as Graph
    expect(card(g, `instance:${basename(sibling)}`).facts).toMatchObject({ link: 'mutual', relation: null, drift: [] })
  })

  it('a remote federation.json names this instance as hub only by a public url', async () => {
    writeFileSync(join(repo, 'federation.yaml'), ['identity:', '  name: "Fixture Org"', 'join:', '  policy: open', 'peers:',
      '  - name: Far', '    url: https://far.example.org', ''].join('\n'))
    execSync('git remote add origin https://github.com/acme/fixture-org', { cwd: repo })
    const { remoteCache } = await import('../../server/federation/remote.ts')
    const url = 'https://far.example.org/.well-known/federation.json'
    const fed = readFederation(parseYaml(readFileSync(join(repo, 'federation.yaml'), 'utf8')))
    const peersBack = [{ name: 'Fixture Org', url: 'https://github.com/acme/fixture-org' }]
    remoteCache(repo).put(url, { spec: 'org-os/federation/1', networks: [{ name: 'Mesh', hub: 'github.com/acme/fixture-org' }], peers: peersBack })
    expect(byFiles(repo, fed, await selfAddressesOf(repo, runCommand))).toEqual({ mutualByFiles: [0], membersByFiles: [0] })
    remoteCache(repo).put(url, { spec: 'org-os/federation/1', networks: [{ name: 'Mesh', hub: `../${basename(repo)}` }], peers: peersBack })
    expect(byFiles(repo, fed, await selfAddressesOf(repo, runCommand))).toEqual({ mutualByFiles: [0], membersByFiles: [] })
  })
})

