// tests/scripts/validate-governance.workspace.test.mjs
//
// validate:governance and the workspace (DAO-OS L6 spec §3.5): a workspace file is judged at its targets, never by an
// org's catch-all rule; a commit carrying `Org-Rule: workspace/direct` is accepted when every file it changes is class
// workspace (data/visibility.yaml only when it narrows, ruling P-6), its actor is known (a member id, agents included,
// or a CAIP-10 id with an Org-Hat in the tree), and no written rule at its parent names a target of its files. A new
// proposal of a raised target holds the rule that raises it (ruling P-4).
// Every repository is a throwaway one built under the OS temp dir by the test itself (`-C <root>` on every git call).
// Placeholders only: members steward-a, steward-b, agent agent-a; address 0x…a1; tree eip155:42220:13.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf } from '../../packages/admin/lib/proposals.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]
const HOUSE = 'house@org-os.invalid'
const EMAIL = {
  'steward-a': 'steward-a@example.invalid', 'steward-b': 'steward-b@example.invalid', 'agent-a': 'agent-a@example.invalid',
  stranger: 'stranger@example.invalid', house: HOUSE,
}

function vcs(root, args, { who = 'steward-a', date } = {}) {
  const email = EMAIL[who] ?? who
  const name = who === 'house' ? 'org-os house' : who
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8',
    env: { ...ENV, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
function commit(root, files, message, opts) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', message], opts)
  return vcs(root, ['rev-parse', '--short', 'HEAD'])
}
const run = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: ENV })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const findingsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗') || l.startsWith('⚠'))

const COUNCIL_HAT = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000a1'

const MEMBERS = `members:
  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid] } }
  - { id: steward-b, name: Steward B, handles: { git: [steward-b@example.invalid] } }
  - { id: agent-a, name: Agent A, kind: agent, handles: { git: [agent-a@example.invalid] } }
`
const SYSTEMS = 'systems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "eip155:42220", address: "13" }\n'
/** Pilot-shaped: one consent rule for everything, governance by the council's approval; `more` raises a target. */
const pilot = (more = '') => `governance:
  model: consensus
  membership: { tree: hats-main }
  roles:
    council: { members: [steward-a, steward-b] }
    member: { all: true }
  rules:
    - id: governance
      applies_to: [governance]
      propose: member
      decide: { by: council, method: approve, count: 1 }
    - id: consent
      applies_to: [all]
      propose: member
      decide: { by: council, method: consent, window: P7D }
${more}  decisions: []
`
const HANDBOOK_RULE = `    - id: handbook
      applies_to: [workspace:tree-handbook-3f2a]
      propose: member
      decide: { by: council, method: approve, count: 1 }
`
const TASKS_RULE = `    - id: tasks-rule
      applies_to: [workspace:tasks]
      propose: member
      decide: { by: council, method: approve, count: 1 }
`
const page = (id, title, parent = null) => `---\nid: ${id}\ntitle: ${title}\nparent: ${parent ?? 'null'}\norder: 1000\n---\n\n${title}.\n`
const VISIBILITY = 'visibility:\n  collections:\n    projects: { default: members }\n'

const START = '2026-10-29T10:00:00Z'
const at = (hhmm) => `2026-10-29T${hhmm}:00Z`
const trailers = (actor, more = '') => `\n\nOrg-Actor: ${actor}\nOrg-Rule: workspace/direct${more}`

function start(governance = pilot(), files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-workspace-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, {
    'data/members.yaml': MEMBERS, 'data/governance.yaml': governance, 'data/systems.yaml': SYSTEMS,
    'data/visibility.yaml': VISIBILITY, 'pages/handbook-3f2a.md': page('handbook-3f2a', 'Handbook'), ...files,
  }, 'start', { date: START })
  return root
}
function finds(root, sha, sentence) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const found = findingsOf(r).filter((l) => l.includes(sha))
  assert.ok(found.some((l) => (sentence instanceof RegExp ? sentence.test(l) : l.includes(sentence))), `no finding for ${sha} says ${sentence}:\n${r.stdout}`)
  return found
}
function clean(root) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
}

test('validate:governance accepts a workspace/direct commit of pages/ by a member, by an agent, and by a CAIP-10 actor with Org-Hat', () => {
  const root = start()
  commit(root, { 'pages/handbook-3f2a.md': page('handbook-3f2a', 'The handbook') }, `page: The handbook${trailers('steward-a')}`, { date: at('11:00') })
  commit(root, { 'pages/notes-1a2b.md': page('notes-1a2b', 'Notes') }, `page: Notes${trailers('agent-a')}`, { who: 'agent-a', date: at('11:05') })
  commit(root, { 'pages/ideas-5e6f.md': page('ideas-5e6f', 'Ideas', 'notes-1a2b') },
    `page: Ideas${trailers(A1, `\nOrg-Hat: ${COUNCIL_HAT} @100`)}`, { who: 'house', date: at('11:10') })
  clean(root)
})

test('a plain commit of workspace files never falls to the catch-all rule (ruling P-1)', () => {
  const root = start()
  commit(root, { 'data/tasks.yaml': 'tasks:\n  - { id: t-1, title: Write the handbook }\n', 'memory/2026-10-29.md': '# 29 Oct\n' }, 'session: tasks and memory', { date: at('11:00') })
  clean(root)
})

test('it reports a workspace/direct commit under a raised tree with no Org-Proposal', () => {
  const root = start(pilot(HANDBOOK_RULE), { 'pages/onboarding-9c1d.md': page('onboarding-9c1d', 'Onboarding', 'handbook-3f2a') })
  const sha = commit(root, { 'pages/onboarding-9c1d.md': page('onboarding-9c1d', 'Onboarding, revised', 'handbook-3f2a') },
    `page: Onboarding, revised${trailers('steward-a')}`, { date: at('11:00') })
  finds(root, sha, /workspace:tree-handbook-3f2a.*rule "handbook" needs 1 approval.*It is a change that needs someone else's say/)

  // A page created in the commit, under the raised tree, is raised too; a sibling is not.
  const again = start(pilot(HANDBOOK_RULE))
  const sha2 = commit(again, { 'pages/first-week-77aa.md': page('first-week-77aa', 'First week', 'handbook-3f2a') },
    `page: First week${trailers('steward-a')}`, { date: at('11:00') })
  finds(again, sha2, "It is a change that needs someone else's say")

  const sibling = start(pilot(HANDBOOK_RULE))
  commit(sibling, { 'pages/sibling-0b0b.md': page('sibling-0b0b', 'Sibling') }, `page: Sibling${trailers('steward-a')}`, { date: at('11:00') })
  clean(sibling)
})

test('a raised page committed with no Org-Proposal can be proposed (the file op reaches pages, L6 §11.2): the finding says so', () => {
  const root = start(pilot(HANDBOOK_RULE), { 'pages/onboarding-9c1d.md': page('onboarding-9c1d', 'Onboarding', 'handbook-3f2a') })
  const sha = commit(root, { 'pages/onboarding-9c1d.md': page('onboarding-9c1d', 'Onboarding, revised', 'handbook-3f2a') },
    `page: Onboarding, revised${trailers('steward-a')}`, { date: at('11:00') })
  const found = finds(root, sha, 'it has no Org-Proposal trailer. Propose the change, or ask a maintainer to revert it.')
  assert.ok(found.every((l) => !l.includes('until P2b') && !l.includes('no proposal can carry')), found.join('\n'))
})

test('a library receipt rides along in a workspace/direct commit, as the server judges it (L1-C5)', () => {
  const root = start()
  commit(root, {
    'pages/notes-1a2b.md': page('notes-1a2b', 'Notes'),
    'data/library.yaml': 'installed:\n  - { id: notes-board, entry: notes-board, kind: board, status: installed, created: [] }\n',
  }, `page: Notes${trailers('steward-a')}`, { date: at('11:00') })
  const r = run([root, '--strict'])
  assert.ok(!findingsOf(r).some((l) => l.includes('data/library.yaml, which is class records')), r.stdout)
})

test('it reports a workspace/direct commit by someone the repository does not know', () => {
  const root = start()
  const sha = commit(root, { 'pages/notes-1a2b.md': page('notes-1a2b', 'Notes') }, `page: Notes${trailers('stranger')}`, { who: 'stranger', date: at('11:00') })
  finds(root, sha, "It is a change that needs someone else's say")
})

test('it reports a workspace/direct commit that also changes data/members.yaml', () => {
  const root = start()
  const sha = commit(root, {
    'pages/notes-1a2b.md': page('notes-1a2b', 'Notes'),
    'data/members.yaml': `${MEMBERS}  - { id: steward-c, name: Steward C }\n`,
  }, `page: Notes${trailers('steward-a')}`, { date: at('11:00') })
  finds(root, sha, 'its Org-Rule is workspace/direct, and it changes data/members.yaml, which is class members')
})

test('a workspace/direct commit may narrow data/visibility.yaml, and may not widen it (ruling P-6)', () => {
  const root = start()
  commit(root, {
    'data/collections.yaml': 'collections:\n  - id: circles\n    fields: [{ id: email, type: text }]\n',
    'data/visibility.yaml': `${VISIBILITY}    circles: { default: members, fields: { email: "role:council" } }\n`,
  }, `collections: circles${trailers('steward-a')}`, { date: at('11:00') })
  clean(root)

  const wide = start()
  const sha = commit(wide, {
    'data/collections.yaml': 'collections:\n  - id: circles\n    fields: []\n',
    'data/visibility.yaml': 'visibility:\n  collections:\n    projects: { default: public }\n',
  }, `collections: circles${trailers('steward-a')}`, { date: at('11:00') })
  finds(wide, sha, 'its Org-Rule is workspace/direct, and it changes data/visibility.yaml')
})

test('a new proposal of a raised target holds the rule that raises it (ruling P-4)', () => {
  const ID = 'p-2026-10-29-001-a3f9'
  const OPENED = at('10:02')
  const OPS = [{ op: 'create', record: 'tasks:t-2', value: { id: 't-2', title: 'Two' }, base: null }]
  const RULE = { id: 'tasks-rule', applies_to: ['workspace:tasks'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } }
  const entry = {
    id: ID, title: 'Add task two', author: 'steward-a', classes: ['workspace'], rules: [RULE], state: 'open', opened: OPENED,
    rev: revOf(OPS), base: null, branch: `proposal/${ID}`, ops: OPS, events: [], closed: null,
  }
  const root = start(pilot(TASKS_RULE), { 'data/tasks.yaml': 'tasks:\n  - { id: t-1, title: One }\n' })
  commit(root, { 'data/proposals.yaml': `proposals:\n  - ${JSON.stringify(entry)}\n` },
    `proposals: open ${ID}\n\nOrg-Actor: steward-a\nOrg-Rule: tasks-rule/approve\nOrg-Proposal: ${ID}`, { date: OPENED })
  clean(root)
})
