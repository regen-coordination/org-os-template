// tests/clone-framework-health.test.mjs
//
// The bootstrap path's acceptance test: a freshly cloned instance must be
// HEALTHY, judged by the framework's own instance-doctor.
//
// Before v0.5 it was not. `npm run clone:framework` — the single recommended
// setup path — produced an instance with 7 blockers seconds after creation,
// the worst being that it never wrote `.well-known/dao.json`, so a new
// organization published the FRAMEWORK's identity (`name: "org-os"`) as its own.
// bread-coop-os has been doing exactly that since the day it was bootstrapped;
// it was not an operator slip but the deterministic output of this script.
//
// This is the test that stops that shipping again. `git-remote-absent` is the
// one blocker allowed to survive: a fresh local clone genuinely has no remote
// yet, and inventing one would be worse than reporting it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cloneScript = path.join(rootDir, 'scripts', 'clone-framework.mjs');
const doctorScript = path.join(rootDir, 'scripts', 'doctor.mjs');
const configPath = path.join(rootDir, 'tests', 'fixtures', 'instance-config.yaml');

/** Clone into a temp dir and hand the path to fn. */
function withClone(fn) {
  const dst = mkdtempSync(path.join(tmpdir(), 'clone-health-'));
  rmSync(dst, { recursive: true, force: true }); // clone-framework wants to create it
  try {
    // No --no-git: the real bootstrap runs `git init` (stage 8), and the only
    // blocker allowed to survive — git-remote-absent — only appears once the
    // directory IS a repository. Skipping git would test a path no operator takes.
    const r = spawnSync('node', [cloneScript, '--target', dst, '--config', configPath], {
      encoding: 'utf-8',
      timeout: 120_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    });
    assert.equal(r.status, 0, `clone failed: ${r.stderr}${r.stdout}`);
    return fn(dst);
  } finally {
    rmSync(dst, { recursive: true, force: true });
  }
}

function assess(dir) {
  const r = spawnSync('node', [doctorScript, 'assess', '--dir', dir, '--json', '--no-validators'], {
    encoding: 'utf-8',
    timeout: 120_000,
  });
  return JSON.parse(r.stdout);
}

const ALLOWED_BLOCKERS = new Set(['git-remote-absent']);

test('a freshly cloned instance has no blockers beyond the expected missing remote', () => {
  withClone((dir) => {
    const report = assess(dir);
    const blockers = report.checks
      .flatMap((c) => c.findings)
      .filter((f) => f.level === 'BLOCKER' && !ALLOWED_BLOCKERS.has(f.code));
    assert.deepEqual(
      blockers.map((b) => `${b.code}: ${b.message}`),
      [],
      'a brand-new instance must not be born broken',
    );
  });
});

test('the clone publishes its OWN identity, not the framework\'s', () => {
  withClone((dir) => {
    const daoPath = path.join(dir, '.well-known', 'dao.json');
    assert.ok(existsSync(daoPath), '.well-known/dao.json must be written for the instance');
    const dao = JSON.parse(readFileSync(daoPath, 'utf-8'));
    assert.equal(dao.name, 'test-instance-os');
    assert.ok(dao['@context'], 'dao.json must keep its EIP-4824 @context');
    const raw = readFileSync(daoPath, 'utf-8');
    assert.ok(!raw.includes('organizational-os.github.io'), 'framework URIs must not leak into the instance');
    assert.ok(!/"name":\s*"org-os"/.test(raw), 'the framework name must not leak into the instance');
  });
});

test('the clone carries no framework registry content — identity stripped by construction', () => {
  // The 2026-08-29 WS-I recipe run found the recommended path shipping the
  // maintainer's member entry, 13 framework projects, the framework's SOUL,
  // its tool endpoints, and its federation frontier cache — the Harbor Bakery
  // B4/B5 leak. Stage 4b resets those; this pins it.
  withClone((dir) => {
    const members = yaml.load(readFileSync(path.join(dir, 'data', 'members.yaml'), 'utf-8'));
    assert.equal(members.members.length, 1, 'members.yaml must carry only the bootstrap operator');
    assert.equal(members.members[0].name, 'Test Operator');

    const projects = yaml.load(readFileSync(path.join(dir, 'data', 'projects.yaml'), 'utf-8'));
    assert.deepEqual(projects.projects, [], 'projects.yaml must start empty');

    const ideas = yaml.load(readFileSync(path.join(dir, 'data', 'ideas.yaml'), 'utf-8'));
    assert.deepEqual(ideas.ideas, [], 'ideas.yaml must start empty');

    assert.ok(
      !existsSync(path.join(dir, 'data', 'federation', 'frontier')),
      'the framework\'s federation frontier cache must not ship in an instance',
    );

    const soul = readFileSync(path.join(dir, 'SOUL.md'), 'utf-8');
    assert.ok(!soul.includes('org-os itself'), 'SOUL.md must be the instance\'s, not the framework\'s');
    assert.ok(soul.includes('test-instance-os'), 'SOUL.md must name the instance');

    const tools = readFileSync(path.join(dir, 'TOOLS.md'), 'utf-8');
    assert.ok(!/gnosis|llamarpc/i.test(tools), 'the framework\'s API endpoints must not ship in an instance');

    // The catch-all: the maintainer's handle appearing anywhere in the
    // instance's data/ or identity files is a leak by definition.
    for (const rel of ['data/members.yaml', 'data/projects.yaml', 'data/ideas.yaml',
                       'data/ecosystems.yaml', 'data/relationships.yaml', 'USER.md', 'SOUL.md']) {
      const p = path.join(dir, rel);
      if (!existsSync(p)) continue;
      assert.ok(
        !/luizfernandosg|Luiz Fernando/.test(readFileSync(p, 'utf-8')),
        `maintainer identity leaked into ${rel}`,
      );
    }
  });
});

test('every framework-version surface in the clone reads the current framework version', () => {
  withClone((dir) => {
    const fwVersion = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf-8')).version;
    const majorMinor = fwVersion.match(/^(\d+)\.(\d+)/)[0];

    const fed = yaml.load(readFileSync(path.join(dir, 'federation.yaml'), 'utf-8'));
    assert.equal(fed.metadata.framework_version, majorMinor, 'federation.yaml must not hardcode a version');
    assert.equal(fed.version, majorMinor);
    assert.match(fed.spec, new RegExp(`/${majorMinor}$`));

    const versionMd = readFileSync(path.join(dir, 'VERSION.md'), 'utf-8');
    const claimed = versionMd.match(/\*\*Framework Version:\*\*\s*`?([\d.]+)`?/)?.[1];
    if (claimed) assert.match(claimed, new RegExp(`^${majorMinor.replace('.', '\\.')}`));
  });
});

test('the clone declares the canonical upstream, not one of the legacy names', () => {
  withClone((dir) => {
    const fed = yaml.load(readFileSync(path.join(dir, 'federation.yaml'), 'utf-8'));
    const url = fed.upstream[0].url;
    // The fixture config supplies a legacy URL on purpose; the clone must not
    // silently enshrine a name that is not the framework.
    assert.match(url, /regen-coordination\/org-os-template/, `upstream declared as ${url}`);
  });
});

test('the clone carries no npm script pointing at a file it does not have', () => {
  withClone((dir) => {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    const dead = [];
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      if (typeof cmd !== 'string' || /--prefix\b/.test(cmd)) continue;
      const m = /(?:^|\s)((?:\.\/)?[\w.@/-]+\.(?:mjs|js|cjs))(?:\s|$)/.exec(cmd);
      if (!m) continue;
      const file = m[1].replace(/^\.\//, '');
      if (file.includes('*')) continue;
      if (!existsSync(path.join(dir, file))) dead.push(`${name} -> ${file}`);
    }
    assert.deepEqual(dead, [], 'a clone must not ship scripts that cannot run');
  });
});

test("the clone does not inherit the framework's CHANGELOG as its own", () => {
  withClone((dir) => {
    const p = path.join(dir, 'CHANGELOG.md');
    if (!existsSync(p)) return; // stripping it entirely is a valid answer
    const raw = readFileSync(p, 'utf-8');
    assert.ok(
      !raw.includes('All notable changes to **org-os** (the framework)'),
      "the instance must not present the framework's changelog as its own history",
    );
  });
});
