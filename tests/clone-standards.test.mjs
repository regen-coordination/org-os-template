// tests/clone-standards.test.mjs
//
// DAO-OS L8, Q56: a cloned instance carries the standards generator (clone stage 5 vendors it into scripts/lib/), so
// it generates its own .well-known/ — and writes exactly the bytes the framework's copy writes for the same records.
//
// The clone runs as operators run it: `node scripts/clone-framework.mjs --target … --config … --no-git`. Stage 5 is
// not a function the script exports (the generator is one top-level program), so the whole clone is the narrowest
// entry that exercises the real stage 5; --no-git keeps git out of the target. Every directory is a fresh mkdtemp,
// removed after the file's tests. No network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT, nodeModulesDir } from './helpers/repo-paths.mjs';
import { standardsVendorSet, diskSource } from '../scripts/lib/standards-vendor.mjs';

const CLONE = path.join(ORG_ROOT, 'scripts', 'clone-framework.mjs');
const CONFIG = path.join(ORG_ROOT, 'tests', 'fixtures', 'instance-config.yaml');
const FRAMEWORK_GENERATOR = path.join(ORG_ROOT, 'scripts', 'generate-all-schemas.mjs');

const DAO_URI = 'https://dao.example.org/.well-known/dao.json';
const SAFE = '0x0000000000000000000000000000000000005afe';
const OPS_SAFE = '0x00000000000000000000000000000000000000a9';

const roots = [];
after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** node:test's control variables, scrubbed so nested scripts behave as they do for an operator. */
function nestedEnv() {
  const { NODE_TEST_CONTEXT, NODE_TEST_WORKER_ID, ...rest } = process.env;
  return rest;
}
const out = (r) => `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

/** A fresh instance from the reference fixture config. */
function cloneInstance() {
  const base = mkdtempSync(path.join(tmpdir(), 'clone-standards-'));
  roots.push(base);
  const dir = path.join(base, 'instance');
  const r = spawnSync('node', [CLONE, '--target', dir, '--config', CONFIG, '--no-git'], { encoding: 'utf-8', timeout: 120_000, env: nestedEnv() });
  assert.equal(r.status, 0, `clone failed: ${out(r)}`);
  return { base, dir, log: r.stdout };
}

/** Task 4-style records: governance, systems, members and proposals public; steward-b members-level. */
function writeRecords(dir) {
  const w = (rel, text) => writeFileSync(path.join(dir, rel), text);
  w('federation.yaml', `identity:
  name: "Test DAO"
  type: "DAO"
  short_description: "A placeholder organisation for tests."
  daoURI: "${DAO_URI}"
`);
  w('data/visibility.yaml', `visibility:
  collections:
    governance: { default: public }
    systems: { default: public, fields: { notes: members } }
    members: { default: public, fields: { role: members } }
    proposals: { default: public }
`);
  w('data/members.yaml', `members:
  - id: "steward-a"
    name: "Steward A"
    kind: "person"
    status: "active"
    role: "WITHHELD-1-xxxxxx"
    email: "WITHHELD-2-xxxxxx@example.org"
  - id: "steward-b"
    visibility: "members"
    name: "WITHHELD-4-xxxxxx"
    kind: "person"
    status: "active"
    email: "WITHHELD-6-xxxxxx@example.org"
`);
  w('data/systems.yaml', `schema_version: "1.0"
systems:
  - id: "treasury"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "${SAFE}"
    notes: "WITHHELD-10-xxxxxx: signer rota"
  - id: "ops-safe"
    visibility: "members"
    kind: "safe"
    name: "WITHHELD-11-xxxxxx"
    chain: "eip155:42220"
    address: "${OPS_SAFE}"
`);
  w('data/governance.yaml', `schema_version: "2.0"
governance:
  model: "consensus"
  description: "Test DAO decides by consent."
  decisions:
    - id: "gov-2026-001"
      title: "Adopt the charter"
      status: "ratified"
      date: "2026-01-10"
      summary: "WITHHELD-20-xxxxxx: 1 approval (steward-a)."
    - id: "gov-2026-002"
      visibility: "members"
      title: "WITHHELD-22-xxxxxx: a members-only decision"
      status: "ratified"
      date: "2026-02-11"
`);
}

const wellKnown = (dir) => readdirSync(path.join(dir, '.well-known')).sort();
const readWK = (dir, f) => readFileSync(path.join(dir, '.well-known', f), 'utf-8');

test('a clone carries the vendored standards builder, its npm script, its workflow and js-yaml — and not packages/admin', () => {
  const { dir, log } = cloneInstance();
  const { files } = standardsVendorSet(diskSource(ORG_ROOT));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.ok(existsSync(path.join(dir, f.to)), `${f.to} is vendored`);
    assert.equal(readFileSync(path.join(dir, f.to), 'utf-8'), readFileSync(path.join(ORG_ROOT, f.from), 'utf-8'), `${f.to} is ${f.from}`);
  }
  assert.equal(existsSync(path.join(dir, 'scripts', 'lib', 'standards', 'index.mjs')), false, 'index.mjs needs ajv');
  assert.equal(existsSync(path.join(dir, 'scripts', 'lib', 'standards', 'validate.mjs')), false, 'validate.mjs needs ajv');
  assert.equal(existsSync(path.join(dir, 'packages', 'admin')), false);
  assert.match(log, /\[stage 5\] vendored the standards generator: \d+ files into scripts\/lib\//);

  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts['generate:schemas'], 'node scripts/generate-all-schemas.mjs');
  assert.ok(pkg.dependencies['js-yaml'], 'the CLI parses YAML with js-yaml');
  assert.ok(existsSync(path.join(dir, '.github', 'workflows', 'generate-schemas.yml')));
  // Framework-only suites that need packages/admin do not travel.
  for (const rel of ['tests/scripts/generate-schemas.test.mjs', 'tests/scripts/standards-vendor.test.mjs', 'tests/clone-standards.test.mjs']) {
    assert.equal(existsSync(path.join(dir, rel)), false, `${rel} needs packages/admin`);
  }
});

test("an instance's own generate:schemas writes byte-identical .well-known/ files to the framework's, and publishes no withheld value", () => {
  const { base, dir: copy1 } = cloneInstance();
  writeRecords(copy1);
  const copy2 = path.join(base, 'copy-2');
  cpSync(copy1, copy2, { recursive: true });
  symlinkSync(nodeModulesDir(), path.join(copy1, 'node_modules'), 'dir'); // js-yaml, as `npm install` gives an instance

  const own = spawnSync('node', ['scripts/generate-all-schemas.mjs'], { cwd: copy1, encoding: 'utf-8', timeout: 120_000, env: nestedEnv() });
  const fw = spawnSync('node', [FRAMEWORK_GENERATOR, copy2], { encoding: 'utf-8', timeout: 120_000, env: nestedEnv() });
  assert.equal(own.status, 0, out(own));
  assert.equal(fw.status, 0, out(fw));
  assert.match(own.stdout, /· schemas not checked here \(no ajv\)/, 'the instance ran its vendored copy');
  assert.doesNotMatch(fw.stdout, /schemas not checked/, 'the framework ran its own builder');

  assert.deepEqual(wellKnown(copy1), wellKnown(copy2));
  for (const f of wellKnown(copy2)) assert.equal(readWK(copy1, f), readWK(copy2, f), `.well-known/${f} differs`);
  for (const dir of [copy1, copy2]) {
    for (const f of wellKnown(dir)) assert.doesNotMatch(readWK(dir, f), /WITHHELD-/, `${f} publishes a withheld value`);
  }

  // Not vacuous: the public records are there.
  const members = JSON.parse(readWK(copy1, 'members.json')).members;
  assert.deepEqual(members.map((m) => m.id), ['https://dao.example.org/members/steward-a']);
  assert.match(readWK(copy1, 'contracts.json'), /eip155:42220:0x0000000000000000000000000000000000005aFE/);
  assert.doesNotMatch(readWK(copy1, 'contracts.json'), /0{38}a9/i, 'the members-level Safe is not published');
  assert.deepEqual(JSON.parse(readWK(copy1, 'proposals.json')).proposals.map((p) => p.name), ['Adopt the charter']);
  assert.equal(JSON.parse(readWK(copy1, 'dao.json')).name, 'Test DAO');
});

test("a clone's own validate:schemas runs its vendored leak scan: clean output passes it, a planted withheld value fails with exit 1 (R39)", () => {
  const { dir } = cloneInstance();
  // The clone's own federation.yaml, given a daoURI, so every other check of validate:schemas passes as on day one.
  const federation = readFileSync(path.join(dir, 'federation.yaml'), 'utf-8');
  assert.match(federation, /^identity:\n/m);
  writeRecords(dir);
  writeFileSync(path.join(dir, 'federation.yaml'), federation.replace(/^identity:\n/m, `identity:\n  daoURI: "${DAO_URI}"\n`));
  symlinkSync(nodeModulesDir(), path.join(dir, 'node_modules'), 'dir'); // js-yaml, as `npm install` gives an instance
  assert.equal(existsSync(path.join(dir, 'packages', 'admin')), false, 'the clone has no packages/admin: only ./lib/standards/ can scan');

  const gen = spawnSync('node', ['scripts/generate-all-schemas.mjs'], { cwd: dir, encoding: 'utf-8', timeout: 120_000, env: nestedEnv() });
  assert.equal(gen.status, 0, out(gen));
  const validate = () => spawnSync('node', ['scripts/validate-identity.mjs'], { cwd: dir, encoding: 'utf-8', timeout: 120_000, env: nestedEnv() });

  // Clean: the vendored scan loaded (not the "not checked here" fallback) and found nothing.
  const clean = validate();
  assert.equal(clean.status, 0, out(clean));
  assert.doesNotMatch(clean.stdout, /standards not checked here/, `the vendored ./lib/standards/ did not load:\n${out(clean)}`);
  assert.match(clean.stdout, /standards schemas not checked here \(no ajv\)/, out(clean));
  assert.match(clean.stdout, /✓ no withheld value is published in \.well-known\//, out(clean));
  assert.doesNotMatch(clean.stdout, /a withheld value \(\d+ characters\) is published/, out(clean));

  // Planted: steward-b is members-level; their name in members.json is a leak.
  const file = path.join(dir, '.well-known', 'members.json');
  const doc = JSON.parse(readFileSync(file, 'utf-8'));
  doc.members.push({ id: 'https://dao.example.org/members/steward-b', name: 'WITHHELD-4-xxxxxx' });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  const planted = validate();
  assert.equal(planted.status, 1, out(planted));
  assert.match(planted.stdout, /✗ members\.json: a withheld value \(\d+ characters\) is published at /, out(planted));
  assert.doesNotMatch(planted.stdout, /WITHHELD-4-/, 'the leak line does not repeat the value');
  assert.doesNotMatch(planted.stdout, /✓ no withheld value is published/, out(planted));
});
