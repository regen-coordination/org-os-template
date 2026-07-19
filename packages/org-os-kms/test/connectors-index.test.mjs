import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConnector, listConnectors } from '../src/connectors/index.mjs';

test('registry lists all six connectors', () => {
  assert.deepEqual(listConnectors().sort(), ['atproto', 'geo', 'github', 'koi', 'radicle', 'synthefy']);
});

test('getConnector returns the named connector', () => {
  assert.equal(getConnector('github').name, 'github');
  assert.equal(getConnector('koi').name, 'koi');
});

test('getConnector throws with the available list on an unknown name', () => {
  assert.throws(() => getConnector('nope'), /unknown connector: nope \(available: /);
});
