import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import yamlMod from 'js-yaml';

// Skip the slow npm install + git init stages in tests that only verify
// copy/strip/render/materialize on-disk state. The dedicated dry-run test
// below exercises the full pipeline path.
const SKIP_FINISH_ENV = { ...process.env, ORG_OS_CLONE_SKIP_FINISH: '1' };

test('clone-framework --help prints usage', () => {
  const r = spawnSync('node', ['scripts/clone-framework.mjs', '--help'], { encoding: 'utf-8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node scripts\/clone-framework\.mjs/);
});

test('clone-framework requires --target', () => {
  const r = spawnSync('node', ['scripts/clone-framework.mjs'], { encoding: 'utf-8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--target required/);
});

test('clone-framework --dry-run lists planned actions without writing', () => {
  const r = spawnSync('node', [
    'scripts/clone-framework.mjs',
    '--target', '/tmp/never-create-me-' + Date.now(),
    '--type', 'project',
    '--non-interactive',
    '--config', 'tests/fixtures/instance-config.yaml',
    '--dry-run'
  ], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\]/);
});

test('clone-framework copies framework files into target (Task 20)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-copy-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target,
      '--type', 'project',
      '--non-interactive',
      '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    assert.ok(existsSync(path.join(target, 'AGENTS.md')), 'AGENTS.md should be copied');
    assert.ok(existsSync(path.join(target, 'data')), 'data/ should be copied');
    assert.ok(!existsSync(path.join(target, 'data', 'instances.yaml')),
      'framework-only data/instances.yaml should be stripped');
    assert.ok(!existsSync(path.join(target, 'scripts', 'clone-framework.mjs')),
      'cloning script itself should be stripped');
    assert.ok(!existsSync(path.join(target, 'templates')),
      'templates/ should be stripped (framework-only)');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework resets framework-specific markdown (Task 21)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-reset-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });

    const memContent = readFileSync(path.join(target, 'MEMORY.md'), 'utf-8');
    assert.ok(!memContent.includes('Self-hosting inauguration'),
      'instance MEMORY.md should not contain framework-specific decisions');

    const heartbeatContent = readFileSync(path.join(target, 'HEARTBEAT.md'), 'utf-8');
    assert.match(heartbeatContent, /Run `\/initialize` for the first time/);

    const memDir = fs.readdirSync(path.join(target, 'memory'));
    assert.equal(memDir.length, 1, 'memory/ should contain exactly seed welcome note');
    assert.match(memDir[0], /^\d{4}-\d{2}-\d{2}\.md$/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework renders README + GETTING-STARTED into target (Task 23)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-render-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const readme = readFileSync(path.join(target, 'README.md'), 'utf-8');
    assert.match(readme, /Selftest Instance/, 'README rendered with org name from config');
    assert.ok(!readme.includes('{{'), 'no template strings leaked');
    const gs = readFileSync(path.join(target, 'GETTING-STARTED.md'), 'utf-8');
    assert.match(gs, /Selftest Instance/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework materializes selected skills (Task 24)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-skills-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    // The fixture enables all 10 canonical skills
    assert.ok(fs.existsSync(path.join(target, 'skills', 'bootstrap-interviewer')));
    assert.ok(fs.existsSync(path.join(target, 'skills', 'org-os-init')));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework writes federation.yaml with selected packages (Task 25)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-fed-'));
  try {
    spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target, '--type', 'project',
      '--non-interactive', '--config', 'tests/fixtures/instance-config.yaml',
      '--force'
    ], { encoding: 'utf-8', env: SKIP_FINISH_ENV });
    const fed = yamlMod.load(readFileSync(path.join(target, 'federation.yaml'), 'utf-8'));
    assert.equal(fed.framework_version, '3.5');
    assert.equal(typeof fed.packages, 'object');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('clone-framework dry-run completes all stages (Tasks 26-27)', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'clone-dryrun-'));
  rmSync(target, { recursive: true, force: true });  // delete so it doesn't exist
  try {
    const r = spawnSync('node', [
      'scripts/clone-framework.mjs',
      '--target', target,
      '--type', 'project',
      '--non-interactive',
      '--config', 'tests/fixtures/instance-config.yaml',
      '--dry-run'
    ], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[dry-run\]/);
    assert.match(r.stdout, /npm install \+ validate/);
    assert.match(r.stdout, /git init \+ initial commit/);
    assert.match(r.stdout, /clone\] complete \(dry-run\)/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
