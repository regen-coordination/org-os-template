// tests/scripts/validate-governance.closings.test.mjs
//
// validate:governance judges the closings and a ratify by its content (0.6 P2 spec §3.8, §3.9, §3.10, M4; P2-R13, R15,
// R16): a ratify only in a merge whose evaluation is met at the merge's date, with its decision row, whose second parent
// stands on its first and whose records are the ops' result; a reject, an expire and a withdraw only when the
// evaluation (or the author) says so; a closed proposal never changes and no proposal leaves the ledger; a decision row
// only with the closing of its proposal, equal to what the evaluation produces. Every repository is a throwaway one
// built under the OS temp dir by the test itself (`-C <root>` on every git call); the ratify merges and the closings are
// written by the server's own functions (fixtures/ledger-write.mjs, run with tsx), the wrong ones by those functions
// with a step left out or a branch commit made by hand.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
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
function commit(root, files, message, opts) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
    vcs(root, ['add', '--', rel])
  }
  vcs(root, ['commit', '-q', '-m', message], opts)
  return head(root)
}
const head = (root) => vcs(root, ['rev-parse', 'HEAD']).slice(0, 7)
const run = (args, env = {}) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: { ...ENV, ...env } })
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean)
const findingsOf = (r) => lines(r.stdout).filter((l) => l.startsWith('✗') || l.startsWith('⚠'))

const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }
  - { id: bruno, name: Bruno, handles: { git: [bruno@example.org] } }
  - { id: carla, name: Carla, handles: { git: [carla@example.org] } }
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
const VOTE_RULES = RULES.replace('method: approve, count: 1', 'method: vote, window: P3D, quorum: 1, threshold: 0.5')
const CONSENT_RULES = RULES.replace('method: approve, count: 1', 'method: consent, window: PT1H')
const DECISIONS_MD = '# Decisions\n\n## Conventions\n\nThe newest decision comes first.\n\n---\n'

const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const VOTE_RULE = { ...RULE, decide: { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 1, threshold: 0.5 } }
const CONSENT_RULE = { ...RULE, decide: { by: 'maintainer', method: 'consent', window: 'PT1H' } }

const ID = 'p-2026-10-18-001-a3f9'
const OPS = [{ op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two' }, base: null }]
const START = '2026-10-18T10:00:00Z'
const OPENED = '2026-10-18T10:02:00Z'
const at = (hhmm) => `2026-10-18T${hhmm}:00Z`
const PROJECTS = 'projects:\n  - { id: p1, title: One }\n'

/** A proposal as Propose writes it, with `over` on top. */
const proposal = (over = {}) => ({
  id: ID, title: 'Add project two', author: 'ana', classes: ['records'], rules: [RULE], state: 'open', opened: OPENED,
  rev: revOf(OPS), base: null, branch: `proposal/${ID}`, ops: OPS, events: [], closed: null, ...over,
})
const ledger = (...entries) => `proposals:\n${entries.map((e) => `  - ${JSON.stringify(e)}\n`).join('')}`
const trailers = (actor, id = ID) => `\n\nOrg-Actor: ${actor}\nOrg-Rule: records/approve\nOrg-Proposal: ${id}`

/** A repository with members and rules, committed at START. */
function start(rules = RULES, more = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-closings-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': rules, 'data/projects.yaml': PROJECTS, ...more }, 'start', { date: START })
  return root
}
/** Run the validator under --strict; it must fail, and a finding must name the commit, the proposal and `sentence`. */
function finds(root, sha, sentence, id = ID) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const found = findingsOf(r).filter((l) => l.includes(sha) && l.includes(`proposal ${id}`))
  assert.ok(found.some((l) => (sentence instanceof RegExp ? sentence.test(l) : l.includes(sentence))), `no finding for ${sha} says ${sentence}:\n${r.stdout}`)
  return found
}
function clean(root) {
  const r = run([root, '--strict'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings', r.stdout)
}

// Where the admin server keeps its state when nothing says otherwise (server/state.ts): the operator's own. Read, never written.
const ADMIN_HOME = process.env.ORG_OS_ADMIN_HOME ?? path.join(homedir(), '.org-os', 'admin')
const adminHomeListing = () => (existsSync(ADMIN_HOME) ? readdirSync(ADMIN_HOME).sort() : [])
/** Write with the server's own functions: the history the platform makes (or, with a step's options, nearly makes). */
function server(root, steps) {
  const r = spawnSync('npx', ['tsx', WRITER, JSON.stringify({ repo: root, owner: process.pid, steps: steps.map((s) => ({ ...s, email: EMAIL[s.actor] })) })],
    { cwd: ADMIN, encoding: 'utf-8', env: { ...ENV } })
  assert.equal(r.status, 0, `ledger-write: ${r.stdout}${r.stderr}`)
  // The writer names the admin home it made; that exact directory is gone once it has finished.
  const home = /^ledger-write admin home: (.+)$/m.exec(r.stdout)?.[1]
  assert.ok(home && path.basename(home).startsWith(`ledger-write-admin-${process.pid}-`), `the writer names its admin home:\n${r.stdout}`)
  assert.equal(existsSync(home), false, `the writer left ${home} behind`)
}
const opened = (entry = proposal(), rule = 'records/approve') => ({ open: entry, now: entry.opened, actor: entry.author, rule })
const wrote = (actor, kind, now, more = {}) => ({ event: { kind, ...more }, id: ID, now, actor })
const branch = () => ({ branch: true, id: ID, now: OPENED, actor: 'ana' })
const merged = (now, merge = {}, actor = 'bruno') => ({ merge: { commit: '@branch', ...merge }, id: ID, now, actor })
const closing = (kind, actor, now, more = {}) => ({ closing: kind, id: ID, now, actor, ...more })

/** Opened by the server, built, approved by bruno at 11:00: ready to ratify. */
function approved(entry = proposal(), more = {}) {
  const root = start(RULES, more)
  server(root, [opened(entry), branch(), wrote('bruno', 'approve', at('11:00'))])
  return root
}
/** A branch commit made by hand on the trunk's tip (or `on`), with `files`, as a buildBranch that went wrong would leave it. */
function handBranch(root, files, { on = 'HEAD', empty = false } = {}) {
  vcs(root, ['switch', '-q', '-c', 'hand', on])
  if (empty) vcs(root, ['commit', '-q', '--allow-empty', '-m', `proposals: content of ${ID}`], { who: 'ana', date: at('11:30') })
  else commit(root, files, `proposals: content of ${ID}`, { who: 'ana', date: at('11:30') })
  const sha = vcs(root, ['rev-parse', 'HEAD'])
  vcs(root, ['switch', '-q', 'main'])
  return sha
}
const isMerge = (root) => vcs(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length === 3

// ── passing ──────────────────────────────────────────────────────────────────

test('passing: a proposal ratified by the server (the route\'s whole path: one merge) is clean under --strict', () => {
  const home = adminHomeListing()
  const root = approved()
  server(root, [{ ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  assert.ok(isMerge(root), 'ratify is one merge commit')
  const gov = vcs(root, ['show', 'HEAD:data/governance.yaml'])
  assert.ok(gov.includes(`proposal: "${ID}"`) && gov.includes('outcome: "ratified"'), gov)
  clean(root)
  assert.deepEqual(adminHomeListing(), home, `the writer left something in ${ADMIN_HOME}`)
})

test('passing: a proposal withdrawn by its author is clean', () => {
  const root = start()
  server(root, [opened(), { close: 'withdrawn', id: ID, now: at('11:00'), actor: 'ana' }])
  assert.ok(vcs(root, ['show', 'HEAD:data/proposals.yaml']).includes('state: withdrawn'))
  clean(root)
})

test('passing: a proposal expired, closed by its author who holds no role, is clean: a row added to decisions[] is a ledger change, not class governance', () => {
  // carla is no maintainer: under the old class check her change to data/governance.yaml needed someone else's say.
  const root = start()
  server(root, [opened(proposal({ author: 'carla' })), { close: 'expired', id: ID, now: '2026-11-18T10:00:00Z', actor: 'carla' }])
  const gov = vcs(root, ['show', 'HEAD:data/governance.yaml'])
  assert.ok(gov.includes('outcome: "expired"'), gov)
  clean(root)
})

test('passing: a proposal rejected after the vote failed is clean', () => {
  const root = start(VOTE_RULES)
  const entry = proposal({ rules: [VOTE_RULE] })
  server(root, [opened(entry, 'records/vote'), wrote('ana', 'vote', at('11:00'), { vote: 'no' }), wrote('bruno', 'vote', at('11:10'), { vote: 'no' }),
    { close: 'rejected', id: ID, now: at('12:00'), actor: 'bruno' }])
  assert.ok(vcs(root, ['show', 'HEAD:data/governance.yaml']).includes('outcome: "rejected"'))
  clean(root)
})

// ── a ratify ────────────────────────────────────────────────────────────────

test('a state flipped to ratified by hand, with no merge, is a finding', () => {
  const root = approved()
  const now = vcs(root, ['show', 'HEAD:data/proposals.yaml']).replace('state: open', 'state: ratified')
  const sha = commit(root, { 'data/proposals.yaml': now }, `proposals: ratify ${ID}${trailers('bruno')}`, { who: 'bruno', date: at('12:00') })
  finds(root, sha, 'it is ratified by a commit that is not a merge')
})

test('a ratify merge whose evaluation is not met at the commit\'s date is a finding', () => {
  // The objection window closes at 11:02; the merge is dated 10:30, with an evaluation taken at 11:30.
  const root = start(CONSENT_RULES)
  server(root, [opened(proposal({ rules: [CONSENT_RULE] }), 'records/consent'), branch(), merged(at('10:30'), { evaluateAt: at('11:30') })])
  assert.ok(isMerge(root))
  finds(root, head(root), /it is ratified while its evaluation at the commit's date \(2026-10-18T10:30:00\+00:00\) is pending \(the objection window closes in 32 minutes\)/)
})

test('a ratify merge with no decision row is a finding', () => {
  const root = approved()
  server(root, [merged(at('12:00'), { drop: ['data/governance.yaml'] })])
  finds(root, head(root), 'no decision row for it is added to data/governance.yaml\'s decisions')
})

test('M4: a ratify merge whose branch commit also changes a record the ops do not name, in the same file, is a finding', () => {
  // The old class check passes it: projects.yaml is the ops' file and class records is the proposal's class.
  const root = approved()
  const c = handBranch(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, status: archive }\n  - { id: p2, title: Two }\n' })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), 'record projects:p1 changes in the merge, and no op of the proposal names it: status is "archive", where the result is absent')
})

test('M4: a ratify merge whose second parent does not stand on its first parent is a finding', () => {
  // The branch is built on the approval; ana writes a note on the trunk after it; the merge is of that older branch.
  const root = approved()
  const c = handBranch(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One }\n  - { id: p2, title: Two }\n' })
  const tip = commit(root, { 'docs/note.md': 'a note\n' }, 'a note', { who: 'ana', date: at('11:40') })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), `its second parent ${c.slice(0, 7)} stands on`)
  finds(root, head(root), `not on its first parent ${tip}`)
})

test('M4: a ratify merge whose record is not the op\'s result (projectOp) is a finding: a set that holds another value', () => {
  const ops = [{ op: 'update', record: 'projects:p1', set: { title: 'One, renamed' }, base: '@current' }]
  const root = approved(proposal({ ops, rev: revOf([{ op: 'update', record: 'projects:p1', set: { title: 'One, renamed' } }]) }))
  const c = handBranch(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: "One, other" }\n' })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), 'record projects:p1 in the merge is not its update op\'s result: title is "One, other", where the result is "One, renamed"')
})

test('M4: a ratify merge whose record is not the op\'s result is a finding: a create whose entry differs', () => {
  const root = approved()
  const c = handBranch(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One }\n  - { id: p2, title: Two, status: archive }\n' })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), 'record projects:p2 in the merge is not its create op\'s result: status is "archive", where the result is absent')
})

test('M4: a ratify merge whose record is not the op\'s result is a finding: a delete that left the entry', () => {
  const ops = [{ op: 'delete', record: 'projects:p1', base: '@current' }]
  const root = approved(proposal({ ops, rev: revOf([{ op: 'delete', record: 'projects:p1' }]) }))
  const c = handBranch(root, {}, { empty: true })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), 'record projects:p1 in the merge is not its delete op\'s result: the merge holds it, and the result has no such record')
})

test('a later commit borrowing a ratified proposal\'s trailer is a finding', () => {
  const root = approved()
  server(root, [{ ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  const sha = commit(root, { 'data/projects.yaml': 'projects:\n  - { id: p1, title: One, status: archive }\n  - { id: p2, title: Two }\n' },
    `archive p1${trailers('ana')}`, { who: 'ana', date: at('13:00') })
  finds(root, sha, `its Org-Proposal trailer names proposal ${ID}, which was already ratified at its parent`)
})

test('a ratified proposal with a statement and no DECISIONS.md entry in its merge is a finding', () => {
  const statement = { title: 'Add project two', decision: 'We add project two.', why: 'It is ready.', scope: 'records' }
  const root = approved(proposal({ statement }), { 'DECISIONS.md': DECISIONS_MD })
  server(root, [merged(at('12:00'), { drop: ['DECISIONS.md'] })])
  finds(root, head(root), 'it carries a statement, and the merge appends no entry to DECISIONS.md')
})

test('a ratify merge whose Org-Decision trailer names another row is a finding', () => {
  const root = approved()
  server(root, [merged(at('12:00'), { decision: 'gov-20261018-099' })])
  finds(root, head(root), 'its Org-Decision trailer names gov-20261018-099, and its decision row is gov-20261018-001')
})

test('a decision row that does not equal what the evaluation produces is a finding', () => {
  const root = approved()
  server(root, [merged(at('12:00'), { row: { by: ['carla'] } })])
  finds(root, head(root), 'its decision row gov-20261018-001 is not what the evaluation produces: by is ["carla"], and the evaluation gives ["bruno"]')
})

// ── the other closings, and what never happens ──────────────────────────────

test('a closed proposal edited is a finding', () => {
  const root = start()
  server(root, [opened(), { close: 'withdrawn', id: ID, now: at('11:00'), actor: 'ana' }])
  const now = vcs(root, ['show', 'HEAD:data/proposals.yaml']).replace('title: Add project two', 'title: Add project three')
  const sha = commit(root, { 'data/proposals.yaml': now }, `proposals: edit ${ID}${trailers('ana')}`, { who: 'ana', date: at('11:30') })
  finds(root, sha, 'it was already withdrawn at the commit\'s parent, and the commit changes it: a closed proposal does not change.')
})

test('a proposal deleted is a finding', () => {
  const root = start()
  server(root, [opened()])
  const sha = commit(root, { 'data/proposals.yaml': 'proposals: []\n' }, `proposals: tidy${trailers('ana')}`, { who: 'ana', date: at('11:00') })
  finds(root, sha, 'it is gone from data/proposals.yaml')
})

test('a reject while the evaluation is pending is a finding', () => {
  const root = start()
  server(root, [opened(), closing('reject', 'bruno', at('11:00'))])
  finds(root, head(root), /it is rejected while its evaluation at the commit's date \(2026-10-18T11:00:00\+00:00\) is pending \(needs 1 more approval from a maintainer other than the author\); a proposal is rejected only when the evaluation says failed/)
})

test('an expire before the instant is a finding', () => {
  const root = start()
  server(root, [opened(), closing('expire', 'bruno', at('12:00'))])
  finds(root, head(root), /it is expired while its evaluation at the commit's date \(2026-10-18T12:00:00\+00:00\) is pending .*; a proposal is expired only when the evaluation says expired/)
})

test('a withdraw by someone other than the author is a finding', () => {
  const root = start()
  server(root, [opened(), closing('withdraw', 'carla', at('11:00'))])
  finds(root, head(root), 'withdraw: only the author of a proposal can withdraw it; this one is "ana"\'s.')
})

test('a decision row added by a commit that closes nothing is a finding', () => {
  // bruno decides governance alone, so the class check has nothing to say; the ledger check does.
  const root = start()
  server(root, [opened()])
  const row = { id: 'gov-20261018-001', proposal: ID, rule: 'records', method: 'approve', outcome: 'ratified', status: 'ratified', by: ['bruno'], date: '2026-10-18', title: 'Add project two', summary: '1 approval (bruno); no objection.' }
  const sha = commit(root, { 'data/governance.yaml': RULES.replace('  decisions: []\n', `  decisions:\n    - ${JSON.stringify(row)}\n`) },
    'record a decision', { who: 'bruno', date: at('11:00') })
  finds(root, sha, 'decision row gov-20261018-001 is added by a commit that does not ratify, reject or expire it')
})

// ── fix round 1 ─────────────────────────────────────────────────────────────

const ID2 = 'p-2026-10-18-002-b7c2'
const PROJECTS_P2 = 'projects:\n  - { id: p1, title: One }\n  - { id: p2, title: Two }\n'

test('a merge carrying Org-Proposal that ratifies nothing is a finding: a forged approve brought in by a side branch', () => {
  // carla opens; on a side branch she writes an approve signed by bruno; she merges it with her proposal's trailer.
  const root = start()
  commit(root, { 'data/proposals.yaml': ledger(proposal({ author: 'carla' })) }, `proposals: open ${ID} — Add project two${trailers('carla')}`, { who: 'carla', date: OPENED })
  vcs(root, ['switch', '-q', '-c', 'side'])
  commit(root, { 'data/proposals.yaml': ledger(proposal({ author: 'carla', events: [{ id: 'e-1', at: at('11:00'), by: 'bruno', kind: 'approve', rev: revOf(OPS) }] })) },
    'approve', { who: 'carla', date: at('11:00') })
  vcs(root, ['switch', '-q', 'main'])
  vcs(root, ['merge', '-q', '--no-ff', 'side', '-m', `proposals: approve ${ID}${trailers('carla')}`], { who: 'carla', date: at('11:05') })
  assert.ok(isMerge(root))
  finds(root, head(root), `a merge carries a proposal only as its ratification, and proposal ${ID} is open at the merge's first parent and open in the merge`)
})

test('a ratify merge that also adds a new proposal is a finding', () => {
  const root = approved()
  const smuggled = proposal({ id: ID2, title: 'Smuggled', state: 'ratified', closed: { at: at('11:30'), by: 'ana', decision: null } })
  const c = handBranch(root, { 'data/projects.yaml': PROJECTS_P2, 'data/proposals.yaml': `${vcs(root, ['show', 'HEAD:data/proposals.yaml'])}\n  - ${JSON.stringify(smuggled)}\n` })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), `a merge carries a proposal only as its ratification, and this one is added by a merge that names ${ID}`, ID2)
})

test('a ratify merge that also edits another proposal is a finding', () => {
  const root = start()
  server(root, [opened(), opened(proposal({ id: ID2, title: 'Other', author: 'carla', branch: `proposal/${ID2}`, opened: at('10:05') })), branch(), wrote('bruno', 'approve', at('11:00'))])
  const text = vcs(root, ['show', 'HEAD:data/proposals.yaml'])
  assert.ok(text.includes('title: Other\n'), text)
  const c = handBranch(root, { 'data/projects.yaml': PROJECTS_P2, 'data/proposals.yaml': `${text.replace('title: Other\n', 'title: Other, edited\n')}\n` })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), `a merge carries a proposal only as its ratification, and this one is changed by a merge that names ${ID}`, ID2)
})

test('M4: a ratify merge that adds a top-level key to an ops file is a finding', () => {
  const root = approved()
  const c = handBranch(root, { 'data/projects.yaml': `notes: written by hand\n${PROJECTS_P2}` })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), 'the merge adds the top-level key `notes` of data/projects.yaml, which no op touches')
})

test('M4: a ratify merge that adds an alias key beside the canonical one is a finding', () => {
  const ops = [{ op: 'create', record: 'funding-opportunities:f2', value: { id: 'f2', title: 'Two' }, base: null }]
  const root = approved(proposal({ ops, rev: revOf(ops) }), { 'data/funding-opportunities.yaml': 'funding_opportunities:\n  - { id: f1, title: One }\n' })
  const c = handBranch(root, { 'data/funding-opportunities.yaml': 'funding_opportunities:\n  - { id: f1, title: One }\n  - { id: f2, title: Two }\nopportunities:\n  - { id: f3, title: Three }\n' })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), '`opportunities` is added beside `funding_opportunities` in data/funding-opportunities.yaml')
})

test('a decision row whose summary is worded otherwise than today\'s summaryOf is clean: the words are not judged', () => {
  const root = approved()
  server(root, [merged(at('12:00'), { row: { summary: 'Approved by bruno, with no objection.' } })])
  assert.ok(vcs(root, ['show', 'HEAD:data/governance.yaml']).includes('Approved by bruno, with no objection.'))
  clean(root)
})

const LEGACY = RULES.replace('  decisions: []\n', '  decisions:\n    - { id: gov-2026-001, title: An older decision, status: active, date: "2026-01-10" }\n')

test('a legacy row (no proposal) marked superseded is judged by class: clean for one who decides governance directly, governed for anyone else', () => {
  const edit = (who) => {
    const root = start(LEGACY)
    const sha = commit(root, { 'data/governance.yaml': LEGACY.replace('status: active', 'status: superseded') }, 'supersede an old decision', { who, date: at('11:00') })
    return { root, sha }
  }
  clean(edit('bruno').root)
  const { root, sha } = edit('carla')
  const r = run([root, '--strict'])
  assert.equal(r.status, 1, r.stdout)
  const found = findingsOf(r).filter((l) => l.includes(sha))
  assert.ok(found.some((l) => l.includes('governance: "carla" does not hold the maintainer role')), r.stdout)
  assert.ok(!found.some((l) => l.includes('decision row')), r.stdout)
})

test('a proposal\'s decision row changed after its ratify is a finding, even by one who decides governance directly', () => {
  const root = approved()
  server(root, [{ ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  const gov = vcs(root, ['show', 'HEAD:data/governance.yaml'])
  assert.ok(gov.includes('title: "Add project two"'), gov)
  const sha = commit(root, { 'data/governance.yaml': `${gov.replace('title: "Add project two"', 'title: "Add project 2"')}\n` }, 'tidy a decision', { who: 'bruno', date: at('13:00') })
  finds(root, sha, 'decision row gov-20261018-001 was changed or removed: a decision row stays as it was written')
})

const OLDER = `${DECISIONS_MD}\n## 2026-10-01 — An older decision\n\n**Status:** active\n`
const STATEMENT = { title: 'Add project two', decision: 'We add project two.', why: 'It is ready.', scope: 'records' }

test('a ratify merge that also rewrites an older DECISIONS.md entry is a finding', () => {
  const root = approved(proposal({ statement: STATEMENT }), { 'DECISIONS.md': OLDER })
  const c = handBranch(root, { 'data/projects.yaml': PROJECTS_P2, 'DECISIONS.md': OLDER.replace('**Status:** active', '**Status:** superseded') })
  server(root, [merged(at('12:00'), { commit: c })])
  finds(root, head(root), 'the merge changes lines of DECISIONS.md besides inserting its entry')
})

// Final review M3: the entry a ratify inserts is compared with the one its statement writes (insertDecisionsMdEntry), not
// only counted; a Why line beginning "## " counted as a second entry.
test('passing: a ratify with a statement, written by the server, inserts exactly its statement\'s entry and is clean', () => {
  const root = approved(proposal({ statement: STATEMENT }), { 'DECISIONS.md': OLDER })
  server(root, [{ ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  clean(root)
})
test('a ratify merge whose DECISIONS.md entry is not the one its statement writes is a finding', () => {
  const root = approved(proposal({ statement: STATEMENT }), { 'DECISIONS.md': OLDER })
  server(root, [merged(at('12:00'), { decisions: ['We add project two.', 'We add project three.'] })])
  finds(root, head(root), 'the entry the merge inserts into DECISIONS.md is not the one its statement writes')
})
test('a Why line beginning "## " in the inserted entry is one entry that differs from the statement, not two entries', () => {
  const root = approved(proposal({ statement: STATEMENT }), { 'DECISIONS.md': OLDER })
  server(root, [merged(at('12:00'), { decisions: ['It is ready.', 'It is ready.\n## And more'] })])
  const found = finds(root, head(root), 'the entry the merge inserts into DECISIONS.md is not the one its statement writes')
  assert.ok(!found.some((l) => l.includes('entries into DECISIONS.md')), found.join('\n'))
})

test('a ratify merge of a proposal with no statement that touches DECISIONS.md is a finding', () => {
  const root = approved(proposal(), { 'DECISIONS.md': OLDER })
  const c = handBranch(root, { 'data/projects.yaml': PROJECTS_P2, 'DECISIONS.md': `${OLDER}\nA line added by hand.\n` })
  server(root, [merged(at('12:00'), { commit: c, allow: ['DECISIONS.md'] })])
  finds(root, head(root), 'the merge changes DECISIONS.md, and the proposal carries no statement')
})

test('passing: a consent ratify written by the server is clean', () => {
  const root = start(CONSENT_RULES)
  server(root, [opened(proposal({ rules: [CONSENT_RULE] }), 'records/consent'), branch(), { ratify: true, id: ID, now: at('11:30'), actor: 'bruno' }])
  assert.ok(isMerge(root))
  clean(root)
})

test('passing: a vote ratify written by the server is clean', () => {
  const root = start(VOTE_RULES)
  server(root, [opened(proposal({ rules: [VOTE_RULE] }), 'records/vote'), branch(), wrote('ana', 'vote', at('11:00'), { vote: 'yes' }), wrote('bruno', 'vote', at('11:10'), { vote: 'yes' }),
    { ratify: true, id: ID, now: at('12:00'), actor: 'bruno' }])
  assert.ok(isMerge(root))
  clean(root)
})

test('a ratify by someone who may not ratify is a finding', () => {
  const root = approved()
  server(root, [merged(at('12:00'), {}, 'carla')])
  finds(root, head(root), 'ratify: only the author or one of the people who decide this proposal can ratify it.')
})

test('a ratify whose `closed.decision` is not its decision row is a finding', () => {
  const root = approved()
  server(root, [merged(at('12:00'), { ledger: ['decision: gov-20261018-001', 'decision: gov-20261018-777'] })])
  assert.ok(vcs(root, ['show', 'HEAD:data/proposals.yaml']).includes('gov-20261018-777'))
  finds(root, head(root), 'its `closed.decision` is "gov-20261018-777", and its decision row is gov-20261018-001.')
})
