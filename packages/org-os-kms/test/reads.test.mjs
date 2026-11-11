// packages/org-os-kms/test/reads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { readReads, recordRead, READS_PATH } from '../src/reads.mjs';
import { OPS } from '../src/ops.mjs';

const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'kms-reads-')); mkdirSync(join(d, 'data'), { recursive: true }); return d; };

test('absent file reads as {}', () => {
  assert.deepEqual(readReads(tmp()), {});
});

test('a success sets ok_at and attempt_at', () => {
  const d = tmp();
  recordRead(d, 'riverbend', { at: '2026-10-29T10:00:00.000Z' });
  assert.deepEqual(readReads(d), { riverbend: { ok_at: '2026-10-29T10:00:00.000Z', attempt_at: '2026-10-29T10:00:00.000Z', error: null } });
});

test('a failure keeps ok_at and records the error', () => {
  const d = tmp();
  recordRead(d, 'riverbend', { at: '2026-10-28T10:00:00.000Z' });
  recordRead(d, 'riverbend', { at: '2026-10-29T10:00:00.000Z', error: 'timeout' });
  assert.deepEqual(readReads(d).riverbend, { ok_at: '2026-10-28T10:00:00.000Z', attempt_at: '2026-10-29T10:00:00.000Z', error: 'timeout' });
  recordRead(d, 'hillside', { at: '2026-10-29T11:00:00.000Z', error: 'down' });
  assert.equal(readReads(d).hillside.ok_at, null);
  assert.ok('riverbend' in readReads(d), 'other connectors survive');
});

test('malformed file throws naming kms-reads.json', () => {
  const d = tmp();
  writeFileSync(join(d, READS_PATH), '{ nope');
  assert.throws(() => readReads(d), /kms-reads\.json/);
});

const good = { name: 'good', protocol: 't', capabilities: { ingest: true }, describe: () => ({ title: 'G', type: 'dataset', steward: 's', return_path: 'g' }),
  pull: async () => ({ records: [{ n: 'X' }], cursor: 1 }), map: (r) => [{ schema: 'resource', object: { title: r.n, type: 'resource' } }] };
const broken = { ...good, name: 'broken', pull: async () => { throw new Error('boom'); } };
function instance() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-reads-pull-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: {} }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', connectors: [{ name: 'good', config: {}, cursor: null }, { name: 'broken', config: {}, cursor: null }] }));
  return dir;
}

test('ingest.pull records each connector outcome; --dry records nothing', async () => {
  const dry = instance();
  await OPS['ingest.pull'].run({ dir: dry, flags: { dry: true }, deps: { registry: { good, broken } } });
  assert.equal(existsSync(join(dry, READS_PATH)), false);

  const dir = instance();
  const now = '2026-10-29T12:00:00.000Z';
  await OPS['ingest.pull'].run({ dir, now, deps: { registry: { good, broken } } });
  const r = readReads(dir);
  assert.deepEqual(r.good, { ok_at: now, attempt_at: now, error: null });
  assert.equal(r.broken.ok_at, null);
  assert.equal(r.broken.attempt_at, now);
  assert.match(r.broken.error, /boom/);
});

test('ingest.pull: a malformed kms-reads.json warns, leaves the file, and changes no outcome', async () => {
  const dir = instance();
  writeFileSync(join(dir, READS_PATH), '{ nope');
  const res = await OPS['ingest.pull'].run({ dir, now: '2026-10-29T12:00:00.000Z', deps: { registry: { good, broken } } });
  assert.equal(res.ok, true);
  assert.equal(res.report.connectors[0].status, 'ok');
  assert.equal(res.report.connectors[1].status, 'failed');
  assert.equal(res.report.failed, 1);
  assert.match(res.report.reads_warning, /kms-reads\.json/);
  assert.equal(readFileSync(join(dir, READS_PATH), 'utf8'), '{ nope');
  assert.equal(JSON.parse(readFileSync(join(dir, 'data', 'kms-cursors.json'), 'utf8')).cursors.good, 1);
});

test('ingest.pull: an unwritable reads path warns and later connectors still run', async () => {
  const dir = instance();
  mkdirSync(join(dir, READS_PATH)); // a directory where the file should be
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good, broken } } });
  assert.equal(res.ok, true);
  assert.equal(res.report.connectors.length, 2);
  assert.ok(res.report.reads_warning);
});
