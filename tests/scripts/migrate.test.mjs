// tests/scripts/migrate.test.mjs
//
// scripts/migrate.mjs selection (F1 spec §3.8). The runner used to read major
// versions only (/^v?(\d+)-to-v?(\d+)-/), so a 0.5 → 0.6 migration would have
// been skipped without a word. Two schemes now, which never mix: dotted names
// for 0.x, the legacy names for the pre-0.5 numbering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT, nodeModulesDir } from '../helpers/repo-paths.mjs';
import { selectMigrations, migrationRange, majorMinor } from '../../scripts/migrate.mjs';

const LEGACY = ['v2-to-v3-workstream-frontmatter.mjs', 'v3-to-v3-5-consolidation.mjs'];
const DOTTED = ['v0.5-to-v0.6-canonical-records.mjs'];
const ALL = [...LEGACY, ...DOTTED, 'README.md', 'helpers.mjs'];
const files = (list) => list.map((m) => m.file);

test('majorMinor reads both numberings', () => {
  assert.deepEqual(majorMinor('0.5.3'), [0, 5]);
  assert.deepEqual(majorMinor('v3'), [3, 0]);
  assert.deepEqual(majorMinor('3.5'), [3, 5]);
  assert.equal(majorMinor('next'), null);
  assert.equal(majorMinor(undefined), null);
});

test('a file name gives its scheme and range; anything else is not a migration', () => {
  assert.deepEqual(migrationRange('v0.5-to-v0.6-canonical-records.mjs'), { scheme: 'dotted', from: [0, 5], to: [0, 6] });
  // Read exactly as the runner always read it: majors only, so 3 → 3.
  assert.deepEqual(migrationRange('v3-to-v3-5-consolidation.mjs'), { scheme: 'legacy', from: [3, 0], to: [3, 0] });
  assert.deepEqual(migrationRange('v2-to-v3-workstream-frontmatter.mjs'), { scheme: 'legacy', from: [2, 0], to: [3, 0] });
  assert.equal(migrationRange('README.md'), null);
  assert.equal(migrationRange('helpers.mjs'), null);
});

test('dotted: a 0.5 instance migrating to 0.6 gets the 0.6 migration', () => {
  assert.deepEqual(selectMigrations(ALL, '0.5', '0.6.0'), [{ file: DOTTED[0], from: '0.5', to: '0.6' }]);
  assert.deepEqual(files(selectMigrations(ALL, '0.0', '0.6')), DOTTED, 'no framework_version reads as 0.0');
});

test('dotted: nothing to do at 0.6, or with a target below it', () => {
  assert.deepEqual(selectMigrations(ALL, '0.6', '0.6'), []);
  assert.deepEqual(selectMigrations(ALL, '0.5', '0.5.0'), []);
});

test('legacy migrations never run on a 0.x instance, whatever the target', () => {
  for (const target of ['0.6', '3.0', '3.5', '9.9']) {
    for (const at of ['0.0', '0.5', '0.6']) {
      assert.deepEqual(selectMigrations(LEGACY, at, target), [], `${at} → ${target}`);
    }
  }
});

test('legacy migrations never run for a 0.x target, whatever the instance says', () => {
  for (const at of ['0.0', '0.5', '0.6', '1.0', '2.0', '3.0', '3.5']) {
    assert.deepEqual(selectMigrations(LEGACY, at, '0.6'), [], `${at} → 0.6`);
  }
});

test('legacy: pre-0.5 instances select as they always did', () => {
  assert.deepEqual(files(selectMigrations(ALL, '2.0', '3.0')), LEGACY);
  assert.deepEqual(files(selectMigrations(ALL, '3.0', '3.5')), ['v3-to-v3-5-consolidation.mjs']);
});

// The doctor's re-baseline (3.x → 0.5) read the same way here: an instance still
// on the pre-0.5 numbering, migrating to a 0.x target, is a 0.5 instance. That is
// what lets doctor sync reach instances on the old numbering ("3.0") before it re-stamps.
test('cross-scheme: an instance on the old numbering reads as 0.5 for a 0.x target', () => {
  assert.deepEqual(selectMigrations(ALL, '3.0', '0.6'), [{ file: DOTTED[0], from: '0.5', to: '0.6' }]);
  assert.deepEqual(files(selectMigrations(ALL, '1.0', '0.6.0')), DOTTED);
  assert.deepEqual(files(selectMigrations(ALL, '3.5', '0.6')), DOTTED);
  assert.deepEqual(selectMigrations(ALL, '3.0', '0.5'), [], 'as 0.5 it needs nothing to reach 0.5');
});

test('cross-scheme: a 0.x migration is never offered for a target on the old numbering', () => {
  assert.deepEqual(selectMigrations(ALL, '3.0', '1.0.0'), []);
  assert.deepEqual(selectMigrations(ALL, '0.5', '3.5'), []);
});

test('the migrations shipped in scripts/migrations select as above', () => {
  const shipped = readdirSync(path.join(ORG_ROOT, 'scripts', 'migrations')).filter((f) => f.endsWith('.mjs'));
  // canonical-records first (systems), then governance-rules: same range, ordered by name.
  assert.deepEqual(files(selectMigrations(shipped, '0.5', '0.6')), [...DOTTED, 'v0.5-to-v0.6-governance-rules.mjs']);
  assert.deepEqual(selectMigrations(shipped, '0.5', '3.5'), []);
});

/** A throwaway instance holding a copy of the runner and the shipped migrations. */
function instance({ version, frameworkVersion }) {
  const root = mkdtempSync(path.join(tmpdir(), 'migrate-'));
  mkdirSync(path.join(root, 'scripts', 'migrations'), { recursive: true });
  copyFileSync(path.join(ORG_ROOT, 'scripts', 'migrate.mjs'), path.join(root, 'scripts', 'migrate.mjs'));
  for (const f of readdirSync(path.join(ORG_ROOT, 'scripts', 'migrations'))) {
    copyFileSync(path.join(ORG_ROOT, 'scripts', 'migrations', f), path.join(root, 'scripts', 'migrations', f));
  }
  symlinkSync(nodeModulesDir(), path.join(root, 'node_modules'), 'dir');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-os', version }));
  writeFileSync(path.join(root, 'federation.yaml'), `identity:\n  name: "Fixture"\nmetadata:\n  framework_version: "${frameworkVersion}"\n`);
  return root;
}
const runner = (root, ...args) => spawnSync('node', [path.join(root, 'scripts', 'migrate.mjs'), ...args], { encoding: 'utf-8' });

test('--dry lists the 0.6 migration for a 0.5 instance and runs nothing', () => {
  const root = instance({ version: '0.6.0', frameworkVersion: '0.5' });
  const r = runner(root, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /v0\.5-to-v0\.6-canonical-records\.mjs {2}\(0\.5 → 0\.6\)/);
  assert.match(r.stdout, /\(--dry\) Not executing\./);
  assert.doesNotMatch(r.stdout, /v2-to-v3|v3-to-v3-5/);
});

test('--target reaches 0.6 when package.json carries the instance\'s own version', () => {
  const root = instance({ version: '0.1.0', frameworkVersion: '0.5' });
  assert.match(runner(root, '--dry').stdout, /No migrations to run/);
  assert.match(runner(root, '--dry', '--target', '0.6').stdout, /v0\.5-to-v0\.6-canonical-records\.mjs/);
});

test('an instance on the old numbering is migrated as 0.5, and told to re-stamp', () => {
  const root = instance({ version: '0.6.0', frameworkVersion: '3.0' });
  const r = runner(root, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /framework_version 3\.0 is on the pre-0\.5 numbering: read as 0\.5/);
  assert.match(r.stdout, /re-stamp/);
  assert.match(r.stdout, /v0\.5-to-v0\.6-canonical-records\.mjs {2}\(0\.5 → 0\.6\)/);
  assert.doesNotMatch(r.stdout, /v2-to-v3|v3-to-v3-5/);
});

const SAFE = '0x1111111111111111111111111111111111111111';
/** A second throwaway instance, holding no runner: the runner is pointed at it. */
function bareInstance(frameworkVersion) {
  const root = mkdtempSync(path.join(tmpdir(), 'migrate-target-'));
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'federation.yaml'), `identity:\n  name: "Target"\nmetadata:\n  framework_version: "${frameworkVersion}"\n`);
  writeFileSync(path.join(root, 'data', 'governance.yaml'),
    `governance:\n  model: "consensus"\n  infrastructure:\n    safe: "${SAFE}"\n    chain: "eip155:42220"\n`);
  return root;
}

// How doctor sync runs it: the framework's runner, the instance as its argument.
test('a root argument migrates that instance, not the runner\'s own repository', () => {
  const framework = instance({ version: '0.6.0', frameworkVersion: '0.6' });
  const target = bareInstance('3.0');
  const r = runner(framework, target, '--target', '0.6.0');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`Instance:\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(readFileSync(path.join(target, 'data', 'systems.yaml'), 'utf-8'), new RegExp(SAFE));
  assert.equal(existsSync(path.join(framework, 'data', 'systems.yaml')), false, 'the runner\'s own repository is not touched');
  // The runner migrates; re-stamping framework_version is the doctor's next step.
  assert.match(readFileSync(path.join(target, 'federation.yaml'), 'utf-8'), /framework_version: "3\.0"/);
});

test('--dry with a root argument writes nothing there', () => {
  const framework = instance({ version: '0.6.0', frameworkVersion: '0.6' });
  const target = bareInstance('0.5');
  const r = runner(framework, '--dry', target, '--target', '0.6');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /v0\.5-to-v0\.6-canonical-records\.mjs/);
  assert.equal(existsSync(path.join(target, 'data', 'systems.yaml')), false);
});

test('a root that does not exist is refused, and nothing runs', () => {
  const framework = instance({ version: '0.6.0', frameworkVersion: '0.5' });
  const r = runner(framework, path.join(tmpdir(), 'no-such-instance-xyz'), '--target', '0.6');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no-such-instance-xyz is not a directory/);
});

// Legacy migrations ignore arguments and edit the repository they sit in: run
// against another root they would edit the framework, so the runner refuses.
test('legacy migrations are refused against another root', () => {
  const framework = instance({ version: '3.5.0', frameworkVersion: '3.5' });
  const target = bareInstance('2.0');
  const r = runner(framework, target, '--target', '3.5');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /run them from inside that instance/);
});

test('--target without a version is refused', () => {
  const root = instance({ version: '0.6.0', frameworkVersion: '0.5' });
  const r = runner(root, '--target');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--target needs a version/);
});
