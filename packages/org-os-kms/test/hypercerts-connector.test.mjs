import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { createHypercertsConnector } from '../src/connectors/hypercerts/index.mjs';
import { runConnector, getAdapter } from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/hypercerts/${name}.json`, import.meta.url), 'utf8'));
const flat = (v) => ({ uri: v.uri, cid: v.cid, did: v.did, value: v.record });
const A = 'did:plc:fakeaaaaaaaaaaaaaaaaaaaa'; const B = 'did:plc:fakebbbbbbbbbbbbbbbbbbbb'; const C = 'did:plc:fakecccccccccccccccccccc';
const ME = 'did:plc:fakemeeeeeeeeeeeeeeeeeee';
const ACTS = fx('activities').pages.flatMap((p) => p.activities).map(flat);
const ATTS = fx('attachments').pages.flatMap((p) => p.attachments).map(flat);
const ov = fx('organizations').pages.flatMap((p) => p.actors);
const ORGS = ov.map((a) => ({ ...flat(a.organization), profile: a.profile.record }));
const didOf = (r) => r.uri.split('/')[2];
const uriOf = (rk) => ACTS.concat(ATTS).find((r) => r.uri.endsWith(`/${rk}`)).uri;
const UNTITLED = { uri: `at://${A}/org.hypercerts.claim.activity/3a9`, cid: 'x', did: A, value: { $type: 'org.hypercerts.claim.activity', createdAt: '2026-11-13T10:00:00.000Z' } };

// A scripted client. `state` is mutated between pulls; `server` honours the authors filter unless `ignoreFilter`.
function fakeClientFactory(state) {
  const calls = [];
  const client = {
    async listFollowing(did) { calls.push(['listFollowing', did]); return (state.follows || []).map((d) => ({ did: d })); },
    async listActivities({ authors } = {}) { calls.push(['listActivities', authors]); if (state.failActivities) throw new Error('activities listing failed'); return state.activities.filter((r) => state.ignoreFilter || (authors || []).includes(didOf(r))); },
    async listAttachments({ authors } = {}) { calls.push(['listAttachments', authors]); return state.attachments.filter((r) => state.ignoreFilter || (authors || []).includes(didOf(r))); },
    async getOrganizations(dids) { calls.push(['getOrganizations', dids]); return state.organizations.filter((r) => dids.includes(r.did)); },
  };
  // Only list/get methods exist; any other property access (a write, say) throws.
  const strict = new Proxy(client, { get(t, p) { if (p in t || typeof p === 'symbol' || p === 'then') return t[p]; throw new Error(`the connector touched ${String(p)}`); } });
  const factory = () => strict; factory.calls = calls; return factory;
}
const newState = (over = {}) => ({ follows: [], activities: [...ACTS, UNTITLED], attachments: [...ATTS], organizations: [...ORGS], ...over });

function instance() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-hc-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: {} }));
  writeFileSync(join(dir, 'data', 'kb', 'source-system.yaml'), yaml.dump({ entries: {} }));
  return dir;
}
const all = (dir) => getAdapter('repo-data').list(dir);
const mk = (state) => createHypercertsConnector({ createClient: fakeClientFactory(state) });
const run = (connector, dir, config, cursor, extra = {}) => runConnector(connector, { config, cursor, adapter: 'repo-data', target: dir, ...extra });

test('keeps only in-scope authors', async () => {
  const c = mk(newState({ ignoreFilter: true }));   // a server that ignores the filter must still not leak an out-of-scope record
  const out = await c.pull({ dids: [A] }, { cursor: null });
  assert.ok(out.records.length > 0);
  assert.ok(out.records.every((r) => didOf(r.rec) === A), out.records.map((r) => r.rec.uri).join());
  assert.equal(out.records.filter((r) => r.kind === 'activity').length, 1);   // 3a1 only: 3a2 is a test, 3a9 untitled
});

test('skips test-titled and untitled', async () => {
  const c = mk(newState());
  const out = await c.pull({ dids: [A, B] }, { cursor: null });
  const titles = out.records.filter((r) => r.kind === 'activity').map((r) => r.rec.value.title);
  assert.deepEqual(titles.sort(), ['Bread.lk', 'Community seed library']);
  const orgs = out.records.filter((r) => r.kind === 'organization').map((r) => r.rec.profile.displayName);
  assert.deepEqual(orgs.sort(), ['Alpha Cooperative', 'Bravo Collective']);
  // an attachment about a test-titled activity is dropped with it
  const st = newState({ attachments: [{ ...ATTS[0], uri: `at://${A}/org.hypercerts.context.attachment/9z`, value: { ...ATTS[0].value, subjects: [{ uri: uriOf('3a2') }] } }] });
  assert.equal((await mk(st).pull({ dids: [A] }, { cursor: null })).records.filter((r) => r.kind === 'attachment').length, 0);
});

test('end to end through runConnector (--dry): counts by type, nothing stored', async () => {
  const dir = instance(); const before = all(dir).length;
  const report = await run(mk(newState()), dir, { dids: [A, B] }, null, { dry: true });
  assert.equal(report.dry, true); assert.equal(report.invalid.length, 0, JSON.stringify(report.invalid)); assert.equal(report.collisions, 0);
  // 2 organizations + 2 activities + the update (signal) + the report (claim-evidence); the gallery attachment is pulled but maps to nothing
  assert.equal(report.pulled, 7); assert.equal(report.candidates, 6);
  assert.equal(all(dir).length, before);
  assert.equal(existsSync(join(dir, 'data', 'kms-cursors.json')), false);
});

test('end to end, stored: raw + not-public-yet, and a source-system card that stays internal', async () => {
  const dir = instance();
  const report = await run(mk(newState()), dir, { dids: [A, B] }, null);
  assert.equal(report.stored, report.candidates); assert.ok(report.stored > 0);
  const items = all(dir);
  const bySchema = (s) => items.filter((i) => i.schema === s);
  for (const s of ['organization', 'implementation-record', 'signal', 'claim-evidence']) assert.ok(bySchema(s).length >= 1, s);
  for (const i of items.filter((x) => x.schema !== 'source-system')) {
    assert.equal(i.object.maturity, 'raw'); assert.equal(i.object.public_use, 'not-public-yet'); assert.ok(i.object.sourceUri.startsWith('at://'));
  }
  const card = bySchema('source-system'); assert.equal(card.length, 1); assert.equal(card[0].object.public_use, 'internal-only');
  assert.match(card[0].object.return_path, /api\.hypercerts\.dev/);
});

test('retraction by sourceUri: a vanished in-scope record is held at origin', async () => {
  const dir = instance(); const state = newState(); const c = mk(state);
  const first = await c.pull({ dids: [A] }, { cursor: null });
  await run(c, dir, { dids: [A] }, null);
  state.activities = state.activities.filter((r) => !r.uri.endsWith('/3a1'));
  const second = await c.pull({ dids: [A] }, { cursor: first.cursor });
  assert.deepEqual(second.retracted, [uriOf('3a1')]);
  await run(c, dir, { dids: [A] }, first.cursor);
  const gone = all(dir).find((i) => i.object.sourceUri === uriOf('3a1'));
  assert.equal(gone.object.maturity, 'held');
});

test('unfollowing is not a retraction', async () => {
  const state = newState({ follows: [A, B] }); const c = mk(state);
  const cfg = { follows_of: ME };
  const first = await c.pull(cfg, { cursor: null });
  assert.ok(first.records.some((r) => didOf(r.rec) === B));
  assert.ok(first.cursor.seen.activity.some((u) => u.includes(B)));
  state.follows = [A];
  const second = await c.pull(cfg, { cursor: first.cursor });
  assert.deepEqual(second.retracted, []);
  for (const k of ['organization', 'activity', 'attachment']) assert.ok(second.cursor.seen[k].every((u) => !u.includes(B)), `${k} seen dropped B`);
  assert.ok(second.cursor.seen.activity.some((u) => u.includes(A)));
});

test('a failed listing retracts nothing, and keeps the previous cursor for that collection', async () => {
  const state = newState(); const c = mk(state);
  const first = await c.pull({ dids: [A] }, { cursor: null });
  assert.ok(first.cursor.seen.activity.length > 0);
  state.failActivities = true;
  const second = await c.pull({ dids: [A] }, { cursor: first.cursor });
  assert.deepEqual(second.errors.map((e) => e.collection), ['activity']);
  assert.match(second.errors[0].error, /activities listing failed/);
  assert.deepEqual(second.cursor.seen.activity, first.cursor.seen.activity);
  assert.ok(!second.retracted.some((u) => u.includes('/org.hypercerts.claim.activity/')));
  assert.ok(second.records.some((r) => r.kind === 'attachment'), 'the other collections still ran');
});

test('a failed activity listing does not let attachments about a test activity through', async () => {
  const att = (rk, subject) => ({ ...ATTS[0], uri: `at://${A}/org.hypercerts.context.attachment/${rk}`, value: { ...ATTS[0].value, title: 'Spring update', subjects: [{ uri: subject }] } });
  const ABOUT_TEST = att('5t', uriOf('3a2'));                            // about the test-titled activity
  const ABOUT_GOOD = att('5g', uriOf('3a1'));                            // about an activity the last good listing kept
  const ABOUT_NEW = att('5n', `at://${A}/org.hypercerts.claim.activity/3zz`);   // about an activity nobody has titled yet
  const state = newState({ attachments: [ABOUT_TEST, ABOUT_GOOD, ABOUT_NEW] }); const c = mk(state);
  const first = await c.pull({ dids: [A] }, { cursor: null });
  assert.deepEqual(first.records.filter((r) => r.kind === 'attachment').map((r) => r.rec.uri).sort(), [ABOUT_GOOD.uri, ABOUT_NEW.uri].sort());
  state.failActivities = true;
  const second = await c.pull({ dids: [A] }, { cursor: first.cursor });
  const kept = second.records.filter((r) => r.kind === 'attachment').map((r) => r.rec.uri);
  assert.ok(!kept.includes(ABOUT_TEST.uri), 'attachment about a test activity was kept');
  assert.ok(kept.includes(ABOUT_GOOD.uri), 'attachment about a known good activity is still kept');
  assert.ok(!kept.includes(ABOUT_NEW.uri), 'attachment about an activity that cannot be checked is held');
  // the hold is said in words, not silent
  const note = second.errors.find((e) => e.collection === 'attachment');
  assert.ok(note, JSON.stringify(second.errors));
  assert.match(note.error, /held 2 attachment/); assert.match(note.error, /activity listing failed/);
  // a hold is not a retraction, and the held attachment stays in the cursor
  assert.deepEqual(second.retracted, []);
  assert.ok(second.cursor.seen.attachment.includes(ABOUT_NEW.uri));
});

test('refuses with no scope; ingest.pull reports the connector failed (fail-soft) with that message', async () => {
  const c = mk(newState());
  await assert.rejects(c.pull({}, { cursor: null }), /needs follows_of or dids/);
  const dir = mkdtempSync(join(tmpdir(), 'kms-hc-op-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: {} }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', connectors: [{ name: 'hypercerts', config: {} }] }));
  const res = await OPS['ingest.pull'].run({ dir, deps: { registry: { hypercerts: c } } });
  assert.equal(res.ok, true); assert.equal(res.report.failed, 1);
  assert.equal(res.report.connectors[0].status, 'failed'); assert.match(res.report.connectors[0].error, /needs follows_of or dids/);
});

test('never calls a write: the client the connector uses exposes list/get methods only', async () => {
  const factory = fakeClientFactory(newState());
  const c = createHypercertsConnector({ createClient: factory });
  await c.pull({ dids: [A] }, { cursor: null });
  assert.ok(factory.calls.length >= 3);
  assert.ok(factory.calls.every(([m]) => /^(list|get)/.test(m)));
  assert.deepEqual(c.capabilities, { ingest: true, subscribe: false, publish: false });
});

// ---- F1: a hung activity listing is a listing failure, under the existing half-failed-listing rules ----
test('F1: a hung activities listing fails that collection only: nothing retracted, cursor unchanged', { timeout: 3000 }, async () => {
  const { createHypercertsClient } = await import('../src/connectors/hypercerts/client.mjs');
  const real = { listFollowing: async () => [], listAttachments: async () => [], getOrganizations: async () => [], listActivities: async () => ACTS.filter((r) => didOf(r) === A) };
  const first = await createHypercertsConnector({ createClient: () => real }).pull({ dids: [A] }, { cursor: null });
  const hangClient = createHypercertsClient({ fetchImpl: () => new Promise(() => {}), timeoutMs: 25 });
  const c = createHypercertsConnector({ createClient: (cfg) => ({ ...real, listActivities: () => hangClient.listActivities({ authors: [A] }) }) });
  const out = await c.pull({ dids: [A], timeoutMs: 25 }, { cursor: first.cursor });
  assert.deepEqual(out.retracted, []); assert.deepEqual(out.cursor.seen.activity, first.cursor.seen.activity);
  assert.ok(out.errors.some((e) => e.collection === 'activity' && /timed out/.test(e.error)));
});
