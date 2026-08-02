// tests/scripts/validate-identity.test.mjs
//
// Characterization tests for scripts/validate-identity.mjs (autopoiesis
// Phase 2, Loop C). The script resolves its instance root from its own
// location (path.resolve(__dirname, "..")), exactly as deployed on an
// instance — so each fixture copies the script into <tmp>/scripts/ and
// symlinks node_modules for js-yaml resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ORG_ROOT = path.resolve('.');
const REAL_SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-identity.mjs');
const SHA40 = 'a1b2c3d4e5f6789012345678901234567890abcd';

const WELL_KNOWN_FILES = {
  'dao.json': JSON.stringify({ '@context': 'https://www.daostar.org/schemas', name: 'test-org' }),
  'members.json': '{}', 'projects.json': '{}', 'finances.json': '{}',
  'activities.json': '{}', 'proposals.json': '{}', 'contracts.json': '{}',
};

function setupInstance({
  identityName = 'test-org',
  federationName = 'test-org',
  genesisCommit = SHA40,
  lastSyncCommit = 'null',
  frameworkVersion = '3.0',
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-identity-'));
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(REAL_SCRIPT, path.join(root, 'scripts', 'validate-identity.mjs'));
  symlinkSync(path.join(ORG_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');

  // Full .well-known/ so section 1 emits no warnings (keeps --strict tests isolated)
  mkdirSync(path.join(root, '.well-known'));
  for (const [f, body] of Object.entries(WELL_KNOWN_FILES)) {
    writeFileSync(path.join(root, '.well-known', f), body);
  }

  writeFileSync(path.join(root, 'IDENTITY.md'),
    `# Identity\n\n- **Name:** ${identityName}\n- **Type:** Project\n- **Node ID:** ${identityName}\n`);

  // genesisCommit: null omits the field entirely (undefined would hit the default param)
  const genesisLine = genesisCommit === null ? '' : `\n  genesis_commit: "${genesisCommit}"`;
  writeFileSync(path.join(root, 'federation.yaml'), `identity:
  name: ${federationName}
  type: Project
  role: standalone
federation:
  network: test
  hub: null
agent:
  runtime: claude-code
metadata:
  framework_version: "${frameworkVersion}"${genesisLine}
  last_sync_commit: ${lastSyncCommit}
`);
  return root;
}

function run(root, args = []) {
  return spawnSync('node', [path.join(root, 'scripts', 'validate-identity.mjs'), ...args],
    { encoding: 'utf-8' });
}

test('passes (exit 0) when IDENTITY.md and federation.yaml agree and lineage stamp is well-formed', () => {
  const root = setupInstance();
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /validation passed/i);
});

test('fails (exit 1) when IDENTITY.md name disagrees with federation.yaml.identity.name', () => {
  const root = setupInstance({ identityName: 'foo', federationName: 'bar' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗ Name agreement/);
});

test('warns but passes (exit 0) when genesis_commit is missing — seeds on first sync-upstream', () => {
  const root = setupInstance({ genesisCommit: null });
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /⚠.*genesis_commit missing/i);
});

test('--strict promotes the missing-genesis_commit warning to failure (exit 1)', () => {
  const root = setupInstance({ genesisCommit: null });
  const result = run(root, ['--strict']);
  assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});

test('fails (exit 1) when genesis_commit is malformed (not a 40-hex SHA)', () => {
  const root = setupInstance({ genesisCommit: 'not-a-sha' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗.*genesis_commit is 40-hex SHA/i);
});

test('fails (exit 1) when last_sync_commit is neither null nor a 40-hex SHA', () => {
  const root = setupInstance({ lastSyncCommit: '"abc123"' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗.*last_sync_commit is null or 40-hex SHA/i);
});

test('fails (exit 1) when framework_version is a full triplet instead of major.minor', () => {
  const root = setupInstance({ frameworkVersion: '3.0.0' });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /✗.*framework_version "3\.0\.0" is major\.minor/i);
});
