// tests/instance-doctor/versions.test.mjs
//
// B3 — version surfaces, cross-scheme aware. Fixtures model the real
// signatures found by the 2026-08-28 instance sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  milestoneOrdinal,
  frameworkVersionSurfaces,
  checkVersions,
} from '../../packages/instance-doctor/src/checks/versions.mjs';

// --- the re-baseline map (source of truth: CHANGELOG [0.5.0]) -------------

test('milestoneOrdinal maps the legacy line onto milestones 1-4', () => {
  assert.equal(milestoneOrdinal('1.0.0'), 1);
  assert.equal(milestoneOrdinal('2.0'), 2);
  assert.equal(milestoneOrdinal('3.0'), 3);
  assert.equal(milestoneOrdinal('3.0.0'), 3);
  assert.equal(milestoneOrdinal('3.5'), 4);
  assert.equal(milestoneOrdinal('3.5.0'), 4);
});

test('milestoneOrdinal reads the 0.x pre-beta line as minor = milestone', () => {
  // "0.5 < 3.5 is intentional" — CHANGELOG [0.5.0]. 0.5 is the FIFTH milestone.
  assert.equal(milestoneOrdinal('0.5'), 5);
  assert.equal(milestoneOrdinal('0.5.0'), 5);
  assert.equal(milestoneOrdinal('0.6'), 6);
  assert.ok(milestoneOrdinal('0.5') > milestoneOrdinal('3.5'));
});

test('milestoneOrdinal returns null for unparseable or unmapped schemes', () => {
  assert.equal(milestoneOrdinal(null), null);
  assert.equal(milestoneOrdinal(''), null);
  assert.equal(milestoneOrdinal('not-a-version'), null);
  assert.equal(milestoneOrdinal('9.9'), null);
});

// --- which surfaces claim to state the FRAMEWORK version -----------------

test('package.json version is an instance surface unless the name leaked from the template', () => {
  // refi-med-os: its own 0.1.0 is not a framework claim.
  const own = frameworkVersionSurfaces({
    packageJson: { name: 'refi-med-os', version: '0.1.0' },
    federation: { metadata: { framework_version: '3.0' } },
  });
  assert.deepEqual(
    own.map((s) => s.surface),
    ['federation.yaml'],
  );

  // regen-coordination-os: still named organizational-os-template, so its
  // package.json version IS a framework claim (3.0.0).
  const leaked = frameworkVersionSurfaces({
    packageJson: { name: 'organizational-os-template', version: '3.0.0' },
    federation: { metadata: { framework_version: '3.0' } },
  });
  assert.deepEqual(leaked.map((s) => s.surface).sort(), ['federation.yaml', 'package.json']);
});

test('VERSION.md contributes its labelled Framework Version line', () => {
  const surfaces = frameworkVersionSurfaces({
    packageJson: { name: 'refi-dao-os', version: '1.0.0' },
    federation: { metadata: { framework_version: '3.0' } },
    versionMd: '# VERSION.md\n\n**Framework Version:** `1.0.0`  \n\nsemver blurb 2.0.0\n',
  });
  const bySurface = Object.fromEntries(surfaces.map((s) => [s.surface, s.value]));
  assert.equal(bySurface['VERSION.md'], '1.0.0');
  assert.equal(bySurface['federation.yaml'], '3.0');
});

test('CHANGELOG contributes its newest release heading', () => {
  const surfaces = frameworkVersionSurfaces({
    packageJson: { name: 'x', version: '0.1.0' },
    federation: { metadata: { framework_version: '0.5' } },
    changelog: '# Changelog\n\n## [Unreleased]\n\n## [0.5.0] — 2026-06-17\n\n## [3.5.0] — 2026-05-16\n',
  });
  const bySurface = Object.fromEntries(surfaces.map((s) => [s.surface, s.value]));
  assert.equal(bySurface['CHANGELOG.md'], '0.5.0');
});

// --- the check itself ----------------------------------------------------

test('refi-dao-os signature: VERSION.md 1.0.0 vs federation 3.0 is a BLOCKER contradiction', () => {
  const result = checkVersions({
    packageJson: { name: 'refi-dao-os', version: '1.0.0' },
    federation: { metadata: { framework_version: '3.0' } },
    versionMd: '**Framework Version:** `1.0.0`\n',
    framework: { version: '0.5.0' },
  });
  assert.equal(result.id, 'versions');
  assert.equal(result.status, 'BLOCKER');
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes('version-surfaces-contradict'), JSON.stringify(codes));
  const contradiction = result.findings.find((f) => f.code === 'version-surfaces-contradict');
  assert.match(contradiction.message, /VERSION\.md/);
  assert.match(contradiction.message, /federation\.yaml/);
});

test('a coherent but stale instance reports staleness as a WARN, not a contradiction', () => {
  const result = checkVersions({
    packageJson: { name: 'refi-bcn-os', version: '1.0.0' },
    federation: { metadata: { framework_version: '3.0' } },
    framework: { version: '0.5.0' },
  });
  assert.equal(result.status, 'WARN');
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes('framework-version-stale'), JSON.stringify(codes));
  assert.ok(!codes.includes('version-surfaces-contradict'));
  const stale = result.findings.find((f) => f.code === 'framework-version-stale');
  assert.match(stale.message, /2 milestone/);
});

test('cross-scheme comparison does not read 3.0 as newer than 0.5', () => {
  const result = checkVersions({
    packageJson: { name: 'bread-coop-os', version: '0.1.0' },
    federation: { metadata: { framework_version: '3.5' } },
    framework: { version: '0.5.0' },
  });
  const stale = result.findings.find((f) => f.code === 'framework-version-stale');
  assert.ok(stale, 'expected 3.5 to be reported as one milestone behind 0.5');
  assert.match(stale.message, /1 milestone/);
});

test('an instance re-stamped to 0.5 is OK', () => {
  const result = checkVersions({
    packageJson: { name: 'refi-med-os', version: '0.1.0' },
    federation: { metadata: { framework_version: '0.5' } },
    versionMd: '**Framework Version:** `0.5.0`\n',
    framework: { version: '0.5.0' },
  });
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.findings, []);
});

test('a missing framework_version is a BLOCKER — nothing can be compared', () => {
  const result = checkVersions({
    packageJson: { name: 'x', version: '0.1.0' },
    federation: { metadata: {} },
    framework: { version: '0.5.0' },
  });
  assert.equal(result.status, 'BLOCKER');
  assert.ok(result.findings.some((f) => f.code === 'framework-version-missing'));
});

test('an unmapped scheme is reported rather than silently ignored', () => {
  const result = checkVersions({
    packageJson: { name: 'x', version: '0.1.0' },
    federation: { metadata: { framework_version: '9.9' } },
    framework: { version: '0.5.0' },
  });
  assert.ok(result.findings.some((f) => f.code === 'version-scheme-unknown'));
});
