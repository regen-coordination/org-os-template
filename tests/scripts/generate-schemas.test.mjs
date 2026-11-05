// tests/scripts/generate-schemas.test.mjs
//
// scripts/generate-all-schemas.mjs since DAO-OS L8: it builds .well-known/ from the records through the standards
// builder (packages/admin/lib/standards), public records and fields only (data/visibility.yaml), and refuses rather
// than fall back to 0.6's unfiltered generator.
//
// The script resolves the builder relative to its own location, exactly as deployed — so each test copies it into a
// fresh temporary instance (<tmp>/scripts/), symlinks the real packages/admin beside it (the framework's layout) and
// node_modules (for js-yaml). Nothing here touches the checkout's own .well-known/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { ORG_ROOT, nodeModulesDir } from '../helpers/repo-paths.mjs';
const REAL_SCRIPT = path.join(ORG_ROOT, 'scripts', 'generate-all-schemas.mjs');
const REAL_ADMIN = path.join(ORG_ROOT, 'packages', 'admin');

const DAO_URI = 'https://dao.example.org/.well-known/dao.json';
const SAFE = '0x0000000000000000000000000000000000005afe';
const SAFE_CAIP10 = 'eip155:42220:0x0000000000000000000000000000000000005aFE';
// Every temporary instance is removed after the file's tests: they hold live symlinks into this checkout
// (packages/admin, scripts/lib). rmSync removes a symlink without following it.
const roots = [];
after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const MOVE = 'move these to data/systems.yaml (the 0.6 migration does: node scripts/migrations/v0.5-to-v0.6-canonical-records.mjs --dry, then the same without --dry)';

/**
 * A temporary instance: the script, and (unless `admin: false`) packages/admin symlinked as the framework has it.
 * `vendored: true` symlinks scripts/lib to admin's lib instead, the layout an instance's vendored copy keeps.
 */
function setupInstance({ admin = true, vendored = false, daoURI = DAO_URI, identity = '' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'generate-schemas-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(REAL_SCRIPT, path.join(root, 'scripts', 'generate-all-schemas.mjs'));
  symlinkSync(nodeModulesDir(), path.join(root, 'node_modules'), 'dir');
  if (admin) {
    mkdirSync(path.join(root, 'packages'));
    symlinkSync(REAL_ADMIN, path.join(root, 'packages', 'admin'), 'dir');
  }
  if (vendored) symlinkSync(path.join(REAL_ADMIN, 'lib'), path.join(root, 'scripts', 'lib'), 'dir');
  mkdirSync(path.join(root, '.well-known'));
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'federation.yaml'), `identity:
  name: "Test DAO"
  type: "DAO"
  daoURI: "${daoURI}"
${identity}`);
  writeFileSync(path.join(root, 'data', 'governance.yaml'), `schema_version: "2.0"
governance:
  model: "consensus"
  description: "Test DAO decides by consent."
  decisions:
    - id: "gov-2026-001"
      title: "Adopt the charter"
      status: "ratified"
      date: "2026-01-10"
      summary: "First decision."
    - id: "gov-2026-002"
      title: "Meet monthly"
      status: "ratified"
      date: "2026-02-11"
`);
  writeFileSync(path.join(root, 'data', 'systems.yaml'), `schema_version: "1.0"
systems:
  - id: "treasury"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "${SAFE}"
  - id: "drive"
    kind: "docs"
    name: "Drive"
    url: "https://drive.example/x"
`);
  writeFileSync(path.join(root, 'data', 'members.yaml'), `members:
  - id: "steward-a"
    name: "Steward A"
    email: "steward-a@example.org"
`);
  return root;
}
const publicGovernanceAndSystems = (root) => writeFileSync(path.join(root, 'data', 'visibility.yaml'), `visibility:
  collections:
    governance: { default: public }
    systems: { default: public }
`);

function run(root, args = []) {
  return spawnSync('node', [path.join(root, 'scripts', 'generate-all-schemas.mjs'), ...args], { encoding: 'utf-8' });
}
const out = (r) => `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const read = (root, file) => JSON.parse(readFileSync(path.join(root, '.well-known', file), 'utf-8'));
const listing = (root) => readdirSync(path.join(root, '.well-known')).sort();

test('with data/visibility.yaml making governance and systems public, proposals.json and contracts.json reflect the records', () => {
  const root = setupInstance();
  publicGovernanceAndSystems(root);
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  const proposals = read(root, 'proposals.json').proposals;
  assert.deepEqual(proposals.map((p) => [p.id, p.name, p.status]), [
    [`${DAO_URI}?proposalId=gov-2026-001`, 'Adopt the charter', 'ratified'],
    [`${DAO_URI}?proposalId=gov-2026-002`, 'Meet monthly', 'ratified'],
  ]);
  assert.doesNotMatch(JSON.stringify(proposals), /First decision/, 'a decision row\'s summary is never published (L8-C17)');
  assert.deepEqual(read(root, 'contracts.json').contracts, [
    { id: SAFE_CAIP10, name: 'Treasury', extensions: { 'org-os.kind': 'safe', 'org-os.system': 'treasury' } },
  ]);
  assert.match(readFileSync(path.join(root, '.well-known', 'governance.md'), 'utf-8'), /^# How Test DAO decides\n\nTest DAO decides by consent\.\n/);
  // the members collection is not public: nobody listed, no email anywhere
  assert.deepEqual(read(root, 'members.json').members, []);
  for (const f of listing(root)) assert.doesNotMatch(readFileSync(path.join(root, '.well-known', f), 'utf-8'), /steward-a@example\.org/, f);
});

test('without data/visibility.yaml, proposals.json and contracts.json are empty, and the CLI prints what was withheld', () => {
  const root = setupInstance();
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(read(root, 'proposals.json').proposals, []);
  assert.deepEqual(read(root, 'contracts.json').contracts, []);
  assert.equal(readFileSync(path.join(root, '.well-known', 'governance.md'), 'utf-8'), 'How Test DAO decides is not public.\n');
  assert.match(r.stdout, /withheld: members 1 record, 0 fields/);
  assert.match(r.stdout, /withheld: systems 2 records, 0 fields/);
  assert.match(r.stdout, /withheld: governance 1 record, 0 fields/);
});

test('it writes the builder\'s files, dao.json from the identity with no template, and never touches a template', () => {
  const root = setupInstance({ identity: '  short_description: "The crafted, ratified sentence."\n  description: "Legacy-field sentence."\n' });
  writeFileSync(path.join(root, '.well-known', 'dao.json.template'), '{ "name": "{{ORGANIZATION_NAME}}" }\n');
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(listing(root), ['activities.json', 'contracts.json', 'dao.json', 'dao.json.template', 'finances.json', 'governance.md',
    'ideas.json', 'knowledge.json', 'meetings.json', 'members.json', 'projects.json', 'proposals.json']);
  assert.equal(readFileSync(path.join(root, '.well-known', 'dao.json.template'), 'utf-8'), '{ "name": "{{ORGANIZATION_NAME}}" }\n');
  const dao = read(root, 'dao.json');
  assert.equal(dao.name, 'Test DAO');
  assert.equal(dao.type, 'DAO');
  assert.equal(dao.description, 'The crafted, ratified sentence.');
  assert.equal(dao.governanceURI, 'https://dao.example.org/.well-known/governance.md');
  assert.equal(dao.projectsURI, undefined);
  assert.ok(readFileSync(path.join(root, '.well-known', 'dao.json'), 'utf-8').endsWith('}\n'));
});

test('dao.json falls back to identity.description, and has no description when neither is set', () => {
  const legacy = setupInstance({ identity: '  description: "Legacy-field sentence."\n' });
  assert.equal(run(legacy).status, 0);
  assert.equal(read(legacy, 'dao.json').description, 'Legacy-field sentence.');
  const none = setupInstance();
  assert.equal(run(none).status, 0);
  assert.equal(read(none, 'dao.json').description, undefined, 'no boilerplate: a field with no value is left out');
});

test('a stale grant-pools.json is removed; an unrelated file stays', () => {
  const root = setupInstance();
  writeFileSync(path.join(root, '.well-known', 'grant-pools.json'), '{ "stale": true }\n');
  writeFileSync(path.join(root, '.well-known', 'skills.json'), '{ "mine": true }\n');
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.equal(existsSync(path.join(root, '.well-known', 'grant-pools.json')), false);
  assert.equal(readFileSync(path.join(root, '.well-known', 'skills.json'), 'utf-8'), '{ "mine": true }\n');
});

test('without a daoURI nothing is written: each 0.6 leftover is named in a warning, and kept (R32)', () => {
  const root = setupInstance({ daoURI: '' });
  writeFileSync(path.join(root, '.well-known', 'members.json'), '{ "kept": true }\n');
  writeFileSync(path.join(root, '.well-known', 'proposals.json'), '{ "kept": 2 }\n');
  writeFileSync(path.join(root, '.well-known', 'skills.json'), '{}\n');   // not a standard file: not named
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /· nothing generated: identity\.daoURI is not set — every id is built from it/);
  const named = [...r.stdout.matchAll(/⚠ \.well-known\/(\S+): left by an earlier generator and not refreshed without identity\.daoURI; not removed/g)].map(m => m[1]);
  assert.deepEqual(named, ['members.json', 'proposals.json']);
  assert.deepEqual(listing(root), ['members.json', 'proposals.json', 'skills.json']);
  assert.equal(readFileSync(path.join(root, '.well-known', 'members.json'), 'utf-8'), '{ "kept": true }\n');
  assert.equal(readFileSync(path.join(root, '.well-known', 'proposals.json'), 'utf-8'), '{ "kept": 2 }\n');
});

test('without a daoURI and no leftovers: no warning', () => {
  const root = setupInstance({ daoURI: '' });
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.doesNotMatch(r.stdout, /⚠/);
});

test("the CLI's own list of standard files is the builder's STANDARD_FILES", async () => {
  const { STANDARD_FILES } = await import(pathToFileURL(path.join(ORG_ROOT, 'packages', 'admin', 'lib', 'standards', 'build.mjs')).href);
  const text = readFileSync(path.join(ORG_ROOT, 'scripts', 'generate-all-schemas.mjs'), 'utf-8');
  const m = /const STANDARD_FILES = \[([^\]]*)\]/.exec(text);
  assert.ok(m, 'scripts/generate-all-schemas.mjs names STANDARD_FILES');
  assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]), STANDARD_FILES);
});

test('without packages/admin or a vendored builder the CLI exits 2, names both places, and writes nothing', () => {
  const root = setupInstance({ admin: false });
  const r = run(root);
  assert.equal(r.status, 2, out(r));
  assert.match(r.stderr, /✗ generate:schemas needs the org-os standards builder \(packages\/admin or scripts\/lib\/standards\)/);
  assert.deepEqual(listing(root), []);
});

test("an instance's vendored builder (scripts/lib/standards) writes the same files, and says the schemas were not checked", () => {
  const framework = setupInstance();
  publicGovernanceAndSystems(framework);
  const instance = setupInstance({ admin: false, vendored: true });
  publicGovernanceAndSystems(instance);
  const a = run(framework);
  const b = run(instance);
  assert.equal(a.status, 0, out(a));
  assert.equal(b.status, 0, out(b));
  assert.match(b.stdout, /· schemas not checked here \(no ajv\): run the framework's validate:schemas against this instance/);
  assert.doesNotMatch(a.stdout, /schemas not checked/);
  assert.deepEqual(listing(instance), listing(framework));
  for (const f of listing(framework)) {
    assert.equal(readFileSync(path.join(instance, '.well-known', f), 'utf-8'), readFileSync(path.join(framework, '.well-known', f), 'utf-8'), f);
  }
});

test('a target directory argument writes there and nowhere else', () => {
  const framework = setupInstance();
  const target = setupInstance({ admin: false });
  publicGovernanceAndSystems(target);
  const r = run(framework, [target]);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(listing(framework), [], 'the framework copy wrote into its own checkout');
  assert.ok(listing(target).includes('dao.json'));
  assert.equal(read(target, 'contracts.json').contracts.length, 1);
});

test('without on-chain systems it reads federation.yaml identity, public as identity, and says to move them', () => {
  const root = setupInstance({ identity: `  chain: "eip155:42220"\n  safe: "${SAFE}"\n` });
  writeFileSync(path.join(root, 'data', 'systems.yaml'), 'systems:\n  - id: "drive"\n    kind: "docs"\n    name: "Drive"\n    url: "https://drive.example/x"\n');
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(read(root, 'contracts.json').contracts.map((c) => c.id), [SAFE_CAIP10]);
  assert.ok(r.stdout.includes(`⚠ contracts.json: read from federation.yaml identity — ${MOVE}`), out(r));
  assert.doesNotMatch(r.stdout, /npm run migrate/);
});

test('then governance.yaml infrastructure, at the governance level, and says to move them', () => {
  const root = setupInstance();
  writeFileSync(path.join(root, 'data', 'systems.yaml'), 'systems: []\n');
  writeFileSync(path.join(root, 'data', 'governance.yaml'), `governance:\n  model: "consensus"\n  infrastructure:\n    safe: "${SAFE}"\n    chain: "eip155:42220"\n`);
  const hidden = run(root);
  assert.equal(hidden.status, 0, out(hidden));
  assert.deepEqual(read(root, 'contracts.json').contracts, [], 'governance is not public: neither is its infrastructure');
  assert.ok(hidden.stdout.includes(`⚠ contracts.json: read from data/governance.yaml infrastructure — ${MOVE}`), out(hidden));
  publicGovernanceAndSystems(root);
  assert.equal(run(root).status, 0);
  assert.deepEqual(read(root, 'contracts.json').contracts.map((c) => c.id), [SAFE_CAIP10]);
});

test('an unquoted address (a number to YAML) is never published, and a warning names the system', () => {
  const root = setupInstance();
  publicGovernanceAndSystems(root);
  writeFileSync(path.join(root, 'data', 'systems.yaml'), `systems:
  - id: "treasury"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: 0x1111111111111111111111111111111111111111
`);
  const r = run(root);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(read(root, 'contracts.json').contracts, []);
  assert.match(r.stdout, /⚠ contracts\.json: system treasury \(safe\) has no usable chain and address \(is the address quoted in YAML\?\)/);
});
