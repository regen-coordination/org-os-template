import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRepo, type Problem } from '../../lib/data-validate.mjs'

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function instance(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-rules-'))
  made.push(dir)
  mkdirSync(join(dir, 'data'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'data', name), text)
  return dir
}
const level = (ps: Problem[], l: string) => ps.filter(p => p.level === l)

// ana has a git handle: since L5 (§7.6) written rules need someone in each propose role who can act.
const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: ana@example.invalid } }
  - { id: bruno, name: Bruno }
  - { id: crew-engineer, name: Engineer seat, kind: agent }
`
const SYSTEMS = `systems:
  - { id: treasury-safe, kind: safe, name: Treasury, chain: "eip155:42220", address: "0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60" }
`
// Architecture §4.5, with the remaining classes covered by a catch-all.
const RULES = `governance:
  model: consensus
  description: Consent with an objection window
  roles:
    maintainer: { members: [ana, bruno] }
    member: { all: true }
  rules:
    - id: records
      applies_to: [records]
      propose: member
      decide: { by: maintainer, method: approve, count: 1 }
    - id: governance
      applies_to: [governance, members, identity, systems, publication]
      propose: maintainer
      decide: { by: maintainer, method: consent, window: P7D }
    - id: treasury
      applies_to: [treasury]
      propose: maintainer
      decide: { by: system, system: treasury-safe }
    - id: rest
      applies_to: [operations]
      propose: maintainer
      decide: { by: maintainer, method: direct }
`

describe('validateRepo reads roles and rules', () => {
  it('passes the architecture example', () => {
    expect(validateRepo(instance({ 'governance.yaml': RULES, 'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS }))).toEqual([])
  })
  it('passes roles: [] (the template shape) and no rules', () => {
    expect(level(validateRepo(instance({ 'governance.yaml': 'governance:\n  model: solo-maintainer\n  roles: []\n  decisions: []\n', 'members.yaml': MEMBERS })), 'error')).toEqual([])
  })
  it('fails a rule that names a role nobody defined, in data/governance.yaml, with its path', () => {
    const text = RULES.replace('propose: member', 'propose: steward')
    const errors = level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS })), 'error')
    expect(errors).toEqual([{ file: 'data/governance.yaml', path: 'rules.records.propose', level: 'error',
      message: 'rule "records": propose names the role "steward", and roles defines none by that name' }])
  })
  it('fails an agent as a decider', () => {
    const text = RULES.replace('maintainer: { members: [ana, bruno] }', 'maintainer: { members: [ana, crew-engineer] }')
    const errors = level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS })), 'error')
    expect(errors.map(p => p.message)).toContain('rule "records": role "maintainer" lists the agent "crew-engineer", and an agent never decides; take it out of the role, or decide by another role')
  })
  it('fails a role that lists a member the members file does not hold, and a rule naming a system the file lacks', () => {
    const text = RULES.replace('[ana, bruno]', '[ana, ghost]')
    const errors = level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS })), 'error').map(p => p.message)
    expect(errors).toContain('role "maintainer" lists "ghost", who is not in data/members.yaml')
    expect(errors).toContain('rule "treasury": decide.system names "treasury-safe", and data/systems.yaml has no system by that id')
  })
  it('does not judge members or systems it could not read', () => {
    const errors = level(validateRepo(instance({ 'governance.yaml': RULES, 'members.yaml': 'members: [\n', 'systems.yaml': 'systems: [\n' })), 'error')
    expect(errors.map(p => p.file)).toEqual(['data/members.yaml', 'data/systems.yaml'])
  })
  it('warns, never fails, about a class no rule covers', () => {
    const text = RULES.replace(/    - id: rest[\s\S]*$/, '')
    const ps = validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS }))
    expect(level(ps, 'error')).toEqual([])
    expect(level(ps, 'warn').map(p => p.message)).toEqual(['no rule covers the class operations: nobody can apply a change of that class directly until a rule does'])
  })
  it('accepts the decision fields the platform will write (outcome, proposal, rule, method, by)', () => {
    const text = `governance:\n  model: consensus\n  decisions:\n    - { id: gov-1, title: T, date: "2026-10-18", status: ratified, proposal: p-1, rule: records, method: approve, outcome: ratified, by: [bruno], summary: S }\n`
    expect(level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS })), 'error')).toEqual([])
  })
  it('fails a decision outcome that is not ratified, rejected or expired', () => {
    const text = `governance:\n  model: consensus\n  decisions:\n    - { id: gov-1, title: T, date: "2026-10-18", status: ratified, outcome: passed }\n`
    const errors = level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS })), 'error')
    expect(errors.map(p => p.path)).toEqual(['decisions.0.outcome'])
  })
  // DAO-OS L5 Task 3: roles sourced from a hat, the membership tree, and rules that leave nobody able to propose.
  it('passes a role sourced from a hat of the membership tree (the schema takes { hat } and membership)', () => {
    const text = RULES.replace('  roles:\n', '  membership: { tree: hats-main }\n  roles:\n    council: { hat: "eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000" }\n')
      .replace('propose: maintainer\n      decide: { by: maintainer, method: consent', 'propose: council\n      decide: { by: council, method: consent')
    expect(text).toContain('propose: council')
    const systems = SYSTEMS + '  - { id: hats-main, kind: hats-tree, name: Hats, chain: "eip155:42220", address: "13" }\n'
    expect(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS, 'systems.yaml': systems }))).toEqual([])
  })
  it('fails rules whose propose role holds nobody with a git or wallet handle, with the §7.6 sentence', () => {
    const text = RULES.replace('maintainer: { members: [ana, bruno] }', 'maintainer: { members: [bruno] }')
    const errors = level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS })), 'error')
    expect(errors).toContainEqual({ file: 'data/governance.yaml', path: 'rules.governance.propose', level: 'error',
      message: "rule governance: nobody can propose under it. The maintainer role has no member with a git or wallet handle and is not sourced from a hat. Add a handle first (the owner's claim: §8.1)." })
    expect(errors.map(p => p.path)).toEqual(['rules.governance.propose', 'rules.treasury.propose', 'rules.rest.propose'])
  })
  it('judges an unwrapped governance file the same way', () => {
    const text = RULES.replace('governance:\n', '').replace(/^  /gm, '')
    expect(level(validateRepo(instance({ 'governance.yaml': text, 'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS })), 'error')).toEqual([])
  })
})
