// tests/scripts/validate-governance.test.mjs
//
// scripts/validate-governance.mjs (F2 spec §3.8, architecture §4.7): the rules are
// well-formed, and the git history does not contradict them. Every repository here is
// built in a temp directory by the test itself; no real instance is read. Framework-only:
// it needs packages/admin, which new instances do not receive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-governance.mjs');

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', CI: '' };
// A git variable from the caller (a hook, an editor) would point every git call here at another repository.
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete ENV[key];
function vcs(root, args, who = 'ana@example.org') {
  const r = spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf-8',
    env: { ...ENV, GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: who, GIT_COMMITTER_NAME: 'Someone', GIT_COMMITTER_EMAIL: who },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A repository on branch main. */
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-'));
  vcs(root, ['init', '-q', '-b', 'main']);
  return root;
}
/** Write files (relative paths), stage them, commit. */
function commit(root, files, message, who) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
    vcs(root, ['add', '--', rel]);
  }
  vcs(root, ['commit', '-q', '-m', message], who);
  return vcs(root, ['rev-parse', '--short', 'HEAD']);
}
const run = (args, env = {}) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', env: { ...ENV, ...env } });
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean);

const MEMBERS = `members:
  - { id: ana, name: Ana, handles: { git: [ana@example.org] } }
  - { id: bruno, name: Bruno, handles: { git: [bruno@example.org] } }
  - { id: crew-engineer, name: Engineer seat, kind: agent, handles: { git: [engineer@crew.example] } }
`;
const SOLO = 'governance:\n  model: solo-maintainer\n';
// records need one approval from a maintainer; the rest is decided directly by one.
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
`;
const PROJECTS = (n) => `projects:\n  - { id: p1, title: "Fixture ${n}" }\n`;

/** A repo with members, rules (and, given one, a ledger: in the root commit, which is not judged), and one later commit that changes a record. */
function governed({ trailer, who = 'ana@example.org', rules = RULES, ledger } = {}) {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': rules, 'data/projects.yaml': PROJECTS(0), ...(ledger ? { 'data/proposals.yaml': ledger } : {}) }, 'start');
  const sha = commit(root, { 'data/projects.yaml': PROJECTS(1) }, `edit a project${trailer ? `\n\nOrg-Proposal: ${trailer}` : ''}`, who);
  return { root, sha };
}

test('a clean instance with rules and no later commits passes: exit 0 and the Results line the doctor reads', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES }, 'start');
  const r = run([root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings');
});

test('part 1: a rule that cannot work is an error, always, even locally; the last lines name it', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES.replace('propose: member', 'propose: steward') }, 'start');
  const r = run([root]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = lines(r.stdout);
  assert.equal(out.at(-1), 'Results: 1 passed, 1 failed, 0 warnings');
  assert.match(out.at(-2), /^✗ data\/governance\.yaml rules\.records\.propose: rule "records": propose names the role "steward"/);
});

test('part 1: a multi-document governance file is an error', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': 'governance:\n  model: solo-maintainer\n---\nnotes: x\n' }, 'start');
  const r = run([root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /holds 2 YAML documents/);
});

test('part 2 is silent under the solo default: no written rules, nothing to contradict', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': SOLO, 'data/projects.yaml': PROJECTS(0) }, 'start');
  commit(root, { 'data/projects.yaml': PROJECTS(1) }, 'by a stranger', 'stranger@example.org');
  const r = run([root, '--strict']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings');
});

test('a governed commit with no Org-Proposal trailer is a warning locally, with the repair', () => {
  const { root, sha } = governed();
  const r = run([root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = lines(r.stdout);
  assert.equal(out.at(-1), 'Results: 2 passed, 0 failed, 1 warnings');
  const finding = out.find((l) => l.startsWith('⚠'));
  assert.ok(finding.includes(`${sha} "edit a project"`), finding);
  assert.ok(finding.includes('records: rule "records" needs 1 approval from the maintainer, so it cannot be applied alone.'), finding);
  assert.ok(finding.includes('it has no Org-Proposal trailer'), finding);
  assert.ok(finding.includes('Propose the change'), finding);
});

test('M-3 (P2-R33): a hand commit of class governance cannot be proposed yet, and the finding says so and names the way out instead of "Propose the change"', () => {
  // records go by approval; a change to the rules needs it too: no op can carry one until P2b.
  const root = repo();
  const strictRules = RULES.replace('applies_to: [members, governance, identity, systems, treasury, operations, publication]', 'applies_to: [members, systems, treasury, operations, publication]')
    .replace('applies_to: [records]', 'applies_to: [records, governance, identity]');
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': strictRules }, 'start');
  const sha = commit(root, { 'data/governance.yaml': strictRules.replace('model: consensus', 'model: consensus\n  description: Decided together.') }, 'describe the model');
  const r = run([root]);
  assert.equal(r.status, 0, r.stdout);
  const finding = lines(r.stdout).find((l) => l.startsWith('⚠'));
  assert.ok(finding?.includes(`${sha} "describe the model"`), r.stdout);
  assert.ok(finding.includes('governance: rule "records" needs 1 approval from the maintainer, so it cannot be applied alone.'), finding);
  assert.ok(finding.endsWith('it has no Org-Proposal trailer, and no proposal can carry a change of class governance (data/governance.yaml) until P2b. ' +
    'The finding stays while the commit is among the last 500; to clear CI, give the CI command a --range that starts after it (spec §6).'), finding);
  assert.ok(!finding.includes('Propose the change'), finding);
  // A revert is itself a hand commit of the same class, so the sentence does not offer one.
  assert.ok(!/revert/i.test(finding), finding);
  // The same for identity; severity is unchanged: an error under --strict.
  const id = repo();
  commit(id, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': strictRules, 'IDENTITY.md': '# Org\n' }, 'start');
  commit(id, { 'IDENTITY.md': '# Org, renamed\n' }, 'rename the org');
  const strict = run([id, '--strict']);
  assert.equal(strict.status, 1, strict.stdout);
  assert.match(strict.stdout, /✗ [0-9a-f]+ "rename the org".*no proposal can carry a change of class identity \(IDENTITY\.md\) until P2b\. The finding stays while the commit is among the last 500;/m);
});

test('M-3: a records file no op can reach (a document registry such as data/finances.yaml) gets the not-proposable sentence too, naming the file', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/finances.yaml': 'finances:\n  currency: EUR\n' }, 'start');
  const sha = commit(root, { 'data/finances.yaml': 'finances:\n  currency: BRL\n' }, 'change the currency');
  const r = run([root]);
  const finding = lines(r.stdout).find((l) => l.startsWith('⚠'));
  assert.ok(finding?.includes(`${sha} "change the currency"`), r.stdout);
  assert.ok(finding.includes('records: rule "records" needs 1 approval from the maintainer, so it cannot be applied alone.'), finding);
  assert.ok(finding.includes('no proposal can carry a change of class records (data/finances.yaml) until P2b.'), finding);
  assert.ok(!finding.includes('Propose the change'), finding);
});

test('the same finding is an error under --strict, and under CI=true', () => {
  const { root } = governed();
  for (const r of [run([root, '--strict']), run([root], { CI: 'true' })]) {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = lines(r.stdout);
    assert.equal(out.at(-1), 'Results: 1 passed, 1 failed, 0 warnings');
    assert.match(out.at(-2), /^✗ [0-9a-f]+ "edit a project"/);
  }
});

test('an Org-Proposal trailer satisfies it; with no proposals.yaml yet the trailer is accepted and the report says it could not look', () => {
  const { root } = governed({ trailer: 'p-2026-10-18-001' });
  const r = run([root, '--strict']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /data\/proposals\.yaml does not exist yet/);
});

test('once proposals.yaml exists, the proposal must be there and ratified', () => {
  // The ledger is written in the root commit: a ledger written by hand in a later commit is itself judged (P2-R13).
  // A proposal already ratified at the commit's parent is not this commit's to name (P2 spec §3.10: the trailer is looked
  // up in the commit's own tree, ratified there and open at the parent); the ratify merge itself is the closings' test.
  for (const [entry, expected] of [
    ['state: ratified', /proposal p-1, which was already ratified at its parent/],
    ['state: open', /proposal p-1 is open, not ratified/],
    ['state: rejected', /proposal p-1 is rejected, not ratified/],
  ]) {
    const { root } = governed({ trailer: 'p-1', ledger: `proposals:\n  - { id: p-1, ${entry} }\n` });
    const r = run([root, '--strict']);
    if (expected === null) assert.equal(r.status, 0, r.stdout + r.stderr);
    else { assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, expected); }
  }
  const { root } = governed({ trailer: 'p-missing', ledger: 'proposals:\n  - { id: p-1, state: ratified }\n' });
  const r = run([root, '--strict']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /proposal p-missing is not in data\/proposals\.yaml/);
});

test('a commit that changes the rules is judged by the rules before it, never the ones it writes', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': SOLO }, 'start');
  // This commit introduces rules that would make it governed. It was made under solo: not judged.
  commit(root, { 'data/governance.yaml': RULES }, 'adopt rules', 'stranger@example.org');
  assert.equal(run([root, '--strict']).status, 0);
  // The next one is under the written rules.
  commit(root, { 'data/projects.yaml': PROJECTS(1) }, 'edit a project');
  assert.equal(run([root, '--strict']).status, 1);
});

test('a class decided directly is fine for a maintainer author, and governed for anyone else', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES }, 'start');
  commit(root, { 'data/members.yaml': MEMBERS.replace('Ana', 'Ana B.') }, 'ana edits a member', 'ana@example.org');
  assert.equal(run([root, '--strict']).status, 0);
  commit(root, { 'data/members.yaml': MEMBERS.replace('Bruno', 'Bruno B.') }, 'a stranger edits a member', 'stranger@example.org');
  const r = run([root, '--strict']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"a stranger edits a member" \(stranger@example\.org\)/);
  assert.match(r.stdout, /no member of data\/members\.yaml commits with that address/);
});

test('an agent author is governed: it never decides, even under a direct rule', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES.replace('[ana, bruno]', '[ana, bruno, crew-engineer]') }, 'start');
  commit(root, { 'data/members.yaml': MEMBERS.replace('Ana', 'Ana B.') }, 'the crew edits a member', 'engineer@crew.example');
  const r = run([root, '--strict']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"crew-engineer" is an agent, and an agent never decides/);
  // And part 1 already says the role is wrong:
  assert.match(r.stdout, /lists the agent "crew-engineer"/);
});

test('a class no rule covers is governed for everyone', () => {
  // `records` is given to no rule: an edit to a record can never be applied directly.
  const uncovered = RULES.replace('applies_to: [records]', 'applies_to: [members]').replace('[members, governance, identity, systems, treasury, operations, publication]', '[governance, identity, systems, treasury, operations, publication]');
  const root2 = repo();
  commit(root2, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': uncovered, 'data/ideas.yaml': 'ideas: []\n' }, 'start');
  commit(root2, { 'data/ideas.yaml': 'ideas:\n  - { id: i1 }\n' }, 'an idea');
  const r = run([root2, '--strict']);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /records: no rule covers the class records/);
});

test('files that are not records of the org are not judged: code, notes, the proposals file', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES }, 'start');
  commit(root, { 'scripts/x.mjs': '1\n', 'docs/note.md': 'n\n', 'data/proposals.yaml': 'proposals: []\n' }, 'code and notes', 'stranger@example.org');
  const r = run([root, '--strict']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a merge with no trailer is expanded: the branch commit it brings in is judged, the merge is not; with a trailer it is one change (P2 amends F2-R6)', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/projects.yaml': PROJECTS(0) }, 'start');
  vcs(root, ['checkout', '-q', '-b', 'proposal/x']);
  commit(root, { 'data/projects.yaml': PROJECTS(1) }, 'branch work', 'stranger@example.org');
  vcs(root, ['checkout', '-q', 'main']);
  vcs(root, ['merge', '-q', '--no-ff', 'proposal/x', '-m', 'merge a branch with no trailer']);
  const bare = run([root, '--strict']);
  assert.equal(bare.status, 1, bare.stdout);
  const found = lines(bare.stdout).filter((l) => l.startsWith('✗'));
  assert.equal(found.length, 1, bare.stdout);
  assert.match(found[0], /"branch work" \(stranger@example\.org\), brought in by [0-9a-f]{7}: /);
  assert.ok(!found[0].includes('"merge a branch with no trailer"'), bare.stdout);
  // The same merge carrying a trailer is one change, and the branch commit beneath it is not visited.
  const ok = repo();
  commit(ok, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/projects.yaml': PROJECTS(0) }, 'start');
  vcs(ok, ['checkout', '-q', '-b', 'proposal/x']);
  commit(ok, { 'data/projects.yaml': PROJECTS(1) }, 'branch work', 'stranger@example.org');
  vcs(ok, ['checkout', '-q', 'main']);
  vcs(ok, ['merge', '-q', '--no-ff', 'proposal/x', '-m', 'merge\n\nOrg-Proposal: p-1']);
  assert.equal(run([ok, '--strict']).status, 0);
});

test('the root commit is not judged (it has no rules before it)', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/projects.yaml': PROJECTS(0) }, 'start', 'stranger@example.org');
  assert.equal(run([root, '--strict']).status, 0);
});

test('--max looks at the newest N commits only, and says so', () => {
  const { root } = governed();
  commit(root, { 'docs/n.md': 'n\n' }, 'later one');
  commit(root, { 'docs/n.md': 'm\n' }, 'later two');
  const all = run([root, '--strict']);
  assert.equal(all.status, 1);
  const few = run([root, '--strict', '--max', '2']);
  assert.equal(few.status, 0, few.stdout);
  assert.match(few.stdout, /the newest 2 commits/);
});

test('--range walks the commits it names and no others', () => {
  const { root, sha } = governed();
  const later = commit(root, { 'docs/n.md': 'n\n' }, 'later one');
  assert.equal(run([root, '--strict']).status, 1);
  const after = run([root, '--strict', '--range', `${sha}..HEAD`]);
  assert.equal(after.status, 0, after.stdout);
  const upTo = run([root, '--strict', '--range', sha]);
  assert.equal(upTo.status, 1, upTo.stdout);
  assert.ok(later);
});

test('a range git cannot read is said, not guessed', () => {
  const { root } = governed();
  const r = run([root, '--range', 'no-such-branch..HEAD']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /history not checked: git could not read no-such-branch\.\.HEAD/);
});

test('a governance file that cannot be read at some commit is not judged there, and does not crash the run', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': 'governance: [\n' }, 'start');
  commit(root, { 'data/projects.yaml': PROJECTS(1) }, 'edit', 'stranger@example.org');
  const r = run([root]);
  assert.notEqual(r.status, 2, r.stdout + r.stderr);
});

test('a directory that is not a git repository is checked for its rules only, and says so', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-governance-nogit-'));
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data', 'members.yaml'), MEMBERS);
  writeFileSync(path.join(root, 'data', 'governance.yaml'), RULES);
  const r = run([root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /history not checked: .* is not a git repository/);
  assert.equal(lines(r.stdout).at(-1), 'Results: 1 passed, 0 failed, 0 warnings');
});

test('the history check cannot be fooled by a trailer in the subject: only the last paragraph counts', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/projects.yaml': PROJECTS(0) }, 'start');
  commit(root, { 'data/projects.yaml': PROJECTS(1) }, 'Org-Proposal: p-1');
  assert.equal(run([root, '--strict']).status, 1);
});

test('a root that does not exist cannot run: exit 2, one line naming the path', () => {
  const missing = path.join(tmpdir(), 'no-such-instance-' + process.pid);
  const r = run([missing]);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(missing));
  assert.equal(lines(r.stderr).length, 1);
});

test('without packages/admin it says how to install it, and exits 2', () => {
  const fw = mkdtempSync(path.join(tmpdir(), 'validate-governance-nofw-'));
  mkdirSync(path.join(fw, 'scripts'));
  copyFileSync(SCRIPT, path.join(fw, 'scripts', 'validate-governance.mjs'));
  const r = spawnSync('node', [path.join(fw, 'scripts', 'validate-governance.mjs'), fw], { encoding: 'utf-8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /run: npm ci --prefix packages\/admin/);
});

test('an option it does not know is refused, not ignored', () => {
  const r = run(['.', '--strcit']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --strcit/);
});

test('M4: a stranger editing a data file the registry list does not know is judged as the class the platform gives it (records)', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES, 'data/crm.yaml': 'a: 1\n' }, 'start');
  commit(root, { 'data/crm.yaml': 'a: 2\n' }, 'edit the crm', 'stranger@example.org');
  const r = run([root, '--strict']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /"edit the crm"/);
  assert.match(r.stdout, /records: /);
});

test('M1: a split rule with no rule for the whole class is accepted and inert: the class is uncovered, and an edit to it is governed', () => {
  const split = RULES.replace('applies_to: [records]', 'applies_to: [records:funding]');
  const { root } = governed({ rules: split });
  const r = run([root, '--strict']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /records: no rule covers the class records/);
});

test('M3, moved by P2 (spec §3.10): the note that a trailer is checked by presence only until P2 is gone, under --strict and CI=true alike', () => {
  const root = repo();
  commit(root, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES }, 'start');
  const quiet = () => {
    for (const r of [run([root, '--strict']), run([root], { CI: 'true' }), run([root])]) {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(!r.stdout.includes('presence only'), r.stdout);
    }
  };
  quiet();
  commit(root, { 'data/proposals.yaml': 'proposals: []\n' }, 'proposals');
  quiet();
});

// Final review I6: run from a hook (or an editor's terminal), the validator inherited GIT_DIR, GIT_WORK_TREE and
// GIT_INDEX_FILE, and `git -C <root>` then read the other repository. Its git calls now run with those keys removed.
test('an exported GIT_DIR (and GIT_WORK_TREE, GIT_INDEX_FILE) pointing at another repository does not change what is validated', () => {
  const { root } = governed(); // a record changed with no proposal: a finding
  const other = repo();
  commit(other, { 'data/members.yaml': MEMBERS, 'data/governance.yaml': RULES }, 'start'); // clean
  const plain = run([root, '--strict']);
  assert.equal(plain.status, 1, plain.stdout + plain.stderr);
  const misled = run([root, '--strict'], {
    GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: path.join(other, '.git', 'index'),
    GIT_COMMON_DIR: path.join(other, '.git'), GIT_OBJECT_DIRECTORY: path.join(other, '.git', 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(other, '.git', 'objects'),
  });
  assert.equal(misled.status, plain.status, misled.stdout + misled.stderr);
  assert.equal(misled.stdout, plain.stdout);
});

// ── DAO-OS L5 Task 11 (F-L3-1, spec §8.1 point 2): the owner's claim ─────────────────────────────────────
// `Org-Rule: bootstrap/owner-claim` is accepted only on a commit whose parent is locked out (the rule covering members
// is missing, or its propose role holds nobody with a git or wallet handle), that changes data/members.yaml alone,
// adding exactly one handle. Placeholders only.
const OWNER_MEMBERS = `members:
  - id: steward-a
    name: Steward A
  - id: steward-b
    name: Steward B
`;
const OWNER_LOCKED = `governance:
  model: steward-council
  roles:
    stewards: { members: [steward-a] }
  rules:
    - id: members
      applies_to: [records, members, governance, identity, systems, treasury, operations, publication]
      propose: stewards
      decide: { by: stewards, method: direct }
`;
const OWNER_TRAILERS = '\n\nOrg-Actor: owner\nOrg-Rule: bootstrap/owner-claim';
const withHandle = (members, id, lines) => members.replace(`  - id: ${id}\n    name: ${id === 'steward-a' ? 'Steward A' : 'Steward B'}\n`,
  `  - id: ${id}\n    name: ${id === 'steward-a' ? 'Steward A' : 'Steward B'}\n    handles:\n${lines.map((l) => `      ${l}\n`).join('')}`);
const OWNER = 'owner@example.invalid';

/** A repository whose first commit holds `members` and `governance`, and an owner's claim on top of it. */
function ownerClaim({ members = OWNER_MEMBERS, governance = OWNER_LOCKED, after, extra = {} }) {
  const root = repo();
  commit(root, { 'data/members.yaml': members, 'data/governance.yaml': governance, 'data/projects.yaml': PROJECTS(0) }, 'start', OWNER);
  commit(root, { 'data/members.yaml': after, ...extra }, `admin(members): the owner's claim, a git handle for steward-a${OWNER_TRAILERS}`, OWNER);
  return root;
}

test('the owner\'s claim is accepted at a locked-out parent: one handle, data/members.yaml alone', () => {
  const root = ownerClaim({ after: withHandle(OWNER_MEMBERS, 'steward-a', ['git: steward-a@example.invalid']) });
  const r = run([root, '--strict']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const wallet = ownerClaim({ after: withHandle(OWNER_MEMBERS, 'steward-a', ['wallet: eip155:42220:0x00000000000000000000000000000000000000A1']) });
  const w = run([wallet, '--strict']);
  assert.equal(w.status, 0, w.stdout + w.stderr);
});

test('the same commit is rejected at a parent where steward-b could propose', () => {
  const members = withHandle(OWNER_MEMBERS, 'steward-b', ['git: steward-b@example.invalid']);
  const governance = OWNER_LOCKED.replace('[steward-a]', '[steward-a, steward-b]');
  const root = ownerClaim({ members, governance, after: withHandle(members, 'steward-a', ['git: steward-a@example.invalid']) });
  const r = run([root, '--strict']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /its Org-Rule is bootstrap\/owner-claim, and its parent is not locked out: someone could propose a change to members there/);
});

test('an owner\'s claim that touches any other file, or adds two handles, is rejected', () => {
  const other = ownerClaim({ after: withHandle(OWNER_MEMBERS, 'steward-a', ['git: steward-a@example.invalid']), extra: { 'data/projects.yaml': PROJECTS(1) } });
  const o = run([other, '--strict']);
  assert.equal(o.status, 1, o.stdout + o.stderr);
  assert.match(o.stdout, /its Org-Rule is bootstrap\/owner-claim, and it changes data\/projects\.yaml as well as data\/members\.yaml/);
  const two = ownerClaim({ after: withHandle(OWNER_MEMBERS, 'steward-a', ['git: steward-a@example.invalid', 'wallet: eip155:42220:0x00000000000000000000000000000000000000A1']) });
  const t = run([two, '--strict']);
  assert.equal(t.status, 1, t.stdout + t.stderr);
  assert.match(t.stdout, /its Org-Rule is bootstrap\/owner-claim, and it adds 2 handles, where the owner's claim adds exactly one/);
});
