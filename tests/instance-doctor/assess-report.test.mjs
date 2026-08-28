// tests/instance-doctor/assess-report.test.mjs
//
// B7 — the scorecard. assessSnapshot() runs the six checks over one snapshot
// and is pure; renderScorecard() and toJson() shape the two output modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSnapshot } from '../../packages/instance-doctor/src/assess.mjs';
import { renderScorecard, toJson, exitCodeFor } from '../../packages/instance-doctor/src/report.mjs';

const NOW = Date.parse('2026-08-28T12:00:00Z');

/** A snapshot with nothing wrong with it. */
function healthySnapshot(patch = {}) {
  return {
    dir: '/tmp/acme-os',
    name: 'Acme Co',
    now: NOW,
    isFramework: false,
    identityMd: '- **Name:** Acme Co\n- **Type:** Cooperative\n',
    federation: {
      identity: { name: 'Acme Co', type: 'Cooperative' },
      metadata: {
        framework_version: '0.5',
        genesis_commit: 'a'.repeat(40),
        last_sync_commit: 'b'.repeat(40),
      },
      upstream: [{ url: 'https://github.com/regen-coordination/org-os-template.git' }],
    },
    packageJson: { name: 'acme-os', version: '0.1.0', scripts: {} },
    packageJsonRaw: '{"name":"acme-os","version":"0.1.0","scripts":{}}',
    daoJson: { name: 'Acme Co' },
    versionMd: null,
    changelog: null,
    scriptFiles: {},
    machinery: {},
    dirs: { migrations: true },
    git: {
      isRepo: true,
      remotes: {
        origin: 'https://github.com/acme/acme-os.git',
        upstream: 'https://github.com/regen-coordination/org-os-template.git',
      },
      lastCommitISO: new Date(NOW - 2 * 86400_000).toISOString(),
      dirtyCount: 0,
    },
    commitsBehindFramework: 0,
    memoryLatestISO: new Date(NOW - 2 * 86400_000).toISOString(),
    syncReceipts: ['memory/reports/sync-receipt-2026-08-26.md'],
    validators: {
      structure: { ran: true, exitCode: 0, failed: 0, warnings: 0 },
      schemas: { ran: true, exitCode: 0, failed: 0, warnings: 0 },
    },
    framework: { version: '0.5.0', headSha: 'b'.repeat(40) },
    ...patch,
  };
}

test('assessSnapshot runs all six checks in a stable order', () => {
  const a = assessSnapshot(healthySnapshot());
  assert.deepEqual(
    a.checks.map((c) => c.id),
    ['identity', 'lineage', 'versions', 'machinery', 'structure', 'freshness'],
  );
});

test('a healthy instance scores OK across the board with no blockers', () => {
  const a = assessSnapshot(healthySnapshot());
  assert.equal(a.status, 'OK', JSON.stringify(a.checks.filter((c) => c.status !== 'OK'), null, 2));
  assert.equal(a.summary.blockers, 0);
  assert.equal(a.summary.warnings, 0);
  assert.equal(exitCodeFor(a), 0);
});

test('warnings alone do not fail the assessment', () => {
  const a = assessSnapshot(healthySnapshot({ syncReceipts: [] }));
  assert.equal(a.status, 'WARN');
  assert.ok(a.summary.warnings > 0);
  assert.equal(exitCodeFor(a), 0);
});

test('--strict escalates warnings to a non-zero exit', () => {
  const a = assessSnapshot(healthySnapshot({ syncReceipts: [] }));
  assert.equal(exitCodeFor(a, { strict: true }), 1);
});

test('a single blocker fails the assessment', () => {
  // The refi-bcn-os case in isolation: a script entry whose target file is gone.
  const a = assessSnapshot(
    healthySnapshot({
      packageJson: { name: 'acme-os', version: '0.1.0', scripts: { 'sync:upstream': 'node scripts/sync-upstream.mjs' } },
      packageJsonRaw: '{"name":"acme-os","scripts":{"sync:upstream":"node scripts/sync-upstream.mjs"}}',
      scriptFiles: { 'scripts/sync-upstream.mjs': { exists: false } },
    }),
  );
  assert.equal(a.status, 'BLOCKER');
  assert.equal(a.summary.blockers, 1);
  assert.equal(exitCodeFor(a), 1);
});

test('a template-named package.json turns its own version into a framework claim', () => {
  // regen-coordination-os is named organizational-os-template AND versioned
  // 3.0.0, which happens to agree with its federation 3.0 — so it contradicts
  // nothing. Change either and the contradiction is real, not cosmetic.
  const agreeing = assessSnapshot(
    healthySnapshot({
      packageJson: { name: 'organizational-os-template', version: '0.5.0', scripts: {} },
    }),
  );
  const versionCodes = agreeing.checks.find((c) => c.id === 'versions').findings.map((f) => f.code);
  assert.deepEqual(versionCodes, []);

  const contradicting = assessSnapshot(
    healthySnapshot({
      packageJson: { name: 'organizational-os-template', version: '0.1.0', scripts: {} },
    }),
  );
  assert.ok(
    contradicting.checks
      .find((c) => c.id === 'versions')
      .findings.some((f) => f.code === 'version-surfaces-contradict'),
  );
});

test('leakage and disagreement are reported as the separate facts they are', () => {
  // bread-coop-os: dao.json publishes "org-os" while IDENTITY.md and
  // federation.yaml agree on the real name. Two things are true — the surfaces
  // disagree, AND the odd one out is the framework's own identity. Collapsing
  // them would hide which of the two an operator has to fix.
  const a = assessSnapshot(healthySnapshot({ daoJson: { name: 'org-os' } }));
  const codes = a.checks.find((c) => c.id === 'identity').findings.map((f) => f.code);
  assert.deepEqual(codes.sort(), ['identity-name-disagreement', 'template-leakage']);
  assert.equal(a.summary.blockers, 2);
});

test('the summary counts findings across checks, not checks', () => {
  const a = assessSnapshot(
    healthySnapshot({
      daoJson: { name: 'org-os' },
      git: { isRepo: true, remotes: {}, lastCommitISO: new Date(NOW).toISOString(), dirtyCount: 0 },
    }),
  );
  // identity: disagreement + leakage · machinery: no git remote at all
  assert.equal(a.summary.blockers, 3);
});

test('the scorecard names every check and marks the failing ones', () => {
  const a = assessSnapshot(healthySnapshot({ daoJson: { name: 'org-os' } }));
  const text = renderScorecard(a);
  for (const title of ['Identity coherence', 'Lineage', 'Version surfaces', 'Machinery integrity', 'Structure + schemas', 'Freshness']) {
    assert.ok(text.includes(title), `scorecard is missing "${title}"`);
  }
  assert.match(text, /BLOCKER/);
  assert.match(text, /Acme Co/);
});

test('the scorecard prints each finding with its remediation hint', () => {
  const a = assessSnapshot(healthySnapshot({ daoJson: { name: 'org-os' } }));
  const text = renderScorecard(a);
  assert.match(text, /template-leakage/);
  assert.match(text, /generate:schemas/);
});

test('toJson round-trips and carries the machine-readable finding codes', () => {
  const a = assessSnapshot(healthySnapshot({ daoJson: { name: 'org-os' } }));
  const parsed = JSON.parse(toJson(a));
  assert.equal(parsed.status, 'BLOCKER');
  assert.equal(parsed.dir, '/tmp/acme-os');
  const identity = parsed.checks.find((c) => c.id === 'identity');
  assert.ok(identity.findings.some((f) => f.code === 'template-leakage'));
});

test('toJson output contains no undefined values', () => {
  const json = toJson(assessSnapshot(healthySnapshot()));
  assert.ok(!json.includes('undefined'), json);
});
