import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeHttpd } from '../src/httpd.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = readFileSync(join(here, 'fixtures/repo.json'), 'utf8');
const blob = readFileSync(join(here, 'fixtures/blob.json'), 'utf8');
const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

// A fake fetch that maps URL substrings to fixture bodies.
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    }
    return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
  };
}

test('getRepo returns parsed governance shape', async () => {
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: fakeFetch([[`/repos/${RID}`, repo]]) });
  const r = await h.getRepo(RID);
  assert.equal(r.defaultBranch, 'master');
  assert.ok(/^[0-9a-f]{40}$/.test(r.head));
});

test('fetchFile resolves head then fetches blob content by sha', async () => {
  const parsed = JSON.parse(repo);
  const head = parsed.payloads['xyz.radicle.project'].meta.head
    || Object.values(parsed.payloads['xyz.radicle.project'].meta).find((v) => /^[0-9a-f]{40}$/.test(v));
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: fakeFetch([
    [`/repos/${RID}/blob/${head}/README.md`, blob],
    [`/repos/${RID}`, repo],
  ]) });
  const text = await h.fetchFile(RID, 'README.md');
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
});

test('fetchFile returns null (never throws) on a network error', async () => {
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: async () => { throw new Error('down'); } });
  assert.equal(await h.fetchFile(RID, 'README.md'), null);
});

test('fetchFile returns null on a 404 blob', async () => {
  const h = makeHttpd({ seed: 'https://seed.example', fetchFn: fakeFetch([[`/repos/${RID}`, repo]]) });
  assert.equal(await h.fetchFile(RID, 'nope.md'), null);
});
