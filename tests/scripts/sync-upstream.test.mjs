// tests/scripts/sync-upstream.test.mjs
//
// Tests for scripts/sync-upstream.mjs (autopoiesis Phase 2, Loop C cascade
// closure). Fixtures build a real framework repo + instance clone in temp
// dirs; the script is copied into <instance>/scripts/ (it resolves its root
// from its own location, as deployed) with node_modules symlinked for js-yaml.
// npm lifecycle scripts (migrate, sync:packages, validate:*) are stubbed to
// exit 0 in the fixture package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
  existsSync, copyFileSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT, nodeModulesDir } from '../helpers/repo-paths.mjs';
const REAL_SCRIPT = path.join(ORG_ROOT, 'scripts', 'sync-upstream.mjs');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function configureRepo(dir) {
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function setupFrameworkAndInstance({ withGenesis = true, createMemoryDir = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-upstream-'));
  const framework = path.join(root, 'framework');
  const instance = path.join(root, 'instance');

  // Framework repo (the upstream)
  mkdirSync(framework);
  git(framework, ['init', '-b', 'main', '-q']);
  configureRepo(framework);
  writeFileSync(path.join(framework, 'README.md'), '# framework v1\n');
  writeFileSync(path.join(framework, 'shared.md'), 'shared content v1\n');
  writeFileSync(path.join(framework, '.gitignore'), 'node_modules\n');
  writeFileSync(path.join(framework, 'package.json'), JSON.stringify({
    name: 'fw', version: '3.0.0',
    scripts: {
      migrate: 'exit 0', 'sync:packages': 'exit 0',
      'validate:structure': 'exit 0', 'validate:schemas': 'exit 0',
    },
  }, null, 2));
  git(framework, ['add', '.']);
  git(framework, ['commit', '-m', 'fw v1', '-q']);
  const frameworkGenesis = git(framework, ['rev-parse', 'HEAD']);

  // Instance = clone of framework + customizations + the script under test
  spawnSync('git', ['clone', '-q', framework, instance], { encoding: 'utf-8' });
  configureRepo(instance);
  mkdirSync(path.join(instance, 'scripts'), { recursive: true });
  copyFileSync(REAL_SCRIPT, path.join(instance, 'scripts', 'sync-upstream.mjs'));
  symlinkSync(nodeModulesDir(), path.join(instance, 'node_modules'), 'dir');
  if (createMemoryDir) {
    mkdirSync(path.join(instance, 'memory'), { recursive: true });
    writeFileSync(path.join(instance, 'memory', '.gitkeep'), '');
  }

  writeFileSync(path.join(instance, 'SOUL.md'), 'instance soul (custom)\n');
  writeFileSync(path.join(instance, 'IDENTITY.md'), '- **Name:** test-instance\n');
  const genesisLine = withGenesis ? `\n  genesis_commit: "${frameworkGenesis}"` : '';
  writeFileSync(path.join(instance, 'federation.yaml'), `identity:
  name: test-instance
  type: Project
upstream:
  - url: ${framework}
federation:
  network: test
agent:
  runtime: claude-code
metadata:
  framework_version: "3.0"${genesisLine}
  last_sync_commit: null
customizations:
  - path: SOUL.md
    maintain_on_sync: true
  - path: IDENTITY.md
    maintain_on_sync: true
`);
  git(instance, ['add', '.']);
  git(instance, ['commit', '-m', 'instance setup', '-q']);

  // Bump the framework so there is something to sync
  writeFileSync(path.join(framework, 'README.md'), '# framework v2\n');
  writeFileSync(path.join(framework, 'shared.md'), 'shared content v2\n');
  git(framework, ['add', '.']);
  git(framework, ['commit', '-m', 'fw v2', '-q']);

  return { root, framework, instance, frameworkGenesis };
}

function runSync(instance, args = ['--yes']) {
  return spawnSync('node', [path.join(instance, 'scripts', 'sync-upstream.mjs'), ...args],
    { encoding: 'utf-8' });
}

test('pulls framework changes into the instance', () => {
  const { instance } = setupFrameworkAndInstance();
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(readFileSync(path.join(instance, 'README.md'), 'utf-8'), '# framework v2\n');
  assert.equal(readFileSync(path.join(instance, 'shared.md'), 'utf-8'), 'shared content v2\n');
});

test('without --yes it previews and exits without syncing', () => {
  const { instance } = setupFrameworkAndInstance();
  const result = runSync(instance, []);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--yes/);
  assert.equal(readFileSync(path.join(instance, 'README.md'), 'utf-8'), '# framework v1\n');
});

test('preserves committed customizations via rebase (maintain_on_sync files)', () => {
  const { instance } = setupFrameworkAndInstance();
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(readFileSync(path.join(instance, 'SOUL.md'), 'utf-8'), 'instance soul (custom)\n');
  assert.equal(readFileSync(path.join(instance, 'IDENTITY.md'), 'utf-8'), '- **Name:** test-instance\n');
});

test('updates federation.yaml.metadata.last_sync_commit to upstream HEAD', () => {
  const { framework, instance } = setupFrameworkAndInstance();
  const fwHead = git(framework, ['rev-parse', 'HEAD']);
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const fed = readFileSync(path.join(instance, 'federation.yaml'), 'utf-8');
  assert.match(fed, new RegExp(`last_sync_commit: "${fwHead}"`));
});

test('writes a sync receipt to memory/sync-YYYY-MM-DD.md', () => {
  const { instance } = setupFrameworkAndInstance();
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const receipts = readdirSync(path.join(instance, 'memory'))
    .filter(f => /^sync-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.equal(receipts.length, 1, 'expected exactly one sync receipt');
  const body = readFileSync(path.join(instance, 'memory', receipts[0]), 'utf-8');
  assert.match(body, /Sync receipt/i);
  assert.match(body, /Commits applied/i);
});

test('is a no-op (exit 0) when already up to date', () => {
  const { instance } = setupFrameworkAndInstance();
  assert.equal(runSync(instance).status, 0);
  // Sync intentionally leaves the lineage update + receipt uncommitted for
  // operator review; commit them (as the operator would) before re-running.
  git(instance, ['add', '-A']);
  git(instance, ['commit', '-m', 'post-sync review commit', '-q']);
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /already up to date/i);
});

test('seeds metadata.genesis_commit with the root commit when missing', () => {
  const { instance } = setupFrameworkAndInstance({ withGenesis: false });
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const rootCommit = git(instance, ['rev-list', '--max-parents=0', 'HEAD']).split('\n').pop().trim();
  const fed = readFileSync(path.join(instance, 'federation.yaml'), 'utf-8');
  assert.match(fed, new RegExp(`genesis_commit: "${rootCommit}"`),
    'genesis_commit should be seeded from the instance root commit on first sync');
});

test('creates memory/ if absent instead of crashing at the receipt stage', () => {
  const { instance } = setupFrameworkAndInstance({ createMemoryDir: false });
  const result = runSync(instance);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.ok(existsSync(path.join(instance, 'memory')), 'memory/ should have been created');
  const receipts = readdirSync(path.join(instance, 'memory'))
    .filter(f => /^sync-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.equal(receipts.length, 1);
});

test('refuses to sync when the working tree is dirty (vault safety)', () => {
  const { instance } = setupFrameworkAndInstance();
  writeFileSync(path.join(instance, 'uncommitted.md'), 'dirty\n');
  const result = runSync(instance);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dirty/i);
  assert.equal(readFileSync(path.join(instance, 'README.md'), 'utf-8'), '# framework v1\n');
});

test('refuses (exit 2) when .sync-freeze is present', () => {
  const { instance } = setupFrameworkAndInstance();
  writeFileSync(path.join(instance, '.sync-freeze'), 'frozen for release QA\n');
  git(instance, ['add', '.sync-freeze']);
  git(instance, ['commit', '-m', 'freeze', '-q']);
  const result = runSync(instance);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /FROZEN|freeze/i);
});
