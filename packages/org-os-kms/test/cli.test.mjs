import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../src/cli.mjs';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync as wf, readFileSync as rf } from 'node:fs';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

test('parses "lifecycle initialize --dir X" into a verb + flags', async () => {
  const r = await dispatch(['lifecycle', 'initialize', '--dir', '/tmp/x'], { dry: true });
  assert.equal(r.verb, 'lifecycle');
  assert.equal(r.args[0], 'initialize');
  assert.equal(r.flags.dir, '/tmp/x');
});

test('unknown verb returns an error result, not a throw', async () => {
  const r = await dispatch(['frobnicate'], { dry: true });
  assert.match(r.error, /unknown verb: frobnicate/);
});

test('known verbs are all routable', async () => {
  for (const v of ['lifecycle', 'bridge', 'render', 'federate', 'promote', 'init']) {
    assert.equal((await dispatch([v], { dry: true })).verb, v);
  }
});

// — render map (federation map builder) —
test('dispatch dry-routes render map', async () => {
  const r = await dispatch(['render', 'map', '--out', 'x.json'], { dry: true });
  assert.deepEqual(r, { verb: 'render', args: ['map'], flags: { out: 'x.json' } });
});

test('dispatch dry-routes render map html', async () => {
  const r = await dispatch(['render', 'map', 'html'], { dry: true });
  assert.deepEqual(r, { verb: 'render', args: ['map', 'html'], flags: {} });
});

test('dispatch dry-routes federate frontier', async () => {
  const r = await dispatch(['federate', 'frontier'], { dry: true });
  assert.deepEqual(r, { verb: 'federate', args: ['frontier'], flags: {} });
});

test('render map builds map.json from federation.yaml (no kms.yaml needed)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-map-'));
  wf(join(dir, 'federation.yaml'), 'identity:\n  name: tmp-os\n  type: Project\ndownstream:\n  - id: kid\n    name: Kid\n');
  const r = await dispatch(['render', 'map', '--dir', dir, '--out', 'out/map.json']);
  assert.equal(r.ok, true);
  const written = JSON.parse(rf(join(dir, 'out', 'map.json'), 'utf8'));
  assert.equal(written.self.id, 'tmp-os');
  assert.equal(written.nodes.length, 1);
});

test('ingest is a known verb (dry parse)', async () => {
  const r = await dispatch(['ingest', '--connector', 'github', '--dir', '/tmp/x'], { dry: true });
  assert.equal(r.verb, 'ingest');
  assert.equal(r.flags.connector, 'github');
  assert.equal(r.flags.dir, '/tmp/x');
});

test('unknown verb still rejected', async () => {
  assert.equal((await dispatch(['frobnicate'], { dry: true })).error, 'unknown verb: frobnicate');
});

test('ingest --dry runs the dry path (executes, does not store)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-cli-'));
  wf(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', connectors: [] }));
  const r = await dispatch(['ingest', '--dir', dir, '--dry']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.pulled, []); // no connectors declared → empty, but the dry path ran
});
