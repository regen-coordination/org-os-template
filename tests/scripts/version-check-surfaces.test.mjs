// tests/scripts/version-check-surfaces.test.mjs
//
// WS-C C5 — `version:check` used to read three sources (package.json,
// federation.yaml, CHANGELOG.md), so the two surfaces that were actually WRONG
// went unnoticed for months: root VERSION.md said 1.0.0 and MASTERPLAN.md said
// 2.0.0 while the framework was on 0.5.0. A check that cannot see a surface
// cannot catch it drifting, which is the whole failure mode here.
//
// These tests drive the script against a synthetic framework tree so they
// assert the checking logic, not the repo's current state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A throwaway framework tree with the script copied in, so `frameworkRoot`
 * (resolved from the script's own location) points at the fixture.
 */
function makeFramework({
  pkg = '0.5.0',
  fed = '0.5',
  changelog = '0.5.0',
  versionMd = '0.5.0',
  masterplan = '0.5.0',
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'version-check-'));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  cpSync(path.join(rootDir, 'scripts', 'update-version.mjs'), path.join(dir, 'scripts', 'update-version.mjs'));

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: pkg }, null, 2));
  writeFileSync(
    path.join(dir, 'federation.yaml'),
    `version: "${fed}"\nmetadata:\n  framework_version: "${fed}"\n`,
  );
  writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Changelog\n\n## [${changelog}] — 2026-06-17\n`);
  if (versionMd !== null) {
    writeFileSync(
      path.join(dir, 'VERSION.md'),
      `# VERSION.md\n\n## Current Version\n\n**Framework Version:** \`${versionMd}\`  \n**Released:** 2026-08-28\n`,
    );
  }
  if (masterplan !== null) {
    writeFileSync(
      path.join(dir, 'MASTERPLAN.md'),
      `# MASTERPLAN.md — org-os\n\n**Version:** ${masterplan}\n**Updated:** 2026-08-28\n`,
    );
  }
  return dir;
}

const check = (dir) =>
  spawnSync('node', [path.join(dir, 'scripts', 'update-version.mjs'), '--check'], {
    encoding: 'utf-8',
  });

function withFramework(opts, fn) {
  const dir = makeFramework(opts);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('all five surfaces agreeing passes', () => {
  withFramework({}, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /All version sources agree/);
  });
});

test('the report names all five surfaces, not three', () => {
  withFramework({}, (dir) => {
    const out = check(dir).stdout;
    for (const surface of ['package.json', 'federation.yaml', 'CHANGELOG.md', 'VERSION.md', 'MASTERPLAN.md']) {
      assert.ok(out.includes(surface), `check output does not mention ${surface}`);
    }
  });
});

test('a stale VERSION.md is caught — the 1.0.0 case that hid for months', () => {
  withFramework({ versionMd: '1.0.0' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr + r.stdout, /VERSION\.md/);
    assert.match(r.stderr + r.stdout, /1\.0/);
  });
});

test('a stale MASTERPLAN.md version header is caught — the 2.0.0 case', () => {
  withFramework({ masterplan: '2.0.0' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr + r.stdout, /MASTERPLAN\.md/);
  });
});

test('the original three surfaces still fail as before', () => {
  withFramework({ fed: '0.4' }, (dir) => {
    assert.equal(check(dir).status, 1);
  });
  withFramework({ changelog: '0.4.0' }, (dir) => {
    assert.equal(check(dir).status, 1);
  });
});

test('surfaces compare on major.minor, so patch-level differences are fine', () => {
  withFramework({ pkg: '0.5.3', changelog: '0.5.3', versionMd: '0.5.0', masterplan: '0.5.1' }, (dir) => {
    const r = check(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

test('an absent VERSION.md or MASTERPLAN.md is reported as absent, not silently passed', () => {
  withFramework({ versionMd: null, masterplan: null }, (dir) => {
    const r = check(dir);
    // Absence is not drift — an instance need not carry either file — but the
    // check must say so rather than printing a value it never read.
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /VERSION\.md[^\n]*(absent|not present|—)/i);
  });
});

test('a VERSION.md without a Framework Version line is treated as absent', () => {
  const dir = makeFramework({});
  try {
    writeFileSync(path.join(dir, 'VERSION.md'), '# VERSION.md\n\nNo version line here.\n');
    assert.equal(check(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
