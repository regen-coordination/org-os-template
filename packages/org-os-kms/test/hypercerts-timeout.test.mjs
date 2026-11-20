import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeoutOf, DEFAULT_TIMEOUT_MS } from '../src/connectors/hypercerts/timeout.mjs';

// ---- polish 3: setTimeout treats a delay above 2^31-1 ms as 1 ms, so an enormous timeoutMs would end every request at once ----
test('polish 3: timeoutOf never returns more than setTimeout can hold', () => {
  for (const ms of [2_147_483_648, 1e10, Number.MAX_SAFE_INTEGER, 1e308]) {
    const out = timeoutOf(ms);
    assert.ok(out >= 60_000 && out <= 2_147_483_647, `${ms} -> ${out}`);   // sane: at least a minute, at most what setTimeout holds
  }
  assert.equal(timeoutOf(25), 25);
  assert.equal(timeoutOf(3_600_000), 3_600_000);   // an hour passes through
  assert.equal(timeoutOf(Infinity), DEFAULT_TIMEOUT_MS);   // unchanged: not finite -> default
  assert.equal(timeoutOf(0), DEFAULT_TIMEOUT_MS);
});
