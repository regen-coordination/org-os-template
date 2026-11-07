// tests/scripts/claim-handle.test.mjs
//
// scripts/claim-handle.mjs (wizards spec §5.4a, step 4): the script the claim route runs. It cannot
// trust the route, so it reads the repository itself, asks the same claimRefusal, and writes one
// file or nothing. The gate's cases are pinned in packages/admin/tests/lib/claim.test.ts; this pins
// the command: its arguments, its exit codes, and that a refusal leaves every byte where it was.
// Framework-only: it needs packages/admin, which new instances do not receive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'claim-handle.mjs');
const ME = 'ana@example.org';

const MEMBERS = `schema_version: "2.0"

# who we are
members:
  - id: "ana"
    name: "Ana Costa"
    handles:
      github: "ana-costa"
  - id: "bo"
    name: "Bo Lind"
    handles:
      git: "bo@example.org"
`;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });

function instance({ members = MEMBERS, governance = null, email = ME, authorEmail = ME, commit = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'claim-handle-'));
  mkdirSync(path.join(dir, 'data'));
  writeFileSync(path.join(dir, 'data', 'members.yaml'), members);
  if (governance !== null) writeFileSync(path.join(dir, 'data', 'governance.yaml'), governance);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', email);
  git(dir, 'config', 'user.name', 'Scratch');
  if (commit) {
    git(dir, 'add', '-A');
    git(dir, '-c', `user.email=${authorEmail}`, 'commit', '-q', '-m', 'start');
  }
  return dir;
}
const run = (dir, args) => spawnSync('node', [SCRIPT, '--repo', dir, ...args], { encoding: 'utf-8' });
const members = (dir) => readFileSync(path.join(dir, 'data', 'members.yaml'), 'utf-8');

test('writes the one line under the member\'s handles, and only that file changes', () => {
  const dir = instance();
  const r = run(dir, ['--member', 'ana', '--address', ME]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(members(dir), MEMBERS.replace('      github: "ana-costa"\n', `      github: "ana-costa"\n      git: ${ME}\n`));
  assert.match(r.stdout, /data\/members\.yaml/);
  assert.equal(git(dir, 'status', '--porcelain').trim(), 'M data/members.yaml');
  assert.deepEqual(readdirSync(path.join(dir, 'data')).sort(), ['members.yaml'], 'no temporary file is left');
});

test('a second run is refused: the address is held now, and the file is not touched again', () => {
  const dir = instance();
  assert.equal(run(dir, ['--member', 'ana', '--address', ME]).status, 0);
  const once = members(dir);
  const again = run(dir, ['--member', 'ana', '--address', ME]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already `ana`/);
  assert.equal(members(dir), once);
});

test('--create writes a new member when the file holds no person', () => {
  const dir = instance({ members: 'schema_version: "2.0"\nmembers: []\n' });
  const r = run(dir, ['--create', 'Ana Costa', '--address', ME]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(members(dir), `schema_version: "2.0"\nmembers:\n  - id: ana-costa\n    name: "Ana Costa"\n    handles:\n      git: ${ME}\n`);
});

test('--dry says what it would write and writes nothing', () => {
  const dir = instance();
  const r = run(dir, ['--member', 'ana', '--address', ME, '--dry']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`git: ${ME}`));
  assert.equal(members(dir), MEMBERS);
});

test('refuses, writing nothing, wherever the gate says no', () => {
  const cases = {
    'written rules': [{ governance: 'governance:\n  rules:\n    - id: r1\n' }, /has rules for who its members are/],
    'a non-solo model': [{ governance: 'governance:\n  model: consensus\n' }, /not decided by one maintainer/],
    'a governance file that cannot be read': [{ governance: 'governance: [unclosed\n' }, /cannot be read/],
    'an address held by another member': [{ email: 'bo@example.org', authorEmail: 'bo@example.org' }, /already `bo`/],
    'an address git has never seen author a commit': [{ authorEmail: 'someone@else.org' }, /never seen/],
    'a member who already holds an address': [{}, /already has a git address/, 'bo'],
  };
  for (const [name, [opts, pattern, member = 'ana']] of Object.entries(cases)) {
    const dir = instance(opts);
    const r = run(dir, ['--member', member, '--address', opts.email ?? ME]);
    assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, pattern, name);
    assert.equal(members(dir), MEMBERS, `${name}: the file is untouched`);
  }
});

test('an unreadable governance.yaml refuses even when the claimant is otherwise fine (MEDIUM-1)', () => {
  const dir = instance({ governance: 'governance:\n\tmodel: tab\n' });
  const r = run(dir, ['--member', 'ana', '--address', ME]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /data\/governance\.yaml cannot be read/);
  assert.equal(members(dir), MEMBERS);
});

test('refuses an address that is not the one git reports: the plan cannot name another', () => {
  const dir = instance();
  const r = run(dir, ['--member', 'ana', '--address', 'other@example.org']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /git reports ana@example\.org/);
  assert.equal(members(dir), MEMBERS);
});

test('refuses a members file with uncommitted changes', () => {
  const dir = instance();
  writeFileSync(path.join(dir, 'data', 'members.yaml'), `${MEMBERS}# a note\n`);
  const r = run(dir, ['--member', 'ana', '--address', ME]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not committed/);
});

test('says what is wrong with its arguments, and exits 1', () => {
  const dir = instance();
  for (const args of [[], ['--address', ME], ['--member', 'ana'], ['--member', 'ana', '--create', 'x', '--address', ME]]) {
    const r = run(dir, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /Usage: node scripts\/claim-handle\.mjs/);
  }
  assert.equal(members(dir), MEMBERS);
});

// ── DAO-OS L5 Task 11 (F-L3-1, spec §8.1): the owner's claim ─────────────────────────────────────────────
// An org whose rules leave nobody able to propose a change to its members. Placeholders only.
const STEWARDS = `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    handles:
      github: "steward-a"
  - id: "steward-b"
    name: "Steward B"
`;
const LOCKED = `governance:
  model: steward-council
  roles:
    stewards: { members: [steward-a] }
  rules:
    - id: members
      applies_to: [members, governance]
      propose: stewards
      decide: { by: stewards, method: direct }
`;
const STEWARD_A = 'steward-a@example.invalid';
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000A1';
const locked = (over = {}) => instance({ members: STEWARDS, governance: LOCKED, email: 'owner@example.invalid', authorEmail: STEWARD_A, ...over });
const subject = (dir) => git(dir, 'log', '-1', '--format=%B').trim();
const count = (dir) => Number(git(dir, 'rev-list', '--count', 'HEAD').trim());

test('--owner claims a git handle for steward-a and makes one commit, of members.yaml alone, with the two trailers', () => {
  const dir = locked();
  const r = run(dir, ['--owner', '--member', 'steward-a', '--git', STEWARD_A]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(members(dir), STEWARDS.replace('      github: "steward-a"\n', `      github: "steward-a"\n      git: ${STEWARD_A}\n`));
  assert.equal(count(dir), 2);
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n'), ['data/members.yaml']);
  const message = subject(dir);
  assert.match(message, /\n\nOrg-Actor: owner\nOrg-Rule: bootstrap\/owner-claim$/);
  assert.equal(git(dir, 'status', '--porcelain').trim(), '', 'nothing is left uncommitted');
});

test('--address is the same as --git', () => {
  const dir = locked();
  const r = run(dir, ['--owner', '--member', 'steward-a', '--address', STEWARD_A]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(members(dir), new RegExp(`git: ${STEWARD_A}`));
});

test('--owner --wallet writes handles.wallet, in its EIP-55 form, and commits it', () => {
  const dir = locked();
  const r = run(dir, ['--owner', '--member', 'steward-a', '--wallet', 'eip155:42220:0x00000000000000000000000000000000000000a1']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(members(dir), STEWARDS.replace('      github: "steward-a"\n', `      github: "steward-a"\n      wallet: ${A1}\n`));
  assert.equal(count(dir), 2);
  assert.match(subject(dir), /Org-Rule: bootstrap\/owner-claim/);
});

test('--owner is refused when the org is not locked out, and nothing is written or committed', () => {
  const open = LOCKED.replace('[steward-a]', '[steward-a, steward-b]');
  const withB = STEWARDS.replace('    name: "Steward B"\n', '    name: "Steward B"\n    handles:\n      git: "steward-b@example.invalid"\n');
  const dir = locked({ governance: open, members: withB });
  const r = run(dir, ['--owner', '--member', 'steward-a', '--git', STEWARD_A]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /This organisation is not locked out: someone can propose\. Ask them\./);
  assert.equal(members(dir), withB);
  assert.equal(count(dir), 1);
});

test('--owner with --dry says what it would add and writes nothing', () => {
  const dir = locked();
  const r = run(dir, ['--owner', '--member', 'steward-a', '--git', STEWARD_A, '--dry']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`git: ${STEWARD_A}`));
  assert.equal(members(dir), STEWARDS);
  assert.equal(count(dir), 1);
});

test('--owner takes --member and one handle, and no --create', () => {
  const dir = locked();
  for (const args of [['--owner', '--member', 'steward-a'], ['--owner', '--git', STEWARD_A],
    ['--owner', '--member', 'steward-a', '--git', STEWARD_A, '--wallet', A1], ['--owner', '--create', 'Steward Z', '--git', STEWARD_A]]) {
    const r = run(dir, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /--owner --member <id> \(--git <email> \| --wallet <CAIP-10>\)/);
  }
  assert.equal(members(dir), STEWARDS);
});

test('when git refuses the commit, the line stays written and it says so (exit 5)', () => {
  const dir = locked();
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "no commits today" >&2\nexit 1\n', { mode: 0o755 });
  const r = run(dir, ['--owner', '--member', 'steward-a', '--git', STEWARD_A]);
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stderr, /Written, not committed/);
  assert.match(members(dir), new RegExp(`git: ${STEWARD_A}`));
  assert.equal(count(dir), 1);
});
