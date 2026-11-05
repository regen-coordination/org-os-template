// DAO-OS L5 Task 11 (F-L3-1, spec §7.6 and §8.1 point 4): nothing writes rules that lock an org out. data/governance.yaml
// is a document registry and is never staged entry by entry, so the change that can lock an org out at stage is one to
// the members (or the systems) the written rules are judged with: it is refused with the §7.6 sentence. Placeholders only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo } from './fixtures.ts'
import { stage } from '../../server/changes/stage.ts'

const RULES = `schema_version: "2.0"
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

let repo: string
afterEach(() => removeFixtureRepo(repo))

describe('stage refuses a change that would leave nobody able to propose (L5 spec §7.6)', () => {
  beforeEach(() => { repo = makeChangeRepo(RULES) })

  it('taking the last handle off the only proposer is refused, with the §7.6 sentence, and nothing is staged', () => {
    const { ops, errors } = stage(repo, [], [{ op: 'update', record: 'members:steward-a', set: { handles: { github: 'steward-a' } } }])
    expect(ops).toEqual([])
    expect(errors).toEqual([{ record: 'members:steward-a', field: '', message: NOBODY }])
  })

  it('the same change passes when, in the same change, another proposer gains a handle', () => {
    removeFixtureRepo(repo)
    repo = makeChangeRepo(RULES.replace('[steward-a]', '[steward-a, ana]'))
    const { errors } = stage(repo, [], [
      { op: 'update', record: 'members:ana', set: { handles: { git: 'ana@example.invalid' } } },
      { op: 'update', record: 'members:steward-a', set: { handles: { github: 'steward-a' } } },
    ])
    expect(errors).toEqual([])
  })

  it('a change that does not touch who can propose is not refused', () => {
    expect(stage(repo, [], [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }]).errors).toEqual([])
    expect(stage(repo, [], [{ op: 'update', record: 'members:ana', set: { role: 'Contributor and editor' } }]).errors).toEqual([])
  })
})

describe('an org that is locked out already', () => {
  beforeEach(() => { repo = makeChangeRepo(RULES.replace('[steward-a]', '[ana]')) })

  it('is not refused again for what the change did not bring', () => {
    expect(stage(repo, [], [{ op: 'update', record: 'members:ana', set: { role: 'Contributor and editor' } }]).errors).toEqual([])
  })
})
