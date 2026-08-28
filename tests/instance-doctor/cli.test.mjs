// tests/instance-doctor/cli.test.mjs
//
// The operator-facing surface: `npm run doctor` from inside an instance, and
// `npm run doctor -- --dir ../refi-med-os` from the framework against a
// sibling. The hub mode is the one that breaks the bootstrap deadlock —
// instances cannot self-update using machinery they do not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeInstance, refiMedShape, breadCoopShape, healthyShape } from '../helpers/instance-fixtures.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shim = path.join(rootDir, 'scripts', 'doctor.mjs');

const run = (args, cwd = rootDir) =>
  spawnSync('node', [shim, ...args], { cwd, encoding: 'utf-8', timeout: 120_000 });

function withInstance(shape, fn) {
  const dir = makeInstance(shape);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('assess is the default verb and prints a scorecard', () => {
  withInstance({}, (dir) => {
    const r = run(['--dir', dir, '--no-validators']);
    assert.match(r.stdout, /org-os instance doctor/);
    assert.match(r.stdout, /Identity coherence/);
    assert.match(r.stdout, /Machinery integrity/);
  });
});

test('a healthy-enough instance exits 0; a blocked one exits 1', () => {
  withInstance(healthyShape(), (dir) => {
    const r = run(['assess', '--dir', dir, '--no-validators']);
    assert.equal(r.status, 0, r.stdout);
  });
  withInstance(breadCoopShape(), (dir) => {
    const r = run(['assess', '--dir', dir, '--no-validators']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /git-remote-absent/);
  });
});

test('--json emits parseable output and nothing else on stdout', () => {
  withInstance(refiMedShape(), (dir) => {
    const r = run(['assess', '--dir', dir, '--json', '--no-validators']);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.tool, '@org-os/instance-doctor');
    assert.equal(parsed.dir, dir);
    const codes = parsed.checks.flatMap((c) => c.findings.map((f) => f.code));
    assert.ok(codes.includes('upstream-remote-wrong-url'), JSON.stringify(codes));
  });
});

test('--strict turns warnings into a non-zero exit', () => {
  withInstance(healthyShape(), (dir) => {
    assert.equal(run(['assess', '--dir', dir, '--no-validators']).status, 0);
    // --no-validators alone produces "validator-did-not-run" warnings.
    assert.equal(run(['assess', '--dir', dir, '--no-validators', '--strict']).status, 1);
  });
});

test('sync --dry-run prints the plan, mutates nothing, and exits 0', () => {
  withInstance(refiMedShape(), (dir) => {
    const before = run(['assess', '--dir', dir, '--json', '--no-validators']).stdout;
    const r = run(['sync', '--dir', dir, '--dry-run', '--no-validators']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /dry run/i);
    assert.match(r.stdout, /rewrite `upstream`/);
    assert.match(r.stdout, /re-stamp the version surfaces 3\.0 → 0\.5/);
    const after = run(['assess', '--dir', dir, '--json', '--no-validators']).stdout;
    assert.equal(before, after, 'a dry run must not change the instance');
  });
});

test('an unknown verb fails loudly rather than assessing something by accident', () => {
  const r = run(['destroy', '--dir', rootDir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr + r.stdout, /unknown command/i);
});

test('--help documents both verbs and the hub mode', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /assess/);
  assert.match(r.stdout, /sync/);
  assert.match(r.stdout, /--dir/);
});

test('a directory that is not an org-os instance is reported, not crashed on', () => {
  withInstance({ initGit: false }, (dir) => {
    rmSync(path.join(dir, 'federation.yaml'));
    rmSync(path.join(dir, 'package.json'));
    const r = run(['assess', '--dir', dir, '--no-validators']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /federation-missing|package-json-missing/);
  });
});

test('run from inside the framework with no arguments, it assesses the framework', () => {
  const r = run(['--no-validators'], rootDir);
  assert.match(r.stdout, /this IS the framework checkout/);
});
