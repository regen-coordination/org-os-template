// tests/instance-doctor/snapshot.test.mjs
//
// The snapshot layer is the ONLY part of instance-doctor that touches the
// filesystem, so this is where the on-disk fixtures live. Each one is a real
// instance's failure signature; the assertions are that the doctor reads the
// signature off disk correctly, not that the check logic works (that is unit
// tested against plain objects elsewhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstance } from '../../packages/instance-doctor/src/snapshot.mjs';
import { assessSnapshot } from '../../packages/instance-doctor/src/assess.mjs';
import {
  makeInstance,
  refiMedShape,
  breadCoopShape,
  refiDaoShape,
  regenShape,
  refiBcnShape,
} from '../helpers/instance-fixtures.mjs';

const frameworkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (dir) => readInstance(dir, { frameworkDir, runValidators: false });

function withInstance(shape, fn) {
  const dir = makeInstance(shape);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reads the identity, version and git surfaces off disk', () => {
  withInstance({}, (dir) => {
    const s = read(dir);
    assert.equal(s.dir, dir);
    assert.equal(s.name, 'Acme Co');
    assert.equal(s.packageJson.name, 'acme-os');
    assert.equal(s.federation.metadata.framework_version, '0.5');
    assert.equal(s.daoJson.name, 'Acme Co');
    assert.match(s.identityMd, /Acme Co/);
    assert.equal(s.git.isRepo, true);
    assert.equal(s.git.dirtyCount, 0);
    assert.ok(s.git.lastCommitISO);
    assert.equal(s.isFramework, false);
  });
});

test('counts an uncommitted working tree', () => {
  withInstance({}, (dir) => {
    writeFileSync(path.join(dir, 'NOTES.md'), 'scratch\n');
    assert.equal(read(dir).git.dirtyCount, 1);
  });
});

test('reads the framework it is being run from', () => {
  withInstance({}, (dir) => {
    const s = read(dir);
    assert.match(s.framework.version, /^\d+\.\d+\.\d+$/);
    assert.match(s.framework.headSha, /^[0-9a-f]{40}$/);
  });
});

test('the framework checkout identifies itself as the framework', () => {
  const s = readInstance(frameworkDir, { frameworkDir, runValidators: false });
  assert.equal(s.isFramework, true);
  assert.equal(assessSnapshot(s).checks.find((c) => c.id === 'identity').status, 'OK');
});

// --- the six real signatures --------------------------------------------

test('refi-med-os shape: unstamped fork, no machinery, upstream at the divergent legacy repo', () => {
  withInstance(refiMedShape(), (dir) => {
    const a = assessSnapshot(read(dir));
    const codes = a.checks.flatMap((c) => c.findings.map((f) => f.code));
    assert.ok(codes.includes('unstamped-fork'), JSON.stringify(codes));
    assert.ok(codes.includes('upstream-remote-wrong-url'), JSON.stringify(codes));
    assert.ok(codes.includes('framework-version-stale'), JSON.stringify(codes));
    assert.equal(a.status, 'BLOCKER');
  });
});

test('bread-coop-os shape: no git remote at all, and dao.json publishes the framework identity', () => {
  withInstance(breadCoopShape(), (dir) => {
    const a = assessSnapshot(read(dir));
    const codes = a.checks.flatMap((c) => c.findings.map((f) => f.code));
    assert.ok(codes.includes('git-remote-absent'), JSON.stringify(codes));
    assert.ok(codes.includes('template-leakage'), JSON.stringify(codes));
    assert.ok(codes.includes('never-synced'), JSON.stringify(codes));
    assert.ok(!codes.includes('lineage-absent'), 'bread-coop-os IS genesis-stamped');
  });
});

test('refi-dao-os shape: the no-op stub and the 1.0.0-vs-3.0 contradiction are both read off disk', () => {
  withInstance(refiDaoShape(), (dir) => {
    const a = assessSnapshot(read(dir));
    const codes = a.checks.flatMap((c) => c.findings.map((f) => f.code));
    assert.ok(codes.includes('script-is-noop-stub'), JSON.stringify(codes));
    assert.ok(codes.includes('version-surfaces-contradict'), JSON.stringify(codes));
    assert.ok(codes.includes('upstream-remote-missing'), JSON.stringify(codes));
  });
});

test('regen-coordination-os shape: duplicate package.json key survives to the snapshot raw text', () => {
  withInstance(regenShape(), (dir) => {
    const pkgPath = path.join(dir, 'package.json');
    writeFileSync(
      pkgPath,
      '{\n  "name": "organizational-os-template",\n  "version": "3.0.0",\n  "scripts": {\n    "initialize": "node scripts/initialize.mjs",\n    "initialize": "node scripts/initialize.mjs"\n  }\n}\n',
    );
    const a = assessSnapshot(read(dir));
    const codes = a.checks.flatMap((c) => c.findings.map((f) => f.code));
    assert.ok(codes.includes('package-json-duplicate-key'), JSON.stringify(codes));
    assert.ok(codes.includes('template-leakage'), JSON.stringify(codes));
  });
});

test('refi-bcn-os shape: a script whose target file was never installed', () => {
  withInstance(refiBcnShape(), (dir) => {
    const a = assessSnapshot(read(dir));
    const codes = a.checks.flatMap((c) => c.findings.map((f) => f.code));
    assert.ok(codes.includes('script-target-missing'), JSON.stringify(codes));
  });
});

test('a directory that is not a git repository is read without throwing', () => {
  withInstance({ initGit: false }, (dir) => {
    const s = read(dir);
    assert.equal(s.git.isRepo, false);
    const a = assessSnapshot(s);
    assert.ok(a.checks.flatMap((c) => c.findings.map((f) => f.code)).includes('not-a-git-repo'));
  });
});

test('machinery fingerprints compare the instance copy against the framework copy', () => {
  withInstance(
    {
      scripts: { 'sync:upstream': 'node scripts/sync-upstream.mjs' },
      files: { 'scripts/sync-upstream.mjs': 'import fs from "node:fs";\n// a stale local copy\n' },
    },
    (dir) => {
      const s = read(dir);
      const print = s.machinery['scripts/sync-upstream.mjs'];
      assert.ok(print.instanceMd5, 'instance copy should be fingerprinted');
      assert.ok(print.frameworkMd5, 'framework copy should be fingerprinted');
      assert.notEqual(print.instanceMd5, print.frameworkMd5);
      const codes = assessSnapshot(s).checks.flatMap((c) => c.findings.map((f) => f.code));
      assert.ok(codes.includes('machinery-skew'), JSON.stringify(codes));
    },
  );
});

test('running the validators is opt-in and reports their real results', () => {
  withInstance({}, (dir) => {
    const s = readInstance(dir, { frameworkDir, runValidators: true });
    assert.equal(s.validators.structure.ran, true);
    assert.equal(s.validators.schemas.ran, true);
    assert.equal(typeof s.validators.schemas.exitCode, 'number');
  });
});

test('sync receipts and memory recency are discovered', () => {
  withInstance(
    {
      files: {
        'memory/2026-08-20.md': '# 2026-08-20\n',
        'memory/sync-2026-08-21.md': '# Sync receipt\n',
        'memory/reports/sync-receipt-2026-08-22.md': '# Sync receipt\n',
      },
    },
    (dir) => {
      const s = read(dir);
      assert.equal(s.memoryLatestISO.slice(0, 10), '2026-08-20');
      assert.equal(s.syncReceipts.length, 2);
    },
  );
});
