// test/element.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('element module imports cleanly in node (no top-level DOM access)', async () => {
  const mod = await import('../src/element.mjs');
  assert.equal(typeof mod.FederationMap, 'function');
  assert.equal(typeof mod.define, 'function');
  assert.doesNotThrow(() => mod.define()); // no customElements in node → silent no-op
});

test('index.mjs re-exports the full surface', async () => {
  const mod = await import('../src/index.mjs');
  for (const k of ['FederationMap', 'define', 'normalizeMap', 'buildLayout', 'renderSVG']) {
    assert.ok(k in mod, `missing export: ${k}`);
  }
});
