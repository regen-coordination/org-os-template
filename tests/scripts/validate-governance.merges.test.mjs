// tests/scripts/validate-governance.merges.test.mjs
//
// validate:governance expands a merge that carries no Org-Proposal (a Sync, a crew branch landing) along its second
// parent's first-parent line, judging each commit brought in with the rules and roles of its own parent, and compares the
// merge with git's own merge of its parents (0.6 P2 spec §3.10 H3, M-e, M-1, M-C; §3.12; P2-R19). A merge carrying
// Org-Proposal stays one change. Every repository (a bare remote and the members' clones) is a throwaway one this file
// makes under one temp dir of its own, removed when the file is done; every git call names its repository with `-C`.
// Sync's merge is made here as the server makes it (`merge --no-ff` of origin/main, a conflicted ledger written merged
// by id with `mergeLedgers`, ours' entries where they were and the incoming ones after); the ratify merges and the
// proposals of the remote ratify are written by the server's own functions (fixtures/ledger-write.mjs, run with tsx).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, chmodSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf, mergeLedgers } from '../../packages/admin/lib/proposals.mjs'
import { yamlDocuments } from '../../packages/admin/lib/governance-read.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')
const ADMIN = path.join(ORG_ROOT, 'packages', 'admin')
const WRITER = path.join(ORG_ROOT, 'tests', 'scripts', 'fixtures', 'ledger-write.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
// A git variable from the caller (a hook, an editor) would point every git call here at another repository.
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]
const EMAIL = { ana: 'ana@example.org', bruno: 'bruno@example.org', carla: 'carla@example.org', 'crew-engineer': 'engineer@crew.example' }
const LEDGER = 'data/proposals.yaml'

// Everything this file makes on disk is under TEMP, and TEMP is gone when the file is done.
const TEMP = mkdtempSync(path.join(tmpdir(), 'validate-governance-merges-'))
after(() => rmSync(TEMP, { recursive: true, force: true }))
let made = 0
const temp = (name) => {
  const dir = path.join(TEMP, `${name}-${++made}`)
  mkdirSync(dir)
  return dir
}

function vcs(root, args, { who = 'ana', date, allow = [0] } = {}) {
  const email = EMAIL[who] ?? who
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8',
    env: { ...ENV, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  })
  assert.ok(allow.includes(r.status), `git ${args.join(' ')} (exit ${r.status}): ${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}
function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
}
function commit(root, files, message, opts) {
  write(root, files)
  vcs(root, ['commit', '-q', '-m', message], opts)
  return short(root)
}
const short = (root, rev = 'HEAD') => vcs(root, ['rev-parse', rev]).slice(0, 7)
const full = (root, rev) => vcs(root, ['rev-parse', rev])
const run = (args, env = {}) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: { ...ENV, ...env } })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const errorsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗'))
const warningsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('⚠'))
const resultOf = (r) => lines(r.stdout).at(-1)
function clean(root) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(resultOf(r), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
  return r
}
/** Run under --strict; it must fail with exactly `count` errors. */
function failing(root, count) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.equal(errorsOf(r).length, count, r.stdout)
  return r
}

const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }
  - { id: bruno, name: Bruno, handles: { git: [bruno@example.org] } }
  - { id: carla, name: Carla, handles: { git: [carla@example.org] } }
  - { id: crew-engineer, name: Engineer seat, kind: agent, handles: { git: [engineer@crew.example] } }
`
// Records are the maintainers' (ana, bruno) to decide alone; carla and the crew seat need a proposal. The rest likewise.
const DIRECT = `governance:
  model: consensus
  roles:
    maintainer: { members: [ana, bruno] }
    member: { all: true }
  rules:
    - id: records
      applies_to: [records]
      propose: member
      decide: { by: maintainer, method: direct }
    - id: rest
      applies_to: [members, governance, identity, systems, treasury, operations, publication]
      propose: maintainer
      decide: { by: maintainer, method: direct }
  decisions: []
`
const WITH_CARLA = DIRECT.replace('members: [ana, bruno]', 'members: [ana, bruno, carla]')
// For the remote ratify: records need one maintainer's approval, and the author's own counts (the first `direct` is records').
const SELF = DIRECT.replace('decide: { by: maintainer, method: direct }', 'decide: { by: maintainer, method: approve, count: 1 }\n      self_approve: true')
const DIRECT_RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'direct' } }
const SELF_RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 }, self_approve: true }

const PROJECTS = 'projects:\n  - { id: p1, title: One }\n'
const START = '2026-10-18T10:00:00Z'
const OPENED = '2026-10-18T10:02:00Z'
const at = (hhmm) => `2026-10-18T${hhmm}:00Z`
const ID = 'p-2026-10-18-001-a3f9'

const opsFor = (slug) => [{ op: 'create', record: `projects:${slug}`, value: { id: slug, title: slug }, base: null }]
/** A proposal as Propose writes it. */
const proposal = (id, author, opened, { rules = [DIRECT_RULE], slug = `x${id.slice(-3)}` } = {}) => ({
  id, title: `Add project ${slug}`, author, classes: ['records'], rules, state: 'open', opened,
  rev: revOf(opsFor(slug)), base: null, branch: `proposal/${id}`, ops: opsFor(slug), events: [], closed: null,
})
const ledger = (...entries) => (entries.length === 0 ? 'proposals: []\n' : `proposals:\n${entries.map((e) => `  - ${JSON.stringify(e)}\n`).join('')}`)
/** Propose by hand: the entry in its own commit with the trailers the server writes, on top of `existing`. */
function open(root, entry, { existing = [], date = entry.opened } = {}) {
  return commit(root, { [LEDGER]: ledger(...existing, entry) },
    `proposals: open ${entry.id} — ${entry.title}\n\nOrg-Actor: ${entry.author}\nOrg-Rule: records/direct\nOrg-Proposal: ${entry.id}`, { who: entry.author, date })
}

/**
 * A bare remote, ana's clone (`a`) with members, `rules`, a project and an empty ledger committed at START and pushed, and
 * bruno's clone of it (`b`). Both trunks are `main`.
 */
function shared(rules = DIRECT, more = {}) {
  const dir = temp('shared')
  vcs(dir, ['init', '-q', '--bare', '-b', 'main', 'remote.git'])
  const a = path.join(dir, 'a')
  mkdirSync(a)
  vcs(a, ['init', '-q', '-b', 'main'])
  vcs(a, ['remote', 'add', 'origin', path.join(dir, 'remote.git')])
  commit(a, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': rules, 'data/projects.yaml': PROJECTS, [LEDGER]: ledger(), ...more }, 'start', { date: START })
  vcs(a, ['push', '-q', 'origin', 'main'])
  vcs(dir, ['clone', '-q', path.join(dir, 'remote.git'), 'b'])
  return { dir, a, b: path.join(dir, 'b') }
}
/** bruno shares his trunk; ana writes a local note (so the two have diverged) and fetches. */
function shareAndFetch({ a, b }, { note = true } = {}) {
  vcs(b, ['push', '-q', 'origin', 'main'], { who: 'bruno' })
  if (note) commit(a, { 'docs/note.md': 'a local note\n' }, 'a local note', { who: 'ana', date: at('11:30') })
  vcs(a, ['fetch', '-q', 'origin'])
}

/** The ledger merged by id, as Sync writes it: mergeLedgers of the base and the two sides, ours' entries where they were, the incoming ones after. */
function ledgerById(root) {
  const read = (rev) => yamlDocuments(vcs(root, ['show', `${rev}:${LEDGER}`]))[0]?.value ?? {}
  const base = vcs(root, ['merge-base', 'HEAD', 'MERGE_HEAD'])
  const [b, ours, theirs] = [read(base), read('HEAD'), read('MERGE_HEAD')]
  const merged = mergeLedgers(b.proposals ?? [], ours.proposals ?? [], theirs.proposals ?? [])
  assert.ok(merged.ok, merged.reason)
  const byId = new Map(merged.entries.map((e) => [String(e.id), e]))
  const mine = (ours.proposals ?? []).map((e) => String(e.id))
  const entries = [...mine.map((id) => byId.get(id)), ...merged.entries.filter((e) => !mine.includes(String(e.id)))]
  return `${JSON.stringify({ ...ours, proposals: entries }, null, 2)}\n`
}
/**
 * Sync's merge of origin/main into ana's trunk (spec §3.12): `merge --no-ff`; a conflicted ledger is written merged by id;
 * `resolve` (when given) then does what a person does by hand before the commit. No Org-Proposal. Answers the short sha.
 */
function sync(root, { resolve, date = at('13:00'), who = 'ana', message = 'sync: merge origin/main into main' } = {}) {
  vcs(root, ['merge', '-q', '--no-ff', '--no-commit', 'origin/main'], { who, date, allow: [0, 1] })
  const unmerged = vcs(root, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)
  if (unmerged.includes(LEDGER) && !resolve) write(root, { [LEDGER]: ledgerById(root) })
  resolve?.(root, unmerged)
  vcs(root, ['commit', '-q', '-m', message], { who, date })
  return short(root)
}
/** Leave a file the merge brought out of it: out of the index, and off the disk. */
function drop(root, rel) {
  vcs(root, ['rm', '-q', '--cached', '--', rel])
  unlinkSync(path.join(root, rel))
}
/** The paths git reports as conflicted for the two parents of `rev`, and the paths where `rev` differs from git's own merge. */
function gitsOwnMerge(root, rev = 'HEAD') {
  // By full hash, as the validator asks: a conflicted file's markers carry the names the two sides are given.
  const out = spawnSync('git', ['-C', root, 'merge-tree', '--write-tree', '--name-only', full(root, `${rev}^1`), full(root, `${rev}^2`)], { encoding: 'utf-8', env: ENV })
  assert.ok([0, 1].includes(out.status), out.stderr)
  const [tree, ...rest] = out.stdout.split('\n')
  const end = rest.indexOf('')
  return { tree, conflicted: rest.slice(0, end === -1 ? undefined : end), differs: vcs(root, ['diff-tree', '-r', '--name-only', tree, `${rev}^{tree}`]).split('\n').filter(Boolean) }
}

// ── the server's own writer, for the remote ratify ───────────────────────────
function server(root, steps) {
  const r = spawnSync('npx', ['tsx', WRITER, JSON.stringify({ repo: root, owner: process.pid, steps: steps.map((s) => ({ ...s, email: EMAIL[s.actor] })) })],
    { cwd: ADMIN, encoding: 'utf-8', env: { ...ENV } })
  assert.equal(r.status, 0, `ledger-write: ${r.stdout}${r.stderr}`)
  const home = /^ledger-write admin home: (.+)$/m.exec(r.stdout)?.[1]
  assert.ok(home && !existsSync(home), `the writer names its admin home and removes it:\n${r.stdout}`)
}
/**
 * The review's case (spec §3.10, H3; proof G): bruno proposes, approves (his own counts) and ratifies on his machine, then
 * shares; ana has a local commit and fetches. `drop` leaves files out of bruno's ratify merge. Built once per `drop` and
 * copied: each test gets ana's clone of its own, fetched and ready to Sync.
 */
const built = new Map()
function remoteRatify({ drop } = {}) {
  const key = JSON.stringify(drop ?? null)
  if (!built.has(key)) {
    const clones = shared(SELF)
    server(clones.b, [
      { open: proposal(ID, 'bruno', OPENED, { rules: [SELF_RULE], slug: 'p2' }), now: OPENED, actor: 'bruno', rule: 'records/approve' },
      { branch: true, id: ID, now: OPENED, actor: 'bruno' },
      { event: { kind: 'approve' }, id: ID, now: at('11:00'), actor: 'bruno' },
      { merge: { commit: '@branch', ...(drop ? { drop } : {}) }, id: ID, now: at('12:00'), actor: 'bruno' },
    ])
    shareAndFetch(clones)
    built.set(key, clones.a)
  }
  const a = path.join(temp('ana'), 'a')
  cpSync(built.get(key), a, { recursive: true })
  return a
}

// ── a git that reports what it is asked (and, given FAKE_GIT_VERSION, says it is that version) ───
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim()
function shim() {
  const dir = temp('git-shim')
  const file = path.join(dir, 'git')
  writeFileSync(file, [
    '#!/bin/sh',
    'if [ -n "$SPY_LOG" ]; then printf \'%s\\n\' "$*" >> "$SPY_LOG"; fi',
    'if [ "$1" = "--version" ] && [ -n "$FAKE_GIT_VERSION" ]; then echo "git version $FAKE_GIT_VERSION"; exit 0; fi',
    `exec '${REAL_GIT}' "$@"`,
    '',
  ].join('\n'))
  chmodSync(file, 0o755)
  return dir
}
/** Run the validator through the shim; answers the run and the git subcommands it ran, with their arguments. */
function spied(args, env = {}) {
  const dir = shim()
  const log = path.join(dir, 'calls.log')
  const r = run(args, { PATH: `${dir}${path.delimiter}${process.env.PATH}`, SPY_LOG: log, ...env })
  const calls = (existsSync(log) ? readFileSync(log, 'utf-8') : '').split('\n').filter(Boolean).map((l) => {
    const words = l.split(' ')
    while (words[0] === '-C' || words[0] === '-c') words.splice(0, 2)
    return { sub: words[0], args: words.slice(1) }
  })
  return { r, calls }
}

// ── the review's case: a divergent Sync after a remote ratify (H3) ───────────

test('H3: a divergent Sync after a remote ratify is clean under --strict; the walk takes bruno\'s ratify merge as one unit and never his content commit', () => {
  const a = remoteRatify()
  const merge = sync(a)
  const [p1, p2] = [full(a, 'HEAD^1'), full(a, 'HEAD^2')]
  const ratify = p2
  const content = full(a, `${ratify}^2`)
  assert.match(vcs(a, ['log', '-1', '--format=%B', ratify]), new RegExp(`Org-Proposal: ${ID}`), 'bruno\'s tip is his ratify merge')
  assert.match(vcs(a, ['log', '-1', '--format=%B', content]), new RegExp(`Org-Proposal: ${ID}`), 'his content commit carries the same trailer')
  assert.equal(vcs(a, ['log', '-1', '--format=%B', 'HEAD']).includes('Org-Proposal'), false, 'the Sync merge carries none')

  const { r, calls } = spied([a, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(resultOf(r), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
  // The Sync merge is expanded along the trunk line and compared with git's own merge; the ratify merge is neither.
  const lists = calls.filter((c) => c.sub === 'rev-list')
  assert.deepEqual(lists.map((c) => c.args), [['--first-parent', '--reverse', `${p1}..${p2}`]], 'one expansion: the Sync merge\'s')
  assert.deepEqual(calls.filter((c) => c.sub === 'merge-tree').map((c) => c.args.slice(-2)), [[p1, p2]], 'one comparison: the Sync merge\'s')
  assert.ok(!calls.some((c) => c.args.some((x) => x.includes(`${full(a, `${ratify}^1`)}..`))), 'the ratify merge is not expanded')

  // Negative control: the first draft's range (`rev-list --no-merges P1..P2`) visits the content commit and skips the ratify merge.
  const firstDraft = vcs(a, ['rev-list', '--no-merges', `${p1}..${p2}`]).split('\n')
  assert.ok(firstDraft.includes(content), 'the first draft walks bruno\'s content commit')
  assert.ok(!firstDraft.includes(ratify), 'and skips his ratify merge')
  const trunkLine = vcs(a, ['rev-list', '--first-parent', `${p1}..${p2}`]).split('\n')
  assert.ok(trunkLine.includes(ratify) && !trunkLine.includes(content), 'the trunk line holds the ratify merge, never the content commit')
  // Judged on its own, the content commit is a finding (its proposal is open in its tree): walking it would report a legitimate history.
  assert.match(vcs(a, ['show', `${content}:${LEDGER}`]), /state: open|"state":"open"/)
  assert.ok(!r.stdout.includes(merge) && !r.stdout.includes(content.slice(0, 7)), r.stdout)
})

test('H3: a ratify merge brought in by a Sync is judged as one unit: one with no decision row is a finding, named for the ratify merge, not its content commit', () => {
  const a = remoteRatify({ drop: ['data/governance.yaml'] })
  sync(a)
  const ratify = short(a, 'HEAD^2')
  const content = short(a, 'HEAD^2^2')
  const r = failing(a, 1)
  const [found] = errorsOf(r)
  assert.ok(found.startsWith(`✗ ${ratify} `), found)
  assert.match(found, /brought in by/)
  assert.match(found, new RegExp(`proposal ${ID}: no decision row for it is added`))
  assert.ok(!r.stdout.includes(content), r.stdout)
})

// ── the expansion ────────────────────────────────────────────────────────────

test('a Sync merge with no trailer is expanded: a governed commit it brings in is a finding, and the merge itself is not', () => {
  const clones = shared()
  const carla = commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla }\n' }, 'carla edits a project', { who: 'carla', date: at('11:00') })
  commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by bruno }\n' }, 'bruno edits a project', { who: 'bruno', date: at('11:10') })
  shareAndFetch(clones)
  const merge = sync(clones.a)
  const r = failing(clones.a, 1)
  const [found] = errorsOf(r)
  assert.ok(found.startsWith(`✗ ${carla} "carla edits a project" (carla@example.org), brought in by ${merge}: records: `), found)
  assert.match(found, /it has no Org-Proposal trailer/)
  assert.ok(!errorsOf(r).some((l) => l.startsWith(`✗ ${merge}`)), r.stdout)
})

test('a nested merge on the incoming line is expanded too, recursively', () => {
  // bruno merges carla's side branch (no trailer) into his trunk, then shares; carla's commit is reachable only through it.
  const clones = shared()
  vcs(clones.b, ['switch', '-q', '-c', 'side'])
  const carla = commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla }\n' }, 'carla edits a project', { who: 'carla', date: at('11:00') })
  vcs(clones.b, ['switch', '-q', 'main'])
  commit(clones.b, { 'docs/b.md': 'bruno\n' }, 'bruno writes a doc', { who: 'bruno', date: at('11:05') })
  vcs(clones.b, ['merge', '-q', '--no-ff', 'side', '-m', 'merge carla\'s side branch'], { who: 'bruno', date: at('11:10') })
  const nested = short(clones.b)
  shareAndFetch(clones)
  sync(clones.a)
  const firstParentOnly = vcs(clones.a, ['rev-list', '--first-parent', 'HEAD^1..HEAD^2']).split('\n').map((h) => h.slice(0, 7))
  assert.ok(firstParentOnly.includes(nested) && !firstParentOnly.includes(carla), 'carla\'s commit is not on the incoming trunk line')
  const r = failing(clones.a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${carla} "carla edits a project" (carla@example.org), brought in by ${nested}: `), r.stdout)
})

test('a commit reachable twice (a crew branch both members merged) is judged once', () => {
  const clones = shared()
  vcs(clones.a, ['switch', '-q', '-c', 'crew'])
  const crew = commit(clones.a, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by the crew }\n' }, 'crew edits a project', { who: 'crew-engineer', date: at('10:30') })
  vcs(clones.a, ['push', '-q', 'origin', 'crew'])
  vcs(clones.a, ['switch', '-q', 'main'])
  vcs(clones.a, ['merge', '-q', '--no-ff', 'crew', '-m', 'land the crew branch'], { who: 'ana', date: at('11:00') })
  vcs(clones.b, ['fetch', '-q', 'origin'])
  vcs(clones.b, ['merge', '-q', '--no-ff', 'origin/crew', '-m', 'land the crew branch'], { who: 'bruno', date: at('11:05') })
  shareAndFetch(clones, { note: false })
  sync(clones.a)
  assert.equal(vcs(clones.a, ['rev-list', '--count', '--merges', 'HEAD']), '3')
  const r = failing(clones.a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${crew} "crew edits a project" (engineer@crew.example)`), r.stdout)
})

test('each commit brought in is judged with the rules and roles of its own parent, not the merge\'s nor the trunk\'s', () => {
  const RAISE = WITH_CARLA
  const history = (rules, steps) => {
    const clones = shared(rules)
    const shas = steps.map(([files, message, who], i) => commit(clones.b, files, message, { who, date: at(`11:${String(10 + i).padStart(2, '0')}`) }))
    shareAndFetch(clones)
    sync(clones.a)
    return { a: clones.a, shas }
  }
  const carlaEdits = [{ 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla }\n' }, 'carla edits a project', 'carla']
  // A role given on the incoming line applies from its commit: at the trunk (and at the merge base) carla holds none.
  const raised = history(DIRECT, [[{ 'data/governance.yaml': RAISE }, 'bruno makes carla a maintainer', 'bruno'], carlaEdits])
  clean(raised.a)
  // A role taken away after her edit does not reach back: in the merge's tree she holds none.
  const lowered = history(WITH_CARLA, [carlaEdits, [{ 'data/governance.yaml': DIRECT }, 'bruno takes carla\'s role away', 'bruno']])
  clean(lowered.a)
  // A role taken away before her edit applies to it, though the trunk still gives it to her.
  const before = history(WITH_CARLA, [[{ 'data/governance.yaml': DIRECT }, 'bruno takes carla\'s role away', 'bruno'], carlaEdits])
  const r = failing(before.a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${before.shas[1]} "carla edits a project"`), r.stdout)
})

test('a crew branch landed with no trailer is expanded: each of its governed commits is a finding, its other commits and the merge are not', () => {
  const root = path.join(temp('crew'), 'repo')
  mkdirSync(root)
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': DIRECT, 'data/projects.yaml': PROJECTS }, 'start', { date: START })
  vcs(root, ['switch', '-q', '-c', 'crew/work'])
  const one = commit(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, first }\n' }, 'crew: first edit', { who: 'crew-engineer', date: at('10:10') })
  const doc = commit(root, { 'docs/crew.md': 'notes\n' }, 'crew: notes', { who: 'crew-engineer', date: at('10:20') })
  const two = commit(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, second }\n' }, 'crew: second edit', { who: 'crew-engineer', date: at('10:30') })
  vcs(root, ['switch', '-q', 'main'])
  vcs(root, ['merge', '-q', '--no-ff', 'crew/work', '-m', 'land the crew branch'], { who: 'ana', date: at('11:00') })
  const merge = short(root)
  const r = failing(root, 2)
  const found = errorsOf(r)
  assert.ok(found[0].startsWith(`✗ ${one} "crew: first edit"`) && found[1].startsWith(`✗ ${two} "crew: second edit"`), r.stdout)
  assert.ok(found.every((l) => l.includes(`brought in by ${merge}`)), r.stdout)
  assert.ok(!r.stdout.includes(doc), r.stdout)
})

// ── the comparison with git's own merge (M-e) ────────────────────────────────

test('M-e: a Sync merge that adds a file of its own (evil.txt) is a finding', () => {
  const clones = shared()
  commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by bruno }\n' }, 'bruno edits a project', { who: 'bruno', date: at('11:00') })
  shareAndFetch(clones)
  const merge = sync(clones.a, { resolve: (root) => write(root, { 'evil.txt': 'not from either side\n' }) })
  const r = failing(clones.a, 1)
  assert.equal(errorsOf(r)[0], `✗ ${merge} "sync: merge origin/main into main" (ana@example.org): it is a merge with no Org-Proposal, and evil.txt is added by the merge, where git's own merge of its parents has no such file: a merge brings in both sides as git merges them, and changes nothing of its own.`)
})

test('M-e (proof ME.3): a Sync merge that silently drops the incoming ledger entry and file is a finding for each; "differs from both parents" passes it', () => {
  const clones = shared()
  open(clones.b, proposal('p-2026-10-18-002-b7c2', 'carla', at('11:00')))
  commit(clones.b, { 'incoming.txt': 'from bruno\n' }, 'bruno adds a file', { who: 'bruno', date: at('11:05') })
  shareAndFetch(clones)
  const merge = sync(clones.a, {
    resolve: (root) => {
      write(root, { [LEDGER]: `${vcs(root, ['show', `HEAD:${LEDGER}`])}\n` })
      drop(root, 'incoming.txt')
    },
  })
  // Negative control: the second draft's rule takes the paths where the merge differs from both parents, and there are none.
  const fromFirst = vcs(clones.a, ['diff-tree', '-r', '--name-only', 'HEAD^1', 'HEAD']).split('\n').filter(Boolean)
  const fromSecond = vcs(clones.a, ['diff-tree', '-r', '--name-only', 'HEAD^2', 'HEAD']).split('\n').filter(Boolean)
  assert.deepEqual(fromFirst.filter((p) => fromSecond.includes(p)), [], 'the second draft reports nothing')
  assert.deepEqual(gitsOwnMerge(clones.a).differs.sort(), ['data/proposals.yaml', 'incoming.txt'])
  const r = failing(clones.a, 2)
  const found = errorsOf(r)
  assert.ok(found.every((l) => l.startsWith(`✗ ${merge} `)), r.stdout)
  assert.ok(found.some((l) => l.includes('data/proposals.yaml is not what git\'s own merge of its parents makes of it')), r.stdout)
  assert.ok(found.some((l) => l.includes('incoming.txt is in git\'s own merge of its parents, and the merge drops it')), r.stdout)
})

test('M-e (14a-2\'s handover): a Sync merge that drops the decision row a remote ratify added is a finding', () => {
  const a = remoteRatify()
  const merge = sync(a, { resolve: (root) => write(root, { 'data/governance.yaml': `${vcs(root, ['show', 'HEAD:data/governance.yaml'])}\n` }) })
  assert.ok(vcs(a, ['show', 'HEAD^2:data/governance.yaml']).includes(`proposal: "${ID}"`), 'the incoming side holds the row')
  assert.ok(!vcs(a, ['show', 'HEAD:data/governance.yaml']).includes(`proposal: "${ID}"`), 'the merge does not')
  const r = failing(a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${merge} "sync: merge origin/main into main" (ana@example.org): it is a merge with no Org-Proposal, and data/governance.yaml is not what git's own merge`), r.stdout)
})

/** carla proposes on bruno's clone, ana on her own; both append to the same empty ledger, so git cannot merge it. */
function twoProposals() {
  const clones = shared()
  open(clones.b, proposal('p-2026-10-18-002-b7c2', 'carla', at('11:00')))
  shareAndFetch(clones, { note: false })
  open(clones.a, proposal('p-2026-10-18-003-c0d4', 'ana', at('11:10')))
  return clones
}

test('M-e (proof ME.4): a conflicted ledger merged by id, in Sync\'s order rather than by id, is clean', () => {
  const { a } = twoProposals()
  let conflicted
  sync(a, { resolve: (root, unmerged) => { conflicted = unmerged; write(root, { [LEDGER]: ledgerById(root) }) } })
  assert.deepEqual(conflicted, [LEDGER], 'git could not merge the ledger')
  const ids = yamlDocuments(vcs(a, ['show', `HEAD:${LEDGER}`]))[0].value.proposals.map((p) => p.id)
  assert.deepEqual(ids, ['p-2026-10-18-003-c0d4', 'p-2026-10-18-002-b7c2'], 'ours first, the incoming one after: not mergeLedgers\' order')
  assert.deepEqual(gitsOwnMerge(a).differs, [LEDGER])
  clean(a)
})

test('M-e: a conflicted ledger resolved by hand that is not mergeLedgers of the base and the two parents is a finding', () => {
  const { a } = twoProposals()
  const merge = sync(a, { resolve: (root) => write(root, { [LEDGER]: `${vcs(root, ['show', `HEAD:${LEDGER}`])}\n` }) })
  const r = failing(a, 1)
  const [found] = errorsOf(r)
  assert.ok(found.startsWith(`✗ ${merge} `), found)
  assert.match(found, /data\/proposals\.yaml was resolved by hand, and it is not the two sides' ledgers merged by id \(mergeLedgers, as Sync merges them\): proposal p-2026-10-18-002-b7c2 is missing/)
})

// ── a conflict resolved by hand (M-1, proof HR) ──────────────────────────────

/** ana and bruno change the same record on their clones (bruno also adds in.txt); ana merges and resolves the conflict by hand. */
function handResolved({ dropIn = false } = {}) {
  const clones = shared()
  commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by bruno }\n', 'in.txt': 'from bruno\n' }, 'bruno renames p1', { who: 'bruno', date: at('11:00') })
  shareAndFetch(clones, { note: false })
  commit(clones.a, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by ana }\n' }, 'ana renames p1', { who: 'ana', date: at('11:10') })
  let conflicted
  const merge = sync(clones.a, {
    message: 'Merge origin/main, p1 resolved by hand',
    resolve: (root, unmerged) => {
      conflicted = unmerged
      write(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by ana and bruno }\n' })
      if (dropIn) drop(root, 'in.txt')
    },
  })
  assert.deepEqual(conflicted, ['data/projects.yaml'])
  return { a: clones.a, merge }
}

test('M-1 (proof HR.A): a conflict resolved by hand is one warning, "resolved by hand", naming the commit, and --strict exits 0', () => {
  const { a, merge } = handResolved()
  // Negative control: the third draft's rule (every path where the merge differs from git's own is a finding) flags the resolution.
  const own = gitsOwnMerge(a)
  assert.deepEqual(own.conflicted, ['data/projects.yaml'])
  assert.deepEqual(own.differs, ['data/projects.yaml'], 'the third draft would report it')
  for (const args of [[a, '--strict'], [a]]) {
    const r = run(args)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(warningsOf(r), [`⚠ ${merge} "Merge origin/main, p1 resolved by hand" (ana@example.org): resolved by hand: \`data/projects.yaml\`, review it.`], r.stdout)
    assert.equal(resultOf(r), 'Results: 2 passed, 0 failed, 1 warnings', r.stdout)
  }
  const ci = run([a], { CI: 'true' })
  assert.equal(ci.status, 0, ci.stdout)
  assert.equal(warningsOf(ci).length, 1, ci.stdout)
})

test('M-1 (proof HR.B): the same merge that also drops a cleanly merged file is a finding for that file', () => {
  const { a, merge } = handResolved({ dropIn: true })
  assert.deepEqual(gitsOwnMerge(a).differs.sort(), ['data/projects.yaml', 'in.txt'])
  const r = failing(a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${merge} `) && errorsOf(r)[0].includes('in.txt is in git\'s own merge of its parents, and the merge drops it'), r.stdout)
  assert.equal(warningsOf(r).length, 1, r.stdout)
  assert.ok(warningsOf(r)[0].endsWith('resolved by hand: `data/projects.yaml`, review it.'), r.stdout)
})

/** ana's merge of origin/main committed exactly as git's own merge leaves it: merge-tree's tree, conflict markers and all. */
function committedWithMarkers(root, message = 'Merge origin/main as git left it') {
  const own = spawnSync('git', ['-C', root, 'merge-tree', '--write-tree', '--name-only', full(root, 'HEAD'), full(root, 'origin/main')], { encoding: 'utf-8', env: ENV })
  assert.equal(own.status, 1, 'git reports a conflict')
  const [tree] = own.stdout.split('\n')
  const sha = vcs(root, ['commit-tree', tree, '-p', 'HEAD', '-p', 'origin/main', '-m', message], { who: 'ana', date: at('13:00') })
  vcs(root, ['merge', '-q', '--ff-only', sha])
  assert.deepEqual(gitsOwnMerge(root).differs, [], 'the merge is git\'s own merge')
  return { merge: sha.slice(0, 7), conflicted: own.stdout.split('\n').slice(1, own.stdout.split('\n').indexOf('', 1)) }
}

test('M-1: a conflicted path committed with git\'s own conflict markers is still "resolved by hand", though it equals git\'s merge', () => {
  const clones = shared()
  commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by bruno }\n' }, 'bruno renames p1', { who: 'bruno', date: at('11:00') })
  shareAndFetch(clones, { note: false })
  commit(clones.a, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by ana }\n' }, 'ana renames p1', { who: 'ana', date: at('11:10') })
  const { merge, conflicted } = committedWithMarkers(clones.a)
  assert.deepEqual(conflicted, ['data/projects.yaml'])
  const r = run([clones.a, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(warningsOf(r), [`⚠ ${merge} "Merge origin/main as git left it" (ana@example.org): resolved by hand: \`data/projects.yaml\`, review it.`], r.stdout)
})

test('M-e: a conflicted ledger committed with git\'s own conflict markers is checked against mergeLedgers, and is a finding', () => {
  const { a } = twoProposals()
  const { merge, conflicted } = committedWithMarkers(a)
  assert.deepEqual(conflicted, [LEDGER])
  const r = failing(a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${merge} `) && errorsOf(r)[0].includes(LEDGER), r.stdout)
})

// ── --range bounds the expansion ─────────────────────────────────────────────

test('--range bounds the expansion: a commit brought in by a Sync is not judged when the range excludes it', () => {
  // The way out spec §6 names (a --range that starts after the commit) works after a Sync too.
  const clones = shared()
  const carla = commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla }\n' }, 'carla edits a project', { who: 'carla', date: at('11:00') })
  shareAndFetch(clones)
  sync(clones.a)
  assert.ok(errorsOf(failing(clones.a, 1))[0].startsWith(`✗ ${carla} `), 'without a range it is a finding')
  const r = run([clones.a, '--strict', '--range', `${full(clones.a, carla)}..HEAD`])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(resultOf(r), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
})

test('--range origin/main..HEAD on a branch that synced main judges only the branch\'s own commits, nested merges included', () => {
  const clones = shared()
  // On the trunk (bruno's clone): carla's governed commit, already landed and judged there, then a merge of a side branch
  // with another of hers.
  const landed = commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla }\n' }, 'carla edits on main', { who: 'carla', date: at('11:00') })
  vcs(clones.b, ['switch', '-q', '-c', 'side'])
  const nested = commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla, side }\n' }, 'carla edits on a side branch', { who: 'carla', date: at('11:05') })
  vcs(clones.b, ['switch', '-q', 'main'])
  vcs(clones.b, ['merge', '-q', '--no-ff', 'side', '-m', 'merge the side branch'], { who: 'bruno', date: at('11:10') })
  vcs(clones.b, ['push', '-q', 'origin', 'main'], { who: 'bruno' })
  // ana's branch `feature` lands a sub-branch `sub` (no trailer) on which carla made a governed commit and main was synced in:
  // the Sync is itself brought in, so the range must bound the nested expansion too.
  vcs(clones.a, ['switch', '-q', '-c', 'feature'])
  const own = commit(clones.a, { 'docs/feature.md': 'feature\n' }, 'a feature note', { who: 'ana', date: at('11:20') })
  vcs(clones.a, ['switch', '-q', '-c', 'sub'])
  const pr = commit(clones.a, { 'data/tasks.yaml': 'tasks:\n  - { id: t1, title: A task }\n' }, 'carla adds a task on the branch', { who: 'carla', date: at('11:30') })
  vcs(clones.a, ['fetch', '-q', 'origin'])
  sync(clones.a, { message: 'sync main into sub' })
  vcs(clones.a, ['switch', '-q', 'feature'])
  vcs(clones.a, ['merge', '-q', '--no-ff', 'sub', '-m', 'land sub'], { who: 'ana', date: at('13:10') })
  const all = failing(clones.a, 3)
  assert.ok([landed, nested, pr].every((sha) => errorsOf(all).some((l) => l.startsWith(`✗ ${sha} `))), all.stdout)
  const r = run([clones.a, '--strict', '--range', 'origin/main..HEAD'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.equal(errorsOf(r).length, 1, r.stdout)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${pr} "carla adds a task on the branch"`), r.stdout)
  assert.ok(!r.stdout.includes(own), r.stdout)
})

// ── the gate on any parent ───────────────────────────────────────────────────

test('M3: a Sync whose incoming side writes the first rules is expanded: a commit those rules forbid is a finding', () => {
  // A solo instance; bruno writes the first rules and carla then makes a change they forbid; ana, still on the solo
  // default and diverged, Syncs. The merge's first parent has no rules, its second does.
  const clones = shared('governance:\n  model: solo-maintainer\n  decisions: []\n')
  commit(clones.b, { 'data/governance.yaml': DIRECT }, 'bruno writes the first rules', { who: 'bruno', date: at('11:00') })
  const carla = commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by carla }\n' }, 'carla edits a project', { who: 'carla', date: at('11:10') })
  shareAndFetch(clones)
  const merge = sync(clones.a)
  const r = failing(clones.a, 1)
  assert.ok(errorsOf(r)[0].startsWith(`✗ ${carla} "carla edits a project" (carla@example.org), brought in by ${merge}: `), r.stdout)
})

// ── read-only, and the git floor ─────────────────────────────────────────────

/** Every ref, HEAD, and every working file's hash; and the repository's objects. */
function snapshot(root) {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === '.git') continue
      const p = path.join(dir, name.name)
      if (name.isDirectory()) walk(p)
      else files.push(`${path.relative(root, p)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`)
    }
  }
  walk(root)
  return {
    refs: vcs(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    head: `${vcs(root, ['symbolic-ref', 'HEAD'])} ${full(root, 'HEAD')}`,
    files: files.sort(),
    objects: new Set(vcs(root, ['cat-file', '--batch-all-objects', '--batch-check']).split('\n')),
  }
}

test('the validator moves no ref and changes no working file; what merge-tree wrote is all it adds to the object store', () => {
  for (const [name, make] of [
    ['an extra file', () => {
      const clones = shared()
      commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by bruno }\n' }, 'bruno edits a project', { who: 'bruno', date: at('11:00') })
      shareAndFetch(clones)
      sync(clones.a, { resolve: (root) => write(root, { 'evil.txt': 'not from either side\n' }) })
      return clones.a
    }],
    ['a conflict resolved by hand', () => handResolved().a],
  ]) {
    // A fresh copy holds only the history's own objects: whatever `git merge` computed on the way is not in it.
    const root = path.join(temp('copy'), 'repo')
    vcs(path.dirname(root), ['clone', '-q', '--no-local', make(), 'repo'])
    const was = snapshot(root)
    run([root, '--strict'])
    const now = snapshot(root)
    assert.equal(now.refs, was.refs, `${name}: refs`)
    assert.equal(now.head, was.head, `${name}: HEAD`)
    assert.deepEqual(now.files, was.files, `${name}: working files`)
    const added = [...now.objects].filter((o) => !was.objects.has(o))
    const { tree } = gitsOwnMerge(root)
    const written = new Set([tree, ...vcs(root, ['ls-tree', '-r', '-t', tree]).split('\n').map((l) => l.split(/\s+/)[2])])
    assert.ok(added.length > 0, `${name}: merge-tree wrote its tree`)
    for (const o of added) assert.ok(written.has(o.split(' ')[0]), `${name}: ${o} is not merge-tree's`)
    if (name === 'an extra file') assert.ok(added.every((o) => o.split(' ')[1] === 'tree'), `${name}: only trees: ${added.join(', ')}`)
  }
})

test('on a git older than 2.38 the merge is not checked, and the validator says so: a warning, an error under --strict', () => {
  const clones = shared()
  commit(clones.b, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, by bruno }\n' }, 'bruno edits a project', { who: 'bruno', date: at('11:00') })
  shareAndFetch(clones)
  const merge = sync(clones.a, { resolve: (root) => write(root, { 'evil.txt': 'not from either side\n' }) })
  const sentence = `${merge} "sync: merge origin/main into main" (ana@example.org): merge expansion needs git 2.38; this merge was not checked.`
  const local = spied([clones.a], { FAKE_GIT_VERSION: '2.34.1' })
  assert.equal(local.r.status, 0, local.r.stdout + local.r.stderr)
  assert.deepEqual(warningsOf(local.r), [`⚠ ${sentence}`], local.r.stdout)
  assert.ok(!local.calls.some((c) => c.sub === 'merge-tree'), 'merge-tree is not asked')
  const strict = spied([clones.a, '--strict'], { FAKE_GIT_VERSION: '2.34.1' })
  assert.equal(strict.r.status, 1, strict.r.stdout)
  assert.deepEqual(errorsOf(strict.r), [`✗ ${sentence}`], strict.r.stdout)
  // With the real git the same merge is checked: its extra file is found.
  assert.ok(errorsOf(failing(clones.a, 1))[0].includes('evil.txt is added by the merge'))
})

// ── the solo shape (M3): the merges are not walked at all ────────────────────

const SOLO = 'governance:\n  model: solo-maintainer\n  decisions: []\n'
const SOLO_MEMBERS = 'members:\n  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }\n'
const SOLO_RULES = `governance:
  model: consensus
  roles:
    maintainer: { members: [ana] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
    - { id: rest, applies_to: [members, governance, identity, systems, treasury, operations, publication], propose: maintainer, decide: { by: maintainer, method: direct } }
  decisions: []
`
/** Task 14a-1's solo shape: 300 commits on main, 30 of them merges of a side branch, no trailer, no ledger; fast-import, then `read-tree HEAD`. */
function soloHistory() {
  const root = path.join(temp('solo'), 'repo')
  mkdirSync(root)
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
  const projects = (n) => `projects:\n  - { id: p1, title: "Fixture ${n}" }\n`
  let main = commitTo('refs/heads/main', null, { 'data/members.yaml': SOLO_MEMBERS, 'data/governance.yaml': SOLO, 'data/projects.yaml': projects(0) }, 'start')
  let count = 1
  for (let round = 0; round < 30; round++) {
    const side = commitTo('refs/heads/side', main, { [`docs/side-${round}.md`]: `side ${round}\n` }, `side work ${round}`, { email: 'friend@example.net' })
    count++
    for (let i = 0; i < 7; i++) {
      const n = round * 7 + i + 1
      main = commitTo('refs/heads/main', main, n % 3 === 0 ? { [`docs/note-${n}.md`]: `note ${n}\n` } : { 'data/projects.yaml': projects(n) }, `work ${n}`, { email: n % 2 === 0 ? 'ana@example.org' : 'laptop@example.net' })
      count++
    }
    main = commitTo('refs/heads/main', main, {}, `Merge branch 'side' (${round})`, { merge: side })
    count++
  }
  while (count < 300) { main = commitTo('refs/heads/main', main, { 'data/projects.yaml': projects(1000 + count) }, `tail ${count}`); count++ }
  const r = spawnSync('git', ['-C', root, 'fast-import', '--quiet'], { encoding: 'utf-8', input: `${out.join('\n')}\n`, env: ENV })
  assert.equal(r.status, 0, r.stderr)
  vcs(root, ['read-tree', 'HEAD'])
  for (const rel of ['data/members.yaml', 'data/governance.yaml', 'data/projects.yaml']) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), `${vcs(root, ['show', `HEAD:${rel}`])}\n`)
  }
  return root
}

test('M3: in a solo history the thirty merges are not walked at all (no rev-list, no merge-tree); once rules are written, a merge is', () => {
  const root = soloHistory()
  assert.equal(vcs(root, ['rev-list', '--count', '--merges', 'HEAD']), '30')
  const solo = spied([root, '--strict'])
  assert.equal(solo.r.status, 0, solo.r.stdout + solo.r.stderr)
  assert.equal(resultOf(solo.r), 'Results: 2 passed, 0 failed, 0 warnings', solo.r.stdout)
  assert.deepEqual(solo.calls.filter((c) => ['rev-list', 'merge-tree'].includes(c.sub)), [], 'nothing of the expansion runs')
  // The spy sees an expansion when there is one: rules written, then a side branch merged with no trailer.
  commit(root, { 'data/governance.yaml': SOLO_RULES }, 'adopt rules', { who: 'ana' })
  vcs(root, ['switch', '-q', '-c', 'later'])
  commit(root, { 'docs/later.md': 'later\n' }, 'a later note', { who: 'ana' })
  vcs(root, ['switch', '-q', 'main'])
  vcs(root, ['merge', '-q', '--no-ff', 'later', '-m', 'merge a later note'], { who: 'ana' })
  const ruled = spied([root, '--strict'])
  assert.equal(ruled.r.status, 0, ruled.r.stdout)
  assert.equal(ruled.calls.filter((c) => c.sub === 'rev-list').length, 1, 'one merge under written rules, one expansion')
  assert.equal(ruled.calls.filter((c) => c.sub === 'merge-tree').length, 1)
})
