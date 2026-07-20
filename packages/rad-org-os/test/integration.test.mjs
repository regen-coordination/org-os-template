import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHttpd } from '../src/httpd.mjs';

// Gated: only runs when RAD_INTEGRATION=1 (needs network / a reachable seed).
// Read-path integration hits the public seed; write-path pinning is a manual
// checklist below because it mutates a scratch repo.
const run = process.env.RAD_INTEGRATION === '1' ? test : test.skip;
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

run('live: getRepo against the public seed returns heartwood governance', async () => {
  const h = makeHttpd({ seed: 'https://seed.radicle.xyz' });
  const r = await h.getRepo(RID);
  assert.equal(r.name, 'heartwood');
  assert.ok(r.delegates.length >= 1);
  assert.ok(/^[0-9a-f]{40}$/.test(r.head));
});

run('live: fetchFile reads README.md content over httpd', async () => {
  const h = makeHttpd({ seed: 'https://seed.radicle.xyz' });
  const text = await h.fetchFile(RID, 'README.md');
  assert.ok(typeof text === 'string' && text.length > 0);
});

// Write-path live-pinning checklist (manual, run against a local `rad` node —
// mutates a scratch repo, so it is not automated here):
//   1. Capture `rad patch open --help`, `rad issue open --help`,
//      `rad id update --help`, and `rad self` output.
//   2. Confirm the flag names used in driver.mjs/identity.mjs:
//      --message / --title / --description / --delegate / --threshold.
//   3. Confirm the "✓ Patch <oid> opened" (and hint line) stdout/stderr shape
//      that parsePatchId/parseIssueId depend on.
//   4. If reality differs, correct driver.mjs/identity.mjs + the fixtures,
//      then remove the @needs-live-verification markers.
