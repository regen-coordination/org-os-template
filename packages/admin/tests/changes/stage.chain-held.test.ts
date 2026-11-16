// L7 gap B1: a deployed System is edited like any record but for the fields the chain holds (lib/chain-held.mjs), which
// `validateChange` refuses on every path (stage, Propose, Revise, Apply's backstop, a ratify's rebuild) with one sentence.
// The read-back's own flip (a deployed tree's wearers dropped once its gate registered them, a Safe's on_deploy taken
// out once the composition is whole) passes. Fresh temp repos, placeholders only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from './fixtures.ts'
import { stage, validateChange } from '../../server/changes/stage.ts'
import { applyOps } from '../../server/changes/apply.ts'
import { readRegistry } from '../../server/registry.ts'
import type { StageOp } from '../../server/changes/types.ts'
import { CHAIN_HELD_SENTENCE } from '../../lib/chain-held.mjs'

const SEPOLIA = 'eip155:11155111'
const HAT = (n: number) => `${SEPOLIA}:0x0000002a000${n}${'0'.repeat(52)}`
const A = (n: number) => `0x${'0'.repeat(38)}a${n}`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  decisions: []
  membership:
    tree: "dao-roles"
`
const SYSTEMS = `schema_version: "1.0"
systems:
  - id: "dao-safe"
    kind: "safe"
    name: "Council Safe"
    chain: "${SEPOLIA}"
    address: "0x1111111111111111111111111111111111111111"
    driver: "safe"
    notes: "The council signs here."
    deployment:
      status: "deployed"
      read_back: "2026-11-05"
      on_deploy:
        roles:
          council: { hat: "\${hat.dao-roles/council}" }
    signer_gate:
      hats: ["dao-roles/council"]
      threshold: { type: "absolute", min: 1, target: 2 }
      claimable_for: false
      address: "0x2222222222222222222222222222222222222222"
  - id: "dao-roles"
    kind: "hats-tree"
    name: "Roles"
    chain: "${SEPOLIA}"
    address: "42"
    driver: "hats-tree"
    deployment:
      status: "deployed"
      read_back: "2026-11-05"
    hats:
      - { key: "council", hat: "${HAT(1)}", role: "decides", wearers: ["${SEPOLIA}:${A(1)}"] }
      - { key: "ops", hat: "${HAT(2)}", role: "acts" }
  - id: "dao-votes"
    kind: "snapshot-space"
    name: "Votes"
    url: "https://testnet.snapshot.box/#/s:test-dao.eth"
    space: "test-dao.eth"
    driver: "snapshot-space"
    deployment:
      status: "deployed"
      read_back: "2026-11-05"
      network: "${SEPOLIA}"
  - id: "dao-uri"
    kind: "daouri-registration"
    name: "daoURI"
    chain: "${SEPOLIA}"
    ens: "test-dao.eth"
    deployment:
      status: "deployed"
      read_back: "2026-11-05"
  - id: "hand-safe"
    kind: "safe"
    name: "Registered by hand"
    chain: "${SEPOLIA}"
    address: "0x3333333333333333333333333333333333333333"
    driver: "safe"
`

let repo: string
beforeEach(() => {
  repo = makeSyntheticRepo()
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  git(repo, 'add data/systems.yaml data/governance.yaml')
  git(repo, 'commit -qm "fixture: deployed systems"')
})
afterEach(() => removeFixtureRepo(repo))

const set = (id: string, s: Record<string, unknown>): StageOp => ({ op: 'update', record: `systems:${id}`, set: s })
const current = (id: string) => (readRegistry(repo, 'systems').entries as Record<string, any>[]).find(e => e.id === id)!
const held = (record: string, field: string) => ({ record, field, message: CHAIN_HELD_SENTENCE(field) })
const TRAILERS = { actor: 'bruno', change: 'chg_test', rule: 'solo/direct' }

/** One op per chain-held field of each deployed kind, and the field the refusal names. */
const CHANGES: [string, StageOp, string][] = [
  ['the Safe\'s address', set('dao-safe', { address: '0x4444444444444444444444444444444444444444' }), 'address'],
  ['the Safe\'s chain', set('dao-safe', { chain: 'eip155:1' }), 'chain'],
  ['the Safe\'s other chains', set('dao-safe', { chains: [SEPOLIA, 'eip155:1'] }), 'chains'],
  ['the Safe\'s kind', set('dao-safe', { kind: 'gardens-community' }), 'kind'],
  ['the Safe\'s owners', set('dao-safe', { deployment: { status: 'deployed', read_back: '2026-11-05', owners: [`${SEPOLIA}:${A(9)}`] } }), 'deployment.owners'],
  ['the Safe\'s threshold', set('dao-safe', { deployment: { status: 'deployed', read_back: '2026-11-05', threshold: 3 } }), 'deployment.threshold'],
  ['the Safe\'s read-back date', set('dao-safe', { deployment: { status: 'deployed', read_back: '2026-11-06' } }), 'deployment.read_back'],
  ['the gate\'s wiring', set('dao-safe', { signer_gate: { hats: ['dao-roles/ops'], threshold: { type: 'absolute', min: 1, target: 2 }, claimable_for: false, address: '0x2222222222222222222222222222222222222222' } }), 'signer_gate'],
  ['the gate\'s address', set('dao-safe', { signer_gate: null }), 'signer_gate'],
  ['the tree\'s address', set('dao-roles', { address: '43' }), 'address'],
  ['a hat\'s wearers', set('dao-roles', { hats: [{ key: 'council', hat: HAT(1), role: 'decides', wearers: [`${SEPOLIA}:${A(1)}`, `${SEPOLIA}:${A(2)}`] }, { key: 'ops', hat: HAT(2), role: 'acts' }] }), 'hats'],
  ['a hat\'s ref', set('dao-roles', { hats: [{ key: 'council', hat: HAT(3), role: 'decides', wearers: [`${SEPOLIA}:${A(1)}`] }, { key: 'ops', hat: HAT(2), role: 'acts' }] }), 'hats'],
  ['a hat taken out', set('dao-roles', { hats: [{ key: 'council', hat: HAT(1), role: 'decides', wearers: [`${SEPOLIA}:${A(1)}`] }] }), 'hats'],
  ['the tree\'s top hat', set('dao-roles', { deployment: { status: 'deployed', read_back: '2026-11-05', top: { hat: HAT(4) } } }), 'deployment.top'],
  ['the space\'s id', set('dao-votes', { space: 'other-dao.eth' }), 'space'],
  ['the space\'s address', set('dao-votes', { url: 'https://snapshot.box/#/s:test-dao.eth' }), 'url'],
  ['the space\'s network', set('dao-votes', { deployment: { status: 'deployed', read_back: '2026-11-05', network: 'eip155:1' } }), 'deployment.network'],
  ['the space\'s settings', set('dao-votes', { deployment: { status: 'deployed', read_back: '2026-11-05', network: SEPOLIA, settings: { name: 'Other' } } }), 'deployment.settings'],
  ['the registration\'s name', set('dao-uri', { ens: 'other-dao.eth' }), 'ens'],
  // Review I-2 (probe P2): the driver decides what reads the System, so it is the chain's on every deployed kind.
  ['the Safe\'s driver', set('dao-safe', { driver: 'link' }), 'driver'],
  ['the tree\'s driver', set('dao-roles', { driver: 'link' }), 'driver'],
  ['the space\'s driver taken out', set('dao-votes', { driver: null }), 'driver'],
  ['a driver given to the registration', set('dao-uri', { driver: 'daouri-registration' }), 'driver'],
]

describe('a field the chain holds is refused on a deployed System (B1)', () => {
  it('at stage: 422 with the sentence on that field, and nothing staged', () => {
    for (const [what, op, field] of CHANGES) {
      const { ops, errors } = stage(repo, [], [op])
      expect(ops, what).toEqual([])
      expect(errors, what).toContainEqual(held((op as { record: string }).record, field))
    }
  })

  it('a whole-record replace from the source toggle is judged field by field', () => {
    const { ops, errors } = stage(repo, [], [{ op: 'replace', record: 'systems:dao-safe', value: { ...current('dao-safe'), address: '0x4444444444444444444444444444444444444444', notes: 'Moved.' } }])
    expect(ops).toEqual([])
    expect(errors).toEqual([held('systems:dao-safe', 'address')])
  })

  it('Propose and Revise (validateChange) refuse the same', () => {
    for (const [what, op, field] of CHANGES) expect(validateChange(repo, [op]), what).toContainEqual(held((op as { record: string }).record, field))
  })

  it('Apply\'s backstop refuses it, and nothing is written', async () => {
    const head = git(repo, 'rev-parse HEAD')
    for (const [what, op, field] of CHANGES.slice(0, 3)) {
      await expect(applyOps(repo, [op], { message: 'admin(systems): update', trailers: TRAILERS }), what)
        .rejects.toMatchObject({ errors: expect.arrayContaining([held((op as { record: string }).record, field)]) })
    }
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
  })

  it('setting a deployed System back to composed is said once, as before (PF-R165)', () => {
    const { errors } = stage(repo, [], [set('dao-safe', { deployment: { status: 'composed' } })])
    expect(errors.map(e => `${e.record} ${e.field}`)).toEqual(['systems:dao-safe deployment.status'])
    expect(errors[0]!.message).toMatch(/not written back to composed/)
  })
})

describe('everything else is edited on a deployed System like any record (B1)', () => {
  const EDITS: [string, StageOp][] = [
    ['name, notes and description', set('dao-safe', { name: 'The council', notes: 'Signs the treasury.', description: 'Where the council signs.' })],
    ['relations', set('dao-safe', { relates: [{ to: 'dao-roles', label: 'holds' }] })],
    ['its place on the canvas and in the order', set('dao-safe', { position: { x: 40, y: 80 }, order: 2, section: 'organization/treasury' })],
    ['its on_deploy', set('dao-safe', { deployment: { status: 'deployed', read_back: '2026-11-05' } })],
    ['a tree\'s layers', set('dao-roles', { roles: { [HAT(1)]: 'decides', [HAT(2)]: 'decides' }, role: 'decides' })],
    ['a hat\'s layer', set('dao-roles', { hats: [{ key: 'council', hat: HAT(1), role: 'acts', wearers: [`${SEPOLIA}:${A(1)}`] }, { key: 'ops', hat: HAT(2), role: 'acts' }] })],
    ['a space\'s notes', set('dao-votes', { notes: 'Votes are weekly.' })],
    ['a registration\'s name', set('dao-uri', { name: 'Our daoURI' })],
    ['a System registered by hand, its address included', set('hand-safe', { address: '0x5555555555555555555555555555555555555555', notes: 'Fixed a typo.' })],
  ]
  it('each stages with no error', () => {
    for (const [what, op] of EDITS) expect(stage(repo, [], [op]).errors, what).toEqual([])
  })

  it('a notes, relates and name edit on a deployed Safe applies', async () => {
    await applyOps(repo, [set('dao-safe', { name: 'The council', notes: 'Signs the treasury.', relates: [{ to: 'dao-roles', label: 'holds' }] })], { message: 'admin(systems): update dao-safe', trailers: TRAILERS })
    expect(current('dao-safe')).toMatchObject({ name: 'The council', notes: 'Signs the treasury.', relates: [{ to: 'dao-roles', label: 'holds' }], address: '0x1111111111111111111111111111111111111111' })
  })

  it('a deployed System no governance names is deleted as before', () => {
    expect(stage(repo, [], [{ op: 'delete', record: 'systems:dao-votes' }]).errors).toEqual([])
  })
})

describe('the read-back\'s own flip passes (B1)', () => {
  it('a deployed tree\'s wearers dropped once its gate registered them', () => {
    const op = set('dao-roles', { hats: [{ key: 'council', hat: HAT(1), role: 'decides' }, { key: 'ops', hat: HAT(2), role: 'acts' }] })
    expect(stage(repo, [], [op]).errors).toEqual([])
  })

  it('a deployed Safe\'s on_deploy taken out once its composition is whole', () => {
    const { on_deploy: _done, ...rest } = current('dao-safe').deployment
    expect(stage(repo, [], [set('dao-safe', { deployment: rest })]).errors).toEqual([])
  })
})

describe('judged against the change it joins as well as the trunk (review M-3)', () => {
  it('a System the change already made deployed: a later hand edit of what the chain holds is refused, its notes stage', () => {
    const flip = stage(repo, [], [set('hand-safe', { deployment: { status: 'deployed', read_back: '2026-11-07' } })])
    expect(flip.errors).toEqual([])
    const { ops, errors } = stage(repo, flip.ops, [set('hand-safe', { address: '0x6666666666666666666666666666666666666666' })])
    expect(errors).toEqual([held('systems:hand-safe', 'address')])
    expect(ops).toEqual(flip.ops)
    expect(stage(repo, flip.ops, [set('hand-safe', { notes: 'Read back today.' })]).errors).toEqual([])
  })
})
