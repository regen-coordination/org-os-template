// tests/scripts/validate-governance.ledger.test.mjs
//
// validate:governance judges the ledger (0.6 P2 spec §3.10, P2-R13, P2-R30): a new proposal and every new
// event, against the rules, roles and ledger at the commit's own parent, and their times against the commit's
// date. Every repository is a throwaway one built under the OS temp dir by the test itself (`-C <root>` on every
// git call); the positive histories are written by the server's own ledger functions (fixtures/ledger-write.mjs,
// run with tsx), the negative ones by hand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'
import { revOf } from '../../packages/admin/lib/proposals.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')
const ADMIN = path.join(ORG_ROOT, 'packages', 'admin')
const WRITER = path.join(ORG_ROOT, 'tests', 'scripts', 'fixtures', 'ledger-write.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' }
// A git variable from the caller (a hook, an editor) would point every git call here at another repository.
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key]
const EMAIL = { ana: 'ana@example.org', bruno: 'bruno@example.org', carla: 'carla@example.org', 'crew-engineer': 'engineer@crew.example' }

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
function commit(root, files, message, opts) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', message], opts)
  return vcs(root, ['rev-parse', '--short', 'HEAD'])
}
const run = (args, env = {}) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: { ...ENV, ...env } })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const findingsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗') || l.startsWith('⚠'))

const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }
  - { id: bruno, name: Bruno, handles: { git: [bruno@example.org] } }
  - { id: carla, name: Carla, handles: { git: [carla@example.org] } }
  - { id: crew-engineer, name: Engineer seat, kind: agent, handles: { git: [engineer@crew.example] } }
`
// records need one approval from a maintainer (ana or bruno); the rest is decided directly by one.
const RULES = `governance:
  model: consensus
  roles:
    maintainer: { members: [ana, bruno] }
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
const SELF_RULES = RULES.replace('decide: { by: maintainer, method: approve, count: 1 }', 'decide: { by: maintainer, method: approve, count: 1 }\n      self_approve: true')
const VOTE_RULES = RULES.replace('method: approve, count: 1', 'method: vote, window: P3D, quorum: 1, threshold: 0.5')
// records are bruno's to decide alone; anyone else proposes. (The first `method: direct` is the records rule's.)
const DIRECT_RULES = RULES.replace('maintainer: { members: [ana, bruno] }', 'maintainer: { members: [bruno] }')
  .replace('decide: { by: maintainer, method: approve, count: 1 }', 'decide: { by: maintainer, method: direct }')

// The snapshot `ruleFor` gives for `records` under each file, as Propose stores it.
const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const SELF_RULE = { ...RULE, self_approve: true }
const VOTE_RULE = { ...RULE, decide: { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 1, threshold: 0.5 } }
const DIRECT_RULE = { ...RULE, decide: { by: 'maintainer', method: 'direct' } }

const ID = 'p-2026-10-18-001-a3f9'
const OPS = [{ op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two' }, base: null }]
const START = '2026-10-18T10:00:00Z'
const OPENED = '2026-10-18T10:02:00Z'
const at = (hhmm) => `2026-10-18T${hhmm}:00Z`

/** A proposal as Propose writes it, with `over` on top. */
const proposal = (over = {}) => ({
  id: ID, title: 'Add project two', author: 'ana', classes: ['records'], rules: [RULE], state: 'open', opened: OPENED,
  rev: revOf(OPS), base: null, branch: `proposal/${ID}`, ops: OPS, events: [], closed: null, ...over,
})
/** The ledger text for these proposals: JSON is YAML. */
const ledger = (...entries) => `proposals:\n${entries.map((e) => `  - ${JSON.stringify(e)}\n`).join('')}`
const trailers = (actor, id = ID) => `\n\nOrg-Actor: ${actor}\nOrg-Rule: records/approve\nOrg-Proposal: ${id}`

/** A repository with members and rules, committed at START. */
function start(rules = RULES) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-ledger-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': rules, 'data/projects.yaml': 'projects:\n  - { id: p1, title: One }\n' }, 'start', { date: START })
  return root
}
/** Propose by hand: the entry in its own commit, with the trailers the server writes. */
function open(root, entry = proposal(), { who = entry.author, date = OPENED, message } = {}) {
  return commit(root, { 'data/proposals.yaml': ledger(entry) }, message ?? `proposals: open ${entry.id} — ${entry.title}${trailers(who, entry.id)}`, { who, date })
}
/** An event by hand: the entry at the parent plus `events`, in one commit by `who` at `date`. */
function event(root, entry, events, { who, date, message } = {}) {
  const next = { ...entry, events: [...entry.events, ...events] }
  const sha = commit(root, { 'data/proposals.yaml': ledger(next) }, message ?? `proposals: ${events[0].kind} ${entry.id}${trailers(who, entry.id)}`, { who, date })
  return { sha, entry: next }
}
/** Run the validator under --strict; it must fail, and a finding must name the commit, the proposal and `sentence`. */
function finds(root, sha, sentence) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const found = findingsOf(r).filter((l) => l.includes(sha) && l.includes(`proposal ${ID}`))
  assert.ok(found.some((l) => (sentence instanceof RegExp ? sentence.test(l) : l.includes(sentence))), `no finding for ${sha} says ${sentence}:\n${r.stdout}`)
  return found
}
function clean(root) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
}

/** Write with the server's own ledger functions (createEntry, writeEvent): the history the platform makes. */
// Where the admin server keeps its state when nothing says otherwise (server/state.ts): the operator's own. Read, never written.
const ADMIN_HOME = process.env.ORG_OS_ADMIN_HOME ?? path.join(homedir(), '.org-os', 'admin')
const adminHomeListing = () => (existsSync(ADMIN_HOME) ? readdirSync(ADMIN_HOME).sort() : [])
// This file's writers only: other test files run theirs at the same time.
const writerHomes = () => readdirSync(tmpdir()).filter((n) => n.startsWith(`ledger-write-admin-${process.pid}-`)).sort()
const writer = (root, steps) => spawnSync('npx', ['tsx', WRITER, JSON.stringify({ repo: root, owner: process.pid, steps: steps.map((s) => ({ ...s, email: EMAIL[s.actor] })) })],
  { cwd: ADMIN, encoding: 'utf-8', env: { ...ENV } })
function server(root, steps) {
  const r = writer(root, steps)
  assert.equal(r.status, 0, `ledger-write: ${r.stdout}${r.stderr}`)
  // The writer names the admin home it made; that exact directory is gone once it has finished.
  const home = /^ledger-write admin home: (.+)$/m.exec(r.stdout)?.[1]
  assert.ok(home && path.basename(home).startsWith(`ledger-write-admin-${process.pid}-`), `the writer names its admin home:\n${r.stdout}`)
  assert.equal(existsSync(home), false, `the writer left ${home} behind`)
}
const opened = (actor = 'ana', now = OPENED) => ({ open: proposal({ author: actor, opened: now }), now, actor, rule: 'records/approve' })
const wrote = (actor, kind, now, more = {}) => ({ event: { kind, ...more }, id: ID, now, actor })

// ── passing ──────────────────────────────────────────────────────────────────

test('passing: a proposal written by the server, then two events, is clean under --strict', () => {
  const root = start()
  server(root, [opened(), wrote('carla', 'comment', at('10:30'), { text: 'Looks right to me.' }), wrote('bruno', 'approve', at('11:00'))])
  const log = vcs(root, ['log', '--format=%s'])
  assert.deepEqual(log.split('\n'), [`proposals: approve ${ID}`, `proposals: comment ${ID}`, `proposals: open ${ID} — Add project two`, 'start'])
  clean(root)
})

test('M5: two machines\' events interleaved, their `at` minutes apart and out of order, are clean', () => {
  // bruno's machine writes at 11:05; carla's, whose clock is four minutes behind, writes after it at 11:01.
  const root = start()
  server(root, [opened(), wrote('bruno', 'comment', at('11:05'), { text: 'From one machine.' }), wrote('carla', 'comment', at('11:01'), { text: 'From another.' })])
  clean(root)
})

test('a Sync merge from another clone, with no trailer, is clean: the walk does not judge the other machine\'s events as the merger\'s', () => {
  // ana opens; bruno, on his own clone, comments at 11:00; ana writes a note at 11:05, fetches bruno's work and merges it at 13:00.
  const root = start()
  open(root)
  const other = mkdtempSync(path.join(tmpdir(), 'validate-governance-ledger-clone-'))
  vcs(root, ['clone', '-q', '--local', '.', other])
  event(other, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'comment', text: 'From my machine.' }], { who: 'bruno', date: at('11:00') })
  commit(root, { 'docs/note.md': 'a local note\n' }, 'a local note', { who: 'ana', date: at('11:05') })
  vcs(root, ['fetch', '-q', other, 'main'], { who: 'ana' })
  vcs(root, ['merge', '-q', 'FETCH_HEAD', '-m', 'Merge the remote trunk'], { who: 'ana', date: at('13:00') })
  assert.equal(vcs(root, ['rev-list', '--count', '--merges', 'HEAD']), '1')
  assert.ok(vcs(root, ['show', 'HEAD:data/proposals.yaml']).includes('From my machine.'))
  clean(root)
})

test('Keep mine that changes the content is recorded as a revise by the server, and the history it writes is clean', () => {
  // The op sets p1's title and status; bruno (who decides records alone) sets the same status on the trunk. Keep mine drops the
  // field the trunk already holds, so the ops and the rev change: that is a revision, not a replay (spec §3.5, P2-R7).
  const root = start(DIRECT_RULES)
  const home = adminHomeListing()
  const temps = writerHomes()
  const ops = [{ op: 'update', record: 'projects:p1', set: { title: 'One, renamed', status: 'archive' }, base: '@current' }]
  const entry = proposal({ rules: [DIRECT_RULE], ops, rev: revOf(ops), base: '@head' })
  server(root, [{ open: entry, now: OPENED, actor: 'ana', rule: 'records/direct' }, { branch: true, id: ID, now: OPENED, actor: 'ana' }])
  commit(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, status: archive }\n' }, 'archive p1', { who: 'bruno', date: at('10:30') })
  server(root, [{ replay: 'mine', id: ID, now: at('11:00'), actor: 'ana', rule: 'records/direct' }])
  const after = vcs(root, ['show', 'HEAD:data/proposals.yaml'])
  const kept = [{ op: 'update', record: 'projects:p1', set: { title: 'One, renamed' } }]
  assert.ok(after.includes(`kind: revise`) && after.includes(revOf(kept)), after)
  clean(root)
  // Building and replaying the branch checks out worktrees in the admin's state directory: the writer gives it one of its
  // own in the temp dir, so the operator's admin home gains nothing.
  assert.deepEqual(adminHomeListing(), home, `the writer left something in ${ADMIN_HOME}`)
  assert.deepEqual(writerHomes(), temps, 'the writer removes the admin home it made')
})

test('the writer refuses a directory under the temp dir that is not a repository root of its own', () => {
  // data/ of a throwaway repository: git would find the repository above it. The step is read-only.
  const root = start()
  const r = writer(path.join(root, 'data'), [wrote('bruno', 'comment', at('11:00'), { text: 'nowhere' })])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /ledger-write refuses .*: it is not the root of a git repository of its own/)
})

test('the writer refuses a repository that is not under the OS temp dir, even through a link that sits there', () => {
  // The link is in the temp dir; where it leads is not. The step is read-only, so even an unguarded writer would change nothing.
  const link = path.join(mkdtempSync(path.join(tmpdir(), 'validate-governance-ledger-link-')), 'repo')
  symlinkSync('/', link)
  const r = writer(link, [wrote('bruno', 'comment', at('11:00'), { text: 'nowhere' })])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /ledger-write refuses .*: it writes only to a repository under the OS temp dir/)
})

// ── a new proposal ───────────────────────────────────────────────────────────

test('a new proposal with a laxer rule snapshot than the one in force is a finding', () => {
  const root = start()
  const sha = open(root, proposal({ rules: [{ ...RULE, decide: { by: 'maintainer', method: 'direct' } }] }))
  finds(root, sha, 'its rules are not the ones in force at its parent')
})

test('a new proposal by an author who may not propose under its rule is a finding', () => {
  const root = start()
  const sha = open(root, proposal({ author: 'crew-engineer' }))
  finds(root, sha, '"crew-engineer" does not hold the member role, which rule "records" asks of whoever proposes.')
})

test('a new proposal whose author is not the commit\'s actor is a finding', () => {
  const root = start()
  const sha = open(root, proposal({ author: 'carla' }), { who: 'bruno' })
  finds(root, sha, 'its author is "carla", and the commit was made by "bruno"')
})

test('a new proposal whose `classes` do not cover its ops is a finding', () => {
  const root = start()
  const ops = [...OPS, { op: 'create', record: 'members:dora', value: { id: 'dora', name: 'Dora' }, base: null }]
  const sha = open(root, proposal({ ops, rev: revOf(ops) }))
  finds(root, sha, 'op on members:dora is class members, which `classes` does not list')
})

test('a new proposal with no Org-Proposal trailer is a finding', () => {
  const root = start()
  const sha = open(root, proposal(), { message: `proposals: open ${ID}\n\nOrg-Actor: ana\nOrg-Rule: records/approve` })
  finds(root, sha, `the commit carries no Org-Proposal trailer naming ${ID}`)
})

test('M5: a new proposal whose `opened` is stale against its commit is a finding', () => {
  const root = start()
  const sha = open(root, proposal({ opened: '2026-09-27T10:02:00Z' }))
  finds(root, sha, /it was opened at 2026-09-27T10:02:00Z, 21 days before the commit that adds it/)
})

test('a new proposal not opened as open is a finding', () => {
  const root = start()
  const sha = open(root, proposal({ state: 'ratified', closed: { at: OPENED, by: 'ana', decision: null } }))
  finds(root, sha, 'a new proposal opens as open, and this one is ratified')
})

// ── new events ───────────────────────────────────────────────────────────────

test('an event whose `by` is not the commit\'s actor is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'ana', kind: 'comment', text: 'hi' }], { who: 'bruno', date: at('11:00') })
  finds(root, sha, 'event e-1 says it is by "ana", and the commit was made by "bruno"')
})

test('approve by the author is a finding, and clean when the rule snapshot sets self_approve', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'ana', kind: 'approve', rev: revOf(OPS) }], { who: 'ana', date: at('11:00') })
  finds(root, sha, 'event e-1: "ana" wrote this proposal and cannot approve their own proposal')

  const self = start(SELF_RULES)
  open(self, proposal({ rules: [SELF_RULE] }))
  event(self, proposal({ rules: [SELF_RULE] }), [{ id: 'e-1', at: at('11:00'), by: 'ana', kind: 'approve', rev: revOf(OPS) }], { who: 'ana', date: at('11:00') })
  clean(self)
})

test('approve by a non-decider is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'carla', kind: 'approve', rev: revOf(OPS) }], { who: 'carla', date: at('11:00') })
  finds(root, sha, 'event e-1: "carla" does not hold the maintainer role, which decides this proposal.')
})

test('an objection with no text is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'object', rev: revOf(OPS) }], { who: 'bruno', date: at('11:00') })
  finds(root, sha, 'an objection needs its text')
})

test('a retract of another member\'s event is a finding', () => {
  const root = start()
  open(root)
  const first = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'comment', text: 'mine' }], { who: 'bruno', date: at('11:00') })
  const { sha } = event(root, first.entry, [{ id: 'e-2', at: at('11:10'), by: 'carla', kind: 'retract', of: 'e-1' }], { who: 'carla', date: at('11:10') })
  finds(root, sha, 'event e-2: only the person who wrote an event can take it back; "e-1" was written by "bruno".')
})

test('an event for another `rev` than the proposal\'s is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'approve', rev: 'deadbeef0000' }], { who: 'bruno', date: at('11:00') })
  finds(root, sha, `event e-1 is about rev deadbeef0000, and the proposal is at rev ${revOf(OPS)}`)
})

test('an event whose id is already used in the proposal is a finding, said once', () => {
  const root = start()
  open(root)
  const first = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'comment', text: 'one' }], { who: 'bruno', date: at('11:00') })
  const { sha } = event(root, first.entry, [{ id: 'e-1', at: at('11:10'), by: 'carla', kind: 'comment', text: 'two' }], { who: 'carla', date: at('11:10') })
  const found = finds(root, sha, 'event id e-1 is already used in this proposal')
  assert.equal(found.filter((l) => l.includes('e-1')).length, 1, found.join('\n'))
})

test('a vote at or after the vote\'s closedAt is a finding', () => {
  // Both deciders have voted by 11:10, so the vote closed then; ana's second ballot at 11:20 is not counted.
  const root = start(VOTE_RULES)
  const p = proposal({ rules: [VOTE_RULE] })
  open(root, p)
  const one = event(root, p, [{ id: 'e-1', at: at('11:00'), by: 'ana', kind: 'vote', vote: 'yes', rev: revOf(OPS) }], { who: 'ana', date: at('11:00') })
  const two = event(root, one.entry, [{ id: 'e-2', at: at('11:10'), by: 'bruno', kind: 'vote', vote: 'no', rev: revOf(OPS) }], { who: 'bruno', date: at('11:10') })
  assert.equal(run([root, '--strict']).status, 0, 'the two ballots before the close are clean')
  const { sha } = event(root, two.entry, [{ id: 'e-3', at: at('11:20'), by: 'ana', kind: 'vote', vote: 'no', rev: revOf(OPS) }], { who: 'ana', date: at('11:20') })
  finds(root, sha, 'event e-3 is a vote written after the vote closed, so it is not counted')
})

test('a system event with no attach before it is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'system:treasury', kind: 'system', rev: revOf(OPS), outcome: 'executed' }],
    { who: 'ana', date: at('11:00'), message: `proposals: system ${ID}\n\nOrg-Actor: system:treasury\nOrg-Rule: records/approve\nOrg-Proposal: ${ID}` })
  finds(root, sha, 'event e-1 reads an outside system, and no attach for this rev comes before it')
})

test('M5: an event whose `at` is weeks before its commit is a finding', () => {
  // Opened on 1 September; an event dated 20 September is committed on 18 October.
  const root = start()
  const p = proposal({ opened: '2026-09-01T10:02:00Z' })
  open(root, p, { date: '2026-09-01T10:02:00Z' })
  const { sha } = event(root, p, [{ id: 'e-1', at: '2026-09-20T11:00:00Z', by: 'bruno', kind: 'comment', text: 'late' }], { who: 'bruno', date: at('11:00') })
  const found = finds(root, sha, /event e-1 is dated 2026-09-20T11:00:00Z, 28 days before the commit that adds it/)
  assert.ok(!found.some((l) => l.includes('before the proposal was opened')), found.join('\n'))
})

test('an event dated before the proposal was opened is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: '2026-10-18T09:40:00Z', by: 'bruno', kind: 'comment', text: 'early' }], { who: 'bruno', date: '2026-10-18T09:45:00Z' })
  finds(root, sha, `event e-1 is dated 2026-10-18T09:40:00Z, before the proposal was opened (${OPENED})`)
})

test('`ops` and `rev` changed with no revise event is a finding', () => {
  const root = start()
  open(root)
  const ops = [{ ...OPS[0], value: { id: 'p2', title: 'Two, renamed' } }]
  const sha = commit(root, { 'data/proposals.yaml': ledger(proposal({ ops, rev: revOf(ops) })) }, `proposals: edit ${ID}${trailers('ana')}`, { who: 'ana', date: at('11:00') })
  finds(root, sha, 'its ops changed with no revise event by its author in the same commit')
})

test('a new proposal whose `rev` is not the rev of its ops is a finding', () => {
  const root = start()
  const sha = open(root, proposal({ rev: 'deadbeef0000' }))
  finds(root, sha, `its rev deadbeef0000 is not the rev of its ops (${revOf(OPS)})`)
})

test('a revise by its author with the rev of the new ops is clean; with another rev it is a finding', () => {
  const ops = [{ ...OPS[0], value: { id: 'p2', title: 'Two, renamed' } }]
  const revise = (rev) => {
    const root = start()
    open(root)
    const sha = commit(root, { 'data/proposals.yaml': ledger(proposal({ ops, rev, events: [{ id: 'e-1', at: at('11:00'), by: 'ana', kind: 'revise', rev }] })) },
      `proposals: revise ${ID}${trailers('ana')}`, { who: 'ana', date: at('11:00') })
    return { root, sha }
  }
  clean(revise(revOf(ops)).root)
  const { root, sha } = revise('deadbeef0000')
  finds(root, sha, `its rev deadbeef0000 is not the rev of its ops (${revOf(ops)})`)
})

test('an event the commit rewrites or removes is a finding: events are append-only', () => {
  const root = start()
  open(root)
  const first = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'object', rev: revOf(OPS), text: 'It harms the aim.' }], { who: 'bruno', date: at('11:00') })
  assert.ok(first)
  const sha = commit(root, { 'data/proposals.yaml': ledger(proposal()) }, `proposals: tidy ${ID}${trailers('ana')}`, { who: 'ana', date: at('11:10') })
  finds(root, sha, 'event e-1 was changed or removed')
})

test('an event committed from an address no member holds is a finding', () => {
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'comment', text: 'hi' }], { who: 'laptop@example.net', date: at('11:00') })
  finds(root, sha, 'no member of data/members.yaml commits with that address, so it can neither open a proposal nor write an event')
})

test('the rules, author and opening time of an open proposal are fixed: a commit that changes one is a finding', () => {
  const root = start()
  open(root)
  const sha = commit(root, { 'data/proposals.yaml': ledger(proposal({ rules: [{ ...RULE, decide: { by: 'maintainer', method: 'direct' } }] })) },
    `proposals: edit ${ID}${trailers('ana')}`, { who: 'ana', date: at('11:00') })
  finds(root, sha, 'its `rules` changed; it is fixed when the proposal is opened')
})

test('a ledger finding is a warning locally, an error under --strict and CI=true', () => {
  const root = start()
  open(root, proposal({ author: 'carla' }), { who: 'bruno' })
  const local = run([root])
  assert.equal(local.status, 0, local.stdout)
  assert.ok(findingsOf(local).every((l) => l.startsWith('⚠')) && findingsOf(local).length > 0, local.stdout)
  for (const r of [run([root, '--strict']), run([root], { CI: 'true' })]) {
    assert.equal(r.status, 1, r.stdout)
    assert.ok(findingsOf(r).every((l) => l.startsWith('✗')), r.stdout)
  }
})

test('the ledger is judged by the rules and roles at the commit\'s own parent, not the ones a later commit writes', () => {
  // carla's approve is a finding under the roles in force when she wrote it; making her a maintainer later does not clear it.
  const root = start()
  open(root)
  const { sha } = event(root, proposal(), [{ id: 'e-1', at: at('11:00'), by: 'carla', kind: 'approve', rev: revOf(OPS) }], { who: 'carla', date: at('11:00') })
  commit(root, { 'data/governance.yaml': RULES.replace('[ana, bruno]', '[ana, bruno, carla]') }, 'carla joins the maintainers', { who: 'ana', date: at('11:30') })
  finds(root, sha, '"carla" does not hold the maintainer role')
})
