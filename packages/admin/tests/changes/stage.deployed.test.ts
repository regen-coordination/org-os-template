// DAO-OS L7 Tasks 19/17 review, I1 (server side): a deployed System is never written back to `composed`, and a System
// that governance or another record names is never deleted from under it. Judged by `validateChange`, which stage,
// Propose, Revise and Apply's backstop (a ratify included) all run; Apply's own delete step refuses too. Fresh temp
// repos, placeholders only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from './fixtures.ts'
import { stage, validateChange } from '../../server/changes/stage.ts'
import { applyOps } from '../../server/changes/apply.ts'
import type { StageOp } from '../../server/changes/types.ts'

const SEPOLIA = 'eip155:11155111'
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  decisions: []
  membership:
    tree: "dao-hats"
  rules:
    - id: treasury
      applies_to: [treasury]
      propose: maintainer
      decide: { by: system, system: "treasury-safe" }
`
const SYSTEMS = `schema_version: "1.0"
systems:
  - id: "dao-hats"
    kind: "hats-tree"
    name: "DAO hats"
    chain: "${SEPOLIA}"
    address: "42"
    driver: "hats-tree"
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
    chain: "${SEPOLIA}"
    address: "0x1111111111111111111111111111111111111111"
    driver: "safe"
  - id: "side-safe"
    kind: "safe"
    name: "Side"
    chain: "${SEPOLIA}"
    address: "0x2222222222222222222222222222222222222222"
    driver: "safe"
    deployment:
      status: "deployed"
  - id: "council-safe"
    kind: "safe"
    name: "Council Safe"
    chain: "${SEPOLIA}"
    deployment:
      status: "composed"
      owners: ["${SEPOLIA}:0x00000000000000000000000000000000000000a1"]
      threshold: 1
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

const composeIt = (id: string): StageOp => ({ op: 'update', record: `systems:${id}`, set: { deployment: { status: 'composed', top: { worn_by: 'council-safe' } } } })
const fieldsOf = (errors: { record: string; field: string }[]) => errors.map(e => `${e.record} ${e.field}`)

describe('a deployed System is never written as composed (review I1)', () => {
  it('the membership tree, which had no deployment, is refused 422 with a sentence at stage; nothing is staged', () => {
    const { ops, errors } = stage(repo, [], [composeIt('dao-hats')])
    expect(ops).toEqual([])
    expect(fieldsOf(errors)).toEqual(['systems:dao-hats deployment.status'])
    expect(errors[0]!.message).toMatch(/deployed/)
  })

  it('a Safe that holds an address, and one whose deployment says deployed, are refused too', () => {
    for (const id of ['treasury-safe', 'side-safe']) {
      const { errors } = stage(repo, [], [{ op: 'update', record: `systems:${id}`, set: { deployment: { status: 'composed', owners: [], threshold: 1 } } }])
      expect(fieldsOf(errors), id).toEqual([`systems:${id} deployment.status`])
    }
    const { errors } = stage(repo, [], [{ op: 'replace', record: 'systems:treasury-safe', value: { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: SEPOLIA, deployment: { status: 'composed' } } }])
    expect(fieldsOf(errors)).toContain('systems:treasury-safe deployment.status')
  })

  it('Propose, Revise and the Apply backstop judge it the same (validateChange)', () => {
    expect(fieldsOf(validateChange(repo, [composeIt('dao-hats')]))).toEqual(['systems:dao-hats deployment.status'])
  })

  it('Apply refuses it and writes nothing', async () => {
    const head = git(repo, 'rev-parse HEAD')
    await expect(applyOps(repo, [composeIt('dao-hats')], { message: 'admin(systems): update dao-hats', trailers: { actor: 'bruno', change: 'chg_test', rule: 'solo/direct' } }))
      .rejects.toMatchObject({ errors: [expect.objectContaining({ record: 'systems:dao-hats', field: 'deployment.status' })] })
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
  })

  it('a composed System keeps being edited as composed', () => {
    const { errors } = stage(repo, [], [{ op: 'update', record: 'systems:council-safe', set: { deployment: { status: 'composed', owners: ['eip155:11155111:0x00000000000000000000000000000000000000a1'], threshold: 1 }, name: 'Council' } }])
    expect(errors).toEqual([])
  })
})

describe('a System that governance names is not deleted (review I1; the Task 2 carry)', () => {
  it('the membership tree and the Safe a rule is decided by are refused, naming governance', () => {
    for (const [id, field] of [['dao-hats', 'membership.tree'], ['treasury-safe', 'decide.system']] as const) {
      const { ops, errors } = stage(repo, [], [{ op: 'delete', record: `systems:${id}` }])
      expect(ops, id).toEqual([])
      expect(errors, id).toHaveLength(1)
      expect(errors[0]!.message, id).toMatch(/^Not deleted: systems "/)
      expect(errors[0]!.message, id).toContain(`(${field})`)
    }
  })

  it('Apply refuses it too, and writes nothing', async () => {
    const head = git(repo, 'rev-parse HEAD')
    await expect(applyOps(repo, [{ op: 'delete', record: 'systems:dao-hats' }], { message: 'admin(systems): delete dao-hats', trailers: { actor: 'bruno', change: 'chg_test', rule: 'solo/direct' } }))
      .rejects.toMatchObject({ status: 409 })
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
  })

  it('a System no one names is deleted as before', () => {
    expect(stage(repo, [], [{ op: 'delete', record: 'systems:side-safe' }]).errors).toEqual([])
  })
})
