import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_DRIVER_METHODS, registerDriver, getDriver, assertDriver } from '../src/driver.mjs';

const REQUIRED = [
  'resolveRemote', 'whoami',
  'clone', 'fetchFile', 'listPeers', 'getCanonical', 'getDrift',
  'push', 'openChange', 'createIssue', 'commentIssue', 'syncUpstream', 'webUrl',
];

test('HOST_DRIVER_METHODS lists every contract method', () => {
  assert.deepEqual([...HOST_DRIVER_METHODS].sort(), [...REQUIRED].sort());
});

test('assertDriver passes for a complete driver', () => {
  const complete = Object.fromEntries(REQUIRED.map((m) => [m, () => {}]));
  assert.doesNotThrow(() => assertDriver(complete, 'complete'));
});

test('assertDriver throws listing every missing method', () => {
  const partial = { resolveRemote: () => {}, fetchFile: () => {} };
  assert.throws(() => assertDriver(partial, 'partial'), (err) => {
    assert.match(err.message, /partial/);
    assert.match(err.message, /push/);
    assert.match(err.message, /getCanonical/);
    return true;
  });
});

test('register then get returns the same driver factory result', () => {
  const fake = Object.fromEntries(REQUIRED.map((m) => [m, () => {}]));
  registerDriver('fake', () => fake);
  assert.equal(getDriver('fake', {}), fake);
});

test('getDriver throws for an unknown driver name', () => {
  assert.throws(() => getDriver('nope', {}), /unknown host driver: nope/);
});
