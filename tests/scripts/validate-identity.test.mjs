// tests/scripts/validate-identity.test.mjs
//
// Characterization tests for scripts/validate-identity.mjs (autopoiesis
// Phase 2, Loop C). The script resolves its instance root from its own
// location (path.resolve(__dirname, "..")), exactly as deployed on an
// instance — so each fixture copies the script into <tmp>/scripts/ and
// symlinks node_modules for js-yaml resolution.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT, nodeModulesDir } from '../helpers/repo-paths.mjs';
const REAL_SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-identity.mjs');
const REAL_GENERATE = path.join(ORG_ROOT, 'scripts', 'generate-all-schemas.mjs');
const REAL_ADMIN = path.join(ORG_ROOT, 'packages', 'admin');
const DAO_URI = 'https://dao.example.org/.well-known/dao.json';
const roots = [];
after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
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
  roots.push(root);
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(REAL_SCRIPT, path.join(root, 'scripts', 'validate-identity.mjs'));
  symlinkSync(nodeModulesDir(), path.join(root, 'node_modules'), 'dir');

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

// --- the standards (DAO-OS L8): schema check and leak scan of .well-known/ ---

/**
 * An instance with a daoURI and records, its .well-known/ generated by the real generator (framework layout), then
 * arranged: `layout` 'framework' keeps packages/admin; 'vendored' swaps it for scripts/lib (an instance's copy);
 * 'none' removes both.
 */
function setupDao(layout = 'framework') {
  const root = setupInstance();
  roots.push(root);
  const fed = readFileSync(path.join(root, 'federation.yaml'), 'utf-8');
  writeFileSync(path.join(root, 'federation.yaml'), fed.replace('  role: standalone', `  role: standalone\n  daoURI: "${DAO_URI}"`));
  copyFileSync(REAL_GENERATE, path.join(root, 'scripts', 'generate-all-schemas.mjs'));
  mkdirSync(path.join(root, 'packages'));
  symlinkSync(REAL_ADMIN, path.join(root, 'packages', 'admin'), 'dir');
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data', 'members.yaml'), `members:\n  - id: "steward-a"\n    name: "Canary Steward Name"\n`);
  const gen = spawnSync('node', [path.join(root, 'scripts', 'generate-all-schemas.mjs')], { encoding: 'utf-8' });
  assert.equal(gen.status, 0, gen.stdout + gen.stderr);
  if (layout !== 'framework') rmSync(path.join(root, 'packages'), { recursive: true, force: true });
  if (layout === 'vendored') symlinkSync(path.join(REAL_ADMIN, 'lib'), path.join(root, 'scripts', 'lib'), 'dir');
  return root;
}
const wk = (root, f) => path.join(root, '.well-known', f);
/** These tests generate with the framework's packages/admin: inside an instance (this suite ships in clones) there is none. */
const NEEDS_ADMIN = { skip: existsSync(REAL_ADMIN) ? false : 'needs packages/admin (the framework only)' };

test('a conformant generated .well-known/ passes, checked against the schemas and for leaks', NEEDS_ADMIN, () => {
  const root = setupDao();
  const r = run(root, ['--strict']);
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /published standards files conform to their schemas/);
  assert.match(r.stdout, /no withheld value is published/);
  assert.doesNotMatch(r.stdout, /not checked here/);
});

test('a dao.json with description "" warns, and fails under --strict', NEEDS_ADMIN, () => {
  const root = setupDao();
  const dao = JSON.parse(readFileSync(wk(root, 'dao.json'), 'utf-8'));
  dao.description = '';
  writeFileSync(wk(root, 'dao.json'), JSON.stringify(dao, null, 2));
  const warned = run(root);
  assert.equal(warned.status, 0, warned.stdout);
  assert.match(warned.stdout, /⚠ dao\.json: .*description/);
  const strict = run(root, ['--strict']);
  assert.equal(strict.status, 1, strict.stdout);
});

test('a members-level member hand-edited into members.json fails, with or without --strict, and the text does not repeat it', NEEDS_ADMIN, () => {
  const root = setupDao();
  const members = JSON.parse(readFileSync(wk(root, 'members.json'), 'utf-8'));
  members.members.push({ id: 'https://dao.example.org/members/x', name: 'Canary Steward Name' });
  writeFileSync(wk(root, 'members.json'), JSON.stringify(members, null, 2));
  for (const args of [[], ['--strict']]) {
    const r = run(root, args);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /✗ members\.json: a withheld value/);
    assert.doesNotMatch(r.stdout, /Canary Steward Name/);
  }
});

test('a leak is found in governance.md too (the whole .well-known/ is scanned)', NEEDS_ADMIN, () => {
  const root = setupDao();
  writeFileSync(wk(root, 'governance.md'), 'Decided by Canary Steward Name.\n');
  const r = run(root);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /✗ governance\.md: a withheld value/);
});

test("an instance's vendored builder: leak scan runs, schemas are not checked (one warning)", NEEDS_ADMIN, () => {
  const root = setupDao('vendored');
  const clean = run(root);
  assert.equal(clean.status, 0, clean.stdout);
  assert.equal(clean.stdout.match(/standards schemas not checked here \(no ajv\): run the framework's validate:schemas against this instance/g)?.length, 1);
  assert.match(clean.stdout, /no withheld value is published/);
  const members = JSON.parse(readFileSync(wk(root, 'members.json'), 'utf-8'));
  members.members.push({ id: 'https://dao.example.org/members/x', name: 'Canary Steward Name' });
  writeFileSync(wk(root, 'members.json'), JSON.stringify(members, null, 2));
  assert.equal(run(root).status, 1);
  // a schema problem goes unseen here, by design
  const dao = JSON.parse(readFileSync(wk(root, 'dao.json'), 'utf-8'));
  dao.description = '';
  writeFileSync(wk(root, 'dao.json'), JSON.stringify(dao));
  writeFileSync(wk(root, 'members.json'), JSON.stringify({ '@context': 'https://www.daostar.org/schemas', type: 'DAO', name: 'Test DAO', members: [] }));
  assert.equal(run(root).status, 0);
});

test("an instance's vendored builder under --strict: exit 1 with the plain reason; without --strict exit 0 with the warning (L8-OQ2)", NEEDS_ADMIN, () => {
  const root = setupDao('vendored');
  const strict = run(root, ['--strict']);
  assert.equal(strict.status, 1, strict.stdout);
  assert.match(strict.stdout, /--strict cannot pass here: this instance's vendored generator has no ajv/);
  assert.match(strict.stdout, /node <framework>\/scripts\/validate-identity\.mjs <this instance> --strict/);
  assert.match(strict.stdout, /--strict cannot pass in this instance/, 'the failure summary points back at the reason');
  const plain = run(root);
  assert.equal(plain.status, 0, plain.stdout);
  assert.match(plain.stdout, /standards schemas not checked here \(no ajv\)/);
  assert.doesNotMatch(plain.stdout, /--strict cannot pass/);
});

test('with no builder at all: parse-only, one warning, exit 0', NEEDS_ADMIN, () => {
  const root = setupDao('none');
  const r = run(root);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.stdout.match(/standards not checked here: run the framework's validate:schemas against this instance/g)?.length, 1);
  assert.equal(run(root, ['--strict']).status, 1, 'a warning fails under --strict');
});

test('without a daoURI there is nothing to check: said so, parse-only, no warning', () => {
  const root = setupInstance();
  const r = run(root, ['--strict']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /no identity\.daoURI: standards not checked/);
});

test('the framework builder with validate.mjs failing to load (ajv missing): one warning naming its first line, and the leak scan still runs (I5)', NEEDS_ADMIN, () => {
  const root = setupDao('none');
  // packages/admin/lib as the framework has it, but lib/standards/validate.mjs fails at import, as it does when ajv is
  // not installed: every other file is the real one (symlinked), so load.mjs and project.mjs load
  const lib = path.join(root, 'packages', 'admin', 'lib');
  mkdirSync(path.join(lib, 'standards'), { recursive: true });
  for (const name of readdirSync(path.join(REAL_ADMIN, 'lib'))) {
    if (name !== 'standards') symlinkSync(path.join(REAL_ADMIN, 'lib', name), path.join(lib, name));
  }
  for (const name of readdirSync(path.join(REAL_ADMIN, 'lib', 'standards'))) {
    if (name !== 'validate.mjs') symlinkSync(path.join(REAL_ADMIN, 'lib', 'standards', name), path.join(lib, 'standards', name));
  }
  writeFileSync(path.join(lib, 'standards', 'validate.mjs'), "import Ajv from 'ajv-not-installed-placeholder'\nexport const validateStandards = () => [Ajv]\n");

  const clean = run(root);
  assert.equal(clean.status, 0, clean.stdout);
  const warned = clean.stdout.match(/standards schemas not checked: lib\/standards\/validate\.mjs did not load \(([^)\n]*)/g) ?? [];
  assert.equal(warned.length, 1, clean.stdout);
  assert.match(warned[0], /ajv-not-installed-placeholder/);
  assert.match(clean.stdout, /no withheld value is published/);
  assert.doesNotMatch(clean.stdout, /standards not checked here/);

  const members = JSON.parse(readFileSync(wk(root, 'members.json'), 'utf-8'));
  members.members.push({ id: 'https://dao.example.org/members/x', name: 'Canary Steward Name' });
  writeFileSync(wk(root, 'members.json'), JSON.stringify(members, null, 2));
  const leaked = run(root);
  assert.equal(leaked.status, 1, leaked.stdout);
  assert.match(leaked.stdout, /✗ members\.json: a withheld value/);
});
