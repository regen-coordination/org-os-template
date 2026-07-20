import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../src/index.mjs';

test('package exposes resolveDriver and getDriver', () => {
  assert.equal(typeof host.resolveDriver, 'function');
  assert.equal(typeof host.getDriver, 'function');
});
