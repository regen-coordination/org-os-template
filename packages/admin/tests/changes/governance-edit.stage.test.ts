// DAO-OS L7-D10: staging and applying an edit of data/governance.yaml's roles and rules.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { stage } from '../../server/changes/stage.ts'
import { applyOps } from '../../server/changes/apply.ts'
import { currentOf } from '../../server/changes/stage.ts'

const RULES = `# Test DAO
schema_version: "2.0"
governance:
  model: steward-council
  roles:
    stewards: { members: [steward-a] }
  rules:
    - id: members
      applies_to: [records, members, governance, identity, systems, treasury, operations, publication]
      propose: stewards
      decide: { by: stewards, method: direct }
`
const NOBODY = 'rule members: nobody can propose under it. The stewards role has no member with a git or wallet handle and is not sourced from a hat. ' +
  "Add a handle first (the owner's claim: §8.1)."
const REC = 'governance:governance'

let repo: string
beforeEach(() => { repo = makeChangeRepo(RULES) })
afterEach(() => removeFixtureRepo(repo))

describe('stage: governance:governance', () => {
  it('refuses a field other than roles and rules', () => {
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: REC, set: { model: 'x' } }])
    expect(ops).toEqual([])
    expect(errors).toEqual([{ record: REC, field: '', message: 'Only roles and rules of data/governance.yaml are edited here.' }])
  })

  it('refuses an op that is not an update of the record', () => {
    expect(stage(repo, [], [{ op: 'delete', record: REC }]).errors[0]?.message).toBe('Only roles and rules of data/governance.yaml are edited here.')
    expect(stage(repo, [], [{ op: 'update', record: 'governance:other', set: { roles: {} } }]).errors[0]?.message)
      .toBe('Only roles and rules of data/governance.yaml are edited here.')
  })

  it('refuses rules that checkGovernance refuses, with its sentence', () => {
    const { errors } = stage(repo, [], [{ op: 'update', record: REC, set: { rules: [{ id: 'members', applies_to: ['records'], propose: 'ghosts', decide: { by: 'stewards', method: 'direct' } }] } }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ record: REC })
    expect(errors[0]!.message).toMatch(/ghosts/)
  })

  it('refuses a roles set that leaves nobody able to propose, with the section 7.6 sentence', () => {
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: REC, set: { roles: { stewards: { members: ['ana'] } } } }])
    expect(ops).toEqual([])
    expect(errors).toEqual([{ record: REC, field: '', message: NOBODY }])
  })

  it('stages a valid set; its base is the roles and rules as the file holds them', () => {
    const roles = { stewards: { members: ['steward-a', 'ana'] } }
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: REC, set: { roles } }])
    expect(errors).toEqual([])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'update', record: REC, set: { roles }, before: { roles: { stewards: { members: ['steward-a'] } } } })
    expect(currentOf(repo, REC)).not.toHaveProperty('id')
  })
})

describe('apply: governance:governance', () => {
  it('applies a valid set as one commit under the governance rule, keeping the other bytes, and the validator passes', async () => {
    const roles = { stewards: { members: ['steward-a', 'ana'] } }
    const { ops } = stage(repo, [], [{ op: 'update', record: REC, set: { roles } }])
    const before = git(repo, 'rev-list --count HEAD').trim()
    const { commit } = await applyOps(repo, ops, {
      message: 'admin(governance): update governance',
      trailers: { actor: 'steward-a', change: 'chg_test', rule: 'members/direct' },
    })
    expect(commit).toBe(git(repo, 'rev-parse HEAD').trim())
    expect(Number(git(repo, 'rev-list --count HEAD').trim())).toBe(Number(before) + 1)
    expect(git(repo, 'show --name-only --pretty=format: HEAD').trim()).toBe('data/governance.yaml')
    const text = readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')
    expect(text.startsWith('# Test DAO\nschema_version: "2.0"\ngovernance:\n  model: steward-council\n  roles:\n')).toBe(true)
    expect(text).toContain('- steward-a')
    expect(text).toContain('- ana')
    expect(text).toContain('  rules:\n    - id: members\n      applies_to: [records, members, governance, identity, systems, treasury, operations, publication]\n')
    expect(git(repo, 'status --porcelain')).toBe('')
    const run = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: REAL_REPO, encoding: 'utf8' })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })
})
