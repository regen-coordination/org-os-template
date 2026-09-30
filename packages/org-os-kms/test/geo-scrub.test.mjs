import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecret } from '../src/geo/scrub.mjs';

test('scrubSecret masks the full secret and the secret without 0x, case-insensitively', () => {
  assert.equal(scrubSecret('a 0xAbC1 b abc1 c ABC1', '0xabc1'), 'a *** b *** c ***');
  assert.equal(scrubSecret('nothing here', '0xabc1'), 'nothing here');
});
test('scrubSecret escapes regex metacharacters and ignores empty secrets', () => {
  assert.equal(scrubSecret('x a.c y abc', 'a.c'), 'x *** y abc');
  assert.equal(scrubSecret('keep', ''), 'keep');
  assert.equal(scrubSecret('keep', undefined), 'keep');
});
