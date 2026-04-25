import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

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
    ], { encoding: 'utf-8' });
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
    ], { encoding: 'utf-8' });

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
