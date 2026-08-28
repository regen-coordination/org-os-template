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
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ORG_ROOT = path.resolve('.');
const REAL_SCRIPT = path.join(ORG_ROOT, 'scripts', 'generate-all-schemas.mjs');

function setupInstance() {
  const root = mkdtempSync(path.join(tmpdir(), 'generate-schemas-'));
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(REAL_SCRIPT, path.join(root, 'scripts', 'generate-all-schemas.mjs'));
  symlinkSync(path.join(ORG_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');

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
