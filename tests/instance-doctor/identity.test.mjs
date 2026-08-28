// tests/instance-doctor/identity.test.mjs
//
// B1 — identity coherence + template leakage. The clean-room "Harbor Bakery"
// run showed the newcomer path produces an instance that passes every existing
// validator while publishing the FRAMEWORK's identity: bread-coop-os still
// serves `.well-known/dao.json` with name "org-os".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkIdentity,
  identityNames,
  headType,
} from '../../packages/instance-doctor/src/checks/identity.mjs';

const COHERENT = {
  isFramework: false,
  identityMd: '- **Name:** ReFi Mediterranean\n- **Type:** LocalNode (multi-locality coordination)\n',
  federation: { identity: { name: 'ReFi Mediterranean', type: 'LocalNode' } },
  packageJson: { name: 'refi-med-os' },
  daoJson: { name: 'ReFi Mediterranean' },
};

const clone = (patch) => ({ ...structuredClone(COHERENT), ...patch });

test('headType reads the declared type before any parenthetical or slash gloss', () => {
  assert.equal(headType('LocalNode (multi-locality coordination)'), 'LocalNode');
  assert.equal(headType('Hub / Coordination OS'), 'Hub');
  assert.equal(headType('  Cooperative  '), 'Cooperative');
  assert.equal(headType(null), null);
});

test('identityNames collects every surface that names the organization', () => {
  const names = identityNames(COHERENT);
  assert.deepEqual(
    names.map((n) => n.surface).sort(),
    ['.well-known/dao.json', 'IDENTITY.md', 'federation.yaml'],
  );
});

test('a coherent instance is OK', () => {
  const r = checkIdentity(COHERENT);
  assert.equal(r.id, 'identity');
  assert.equal(r.status, 'OK', JSON.stringify(r.findings));
});

test('regen-coordination-os signature: IDENTITY.md and federation.yaml disagree on the name', () => {
  const r = checkIdentity(
    clone({
      identityMd: '- **Name:** Regen Coordination\n- **Type:** Hub / Coordination OS\n',
      federation: { identity: { name: 'Regen Coordination OS', type: 'Hub' } },
      daoJson: null,
    }),
  );
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'identity-name-disagreement');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /Regen Coordination OS/);
  assert.match(f.message, /IDENTITY\.md/);
});

test('a type gloss is not drift — only the head type is compared', () => {
  const r = checkIdentity(
    clone({
      identityMd: '- **Name:** Regen Coordination\n- **Type:** Hub / Coordination OS\n',
      federation: { identity: { name: 'Regen Coordination', type: 'Hub' } },
      daoJson: { name: 'Regen Coordination' },
    }),
  );
  assert.ok(!r.findings.some((x) => x.code === 'identity-type-disagreement'), JSON.stringify(r.findings));
});

test('a genuinely different type is reported', () => {
  const r = checkIdentity(
    clone({ federation: { identity: { name: 'ReFi Mediterranean', type: 'DAO' } } }),
  );
  assert.ok(r.findings.some((x) => x.code === 'identity-type-disagreement'));
});

test('bread-coop-os signature: dao.json still publishes the framework identity', () => {
  const r = checkIdentity(
    clone({
      identityMd: '- **Name:** bread-coop-os\n- **Type:** Cooperative\n',
      federation: { identity: { name: 'bread-coop-os', type: 'Cooperative' } },
      packageJson: { name: 'bread-coop-os' },
      daoJson: { name: 'org-os' },
    }),
  );
  assert.equal(r.status, 'BLOCKER');
  const codes = r.findings.map((x) => x.code);
  assert.ok(codes.includes('template-leakage'), JSON.stringify(codes));
  const f = r.findings.find((x) => x.code === 'template-leakage');
  assert.match(f.message, /\.well-known\/dao\.json/);
  assert.match(f.message, /org-os/);
});

test('regen-coordination-os signature: package.json is still named after the template', () => {
  const r = checkIdentity(clone({ packageJson: { name: 'organizational-os-template' } }));
  assert.equal(r.status, 'BLOCKER');
  const f = r.findings.find((x) => x.code === 'template-leakage');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.match(f.message, /package\.json/);
});

test('the framework itself is not accused of leaking its own identity', () => {
  const r = checkIdentity({
    isFramework: true,
    identityMd: '- **Name:** org-os\n- **Type:** Project\n',
    federation: { identity: { name: 'org-os', type: 'Project' } },
    packageJson: { name: 'organizational-os-template' },
    daoJson: { name: 'org-os' },
  });
  assert.equal(r.status, 'OK', JSON.stringify(r.findings));
});

test('unfilled scaffold placeholders are reported', () => {
  const r = checkIdentity(
    clone({ identityMd: '- **Name:** ReFi Mediterranean\n- **Type:** LocalNode\n- **Mission:** TBD\n- **Contact:** [Your email]\n' }),
  );
  const f = r.findings.find((x) => x.code === 'scaffold-placeholder');
  assert.ok(f, JSON.stringify(r.findings.map((x) => x.code)));
  assert.equal(f.level, 'WARN');
});

test('a missing IDENTITY.md is a WARN, not a crash', () => {
  const r = checkIdentity(clone({ identityMd: null }));
  assert.ok(r.findings.some((x) => x.code === 'identity-md-missing'));
  assert.equal(r.status, 'WARN');
});

test('a missing dao.json is a WARN — it is generated, not authored', () => {
  const r = checkIdentity(clone({ daoJson: null }));
  assert.equal(r.status, 'WARN');
  assert.ok(r.findings.some((x) => x.code === 'dao-json-missing'));
});
