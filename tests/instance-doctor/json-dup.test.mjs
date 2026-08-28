// tests/instance-doctor/json-dup.test.mjs
//
// Duplicate JSON keys parse last-wins and are therefore invisible to
// JSON.parse. regen-coordination-os carries two "initialize" entries in
// package.json.scripts; whichever one an operator edits, the other may win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateJsonKeys } from '../../packages/instance-doctor/src/lib/json-dup.mjs';

test('finds no duplicates in well-formed JSON', () => {
  assert.deepEqual(duplicateJsonKeys('{"a":1,"b":{"c":2}}'), []);
});

test('finds a duplicate key at the top level', () => {
  assert.deepEqual(duplicateJsonKeys('{"a":1,"a":2}'), ['a']);
});

test('reports the dotted path of a nested duplicate — the regen scripts case', () => {
  const raw = JSON.stringify(
    { name: 'x', scripts: { initialize: 'a', build: 'b' } },
    null,
    2,
  ).replace('"build": "b"', '"initialize": "c"');
  assert.deepEqual(duplicateJsonKeys(raw), ['scripts.initialize']);
});

test('array indices do not become key paths', () => {
  assert.deepEqual(duplicateJsonKeys('{"a":[{"b":1},{"b":2}]}'), []);
});

test('keys inside string values are not mistaken for keys', () => {
  assert.deepEqual(duplicateJsonKeys('{"a":"{\\"a\\": 1}","b":2}'), []);
});

test('escaped quotes and colons inside keys are handled', () => {
  assert.deepEqual(duplicateJsonKeys('{"a:b":1,"a:b":2}'), ['a:b']);
});

test('malformed JSON yields no findings rather than throwing', () => {
  assert.deepEqual(duplicateJsonKeys('{not json'), []);
  assert.deepEqual(duplicateJsonKeys(''), []);
  assert.deepEqual(duplicateJsonKeys(null), []);
});

test('the real regen-coordination-os shape is caught', () => {
  const raw = `{
  "name": "organizational-os-template",
  "scripts": {
    "initialize": "node scripts/initialize.mjs",
    "setup": "node scripts/setup-org-os.mjs",
    "initialize": "node scripts/initialize.mjs"
  }
}`;
  assert.deepEqual(duplicateJsonKeys(raw), ['scripts.initialize']);
});
