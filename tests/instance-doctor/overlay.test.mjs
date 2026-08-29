// The file-level overlay that replaces the history-based sync.
//
// WHY THIS EXISTS. `scripts/sync-upstream.mjs` stage 5 runs
// `git pull --rebase upstream main`, which assumes the instance is a FORK of
// the framework. Every real instance is a SCAFFOLD with its own root commit —
// verified seven-for-seven — so the rebase tries to replay the instance's whole
// history onto the framework's, conflicts on essentially every shared filename,
// and leaves the repo mid-rebase. It did exactly that to refi-med-os on
// 2026-08-28 and is the reason v0.5.0 shipped with its sync claim narrowed.
//
// The overlay is the honest primitive for a scaffolded instance: copy the
// framework-owned paths in, leave everything the org owns alone, and let the
// lineage stamp record which framework commit was applied. Git history is not
// the carrier; the stamp is.
//
// The single most important property, and the one these tests exist to pin:
// **the overlay must never write a path the instance owns.** A sync that
// clobbers data/, memory/ or the identity files would destroy the organization
// it was meant to update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAMEWORK_OWNED,
  INSTANCE_OWNED,
  isFrameworkOwned,
  isInstanceOwned,
  overlayPlan,
} from '../../packages/instance-doctor/src/overlay.mjs';

// --- the ownership boundary ------------------------------------------------

test('the framework owns machinery, never the organization\'s own content', () => {
  for (const p of [
    'scripts/sync-upstream.mjs',
    'scripts/validate-identity.mjs',
    'scripts/lib/anything.mjs',
    'templates/README.instance.md',
  ]) {
    assert.equal(isFrameworkOwned(p), true, `${p} should be framework-owned`);
  }
});

test('the instance owns its data, memory, identity and generated output', () => {
  for (const p of [
    'data/members.yaml',
    'data/projects.yaml',
    'memory/2026-08-29.md',
    'memory/reports/anything.md',
    '.well-known/dao.json',
    'IDENTITY.md',
    'SOUL.md',
    'MASTERPLAN.md',
    'USER.md',
    'TOOLS.md',
    'HEARTBEAT.md',
    'MEMORY.md',
    'DECISIONS.md',
    'README.md',
    'federation.yaml',
    'package.json',
  ]) {
    assert.equal(isInstanceOwned(p), true, `${p} must be instance-owned`);
    assert.equal(isFrameworkOwned(p), false, `${p} must NOT be framework-owned`);
  }
});

test('the two sets cannot overlap — that would be an unresolvable claim', () => {
  for (const f of FRAMEWORK_OWNED) {
    for (const i of INSTANCE_OWNED) {
      assert.notEqual(f, i, `${f} is claimed by both sets`);
    }
  }
});

// --- the plan ---------------------------------------------------------------

test('plans a copy for each framework file, new or changed', () => {
  const plan = overlayPlan({
    frameworkFiles: new Map([
      ['scripts/sync-upstream.mjs', 'NEW'],
      ['scripts/validate-identity.mjs', 'SAME'],
      ['scripts/doctor.mjs', 'CHANGED'],
    ]),
    instanceFiles: new Map([
      ['scripts/validate-identity.mjs', 'SAME'],
      ['scripts/doctor.mjs', 'OLD'],
    ]),
  });
  const byPath = Object.fromEntries(plan.actions.map((a) => [a.path, a.action]));
  assert.equal(byPath['scripts/sync-upstream.mjs'], 'add');
  assert.equal(byPath['scripts/doctor.mjs'], 'update');
  assert.equal(byPath['scripts/validate-identity.mjs'], 'unchanged');
  assert.equal(plan.summary.add, 1);
  assert.equal(plan.summary.update, 1);
  assert.equal(plan.summary.unchanged, 1);
});

test('never plans to write an instance-owned path, even if the framework has one', () => {
  // The framework repo genuinely contains data/members.yaml, memory/, its own
  // IDENTITY.md and a populated .well-known/ — it is itself an instance. If the
  // overlay walked the tree naively it would copy the framework's organization
  // straight over the operator's. That is the Harbor Bakery leak, as a sync.
  const plan = overlayPlan({
    frameworkFiles: new Map([
      ['data/members.yaml', 'FRAMEWORK MEMBERS'],
      ['memory/2026-01-01.md', 'FRAMEWORK MEMORY'],
      ['IDENTITY.md', 'org-os'],
      ['federation.yaml', 'framework federation'],
      ['.well-known/dao.json', '{"name":"org-os"}'],
      ['scripts/doctor.mjs', 'NEW'],
    ]),
    instanceFiles: new Map([['data/members.yaml', 'ANA']]),
  });
  assert.deepEqual(
    plan.actions.filter((a) => a.action !== 'unchanged').map((a) => a.path),
    ['scripts/doctor.mjs'],
    'only the machinery may be written',
  );
  assert.equal(plan.instanceFilesWritten ?? 0, 0);
  for (const a of plan.actions) assert.equal(isInstanceOwned(a.path), false);
});

test('leaves instance-only files in a framework-owned directory alone', () => {
  // An instance may add its own scripts. The overlay copies IN; it does not
  // delete, because it cannot tell an operator's script from a removed one.
  const plan = overlayPlan({
    frameworkFiles: new Map([['scripts/doctor.mjs', 'X']]),
    instanceFiles: new Map([
      ['scripts/doctor.mjs', 'X'],
      ['scripts/our-own-tool.mjs', 'PRECIOUS'],
    ]),
  });
  assert.equal(plan.actions.some((a) => a.path === 'scripts/our-own-tool.mjs'), false);
  assert.deepEqual(plan.removed ?? [], [], 'the overlay must never plan a deletion');
});

test('a plan over an empty instance is all adds, and is not mistaken for a no-op', () => {
  const plan = overlayPlan({
    frameworkFiles: new Map([['scripts/a.mjs', '1'], ['scripts/b.mjs', '2']]),
    instanceFiles: new Map(),
  });
  assert.equal(plan.summary.add, 2);
  assert.equal(plan.changed, true);
});

test('an identical tree reports no change, so a re-run is a clean no-op', () => {
  const files = new Map([['scripts/a.mjs', '1']]);
  const plan = overlayPlan({ frameworkFiles: files, instanceFiles: new Map(files) });
  assert.equal(plan.changed, false);
  assert.equal(plan.summary.update, 0);
  assert.equal(plan.summary.add, 0);
});
