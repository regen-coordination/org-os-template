// tests/scripts/validate-data.test.mjs
//
// scripts/validate-data.mjs (F1 spec §3.5) as the CLI the doctor, CI, selftest
// and the pre-commit hook run. The validation itself is tested in
// packages/admin/tests/lib/; this pins the command: its argument, its output
// lines, its exit codes. Framework-only: it needs packages/admin, which new
// instances do not receive (scripts/lib/clone-excludes.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-data.mjs');

function instance(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-data-cli-'));
  mkdirSync(path.join(root, 'data'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, 'data', name), text);
  return root;
}
const run = (args, opts = {}) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', ...opts });
const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean);

const MEMBERS = 'members:\n  - id: "ana"\n    name: "Ana"\n';
// Without a governance file validateRepo warns (running as solo-maintainer), so fixtures that mean to be clean carry one.
const GOVERNANCE = 'governance:\n  model: solo-maintainer\n';

test('a clean instance passes: exit 0 and the Results line the doctor reads', () => {
  const r = run([instance({ 'members.yaml': MEMBERS, 'governance.yaml': GOVERNANCE, 'crm.yaml': 'not: [a registry\n' })]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 0 failed, 0 warnings');
});

test('warnings print with ⚠ and never fail the run', () => {
  const root = instance({
    'members.yaml': MEMBERS,
    'governance.yaml': GOVERNANCE,
    'projects.yaml': 'projects:\n  - id: "p1"\n    lead: "did:elsewhere:dana"\n',
  });
  const r = run([root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(lines(r.stdout).includes('⚠ data/projects.yaml [p1] lead: no member with id "did:elsewhere:dana" in members'), r.stdout);
  assert.equal(lines(r.stdout).at(-1), 'Results: 3 passed, 0 failed, 1 warnings');
});

test('an error exits 1, and the last lines name it with its repair', () => {
  const root = instance({
    'members.yaml': MEMBERS,
    'governance.yaml': 'schema_version: "2.0"\n---\ndecisions:\n  - id: "d1"\n',
  });
  const r = run([root]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = lines(r.stdout);
  assert.equal(out.at(-1), 'Results: 1 passed, 1 failed, 0 warnings');
  assert.match(out.at(-2), /^✗ data\/governance\.yaml: holds 2 YAML documents/);
  assert.match(out.at(-2), /Merge them into one document under `governance:` by hand/);
});

test('the root is an argument, and a relative one works from any directory', () => {
  const root = instance({ 'members.yaml': MEMBERS, 'governance.yaml': GOVERNANCE });
  const r = run([path.basename(root)], { cwd: path.dirname(root) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`validate:data — .*${path.basename(root)}`));
});

test('a root that does not exist or is not a directory cannot run: exit 2, one line naming the path', () => {
  const missing = path.join(tmpdir(), 'no-such-instance-' + process.pid);
  const r = run([missing]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no such directory/);
  assert.ok(r.stderr.includes(missing));
  assert.equal(lines(r.stderr).length, 1);
  const file = path.join(instance({ 'members.yaml': MEMBERS }), 'data', 'members.yaml');
  const f = run([file]);
  assert.equal(f.status, 2);
  assert.ok(f.stderr.includes(file));
  assert.equal(lines(f.stderr).length, 1);
});

test('Results counts files on both sides: several errors in one file are one failed file', () => {
  const root = instance({
    'members.yaml': MEMBERS,
    'governance.yaml': 'schema_version: "2.0"\n---\ndecisions:\n  - id: "d1"\n',
    'projects.yaml': 'projects:\n  - id: "p1"\n    lead: "did:elsewhere:a"\n  - id: "p2"\n    lead: "did:elsewhere:b"\n',
  });
  const r = run([root]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(lines(r.stdout).at(-1), 'Results: 2 passed, 1 failed, 2 warnings');
});

test('an instance with no registry files has nothing to validate', () => {
  const r = run([instance({})]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to validate/);
});

test('without packages/admin it says how to install it, and exits 2', () => {
  const fw = mkdtempSync(path.join(tmpdir(), 'validate-data-nofw-'));
  mkdirSync(path.join(fw, 'scripts'));
  copyFileSync(SCRIPT, path.join(fw, 'scripts', 'validate-data.mjs'));
  const r = spawnSync('node', [path.join(fw, 'scripts', 'validate-data.mjs'), fw], { encoding: 'utf-8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /run: npm ci --prefix packages\/admin/);
});

test('the pre-commit hook runs it as a warning only', () => {
  const hook = readFileSync(path.join(ORG_ROOT, '.github', 'hooks', 'pre-commit.sh'), 'utf-8');
  assert.match(hook, /node scripts\/validate-data\.mjs \. \|\| echo "⚠ validate:data/);
});

test('npm run validate:data is the script', () => {
  const pkg = JSON.parse(readFileSync(path.join(ORG_ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts['validate:data'], 'node scripts/validate-data.mjs');
});
