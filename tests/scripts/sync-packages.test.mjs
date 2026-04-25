import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-packages-'));
  const framework = path.join(root, 'framework');
  mkdirSync(path.join(framework, 'packages', 'dashboard'), { recursive: true });
  writeFileSync(path.join(framework, 'packages', 'dashboard', 'README.md'), '# dashboard package\n');
  mkdirSync(path.join(framework, 'packages', 'webapps'), { recursive: true });
  writeFileSync(path.join(framework, 'packages', 'webapps', 'README.md'), '# webapps package\n');
  const instance = path.join(root, 'instance');
  mkdirSync(instance);
  writeFileSync(path.join(instance, 'federation.yaml'), `
packages:
  dashboard: true
  webapps: false
`);
  return { root, framework, instance };
}

test('sync-packages copies enabled packages from framework into instance', () => {
  const { framework, instance } = setup();
  const result = spawnSync('node', [
    path.resolve('scripts/sync-packages.mjs'),
    '--framework', framework,
    '--target', instance
  ], { encoding: 'utf-8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(instance, 'packages', 'dashboard', 'README.md')));
  assert.ok(!existsSync(path.join(instance, 'packages', 'webapps')));
});

test('sync-packages warns about disabled-but-locally-present packages', () => {
  const { framework, instance } = setup();
  mkdirSync(path.join(instance, 'packages', 'webapps'), { recursive: true });
  writeFileSync(path.join(instance, 'packages', 'webapps', 'leftover.md'), 'old');
  const result = spawnSync('node', [
    path.resolve('scripts/sync-packages.mjs'),
    '--framework', framework,
    '--target', instance
  ], { encoding: 'utf-8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout + result.stderr, /webapps.*disabled.*present/);
  assert.ok(existsSync(path.join(instance, 'packages', 'webapps', 'leftover.md')));
});

test('sync-packages --prune removes disabled-but-present packages', () => {
  const { framework, instance } = setup();
  mkdirSync(path.join(instance, 'packages', 'webapps'), { recursive: true });
  writeFileSync(path.join(instance, 'packages', 'webapps', 'leftover.md'), 'old');
  const result = spawnSync('node', [
    path.resolve('scripts/sync-packages.mjs'),
    '--framework', framework,
    '--target', instance,
    '--prune'
  ], { encoding: 'utf-8' });
  assert.equal(result.status, 0);
  assert.ok(!existsSync(path.join(instance, 'packages', 'webapps')));
});

test('sync-packages errors on non-boolean toggle value', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-packages-bad-'));
  const framework = path.join(root, 'framework');
  mkdirSync(path.join(framework, 'packages'), { recursive: true });
  const instance = path.join(root, 'instance');
  mkdirSync(instance);
  writeFileSync(path.join(instance, 'federation.yaml'), `
packages:
  dashboard:
    enabled: true
`);
  const result = spawnSync('node', [
    path.resolve('scripts/sync-packages.mjs'),
    '--framework', framework,
    '--target', instance
  ], { encoding: 'utf-8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /must be boolean/);
});
