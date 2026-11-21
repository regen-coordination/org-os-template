import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScope } from '../src/connectors/hypercerts/scope.mjs';

const A = 'did:plc:fakeaaaaaaaaaaaaaaaaaaaa'; const B = 'did:plc:fakebbbbbbbbbbbbbbbbbbbb'; const C = 'did:web:example.org';
const ME = 'did:plc:fakemeeeeeeeeeeeeeeeeeee';
const clientFollowing = (dids) => { const calls = []; return { calls, async listFollowing(did) { calls.push(did); return dids.map((d) => ({ did: d })); } }; };
const forbidden = () => ({ async listFollowing() { throw new Error('client must not be called'); } });

test('refuses with neither follows_of nor dids, without calling the client', async () => {
  await assert.rejects(resolveScope({}, forbidden()), /hypercerts: config needs follows_of or dids/);
  await assert.rejects(resolveScope({ dids: [] }, forbidden()), /hypercerts: config needs follows_of or dids/);
});

test('unions follows and dids, sorted and de-duplicated', async () => {
  const client = clientFollowing([B, A, B]);
  const scope = await resolveScope({ follows_of: ME, dids: [C, A] }, client);
  assert.deepEqual(scope, [A, B, C].sort());
  assert.deepEqual(client.calls, [ME]);
});

test('dids alone never call the client', async () => {
  assert.deepEqual(await resolveScope({ dids: [B, A] }, forbidden()), [A, B]);
});

test('rejects a value that is not a did:plc: or did:web: DID', async () => {
  await assert.rejects(resolveScope({ dids: ['alice.bsky.social'] }, forbidden()), /not a DID/);
  await assert.rejects(resolveScope({ dids: [`at://${A}/app.bsky.actor.profile/self`] }, forbidden()), /not a DID/);
  await assert.rejects(resolveScope({ follows_of: '@alice' }, forbidden()), /not a DID/);
  await assert.rejects(resolveScope({ follows_of: ME }, clientFollowing(['not-a-did'])), /not a DID/);
});

test('an empty follows list with no dids refuses too: a commons that follows nobody must not read the whole directory', async () => {
  await assert.rejects(resolveScope({ follows_of: ME }, clientFollowing([])), /follows nobody|needs follows_of or dids/);
  assert.deepEqual(await resolveScope({ follows_of: ME, dids: [A] }, clientFollowing([])), [A]);
});
