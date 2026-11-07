// tests/scripts/validate-data.visibility.test.mjs
//
// validate:data checks that nothing stricter than members is in git (DAO-OS L5 spec §10.5, house spec §11 rule 4):
// no record whose own `visibility` is a hat or role level, no value of a field data/visibility.yaml restricts, no
// ledger op on private data but a placeholder. A restricted value is never repeated in the output: the finding names
// the field. It also reads data/visibility.yaml against the org (checkVisibilityPolicy), and flags a wallet handle that
// is not a CAIP-10 id. Placeholders only; every instance is a fresh temporary folder (no git is run).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf } from '../../packages/admin/lib/proposals.mjs'
import { substituteOps, withoutFields } from '../../packages/admin/lib/narrow.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-data.mjs')
const GOV_SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')

function instance(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-data-visibility-'))
  mkdirSync(path.join(root, 'data'))
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, 'data', name), text)
  return root
}
const run = (root, script = SCRIPT) => spawnSync('node', [script, root], { encoding: 'utf-8', env: { ...process.env, CI: '' } })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)

const COUNCIL = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const SENTINEL = 'SENTINEL-restricted-7f3a'
const MEMBERS = 'members:\n  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid] } }\n'
const SYSTEMS = 'systems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "eip155:42220", address: "13" }\n'
const GOVERNANCE = `governance:\n  model: solo-maintainer\n  membership: { tree: hats-main }\n`
const VISIBILITY = `visibility:\n  collections:\n    projects: { default: members, fields: { budget: "hat:${COUNCIL}" } }\n`
const base = (over = {}) => ({
  'members.yaml': MEMBERS, 'systems.yaml': SYSTEMS, 'governance.yaml': GOVERNANCE, 'visibility.yaml': VISIBILITY,
  'projects.yaml': 'projects:\n  - { id: p1, title: One }\n', ...over,
})

test('a clean instance with a restricted field and no value of it in git passes', () => {
  const r = run(instance(base()))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 5 passed, 0 failed, 0 warnings', r.stdout)
})

test('a record with `visibility: hat:…` in git is an error', () => {
  const r = run(instance(base({ 'projects.yaml': `projects:\n  - { id: p1, title: One, visibility: "hat:${COUNCIL}" }\n` })))
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok(lines(r.stdout).includes(`✗ data/projects.yaml [p1] visibility: this record's visibility is hat:${COUNCIL}, stricter than members: it belongs in the private store`), r.stdout)
})

test('a value of a field data/visibility.yaml restricts is an error naming the field, never the value', () => {
  const r = run(instance(base({ 'projects.yaml': `projects:\n  - { id: p1, title: One, budget: ${SENTINEL} }\n` })))
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok(lines(r.stdout).includes(`✗ data/projects.yaml [p1] budget: the field budget is restricted to hat:${COUNCIL} by data/visibility.yaml, so its value is stricter than members: it belongs in the private store`), r.stdout)
  assert.ok(!(r.stdout + r.stderr).includes(SENTINEL), r.stdout)

  // validate:governance reports it too (§10.5).
  const g = run(instance(base({ 'projects.yaml': `projects:\n  - { id: p1, title: One, budget: ${SENTINEL} }\n` })), GOV_SCRIPT)
  assert.equal(g.status, 1, g.stdout + g.stderr)
  assert.ok(lines(g.stdout).some((l) => l.startsWith('✗ data/projects.yaml [p1] budget: the field budget is restricted')), g.stdout)
  assert.ok(!(g.stdout + g.stderr).includes(SENTINEL), g.stdout)
})

test('a ledger op on private data that is not a placeholder is an error', () => {
  const ops = [{ op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two', budget: SENTINEL }, base: null }]
  const entry = {
    id: 'p-2026-10-29-001-a3f9', title: 'Add project two', author: 'steward-a', classes: ['records'],
    rules: [{ id: 'records', applies_to: ['records'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }],
    state: 'open', opened: '2026-10-29T10:02:00Z', rev: revOf(ops), base: null, branch: null, ops, events: [], closed: null,
  }
  const r = run(instance(base({ 'proposals.yaml': `proposals:\n  - ${JSON.stringify(entry)}\n` })))
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok(lines(r.stdout).includes(`✗ data/proposals.yaml [p-2026-10-29-001-a3f9] ops.0: op 1 on projects:p2 writes budget, which data/visibility.yaml restricts to hat:${COUNCIL}: an op on private data is held in git only as a placeholder (op: private), its value in the private store`), r.stdout)
  assert.ok(!(r.stdout + r.stderr).includes(SENTINEL), r.stdout)

  // An op that makes a record stricter than members, likewise.
  const narrow = [{ op: 'update', record: 'projects:p1', set: { visibility: `hat:${COUNCIL}` } }]
  const second = { ...entry, ops: narrow, rev: revOf(narrow) }
  const n = run(instance(base({ 'proposals.yaml': `proposals:\n  - ${JSON.stringify(second)}\n` })))
  assert.equal(n.status, 1, n.stdout + n.stderr)
  assert.ok(lines(n.stdout).includes(`✗ data/proposals.yaml [p-2026-10-29-001-a3f9] ops.0: op 1 on projects:p1 makes the record hat:${COUNCIL}, stricter than members: an op on private data is held in git only as a placeholder (op: private), its value in the private store`), n.stdout)
})

test('a ledger op on private data held as a placeholder (op: private) passes validate:data and validate:governance', () => {
  // L5 spec §9.6, Task 15: `{ op: private, ref: prv_<16 hex>, class, digest: sha256:<hex> }` holds no record and no value.
  const ops = [
    { op: 'update', record: 'projects:p1', set: { title: 'Uno' }, base: 'a'.repeat(64) },
    { op: 'private', ref: 'prv_0123456789abcdef', class: 'records', digest: `sha256:${'b'.repeat(64)}` },
  ]
  const entry = {
    id: 'p-2026-10-29-001-a3f9', title: 'Rename project one', author: 'steward-a', classes: ['records'],
    rules: [{ id: 'records', applies_to: ['records'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }],
    state: 'open', opened: '2026-10-29T10:02:00Z', rev: revOf(ops), base: null, branch: null, ops, events: [], closed: null,
  }
  const root = instance(base({ 'proposals.yaml': `proposals:\n  - ${JSON.stringify(entry)}\n` }))
  const r = run(root)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!lines(r.stdout).some((l) => l.startsWith('✗')), r.stdout)
  const g = run(root, GOV_SCRIPT)
  assert.ok(!lines(g.stdout).some((l) => l.startsWith('✗ data/proposals.yaml')), g.stdout)

  // A placeholder whose class `classes` does not list is an error, as a git op's is.
  const wrong = { ...entry, classes: ['members'], rules: [{ ...entry.rules[0], applies_to: ['members', 'records'] }] }
  const w = run(instance(base({ 'proposals.yaml': `proposals:\n  - ${JSON.stringify(wrong)}\n` })))
  assert.equal(w.status, 1, w.stdout + w.stderr)
  assert.ok(lines(w.stdout).some((l) => l.includes('the private op prv_0123456789abcdef is class records, which `classes` does not list')), w.stdout)
})

test('a closed proposal\'s op on private data is an error too, in validate:data and validate:governance', () => {
  // Spec §10.5 binds (controller ruling, Task 10 fix round 1): a decided proposal holds no restricted value either.
  const ops = [{ op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two', budget: SENTINEL }, base: null }]
  const entry = {
    id: 'p-2026-10-29-001-a3f9', title: 'Add project two', author: 'steward-a', classes: ['records'],
    rules: [{ id: 'records', applies_to: ['records'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }],
    state: 'withdrawn', opened: '2026-10-29T10:02:00Z', rev: revOf(ops), base: null, branch: null, ops,
    events: [{ id: 'e-1', at: '2026-10-29T11:00:00Z', by: 'steward-a', kind: 'withdraw' }],
    closed: { at: '2026-10-29T11:00:00Z', by: 'steward-a', decision: null },
  }
  const expected = `✗ data/proposals.yaml [p-2026-10-29-001-a3f9] ops.0: op 1 on projects:p2 writes budget, which data/visibility.yaml restricts to hat:${COUNCIL}: an op on private data is held in git only as a placeholder (op: private), its value in the private store`
  const root = instance(base({ 'proposals.yaml': `proposals:\n  - ${JSON.stringify(entry)}\n` }))
  const r = run(root)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok(lines(r.stdout).includes(expected), r.stdout)
  assert.ok(!(r.stdout + r.stderr).includes(SENTINEL), r.stdout)

  const g = run(root, GOV_SCRIPT)
  assert.equal(g.status, 1, g.stdout + g.stderr)
  assert.ok(lines(g.stdout).includes(expected), g.stdout)
  assert.ok(!(g.stdout + g.stderr).includes(SENTINEL), g.stdout)
})

test('a narrowing\'s ledger, its restricted ops held as placeholders, open and closed, passes both validators (R-L5-10.7)', () => {
  // DAO-OS L5 spec §9.7, Task 16: the ops that wrote what a narrowing takes out of git become placeholders in the same
  // commit, so the error the two tests above find is gone, for an open proposal and a closed one alike.
  const rules = [{ id: 'records', applies_to: ['records'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }]
  const ops = [{ op: 'update', record: 'projects:p1', set: { title: 'Uno', budget: SENTINEL }, base: 'a'.repeat(64) }]
  const open = { id: 'p-2026-10-29-001-a3f9', title: 'Rename', author: 'steward-a', classes: ['records'], rules, state: 'open',
    opened: '2026-10-29T10:02:00Z', rev: revOf(ops), base: null, branch: null, ops, events: [], closed: null }
  const closed = { ...open, id: 'p-2026-10-29-002-b4e1', state: 'withdrawn', closed: { at: '2026-10-29T11:00:00Z', by: 'steward-a', decision: null },
    events: [{ id: 'e-1', at: '2026-10-29T11:00:00Z', by: 'steward-a', kind: 'withdraw' }] }
  const ledger = (...entries) => `proposals:\n${entries.map((e) => `  - ${JSON.stringify(e)}\n`).join('')}`
  const before = run(instance(base({ 'proposals.yaml': ledger(open, closed) })))
  assert.equal(before.status, 1, before.stdout + before.stderr)

  let n = 0
  const narrowed = (entry) => {
    const sub = substituteOps(entry.ops, (op) => (op.set?.budget === undefined ? null : { keep: withoutFields(op, ['budget']), moved: [{ field: 'budget' }] }))
    const placeholders = sub.moved.map(() => ({ op: 'private', ref: `prv_${String(++n).padStart(16, '0')}`, class: 'records', digest: `sha256:${'c'.repeat(64)}` }))
    const next = [...sub.git, ...sub.held, ...placeholders]
    return { ...entry, ops: next, rev: revOf(next) }
  }
  const root = instance(base({ 'proposals.yaml': ledger(narrowed(open), narrowed(closed)) }))
  const r = run(root)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!lines(r.stdout).some((l) => l.startsWith('✗')), r.stdout)
  const g = run(root, GOV_SCRIPT)
  assert.ok(!lines(g.stdout).some((l) => l.startsWith('✗ data/proposals.yaml')), g.stdout)
  assert.ok(!(r.stdout + g.stdout).includes(SENTINEL))
})

test('data/visibility.yaml is read against the org: a hat outside the membership tree is an error', () => {
  const outside = 'eip155:42220:0x0000000e00010000000000000000000000000000000000000000000000000000'
  const r = run(instance(base({ 'visibility.yaml': `visibility:\n  collections:\n    projects: { fields: { budget: "hat:${outside}" } }\n` })))
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok(lines(r.stdout).includes(`✗ data/visibility.yaml visibility.collections.projects.fields.budget: ${outside} is not a hat of the membership tree eip155:42220:13`), r.stdout)
})

test('a wallet handle that is a bare address, not a CAIP-10 id, is flagged', () => {
  const members = 'members:\n  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid], wallet: "0x00000000000000000000000000000000000000a1" } }\n'
  const r = run(instance(base({ 'members.yaml': members })))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(lines(r.stdout).includes('⚠ data/members.yaml [steward-a] handles.wallet: a bare address has no chain, so no reading is ever matched to it: write it as a CAIP-10 id, eip155:<chain id>:0x…'), r.stdout)
})
