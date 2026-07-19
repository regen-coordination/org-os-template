import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../src/cli.mjs';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync as wf, readFileSync as rf } from 'node:fs';
import { tmpdir } from 'node:os';

test('parses "lifecycle initialize --dir X" into a verb + flags', () => {
  const r = dispatch(['lifecycle', 'initialize', '--dir', '/tmp/x'], { dry: true });
  assert.equal(r.verb, 'lifecycle');
  assert.equal(r.args[0], 'initialize');
  assert.equal(r.flags.dir, '/tmp/x');
});

test('unknown verb returns an error result, not a throw', () => {
  const r = dispatch(['frobnicate'], { dry: true });
  assert.match(r.error, /unknown verb: frobnicate/);
});

test('known verbs are all routable', () => {
  for (const v of ['lifecycle', 'bridge', 'render', 'federate', 'promote', 'init']) {
    assert.equal(dispatch([v], { dry: true }).verb, v);
  }
});

// — render map (federation map builder) —
test('dispatch dry-routes render map', () => {
  const r = dispatch(['render', 'map', '--out', 'x.json'], { dry: true });
  assert.deepEqual(r, { verb: 'render', args: ['map'], flags: { out: 'x.json' } });
});

test('dispatch dry-routes federate frontier', () => {
  const r = dispatch(['federate', 'frontier'], { dry: true });
  assert.deepEqual(r, { verb: 'federate', args: ['frontier'], flags: {} });
});

test('render map builds map.json from federation.yaml (no kms.yaml needed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-map-'));
  wf(join(dir, 'federation.yaml'), 'identity:\n  name: tmp-os\n  type: Project\ndownstream:\n  - id: kid\n    name: Kid\n');
  const r = dispatch(['render', 'map', '--dir', dir, '--out', 'out/map.json']);
  assert.equal(r.ok, true);
  const written = JSON.parse(rf(join(dir, 'out', 'map.json'), 'utf8'));
  assert.equal(written.self.id, 'tmp-os');
  assert.equal(written.nodes.length, 1);
});
