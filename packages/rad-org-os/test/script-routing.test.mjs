import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRemoteScheme } from '../../org-os-host/src/index.mjs';

// The routing invariant these scripts must honor: a manifest/upstream entry with a
// rad: rid resolves to the radicle scheme; a github url/slug resolves to github.
test('a rid entry routes to radicle, a github entry to github', () => {
  assert.equal(resolveRemoteScheme('rad:z3abc'), 'radicle');
  assert.equal(resolveRemoteScheme('https://github.com/org/repo'), 'github');
});
