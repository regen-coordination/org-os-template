// test/sim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashAngle } from '../src/hash.mjs';
import { buildLayout, RING_RADIUS } from '../src/sim.mjs';
import { normalizeMap } from '../src/parse.mjs';

const MAP = normalizeMap({
  self: { id: 'org-os', name: 'org-os' },
  nodes: [
    { id: 'peer-a', kind: 'instance', ring: 1 },
    { id: 'peer-b', kind: 'instance', ring: 1 },
    { id: 'far-x', kind: 'frontier', ring: 2 },
    { id: 'src-y', kind: 'source', ring: 3 },
  ],
  edges: [
    { from: 'org-os', to: 'peer-a', kind: 'downstream' },
    { from: 'peer-a', to: 'far-x', kind: 'frontier' },
    { from: 'src-y', to: 'org-os', kind: 'provenance' },
  ],
});

test('hashAngle is deterministic and spread over [0, 2π)', () => {
  assert.equal(hashAngle('refi-bcn-os'), hashAngle('refi-bcn-os'));
  assert.notEqual(hashAngle('a'), hashAngle('b'));
  for (const id of ['a', 'b', 'refi-bcn-os']) {
    const v = hashAngle(id);
    assert.ok(v >= 0 && v < Math.PI * 2);
  }
});

test('buildLayout: self pinned center, others near their ring radius', () => {
  const { nodes, width, height } = buildLayout(MAP, { width: 800, height: 600 });
  const cx = width / 2, cy = height / 2, unit = Math.min(width, height);
  const self = nodes.find((n) => n.id === 'org-os');
  assert.equal(self.x, cx); assert.equal(self.y, cy);
  const peer = nodes.find((n) => n.id === 'peer-a');
  const r = Math.hypot(peer.x - cx, peer.y - cy);
  const target = RING_RADIUS[1] * unit;
  assert.ok(Math.abs(r - target) < target * 0.35, `ring-1 node settles near its radius (${r} vs ${target})`);
});

test('buildLayout is deterministic: same data → same positions', () => {
  const a = buildLayout(MAP, { width: 800, height: 600 }).nodes.map((n) => [n.id, n.x, n.y]);
  const b = buildLayout(MAP, { width: 800, height: 600 }).nodes.map((n) => [n.id, n.x, n.y]);
  assert.deepEqual(a, b);
});

test('buildLayout returns links resolved to node objects', () => {
  const { links } = buildLayout(MAP, { width: 800, height: 600 });
  assert.equal(links.length, 3);
  assert.equal(typeof links[0].source, 'object', 'd3-force resolves ids to node refs');
  assert.equal(links[0].kind, 'downstream');
});
