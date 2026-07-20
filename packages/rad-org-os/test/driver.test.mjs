import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeRadicleDriver } from '../src/driver.mjs';
import { runHostDriverContract } from '../../org-os-host/test/contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = readFileSync(join(here, 'fixtures/repo.json'), 'utf8');
const blob = readFileSync(join(here, 'fixtures/blob.json'), 'utf8');
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

function fakeFetch() {
  const parsed = JSON.parse(repo);
  const head = parsed.payloads['xyz.radicle.project'].meta.head
    || Object.values(parsed.payloads['xyz.radicle.project'].meta).find((v) => /^[0-9a-f]{40}$/.test(v));
  return async (url) => {
    if (url.includes(`/blob/${head}/README.md`)) return { ok: true, json: async () => JSON.parse(blob) };
    if (url.includes(`/repos/${RID}`)) return { ok: true, json: async () => parsed };
    return { ok: false, json: async () => ({}) };
  };
}
// fake exec: writes succeed with a parseable id line; reads not used here.
const fakeExec = async (bin, args) => {
  const key = args.join(' ');
  if (bin === 'git' && key.includes('refs/patches')) {
    // patch-open prints the new patch id on stderr in real rad
    return { code: 0, stdout: '', stderr: '✓ Patch 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 opened\n' };
  }
  if (key.includes('self')) return { code: 0, stdout: 'DID did:key:z6MkLOCALxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n', stderr: '' };
  if (key.includes('issue')) return { code: 0, stdout: '✓ Issue 1122334455667788990011223344556677889900 opened\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

function makeDriver() {
  return makeRadicleDriver({ seed: 'https://seed.example', fetchFn: fakeFetch(), exec: fakeExec });
}

test('radicle driver satisfies the HostDriver contract', async () => {
  await runHostDriverContract(makeDriver, { assert });
});

test('resolveRemote reports scheme radicle for a rad: id', () => {
  assert.equal(makeDriver().resolveRemote(RID).scheme, 'radicle');
});

test('getCanonical returns delegates + threshold from the repo doc', async () => {
  const c = await makeDriver().getCanonical(RID);
  assert.equal(c.defaultBranch, 'master');
  assert.ok(c.threshold >= 1);
  assert.ok(Array.isArray(c.delegates) && c.delegates.length > 0);
});

test('whoami returns the local did:key (real identity, not null)', async () => {
  const me = await makeDriver().whoami();
  assert.match(me.id, /^did:key:z6Mk/);
});

test('openChange returns the patch COB id', async () => {
  const ref = await makeDriver().openChange({ title: 'T', body: 'B', base: 'master' });
  assert.equal(ref.id, '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567');
  assert.equal(ref.ok, true);
});
