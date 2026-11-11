// tests/scripts/validate-governance.suggest.test.mjs
//
// validate:governance and a suggestion (DAO-OS L6 R-L6-SUGGEST-2, the operator: "Everywhere, maintainers decide"): a
// proposal made by Suggest (`suggested: true`) of a page only workspace/direct covers holds the built-in rule
// workspace/suggest, and is ratified once a maintainer other than its author approves it. Its author's own approval is
// refused, and a ratify whose only approval is the author's is not met. Every repository is a throwaway one built under
// the OS temp dir by the test itself (`-C <root>` on every git call); the server's own functions write the ledger
// (fixtures/ledger-write.mjs, run with tsx), the wrong histories by hand or with a step changed.
// Placeholders only: members steward-a (the maintainer) and steward-b.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf } from '../../packages/admin/lib/proposals.mjs'
import { WORKSPACE_SUGGEST } from '../../packages/admin/lib/rules.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')
const ADMIN = path.join(ORG_ROOT, 'packages', 'admin')
const WRITER = path.join(ORG_ROOT, 'tests', 'scripts', 'fixtures', 'ledger-write.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]
const EMAIL = { 'steward-a': 'steward-a@example.invalid', 'steward-b': 'steward-b@example.invalid' }

function vcs(root, args, { who = 'steward-a', date } = {}) {
  const email = EMAIL[who] ?? who
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8',
    env: { ...ENV, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const head = (root) => vcs(root, ['rev-parse', 'HEAD']).slice(0, 7)
function commit(root, files, message, opts) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', message], opts)
  return head(root)
}
const run = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: ENV })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const findingsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗') || l.startsWith('⚠'))

const MEMBERS = `members:
  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid] } }
  - { id: steward-b, name: Steward B, handles: { git: [steward-b@example.invalid] } }
`
// Written rules for every class; the workspace is under workspace/direct (no rule names it). steward-a is the maintainer.
const RULES = `governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - id: records
      applies_to: [records]
      propose: member
      decide: { by: maintainer, method: approve, count: 1 }
    - id: rest
      applies_to: [members, governance, identity, systems, treasury, operations, publication]
      propose: maintainer
      decide: { by: maintainer, method: direct }
  decisions: []
`
const PAGE = '---\nid: notes-0001\ntitle: Notes\nparent: null\norder: 1000\n---\n\nFirst line.\n'
const EDITED = PAGE.replace('First line.', 'First line, suggested.')
const blob = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')

const ID = 'p-2026-10-31-001-a3f9'
const START = '2026-10-31T10:00:00Z'
const OPENED = '2026-10-31T10:02:00Z'
const at = (hhmm) => `2026-10-31T${hhmm}:00Z`
const OPS = [{ op: 'file', path: 'pages/notes-0001.md', text: EDITED, base: blob(PAGE) }]

/** A suggestion as Propose writes it from Suggest (R-L6-SUGGEST-2). */
const suggestion = () => ({
  id: ID, title: 'Suggested edit to Notes', author: 'steward-b', classes: ['workspace'], rules: [JSON.parse(JSON.stringify(WORKSPACE_SUGGEST))],
  state: 'open', opened: OPENED, suggested: true, rev: revOf(OPS), base: '@head', branch: `proposal/${ID}`, ops: OPS, events: [], closed: null,
})

function start(rules = RULES, files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-suggest-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': rules, 'pages/notes-0001.md': PAGE, ...files }, 'start', { date: START })
  return root
}
function server(root, steps) {
  const r = spawnSync('npx', ['tsx', WRITER, JSON.stringify({ repo: root, owner: process.pid, steps: steps.map((s) => ({ ...s, email: EMAIL[s.actor] })) })],
    { cwd: ADMIN, encoding: 'utf-8', env: { ...ENV } })
  assert.equal(r.status, 0, `ledger-write: ${r.stdout}${r.stderr}`)
  const home = /^ledger-write admin home: (.+)$/m.exec(r.stdout)?.[1]
  assert.ok(home && !existsSync(home), `the writer leaves no admin home behind:\n${r.stdout}`)
}
/** Opened by the server as Suggest opens it, and its branch built. */
function suggested(rules = RULES, files = {}) {
  const root = start(rules, files)
  server(root, [{ open: suggestion(), now: OPENED, actor: 'steward-b', rule: 'workspace/suggest/approve' }, { branch: true, id: ID, now: OPENED, actor: 'steward-b' }])
  return root
}
function finds(root, sha, sentence) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const found = findingsOf(r).filter((l) => l.includes(sha) && l.includes(`proposal ${ID}`))
  assert.ok(found.some((l) => l.includes(sentence)), `no finding for ${sha} says ${sentence}:\n${r.stdout}`)
}

test('passing: a suggestion approved by a maintainer and ratified by the server is clean under --strict', () => {
  const root = suggested()
  server(root, [{ event: { kind: 'approve' }, id: ID, now: at('11:00'), actor: 'steward-a' }, { ratify: true, id: ID, now: at('12:00'), actor: 'steward-a' }])
  assert.equal(vcs(root, ['show', 'HEAD:pages/notes-0001.md']), EDITED.trimEnd())
  const message = vcs(root, ['log', '-1', '--format=%B'])
  assert.match(message, /^Org-Rule: workspace\/suggest\/approve$/m)
  assert.match(message, new RegExp(`^Org-Proposal: ${ID}$`, 'm'))
  assert.doesNotMatch(message, /^Org-Hat:/m) // no role of it is sourced from a hat
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})

test('a suggestion approved by its own author is a finding, though the author is a maintainer', () => {
  const root = suggested(RULES.replace('maintainer: { members: [steward-a] }', 'maintainer: { members: [steward-a, steward-b] }'))
  const ledger = vcs(root, ['show', 'HEAD:data/proposals.yaml'])
  const event = `{ id: "e-20261031T110000Z-0a1b", at: "${at('11:00')}", by: "steward-b", kind: "approve", rev: "${revOf(OPS)}" }`
  assert.match(ledger, /events: \[\]/)
  const sha = commit(root, { 'data/proposals.yaml': `${ledger.replace('events: []', `events: [${event}]`)}\n` },
    `proposals: approve ${ID}\n\nOrg-Actor: steward-b\nOrg-Rule: workspace/suggest/approve\nOrg-Proposal: ${ID}`, { who: 'steward-b', date: at('11:00') })
  finds(root, sha, 'cannot approve their own proposal')
})

test('a ratify of a suggestion whose only approval is its author\'s is a finding: its evaluation is not met', () => {
  const root = suggested()
  server(root, [{ event: { kind: 'approve' }, id: ID, now: at('11:00'), actor: 'steward-a' }])
  // The merge's ledger says the approval was the author's: what a ratify approved only by its author would record.
  server(root, [{ merge: { commit: '@branch', ledger: ['by: steward-a, kind: approve', 'by: steward-b, kind: approve'] }, id: ID, now: at('12:00'), actor: 'steward-a' }])
  finds(root, head(root), 'while its evaluation')
})

test('a suggestion that holds workspace/suggest where a written rule raises its page is a finding', () => {
  const root = start(RULES.replace('  decisions: []', '    - { id: notes, applies_to: ["workspace:tree-notes-0001"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n  decisions: []'))
  server(root, [{ open: suggestion(), now: OPENED, actor: 'steward-b', rule: 'workspace/suggest/approve' }])
  finds(root, head(root), 'its rules are not the ones in force')
})

// Fix round 2 (review I1): where the maintainer role is sourced from a hat, the ledger records no reading of who wears it
// (the server read the hat's wearers to take the suggestion, and an opening records only its author's own reading), so
// the offline check cannot say nobody else decides it: it is not a finding.
test('passing: a suggestion in an org whose maintainer role is sourced from a hat is clean when opened', () => {
  const HAT = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
  const rules = RULES.replace('  model: consensus\n', '  model: consensus\n  membership: { tree: hats-main }\n')
    .replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${HAT}" }`)
  const root = suggested(rules, { 'data/systems.yaml': 'systems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "eip155:42220", address: "13" }\n' })
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})
