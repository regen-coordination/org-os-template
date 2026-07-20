import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeIdentity } from '../src/identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = JSON.parse(readFileSync(join(here, 'fixtures/repo.json'), 'utf8'));

test('whoami parses the local did from rad self', async () => {
  const radCli = { run: async (args) => (args[0] === 'self' ? 'DID did:key:z6MkLOCALxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' : '') };
  const id = makeIdentity({ radCli });
  const me = await id.whoami();
  assert.match(me.id, /^did:key:z6Mk/);
  assert.equal(me.did, me.id);
});

test('delegatesOf reads delegates + threshold from the httpd repo doc', async () => {
  const httpd = { getRepo: async () => ({ delegates: repo.delegates.map((d) => ({ id: d.id, alias: d.alias })), threshold: repo.threshold }) };
  const id = makeIdentity({ httpd });
  const gov = await id.delegatesOf('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.ok(Array.isArray(gov.delegates));
  assert.equal(typeof gov.threshold, 'number');
  assert.ok(gov.delegates.every((d) => d.id.startsWith('did:key:')));
});
