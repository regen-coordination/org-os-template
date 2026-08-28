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
import { runSync, porcelainPath, foreignDirtyEntries } from '../../packages/instance-doctor/src/run-sync.mjs';
import { realIo } from '../../packages/instance-doctor/src/io.mjs';
import { STAGE_IDS } from '../../packages/instance-doctor/src/sync.mjs';
import { makeInstance, git } from '../helpers/instance-fixtures.mjs';

const OK = { ok: true, out: '' };

const CANONICAL_FED_RAW =
  'metadata:\n  framework_version: "3.0"\n  last_sync_commit: null\n' +
  'upstream:\n  - url: "https://github.com/regen-coordination/org-os-template.git"\n';

/** Only the commits made by the inject-machinery stage. */
const machineryCommits = (io) =>
  io.calls.filter(([k, , c]) => k === 'git' && c.startsWith('commit') && c.includes('install framework sync machinery'));


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

/**
 * An io bag that records every call and succeeds at everything.
 *
 * `gitRespond` customises git RESULTS without replacing the recorder — a test
 * that overrode `git` wholesale used to lose the call log it was asserting on.
 * Return undefined to fall through to the defaults.
 */
function fakeIo(overrides = {}) {
  const calls = [];
  const written = {};
  const { gitRespond, ...rest } = overrides;
  return {
    calls,
    written,
    git: (dir, args) => {
      calls.push(['git', dir, args.join(' ')]);
      const custom = gitRespond?.(dir, args);
      if (custom !== undefined) return custom;
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      // The realistic default: machinery was just copied in, so there IS a
      // staged diff waiting to be committed.
      if (args[0] === 'diff') return { ok: true, out: 'scripts/sync-upstream.mjs' };
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
    ...rest,
  };
}

// --- porcelain parsing ---------------------------------------------------

test('porcelainPath survives the trimmed first line', () => {
  // io.git trims its output, which eats the leading space of porcelain's
  // two-character status column — but only on the FIRST line. A fixed slice(3)
  // therefore cut one character off exactly one path per run, and the doctor
  // read its own file as an operator's uncommitted work. Found in WS-H H1.
  assert.equal(porcelainPath(' M scripts/validate-structure.mjs'), 'scripts/validate-structure.mjs');
  assert.equal(porcelainPath('M scripts/validate-structure.mjs'), 'scripts/validate-structure.mjs');
  assert.equal(porcelainPath('?? scripts/doctor.mjs'), 'scripts/doctor.mjs');
  assert.equal(porcelainPath('MM data/members.yaml'), 'data/members.yaml');
  assert.equal(porcelainPath('A  data/new.yaml'), 'data/new.yaml');
});

test('porcelainPath takes the destination of a rename', () => {
  assert.equal(porcelainPath('R  docs/old.md -> docs/new.md'), 'docs/new.md');
});

test('porcelainPath unquotes paths git had to quote', () => {
  assert.equal(porcelainPath('?? "docs/a b.md"'), 'docs/a b.md');
});

test('the real refi-med-os shape, trimmed as io.git delivers it, is all doctor-owned', () => {
  const trimmed = [
    'M scripts/validate-structure.mjs',
    '?? memory/reports/sync-receipt-2026-08-28.md',
    '?? scripts/doctor.mjs',
    '?? scripts/sync-upstream.mjs',
    '?? scripts/validate-identity.mjs',
  ].join('\n');
  assert.deepEqual(foreignDirtyEntries(trimmed), []);
});

test("an operator's file is still foreign in the same listing", () => {
  const mixed = ['M scripts/validate-structure.mjs', ' M data/members.yaml'].join('\n');
  assert.deepEqual(foreignDirtyEntries(mixed), [' M data/members.yaml']);
});

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

test('injected machinery is committed, or sync-upstream would refuse the tree it just dirtied', () => {
  // Found by the first real acceptance run (refi-med-os, WS-H H1): stage 4
  // writes files into the instance, and stage 5 refuses to run on a dirty
  // working tree. Without a commit here the doctor's own repair step
  // guarantees its own failure, every time.
  const io = fakeIo();
  const r = runSync(fakeSnapshot(), {}, io);
  assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));

  const gitCalls = io.calls.filter(([kind]) => kind === 'git').map(([, , cmd]) => cmd);
  const addIdx = gitCalls.findIndex((c) => c.startsWith('add --'));
  const commitIdx = gitCalls.findIndex((c) => c.startsWith('commit -m'));
  assert.ok(addIdx >= 0, `no stage of the machinery: ${JSON.stringify(gitCalls)}`);
  assert.ok(commitIdx > addIdx, 'the machinery must be committed after staging');

  const stage = r.stages.find((s) => s.id === 'inject-machinery');
  assert.match(stage.detail, /committed/);
});

test('the machinery commit stages explicit paths, never -A', () => {
  const io = fakeIo();
  runSync(fakeSnapshot(), {}, io);
  const adds = io.calls.filter(([kind, , cmd]) => kind === 'git' && cmd.startsWith('add'));
  assert.ok(adds.length > 0);
  for (const [, , cmd] of adds) {
    assert.ok(!/\s-A\b/.test(cmd), `sweeping add would capture unrelated operator work: ${cmd}`);
    assert.match(cmd, /^add -- /);
  }
});

test('no machinery commit is made when the copies are already byte-identical', () => {
  const io = fakeIo({
    gitRespond: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      // An empty staged diff means the copies were byte-identical.
      if (args[0] === 'diff') return { ok: true, out: '' };
      return OK;
    },
  });
  const r = runSync(fakeSnapshot({ federationRaw: CANONICAL_FED_RAW }), {}, io);
  assert.equal(r.aborted, false);
  assert.deepEqual(machineryCommits(io), []);
  assert.match(r.stages.find((s) => s.id === 'inject-machinery').detail, /already current/);
});

test('a failed machinery commit aborts rather than proceeding into a dirty sync', () => {
  const io = fakeIo({
    gitRespond: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      if (args[0] === 'diff') return { ok: true, out: 'scripts/sync-upstream.mjs' };
      if (args[0] === 'commit') return { ok: false, out: 'nothing to commit, working tree clean' };
      return OK;
    },
  });
  // Canonical declaration, so ensure-upstream commits nothing and the failure
  // lands squarely on the machinery commit.
  const r = runSync(fakeSnapshot({ federationRaw: CANONICAL_FED_RAW }), {}, io);
  assert.equal(r.aborted, true);
  assert.equal(r.abortStage, 'inject-machinery');
});

test('the declared-upstream repair is committed, not left dirtying the tree', () => {
  // Third instance of the same class found in WS-H H1: every repair the doctor
  // performs before sync-upstream must be committed, because sync-upstream
  // refuses on a dirty tree. Machinery, then federation.yaml.
  const io = fakeIo();
  const r = runSync(fakeSnapshot(), {}, io);
  assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));
  const adds = io.calls.filter(([k, , c]) => k === 'git' && c.startsWith('add -- '));
  assert.ok(
    adds.some(([, , c]) => c.includes('federation.yaml')),
    `federation.yaml was never staged: ${JSON.stringify(adds)}`,
  );
  assert.match(r.stages.find((s) => s.id === 'ensure-upstream').detail, /committed/);
});

// --- containment ---------------------------------------------------------

test('a failing stage stops forward motion and every later stage is skipped', () => {
  const io = fakeIo({
    gitRespond: (dir, args) => {
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
    gitRespond: (dir, args) => {
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

test('an aborted run never re-stamps the version surfaces', () => {
  // B9 forbids leaving the instance half-MIGRATED. Repairing the declared
  // upstream before the abort is not a migration: it is a standalone, idempotent
  // correction that is true whether or not the sync later succeeds. What must
  // not happen is the cross-scheme version re-stamp, which only makes sense once
  // the instance has actually pulled the framework forward.
  const io = fakeIo({
    gitRespond: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'fetch') return { ok: false, out: 'nope' };
      return OK;
    },
  });
  const r = runSync(fakeSnapshot(), {}, io);
  assert.equal(r.abortStage, 'fetch');

  const fed = io.written[path.join('/tmp/instance', 'federation.yaml')];
  if (fed !== undefined) {
    assert.match(fed, /framework_version: "3\.0"/, 'the version surface must be untouched');
    assert.ok(!fed.includes('framework_version: "0.5"'), 'no re-stamp before a successful sync');
    assert.ok(!/last_sync_commit: "[0-9a-f]{40}"/.test(fed), 'no lineage stamp before a successful sync');
  }
  assert.equal(io.written[path.join('/tmp/instance', 'VERSION.md')], undefined);
});

test("an operator's uncommitted work aborts at the snapshot stage — but the snapshot is taken first", () => {
  const io = fakeIo({
    gitRespond: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      if (args[0] === 'status') return { ok: true, out: ' M data/members.yaml\n?? drafts/notes.md' };
      return OK;
    },
  });
  const r = runSync(fakeSnapshot(), {}, io);
  assert.equal(r.aborted, true);
  assert.equal(r.abortStage, 'snapshot');
  const stage = r.stages.find((s) => s.id === 'snapshot');
  assert.match(stage.detail, /refs\/snapshots\//, 'the snapshot ref must still be recorded');
  assert.match(stage.detail, /data\/members\.yaml/, 'the operator should be told WHICH files block it');
  assert.ok(io.calls.some(([, , cmd]) => cmd.startsWith('update-ref refs/snapshots/')));
});

test('untracked directories are expanded, so a collapsed memory/reports/ is not read as foreign', () => {
  // git collapses a wholly-untracked directory to one entry ("?? memory/reports/")
  // unless -uall is passed. That entry matches no file path, so the doctor's own
  // receipt read as an operator's work and blocked the retry it had just caused.
  const seen = [];
  const io = fakeIo({
    gitRespond: (dir, args) => {
      if (args[0] === 'status') {
        seen.push(args.join(' '));
        return { ok: true, out: '?? memory/reports/sync-receipt-2026-08-28.md' };
      }
      return undefined;
    },
  });
  const r = runSync(fakeSnapshot(), {}, io);
  assert.ok(seen.length > 0);
  for (const cmd of seen) assert.match(cmd, /-uall/, `status must expand untracked dirs: ${cmd}`);
  assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));
});

test("the doctor's own debris from an aborted run does not block the retry", () => {
  // Found by WS-H H1: the first run aborted, leaving injected machinery and its
  // receipt behind. Counting those as dirty meant the doctor could never retry
  // after its own failure.
  const io = fakeIo({
    gitRespond: (dir, args) => {
      if (args[0] === 'stash') return { ok: true, out: 'a'.repeat(40) };
      if (args[0] === 'rev-list') return { ok: true, out: 'e'.repeat(40) };
      if (args[0] === 'diff') return { ok: true, out: 'scripts/sync-upstream.mjs' };
      if (args[0] === 'status') {
        return {
          ok: true,
          out: [
            ' M scripts/validate-structure.mjs',
            '?? scripts/doctor.mjs',
            '?? scripts/sync-upstream.mjs',
            '?? scripts/validate-identity.mjs',
            '?? memory/reports/sync-receipt-2026-08-28.md',
          ].join('\n'),
        };
      }
      return OK;
    },
  });
  const r = runSync(fakeSnapshot({ federationRaw: CANONICAL_FED_RAW }), {}, io);
  assert.equal(r.aborted, false, JSON.stringify(r.stages, null, 2));

  // The leftover receipt is absorbed into the machinery commit, so
  // sync-upstream's own dirty check does not trip on it either.
  const add = io.calls.find(
    ([kind, , cmd]) => kind === 'git' && cmd.startsWith('add -- ') && cmd.includes('sync-receipt'),
  );
  assert.ok(add, 'the leftover receipt was never staged');
  assert.match(add[2], /memory\/reports\/sync-receipt-2026-08-28\.md/);
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
    // Repo-local identity — see the note in tests/helpers/instance-fixtures.mjs.
    git(upstreamRepo, ['config', 'user.email', 'fixture@org-os.test']);
    git(upstreamRepo, ['config', 'user.name', 'org-os fixture']);
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
