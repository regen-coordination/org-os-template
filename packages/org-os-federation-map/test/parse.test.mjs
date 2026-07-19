// test/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap } from '../src/parse.mjs';

const GOOD = {
  version: '1',
  self: { id: 'org-os', name: 'org-os', type: 'Project' },
  nodes: [
    { id: 'refi-bcn-os', kind: 'instance', ring: 1 },
    { id: 'koi-network', kind: 'source', ring: 3 },
  ],
  edges: [
    { from: 'org-os', to: 'refi-bcn-os', kind: 'downstream' },
    { from: 'ghost', to: 'refi-bcn-os', kind: 'federation' }, // dangling
  ],
};

test('valid map: ok, nodes kept, dangling edges dropped', () => {
  const m = normalizeMap(GOOD);
  assert.equal(m.ok, true);
  assert.equal(m.nodes.length, 2);
  assert.equal(m.edges.length, 1, 'edge referencing unknown "ghost" is dropped');
});

test('nodes missing id or kind are dropped', () => {
  const m = normalizeMap({ ...GOOD, nodes: [...GOOD.nodes, { name: 'nameless' }, { id: 'x' }] });
  assert.equal(m.nodes.length, 2);
});

test('empty/invalid input → ok:false, empty collections (quiet empty-state)', () => {
  for (const bad of [null, undefined, 42, 'nope', {}, { self: null, nodes: [] }, { self: { id: 'a' } }]) {
    const m = normalizeMap(bad);
    assert.equal(m.ok, false);
    assert.deepEqual(m.nodes, []);
    assert.deepEqual(m.edges, []);
  }
});
