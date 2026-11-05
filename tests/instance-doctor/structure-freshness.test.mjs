// tests/instance-doctor/structure-freshness.test.mjs
//
// B5 — structure + schemas, and B6 — freshness. Both are pure mappings over
// data the snapshot layer gathered: B5 over validator subprocess results, B6
// over git/memory timestamps. `now` is injected so neither test depends on the
// wall clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStructure } from '../../packages/instance-doctor/src/checks/structure.mjs';
import { checkFreshness } from '../../packages/instance-doctor/src/checks/freshness.mjs';

const NOW = Date.parse('2026-08-28T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400_000).toISOString();

// --- B5 ------------------------------------------------------------------

test('both validators green is OK', () => {
  const r = checkStructure({
    validators: {
      structure: { ran: true, exitCode: 0, failed: 0, warnings: 0 },
      schemas: { ran: true, exitCode: 0, failed: 0, warnings: 0 },
    },
  });
  assert.equal(r.id, 'structure');
  assert.equal(r.status, 'OK');
});

test('a failing structure validator is a BLOCKER carrying its own output', () => {
  const r = checkStructure({
    validators: {
      structure: {
        ran: true,
        exitCode: 1,
        failed: 3,
        warnings: 1,
        tail: '✗ Instance has 3 structural issue(s) to fix',
      },
      schemas: { ran: true, exitCode: 0, failed: 0, warnings: 0 },
    },
  });
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'structure-invalid');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /3/);
  assert.match(f.hint, /structural issue/);
});

test('validator warnings are WARNs, not blockers', () => {
  const r = checkStructure({
    validators: {
      structure: { ran: true, exitCode: 0, failed: 0, warnings: 2 },
      schemas: { ran: true, exitCode: 0, failed: 0, warnings: 6 },
    },
  });
  assert.equal(r.status, 'WARN');
  assert.equal(r.findings.filter((x) => x.code.endsWith('-warnings')).length, 2);
});

test('a validator that could not run is reported rather than assumed green', () => {
  const r = checkStructure({
    validators: {
      structure: { ran: false, reason: 'spawn ENOENT' },
      schemas: { ran: true, exitCode: 0, failed: 0, warnings: 0 },
    },
  });
  assert.equal(r.status, 'WARN');
  const f = r.findings.find((x) => x.code === 'validator-did-not-run');
  assert.ok(f);
  assert.match(f.message, /structure/);
});

const GREEN = { ran: true, exitCode: 0, failed: 0, warnings: 0 };

test('a failing data validator is a BLOCKER that carries the repair from its output', () => {
  const r = checkStructure({
    validators: {
      structure: GREEN,
      schemas: GREEN,
      data: {
        ran: true,
        exitCode: 1,
        failed: 1,
        warnings: 222,
        tail: '✗ data/governance.yaml: holds 11 YAML documents, separated by `---`, where a registry is one. Merge them into one document under `governance:` by hand: only the people who wrote them know where each part belongs. Nothing in the file is read until then. | Results: 37 passed, 1 failed, 222 warnings',
      },
    },
  });
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'data-invalid');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /data validation failed with 1 failing check/);
  assert.match(f.hint, /Merge them into one document under `governance:`/);
});

test('data warnings alone are a WARN', () => {
  const r = checkStructure({ validators: { structure: GREEN, schemas: GREEN, data: { ...GREEN, warnings: 47 } } });
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.findings.map((x) => x.code), ['data-warnings']);
});

test('a data validator that could not run is reported; a snapshot without one says nothing', () => {
  const r = checkStructure({ validators: { structure: GREEN, schemas: GREEN, data: { ran: false, reason: 'scripts/validate-data.mjs not present in the framework checkout' } } });
  assert.equal(r.status, 'WARN');
  assert.match(r.findings[0].message, /the data validator could not be run/);
  assert.equal(checkStructure({ validators: { structure: GREEN, schemas: GREEN } }).status, 'OK');
});

test('a data validator that exits 2 (cannot run) is a WARN, never a BLOCKER', () => {
  const r = checkStructure({
    validators: { structure: GREEN, schemas: GREEN, data: { ran: true, exitCode: 2, failed: null, warnings: 0, tail: '✗ validate:data cannot load the admin schemas (x) | run: npm ci --prefix packages/admin' } },
  });
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.findings.map((x) => x.code), ['validator-did-not-run']);
  assert.match(r.findings[0].hint, /npm ci --prefix packages\/admin/);
});


// 0.6 F2: validate:governance is the fourth validator (rules well-formed; history agrees).
const WITH = (governance) => ({ validators: { structure: GREEN, schemas: GREEN, data: GREEN, governance } });

test('a governance validator that passes is OK', () => {
  assert.equal(checkStructure(WITH(GREEN)).status, 'OK');
});

test('rules that cannot work are a BLOCKER, and the hint is the last error line', () => {
  const r = checkStructure(WITH({
    ran: true, exitCode: 1, passed: 1, failed: 1, warnings: 0,
    tail: '✗ data/governance.yaml rules.records.propose: rule "records": propose names the role "steward", and roles defines none by that name | Results: 1 passed, 1 failed, 0 warnings',
  }));
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'governance-invalid');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /governance validation failed with 1 failing check/);
  assert.match(f.hint, /propose names the role "steward"/);
});

test('history that disagrees with the rules (warnings, as the doctor runs it without --strict) is a WARN', () => {
  const r = checkStructure(WITH({ ...GREEN, warnings: 3 }));
  assert.equal(r.status, 'WARN');
  assert.deepEqual(r.findings.map((x) => x.code), ['governance-warnings']);
  assert.match(r.findings[0].hint, /validate-governance\.mjs/);
});

test('a governance validator that exits 2 (cannot run) is a WARN, never a BLOCKER; one that was not found is reported', () => {
  const cannot = checkStructure(WITH({ ran: true, exitCode: 2, failed: null, warnings: 0, tail: '✗ validate:governance cannot load the admin schemas (x) | run: npm ci --prefix packages/admin' }));
  assert.equal(cannot.status, 'WARN');
  assert.deepEqual(cannot.findings.map((x) => x.code), ['validator-did-not-run']);
  const missing = checkStructure(WITH({ ran: false, reason: 'scripts/validate-governance.mjs not present in the framework checkout' }));
  assert.match(missing.findings[0].message, /the governance validator could not be run/);
});

test('a snapshot taken before the governance validator existed says nothing about it', () => {
  assert.equal(checkStructure({ validators: { structure: GREEN, schemas: GREEN, data: GREEN } }).status, 'OK');
});


// --- B6 ------------------------------------------------------------------

const FRESH = {
  now: NOW,
  git: { lastCommitISO: daysAgo(3), dirtyCount: 0 },
  memoryLatestISO: daysAgo(5),
  syncReceipts: ['memory/reports/sync-receipt-2026-08-20.md'],
};

test('a recently worked instance is OK', () => {
  const r = checkFreshness(FRESH);
  assert.equal(r.id, 'freshness');
  assert.equal(r.status, 'OK', JSON.stringify(r.findings));
});

test('dao-os signature: dormant since March is reported in days', () => {
  const r = checkFreshness({ ...FRESH, git: { lastCommitISO: daysAgo(178), dirtyCount: 0 } });
  const f = r.findings.find((x) => x.code === 'repo-dormant');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /178 days/);
  assert.equal(f.level, 'WARN');
});

test('refi-dao-os signature: a large uncommitted working tree is reported — sync refuses on it', () => {
  const r = checkFreshness({ ...FRESH, git: { lastCommitISO: daysAgo(3), dirtyCount: 160 } });
  const f = r.findings.find((x) => x.code === 'working-tree-dirty');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /160/);
  assert.match(f.hint, /sync/i);
});

test('stale memory is reported', () => {
  const r = checkFreshness({ ...FRESH, memoryLatestISO: daysAgo(120) });
  assert.ok(r.findings.some((x) => x.code === 'memory-stale'));
});

test('an absent memory log is reported distinctly from a stale one', () => {
  const r = checkFreshness({ ...FRESH, memoryLatestISO: null });
  const codes = r.findings.map((x) => x.code);
  assert.ok(codes.includes('memory-absent'), JSON.stringify(codes));
  assert.ok(!codes.includes('memory-stale'));
});

test('zero sync receipts is the fleet-wide signature and is reported', () => {
  const r = checkFreshness({ ...FRESH, syncReceipts: [] });
  const f = r.findings.find((x) => x.code === 'no-sync-receipts');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.equal(f.level, 'WARN');
});

test('freshness never blocks — it is diagnostic, not a gate', () => {
  const r = checkFreshness({
    now: NOW,
    git: { lastCommitISO: daysAgo(900), dirtyCount: 5000 },
    memoryLatestISO: null,
    syncReceipts: [],
  });
  assert.equal(r.status, 'WARN');
  assert.ok(r.findings.length >= 4);
});
