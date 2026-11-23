import { it, expect, describe } from 'vitest'
import { readFederation, JOIN_POLICIES } from '../../lib/federation/read.mjs'

it('reads legacy network + hub as a string into one network', () => {
  expect(readFederation({ network: 'regen-coordination', hub: 'https://hub.regencoordination.xyz/' }).networks)
    .toEqual([{ name: 'regen-coordination', hub: 'https://hub.regencoordination.xyz/', role: null }])
})
it('reads legacy hub as an object {name, repo}', () => {
  expect(readFederation({ network: 'lf-personal', hub: { name: 'LF Zettelkasten OS', repo: '../../' } }).networks)
    .toEqual([{ name: 'lf-personal', hub: '../../', role: null }])
})
it('prefers networks over network/hub and warns once', () => {
  const r = readFederation({ network: 'old', networks: [{ name: 'refi-dao', hub: 'https://github.com/ReFiDAO/refi-dao-os', role: 'node' }] })
  expect(r.networks.map(n => n.name)).toEqual(['refi-dao'])
  expect(r.problems).toEqual([{ level: 'warn', text: 'federation.yaml: network and hub are ignored because networks is set.' }])
})
it('no network at all gives an empty list and no problem', () => {
  expect(readFederation({ identity: { name: 'X' } })).toMatchObject({ networks: [], peers: [], join: null, problems: [] })
})
it('keeps every peer with a name, in order, with its index; skips and warns on one without', () => {
  const r = readFederation({ peers: [
    { name: 'ReFi DAO', repo: '../refi-dao-os', url: 'https://github.com/ReFiDAO/refi-dao-os', trust: 'read', relationship: 'network-seat' },
    { repo: 'x/y' },
    { name: 'altiplano', repo: 'repos/altiplano', url: 'https://github.com/a/altiplano', trust: 'read', visibility: 'private' },
  ] })
  expect(r.peers.map(p => [p.index, p.name, p.private])).toEqual([[0, 'ReFi DAO', false], [2, 'altiplano', true]])
  expect(r.peers[0]).toMatchObject({ ref: '../refi-dao-os', relationship: 'network-seat', since: null, decision: null })
  expect(r.problems).toEqual([{ level: 'warn', text: 'federation.yaml: peers #2 has no name; it is skipped.' }])
})
it("accepts trust read-write (real instances use it) and warns on a value it doesn't know", () => {
  const r = readFederation({ peers: [{ name: 'A', trust: 'read-write' }, { name: 'B', trust: 'admin' }] })
  expect(r.peers.map(p => p.trust)).toEqual(['read-write', 'admin'])
  expect(r.problems).toEqual([{ level: 'warn', text: 'federation.yaml: peer "B" has trust "admin"; expected one of full, read, read-write, none.' }])
})
it('reads join on a hub node', () => {
  expect(readFederation({ join: { policy: 'open-with-approval', types: ['LocalNode'], asks: ['operator', 'portal'], where: 'https://github.com/ReFiDAO/refi-dao-os' } }).join)
    .toEqual({ policy: 'open-with-approval', types: ['LocalNode'], asks: ['operator', 'portal'], where: 'https://github.com/ReFiDAO/refi-dao-os', decision: null })
})
it('drops a join whose policy is unknown, with the four policies named', () => {
  const r = readFederation({ join: { policy: 'maybe' } })
  expect(r.join).toBeNull()
  expect(r.problems[0]!.text).toBe(`federation.yaml: join.policy "maybe" is not one of ${JOIN_POLICIES.join(', ')}; join is ignored.`)
})
it('reads a non-object document as empty', () => {
  expect(readFederation(null)).toMatchObject({ identity: {}, networks: [], peers: [], join: null })
})

// Final review C1: the framework's own v3 shape nests network, hub, networks (and peers) under `federation:`.
const NESTED = {
  identity: { name: 'Node', daoURI: 'https://node.example.org/.well-known/dao.json' },
  federation: {
    network: 'net-a', hub: 'github.com/net-a-org',
    networks: [
      { name: 'net-a', role: 'primary', url: 'https://github.com/net-a-org' },
      { name: 'net-b', role: 'via net-a', url: 'https://github.com/net-b-org/hub' },
    ],
  },
  peers: [{ name: 'P', repo: 'o/p' }],
}
it('reads networks nested under federation:, with url as the hub, and says to move them up', () => {
  const r = readFederation(NESTED)
  expect(r.networks).toEqual([
    { name: 'net-a', hub: 'https://github.com/net-a-org', role: 'primary' },
    { name: 'net-b', hub: 'https://github.com/net-b-org/hub', role: 'via net-a' },
  ])
  expect(r.peers.map(p => p.name)).toEqual(['P'])
  expect(r.problems.map(p => p.text)).toEqual([
    'federation.yaml: federation.network is read as network; move it to the top level.',
    'federation.yaml: federation.hub is read as hub; move it to the top level.',
    'federation.yaml: federation.networks is read as networks; move it to the top level.',
    'federation.yaml: network and hub are ignored because networks is set.',
  ])
})
it('reads a nested network + hub, and nested peers when there are no top-level ones', () => {
  const r = readFederation({ federation: { network: 'net-a', hub: 'https://hub.example.org/', peers: [{ name: 'Q', url: 'https://q.example.org' }] } })
  expect(r.networks).toEqual([{ name: 'net-a', hub: 'https://hub.example.org/', role: null }])
  expect(r.peers.map(p => [p.index, p.name])).toEqual([[0, 'Q']])
  expect(r.problems.map(p => p.text)).toEqual([
    'federation.yaml: federation.network is read as network; move it to the top level.',
    'federation.yaml: federation.hub is read as hub; move it to the top level.',
    'federation.yaml: federation.peers is read as peers; move it to the top level.',
  ])
})
it('top-level keys win: a nested block is not read when the top level has network, hub or networks', () => {
  const r = readFederation({ network: 'top', hub: 'https://top.example.org', federation: { network: 'nested', hub: 'https://nested.example.org' } })
  expect(r.networks).toEqual([{ name: 'top', hub: 'https://top.example.org', role: null }])
  expect(r.problems).toEqual([])
})
it('a networks item gives its hub as url when there is no hub; hub wins when both are set', () => {
  expect(readFederation({ networks: [{ name: 'a', url: 'https://a.example.org' }, { name: 'b', hub: 'https://b.example.org', url: 'https://x.example.org' }] }).networks)
    .toEqual([{ name: 'a', hub: 'https://a.example.org', role: null }, { name: 'b', hub: 'https://b.example.org', role: null }])
})
it('warns on a networks item with no name, 1-based, and skips it', () => {
  const r = readFederation({ networks: [{ name: 'a' }, { role: 'node' }, 'x'] })
  expect(r.networks.map(n => n.name)).toEqual(['a'])
  expect(r.problems.map(p => p.text)).toEqual([
    'federation.yaml: networks #2 has no name; it is skipped.',
    'federation.yaml: networks #3 has no name; it is skipped.',
  ])
})

const DIDP = 'did:plc:abcdefghijklmnopqrstuvwx'
describe('did, link, requested and join.decision', () => {
  it('reads did and link on a peer, and requested and join.decision', () => {
    const r = readFederation({
      identity: { name: 'X', did: DIDP },
      join: { policy: 'open', decision: 'LD-7' },
      peers: [{ name: 'A', did: 'did:web:a.example.org', link: 'memberOf', requested: 'r-1' }],
    })
    expect(r.identity.did).toBe(DIDP)
    expect(r.peers[0]).toMatchObject({ did: 'did:web:a.example.org', link: 'memberOf', requested: 'r-1' })
    expect(r.join?.decision).toBe('LD-7')
    expect(r.problems).toEqual([])
  })
  it('a peer without them reads as before, with nulls', () => {
    const r = readFederation({ peers: [{ name: 'A' }], join: { policy: 'closed' } })
    expect(r.peers[0]).toMatchObject({ did: null, link: null, requested: null })
    expect(r.join?.decision).toBeNull()
    expect(r.problems).toEqual([])
  })
  it.each(['did:key:z6Mk', 'plc:abc', 'https://example.org/did', 5])('a malformed peer did %s is a warning and reads null', did => {
    const r = readFederation({ peers: [{ name: 'A', did }] })
    expect(r.peers[0]!.did).toBeNull()
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]!.level).toBe('warn')
    expect(r.problems[0]!.text).toContain('peer "A"')
  })
  it('a malformed identity.did is a warning', () => {
    const r = readFederation({ identity: { name: 'X', did: 'did:key:z' } })
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]!.text).toContain('identity.did')
  })
  it('an unknown link value is a warning and reads null', () => {
    const r = readFederation({ peers: [{ name: 'A', link: 'friend' }, { name: 'B', link: 'none' }] })
    expect(r.peers.map(p => p.link)).toEqual([null, 'none'])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]!.text).toContain('link "friend"')
  })
})
