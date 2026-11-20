// Constellation backlinks: optional enrichment, OFF by default, GET only, fail-soft. No network: every fetch is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createConstellationClient, enrichWithBacklinks, CONSTELLATION_BASE, LINKS_USER_AGENT, ALLOWED_LINK_PARAMS, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_REQUESTS, ConstellationError } from '../src/connectors/hypercerts/links.mjs';
import { createHypercertsConnector } from '../src/connectors/hypercerts/index.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/hypercerts/${n}.json`, import.meta.url), 'utf8'));
const COUNT = fx('constellation-all-count'); const BACK = fx('constellation-backlinks');
const A = 'did:plc:fakeaaaaaaaaaaaaaaaaaaaa';
const ACT1 = `at://${A}/org.hypercerts.claim.activity/3a1`;
const ORG = `at://${A}/app.certified.actor.organization/self`;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// A fake Constellation: records every request, answers from the fixtures. `mode` scripts failures.
function fakeFetch(mode = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    if (mode.throws) throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    if (mode.status) return json({ secret: 'body must never be copied' }, mode.status);
    if (mode.notJson) return { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } };
    const u = new URL(url);
    if (u.pathname === '/links/all/count') return json(mode.empty ? { links: {} } : COUNT);
    if (u.pathname === '/xrpc/blue.microcosm.links.getBacklinks') return json(BACK);
    return json({}, 404);
  };
  impl.calls = calls; return impl;
}

test('client: GET only, the exact path, one target, a generic user agent, no body', async () => {
  const f = fakeFetch(); const c = createConstellationClient({ fetchImpl: f });
  assert.deepEqual(await c.countLinks(ACT1), COUNT.links);
  const { url, init } = f.calls[0];
  assert.equal(url.origin, CONSTELLATION_BASE); assert.equal(url.pathname, '/links/all/count');
  assert.deepEqual([...url.searchParams.keys()], ['target']); assert.equal(url.searchParams.get('target'), ACT1);
  assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.headers['user-agent'], LINKS_USER_AGENT);
  assert.match(LINKS_USER_AGENT, /^org-os-kms \(read-only\)$/);
});

test('client: getBacklinks drops the count path\'s leading dot, clamps limit to 1..100, sends only allowlisted keys', async () => {
  const f = fakeFetch(); const c = createConstellationClient({ fetchImpl: f });
  const out = await c.getBacklinks(ACT1, 'org.hypercerts.context.attachment', '.subjects[].uri', 500);
  assert.equal(out.total, 2); assert.equal(out.records.length, 2);
  const q = f.calls[0].url.searchParams;
  assert.equal(f.calls[0].url.pathname, '/xrpc/blue.microcosm.links.getBacklinks');
  assert.equal(q.get('source'), 'org.hypercerts.context.attachment:subjects[].uri');
  assert.equal(q.get('limit'), '100'); assert.equal(q.get('subject'), ACT1);
  for (const k of q.keys()) assert.ok(ALLOWED_LINK_PARAMS['/xrpc/blue.microcosm.links.getBacklinks'].includes(k), k);
  await c.getBacklinks(ACT1, 'a.b', '.x', 0); assert.equal(f.calls[1].url.searchParams.get('limit'), '1');
});

test('client: refuses a parameter or a path off the allowlist', async () => {
  const c = createConstellationClient({ fetchImpl: fakeFetch() });
  await assert.rejects(c.raw('/links/all/count', { target: ACT1, did: 'x' }), /not allowed/);
  await assert.rejects(c.raw('/links/all', { target: ACT1 }), /not allowed/);
});

test('client: errors say what happened and never copy the response body', async () => {
  for (const mode of [{ status: 500 }, { status: 429 }, { throws: true }, { notJson: true }]) {
    const c = createConstellationClient({ fetchImpl: fakeFetch(mode) });
    await assert.rejects(c.countLinks(ACT1), (e) => /constellation/.test(e.message) && !/secret|body must/.test(e.message));
  }
});

test('enrichWithBacklinks: counts, then one backlinks call per source; stops at the first failure; honours the request cap', async () => {
  const f = fakeFetch(); const c = createConstellationClient({ fetchImpl: f });
  const out = await enrichWithBacklinks(c, [ACT1, ORG], { maxRequests: 50 });
  assert.equal(out.error, undefined);
  assert.deepEqual(Object.keys(out.subjects).sort(), [ACT1, ORG].sort());
  assert.deepEqual(out.subjects[ACT1].counts, COUNT.links);
  assert.equal(out.subjects[ACT1].backlinks['org.hypercerts.context.attachment:.subjects[].uri'].total, 2);
  assert.equal(f.calls.length, 2 * (1 + 2)); assert.ok(f.calls.every((x) => x.init.method === 'GET'));
  const capped = fakeFetch(); const o2 = await enrichWithBacklinks(createConstellationClient({ fetchImpl: capped }), [ACT1, ORG], { maxRequests: 2 });
  assert.equal(capped.calls.length, 2); assert.match(o2.error, /request cap/);
  const bad = fakeFetch({ status: 500 }); const o3 = await enrichWithBacklinks(createConstellationClient({ fetchImpl: bad }), [ACT1, ORG], { maxRequests: 50 });
  assert.equal(bad.calls.length, 1); assert.match(o3.error, /HTTP 500/); assert.deepEqual(o3.subjects, {});
});

// ---- through the connector ----
const stubClient = () => ({
  async listFollowing() { return []; },
  async listActivities() { return [{ uri: ACT1, cid: 'c', did: A, value: { title: 'Community seed library' } }]; },
  async listAttachments() { return []; },
  async getOrganizations() { return [{ uri: ORG, cid: 'c', did: A, value: { legalName: 'Alpha Cooperative' }, profile: { displayName: 'Alpha Cooperative' } }]; },
});
const mkConn = (fetchImpl) => createHypercertsConnector({ createClient: stubClient, createLinks: (cfg) => createConstellationClient({ base: cfg.base, fetchImpl }) });
const guardGlobalFetch = () => { const real = globalThis.fetch; globalThis.fetch = () => { throw new Error('test touched the real network'); }; return () => { globalThis.fetch = real; }; };

test('connector: the flag is OFF by default: no call, no enrichment key', async () => {
  const restore = guardGlobalFetch();
  try {
    for (const cfg of [{ dids: [A] }, { dids: [A], constellation: {} }, { dids: [A], constellation: { enabled: false } }, { dids: [A], constellation: { enabled: 'yes' } }, { dids: [A], constellation: { enabled: 1 } }]) {
      const f = fakeFetch(); const out = await mkConn(f).pull(cfg, { cursor: null });
      assert.equal(f.calls.length, 0, JSON.stringify(cfg)); assert.equal('enrichment' in out, false);
    }
  } finally { restore(); }
});

test('connector: enabled adds enrichment for in-scope activities and organizations and changes nothing else', async () => {
  const restore = guardGlobalFetch();
  try {
    const off = await mkConn(fakeFetch()).pull({ dids: [A] }, { cursor: null });
    const f = fakeFetch(); const on = await mkConn(f).pull({ dids: [A], constellation: { enabled: true } }, { cursor: null });
    const { enrichment, ...rest } = on;
    assert.deepEqual(rest, off);
    assert.deepEqual(Object.keys(enrichment.constellation.subjects).sort(), [ACT1, ORG].sort());
    assert.ok(f.calls.every((x) => x.init.method === 'GET' && x.url.origin === CONSTELLATION_BASE));
  } finally { restore(); }
});

test('connector: any Constellation failure falls back to the plain reads, and says so only in the enrichment', async () => {
  const restore = guardGlobalFetch();
  try {
    const off = await mkConn(fakeFetch()).pull({ dids: [A] }, { cursor: null });
    for (const mode of [{ status: 500 }, { status: 429 }, { throws: true }, { notJson: true }]) {
      const f = fakeFetch(mode); const on = await mkConn(f).pull({ dids: [A], constellation: { enabled: true } }, { cursor: null });
      const { enrichment, ...rest } = on;
      assert.deepEqual(rest, off, JSON.stringify(mode));           // records, retracted, cursor and errors are exactly the flag-off ones
      assert.ok(enrichment.constellation.error); assert.equal(f.calls.length, 1);   // stopped at the first failure
    }
  } finally { restore(); }
});

test('connector: "no links seen" (an empty answer) never retracts anything', async () => {
  const restore = guardGlobalFetch();
  try {
    const first = await mkConn(fakeFetch()).pull({ dids: [A] }, { cursor: null });
    const on = await mkConn(fakeFetch({ empty: true })).pull({ dids: [A], constellation: { enabled: true } }, { cursor: first.cursor });
    assert.deepEqual(on.retracted, []); assert.deepEqual(on.cursor, first.cursor);
    assert.deepEqual(on.enrichment.constellation.subjects[ACT1].counts, {});
  } finally { restore(); }
});

test('connector: a Constellation base other than the default is passed through (free config, documented)', async () => {
  const seen = []; const c = createHypercertsConnector({ createClient: stubClient, createLinks: (cfg) => { seen.push(cfg.base); return createConstellationClient({ base: cfg.base, fetchImpl: fakeFetch() }); } });
  await c.pull({ dids: [A], constellation: { enabled: true } }, { cursor: null });
  await c.pull({ dids: [A], constellation: { enabled: true, base: 'https://c.example.test' } }, { cursor: null });
  assert.deepEqual(seen, [undefined, 'https://c.example.test']);
});

// ---- F1: a per-request timeout (a hung server must not stall the pull) ----
const hang = () => { const f = () => new Promise(() => {}); f.calls = 0; return f; };   // never settles, ignores the abort signal

test('F1 client: a request that never settles is cut off after timeoutMs and says so', { timeout: 3000 }, async () => {
  const c = createConstellationClient({ fetchImpl: hang(), timeoutMs: 25 });
  await assert.rejects(c.countLinks(ACT1), (e) => e.name === 'ConstellationError' && /timed out after 25 ms/.test(e.message));
});

test('F1 client: the request carries an abort signal, and the default timeout is about 10 s', { timeout: 3000 }, async () => {
  let signal; const c = createConstellationClient({ fetchImpl: async (u, init) => { signal = init.signal; return json(COUNT); } });
  await c.countLinks(ACT1);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(DEFAULT_TIMEOUT_MS, 10_000);
});

test('F1 connector: a hung Constellation falls back to the plain reads and says so only in the enrichment', { timeout: 3000 }, async () => {
  const restore = guardGlobalFetch();
  try {
    const off = await mkConn(fakeFetch()).pull({ dids: [A] }, { cursor: null });
    const c = createHypercertsConnector({ createClient: stubClient, createLinks: (cfg) => createConstellationClient({ base: cfg.base, fetchImpl: hang(), timeoutMs: cfg.timeoutMs }) });
    const on = await c.pull({ dids: [A], constellation: { enabled: true, timeoutMs: 25 } }, { cursor: null });
    const { enrichment, ...rest } = on;
    assert.deepEqual(rest, off); assert.match(enrichment.constellation.error, /timed out/);
  } finally { restore(); }
});

// ---- F5: the default request cap is 50 ----
test('F5: without options the cap is 50 requests: one count, then 49 backlink calls, then it says so', async () => {
  const paths = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`.p${i}[].uri`, 1]));
  const calls = []; const client = { countLinks: async () => { calls.push('count'); return { 'a.b.c': paths }; }, getBacklinks: async () => { calls.push('back'); return { total: 0, records: [] }; } };
  const out = await enrichWithBacklinks(client, [ACT1, ORG]);
  assert.equal(DEFAULT_MAX_REQUESTS, 50); assert.equal(calls.length, 50); assert.equal(out.requests, 50);
  assert.match(out.error, /request cap \(50\) reached/); assert.deepEqual(out.subjects, {});
});
