// packages/org-os-kms/test/ingest-pull-op.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { OPS } from '../src/ops.mjs';
import { LIFECYCLE_BINDINGS } from '../src/bind.mjs';
import { NOT_IMPLEMENTED } from '../src/framework.mjs';
import { CONNECTORS, getConnector } from '../src/connectors/index.mjs';

// kms.yaml is written as TEXT (with a comment) so tests can prove when it is / is not rewritten.
function instance(connectors, { extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-pull-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: {} }));
  writeFileSync(join(dir, 'kms.yaml'),
    `# keep me\n${yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', ...extra, connectors })}`);
  return dir;
}
const kmsText = (dir) => readFileSync(join(dir, 'kms.yaml'), 'utf8');
const good = { name: 'good', protocol: 't', capabilities: { ingest: true }, describe: () => ({ title: 'G', type: 'dataset', steward: 's', return_path: 'g' }),
  pull: async (_c, { cursor }) => ({ records: [{ n: 'X' }], cursor: (cursor || 0) + 1 }), map: (r) => [{ schema: 'resource', object: { title: r.n, type: 'resource' } }] };
const stub = { ...good, name: 'stub', pull: async () => { throw new NOT_IMPLEMENTED('stub'); } };
const broken = { ...good, name: 'broken', pull: async () => { throw new Error('boom'); } };

test('registry: atproto + static-json; getConnector throws on unknown', () => {
  assert.deepEqual(Object.keys(CONNECTORS).sort(), ['atproto', 'static-json']);
  assert.equal(getConnector('atproto').name, 'atproto');
  assert.throws(() => getConnector('nope'), /unknown connector: nope \(available: atproto, static-json\)/);
});

test('ingest.pull registered as a write op and NOT bound to close (CLI verb only)', () => {
  assert.ok(OPS['ingest.pull']?.write === true);
  assert.ok(!LIFECYCLE_BINDINGS.close.includes('ingest.pull'));
  assert.ok(!LIFECYCLE_BINDINGS.initialize.includes('ingest.pull'));
});

test('runs each connector, writes cursors back, continues past NOT_IMPLEMENTED', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }, { name: 'stub', config: {}, cursor: null }]);
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good, stub } } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.connectors[0].stored, 1); assert.equal(res.report.connectors[1].status, 'not-implemented');
  assert.equal(res.report.failed, 0);
  const cfg = yaml.load(kmsText(dir));
  assert.equal(cfg.connectors[0].cursor, 1); assert.equal(cfg.connectors[1].cursor, null);
});

test('a failing connector does not stop the others; fail-soft: ok:true, failed counted', async () => {
  const dir = instance([{ name: 'broken', config: {}, cursor: null }, { name: 'good', config: {}, cursor: null }]);
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good, broken } } });
  assert.equal(res.ok, true);
  assert.equal(res.report.failed, 1);
  assert.equal(res.report.connectors[0].status, 'failed'); assert.match(res.report.connectors[0].error, /boom/);
  assert.equal(res.report.connectors[1].stored, 1);
  const cfg = yaml.load(kmsText(dir));
  assert.equal(cfg.connectors[0].cursor, null); assert.equal(cfg.connectors[1].cursor, 1);
});

test('an undeclared-in-registry connector name fails soft', async () => {
  const dir = instance([{ name: 'ghost', config: {}, cursor: null }]);
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good } } });
  assert.equal(res.ok, true); assert.equal(res.report.failed, 1);
  assert.match(res.report.connectors[0].error, /unknown connector: ghost/);
});

test('--dry: no store, no cursor write-back, kms.yaml byte-identical', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }]);
  const before = kmsText(dir);
  const res = await OPS['ingest.pull'].run({ dir, flags: { dry: true }, deps: { registry: { good } } });
  assert.equal(res.report.connectors[0].dry, true); assert.equal(res.report.connectors[0].stored, 0);
  assert.equal(res.report.connectors[0].candidates, 1);
  assert.equal(yaml.load(kmsText(dir)).connectors[0].cursor, null);
  assert.equal(kmsText(dir), before);
  assert.equal(yaml.load(readFileSync(join(dir, 'data', 'kb', 'resource.yaml'), 'utf8')).entries.x, undefined);
});

test('--connector limits the run', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }, { name: 'stub', config: {}, cursor: null }]);
  const res = await OPS['ingest.pull'].run({ dir, flags: { connector: 'good' }, deps: { registry: { good, stub } } });
  assert.equal(res.report.connectors.length, 1);
  assert.equal(res.report.connectors[0].name, 'good');
});

test('--connector: cursor write-back targets the right entry in the full declared list', async () => {
  const dir = instance([{ name: 'stub', config: {}, cursor: null }, { name: 'good', config: {}, cursor: 5 }]);
  const res = await OPS['ingest.pull'].run({ dir, flags: { connector: 'good' }, deps: { registry: { good, stub } } });
  assert.equal(res.report.connectors.length, 1);
  const cfg = yaml.load(kmsText(dir));
  assert.equal(cfg.connectors[0].cursor, null); assert.equal(cfg.connectors[1].cursor, 6);
});

test('--connector naming an undeclared connector warns instead of silently succeeding', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }]);
  const before = kmsText(dir);
  const res = await OPS['ingest.pull'].run({ dir, flags: { connector: 'nope' }, deps: { registry: { good } } });
  assert.deepEqual(res, { ok: true, report: { connectors: [], failed: 0, warning: 'no declared connector named nope' } });
  assert.equal(kmsText(dir), before);
});

test('invalid candidates are reported under invalid and not stored', async () => {
  const bad = { ...good, name: 'bad', map: () => [{ schema: 'resource', object: { type: 'resource' } }] }; // missing title
  const dir = instance([{ name: 'bad', config: {}, cursor: null }]);
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { bad } } });
  const c = res.report.connectors[0];
  assert.equal(res.ok, true); assert.equal(c.status, 'ok'); assert.equal(c.stored, 0);
  assert.equal(c.invalid.length, 1); assert.ok(c.invalid[0].errors.length > 0);
  assert.deepEqual(c.collided, []);
});

test('slug collisions are reported under collided and not overwritten', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }]);
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { x: { title: 'X', type: 'resource', notes: 'mine' } } }));
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good } } });
  const c = res.report.connectors[0];
  assert.equal(c.stored, 0); assert.equal(c.collisions, 1); assert.deepEqual(c.collided, [{ schema: 'resource', title: 'X' }]);
  assert.equal(yaml.load(readFileSync(join(dir, 'data', 'kb', 'resource.yaml'), 'utf8')).entries.x.notes, 'mine');
});

test('kms.yaml is left byte-identical (comments survive) when no cursor changes', async () => {
  const same = { ...good, name: 'same', pull: async (_c, { cursor }) => ({ records: [], cursor }) };
  const peerless = { ...good, name: 'peerless', pull: async () => ({ records: [], cursor: {} }) }; // atproto with no peers: {} for null
  const dir = instance([{ name: 'same', config: {}, cursor: null }, { name: 'peerless', config: {}, cursor: null }]);
  const before = kmsText(dir);
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { same, peerless } } });
  assert.equal(res.ok, true);
  assert.equal(kmsText(dir), before);
  assert.match(kmsText(dir), /# keep me/);
});

test('a real cursor change rewrites kms.yaml (documented: comments are lost)', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }]);
  await OPS['ingest.pull'].run({ dir, deps: { registry: { good } } });
  assert.doesNotMatch(kmsText(dir), /# keep me/);
  assert.equal(yaml.load(kmsText(dir)).connectors[0].cursor, 1);
});

test('shared atproto identity is merged under each connector config (own config wins)', async () => {
  const seen = [];
  const spy = { ...good, name: 'spy', pull: async (c) => { seen.push(c); return { records: [], cursor: null }; } };
  const dir = instance([{ name: 'spy', config: { nsid_authority: 'own.auth', peers: ['did:plc:p'] }, cursor: null }],
    { extra: { atproto: { did: 'did:plc:me', pds: 'https://pds.test', nsid_authority: 'xyz.kb' } } });
  await OPS['ingest.pull'].run({ dir, deps: { registry: { spy } } });
  assert.deepEqual(seen[0], { self: 'did:plc:me', pds: 'https://pds.test', nsid_authority: 'own.auth', peers: ['did:plc:p'] });
});

test('no connectors declared: ok, empty report, kms.yaml untouched', async () => {
  const dir = instance([]);
  const before = kmsText(dir);
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good } } });
  assert.deepEqual(res, { ok: true, report: { connectors: [], failed: 0 } });
  assert.equal(kmsText(dir), before);
});

test('a --connector flag that is not a non-empty name is an operator error: nothing runs, kms.yaml untouched', async () => {
  for (const bad of [true, '', '   ', false]) {
    let pulls = 0;
    const spy = { ...good, name: 'good', pull: async () => { pulls++; return { records: [], cursor: 9 }; } };
    const dir = instance([{ name: 'good', config: {}, cursor: null }]);
    const before = kmsText(dir);
    const res = await OPS['ingest.pull'].run({ dir, flags: { connector: bad }, deps: { registry: { good: spy } } });
    assert.deepEqual(res, { ok: false, report: { connectors: [], failed: 0, error: '--connector needs a name (usage: --connector <name>)' } }, JSON.stringify(bad));
    assert.equal(pulls, 0, `pull invoked for ${JSON.stringify(bad)}`);
    assert.equal(kmsText(dir), before);
  }
});

test('flags.connector undefined still means all connectors; a named one still works', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }, { name: 'stub', config: {}, cursor: null }]);
  const all = await OPS['ingest.pull'].run({ dir, flags: { connector: undefined }, deps: { registry: { good, stub } } });
  assert.equal(all.ok, true); assert.equal(all.report.connectors.length, 2);
  const one = await OPS['ingest.pull'].run({ dir, flags: { connector: 'good' }, deps: { registry: { good, stub } } });
  assert.equal(one.report.connectors.length, 1);
});

test('cursor write-back re-reads kms.yaml: a concurrent edit survives, the cursor lands, no tmp file is left', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }]);
  const editing = { ...good, pull: async (_c, { cursor }) => {
    const doc = yaml.load(kmsText(dir)); doc.added_meanwhile = true;               // an operator edit lands mid-run
    writeFileSync(join(dir, 'kms.yaml'), yaml.dump(doc));
    return { records: [{ n: 'X' }], cursor: (cursor || 0) + 1 };
  } };
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good: editing } } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  const cfg = yaml.load(kmsText(dir));
  assert.equal(cfg.added_meanwhile, true, 'concurrent edit preserved');
  assert.equal(cfg.connectors[0].cursor, 1, 'cursor written');
  assert.ok(!existsSync(join(dir, 'kms.yaml.tmp')), 'no tmp file left behind');
});

test('cursor change is skipped (and reported) when the connector entry moved/renamed since the read', async () => {
  const dir = instance([{ name: 'good', config: {}, cursor: null }]);
  const renaming = { ...good, pull: async () => {
    const doc = yaml.load(kmsText(dir)); doc.connectors[0].name = 'renamed';
    writeFileSync(join(dir, 'kms.yaml'), yaml.dump(doc));
    return { records: [], cursor: 7 };
  } };
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { good: renaming } } });
  assert.equal(res.ok, true);
  assert.equal(yaml.load(kmsText(dir)).connectors[0].cursor, null, 'not applied to a different entry');
  assert.deepEqual(res.report.cursorSkipped, ['good']);
});
