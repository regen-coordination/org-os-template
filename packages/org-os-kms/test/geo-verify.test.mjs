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

test('a fetch that rejects on the first round and answers on the second → the id ends up indexed, no throw', async () => {
  let round = 0; let t = 0;
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5')], fetchImpl: async (_url, init) => {
    const id = JSON.parse(init.body).query.match(/entity\(id: "([0-9a-f]{32})"\)/)[1];
    if (round++ === 0) throw new Error('DNS failure');
    return { json: async () => ({ data: { entity: { id, spaceIds: [H('1')] } } }) };
  }, intervalMs: 10, timeoutMs: 100, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.deepEqual(r.indexed, [H('5')]);
  assert.deepEqual(r.missing, []);
});

test('a fetch that always rejects → { indexed: [], missing: [id] } after timeout, no throw', async () => {
  let t = 0;
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5')], fetchImpl: async () => {
    throw new Error('connection reset');
  }, intervalMs: 10, timeoutMs: 30, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.deepEqual(r.indexed, []);
  assert.deepEqual(r.missing, [H('5')]);
});

test('deadline checked inside a round: 3 ids, fake now advances past timeoutMs after first request → fewer than 3 requests, remaining ids in missing', async () => {
  let t = 0;
  let requestCount = 0;
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5'), H('6'), H('7')], fetchImpl: answer(() => {
    requestCount++;
    return [H('1')];
  }), intervalMs: 10, timeoutMs: 50, sleep: async (ms) => { t += ms; }, now: () => {
    // Advance time past timeout after the first request
    if (requestCount === 1) t = 60;
    return t;
  } });
  assert(requestCount < 3, `expected fewer than 3 requests, got ${requestCount}`);
  assert(r.missing.length > 0, 'expected remaining ids in missing');
});

test('the fetch init carries a signal (AbortSignal)', async () => {
  let signalSeen = false;
  await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5')], fetchImpl: async (_url, init) => {
    signalSeen = init.signal instanceof AbortSignal;
    throw new Error('stop early');
  }, intervalMs: 10, timeoutMs: 50, sleep: async () => {} });
  assert(signalSeen, 'expected fetch init to contain a signal property that is an AbortSignal');
});

test('ids that are not 32-hex are never queried and are reported as invalid', async () => {
  const asked = [];
  const r = await verifyIndexed({ api: 'u', space: H('1'), geoIds: [H('5'), '") { x }'], fetchImpl: async (_u, init) => { asked.push(init.body); return { json: async () => ({ data: { entity: { id: H('5'), spaceIds: [H('1')] } } }) }; }, sleep: async () => {} });
  assert.equal(asked.length, 1); assert.ok(!asked[0].includes('{ x }'));
  assert.deepEqual(r, { indexed: [H('5')], missing: [], invalid: ['") { x }'] });
});
