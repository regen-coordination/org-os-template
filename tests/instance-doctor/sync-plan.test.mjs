// tests/instance-doctor/sync-plan.test.mjs
//
// B8/B9 — the pure half of `doctor sync`: the stage plan, the re-baseline
// re-stamp, the lineage stamp, and the receipt. The re-stamp matters most:
// without it the post-sync re-assess fails B3, because the instance would
// still be claiming framework 3.0 after syncing a 0.5 framework.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSync,
  restampVersionSurfaces,
  stampLineage,
  renderReceipt,
  reconcileDeclaredUpstream,
} from '../../packages/instance-doctor/src/sync.mjs';

const FED_3_0 = `# federation.yaml
identity:
  name: "ReFi Mediterranean"
  type: "LocalNode"

metadata:
  created: "2026-04-28"
  last_updated: "2026-04-28"
  framework_version: "3.0"          # legacy scheme
  masterplan_version: "2.0.0"
`;

// --- the re-baseline re-stamp -------------------------------------------

test('re-stamps federation.yaml framework_version onto the 0.x line, preserving comments', () => {
  const out = restampVersionSurfaces({ federationRaw: FED_3_0 }, '0.5.0');
  assert.match(out.federationRaw, /framework_version: "0\.5"\s+# legacy scheme/);
  assert.ok(out.changed.includes('federation.yaml'));
  assert.match(out.federationRaw, /name: "ReFi Mediterranean"/, 'nothing else may be touched');
});

test('re-stamps the labelled VERSION.md line', () => {
  const out = restampVersionSurfaces(
    { versionMd: '# VERSION.md\n\n**Framework Version:** `1.0.0`  \n\nSemantic Versioning 2.0.0 blurb\n' },
    '0.5.0',
  );
  assert.match(out.versionMd, /\*\*Framework Version:\*\* `0\.5\.0`/);
  assert.match(out.versionMd, /Semantic Versioning 2\.0\.0 blurb/, 'the semver prose is not a version surface');
  assert.ok(out.changed.includes('VERSION.md'));
});

test("re-stamps package.json only when its name shows the template leaked", () => {
  const leaked = restampVersionSurfaces(
    {
      packageJson: { name: 'organizational-os-template', version: '3.0.0' },
      packageJsonRaw: '{\n  "name": "organizational-os-template",\n  "version": "3.0.0"\n}\n',
    },
    '0.5.0',
  );
  assert.match(leaked.packageJsonRaw, /"version": "0\.5\.0"/);
  assert.ok(leaked.changed.includes('package.json'));

  const own = restampVersionSurfaces(
    {
      packageJson: { name: 'refi-med-os', version: '0.1.0' },
      packageJsonRaw: '{\n  "name": "refi-med-os",\n  "version": "0.1.0"\n}\n',
    },
    '0.5.0',
  );
  assert.match(own.packageJsonRaw, /"version": "0\.1\.0"/, "an instance's own version is not a framework claim");
  assert.ok(!own.changed.includes('package.json'));
});

test('re-stamping an already-current instance changes nothing', () => {
  const out = restampVersionSurfaces(
    { federationRaw: 'metadata:\n  framework_version: "0.5"\n' },
    '0.5.0',
  );
  assert.deepEqual(out.changed, []);
});

test('re-stamping a surface that is absent is a no-op, not a crash', () => {
  const out = restampVersionSurfaces({}, '0.5.0');
  assert.deepEqual(out.changed, []);
  assert.equal(out.federationRaw, null);
});

// --- the declared upstream ----------------------------------------------

const CANON = 'https://github.com/regen-coordination/org-os-template.git';

test('the refi-med-os shape: repository but no url, pointing at the legacy repo', () => {
  // sync-upstream.mjs stage 3 reads federation.yaml.upstream[0].url and exits 1
  // when it is absent. Fixing only the git REMOTE therefore gets the doctor as
  // far as running sync-upstream and no further. Found in WS-H H1.
  const raw = `identity:
  name: "ReFi Mediterranean"

upstream:
  - repository: "https://github.com/regen-coordination/organizational-os-framework"
    last_sync: "2026-04-28"
    sync_frequency: "on-demand"

downstream: []
`;
  const out = reconcileDeclaredUpstream(raw, CANON);
  assert.equal(out.changed, true);
  assert.match(out.raw, /url: "https:\/\/github\.com\/regen-coordination\/org-os-template\.git"/);
  assert.match(out.raw, /repository: "https:\/\/github\.com\/regen-coordination\/org-os-template\.git"/);
  assert.match(out.raw, /last_sync: "2026-04-28"/, 'unrelated fields survive');
  assert.match(out.raw, /sync_frequency: "on-demand"/);
  assert.match(out.raw, /downstream: \[\]/, 'the block after upstream survives');
});

test('an existing url value is rewritten in place', () => {
  const raw = `upstream:
  - type: "template"
    url: "https://github.com/luizfernandosg/organizational-os-template"
    relationship: "fork"
`;
  const out = reconcileDeclaredUpstream(raw, CANON);
  assert.equal(out.changed, true);
  assert.match(out.raw, /url: "https:\/\/github\.com\/regen-coordination\/org-os-template\.git"/);
  assert.ok(!out.raw.includes('luizfernandosg'));
  assert.match(out.raw, /relationship: "fork"/);
});

test('an already-canonical declaration is left alone', () => {
  const raw = `upstream:\n  - url: "${CANON}"\n`;
  const out = reconcileDeclaredUpstream(raw, CANON);
  assert.equal(out.changed, false);
  assert.equal(out.raw, raw);
});

test('a missing upstream block is created', () => {
  const raw = 'identity:\n  name: "Acme"\n\ndownstream: []\n';
  const out = reconcileDeclaredUpstream(raw, CANON);
  assert.equal(out.changed, true);
  assert.match(out.raw, /^upstream:$/m);
  assert.match(out.raw, new RegExp(`url: "${CANON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(out.raw, /identity:/, 'existing content survives');
});

test('an empty upstream list gets its first entry', () => {
  const raw = 'upstream: []\ndownstream: []\n';
  const out = reconcileDeclaredUpstream(raw, CANON);
  assert.equal(out.changed, true);
  assert.match(out.raw, /url: "https:\/\/github\.com\/regen-coordination\/org-os-template\.git"/);
  assert.match(out.raw, /downstream: \[\]/);
});

// --- the lineage stamp ---------------------------------------------------

test('stamps last_sync_commit and last_updated, seeding genesis when absent', () => {
  const out = stampLineage(FED_3_0, {
    genesisCommit: 'a'.repeat(40),
    lastSyncCommit: 'b'.repeat(40),
    today: '2026-08-28',
  });
  assert.match(out, new RegExp(`genesis_commit: "${'a'.repeat(40)}"`));
  assert.match(out, new RegExp(`last_sync_commit: "${'b'.repeat(40)}"`));
  assert.match(out, /last_updated: "2026-08-28"/);
});

test('an existing genesis_commit is never overwritten — it is immutable', () => {
  const fed = `metadata:\n  genesis_commit: "${'c'.repeat(40)}"\n  last_sync_commit: null\n`;
  const out = stampLineage(fed, {
    genesisCommit: 'a'.repeat(40),
    lastSyncCommit: 'b'.repeat(40),
    today: '2026-08-28',
  });
  assert.match(out, new RegExp(`genesis_commit: "${'c'.repeat(40)}"`));
  assert.ok(!out.includes('a'.repeat(40)));
});

// --- the plan ------------------------------------------------------------

const baseSnapshot = (patch = {}) => ({
  dir: '/tmp/refi-med-os',
  name: 'ReFi Mediterranean',
  federation: { metadata: { framework_version: '3.0' }, upstream: [] },
  packageJson: { name: 'refi-med-os', version: '0.1.0' },
  git: { isRepo: true, remotes: { origin: 'https://github.com/ReFiDAO/refi-med-os.git' }, dirtyCount: 0 },
  machinery: {},
  framework: { dir: '/tmp/org-os', version: '0.5.0', headSha: 'f'.repeat(40) },
  ...patch,
});

test('the plan runs the stages in the order the masterplan specifies', () => {
  const stages = planSync(baseSnapshot());
  assert.deepEqual(
    stages.map((s) => s.id),
    [
      'snapshot',
      'ensure-upstream',
      'fetch',
      'inject-machinery',
      // v0.5.1: `overlay` replaces the old `sync-upstream` stage. That stage
      // shelled out to a rebase that assumes fork lineage and stranded every
      // scaffolded instance mid-rebase; the overlay copies framework-owned
      // paths in instead. See packages/instance-doctor/src/overlay.mjs.
      'overlay',
      'migrate',
      'generate-schemas',
      're-assess',
      'receipt',
    ],
  );
});

test('the plan says it will ADD a missing upstream remote', () => {
  const stage = planSync(baseSnapshot()).find((s) => s.id === 'ensure-upstream');
  assert.match(stage.detail, /add/i);
  assert.match(stage.detail, /regen-coordination\/org-os-template/);
});

test('the plan says it will REWRITE a divergent upstream remote, and names why', () => {
  const stages = planSync(
    baseSnapshot({
      git: {
        isRepo: true,
        remotes: {
          origin: 'https://github.com/ReFiDAO/refi-med-os.git',
          upstream: 'https://github.com/regen-coordination/organizational-os-framework.git',
        },
        dirtyCount: 0,
      },
    }),
  );
  const stage = stages.find((s) => s.id === 'ensure-upstream');
  assert.match(stage.detail, /rewrite/i);
  assert.match(stage.detail, /organizational-os-framework/);
  assert.match(stage.detail, /divergent/i);
});

test('the plan leaves a correct upstream remote alone', () => {
  const stages = planSync(
    baseSnapshot({
      git: {
        isRepo: true,
        remotes: { upstream: 'https://github.com/regen-coordination/org-os-template.git' },
        dirtyCount: 0,
      },
    }),
  );
  assert.match(stages.find((s) => s.id === 'ensure-upstream').detail, /already canonical/i);
});

test('the migrate stage announces the cross-scheme re-stamp it will perform', () => {
  const stage = planSync(baseSnapshot()).find((s) => s.id === 'migrate');
  assert.match(stage.detail, /3\.0/);
  assert.match(stage.detail, /0\.5/);
});

test('the plan lists exactly the machinery files it will inject', () => {
  const stage = planSync(baseSnapshot()).find((s) => s.id === 'inject-machinery');
  assert.match(stage.detail, /sync-upstream\.mjs/);
  assert.match(stage.detail, /validate-identity\.mjs/);
  assert.match(stage.detail, /doctor\.mjs/);
});

// --- the receipt ---------------------------------------------------------

test('a receipt records every stage and, on abort, which one stopped it', () => {
  const md = renderReceipt({
    name: 'ReFi Mediterranean',
    today: '2026-08-28',
    frameworkVersion: '0.5.0',
    frameworkHead: 'f'.repeat(40),
    stages: [
      { id: 'snapshot', status: 'ok', detail: 'refs/snapshots/20260828-doctor-sync' },
      { id: 'ensure-upstream', status: 'ok', detail: 'rewrote upstream' },
      { id: 'fetch', status: 'failed', detail: 'could not reach the remote' },
      { id: 'migrate', status: 'skipped', detail: 'aborted before this stage' },
    ],
    aborted: true,
    abortStage: 'fetch',
  });
  assert.match(md, /# Sync receipt — 2026-08-28/);
  assert.match(md, /ABORTED at `fetch`/);
  assert.match(md, /could not reach the remote/);
  assert.match(md, /skipped/);
});

test('a successful receipt records the new lineage stamp', () => {
  const md = renderReceipt({
    name: 'ReFi Mediterranean',
    today: '2026-08-28',
    frameworkVersion: '0.5.0',
    frameworkHead: 'f'.repeat(40),
    stages: [{ id: 'snapshot', status: 'ok', detail: '' }],
    aborted: false,
    lastSyncCommit: 'f'.repeat(40),
    reassess: { status: 'OK', summary: { blockers: 0, warnings: 1, checks: 6 } },
  });
  assert.match(md, /last_sync_commit/);
  assert.match(md, /0 blocker/);
  assert.ok(!md.includes('ABORTED'));
});
