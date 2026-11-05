// tests/scripts/validate-governance.solo.test.mjs
//
// The solo shape (0.6 P2 spec §3.10 "Only where rules are written", M3): a history like a solo maintainer's
// (the solo default, `decisions: []`, a few hundred commits, thirty merges, no `Org-` trailers, no
// data/proposals.yaml) is never walked by the ledger check, so it is clean under --strict, with or without a
// decision row added by hand; once a commit writes rules, the history is judged from the next commit on, and the
// commit that writes them is not. Every repository is a throwaway one under the OS temp dir, built with
// `git fast-import` (one git process for the whole history) and `-C <root>` on every git call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
// A git variable from the caller (a hook, an editor) would point every git call here at another repository.
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]

function vcs(root, args, { input, who = 'ana@example.org' } = {}) {
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8', input,
    env: { ...ENV, GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: who, GIT_COMMITTER_NAME: 'Someone', GIT_COMMITTER_EMAIL: who },
  })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const run = (args, env = {}) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: { ...ENV, ...env } })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)

const MEMBERS = 'members:\n  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }\n'
const SOLO = 'governance:\n  model: solo-maintainer\n  decisions: []\n'
const ROW = `governance:
  model: solo-maintainer
  decisions:
    - { id: gov-2026-10-01, title: Keep the site plain, status: accepted, date: "2026-10-01" }
`
const RULES = `governance:
  model: consensus
  roles:
    maintainer: { members: [ana] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
    - { id: rest, applies_to: [members, governance, identity, systems, treasury, operations, publication], propose: maintainer, decide: { by: maintainer, method: direct } }
  decisions: []
`
const PROJECTS = (n) => `projects:\n  - { id: p1, title: "Fixture ${n}" }\n`

/**
 * A solo maintainer's history on main: 300 commits, 30 of them merges of a side branch, by the maintainer and by
 * addresses no member holds, editing records, notes and the governance file; no trailer anywhere.
 */
function soloHistory() {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-solo-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  const out = []
  let mark = 0
  let time = Date.parse('2026-01-01T09:00:00Z') / 1000
  const blob = (text) => { out.push('blob', `mark :${++mark}`, `data ${Buffer.byteLength(text)}`, text); return mark }
  const commitTo = (ref, from, files, message, { merge, email = 'ana@example.org' } = {}) => {
    const marks = Object.entries(files).map(([rel, text]) => [rel, blob(text)])
    out.push(`commit ${ref}`, `mark :${++mark}`, `committer Someone <${email}> ${time += 60} +0000`, `data ${Buffer.byteLength(message)}`, message)
    if (from) out.push(`from :${from}`)
    if (merge) out.push(`merge :${merge}`)
    for (const [rel, m] of marks) out.push(`M 100644 :${m} ${rel}`)
    out.push('')
    return mark
  }
  let main = commitTo('refs/heads/main', null, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': SOLO, 'data/projects.yaml': PROJECTS(0) }, 'start')
  let count = 1
  for (let round = 0; round < 30; round++) {
    const side = commitTo('refs/heads/side', main, { [`docs/side-${round}.md`]: `side ${round}\n` }, `side work ${round}`, { email: 'friend@example.net' })
    count++
    for (let i = 0; i < 7; i++) {
      const n = round * 7 + i + 1
      const files = n % 3 === 0 ? { [`docs/note-${n}.md`]: `note ${n}\n` } : { 'data/projects.yaml': PROJECTS(n) }
      main = commitTo('refs/heads/main', main, files, `work ${n}`, { email: n % 2 === 0 ? 'ana@example.org' : 'laptop@example.net' })
      count++
    }
    main = commitTo('refs/heads/main', main, {}, `Merge branch 'side' (${round})`, { merge: side })
    count++
  }
  while (count < 300) { main = commitTo('refs/heads/main', main, { 'data/projects.yaml': PROJECTS(1000 + count) }, `tail ${count}`); count++ }
  vcs(root, ['fast-import', '--quiet'], { input: `${out.join('\n')}\n` })
  // fast-import writes objects and refs, not the index: without this, the next commit would delete every file it does not add.
  vcs(root, ['read-tree', 'HEAD'])
  // The validator's part 1 reads the files on disk: write the tip's.
  for (const rel of ['data/members.yaml', 'data/governance.yaml', 'data/projects.yaml']) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), vcs(root, ['show', `HEAD:${rel}`]) + '\n')
  }
  return root
}
/** One more commit on main, through the index. */
function commit(root, files, message, who) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', message], { who })
  return vcs(root, ['rev-parse', '--short', 'HEAD'])
}

test('M3: a solo maintainer\'s history (300 commits, 30 merges, no trailers, no ledger) is clean under --strict', () => {
  const root = soloHistory()
  assert.equal(vcs(root, ['rev-list', '--count', 'HEAD']), '300')
  assert.equal(vcs(root, ['rev-list', '--count', '--merges', 'HEAD']), '30')
  assert.equal(vcs(root, ['log', '--format=%B']).includes('Org-'), false)
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
  assert.ok(!r.stdout.includes('proposals.yaml'), r.stdout)
})

test('M3: the same history with a decision row added by hand is clean', () => {
  const root = soloHistory()
  commit(root, { 'data/governance.yaml': ROW }, 'record a decision', 'laptop@example.net')
  // The fixture's index holds the history's tip, so a later commit changes its own file and deletes nothing.
  assert.equal(vcs(root, ['show', '--name-only', '--format=', 'HEAD']), 'data/governance.yaml')
  assert.equal(vcs(root, ['show', '--stat', '--format=', 'HEAD']).split('\n').at(-1).trim(), '1 file changed, 2 insertions(+), 1 deletion(-)')
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})

test('M3: a ledger written by hand into a solo history is not walked by the ledger check', () => {
  const root = soloHistory()
  commit(root, { 'data/proposals.yaml': 'proposals:\n  - { id: p-2026-10-18-001, title: By hand, author: nobody, state: ratified }\n' }, 'a ledger by hand', 'laptop@example.net')
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})

test('M3: after a commit that writes rules the history is judged from the next commit; the commit that writes them is not', () => {
  const root = soloHistory()
  const writes = commit(root, { 'data/governance.yaml': RULES }, 'adopt rules', 'laptop@example.net')
  assert.equal(run([root, '--strict']).status, 0, 'the commit that writes the rules is judged by the solo default before it')
  const next = commit(root, { 'data/projects.yaml': PROJECTS(9999) }, 'edit a project after the rules', 'laptop@example.net')
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const found = lines(r.stdout).filter((l) => l.startsWith('✗'))
  assert.equal(found.length, 1, r.stdout)
  assert.ok(found[0].startsWith(`✗ ${next} "edit a project after the rules"`), found[0])
  assert.ok(!r.stdout.includes(writes), r.stdout)
})

test('M3: the presence-only note is gone: with data/proposals.yaml present, CI=true prints no such note', () => {
  const root = soloHistory()
  commit(root, { 'data/governance.yaml': RULES }, 'adopt rules')
  commit(root, { 'data/proposals.yaml': 'proposals: []\n' }, 'the ledger')
  for (const r of [run([root], { CI: 'true' }), run([root, '--strict'])]) {
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(!r.stdout.includes('presence only'), r.stdout)
    assert.ok(!r.stdout.includes('does not exist yet'), r.stdout)
  }
})
