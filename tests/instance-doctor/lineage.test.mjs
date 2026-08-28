// tests/instance-doctor/lineage.test.mjs
//
// B2 — lineage stamps. Fixtures model the real signatures: bread-coop-os is the
// only instance carrying a genesis stamp; refi-bcn-os and refi-med-os carry
// prose-only claims (`upstream[].relationship: fork` with a date-shaped
// last_sync, `metadata.scaffolded_from`) that no machine ever recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLineage, prosePedigree } from '../../packages/instance-doctor/src/checks/lineage.mjs';

const FRAMEWORK = { headSha: 'a'.repeat(40), version: '0.5.0' };

test('prosePedigree recognises a scaffolded_from claim', () => {
  const claims = prosePedigree({
    federation: {
      metadata: { scaffolded_from: 'regen-coordination/organizational-os-framework@3.0' },
    },
  });
  assert.equal(claims.length, 1);
  assert.match(claims[0], /scaffolded_from/);
});

test('prosePedigree recognises a fork relationship with a date-shaped last_sync', () => {
  const claims = prosePedigree({
    federation: {
      upstream: [
        {
          type: 'template',
          repository: 'luizfernandosg/organizational-os-template',
          relationship: 'fork',
          last_sync: '',
        },
      ],
    },
  });
  assert.equal(claims.length, 1);
  assert.match(claims[0], /upstream\[0\]/);
});

test('prosePedigree finds nothing when there is no claim at all', () => {
  assert.deepEqual(prosePedigree({ federation: { metadata: {} } }), []);
});

test('bread-coop-os signature: genesis stamped, never synced', () => {
  const r = checkLineage({
    federation: {
      metadata: {
        genesis_commit: 'af8941a273a7588a8ba20209671ba26236c5549a',
        last_sync_commit: null,
      },
    },
    framework: FRAMEWORK,
    commitsBehindFramework: null,
  });
  assert.equal(r.id, 'lineage');
  assert.equal(r.status, 'WARN');
  const codes = r.findings.map((f) => f.code);
  assert.deepEqual(codes, ['never-synced']);
});

test('refi-bcn-os signature: prose-only stamp reports an unstamped fork, not absent lineage', () => {
  const r = checkLineage({
    federation: {
      metadata: { framework_version: '3.0' },
      upstream: [{ relationship: 'fork', last_sync: '', repository: 'x/y' }],
    },
    framework: FRAMEWORK,
    commitsBehindFramework: null,
  });
  const codes = r.findings.map((f) => f.code);
  assert.ok(codes.includes('unstamped-fork'), JSON.stringify(codes));
  assert.ok(!codes.includes('lineage-absent'));
  const f = r.findings.find((x) => x.code === 'unstamped-fork');
  assert.match(f.message, /upstream\[0\]/);
  assert.equal(r.status, 'WARN');
});

test('no genesis and no prose claim reports lineage as absent', () => {
  const r = checkLineage({
    federation: { metadata: {} },
    framework: FRAMEWORK,
    commitsBehindFramework: null,
  });
  const codes = r.findings.map((f) => f.code);
  assert.ok(codes.includes('lineage-absent'), JSON.stringify(codes));
  assert.ok(!codes.includes('unstamped-fork'));
});

test('a malformed genesis_commit is a BLOCKER', () => {
  const r = checkLineage({
    federation: { metadata: { genesis_commit: 'af8941a', last_sync_commit: null } },
    framework: FRAMEWORK,
    commitsBehindFramework: null,
  });
  assert.equal(r.status, 'BLOCKER');
  assert.ok(r.findings.some((f) => f.code === 'genesis-commit-malformed'));
});

test('a malformed last_sync_commit is a BLOCKER; null is not', () => {
  const bad = checkLineage({
    federation: {
      metadata: { genesis_commit: 'b'.repeat(40), last_sync_commit: '2026-04-28' },
    },
    framework: FRAMEWORK,
    commitsBehindFramework: null,
  });
  assert.equal(bad.status, 'BLOCKER');
  assert.ok(bad.findings.some((f) => f.code === 'last-sync-commit-malformed'));
});

test('staleness is reported in commits when the count is known', () => {
  const r = checkLineage({
    federation: {
      metadata: { genesis_commit: 'b'.repeat(40), last_sync_commit: 'c'.repeat(40) },
    },
    framework: FRAMEWORK,
    commitsBehindFramework: 292,
  });
  assert.equal(r.status, 'WARN');
  const f = r.findings.find((x) => x.code === 'sync-stale');
  assert.ok(f, JSON.stringify(r.findings));
  assert.match(f.message, /292 commit/);
});

test('a fully stamped, up-to-date instance is OK', () => {
  const r = checkLineage({
    federation: {
      metadata: { genesis_commit: 'b'.repeat(40), last_sync_commit: FRAMEWORK.headSha },
    },
    framework: FRAMEWORK,
    commitsBehindFramework: 0,
  });
  assert.equal(r.status, 'OK');
  assert.deepEqual(r.findings, []);
});

test('a missing federation.yaml is a BLOCKER — there is nowhere to record lineage', () => {
  const r = checkLineage({ federation: null, framework: FRAMEWORK, commitsBehindFramework: null });
  assert.equal(r.status, 'BLOCKER');
  assert.ok(r.findings.some((f) => f.code === 'federation-missing'));
});
