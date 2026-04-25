import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// NOTE on the happy-path test (option A from the v3.5 plan):
// The framework currently has known structural drift that will cause `npm run selftest`
// to exit non-zero today:
//   - validate:structure has 2 pre-existing failures (.well-known/dao.json missing,
//     federation section missing)
//   - version:check is not implemented yet (Task 3 will add --check mode to update-version.mjs)
//
// Rather than skip the happy-path coverage entirely, we INVERT it: assert the aggregator
// currently exits non-zero AND surfaces one of the known-broken steps in its output.
// This keeps the aggregator under test today and turns into a clear breakage signal as soon
// as the framework is healthy.
//
// TODO(Phase 3 cleanup): once validate:structure passes and version:check is implemented,
// flip these assertions back to:
//   assert.equal(result.status, 0);
//   assert.match(result.stdout, /selftest: PASS/);
test('npm run selftest currently fails on known framework drift (Phase 3 will green this)', () => {
  const result = spawnSync('node', ['scripts/selftest.mjs'], {
    encoding: 'utf-8',
    cwd: process.cwd()
  });
  assert.notEqual(result.status, 0, `expected selftest to FAIL today; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  // At least one known-broken step should be flagged in the output.
  const combined = result.stdout + result.stderr;
  assert.match(combined, /validate:structure|version:check/);
  assert.match(result.stdout, /selftest: FAIL/);
});

test('selftest exits non-zero on broken validate:schemas', () => {
  const result = spawnSync('node', ['scripts/selftest.mjs'], {
    encoding: 'utf-8',
    env: { ...process.env, ORG_OS_SELFTEST_FORCE_FAIL: 'validate:schemas' }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /validate:schemas/);
});
