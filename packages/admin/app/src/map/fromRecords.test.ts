import { describe, it, expect } from 'vitest'
import type { Resource } from '../api.ts'
import { EDGE_WORDS, daoMapOf, derivedLinks, hatNumber, mainSafeOfResources, mapItemOf, mapLinksOf, mapNodesOf, portalNode, relatesOf } from './fromRecords.ts'
import { layerOf, layoutMap, mainSafeOf } from './layers.ts'
import { resource } from '../test/data.ts'
import { restrictedHat } from '../record/restricted.ts'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import {
  COUNCIL_SAFE, GARDEN, LOCAL_STARTER, NETWORK_PROJECTS, OPS_WALLET, ROLES, SYSTEMS, TREASURY_SYSTEM, VOTES, hatRefOf,
} from '../test/fixtures/house/systems.ts'

const entryOf = (entries: Record<string, Record<string, unknown>> = {}) => (r: Resource) => entries[r.source?.entityId ?? ''] ?? null

describe('mapItemOf: a Resource as a map item', () => {
  it('takes a System’s driver kind and its section: a Safe in organization/treasury is layer 2, the main Safe', () => {
    const item = mapItemOf(TREASURY_SYSTEM, null)
    expect(item).toMatchObject({ id: 'system:treasury', kind: 'safe', name: 'Treasury', section: 'organization/treasury' })
    expect(item.facts).toBe(TREASURY_SYSTEM.facts)
    expect(layerOf(item)).toBe(2)
    // both Safes are in the treasury: the one more edges point at is the main one (the signer hat signs the Treasury)
    expect(mainSafeOf([mapItemOf(COUNCIL_SAFE, null), item, { id: hatRefOf(1, 1), kind: 'hat', name: 'Treasury signer' }], derivedLinks(SYSTEMS))).toBe('system:treasury')
  })

  it('reads the kind and section from the entry first, as the systems adapter passes them on', () => {
    expect(mapItemOf(TREASURY_SYSTEM, { kind: 'safe', section: 'treasury' }).section).toBe('treasury')
    const bare = resource({ id: 'system:x', kind: 'system', name: 'X', status: 'safe', facts: {} })
    expect(mapItemOf(bare, null).kind).toBe('safe')                                 // the status, when the facts say no kind
    expect(mapItemOf(resource({ id: 'system:y', kind: 'system', status: null, facts: {} }), null).kind).toBe('system')
  })

  it('a 0.6 record keeps its own kind, and carries its own visibility key (CC-14)', () => {
    const r = { ...resource({ id: 'project:p' }), visibility: { level: 'public' } } as Resource
    expect(mapItemOf(r, null)).toMatchObject({ id: 'project:p', kind: 'project', visibility: { level: 'public' } })
  })

  // A2 (fix wave): the node printed a name the viewer is not admitted to (rule 3, E-70).
  it('a restricted name reads "<hat> only", and carries the word for the node to draw as a restricted field', () => {
    const r = resource({ id: 'person:p', kind: 'person', name: 'Steward C' })
    const item = mapItemOf(r, { restricted: { name: 'hat:ops' } }, level => restrictedHat(level, FIXTURE_SOURCE))
    expect(item.name).toBe('Ops only')
    expect(item.nameKept).toBe('Ops')
    // with no source to name the hat by, the level itself is the word: never the value
    expect(mapItemOf(r, { restricted: { name: 'hat:ops' } }).name).toBe('hat:ops only')
    expect(mapItemOf(r, { restricted: { name: 'role:x' } }).nameKept).toBe('role:x')
  })
})

describe('mapLinksOf: the 0.6 edges in plain words (§8.4)', () => {
  it('says each 0.6 edge kind in words, and a held-by edge from the holder', () => {
    const links = mapLinksOf([
      { from: 'project:a', to: 'person:b', kind: 'lead' }, { from: 'project:a', to: 'person:c', kind: 'member' },
      { from: 'system:safe', to: 'person:org', kind: 'held-by' }, { from: 'funding:f', to: 'project:a', kind: 'funds' },
      { from: 'proposal:p', to: 'person:b', kind: 'proposed-by' }, { from: 'x:a', to: 'x:b', kind: 'some-new-kind' },
    ])
    expect(links).toEqual([
      { from: 'project:a', to: 'person:b', label: 'leads' }, { from: 'project:a', to: 'person:c', label: 'includes' },
      { from: 'person:org', to: 'system:safe', label: 'holds' }, { from: 'funding:f', to: 'project:a', label: 'funds' },
      { from: 'proposal:p', to: 'person:b', label: 'proposed by' }, { from: 'x:a', to: 'x:b', label: 'some new kind' },
    ])
    for (const w of ['elects', 'appoints', 'includes', 'holds', 'signs', 'admin', 'pool']) expect(Object.values(EDGE_WORDS)).toContain(w)
  })

  it('drops a duplicate pair, the first winning, and a link to itself (E-37)', () => {
    expect(mapLinksOf([
      { from: 'a:1', to: 'b:1', kind: 'lead' }, { from: 'a:1', to: 'b:1', kind: 'member' }, { from: 'a:1', to: 'a:1', kind: 'lead' },
    ])).toEqual([{ from: 'a:1', to: 'b:1', label: 'leads' }])
  })
})

describe('derivedLinks: what the chain gives (E-38)', () => {
  const links = derivedLinks(SYSTEMS)
  it('signs: the hat whose wearers are exactly a Safe’s owners signs it, "signs 4 of 8"', () => {
    expect(links).toContainEqual({ from: hatRefOf(1, 1), to: TREASURY_SYSTEM.id, label: 'signs 4 of 8' })
  })
  it('holds: the System at the address that wears the top hat holds it', () => {
    expect(links).toContainEqual({ from: TREASURY_SYSTEM.id, to: hatRefOf(), label: 'holds' })
  })
  it('admin: the Safe a Gardens community or pool names as its councilSafe', () => {
    expect(links).toContainEqual({ from: COUNCIL_SAFE.id, to: NETWORK_PROJECTS.id, label: 'admin' })
    expect(links).toContainEqual({ from: COUNCIL_SAFE.id, to: GARDEN.id, label: 'admin' })
  })
  it('pool: a Gardens community to each pool that names it', () => {
    expect(links).toContainEqual({ from: GARDEN.id, to: NETWORK_PROJECTS.id, label: 'pool' })
    expect(links).toContainEqual({ from: GARDEN.id, to: LOCAL_STARTER.id, label: 'pool' })
  })
  it('signs: every owner wears the hat, and a wearer with no seat yet does not take the edge away (owners ⊆ wearers, M-1)', () => {
    const roles = structuredClone(ROLES)
    const hats = (roles.facts.driver as { facts: { hats: { id: string; holders: string[] }[] } }).facts.hats
    const signer = hats.find(h => h.id === hatRefOf(1, 1))!
    signer.holders = [...signer.holders, 'eip155:42220:0x00000000000000000000000000000000000000ee']
    const links = derivedLinks(SYSTEMS.map(r => (r.id === ROLES.id ? roles : r)))
    expect(links).toContainEqual({ from: hatRefOf(1, 1), to: TREASURY_SYSTEM.id, label: 'signs 4 of 8' })
    // a hat worn by only some of the owners signs nothing
    signer.holders = signer.holders.slice(0, 3)
    expect(derivedLinks(SYSTEMS.map(r => (r.id === ROLES.id ? roles : r))).filter(k => k.label.startsWith('signs'))).toEqual([])
  })

  it('gives nothing for a hat whose wearers are only some of the owners, or for Systems with no read', () => {
    expect(links.filter(k => k.label.startsWith('signs'))).toHaveLength(1)
    expect(derivedLinks([OPS_WALLET, VOTES])).toEqual([])
  })
})

describe('relates and roles in systems.yaml (E-38)', () => {
  it('relates: each entry’s own relation, by a System id, a system: id or a hat ref; an unknown label is left out', () => {
    const entry = { relates: [{ to: 'roles', label: 'elects' }, { to: hatRefOf(2), label: 'appoints' }, { to: 'system:garden', label: 'pool' }, { to: 'x', label: 'befriends' }] }
    expect(relatesOf(VOTES, entry)).toEqual([
      { from: VOTES.id, to: 'system:roles', label: 'elects' }, { from: VOTES.id, to: hatRefOf(2), label: 'appoints' }, { from: VOTES.id, to: 'system:garden', label: 'pool' },
    ])
    const links = mapLinksOf([], { resources: SYSTEMS, entryOf: entryOf({ votes: entry }) })
    expect(links).toContainEqual({ from: VOTES.id, to: hatRefOf(2), label: 'appoints' })
  })

  it('a relation the chain already gives keeps the chain’s label: the first wins', () => {
    const links = mapLinksOf([], { resources: SYSTEMS, entryOf: entryOf({ 'council-safe': { relates: [{ to: 'garden', label: 'pool' }] } }) })
    expect(links.filter(k => k.from === COUNCIL_SAFE.id && k.to === GARDEN.id)).toEqual([{ from: COUNCIL_SAFE.id, to: GARDEN.id, label: 'admin' }])
  })

  it('roles: a hats-tree’s hats in their layer — decides at the top, acts below; the tree is drawn by its hats', () => {
    const roles = { [hatRefOf(1)]: 'decides', [hatRefOf(2)]: 'acts' }
    const { items } = daoMapOf(SYSTEMS, entryOf({ roles: { roles } }))
    const council = items.find(i => i.id === hatRefOf(1))!
    expect(council).toMatchObject({ kind: 'hat', name: 'Steward Council', role: 'decides' })
    expect(council.facts).toBe(ROLES.facts) // a tree the viewer may not read takes its hats with it
    expect(layerOf(council)).toBe(0)
    expect(layerOf(items.find(i => i.id === hatRefOf(2))!)).toBe(1)
    expect(items.find(i => i.id === hatRefOf(1, 1))).toBeTruthy() // reached by "signs"
    expect(items.find(i => i.id === ROLES.id)).toBeUndefined()
  })

  it('a tree none of whose hats is named or reached is drawn itself', () => {
    const { items } = daoMapOf([ROLES], entryOf())
    expect(items.map(i => i.id)).toEqual([ROLES.id])
  })
})

describe('the DAO map of the house’s Systems', () => {
  it('lays the Treasury out big at the centre of layer 2, the main Safe', () => {
    const { items, links } = daoMapOf(SYSTEMS, entryOf())
    const layout = layoutMap(items, links, { width: 1200 })
    expect(layout.mainSafe).toBe(TREASURY_SYSTEM.id)
    expect(layout.nodes.find(n => n.id === TREASURY_SYSTEM.id)).toMatchObject({ big: true, layer: 2 })
    expect(mainSafeOfResources(SYSTEMS, entryOf())?.id).toBe(TREASURY_SYSTEM.id)
  })

  it('a Safe whose read failed never wins the main Safe’s tie (walk 2026-11-04, L4c-fix 1)', () => {
    // Reserve sorts before Treasury by name, and nothing points at either: the tie goes to the Safe that was read
    const bare = { ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts } }
    const reserve: Resource = { ...bare, id: 'system:reserve', name: 'Reserve', source: { ...bare.source!, entityId: 'reserve' },
      facts: { ...bare.facts, driver: { ok: false, state: 'failed', readAt: null, error: 'safe service answered 503', facts: {}, sections: [] } } }
    expect(mapItemOf(reserve, null)).toMatchObject({ id: 'system:reserve', failed: true })
    expect(mapItemOf(TREASURY_SYSTEM, null)).not.toHaveProperty('failed')
    expect(mainSafeOfResources([reserve, bare], entryOf())?.id).toBe(TREASURY_SYSTEM.id)
    expect(mainSafeOfResources([bare, reserve], entryOf())?.id).toBe(TREASURY_SYSTEM.id)
  })

  it('a Safe whose read failed is never the main Safe while any Safe was read, though more edges point at it (review I-1)', () => {
    // Reserve failed and one project points at it; nothing points at Treasury: Treasury is still the main Safe
    const reserve = mapItemOf({ ...TREASURY_SYSTEM, id: 'system:reserve', name: 'Reserve', source: { ...TREASURY_SYSTEM.source!, entityId: 'reserve' },
      facts: { ...TREASURY_SYSTEM.facts, driver: { ok: false, state: 'failed', readAt: null, error: '503', facts: {}, sections: [] } } }, null)
    const treasury = mapItemOf(TREASURY_SYSTEM, null)
    const project = { id: 'project:p1', kind: 'project', name: 'P1' }
    const links = [{ from: 'project:p1', to: 'system:reserve', label: 'funds' }]
    expect(mainSafeOf([reserve, treasury, project], links)).toBe(TREASURY_SYSTEM.id)
    // with every Safe failed, the rule is as before: the most edges
    const failedToo = { ...treasury, failed: true as const }
    expect(mainSafeOf([reserve, failedToo, project], links)).toBe('system:reserve')
  })

  it('draws each node’s facts from its read and its state (E-46)', () => {
    const { items } = daoMapOf(SYSTEMS, entryOf())
    const nodes = new Map(mapNodesOf(items, SYSTEMS, FIXED_NOW).map(n => [n.item.id, n]))
    expect(nodes.get(TREASURY_SYSTEM.id)).toMatchObject({ facts: '4 of 8 · 7 chains', states: [] })
    expect(nodes.get(VOTES.id)!.facts).toBe('Snapshot · Ethereum')
    expect(nodes.get(GARDEN.id)).toMatchObject({ facts: 'couldn’t read · 2 h', states: ['failed'] })
    expect(nodes.get(NETWORK_PROJECTS.id)!.facts).toBe('1,271 USDGLO')
    expect(nodes.get(LOCAL_STARTER.id)).toMatchObject({ facts: '3,100 USDGLO · 38 min', states: ['aged'] })
    expect(nodes.get(COUNCIL_SAFE.id)!.states).toEqual(['reading'])
    expect(nodes.get(OPS_WALLET.id)).toMatchObject({ facts: 'etherscan.io', states: ['linked'] })
    expect(nodes.get(hatRefOf(1, 1))!.facts).toBe('hat 13.1.1 · 8 wear it')
  })

  // R2 (fix wave): a node's facts line was the record's status, unmasked, while the table masked the same field.
  it('masks a restricted status on a node’s facts line, as the table does (rule 3, E-70)', () => {
    const r = resource({ id: 'person:p1', kind: 'person', name: 'P', status: 'draft', facts: {} })
    const items = [mapItemOf(r, null)]
    const nodes = mapNodesOf(items, [r], FIXED_NOW, { restricted: () => ({ status: 'hat:ops' }), hatOf: level => restrictedHat(level, FIXTURE_SOURCE) })
    expect(nodes[0]!.facts).toBe('')
    expect(nodes[0]!.factsKept).toBe('Ops')
    // no source to name the hat by: the level itself, never the value
    expect(mapNodesOf(items, [r], FIXED_NOW, { restricted: () => ({ status: 'hat:ops' }) })[0]!.factsKept).toBe('hat:ops')
    // a status the viewer is admitted to prints as it is, and carries no kept word
    expect(mapNodesOf(items, [r], FIXED_NOW, { restricted: () => ({}) })[0]).toMatchObject({ facts: 'draft' })
    expect(mapNodesOf(items, [r], FIXED_NOW)[0]!.factsKept).toBeUndefined()
  })

  it('a hat no one wears is an empty hat; a staged record is staged; a neighbour dimmed', () => {
    const empty = hatRefOf(2, 3)
    const nodes = mapNodesOf([{ id: empty, kind: 'hat', name: 'Regional coordinator' }, { id: 'project:p1', kind: 'project', name: 'P' }],
      [ROLES, resource()], FIXED_NOW, { staged: id => id === 'project:p1', faint: new Set([empty]) })
    expect(nodes[0]!.states).toEqual(['empty-hat', 'dim'])
    expect(nodes[1]).toMatchObject({ facts: 'develop', states: ['staged'] })
  })

  it('says a hat by its number, each part in decimal', () => {
    expect(hatNumber('0x0000000d.0001.0001')).toBe('13.1.1')
    expect(hatNumber('not-a-hat')).toBe('not-a-hat')
  })

  it('a 0.6 portal is the linked-node variant, "on <map>"', () => {
    expect(portalNode({ id: 'portal:systems', toBoard: 'systems', text: '1 link', targets: [] }))
      .toEqual({ item: { id: 'portal:systems', kind: 'link', name: '1 link', facts: {} }, facts: 'on Systems map', states: ['linked'] })
  })
})
