// tests/scripts/migration-canonical-records.test.mjs
//
// scripts/migrations/v0.5-to-v0.6-canonical-records.mjs (F1 spec §3.8) on
// throwaway instances. Every fixture is synthetic: the shapes are the ones the
// 2026-10-16 fleet survey found, the values are invented. The script takes the
// instance root as its argument, so it runs in place from this checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'migrations', 'v0.5-to-v0.6-canonical-records.mjs');
const SAFE = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

const GOVERNANCE = (infrastructure) => `schema_version: "2.0"
governance:
  model: "consensus"
  description: "Decisions by consent of the members present."
  infrastructure:
${infrastructure}
  decisions: []
`;
const FEDERATION = (identity) => `identity:
  name: "Fixture Coop"
${identity}
`;

/** A consensus-shaped instance: the Safe in both files, with `chain` beside it in governance.yaml. */
function instance({ governance, federation, members, systems } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-0.6-'));
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data', 'governance.yaml'), governance ?? GOVERNANCE(`    safe: "${SAFE}"
    chain: "eip155:42220"
    hats_tree: null
    gardens: null
    snapshot: null`));
  writeFileSync(path.join(root, 'federation.yaml'), federation ?? FEDERATION(`  chain: "eip155:42220"
  safe: "${SAFE}"
  hats: null
  gardens: ""`));
  if (members) writeFileSync(path.join(root, 'data', 'members.yaml'), members);
  if (systems) writeFileSync(path.join(root, 'data', 'systems.yaml'), systems);
  return root;
}

const run = (root, ...args) => spawnSync('node', [SCRIPT, root, ...args], { encoding: 'utf-8' });
const listed = (stdout) => stdout.split('\n').filter((l) => l.startsWith('  + '));
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf-8');

test('--dry lists the one System and writes nothing at all', () => {
  const root = instance();
  const before = { gov: read(root, 'data/governance.yaml'), fed: read(root, 'federation.yaml') };
  const r = run(root, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(listed(r.stdout), [
    `  + treasury-safe (safe) eip155:42220 ${SAFE} — from data/governance.yaml infrastructure.safe, federation.yaml identity.safe`,
  ]);
  assert.match(r.stdout, /\(--dry\) Nothing was written\./);
  assert.equal(existsSync(path.join(root, 'data', 'systems.yaml')), false);
  assert.equal(existsSync(path.join(root, 'memory')), false, 'a dry run writes no log either');
  assert.deepEqual(readdirSync(path.join(root, 'data')).sort(), ['governance.yaml']);
  assert.equal(read(root, 'data/governance.yaml'), before.gov);
  assert.equal(read(root, 'federation.yaml'), before.fed);
});

test('a consensus-shaped run creates exactly one System, the Safe with driver safe; keeps the originals byte for byte; logs', () => {
  const root = instance();
  const before = { gov: read(root, 'data/governance.yaml'), fed: read(root, 'federation.yaml') };
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  const doc = yaml.load(read(root, 'data/systems.yaml'));
  assert.equal(doc.schema_version, '1.0');
  assert.deepEqual(doc.systems, [{
    id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: SAFE,
    driver: 'safe', section: 'organization/treasury',
  }]);
  assert.equal(read(root, 'data/governance.yaml'), before.gov);
  assert.equal(read(root, 'federation.yaml'), before.fed);
  const logs = readdirSync(path.join(root, 'memory')).filter((f) => /^migrations-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.equal(logs.length, 1);
  assert.match(read(root, `memory/${logs[0]}`), /## v0\.5-to-v0\.6-canonical-records — /);
});

test('a second run changes nothing: idempotent', () => {
  const root = instance();
  assert.equal(run(root).status, 0);
  const first = read(root, 'data/systems.yaml');
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root, 'data/systems.yaml'), first);
  assert.match(r.stdout, /data\/systems\.yaml already holds every system found; left as it is/);
  assert.deepEqual(listed(r.stdout), []);
});

test('a Safe address the two files disagree on is reported, and neither is migrated', () => {
  const root = instance({ federation: FEDERATION(`  chain: "eip155:42220"\n  safe: "${OTHER}"`) });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(listed(r.stdout), []);
  assert.match(r.stdout, /the Safe address disagrees between data\/governance\.yaml infrastructure\.safe \(0x1{40}\) and federation\.yaml identity\.safe \(0x2{40}\): neither was migrated/);
  assert.equal(existsSync(path.join(root, 'data', 'systems.yaml')), false);
});

test('the same address in two cases is one Safe, not a disagreement', () => {
  const mixed = '0xABCDEFabcdef0000000000000000000000000000';
  const root = instance({
    governance: GOVERNANCE(`    safe: "${mixed}"\n    chain: "eip155:42220"`),
    federation: FEDERATION(`  chain: "eip155:42220"\n  safe: "${mixed.toLowerCase()}"`),
  });
  const r = run(root, '--dry');
  assert.equal(listed(r.stdout).length, 1);
});

test('a governance.yaml of several YAML documents is reported and not read; federation.yaml still is', () => {
  const root = instance({
    governance: 'schema_version: "2.0"\n---\ndecisions:\n  - id: "DR-1"\n---\nnotes:\n  topic: "x"\n',
  });
  const r = run(root, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /data\/governance\.yaml holds 3 YAML documents.*merge them into one document under `governance:` by hand/);
  assert.deepEqual(listed(r.stdout), [
    `  + treasury-safe (safe) eip155:42220 ${SAFE} — from federation.yaml identity.safe`,
  ]);
});

test('a value that is not an address is reported, not migrated', () => {
  const root = instance({
    governance: GOVERNANCE('    safe: null'),
    federation: FEDERATION('  chain: "eip155:1"\n  safe: "TBD"\n  gardens: "active - see the onboarding source"'),
  });
  const r = run(root, '--dry');
  assert.deepEqual(listed(r.stdout), []);
  assert.match(r.stdout, /federation\.yaml identity\.safe is "TBD", which is not a 0x address: not migrated/);
  assert.match(r.stdout, /federation\.yaml identity\.gardens is "active - see the onboarding source"/);
});

test('an address written without quotes (YAML reads it as a number) is reported, not garbled', () => {
  const root = instance({
    governance: GOVERNANCE('    safe: null'),
    federation: FEDERATION(`  chain: "eip155:42220"\n  safe: ${SAFE}`),
  });
  const r = run(root, '--dry');
  assert.deepEqual(listed(r.stdout), []);
  assert.match(r.stdout, /federation\.yaml identity\.safe reads as a number, not an address: put the address in quotes/);
});

test('an on-chain system with no chain in either file is reported, not migrated', () => {
  const root = instance({
    governance: GOVERNANCE(`    safe: "${SAFE}"`),
    federation: FEDERATION('  safe: ""'),
  });
  const r = run(root, '--dry');
  assert.deepEqual(listed(r.stdout), []);
  assert.match(r.stdout, /has no chain beside it in either file: not migrated/);
});

test('a chain that is present but not CAIP-2 is named with its file and value, not called absent', () => {
  const root = instance({
    governance: GOVERNANCE(`    safe: "${SAFE}"\n    chain: "celo"`),
    federation: FEDERATION('  chain: 42220'),
  });
  const r = run(root, '--dry');
  assert.deepEqual(listed(r.stdout), []);
  assert.doesNotMatch(r.stdout, /has no chain beside it in either file/);
  assert.match(r.stdout, /! the Safe address 0x1{40} \(from data\/governance\.yaml infrastructure\.safe\) was not migrated: its chain is not a CAIP-2 chain id \(such as "eip155:42220"\): data\/governance\.yaml infrastructure\.chain is "celo", federation\.yaml identity\.chain is 42220\. Add it to data\/systems\.yaml with its CAIP-2 chain\./);
});

test('a valid chain in one file and an invalid one in the other: migrated on the valid one, the invalid one reported', () => {
  const root = instance({
    governance: GOVERNANCE(`    safe: "${SAFE}"\n    chain: "eip155:42220"`),
    federation: FEDERATION(`  chain: "celo-mainnet"\n  safe: "${SAFE}"`),
  });
  const r = run(root, '--dry');
  assert.deepEqual(listed(r.stdout), [
    `  + treasury-safe (safe) eip155:42220 ${SAFE} — from data/governance.yaml infrastructure.safe, federation.yaml identity.safe`,
  ]);
  assert.match(r.stdout, /Needs people \(1\)/);
  assert.match(r.stdout, /! federation\.yaml identity\.chain is "celo-mainnet", which is not a CAIP-2 chain id \(such as "eip155:42220"\): ignored; the systems were migrated on eip155:42220, from data\/governance\.yaml infrastructure\.chain\. Correct it or remove it\./);
});

test('gardens, hats and snapshot become Systems of their own kinds', () => {
  const root = instance({
    governance: GOVERNANCE(`    safe: "${SAFE}"\n    chain: "eip155:42220"\n    gardens: "${OTHER}"\n    hats_tree: 42\n    snapshot: "fixture.eth"`),
    federation: FEDERATION('  type: "Cooperative"'),
  });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  const doc = yaml.load(read(root, 'data/systems.yaml'));
  // Only safe has a built-in driver; the others carry no driver field, which the platform reads as link.
  assert.deepEqual(doc.systems.map((s) => [s.id, s.kind, s.address ?? s.url, s.driver ?? null]), [
    ['treasury-safe', 'safe', SAFE, 'safe'],
    ['gardens-pool', 'gardens-pool', OTHER, null],
    ['hats-tree', 'hats-tree', '42', null],
    ['snapshot-space', 'snapshot-space', 'https://snapshot.org/#/fixture.eth', null],
  ]);
});

test('an existing data/systems.yaml is never rewritten; what it lacks is listed', () => {
  const existing = 'schema_version: "1.0"\n# kept as written\nsystems:\n  - id: "drive"\n    kind: "docs"\n    name: "Drive"\n    url: "https://drive.example/x"\n';
  const root = instance({ systems: existing });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root, 'data/systems.yaml'), existing);
  assert.match(r.stdout, /data\/systems\.yaml already exists, so it was not rewritten\. It lacks 1 system\(s\)/);
  assert.match(r.stdout, /\+ treasury-safe \(safe\)/);
});

test('members whose kind or layer is unclear are reported, never changed', () => {
  const members = `members:
  - id: "did:fixture:ana"
    type: "individual"
  - id: "fixture:role:council"
    kind: "committee"
    layer: "network"
  - id: "fixture:funder:one"
    type: "funder"
    layer: "funders"
`;
  const root = instance({ members });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root, 'data/members.yaml'), members);
  assert.match(r.stdout, /member "fixture:role:council": kind "committee" is not one of person, agent, organization, role/);
  assert.match(r.stdout, /member "fixture:funder:one": type "funder" says nothing the platform reads/);
  assert.doesNotMatch(r.stdout, /did:fixture:ana/, 'type: individual is a person, said another way');
  assert.match(r.stdout, /layer values outside the default vocabulary \(core, contributor, community, observer\): network ×1, funders ×1/);
});

test('a root that is missing or is not an instance exits 2 and creates nothing', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'migration-0.6-root-'));
  const missing = path.join(parent, 'nope');
  const r1 = run(missing);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /nope is not an org-os instance/);
  assert.equal(existsSync(missing), false);
  const empty = path.join(parent, 'empty');
  mkdirSync(empty);
  const r2 = run(empty);
  assert.equal(r2.status, 2);
  assert.deepEqual(readdirSync(empty), []);
});

test('an infrastructure key the migration does not know is reported with its value, not migrated, and completeness is not claimed', () => {
  const root = instance({
    governance: GOVERNANCE(`    safe: "${SAFE}"\n    chain: "eip155:42220"\n    multisig: "0x3333333333333333333333333333333333333333"\n    notes: null`),
  });
  const r = run(root, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(listed(r.stdout).length, 1);
  assert.match(r.stdout, /! data\/governance\.yaml infrastructure\.multisig is "0x3{40}", a key this migration does not know: not migrated/);
  assert.doesNotMatch(r.stdout, /infrastructure\.notes/);
  assert.equal(run(root).status, 0);
  const again = run(root);
  assert.match(again.stdout, /already holds every system this migration could read/);
  assert.doesNotMatch(again.stdout, /every system found/);
});

test('hats is read as hats_tree, in governance.yaml and federation.yaml alike', () => {
  const g = instance({ governance: GOVERNANCE(`    chain: "eip155:42220"\n    hats: 77`), federation: FEDERATION('  type: "Cooperative"') });
  assert.match(run(g, '--dry').stdout, /\+ hats-tree \(hats-tree\) eip155:42220 77 — from data\/governance\.yaml infrastructure\.hats\b/);
  const f = instance({ governance: GOVERNANCE('    safe: null\n    chain: "eip155:42220"'), federation: FEDERATION('  hats: "88"') });
  assert.match(run(f, '--dry').stdout, /\+ hats-tree \(hats-tree\) eip155:42220 88 — from federation\.yaml identity\.hats/);
});

// ── F2 review follow-up ──────────────────────────────────────────────────────
const receiptOf = (root) => {
  const logs = existsSync(path.join(root, 'memory')) ? readdirSync(path.join(root, 'memory')).filter((f) => /^migrations-/.test(f)) : [];
  return logs.length === 0 ? null : read(root, `memory/${logs[0]}`);
};

test('L3: the output and the receipt name the instance as "." and carry no absolute path of this machine', () => {
  const root = instance();
  const r = run(root);
  assert.ok(!r.stdout.includes(root), r.stdout);
  assert.ok(!receiptOf(root).includes(root), receiptOf(root));
  assert.ok(!/\/(?:tmp|var|private|Users|home)\//.test(receiptOf(root)), receiptOf(root));
});

test('L2: a second run with nothing to do adds nothing to the receipt', () => {
  const root = instance();
  run(root);
  const once = receiptOf(root);
  assert.equal(run(root).status, 0);
  assert.equal(receiptOf(root), once);
});
