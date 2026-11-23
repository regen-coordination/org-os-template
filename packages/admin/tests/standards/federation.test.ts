// .well-known/federation.json (network N0, Task 4): this instance's public claims. Private and local-only peers are withheld.
import { describe, it, expect } from 'vitest'
import { buildCore } from '../../lib/standards/build.mjs'
import { federationDoc } from '../../lib/standards/federation.mjs'
import { readFederation } from '../../lib/federation/read.mjs'
import { projectPublic } from '../../lib/standards/project.mjs'
import { fixtureInput } from './fixtures.ts'

function withFederation(doc: Record<string, unknown>) {
  const input = fixtureInput()
  ;(input as any).federation = readFederation(doc)
  return input
}
const IDENTITY = { name: 'Test DAO', type: 'DAO', daoURI: 'https://dao.example.org/.well-known/dao.json' }

describe('federation.json', () => {
  it('publishes only peers with a public https url that are not private, and counts the rest', () => {
    const out = buildCore(withFederation({
      identity: IDENTITY,
      peers: [
        { name: 'ReFi DAO', url: 'https://github.com/ReFiDAO/refi-dao-os', relationship: 'network-seat', notes: 'secret note' },
        { name: 'local-only-peer', repo: '../local-only-peer', relationship: 'sovereign-counterpart' },
        { name: 'altiplano', url: 'https://github.com/a/altiplano', visibility: 'private' },
      ],
    }))
    expect(out.files['federation.json']).toMatchObject({ spec: 'org-os/federation/1' })
    expect((out.files['federation.json'] as any).peers).toEqual([{ name: 'ReFi DAO', url: 'https://github.com/ReFiDAO/refi-dao-os' }])
    expect(JSON.stringify(out.files['federation.json'])).not.toMatch(/local-only-peer|altiplano|secret note|sovereign|network-seat|\.\.\//)
    expect(out.withheld).toContainEqual({ collection: 'peers', records: 2, fields: 0 })
  })

  it('carries identity.did and a published peer\'s did; a private or local-only peer\'s did never appears', () => {
    const out = buildCore(withFederation({
      identity: { ...IDENTITY, did: 'did:plc:selfselfselfselfselfself' },
      peers: [
        { name: 'Open Peer', url: 'https://example.org/open', did: 'did:plc:openopenopenopenopenopen', link: 'peerOf' },
        { name: 'quiet-peer', url: 'https://example.org/quiet', did: 'did:plc:quietquietquietquietquiet', visibility: 'private' },
        { name: 'local-peer', repo: '../local-peer', did: 'did:web:local.example' },
        { name: 'Bad Did', url: 'https://example.org/bad', did: 'not-a-did' },
      ],
    }))
    const doc = out.files['federation.json'] as any
    expect(doc.did).toBe('did:plc:selfselfselfselfselfself')
    expect(doc.peers).toEqual([
      { name: 'Open Peer', url: 'https://example.org/open', did: 'did:plc:openopenopenopenopenopen' },
      { name: 'Bad Did', url: 'https://example.org/bad' },
    ])
    const text = JSON.stringify(out.files)
    expect(text).not.toContain('quietquiet')
    expect(text).not.toContain('did:web:local.example')
  })

  it('an identity.did that is not a did:plc or did:web is not published', () => {
    const doc = buildCore(withFederation({ identity: { ...IDENTITY, did: 'https://x.example/me' } })).files['federation.json'] as any
    expect(doc).not.toHaveProperty('did')
  })

  it('link is an intent, never published', () => {
    const out = buildCore(withFederation({
      identity: IDENTITY,
      peers: [{ name: 'Open Peer', url: 'https://example.org/open', link: 'memberOf', did: 'did:plc:openopenopenopenopenopen' }],
    }))
    const text = JSON.stringify(out.files['federation.json'])
    expect(text).not.toContain('memberOf')
    expect(text).not.toContain('"link"')
  })

  it('carries name, type, daoURI and scope; peer type and trust only when set', () => {
    const out = buildCore(withFederation({
      identity: { ...IDENTITY, scope: 'operational-unit' },
      peers: [{ name: 'P', url: 'https://example.org/p', type: 'LocalNode', trust: 'read' }],
    }))
    expect(out.files['federation.json']).toEqual({
      spec: 'org-os/federation/1', name: 'Test DAO', type: 'DAO', scope: 'operational-unit', daoURI: IDENTITY.daoURI,
      networks: [], peers: [{ name: 'P', url: 'https://example.org/p', type: 'LocalNode', trust: 'read' }],
    })
  })

  it('a hub node: join is published, a local-path where is omitted; a local-path hub is omitted', () => {
    const out = buildCore(withFederation({
      identity: IDENTITY,
      network: 'lf-personal', hub: '../../',
      join: { policy: 'invite', types: ['LocalNode'], where: '../x' },
    }))
    const doc = out.files['federation.json'] as any
    expect(doc.join).toEqual({ policy: 'invite', types: ['LocalNode'], asks: [] })
    expect(doc.networks).toEqual([{ name: 'lf-personal' }])
  })

  it('a public hub and where are kept; join is omitted when there is none', () => {
    const out = buildCore(withFederation({
      identity: IDENTITY,
      networks: [{ name: 'refi', hub: 'https://github.com/ReFiDAO/hub', role: 'member' }],
    }))
    const doc = out.files['federation.json'] as any
    expect(doc.networks).toEqual([{ name: 'refi', hub: 'https://github.com/ReFiDAO/hub', role: 'member' }])
    expect(doc).not.toHaveProperty('join')
  })

  it('a hub or where written github.com/… without a scheme is published as https (final review I2)', () => {
    const out = buildCore(withFederation({
      identity: IDENTITY,
      federation: { networks: [{ name: 'refi', url: 'github.com/ReFi-DAO' }, { name: 'nas', hub: 'https://nas/' }] },
      join: { policy: 'invite', where: 'github.com/org/hub' },
    }))
    const doc = out.files['federation.json'] as any
    expect(doc.networks).toEqual([{ name: 'refi', hub: 'https://github.com/ReFi-DAO' }, { name: 'nas' }])
    expect(doc.join).toEqual({ policy: 'invite', types: [], asks: [], where: 'https://github.com/org/hub' })
  })

  it('with no federation read at all, the file is still built, empty', () => {
    const out = buildCore(fixtureInput())
    expect((out.files['federation.json'] as any).peers).toEqual([])
  })

  it('no daoURI: nothing is built, federation.json included (spec §12 R5)', () => {
    const input = withFederation({ identity: IDENTITY, peers: [{ name: 'P', url: 'https://example.org/p' }] })
    input.identity.daoURI = ''
    expect(buildCore(input).files).toEqual({})
  })

  it('federationDoc tolerates a missing federation', () => {
    expect(federationDoc({ identity: { name: 'N', type: 'T', daoURI: 'https://x.org/d' }, federation: null } as any)).toMatchObject({ peers: [], networks: [] })
  })

  it('a withheld peer is still a secret when its trust is invalid (the warning is not shown)', () => {
    const { secrets, pub } = projectPublic(withFederation({
      identity: IDENTITY, peers: [{ name: 'hidden-local-peer', repo: '../hidden-local-peer', trust: 'bogus' }],
    }))
    expect([...secrets]).toContain('hidden-local-peer')
    expect(JSON.stringify(pub.federation)).not.toMatch(/hidden-local-peer|bogus/)
  })

  it("a published peer's repo path and relationship are secrets", () => {
    const { secrets } = projectPublic(withFederation({
      identity: IDENTITY,
      peers: [{ name: 'Pub', url: 'https://example.org/p', repo: '../secret-local-repo', relationship: 'sovereign-counterpart' }],
    }))
    expect([...secrets]).toEqual(expect.arrayContaining(['../secret-local-repo', 'sovereign-counterpart']))
  })

  it('the leak scan stops a withheld peer name that slipped into a doc', () => {
    const out = buildCore(withFederation({ identity: IDENTITY, peers: [{ name: 'local-only-peer', repo: '../local-only-peer' }] }), {
      afterProject(pub) { pub.extras.projects.push({ id: 'x', name: 'local-only-peer' }) },
    })
    expect(out.files).toEqual({})
    expect(out.problems.some(p => p.level === 'error' && /withheld value/.test(p.text))).toBe(true)
  })

  it('a public record named like a local-only peer does not empty the files, and the peer is not published', () => {
    const input = withFederation({ identity: IDENTITY, peers: [{ name: 'sibling-experiment', repo: '../sibling-experiment' }] })
    ;(input.records.projects as any[]).push({ id: 'sibling-experiment', name: 'sibling-experiment', status: 'active', visibility: 'public' })
    const out = buildCore(input)
    expect(Object.keys(out.files).length).toBeGreaterThan(1)
    expect((out.files['federation.json'] as any).peers).toEqual([])
    expect(JSON.stringify(out.files['projects.json'])).toMatch(/sibling-experiment/)
  })
})
