import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHypercertsClient, call, ALLOWED_PARAMS, HypercertsError } from '../src/connectors/hypercerts/client.mjs';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/hypercerts/${name}.json`, import.meta.url), 'utf8'));
const A = 'did:plc:fakeaaaaaaaaaaaaaaaaaaaa'; const B = 'did:plc:fakebbbbbbbbbbbbbbbbbbbb';

// A fake fetch: serves `pages` for an operation in order (keyed by the cursor it was asked for) and records every request.
function fakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    const u = new URL(url); const op = u.pathname.replace('/xrpc/', '');
    const r = routes[op]; if (!r) return { ok: false, status: 404, async json() { return {}; }, async text() { return 'no route'; } };
    if (typeof r === 'function') return r(u);
    const cur = u.searchParams.get('cursor'); const i = cur ? r.pages.findIndex((p) => p.cursor === cur) + 1 : 0;
    return { ok: true, status: 200, async json() { return r.pages[i]; } };
  };
  return { fetchImpl, requests };
}
const routes = () => ({
  'app.certified.graph.listActorFollowing': fx('following'),
  'org.hypercerts.claim.listActivities': fx('activities'),
  'org.hypercerts.context.listAttachments': fx('attachments'),
  'app.certified.actor.listOrganizations': fx('organizations'),
  'app.certified.actor.getOrganizations': () => ({ ok: true, status: 200, async json() { return fx('organizations-by-did'); } }),
});

test('pages until the cursor runs out', async () => {
  const { fetchImpl, requests } = fakeFetch(routes());
  const client = createHypercertsClient({ fetchImpl });
  const recs = await client.listActivities();
  assert.deepEqual(recs.map((r) => r.uri.split('/').pop()), ['3a1', '3a2', '3b1', '3c1']);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).searchParams.get('cursor'), 'cur-a1');
  // a record is { uri, cid, did, value } whatever the view wrapper looked like
  assert.equal(recs[0].did, A); assert.equal(recs[0].value.title, 'Community seed library'); assert.ok(recs[0].cid);
});

test('only sends allowlisted parameters', async () => {
  const { fetchImpl, requests } = fakeFetch(routes());
  const client = createHypercertsClient({ fetchImpl, pageSize: 50 });
  await client.listFollowing(A); await client.listActivities({ authors: [A, B] }); await client.listAttachments({ authors: [A] });
  await client.listOrganizations(); await client.getOrganizations([A]);
  assert.ok(requests.length >= 5);
  for (const r of requests) {
    const u = new URL(r.url); const op = u.pathname.replace('/xrpc/', '');
    assert.ok(ALLOWED_PARAMS[op], `${op} has an allowlist`);
    assert.ok([...u.searchParams.keys()].every((k) => ALLOWED_PARAMS[op].includes(k)), `${op}: ${[...u.searchParams.keys()]}`);
  }
  // arrays go as repeated, unbracketed values (the contract's form/explode style)
  const act = new URL(requests.find((r) => r.url.includes('listActivities')).url);
  assert.deepEqual(act.searchParams.getAll('authors'), [A, B]);
  assert.equal(act.searchParams.get('limit'), '50');
});

test('refuses an unknown parameter before fetching', async () => {
  let called = 0; const fetchImpl = async () => { called++; return { ok: true, status: 200, async json() { return {}; } }; };
  await assert.rejects(call(fetchImpl, 'https://api.hypercerts.dev', 'org.hypercerts.claim.listActivities', { bogus: 1 }), /not allowed/);
  await assert.rejects(call(fetchImpl, 'https://api.hypercerts.dev', 'org.hypercerts.claim.createActivity', {}), /not allowed/);
  assert.equal(called, 0);
});

test('maps HTTP errors without leaking the response body', async () => {
  const body = 'script_error: lua stack traceback: [string "..."]:12: in function <...>';
  const fetchImpl = async () => ({ ok: false, status: 500, async json() { return { error: body }; }, async text() { return body; } });
  const client = createHypercertsClient({ fetchImpl });
  await assert.rejects(client.listActivities(), (e) => e instanceof HypercertsError && e.status === 500 && !/lua|traceback|script_error/.test(e.message) && /500/.test(e.message));
});

test('is GET-only', async () => {
  const { fetchImpl, requests } = fakeFetch(routes());
  const client = createHypercertsClient({ fetchImpl });
  await client.listFollowing(A); await client.listActivities(); await client.listAttachments(); await client.listOrganizations(); await client.getOrganizations([A]);
  assert.ok(requests.length >= 5);
  for (const r of requests) assert.ok(!r.init || !r.init.method || r.init.method === 'GET');
  assert.deepEqual(Object.keys(client).sort(), ['getOrganizations', 'listActivities', 'listAttachments', 'listFollowing', 'listOrganizations']);
});

test('normalises the view wrappers to { uri, cid, did, value }', async () => {
  const { fetchImpl } = fakeFetch(routes());
  const client = createHypercertsClient({ fetchImpl });
  const follows = await client.listFollowing(A);
  assert.deepEqual(follows.map((f) => f.did), [A, B]);
  const orgs = await client.getOrganizations([A, 'did:plc:fakecccccccccccccccccccc']);
  assert.equal(orgs.length, 1, 'an actor with no organization record yields nothing');
  assert.equal(orgs[0].uri, `at://${A}/app.certified.actor.organization/self`);
  assert.equal(orgs[0].value.legalName, 'Alpha Cooperative SCCL');
  assert.equal(orgs[0].profile.displayName, 'Alpha Cooperative');
  const atts = await client.listAttachments();
  assert.equal(atts[0].value.contentType, 'update');
});

test('refuses a response that is not the shape the contract promises', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return { surprise: true }; } });
  await assert.rejects(createHypercertsClient({ fetchImpl }).listActivities(), /unexpected response/);
});

test('stops a cursor that does not move', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return { activities: [], cursor: 'same' }; } });
  await assert.rejects(createHypercertsClient({ fetchImpl }).listActivities(), /cursor/);
});
