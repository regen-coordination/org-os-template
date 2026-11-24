// packages/org-os-kms/test/atproto-publish.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPublish, applyPublish, contentHash } from '../src/atproto/publish.mjs';
import { XrpcError } from '../src/atproto/client.mjs';

const AUTH = 'xyz.regencoordination.kb'; const DID = 'did:plc:me';
const item = (slug, extra = {}, schema = 'resource') => ({ schema, ref: `data/kb/${schema}.yaml#${slug}`, object: { title: slug, type: 'resource', public_use: 'ok-with-caveat', id: `id-${slug}`, grc20Id: `g-${slug}`, ...extra } });
const empty = { version: 1, objects: {} };
const RES = `${AUTH}.resource`;

test('create / skip / update(swapRecord) / delete', () => {
  const a = item('a', { notes: 'x' }); const b = item('b');
  const first = planPublish({ items: [a, b], manifest: empty, did: DID, authority: AUTH });
  assert.equal(first.ok, true); assert.equal(first.create.length, 2);
  assert.equal(first.create[0].collection, RES); assert.equal(first.create[0].rkey, 'id-a'); assert.equal(first.create[0].slug, 'a');
  assert.equal(first.create[0].record.$type, RES);
  assert.equal(first.create[0].record.notes, undefined);
  const manifest = { version: 1, objects: {
    'id-a': { slug: 'a', type: 'resource', rkey: 'id-a', atUri: `at://${DID}/${RES}/id-a`, cid: 'cid-a', hash: first.create[0].hash, publishedAt: 't' },
    'id-b': { slug: 'b', type: 'resource', rkey: 'id-b', atUri: `at://${DID}/${RES}/id-b`, cid: 'cid-b', hash: first.create[1].hash, publishedAt: 't' } } };
  const second = planPublish({ items: [a, item('b', { url: 'https://changed.example/b' })], manifest, did: DID, authority: AUTH });
  assert.deepEqual(second.skip, ['id-a']); assert.equal(second.update.length, 1); assert.equal(second.update[0].swapRecord, 'cid-b');
  const third = planPublish({ items: [a], manifest, did: DID, authority: AUTH });
  assert.equal(third.delete.length, 1); assert.equal(third.delete[0].rkey, 'id-b');
});

test('source-system card: NSID from schema, not from object.type', () => {
  const card = item('blog', { type: 'blog', steward: 's', return_path: 'r' }, 'source-system');
  const p = planPublish({ items: [card], manifest: empty, did: DID, authority: AUTH });
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.equal(p.create[0].collection, `${AUTH}.sourceSystem`);
  assert.equal(p.create[0].record.type, 'blog');
});

test('refs rewritten against the manifest; validation is all-or-nothing', () => {
  const manifest = { version: 1, objects: { 'id-c': { slug: 'c', type: 'concept-lineage', atUri: `at://${DID}/x/id-c`, rkey: 'id-c', cid: 'x', hash: 'h', publishedAt: 't' } } };
  const p = planPublish({ items: [item('a', { related_concepts: ['c', 'zzz'] })], manifest, did: DID, authority: AUTH });
  assert.deepEqual(p.create[0].record.related_concepts, [`at://${DID}/x/id-c`, 'zzz']);
  const bad = planPublish({ items: [item('a', { provenance: { score: 0.1 } }), item('b')], manifest: empty, did: DID, authority: AUTH });
  assert.equal(bad.ok, false); assert.equal(bad.create.length, 0); assert.match(bad.errors[0].errors[0], /float/);
});

test('applyPublish: per-op calls, per-record failures, new manifest', async () => {
  const calls = [];
  const client = {
    async putRecord(op) { calls.push(['put', op.rkey]); if (op.rkey === 'id-b') throw new XrpcError(400, 'InvalidSwap', 'modified'); return { uri: `at://${DID}/${op.collection}/${op.rkey}`, cid: `cid-${op.rkey}` }; },
    async deleteRecord(op) { calls.push(['del', op.rkey]); },
  };
  const prev = { version: 1, objects: { 'id-z': { slug: 'z', type: 'resource', rkey: 'id-z', atUri: 'u', cid: 'c', hash: 'h', publishedAt: 't' } } };
  const plan = planPublish({ items: [item('a'), item('b')], manifest: prev, did: DID, authority: AUTH });
  const out = await applyPublish(plan, { client, did: DID, now: () => 'NOW' });
  assert.deepEqual(calls, [['put', 'id-a'], ['put', 'id-b'], ['del', 'id-z']]);
  assert.equal(out.applied.created, 1); assert.equal(out.applied.deleted, 1);
  assert.equal(out.failures[0].id, 'id-b');
  assert.equal(out.manifest.objects['id-a'].cid, 'cid-id-a'); assert.equal(out.manifest.objects['id-a'].publishedAt, 'NOW');
  assert.equal(out.manifest.objects['id-b'], undefined); assert.equal(out.manifest.objects['id-z'], undefined);
  assert.equal(prev.objects['id-z'].slug, 'z', 'input not mutated');
});

test('contentHash stable across key order', () => {
  assert.equal(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] }), contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
});

// F8: a moved record whose OLD copy could not be deleted stays tracked (manifest.orphans) until it is deleted.
const OLD = 'old.example.kb.resource';
const moved = () => ({ version: 1, objects: { 'id-a': { slug: 'a', type: 'resource', rkey: 'id-a', collection: OLD, atUri: `at://${DID}/${OLD}/id-a`, cid: 'old-cid', hash: 'h' } } });
const okClient = (dels = []) => ({ async putRecord(op) { return { uri: `at://${DID}/${op.collection}/${op.rkey}`, cid: `cid-${op.collection}` }; }, async deleteRecord(op) { dels.push([op.collection, op.rkey]); } });
const failingDelete = (dels = [], only = null) => ({ ...okClient(), async deleteRecord(op) { dels.push([op.collection, op.rkey]); if (!only || op.collection === only) throw new Error('pds down'); } });
const run = (items, manifest, client) => applyPublish(planPublish({ items, manifest, did: DID, authority: AUTH }), { client, did: DID });

test('F8: a failed delete of the old collection is tracked on the manifest, not reported once and forgotten', async () => {
  const first = await run([item('a')], moved(), failingDelete());
  assert.equal(first.failures.length, 1);
  assert.deepEqual(first.manifest.orphans, [{ id: 'id-a', collection: OLD, rkey: 'id-a' }]);
  assert.equal(first.manifest.objects['id-a'].collection, RES, 'the manifest tracks the new record');
});

test('F8: a later run retries the stale delete, and stops tracking it once it succeeds', async () => {
  const first = await run([item('a')], moved(), failingDelete());
  const stillDown = await run([item('a')], first.manifest, failingDelete());
  assert.deepEqual(stillDown.manifest.orphans, [{ id: 'id-a', collection: OLD, rkey: 'id-a' }], 'a failed retry keeps it');
  assert.equal(stillDown.failures.length, 1);
  const dels = [];
  const healed = await run([item('a')], stillDown.manifest, okClient(dels));
  assert.deepEqual(dels, [[OLD, 'id-a']]); assert.equal(healed.failures.length, 0);
  assert.equal(healed.manifest.orphans, undefined, 'nothing left to track');
  assert.equal(healed.manifest.objects['id-a'].collection, RES, 'the live record is untouched');
  const again = []; await run([item('a')], healed.manifest, okClient(again));
  assert.deepEqual(again, [], 'idempotent: a clean manifest deletes nothing');
});

test('F8: withdrawing the object deletes its stale copy too, and a failure there is still tracked', async () => {
  const first = await run([item('a'), item('b')], { version: 1, objects: { ...moved().objects } }, failingDelete());
  const dels = [];
  const gone = await run([item('b')], first.manifest, failingDelete(dels, OLD));
  assert.deepEqual(dels.map(([c]) => c).sort(), [OLD, RES].sort(), 'the live copy and the stale one are both deleted');
  assert.equal(gone.manifest.objects['id-a'], undefined, 'the withdrawn object is no longer tracked as live');
  const tracked = (gone.manifest.orphans ?? []).map((o) => o.collection).sort();
  assert.deepEqual(tracked, [OLD], 'the stale copy is still tracked after its object was withdrawn');
  const dels2 = []; const done = await run([item('b')], gone.manifest, okClient(dels2));
  assert.deepEqual(dels2, [[OLD, 'id-a']]); assert.equal(done.manifest.orphans, undefined);
});

test('F8: an object moved back to the old collection is never deleted by its own stale entry', async () => {
  const first = await run([item('a')], moved(), failingDelete());
  const manifest = { ...first.manifest, objects: { 'id-a': { ...first.manifest.objects['id-a'], collection: 'new.example.kb.resource', atUri: `at://${DID}/new.example.kb.resource/id-a` } } };
  const plan = planPublish({ items: [item('a')], manifest, did: DID, authority: 'old.example.kb' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.orphans, [], 'the stale entry now names the live record: drop it, never delete it');
});
