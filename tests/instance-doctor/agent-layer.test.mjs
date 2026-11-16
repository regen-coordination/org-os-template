// tests/instance-doctor/agent-layer.test.mjs
//
// DAO-OS L6 §14 (Q76), Task 15: the doctor's agent-layer check. The agent layer's files (memory/**, MEMORY.md,
// HEARTBEAT.md, docs/plans/**, docs/agent-plans/**) are workspace, kept in git at members; the check lists each with that
// level and counts, per file, what looks like personal data by kind, never the values. A file holding any is a WARN, and
// a BLOCKER with --before-widening (run before membership widens, Q67). With a private store present it counts the
// Council memory entries: a number, never a title. Every instance is a fresh temporary folder, every store a temp file;
// the addresses, names and numbers are placeholders (example.org, 555-01xx, …a1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makeInstance } from '../helpers/instance-fixtures.mjs';
import { readInstance, storeEnvFor } from '../../packages/instance-doctor/src/snapshot.mjs';
import { assessSnapshot } from '../../packages/instance-doctor/src/assess.mjs';
import { renderScorecard, toJson } from '../../packages/instance-doctor/src/report.mjs';
import { checkAgentLayer, personalMarkers } from '../../packages/instance-doctor/src/checks/agent-layer.mjs';

const frameworkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shim = path.join(frameworkDir, 'scripts', 'doctor.mjs');

const A1 = '0x00000000000000000000000000000000000000a1';
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person }
  - { id: steward-b, name: Steward B, kind: person }
  - { id: agent-a, name: Agent A, kind: agent }
`;
const PERSONAL = `# 2026-10-30

## Session — 10:00

Wrote to steward-a@example.org and ops@example.org about the payout to ${A1}.
`;
const PLAIN = '# 2026-10-29\n\n## Session — 09:00\n\nWorked on the handbook, 2026-10-29 12:00 to 14:30, 160 of 160 within the limit.\n';
const NOT_A_STORE = 'no-store-here';

const cleanup = [];
function withInstance(files, fn) {
  const dir = makeInstance({ files });
  cleanup.push(dir);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const read = (dir, opts = {}) =>
  readInstance(dir, { frameworkDir, runValidators: false, env: { ORG_OS_PRIVATE_DIR: path.join(dir, NOT_A_STORE) }, ...opts });
const agentCheck = (a) => a.checks.find((c) => c.id === 'agent-layer');

test('every agent-layer file is listed with level members; nothing else is', () => {
  withInstance(
    {
      'data/members.yaml': MEMBERS,
      'memory/2026-10-29.md': PLAIN,
      'memory/reports/sync-receipt-2026-08-26.md': '# Sync receipt\n',
      'MEMORY.md': '# Memory\n',
      'HEARTBEAT.md': '# Heartbeat\n',
      'docs/plans/QUEUE.md': '# Queue\n',
      'docs/agent-plans/a-plan.md': '# A plan\n',
      'docs/other.md': '# Not the agent layer\n',
      'README.md': '# Not the agent layer either\n',
    },
    (dir) => {
      const s = read(dir);
      assert.deepEqual(
        s.agentLayer.map((f) => f.path),
        [
          'HEARTBEAT.md',
          'MEMORY.md',
          'docs/agent-plans/a-plan.md',
          'docs/plans/QUEUE.md',
          'memory/2026-10-29.md',
          'memory/reports/sync-receipt-2026-08-26.md',
        ],
      );
      for (const f of s.agentLayer) assert.equal(f.level, 'members', f.path);
      const check = checkAgentLayer(s);
      assert.equal(check.status, 'OK', JSON.stringify(check.findings));
      assert.deepEqual(check.files.map((f) => [f.path, f.level]), s.agentLayer.map((f) => [f.path, 'members']));
      assert.deepEqual(check.files.find((f) => f.path === 'memory/2026-10-29.md').markers, { emails: 0, addresses: 0, phones: 0, names: 0 });
      // The scorecard says how many there are and at what level; the JSON lists each.
      const a = assessSnapshot(s);
      assert.match(renderScorecard(a), /6 agent-layer files, each kept in git at members/);
      assert.deepEqual(JSON.parse(toJson(a)).checks.find((c) => c.id === 'agent-layer').files.map((f) => f.path), s.agentLayer.map((f) => f.path));
    },
  );
});

test('a file git ignores is not listed: only what git holds or would take is at members', () => {
  withInstance(
    { '.gitignore': 'memory/private/\n', 'memory/private/notes.md': PERSONAL, 'memory/2026-10-29.md': PLAIN },
    (dir) => {
      assert.deepEqual(read(dir).agentLayer.map((f) => f.path), ['memory/2026-10-29.md']);
    },
  );
});

test('a memory file with two e-mails and an address is a WARN naming the counts and no value', () => {
  withInstance({ 'data/members.yaml': MEMBERS, 'memory/2026-10-30.md': PERSONAL, 'memory/2026-10-29.md': PLAIN }, (dir) => {
    const a = assessSnapshot(read(dir));
    const check = agentCheck(a);
    assert.equal(check.status, 'WARN');
    assert.equal(check.findings.length, 1);
    const [f] = check.findings;
    assert.equal(f.level, 'WARN');
    assert.equal(f.code, 'agent-layer-personal-data');
    assert.equal(
      f.message,
      'memory/2026-10-30.md holds what looks like personal data (2 e-mail addresses, 1 address): move what is Steward-only to the private store before membership widens.',
    );
    assert.deepEqual(check.files.find((x) => x.path === 'memory/2026-10-30.md').markers, { emails: 2, addresses: 1, phones: 0, names: 0 });
    // No value anywhere the doctor speaks: the scorecard, the JSON.
    for (const out of [renderScorecard(a), toJson(a)]) {
      for (const value of ['steward-a@example.org', 'ops@example.org', '@example.org', A1, A1.slice(2)]) {
        assert.ok(!out.includes(value), `the doctor printed ${value}`);
      }
    }
  });
});

test('with --before-widening it is a BLOCKER', () => {
  withInstance({ 'memory/2026-10-30.md': PERSONAL }, (dir) => {
    const check = agentCheck(assessSnapshot(read(dir, { beforeWidening: true })));
    assert.equal(check.status, 'BLOCKER');
    assert.equal(check.findings[0].level, 'BLOCKER');
    assert.match(check.findings[0].message, /^memory\/2026-10-30\.md holds what looks like personal data \(2 e-mail addresses, 1 address\)/);
    // The operator's surface: the flag is read, the run fails, and still no value is printed.
    const env = { ...process.env, ORG_OS_PRIVATE_DIR: path.join(dir, NOT_A_STORE) };
    const plain = spawnSync('node', [shim, 'assess', '--dir', dir, '--no-validators'], { cwd: frameworkDir, encoding: 'utf-8', env, timeout: 120_000 });
    assert.match(plain.stdout, /⚠ \[agent-layer-personal-data\]/);
    const r = spawnSync('node', [shim, 'assess', '--dir', dir, '--no-validators', '--before-widening'], { cwd: frameworkDir, encoding: 'utf-8', env, timeout: 120_000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /✗ \[agent-layer-personal-data\] memory\/2026-10-30\.md holds what looks like personal data/);
    assert.ok(!r.stdout.includes('@example.org') && !r.stdout.includes(A1));
  });
});

test('personalMarkers counts by kind: e-mails, 0x addresses, phone-like numbers, member names; dates and counts are not phones', () => {
  const text = [
    'Call +1 555-0142 or (555) 555-0199 or, locally, 555-0123; Steward A agreed, and Steward B and Steward A will sign.',
    `Pay ${A1} (eip155:42220:${A1}); a transaction 0x${'ab'.repeat(32)} is not an address.`,
    'Write to ops@example.org. On 2026-10-30 at 12:00, 5081 passed, 937/937, 160 of 160, v0.6.0.',
  ].join('\n');
  assert.deepEqual(personalMarkers(text, ['Steward A', 'Steward B', 'Agent A']), { emails: 1, addresses: 2, phones: 3, names: 3 });
  assert.deepEqual(personalMarkers(PLAIN, ['Steward A']), { emails: 0, addresses: 0, phones: 0, names: 0 });
  // A name is matched whole, never inside another word.
  assert.equal(personalMarkers('Steward Ab and the Steward Ayes', ['Steward A']).names, 0);
});

test("the store's Council memory is a count with no titles", () => {
  withInstance({ 'memory/2026-10-29.md': PLAIN }, (dir) => {
    const storeDir = mkdtempSync(path.join(tmpdir(), 'doctor-store-'));
    cleanup.push(storeDir);
    try {
      // A synthetic store with the records table as the Hub keeps it: two Council entries, one other private record.
      const db = new DatabaseSync(path.join(storeDir, 'house.db'));
      db.exec('CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, visibility TEXT NOT NULL, body TEXT NOT NULL, rev TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (collection, id)) STRICT');
      const put = db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)');
      put.run('council-memory', '2026-10-30-1', 'hat:steward', JSON.stringify({ date: '2026-10-30', title: 'Payroll talk with Steward B' }), '1', '2026-10-30T10:00:00Z', 'steward-a');
      put.run('council-memory', '2026-10-30-2', 'hat:steward', JSON.stringify({ date: '2026-10-30', title: 'Grant terms kept quiet' }), '1', '2026-10-30T11:00:00Z', 'steward-a');
      put.run('grants-private', 'g-1', 'hat:steward', JSON.stringify({ title: 'A grant' }), '1', '2026-10-30T11:00:00Z', 'steward-a');
      db.close();

      const s = read(dir, { env: { ORG_OS_PRIVATE_DIR: storeDir } });
      assert.equal(s.councilMemory, 2);
      const a = assessSnapshot(s);
      const check = agentCheck(a);
      assert.equal(check.councilMemory, 2);
      const card = renderScorecard(a);
      const json = toJson(a);
      assert.match(card, /Council memory: 2 entries in the private store/);
      assert.equal(JSON.parse(json).checks.find((c) => c.id === 'agent-layer').councilMemory, 2);
      for (const out of [card, json]) {
        for (const title of ['Payroll talk', 'Grant terms', 'A grant', '2026-10-30-1']) assert.ok(!out.includes(title), `the doctor printed ${title}`);
      }

      // A relative ORG_OS_PRIVATE_DIR is read from the instance's root, as the Hub reads it.
      assert.equal(read(dir, { env: { ORG_OS_PRIVATE_DIR: path.relative(dir, storeDir) } }).councilMemory, 2);
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
    }
  });
});

test('with no store the Council memory is not counted, and the doctor makes no store', () => {
  withInstance({ 'memory/2026-10-29.md': PLAIN }, (dir) => {
    const s = read(dir);
    assert.equal(s.councilMemory, null);
    assert.match(renderScorecard(assessSnapshot(s)), /Council memory: no private store here/);
    assert.equal(spawnSync('ls', [path.join(dir, NOT_A_STORE)]).status !== 0, true, 'the doctor made a store folder');
  });
});

test('the check is pure: a plain snapshot with no agent layer is OK and says so', () => {
  const check = checkAgentLayer({ agentLayer: [], councilMemory: null, beforeWidening: true });
  assert.equal(check.status, 'OK');
  assert.deepEqual(check.files, []);
  assert.equal(checkAgentLayer({}).status, 'OK');
});

test("hub mode counts the target instance's store, never the one the shell's ORG_OS_PRIVATE_DIR names (Task 15 review M-4)", () => {
  withInstance({ 'memory/2026-10-29.md': PLAIN }, (dir) => {
    const storeDir = mkdtempSync(path.join(tmpdir(), 'doctor-store-'));
    cleanup.push(storeDir);
    try {
      // The shell's store, for the instance the shell was set up for: two Council entries.
      const db = new DatabaseSync(path.join(storeDir, 'house.db'));
      db.exec('CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, visibility TEXT NOT NULL, body TEXT NOT NULL, rev TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (collection, id)) STRICT');
      const put = db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)');
      put.run('council-memory', '2026-10-30-1', 'hat:steward', '{}', '1', '2026-10-30T10:00:00Z', 'steward-a');
      put.run('council-memory', '2026-10-30-2', 'hat:steward', '{}', '1', '2026-10-30T11:00:00Z', 'steward-a');
      db.close();
      const env = { ORG_OS_PRIVATE_DIR: storeDir };
      // From another directory, --dir names another instance: the absolute setting is left out.
      assert.equal(storeEnvFor(env, dir, frameworkDir).ORG_OS_PRIVATE_DIR, undefined);
      // From inside the instance, or relative (read from the target's own root), it stands.
      assert.equal(storeEnvFor(env, dir, dir).ORG_OS_PRIVATE_DIR, storeDir);
      assert.equal(storeEnvFor(env, dir, path.join(dir, 'memory')).ORG_OS_PRIVATE_DIR, storeDir);
      assert.equal(storeEnvFor({ ORG_OS_PRIVATE_DIR: 'store' }, dir, frameworkDir).ORG_OS_PRIVATE_DIR, 'store');
      // The command, run from the framework's checkout against the temp instance: it counts no store there.
      const r = spawnSync('node', [shim, 'assess', '--dir', dir, '--no-validators', '--json'], {
        cwd: frameworkDir, encoding: 'utf-8', env: { ...process.env, ORG_OS_PRIVATE_DIR: storeDir }, timeout: 120_000,
      });
      const check = JSON.parse(r.stdout).checks.find((c) => c.id === 'agent-layer');
      assert.equal(check.councilMemory, null, r.stdout.slice(0, 400));
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
    }
  });
});
