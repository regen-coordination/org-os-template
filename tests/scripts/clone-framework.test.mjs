import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

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
