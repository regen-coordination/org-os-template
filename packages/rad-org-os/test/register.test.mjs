import { test } from 'node:test';
import assert from 'node:assert/strict';
import './../src/index.mjs'; // side effect: registers 'radicle'
import { resolveDriver } from '../../org-os-host/src/index.mjs';

test('radicle driver resolves via platforms.canonical=radicle', () => {
  const d = resolveDriver({ platforms: { canonical: 'radicle' }, seed: 'https://seed.example' });
  assert.equal(typeof d.fetchFile, 'function');
  assert.equal(d.resolveRemote('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5').scheme, 'radicle');
});
