// tests/scripts/validate-identity-target.test.mjs
//
// validate-identity.mjs resolved its root from its own location, so it could
// only ever validate the checkout it shipped in. validate-structure.mjs has
// always accepted a target directory as argv[2]; this brings the two into line
// so instance-doctor (B5) can run the FRAMEWORK's validator against a sibling
// instance — the instances themselves carry missing or skewed copies, which is
// the whole reason the doctor exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(rootDir, 'scripts', 'validate-identity.mjs');

function makeInstance({ name = 'Acme Co', type = 'Cooperative' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'validate-identity-'));
  writeFileSync(
    path.join(dir, 'IDENTITY.md'),
    `# IDENTITY.md\n\n- **Name:** ${name}\n- **Type:** ${type}\n`,
  );
  writeFileSync(
    path.join(dir, 'federation.yaml'),
    `identity:\n  name: "${name}"\n  type: "${type}"\nmetadata:\n  framework_version: "0.5"\n  genesis_commit: "${'a'.repeat(40)}"\n  last_sync_commit: null\n`,
  );
  mkdirSync(path.join(dir, '.well-known'));
  writeFileSync(
    path.join(dir, '.well-known', 'dao.json'),
    JSON.stringify({ '@context': 'https://daostar.org/schemas', name }),
  );
  // The validator warns once per missing published schema, and --strict
  // escalates warnings; a complete fixture keeps the strict case about flag
  // parsing rather than about an incomplete .well-known/.
  for (const f of ['members', 'projects', 'finances', 'activities', 'proposals', 'contracts']) {
    writeFileSync(path.join(dir, '.well-known', `${f}.json`), JSON.stringify({ '@context': 'https://daostar.org/schemas' }));
  }
  return dir;
}

const run = (args) => spawnSync('node', [script, ...args], { encoding: 'utf-8', cwd: rootDir });

test('validates a target directory passed as an argument', () => {
  const dir = makeInstance();
  try {
    const r = run([dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Acme Co/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports the target instance failure, not the framework it runs from', () => {
  const dir = makeInstance();
  try {
    // Break agreement only in the target.
    writeFileSync(
      path.join(dir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** Someone Else\n- **Type:** Cooperative\n',
    );
    const r = run([dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /Name agreement/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--strict is still a flag, not a target directory', () => {
  const dir = makeInstance();
  try {
    const r = run([dir, '--strict']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no argument it still validates its own checkout', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /org-os/);
});
