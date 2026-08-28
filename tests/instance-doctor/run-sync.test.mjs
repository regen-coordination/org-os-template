// tests/instance-doctor/run-sync.test.mjs
//
// B9 — failure containment. The rule the masterplan sets is that no stage may
// leave the instance half-migrated: the first failure stops forward motion,
// every later stage is recorded as skipped, and the receipt names the stage
// that stopped it. These tests drive runSync() with an injected io bag so the
// ordering and containment can be asserted without a network.
//
// The end of the file drives the genuinely local stages against real temporary
// git repositories. The npm-dependent stages stay injected: proving those
// end-to-end is WS-H acceptance against real instances, not a unit test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSync } from '../../packages/instance-doctor/src/run-sync.mjs';
import { realIo } from '../../packages/instance-doctor/src/io.mjs';
import { STAGE_IDS } from '../../packages/instance-doctor/src/sync.mjs';
import { makeInstance, git } from '../helpers/instance-fixtures.mjs';

const OK = { ok: true, out: '' };

function fakeSnapshot(patch = {}) {
  return {
    dir: '/tmp/instance',
    name: 'ReFi Mediterranean',
    federation: { metadata: { framework_version: '3.0' }, upstream: [] },
    federationRaw: 'metadata:\n  framework_version: "3.0"\n  last_sync_commit: null\n',
    packageJson: { name: 'refi-med-os', version: '0.1.0' },
    packageJsonRaw: '{"name":"refi-med-os","version":"0.1.0"}',
    versionMd: null,
    git: { isRepo: true, remotes: { origin: 'https://github.com/ReFiDAO/refi-med-os.git' }, dirtyCount: 0 },
    machinery: {},
    framework: { dir: '/tmp/org-os', version: '0.5.0', headSha: 'f'.repeat(40) },
    ...patch,
  };
}

/** An io bag that records every call and succeeds at everything. */
function fakeIo(overrides = {}) {
  const calls = [];
  const written = {};
  return {
    calls,
    written,
    git: (dir, args) => {
      calls.push(['git', dir, args.join(' ')]);
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      return OK;
    },
    run: (cmd, args, dir) => {
      calls.push(['run', dir, `${cmd} ${args.join(' ')}`]);
      return OK;
    },
    readText: (p) => written[p] ?? null,
    writeText: (p, contents) => {
      calls.push(['write', p, '']);
      written[p] = contents;
    },
    exists: () => true,
    mkdirp: (p) => calls.push(['mkdirp', p, '']),
    copy: (from, to) => calls.push(['copy', from, to]),
    reassess: () => ({ status: 'OK', summary: { blockers: 0, warnings: 1, checks: 6 } }),
    today: () => '2026-08-28',
    timestamp: () => '20260828-120000Z',
    ...overrides,
  };
}

// --- dry run -------------------------------------------------------------

test('--dry-run writes nothing and reports every stage as planned', () => {
  const io = fakeIo();
  const r = runSync(fakeSnapshot(), { dryRun: true }, io);
  assert.equal(r.dryRun, true);
  assert.deepEqual(
    r.stages.map((s) => s.id),
    STAGE_IDS,
  );
  assert.ok(r.stages.every((s) => s.status === 'planned'));
  assert.equal(io.calls.length, 0, `dry run must not touch anything: ${JSON.stringify(io.calls)}`);
  assert.equal(r.receiptPath, null);
});

test('--dry-run still renders the receipt text so the operator can read the plan', () => {
  const r = runSync(fakeSnapshot(), { dryRun: true }, fakeIo());
  assert.match(r.receipt, /dry run — nothing was written/);
  assert.match(r.receipt, /re-stamp the version surfaces 3\.0 → 0\.5/);
});

// --- the happy path ------------------------------------------------------

test('a clean run executes every stage in order and writes a receipt', () => {
  const io = fakeIo();
  const r = runSync(fakeSnapshot(), {}, io);
  assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));
  assert.deepEqual(
    r.stages.map((s) => s.id),
    STAGE_IDS,
  );
  assert.ok(r.stages.every((s) => s.status === 'ok'));
  assert.equal(r.receiptPath, path.join('/tmp/instance', 'memory', 'reports', 'sync-receipt-2026-08-28.md'));
  assert.match(io.written[r.receiptPath], /# Sync receipt — 2026-08-28/);
});

test('the upstream remote is added when absent and rewritten when divergent', () => {
  const added = fakeIo();
  runSync(fakeSnapshot(), {}, added);
  assert.ok(
    added.calls.some(([, , cmd]) => cmd === 'remote add upstream https://github.com/regen-coordination/org-os-template.git'),
    JSON.stringify(added.calls),
  );

  const rewritten = fakeIo();
  runSync(
    fakeSnapshot({
      git: {
        isRepo: true,
        remotes: { upstream: 'https://github.com/regen-coordination/organizational-os-framework.git' },
        dirtyCount: 0,
      },
    }),
    {},
    rewritten,
  );
  assert.ok(
    rewritten.calls.some(([, , cmd]) => cmd.startsWith('remote set-url upstream https://github.com/regen-coordination/org-os-template.git')),
    JSON.stringify(rewritten.calls),
  );
});

test('a canonical upstream remote is left untouched', () => {
  const io = fakeIo();
  runSync(
    fakeSnapshot({
      git: {
        isRepo: true,
        remotes: { upstream: 'https://github.com/regen-coordination/org-os-template.git' },
        dirtyCount: 0,
      },
    }),
    {},
    io,
  );
  assert.ok(!io.calls.some(([, , cmd]) => cmd.includes('remote add') || cmd.includes('remote set-url')));
});

test('the migrate stage re-stamps the version surfaces onto the current line', () => {
  const io = fakeIo();
  const r = runSync(fakeSnapshot(), {}, io);
  const fedPath = path.join('/tmp/instance', 'federation.yaml');
  assert.match(io.written[fedPath], /framework_version: "0\.5"/);
  const migrate = r.stages.find((s) => s.id === 'migrate');
  assert.match(migrate.detail, /federation\.yaml/);
});

test('the receipt stage stamps last_sync_commit to the framework head', () => {
  const io = fakeIo();
  runSync(fakeSnapshot(), {}, io);
  const fed = io.written[path.join('/tmp/instance', 'federation.yaml')];
  assert.match(fed, new RegExp(`last_sync_commit: "${'f'.repeat(40)}"`));
  assert.match(fed, /last_updated: "2026-08-28"/);
});

// --- containment ---------------------------------------------------------

test('a failing stage stops forward motion and every later stage is skipped', () => {
  const io = fakeIo({
    git: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'fetch') return { ok: false, out: 'could not resolve host' };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      return OK;
    },
  });
  const r = runSync(fakeSnapshot(), {}, io);

  assert.equal(r.aborted, true);
  assert.equal(r.abortStage, 'fetch');

  const byId = Object.fromEntries(r.stages.map((s) => [s.id, s.status]));
  assert.equal(byId.snapshot, 'ok');
  assert.equal(byId['ensure-upstream'], 'ok');
  assert.equal(byId.fetch, 'failed');
  for (const later of ['inject-machinery', 'sync-upstream', 'migrate', 'generate-schemas', 're-assess']) {
    assert.equal(byId[later], 'skipped', `${later} must not run after an abort`);
  }
});

test('an aborted run still writes a receipt naming the stage that stopped it', () => {
  const io = fakeIo({
    git: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'fetch') return { ok: false, out: 'could not resolve host' };
      return OK;
    },
  });
  const r = runSync(fakeSnapshot(), {}, io);
  assert.ok(r.receiptPath);
  const receipt = io.written[r.receiptPath];
  assert.match(receipt, /ABORTED at `fetch`/);
  assert.match(receipt, /could not resolve host/);
  assert.match(receipt, /not left half-migrated/);
});

test('an aborted run never re-stamps anything', () => {
  const io = fakeIo({
    git: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'fetch') return { ok: false, out: 'nope' };
      return OK;
    },
  });
  runSync(fakeSnapshot(), {}, io);
  assert.equal(io.written[path.join('/tmp/instance', 'federation.yaml')], undefined);
});

test('a dirty working tree aborts at the snapshot stage — but the snapshot is taken first', () => {
  const io = fakeIo();
  const r = runSync(
    fakeSnapshot({
      git: { isRepo: true, remotes: {}, dirtyCount: 160 },
    }),
    {},
    io,
  );
  assert.equal(r.aborted, true);
  assert.equal(r.abortStage, 'snapshot');
  const stage = r.stages.find((s) => s.id === 'snapshot');
  assert.match(stage.detail, /refs\/snapshots\//, 'the snapshot ref must still be recorded');
  assert.match(stage.detail, /160/);
  assert.ok(io.calls.some(([, , cmd]) => cmd.startsWith('update-ref refs/snapshots/')));
});

test('a dry run over a dirty tree is allowed — it mutates nothing', () => {
  const r = runSync(fakeSnapshot({ git: { isRepo: true, remotes: {}, dirtyCount: 160 } }), { dryRun: true }, fakeIo());
  assert.equal(r.aborted, false);
  assert.ok(r.stages.every((s) => s.status === 'planned'));
});

test('a re-assessment that still finds blockers is reported, not hidden', () => {
  const io = fakeIo({
    reassess: () => ({ status: 'BLOCKER', summary: { blockers: 2, warnings: 3, checks: 6 } }),
  });
  const r = runSync(fakeSnapshot(), {}, io);
  assert.equal(r.aborted, true);
  assert.equal(r.abortStage, 're-assess');
  assert.match(io.written[r.receiptPath], /2 blocker/);
});

// --- the local stages, against real git repositories ---------------------

test('the local stages work against real repositories', () => {
  const instance = makeInstance({
    frameworkVersion: '3.0',
    remotes: { upstream: 'https://github.com/regen-coordination/organizational-os-framework.git' },
    files: { 'VERSION.md': '# VERSION.md\n\n**Framework Version:** `1.0.0`\n' },
  });
  // A local stand-in for the framework remote, so `fetch` is real but offline.
  const upstreamRepo = mkdtempSync(path.join(tmpdir(), 'doctor-upstream-'));
  const frameworkDir = mkdtempSync(path.join(tmpdir(), 'doctor-framework-'));

  try {
    writeFileSync(path.join(upstreamRepo, 'README.md'), '# framework\n');
    git(upstreamRepo, ['init', '--quiet', '--initial-branch=main']);
    git(upstreamRepo, ['add', '.']);
    git(upstreamRepo, ['commit', '--quiet', '-m', 'framework: initial']);

    mkdirSync(path.join(frameworkDir, 'scripts'), { recursive: true });
    writeFileSync(path.join(frameworkDir, 'scripts', 'sync-upstream.mjs'), '// the real thing\n');
    writeFileSync(path.join(frameworkDir, 'scripts', 'validate-identity.mjs'), '// the real thing\n');

    const snapshot = {
      dir: instance,
      name: 'ReFi Mediterranean',
      federation: { metadata: { framework_version: '3.0' } },
      federationRaw: readFileSync(path.join(instance, 'federation.yaml'), 'utf-8'),
      packageJson: JSON.parse(readFileSync(path.join(instance, 'package.json'), 'utf-8')),
      packageJsonRaw: readFileSync(path.join(instance, 'package.json'), 'utf-8'),
      versionMd: readFileSync(path.join(instance, 'VERSION.md'), 'utf-8'),
      git: { isRepo: true, remotes: { upstream: 'https://github.com/regen-coordination/organizational-os-framework.git' }, dirtyCount: 0 },
      machinery: {},
      framework: { dir: frameworkDir, version: '0.5.0', headSha: 'f'.repeat(40) },
    };

    // Real io for everything local; the two npm-driven stages are stubbed —
    // proving those against a real instance is WS-H acceptance, not a unit test.
    const io = {
      ...realIo,
      run: () => ({ ok: true, out: 'stubbed' }),
      reassess: () => ({ status: 'OK', summary: { blockers: 0, warnings: 0, checks: 6 } }),
      today: () => '2026-08-28',
    };
    // Point the rewritten upstream at the local stand-in so fetch is offline.
    const result = runSync(snapshot, { upstreamUrl: upstreamRepo }, io);

    assert.equal(result.aborted, false, JSON.stringify(result.stages, null, 2));

    // The remote was really rewritten.
    assert.equal(git(instance, ['remote', 'get-url', 'upstream']), upstreamRepo);
    // The machinery was really copied in.
    assert.ok(existsSync(path.join(instance, 'scripts', 'sync-upstream.mjs')));
    assert.ok(existsSync(path.join(instance, 'scripts', 'validate-identity.mjs')));
    // The version surfaces were really re-stamped.
    assert.match(readFileSync(path.join(instance, 'federation.yaml'), 'utf-8'), /framework_version: "0\.5"/);
    assert.match(readFileSync(path.join(instance, 'VERSION.md'), 'utf-8'), /\*\*Framework Version:\*\* `0\.5\.0`/);
    // The snapshot ref really exists and the receipt was really written.
    assert.match(git(instance, ['for-each-ref', 'refs/snapshots/', '--format=%(refname)']), /refs\/snapshots\//);
    assert.ok(existsSync(result.receiptPath));
    assert.match(readFileSync(result.receiptPath, 'utf-8'), /completed/);
  } finally {
    for (const d of [instance, upstreamRepo, frameworkDir]) rmSync(d, { recursive: true, force: true });
  }
});
