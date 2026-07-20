import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDriver } from '../src/driver.mjs';
import { resolveDriver, resolveRemoteScheme } from '../src/resolve.mjs';

const REQUIRED = ['resolveRemote','whoami','clone','fetchFile','listPeers','getCanonical','getDrift','push','openChange','createIssue','commentIssue','syncUpstream','webUrl'];
const fakeDriver = (tag) => Object.fromEntries([...REQUIRED.map((m) => [m, () => {}]), ['_tag', () => tag]]);
registerDriver('github', () => fakeDriver('github'));
registerDriver('radicle', () => fakeDriver('radicle'));

test('resolveDriver defaults to github when platforms.canonical is absent', () => {
  const d = resolveDriver({});
  assert.equal(d._tag(), 'github');
});

test('resolveDriver honors platforms.canonical', () => {
  assert.equal(resolveDriver({ platforms: { canonical: 'radicle' } })._tag(), 'radicle');
  assert.equal(resolveDriver({ platforms: { canonical: 'github' } })._tag(), 'github');
});

test('resolveRemoteScheme detects rad: vs github', () => {
  assert.equal(resolveRemoteScheme('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'), 'radicle');
  assert.equal(resolveRemoteScheme('https://github.com/regen-coordination/org-os'), 'github');
  assert.equal(resolveRemoteScheme('regen-coordination/org-os'), 'github');
  assert.equal(resolveRemoteScheme(''), 'github'); // default
  assert.equal(resolveRemoteScheme(null), 'github');
});
