// tests/scripts/validate-governance.publishes.test.mjs
//
// validate:governance and publishing (DAO-OS L6 spec §3.5, §13, Q69; Task 10): a commit that makes a page public or a
// knowledge object publishable is judged as class publication as well, whatever its trailer, by lib's `publishes`, the
// one predicate the server judges by. A direct commit that publishes with no Org-Proposal is a finding; a canon edit that
// publishes nothing is the workspace's. The finding for a canon file names where it is proposed (its entry page).
// Every repository is a throwaway one built under the OS temp dir by the test itself (`-C <root>` on every git call).
// Placeholders only: members steward-a, steward-b.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs')

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

const MEMBERS = `members:
  - { id: steward-a, name: Steward A, handles: { git: [steward-a@example.invalid] } }
  - { id: steward-b, name: Steward B, handles: { git: [steward-b@example.invalid] } }
`
/** The workspace is direct (no rule names it, and `all` never reaches it); a publication is the maintainer's to decide alone,
 *  anyone else proposes it; everything else needs the maintainer's approval. */
const RULES = `governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - id: governance
      applies_to: [governance]
      propose: member
      decide: { by: maintainer, method: approve, count: 1 }
    - id: publishing
      applies_to: [publication]
      propose: member
      decide: { by: maintainer, method: direct }
    - id: everything
      applies_to: [all]
      propose: member
      decide: { by: maintainer, method: approve, count: 1 }
  decisions: []
`
const CLAIMS = (publicUse, maturity = 'raw') => `# Claims, kept by hand.
schema_version: "1.0"
entries:
  seed-swap-notes:
    title: Seed swap notes
    type: claim-evidence
    maturity: ${maturity}
    public_use: ${publicUse}
    claim: Swaps raise local variety.
`
const page = (id, title, visibility = null) =>
  `---\nid: ${id}\ntitle: ${title}\nparent: null\norder: 1000\n${visibility ? `visibility: ${visibility}\n` : ''}---\n\n${title}.\n`

const START = '2026-11-05T10:00:00Z'
const at = (hhmm) => `2026-11-05T${hhmm}:00Z`
const direct = (subject, actor = 'steward-b') => `${subject}\n\nOrg-Actor: ${actor}\nOrg-Rule: workspace/direct`

function start() {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-publishes-'))
  vcs(root, ['init', '-q', '-b', 'main'])
  commit(root, {
    'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES,
    'data/kb/claim-evidence.yaml': CLAIMS('not-public-yet'), 'pages/handbook-3f2a.md': page('handbook-3f2a', 'Handbook'),
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

test('validate:governance reports a direct commit that makes a knowledge object publishable with no Org-Proposal', () => {
  const root = start()
  const sha = commit(root, { 'data/kb/claim-evidence.yaml': CLAIMS('ok-with-caveat') }, direct('knowledge: Seed swap notes'), { who: 'steward-b', date: at('11:00') })
  finds(root, sha, /publication: .*It is a change that needs someone else's say/)
  // The canon is proposed from its entry page (PF-R1, Task 10): the finding says where.
  finds(root, sha, 'Propose the change (a knowledge entry is proposed from its entry page in the commons), or ask a maintainer to revert it.')
})

test('maturity leaving held on a publishable object publishes; a canon edit that publishes nothing is the workspace\'s', () => {
  const held = start()
  commit(held, { 'data/kb/claim-evidence.yaml': CLAIMS('ok-with-caveat', 'held') }, direct('knowledge: hold the claim', 'steward-a'), { date: at('10:30') })
  const sha = commit(held, { 'data/kb/claim-evidence.yaml': CLAIMS('ok-with-caveat', 'reviewed') }, direct('knowledge: release the claim'), { who: 'steward-b', date: at('11:00') })
  finds(held, sha, 'publication: ')

  const quiet = start()
  commit(quiet, { 'data/kb/claim-evidence.yaml': CLAIMS('internal-only', 'reviewed') }, direct('knowledge: Seed swap notes'), { who: 'steward-b', date: at('11:00') })
  clean(quiet)
})

test('the maintainer the publication rule lets decide alone makes the commit; it is accepted', () => {
  const root = start()
  commit(root, { 'data/kb/claim-evidence.yaml': CLAIMS('ok-with-caveat') }, direct('knowledge: Seed swap notes', 'steward-a'), { date: at('11:00') })
  clean(root)
})

test('a direct commit that makes a page public is judged as a publication (L6 §3.5)', () => {
  const root = start()
  const sha = commit(root, { 'pages/handbook-3f2a.md': page('handbook-3f2a', 'Handbook', 'public') }, direct('page: Handbook'), { who: 'steward-b', date: at('11:00') })
  finds(root, sha, /publication: .*It is a change that needs someone else's say/)

  const quiet = start()
  commit(quiet, { 'pages/handbook-3f2a.md': page('handbook-3f2a', 'The handbook') }, direct('page: The handbook'), { who: 'steward-b', date: at('11:00') })
  clean(quiet)
})
