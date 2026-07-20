import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../src/index.mjs';

test('package exposes resolveDriver and getDriver', () => {
  assert.equal(typeof host.resolveDriver, 'function');
  assert.equal(typeof host.getDriver, 'function');
});

test('github driver is registered and resolvable by default', () => {
  const d = host.resolveDriver({}); // no platforms.canonical → github
  assert.equal(typeof d.fetchFile, 'function');
  assert.equal(d.resolveRemote('a/b').scheme, 'github');
});
