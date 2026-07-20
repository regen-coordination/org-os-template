import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMemberIdScheme } from '../src/identity-scheme.mjs';

test('radicle-canonical requires did: member ids', () => {
  const r = validateMemberIdScheme([{ id: 'did:key:z6MkA' }], 'radicle');
  assert.equal(r.ok, true);
  const bad = validateMemberIdScheme([{ id: 'github:alice' }], 'radicle');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /github:alice.*radicle/);
});

test('github-canonical requires github: member ids', () => {
  assert.equal(validateMemberIdScheme([{ id: 'github:alice' }], 'github').ok, true);
  assert.equal(validateMemberIdScheme([{ id: 'did:key:z6MkA' }], 'github').ok, false);
});

test('empty members list is ok', () => {
  assert.equal(validateMemberIdScheme([], 'radicle').ok, true);
});

test('unknown canonical platform fails with an explicit error', () => {
  const r = validateMemberIdScheme([{ id: 'did:key:z6MkA' }], 'radicel');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /unknown canonical platform: radicel/);
});
