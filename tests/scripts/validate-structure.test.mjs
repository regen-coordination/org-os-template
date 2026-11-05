// tests/scripts/validate-structure.test.mjs
//
// validate:structure and the standards output (DAO-OS L8, ruling R26): the .well-known/ files generate:schemas derives
// are required only when federation.yaml sets identity.daoURI. Without one the generator writes nothing (L8-C16), and
// the validator says so once instead of failing. Each case is a fresh temporary instance, removed afterwards; the
// assertions read section 4's lines (the other sections' findings on a minimal instance are not this suite's subject).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ORG_ROOT } from '../helpers/repo-paths.mjs';

const SCRIPT = path.join(ORG_ROOT, 'scripts', 'validate-structure.mjs');
const SCHEMAS = ['dao.json', 'members.json', 'projects.json'];

const roots = [];
after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A temporary instance with the given federation.yaml (null: none) and .well-known/ files. */
function instance({ federation, wellKnown = [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-structure-'));
  roots.push(root);
  if (federation !== null) writeFileSync(path.join(root, 'federation.yaml'), federation);
  mkdirSync(path.join(root, '.well-known'));
  for (const f of wellKnown) writeFileSync(path.join(root, '.well-known', f), '{}\n');
  return root;
}
const fed = (daoURI) => `identity:\n  name: "Test DAO"\n  type: "DAO"\n${daoURI === undefined ? '' : `  daoURI: ${JSON.stringify(daoURI)}\n`}`;

function section4(root) {
  const r = spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
  const text = r.stdout.split('\n4. .well-known/ Schemas')[1]?.split('\n5. ')[0];
  assert.ok(text !== undefined, `no section 4 in:\n${r.stdout}\n${r.stderr}`);
  return text;
}
const NOTE = /· standards output not generated: identity\.daoURI is not set \(L8-C16\), so \.well-known\/dao\.json, members\.json, projects\.json are not required/g;

test('without identity.daoURI the standards output is not required, and the validator says so once', () => {
  for (const federation of [fed(undefined), fed(''), fed('   '), null]) {
    const out = section4(instance({ federation }));
    assert.equal((out.match(NOTE) ?? []).length, 1, out);
    for (const f of SCHEMAS) assert.doesNotMatch(out, new RegExp(`[✓✗] \\.well-known/${f.replace('.', '\\.')} exists`), out);
    assert.doesNotMatch(out, /✗/, out);
  }
});

test('with identity.daoURI set, every standards file is still required', () => {
  const missing = section4(instance({ federation: fed('https://dao.example.org/.well-known/dao.json') }));
  for (const f of SCHEMAS) assert.match(missing, new RegExp(`✗ \\.well-known/${f.replace('.', '\\.')} exists`), missing);
  assert.doesNotMatch(missing, NOTE);

  const present = section4(instance({ federation: fed('https://dao.example.org/.well-known/dao.json'), wellKnown: SCHEMAS }));
  for (const f of SCHEMAS) assert.match(present, new RegExp(`✓ \\.well-known/${f.replace('.', '\\.')} exists`), present);
  assert.doesNotMatch(present, /✗/, present);
});

test('a federation.yaml that cannot be read keeps the requirement', () => {
  const out = section4(instance({ federation: 'identity: [unclosed\n' }));
  for (const f of SCHEMAS) assert.match(out, new RegExp(`✗ \\.well-known/${f.replace('.', '\\.')} exists`), out);
  assert.doesNotMatch(out, NOTE);
});
