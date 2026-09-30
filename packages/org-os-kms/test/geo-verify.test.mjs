import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIndexed } from '../src/geo/verify.mjs';

const H = (c) => c.repeat(32);
const answer = (map) => async (_url, init) => {
  const id = JSON.parse(init.body).query.match(/entity\(id: "([0-9a-f]{32})"\)/)[1];
  const spaces = map(id);
  return { json: async () => ({ data: { entity: spaces ? { id, spaceIds: spaces } : null } }) };
};

test('all ids indexed in the space on the first round', async () => {
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5'), H('6')], fetchImpl: answer(() => [H('1')]), sleep: async () => {} });
  assert.deepEqual(r, { indexed: [H('5'), H('6')], missing: [] });
});

test('an entity indexed in another space only is still missing; stops at the timeout', async () => {
  let t = 0;
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5'), H('6')], fetchImpl: answer((id) => (id === H('5') ? [H('1')] : [H('9')])),
    intervalMs: 10, timeoutMs: 30, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.deepEqual(r.indexed, [H('5')]); assert.deepEqual(r.missing, [H('6')]);
});

test('an id that appears on a later round is picked up', async () => {
  let round = 0; let t = 0;
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5')], fetchImpl: answer(() => (round++ > 0 ? [H('1')] : null)),
    intervalMs: 10, timeoutMs: 100, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.deepEqual(r.indexed, [H('5')]);
});

test('an empty list returns at once', async () => {
  assert.deepEqual(await verifyIndexed({ api: 'u', space: H('1'), geoIds: [], fetchImpl: () => { throw new Error('no call'); } }), { indexed: [], missing: [] });
});
