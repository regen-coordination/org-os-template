// tests/scripts/validate-governance.moves.test.mjs
//
// validate:governance and a ratify that moves a private record into git (DAO-OS L6 §12; Task 11 review I-3). The move's
// create is no git op of its proposal (the ledger holds its placeholder only, rule 8), so the merge names what it moved in
// an Org-Moved trailer, and the script accepts exactly those creates: one record per name, absent at the first parent, at
// members or public, of a proposal opened for publication with a restricted op per move. Everything else in the file is
// still the ops' result. Every repository is a throwaway one under the OS temp dir (`-C <root>` on every git call); the
// history is written by the server's own functions (fixtures/ledger-write.mjs, run with tsx), its private store kept
// under the writer's own admin home and removed with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf } from '../../packages/admin/lib/proposals.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')
const ADMIN = path.join(ORG_ROOT, 'packages', 'admin')
const WRITER = path.join(ORG_ROOT, 'tests', 'scripts', 'fixtures', 'ledger-write.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]
const EMAIL = { ana: 'ana@example.org', bruno: 'bruno@example.org', carla: 'carla@example.org' }

function vcs(root, args, { who = 'ana', date } = {}) {
  const email = EMAIL[who] ?? who
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8',
    env: { ...ENV, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const run = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: ENV })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const findingsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗') || l.startsWith('⚠'))

const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }
  - { id: bruno, name: Bruno, handles: { git: [bruno@example.org] } }
  - { id: carla, name: Carla, handles: { git: [carla@example.org] } }
`
// Records and publications need one approval from a maintainer (ana or bruno); the rest is decided directly by one.
const RULES = `governance:
  model: consensus
  roles:
    maintainer: { members: [ana, bruno] }
    member: { all: true }
  rules:
    - id: records
      applies_to: [records, publication]
      propose: member
      decide: { by: maintainer, method: approve, count: 1 }
    - id: rest
      applies_to: [members, governance, identity, systems, treasury, operations]
      propose: maintainer
      decide: { by: maintainer, method: direct }
  decisions: []
`
const RULE = { id: 'records', applies_to: ['records', 'publication'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const PROJECTS = 'projects:\n  - { id: p1, title: One }\n'
// A project's budget is kept at the maintainers, wherever the project is.
const POLICY = 'visibility:\n  collections:\n    projects: { default: members, fields: { budget: "role:maintainer" } }\n'
const SENTINEL = 'sentinel-9c2e-'
const SECRET = { collection: 'projects', id: 'p-secret', visibility: 'role:maintainer', body: { id: 'p-secret', title: 'Kept apart', budget: `${SENTINEL}budget` }, rev: '' }
const MOVE = { op: 'move-to-git', collection: 'projects', id: 'p-secret', level: 'members', digest: '@current' }

const ID = 'p-2026-10-18-001-b7c1'
const START = '2026-10-18T10:00:00Z'
const OPENED = '2026-10-18T10:02:00Z'
const at = (hhmm) => `2026-10-18T${hhmm}:00Z`

/** A proposal as Propose writes it (its restricted part is added by the writer), with `over` on top. */
const proposal = (over = {}) => {
  const ops = over.ops ?? []
  return { id: ID, title: 'A project goes to the members', author: 'ana', classes: ['records', 'publication'], rules: [RULE], state: 'open',
    opened: OPENED, rev: revOf(ops), base: null, branch: `proposal/${ID}`, ops, events: [], closed: null, ...over }
}

function start() {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-moves-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  const files = { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/projects.yaml': PROJECTS, 'data/visibility.yaml': POLICY }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', 'start'], { date: START })
  return root
}
function server(root, steps) {
  const r = spawnSync('npx', ['tsx', WRITER, JSON.stringify({ repo: root, owner: process.pid, steps: steps.map((s) => ({ ...s, email: EMAIL[s.actor] })) })],
    { cwd: ADMIN, encoding: 'utf-8', env: { ...ENV } })
  assert.equal(r.status, 0, `ledger-write: ${r.stdout}${r.stderr}`)
}
/** Opened with its move by ana at OPENED (the private record kept first), built, approved by bruno at 11:00. */
const approvedMove = (entry = proposal(), priv = [MOVE]) => [
  { keep: SECRET, now: START, actor: 'ana' },
  { open: entry, private: priv, now: entry.opened, actor: entry.author, rule: 'records/approve' },
  { branch: true, id: ID, now: OPENED, actor: 'ana' },
  { event: { kind: 'approve' }, id: ID, now: at('11:00'), actor: 'bruno' },
]
const show = (root, rel, rev = 'HEAD') => vcs(root, ['show', `${rev}:${rel}`])
const objects = (root) => spawnSync('git', ['-C', root, 'cat-file', '--batch-all-objects', '--batch'], { encoding: 'utf-8', env: ENV, maxBuffer: 1 << 28 }).stdout

function finds(root, sentence) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const sha = vcs(root, ['rev-parse', 'HEAD']).slice(0, 7)
  const found = findingsOf(r).filter((l) => l.includes(sha) && l.includes(`proposal ${ID}`))
  assert.ok(found.some((l) => (sentence instanceof RegExp ? sentence.test(l) : l.includes(sentence))), `no finding for ${sha} says ${sentence}:\n${r.stdout}`)
}

test('passing: a ratify that moves a private record into git, written by the server, names it in Org-Moved and is clean under --strict', () => {
  const root = start()
  server(root, [...approvedMove(), { ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  assert.equal(vcs(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length, 3, 'ratify is one merge commit')
  assert.match(vcs(root, ['log', '-1', '--format=%B']), /^Org-Moved: projects:p-secret$/m)
  assert.match(show(root, 'data/projects.yaml'), /p-secret/)
  assert.ok(!objects(root).includes(SENTINEL), 'the budget the policy restricts is in no object')
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})

test('passing: a ratify that moves a private page into git names it as pages:<id> and is clean under --strict', () => {
  const root = start()
  const page = { collection: 'pages', id: 'p-0000000000a1', visibility: 'role:maintainer', body: { title: 'Plans', parent: null, order: 1000, markdown: 'The plans.\n' }, rev: '' }
  const steps = approvedMove(proposal({ title: 'The plans go to the members', classes: ['workspace', 'publication'] }), [{ ...MOVE, collection: 'pages', id: page.id }])
  steps[0] = { keep: page, now: START, actor: 'ana' }
  server(root, [...steps, { ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  assert.match(vcs(root, ['log', '-1', '--format=%B']), /^Org-Moved: pages:p-0000000000a1$/m)
  assert.match(show(root, 'pages/p-0000000000a1.md'), /\nvisibility: members\n/)
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})

test('a ratify merge whose Org-Moved trailer names a record it does not create (a proposal with no move) is a finding', () => {
  const root = start()
  const ops = [{ op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two' }, base: null }]
  server(root, [
    { open: proposal({ title: 'Add project two', classes: ['records'], ops }), now: OPENED, actor: 'ana', rule: 'records/approve' },
    { branch: true, id: ID, now: OPENED, actor: 'ana' },
    { event: { kind: 'approve' }, id: ID, now: at('11:00'), actor: 'bruno' },
    { merge: { commit: '@branch', moved: 'projects:p9' }, id: ID, now: at('12:00'), actor: 'bruno' },
  ])
  finds(root, 'its Org-Moved trailer names projects:p9, and the merge does not create it in data/projects.yaml.')
  finds(root, `its Org-Moved trailer names projects:p9, and proposal ${ID} was not opened for publication`)
  finds(root, `its Org-Moved trailer names one record, and proposal ${ID} holds no restricted op: each move is one.`)
})

test('a ratify merge that creates a record beside the one its Org-Moved trailer names is a finding', () => {
  const root = start()
  const both = `${PROJECTS}  - { id: p-secret, title: Kept apart, visibility: members }\n  - { id: p-extra, title: Extra, visibility: members }\n`
  server(root, [...approvedMove(), {
    merge: { commit: '@branch', moved: 'projects:p-secret', files: [{ path: 'data/projects.yaml', text: both }], allow: ['data/projects.yaml'] },
    id: ID, now: at('12:00'), actor: 'bruno',
  }])
  finds(root, 'record projects:p-extra changes in the merge, and no op of the proposal names it')
})

test('a ratify merge that moves a record and names none in Org-Moved is a finding', () => {
  const root = start()
  const moved = `${PROJECTS}  - { id: p-secret, title: Kept apart, visibility: members }\n`
  server(root, [...approvedMove(), {
    merge: { commit: '@branch', files: [{ path: 'data/projects.yaml', text: moved }], allow: ['data/projects.yaml'] },
    id: ID, now: at('12:00'), actor: 'bruno',
  }])
  finds(root, 'the merge also changes data/projects.yaml, which no op of the proposal names')
})
