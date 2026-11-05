import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { validateRepo, validateEntry, type Problem } from '../../lib/data-validate.mjs'
import { revOf } from '../../lib/proposals.mjs'

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function instance(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-proposals-'))
  made.push(dir)
  mkdirSync(join(dir, 'data'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'data', name), text)
  return dir
}
const errorsOf = (ps: Problem[]) => ps.filter(p => p.level === 'error').map(p => `${p.file} ${p.id ?? ''} ${p.path}: ${p.message}`.replace(/\s+/g, ' '))

// ana has a git handle: since DAO-OS L5 (§7.6) written rules need someone in each propose role who can act.
const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: ana@example.invalid } }
  - { id: bruno, name: Bruno }
  - { id: carla, name: Carla }
`
const GOVERNANCE = `governance:
  model: consensus
  roles:
    maintainer: { members: [ana, bruno] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
`
const OPS = [{ op: 'update', record: 'projects:alpha', set: { stage: 'develop' }, base: 'a'.repeat(64) }]
const good = () => ({
  id: 'p-2026-10-18-001', title: 'Move one project', author: 'carla', classes: ['records'],
  rules: [{ id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }],
  state: 'open', opened: '2026-10-18T10:02:00-03:00', rev: revOf(OPS), base: '9c1e04a', branch: 'proposal/p-2026-10-18-001', ops: OPS,
  events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'approve', rev: revOf(OPS) }], closed: null,
})
const ledger = (...entries: unknown[]) => stringify({ proposals: entries })
const run = (...entries: unknown[]) => errorsOf(validateRepo(instance({ 'members.yaml': MEMBERS, 'governance.yaml': GOVERNANCE, 'proposals.yaml': ledger(...entries) })))

describe('validateRepo and data/proposals.yaml (P2 Task 1)', () => {
  it('an instance with no file is silent', () => {
    expect(errorsOf(validateRepo(instance({ 'members.yaml': MEMBERS, 'governance.yaml': GOVERNANCE })))).toEqual([])
  })
  it('one good file passes', () => expect(run(good())).toEqual([]))
  // Final review I5: the id the server mints is p-<date>-<NNN>-<4 hex>; the shape before it (no suffix) is still accepted.
  it('an id of the minted shape, p-<date>-<NNN>-<4 hex>, with its branch, passes', () => {
    expect(run({ ...good(), id: 'p-2026-10-18-001-a3f9', branch: 'proposal/p-2026-10-18-001-a3f9' })).toEqual([])
  })
  it('an empty ledger passes', () => expect(run()).toEqual([]))

  it.each([
    ['a state outside the five', { ...good(), state: 'draft' }, /state/],
    ['an unknown field (the shape is closed)', { ...good(), note: 'x' }, /note|additional/i],
    ['an id that is not p-<date>-<NNN>', { ...good(), id: 'my-proposal' }, /pattern/i],
    ['an id whose suffix is not 4 lowercase hex', { ...good(), id: 'p-2026-10-18-001-A3F9' }, /pattern/i],
    ['an id whose suffix is too long', { ...good(), id: 'p-2026-10-18-001-a3f90' }, /pattern/i],
    ['a branch whose suffix is not 4 lowercase hex', { ...good(), branch: 'proposal/p-2026-10-18-001-xyz1' }, /pattern/i],
    ['no ops', (() => { const { ops: _o, ...rest } = good(); return rest })(), /ops/],
    ['an op that is not one of the four', { ...good(), ops: [{ op: 'rename', record: 'projects:alpha' }] }, /op|enum|oneOf|allowed/i],
    ['an event with an unknown kind', { ...good(), events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'shout' }] }, /kind/],
    ['an event with a field no event has', { ...good(), events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'comment', text: 'x', mood: 'happy' }] }, /mood|additional/i],
    ['an objection with no text', { ...good(), events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'object', rev: revOf(OPS) }] }, /text/],
    ['a vote of maybe', { ...good(), events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'vote', vote: 'maybe', rev: revOf(OPS) }] }, /vote/],
    ['an event by a stranger', { ...good(), events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'zed', kind: 'approve', rev: revOf(OPS) }] }, /zed/],
    ['a retract of an unknown event', { ...good(), events: [{ id: 'e-1', at: '2026-10-18T11:00:00-03:00', by: 'bruno', kind: 'retract', of: 'e-9' }] }, /e-9/],
    ['a closed proposal with no `closed`', { ...good(), state: 'rejected' }, /closed/],
    ['a rule snapshot that fails the rule shape', { ...good(), rules: [{ id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 0 } }] }, /count/],
    ['classes that do not cover the ops', { ...good(), classes: ['members'] }, /classes/],
    ['a duplicate id', [good(), good()], /used twice/],
  ])('fails %s', (_name, entry, pattern) => {
    const found = Array.isArray(entry) ? run(...entry) : run(entry)
    expect(found.length, 'it must fail').toBeGreaterThan(0)
    expect(found.join('\n')).toMatch(pattern as RegExp)
    expect(found.every(m => m.startsWith('data/proposals.yaml'))).toBe(true)
  })

  it('validateEntry reads the same schema for a single entry', () => {
    expect(validateEntry('proposals', good()).filter(p => p.level === 'error')).toEqual([])
    expect(validateEntry('proposals', { ...good(), state: 'draft' }).filter(p => p.level === 'error').length).toBeGreaterThan(0)
  })
})
