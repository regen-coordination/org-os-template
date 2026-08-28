// tests/instance-doctor/machinery.test.mjs
//
// B4 — machinery integrity. Every fixture here is a defect the 2026-08-28
// instance sweep actually found; copy-decay (gap #2) is the defect class the
// skew fingerprint exists to make visible instead of silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkMachinery,
  isNoOpStub,
  normalizeRepoUrl,
  localScriptTargets,
  CANONICAL_UPSTREAM_URL,
} from '../../packages/instance-doctor/src/checks/machinery.mjs';

const HEALTHY = {
  packageJson: { name: 'x-os', scripts: { 'sync:upstream': 'node scripts/sync-upstream.mjs' } },
  packageJsonRaw: '{"name":"x-os","scripts":{"sync:upstream":"node scripts/sync-upstream.mjs"}}',
  scriptFiles: {
    'scripts/sync-upstream.mjs': { exists: true, size: 9249, content: 'import fs from "node:fs";\n' },
  },
  git: { isRepo: true, remotes: { origin: 'https://github.com/x/x-os.git', upstream: CANONICAL_UPSTREAM_URL } },
  federation: { upstream: [{ url: CANONICAL_UPSTREAM_URL }] },
  dirs: { migrations: true },
  machinery: { 'scripts/sync-upstream.mjs': { instanceMd5: 'abc', frameworkMd5: 'abc' } },
};

const clone = (patch) => ({ ...structuredClone(HEALTHY), ...patch });

// --- helpers -------------------------------------------------------------

test('normalizeRepoUrl reduces every git URL form to owner/repo', () => {
  assert.equal(normalizeRepoUrl('https://github.com/regen-coordination/org-os-template.git'), 'regen-coordination/org-os-template');
  assert.equal(normalizeRepoUrl('https://github.com/regen-coordination/org-os-template'), 'regen-coordination/org-os-template');
  assert.equal(normalizeRepoUrl('git@github.com:regen-coordination/org-os-template.git'), 'regen-coordination/org-os-template');
  assert.equal(normalizeRepoUrl('https://github.com/Regen-Coordination/Org-OS-Template/'), 'regen-coordination/org-os-template');
  assert.equal(normalizeRepoUrl(''), null);
  assert.equal(normalizeRepoUrl(null), null);
});

test('isNoOpStub recognises the refi-dao-os 178-byte console-only sync script', () => {
  const stub = `#!/usr/bin/env node

console.log('sync:upstream: manual workflow for refi-dao-os');
console.log('Use git remotes and review changes before applying upstream template updates.');
`;
  assert.equal(isNoOpStub(stub), true);
});

test('isNoOpStub does not flag a real script that merely logs', () => {
  assert.equal(
    isNoOpStub('#!/usr/bin/env node\nimport fs from "node:fs";\nconsole.log("hi");\n'),
    false,
  );
  assert.equal(isNoOpStub('console.log("a");\nprocess.exit(1);\n'), false);
  assert.equal(isNoOpStub('const x = 1;\n'), false);
});

test('isNoOpStub treats an empty or comment-only file as a stub', () => {
  assert.equal(isNoOpStub(''), true);
  assert.equal(isNoOpStub('#!/usr/bin/env node\n// TODO\n'), true);
});

test('localScriptTargets extracts the local file each script invokes', () => {
  const targets = localScriptTargets({
    scripts: {
      'sync:upstream': 'node scripts/sync-upstream.mjs',
      knowledge: 'npm run compile:knowledge && npm run lint:knowledge',
      test: 'node --test "tests/**/*.test.mjs"',
      admin: 'npm --prefix packages/admin run start',
      generate: 'node  scripts/generate-all-schemas.mjs --force',
    },
  });
  const byName = Object.fromEntries(targets.map((t) => [t.name, t.file]));
  assert.equal(byName['sync:upstream'], 'scripts/sync-upstream.mjs');
  assert.equal(byName['generate'], 'scripts/generate-all-schemas.mjs');
  assert.ok(!('knowledge' in byName), 'npm-run chains reference no local file');
  assert.ok(!('test' in byName), 'a glob is not a script file');
  assert.ok(!('admin' in byName), 'npm --prefix delegates to another manifest');
});

// --- the check -----------------------------------------------------------

test('a healthy instance is OK', () => {
  const r = checkMachinery(HEALTHY);
  assert.equal(r.id, 'machinery');
  assert.equal(r.status, 'OK', JSON.stringify(r.findings));
});

test('refi-bcn-os signature: script entry present, target file missing', () => {
  const r = checkMachinery(
    clone({ scriptFiles: { 'scripts/sync-upstream.mjs': { exists: false } } }),
  );
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'script-target-missing');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /sync:upstream/);
  assert.match(f.message, /scripts\/sync-upstream\.mjs/);
});

test('refi-dao-os signature: no-op stub is a BLOCKER, not a passing script', () => {
  const r = checkMachinery(
    clone({
      scriptFiles: {
        'scripts/sync-upstream.mjs': {
          exists: true,
          size: 178,
          content: "#!/usr/bin/env node\n\nconsole.log('manual workflow');\n",
        },
      },
    }),
  );
  assert.equal(r.status, 'BLOCKER');
  assert.ok(r.findings.some((x) => x.code === 'script-is-noop-stub'));
});

test('refi-dao-os signature: missing upstream remote is a WARN — sync adds it', () => {
  const r = checkMachinery(
    clone({ git: { isRepo: true, remotes: { origin: 'https://github.com/x/x-os.git' } } }),
  );
  const codes = r.findings.map((x) => x.code);
  assert.ok(codes.includes('upstream-remote-missing'), JSON.stringify(codes));
  assert.equal(r.findings.find((x) => x.code === 'upstream-remote-missing').level, 'WARN');
});

test('bread-coop-os signature: no git remote at all is a BLOCKER with a remediation hint', () => {
  const r = checkMachinery(clone({ git: { isRepo: true, remotes: {} } }));
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'git-remote-absent');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.ok(f.hint && f.hint.length > 0, 'a BLOCKER an operator must fix by hand needs a hint');
  assert.match(f.hint, /git remote add/);
});

test('refi-med-os signature: upstream pointing at the divergent legacy repo is a BLOCKER', () => {
  const r = checkMachinery(
    clone({
      git: {
        isRepo: true,
        remotes: {
          origin: 'https://github.com/ReFiDAO/refi-med-os.git',
          upstream: 'https://github.com/regen-coordination/organizational-os-framework.git',
        },
      },
    }),
  );
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'upstream-remote-wrong-url');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /organizational-os-framework/);
  assert.match(f.message, /regen-coordination\/org-os-template/);
  assert.match(f.hint, /divergent/i);
});

test('refi-bcn-os signature: federation.yaml declaring a non-canonical upstream is reported too', () => {
  const r = checkMachinery(
    clone({
      federation: {
        upstream: [{ url: 'https://github.com/luizfernandosg/organizational-os-template' }],
      },
    }),
  );
  const f = r.findings.find((x) => x.code === 'upstream-declared-wrong-url');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /luizfernandosg/);
});

test('regen-coordination-os signature: a duplicate package.json key is a BLOCKER', () => {
  const r = checkMachinery(
    clone({
      packageJsonRaw:
        '{"name":"organizational-os-template","scripts":{"initialize":"node scripts/initialize.mjs","initialize":"node scripts/initialize.mjs"}}',
    }),
  );
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'package-json-duplicate-key');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /scripts\.initialize/);
});

test('machinery skew is surfaced instead of decaying silently', () => {
  const r = checkMachinery(
    clone({
      machinery: {
        'scripts/sync-upstream.mjs': { instanceMd5: '023b5f5', frameworkMd5: '8603207' },
        'scripts/validate-identity.mjs': { instanceMd5: null, frameworkMd5: '6b2d32e' },
      },
    }),
  );
  const skew = r.findings.filter((x) => x.code === 'machinery-skew');
  assert.equal(skew.length, 1, 'only the present-but-different file is skew');
  assert.match(skew[0].message, /sync-upstream\.mjs/);
  assert.equal(skew[0].level, 'WARN');
});

test('a missing migrations directory is a WARN', () => {
  const r = checkMachinery(clone({ dirs: { migrations: false } }));
  assert.ok(r.findings.some((x) => x.code === 'migrations-dir-missing'));
});

test('a directory that is not a git repository at all is a BLOCKER', () => {
  const r = checkMachinery(clone({ git: { isRepo: false, remotes: {} } }));
  assert.equal(r.status, 'BLOCKER');
  assert.ok(r.findings.some((x) => x.code === 'not-a-git-repo'));
  assert.ok(!r.findings.some((x) => x.code === 'git-remote-absent'), 'one finding, not two');
});

test('a missing package.json is a BLOCKER', () => {
  const r = checkMachinery(clone({ packageJson: null, packageJsonRaw: null }));
  assert.equal(r.status, 'BLOCKER');
  assert.ok(r.findings.some((x) => x.code === 'package-json-missing'));
});
