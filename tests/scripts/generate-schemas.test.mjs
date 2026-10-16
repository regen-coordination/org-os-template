// tests/scripts/generate-schemas.test.mjs
//
// Regression coverage for scripts/generate-all-schemas.mjs, specifically
// generateProposals() and generateActivities(). A merge once silently
// replaced these with empty-placeholder stubs (main's older version),
// discarding the dev line's real data/governance.yaml → proposals.json and
// data/meetings.yaml → activities.json wiring. No existing test caught it —
// validate-identity.mjs only checks that .well-known/*.json parse, not that
// their content reflects the source registries. This test asserts content.
//
// The script resolves its instance root from its own location
// (path.resolve(__dirname, "..")), exactly as deployed on an instance — so,
// following the pattern in tests/scripts/validate-identity.test.mjs, the
// fixture copies the script into <tmp>/scripts/ and symlinks node_modules
// for js-yaml / gray-matter resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT, nodeModulesDir } from '../helpers/repo-paths.mjs';
const REAL_SCRIPT = path.join(ORG_ROOT, 'scripts', 'generate-all-schemas.mjs');

function setupInstance({ fundingLib = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'generate-schemas-'));
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(REAL_SCRIPT, path.join(root, 'scripts', 'generate-all-schemas.mjs'));
  // The generator imports its pure helpers from scripts/lib/.
  mkdirSync(path.join(root, 'scripts', 'lib'));
  if (fundingLib) copyFileSync(path.join(ORG_ROOT, 'scripts', 'lib', 'funding-registry.mjs'), path.join(root, 'scripts', 'lib', 'funding-registry.mjs'));
  symlinkSync(nodeModulesDir(), path.join(root, 'node_modules'), 'dir');

  mkdirSync(path.join(root, '.well-known'));
  mkdirSync(path.join(root, 'data'));

  // Top-level code reads federation.yaml unconditionally.
  writeFileSync(path.join(root, 'federation.yaml'), `identity:
  name: test-org
  type: Project
  daoURI: ""
`);

  writeFileSync(path.join(root, 'data', 'governance.yaml'), `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  decisions:
    - id: "gov-20260424-001"
      title: "Self-hosting inauguration"
      type: "amendment"
      status: "ratified"
      date: "2026-04-24"
      summary: "First decision."
    - id: "gov-20260424-002"
      title: "Projects-vs-plans separation"
      type: "amendment"
      status: "ratified"
      date: "2026-04-24"
      summary: "Second decision."
`);

  writeFileSync(path.join(root, 'data', 'meetings.yaml'), `schema_version: "2.0"
meetings:
  - id: "meeting-2026-04-24"
    title: "Kickoff sync"
    date: "2026-04-24"
    summary: "First meeting."
`);

  return root;
}

function run(root) {
  return spawnSync('node', [path.join(root, 'scripts', 'generate-all-schemas.mjs')], { encoding: 'utf-8' });
}

test('generateProposals reads data/governance.yaml — proposals.json is non-empty and reflects it', () => {
  const root = setupInstance();
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const proposals = JSON.parse(readFileSync(path.join(root, '.well-known', 'proposals.json'), 'utf-8'));
  assert.equal(proposals.proposals.length, 2, 'expected both governance.yaml decisions to appear as proposals');
  const ids = proposals.proposals.map((p) => p.id).sort();
  assert.deepEqual(ids, ['gov-20260424-001', 'gov-20260424-002']);
  assert.equal(proposals.proposals[0].title, 'Self-hosting inauguration');
  assert.equal(proposals.proposals[0].status, 'ratified');
});

test('generateActivities reads data/meetings.yaml — activities.json is non-empty and reflects it', () => {
  const root = setupInstance();
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const activities = JSON.parse(readFileSync(path.join(root, '.well-known', 'activities.json'), 'utf-8'));
  assert.equal(activities.activities.length, 1, 'expected the meetings.yaml entry to appear as an activity');
  assert.equal(activities.activities[0].id, 'meeting-2026-04-24');
  assert.equal(activities.activities[0].type, 'meeting');
});

test('proposals.json is empty (not missing) when data/governance.yaml has no decisions', () => {
  const root = setupInstance();
  writeFileSync(path.join(root, 'data', 'governance.yaml'), `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  decisions: []
`);
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const proposals = JSON.parse(readFileSync(path.join(root, '.well-known', 'proposals.json'), 'utf-8'));
  assert.deepEqual(proposals.proposals, []);
});

// Regression coverage for generateDao()'s description field. It used to read
// only `identity.description`, a key no generator ever writes — the canonical
// field everywhere else (clone-framework.mjs, render-templates.mjs, the
// genesis config) is `identity.short_description`. So the boilerplate
// fallback always fired, silently, and stayed invisible because generateDao()
// early-returns until `identity.daoURI` is set. Found 2026-09-16 during the
// PersonalNode instance activation, whose Task 9 was the first thing in that
// instance's life to set daoURI — which is exactly when the bug surfaced.
const REAL_DAO_TEMPLATE = path.join(ORG_ROOT, '.well-known', 'dao.json.template');

function setupDaoInstance(identityExtra = '') {
  const root = setupInstance();
  mkdirSync(path.join(root, '.well-known'), { recursive: true });
  copyFileSync(REAL_DAO_TEMPLATE, path.join(root, '.well-known', 'dao.json.template'));
  writeFileSync(
    path.join(root, 'federation.yaml'),
    `identity:
  name: test-org
  type: Project
  daoURI: "https://test-org.example/.well-known/dao.json"
${identityExtra}`
  );
  return root;
}

test('generateDao() uses identity.short_description verbatim when set', () => {
  const root = setupDaoInstance('  short_description: "The crafted, ratified sentence — not boilerplate."\n');
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const dao = JSON.parse(readFileSync(path.join(root, '.well-known', 'dao.json'), 'utf-8'));
  assert.equal(dao.description, 'The crafted, ratified sentence — not boilerplate.');
});

test('generateDao() falls back to legacy identity.description when short_description is absent', () => {
  const root = setupDaoInstance('  description: "Legacy-field sentence."\n');
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const dao = JSON.parse(readFileSync(path.join(root, '.well-known', 'dao.json'), 'utf-8'));
  assert.equal(dao.description, 'Legacy-field sentence.');
});

test('generateDao() only uses the generic boilerplate when neither field is set', () => {
  const root = setupDaoInstance();
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const dao = JSON.parse(readFileSync(path.join(root, '.well-known', 'dao.json'), 'utf-8'));
  assert.equal(dao.description, 'test-org operational identity surface for governance, members, projects, and coordination.');
});

// The funding registry is optional: an instance that has no data/funding.yaml (or was cloned
// before scripts/lib/funding-registry.mjs existed) must still generate everything else.
test('without data/funding.yaml the generator needs no funding-registry module', () => {
  const root = setupInstance({ fundingLib: false });
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(existsSync(path.join(root, '.well-known', 'funding.json')), false);
});

test('data/funding.yaml becomes funding.json; a flow in an unlisted pool is skipped with a warning', () => {
  const root = setupInstance();
  writeFileSync(path.join(root, 'data', 'funding.yaml'), `org: { id: test-org, name: Test Org }
pools:
  - { id: p1, name: Pool 1 }
flows:
  - { id: f1, type: contribution, pool: p1, date: 2026-10-01, to: { name: A } }
  - { id: f2, type: contribution, pool: p9, date: 2026-10-01, to: { name: B } }
calls:
  - { id: c1, title: Call, call_type: civic, amount: 3000 }
`);
  const result = run(root);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const funding = JSON.parse(readFileSync(path.join(root, '.well-known', 'funding.json'), 'utf-8'));
  assert.deepEqual(funding.flows.map((f) => f.id), ['f1']);
  assert.equal(funding.calls[0].amount, '3000');
  assert.match(result.stderr + result.stdout, /⚠ funding\.yaml: skipped flow f2 — pool "p9" is not a listed pool/);
});
