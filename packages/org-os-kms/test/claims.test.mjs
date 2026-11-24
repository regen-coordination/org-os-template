// packages/org-os-kms/test/claims.test.mjs — claim and supersede (kms plan Task 8).
// A claim is an ordinary object with claim fields, published from the instance's own account only with the node's
// by-name consent date and publish.claims on; it steps aside (held, then the manifest delete) when the node publishes itself.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { claimFloor, reconcileClaims, normalizeUrl, isDate } from '../src/claims.mjs';
import { planPublish } from '../src/atproto/publish.mjs';
import { dispatch } from '../src/cli.mjs';

const AUTH = 'xyz.example.kb';
const NODE_DID = 'did:plc:nodeaaaaaaaaaaaaaaaaaaaa';
const OTHER_DID = 'did:plc:otherbbbbbbbbbbbbbbbbbbb';
beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const claimOrg = (extra = {}) => ({ title: 'Node A', type: 'organization', public_use: 'ok-with-caveat', claim_for: 'https://node-a.example',
  claim_status: 'claimed', consent_atproto: '2026-11-19', ...extra });

function instance({ claims = true, entries = { 'node-a': claimOrg() }, more = {}, publisher = 'ReFi DAO' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kms-claims-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'organization.yaml'), yaml.dump({ entries }));
  for (const [schema, e] of Object.entries(more)) writeFileSync(join(dir, 'data', 'kb', `${schema}.yaml`), yaml.dump({ entries: e }));
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.',
    publish: { base_url: 'https://t.example', ...(claims ? { claims: true, claim_publisher: publisher } : {}) },
    atproto: { did: 'did:plc:me', handle: 'kc.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}
const read = (dir, schema = 'organization') => yaml.load(readFileSync(join(dir, 'data', 'kb', `${schema}.yaml`), 'utf8')).entries;
const fakeClient = (log) => () => ({
  async login() {},
  async putRecord(op) { log.push(['put', op.collection, op.rkey, op.record]); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: 'c' }; },
  async deleteRecord(op) { log.push(['del', op.collection, op.rkey]); },
});
const deps = (log) => ({ createClient: fakeClient(log), env: { ATPROTO_APP_PASSWORD: 'pw' } });
const publish = (dir, log, flags = { apply: true }) => OPS.publish.run({ dir, flags, deps: deps(log) });
const puts = (log) => log.filter((l) => l[0] === 'put');

// An ingested record of the node itself: what a connector stores (sourceUri names the origin record).
const own = (extra = {}) => ({ title: 'Node A (own)', type: 'organization', public_use: 'not-public-yet', maturity: 'raw',
  sourceUri: `at://${NODE_DID}/app.certified.actor.organization/self`, url: 'https://www.Node-A.example/', ...extra });

// ---- the floor ----

test('claimFloor: a claim without consent_atproto is withheld; a missing date, an empty one and a non-date all fail', () => {
  const cfg = { publish: { claims: true, claim_publisher: 'ReFi DAO' } };
  assert.equal(claimFloor(claimOrg(), cfg).ok, true);
  for (const bad of [undefined, '', null, 'yes', 'someday']) {
    const r = claimFloor(claimOrg({ consent_atproto: bad }), cfg);
    assert.equal(r.ok, false, String(bad)); assert.match(r.reason, /consent_atproto/);
  }
});

test('claimFloor: a claim is withheld while publish.claims is off (or anything but true)', () => {
  for (const cfg of [{}, { publish: {} }, { publish: { claims: false } }, { publish: { claims: 'true' } }]) {
    const r = claimFloor(claimOrg(), cfg); assert.equal(r.ok, false, JSON.stringify(cfg)); assert.match(r.reason, /publish\.claims/);
  }
});

test('claimFloor: only a claim in status "claimed" passes; an object with no claim_for is not a claim and is unaffected', () => {
  const cfg = { publish: { claims: true, claim_publisher: 'ReFi DAO' } };
  assert.equal(claimFloor(claimOrg({ claim_status: 'superseded' }), cfg).ok, false);
  assert.equal(claimFloor(claimOrg({ claim_status: undefined }), cfg).ok, false);
  assert.equal(claimFloor({ title: 'X', type: 'organization' }, {}).ok, true);
});

test('publish op: a claim without consent is withheld and counted, and nothing is put', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ consent_atproto: undefined }), plain: { title: 'Plain', type: 'organization', public_use: 'ok-with-caveat' } } });
  const log = []; const res = await publish(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.withheld.claims, 1);
  assert.deepEqual(puts(log).map((p) => p[3].title), ['Plain']);
});

test('publish op: a claim is withheld while publish.claims is off', async () => {
  const dir = instance({ claims: false, entries: { 'node-a': claimOrg(), plain: { title: 'Plain', type: 'organization', public_use: 'ok-with-caveat' } } });
  const log = []; const res = await publish(dir, log);
  assert.equal(res.report.withheld.claims, 1);
  assert.deepEqual(puts(log).map((p) => p[3].title), ['Plain']);
});

test('planPublish fails closed for a claim even when called directly (no config, or no consent)', () => {
  const it = (o) => ({ schema: 'organization', object: { id: 'c1', ...o }, ref: 'data/kb/organization.yaml#node-a' });
  const empty = { version: 1, objects: {} };
  for (const args of [{ publishClaims: false }, {}, { publishClaims: true, claimPublisher: 'ReFi DAO', _o: { consent_atproto: undefined } }]) {
    const o = args._o ? claimOrg(args._o) : claimOrg();
    const plan = planPublish({ items: [it(o)], manifest: empty, did: 'did:plc:me', authority: AUTH, publishClaims: args.publishClaims, claimPublisher: args.claimPublisher });
    assert.equal(plan.ok, false, JSON.stringify(args)); assert.match(plan.errors[0].errors[0], /claim/);
    assert.deepEqual(plan.create, []);
  }
});

test('a claim with consent and publish.claims on publishes: publisher = ReFi DAO, subject = the node; consent date and notes stay home', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ notes: 'private note', claim_node_did: NODE_DID, claim_checked_on: new Date('2026-11-18') }) } });
  const log = []; const res = await publish(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  const [p] = puts(log); assert.equal(p[1], `${AUTH}.organization`);
  const rec = p[3];
  assert.equal(rec.claim_for, 'https://node-a.example'); assert.equal(rec.claim_status, 'claimed');
  assert.equal(rec.claim_node_did, NODE_DID);
  assert.equal(rec.publisher, 'ReFi DAO');
  assert.equal(rec.claim_checked_on, '2026-11-18', 'a yaml date is written as a plain date string');
  assert.ok(!('consent_atproto' in rec), 'the consent date is evidence kept at home, not published');
  assert.ok(!('notes' in rec));
});

test('a claim refuses to publish with no publisher to name (config.publish.claim_publisher absent)', async () => {
  const dir = instance({ publisher: undefined });
  const cfgPath = join(dir, 'kms.yaml'); const c = yaml.load(readFileSync(cfgPath, 'utf8')); delete c.publish.claim_publisher; writeFileSync(cfgPath, yaml.dump(c));
  const log = []; const res = await publish(dir, log);
  assert.equal(res.report.withheld.claims, 1); assert.deepEqual(puts(log), []);
});

test('scrub by value holds for a claim record: a claim naming a private object does not carry it', async () => {
  const dir = instance({
    entries: { 'node-a': claimOrg({ related_resources: ['secret-resource', 'open-resource'], parent: 'secret-resource' }) },
    more: { resource: { 'secret-resource': { title: 'Secret', type: 'resource', public_use: 'internal-only' }, 'open-resource': { title: 'Open', type: 'resource', public_use: 'ok-with-caveat' } } },
  });
  const log = []; const res = await publish(dir, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  const claim = puts(log).map((p) => p[3]).find((r) => r.claim_for);
  assert.ok(claim, 'the claim was published');
  assert.ok(!JSON.stringify(claim).includes('secret-resource'), JSON.stringify(claim));
  // F6: a claim is cut to an allow-list, which has no relation fields, so even the public ref is not carried.
  assert.ok(!('related_resources' in claim) && !('parent' in claim), JSON.stringify(claim));
});

// ---- reconcile ----

test('reconcile supersedes the claim when the node\'s own record is ingested (url match, normalised)', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg(), 'node-a-own': own({ sourceUri: 'at://did:plc:unknownccccccccccccccc/x/self' }) } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.ok, true);
  assert.equal(res.report.superseded.length, 1);
  const c = read(dir)['node-a'];
  assert.equal(c.claim_status, 'superseded'); assert.equal(c.maturity, 'held');
  assert.equal(c.superseded_by, 'at://did:plc:unknownccccccccccccccc/x/self');
  assert.match(c.review_needs, /superseded by the node's own record/);
});

test('reconcile supersedes via the DID when the claim records claim_node_did', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_for: 'https://elsewhere.example', claim_node_did: NODE_DID }), 'node-a-own': own({ url: 'https://different.example' }) } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.report.superseded.length, 1);
  assert.equal(read(dir)['node-a'].claim_status, 'superseded');
});

test('reconcile supersedes EVERY claim of the schema for that node, not one per record', async () => {
  const dir = instance({ entries: {
    'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-2': claimOrg({ title: 'Node A again', claim_node_did: NODE_DID, claim_for: 'https://node-a.example/about' }),
    'node-a-own': own(),
  } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.report.superseded.length, 2);
  assert.deepEqual(Object.values(read(dir)).filter((o) => o.claim_for).map((o) => o.claim_status), ['superseded', 'superseded']);
});

test('reconcile: a different node\'s claim is not touched', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-b': claimOrg({ title: 'Node B', claim_for: 'https://node-b.example', claim_node_did: OTHER_DID }), 'node-a-own': own() } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.report.superseded.length, 1); assert.equal(res.report.unmatched, 1);
  assert.equal(read(dir)['node-b'].claim_status, 'claimed'); assert.ok(!read(dir)['node-b'].superseded_by);
});

test('reconcile: only a claim of the SAME schema is superseded, and a held (retracted) ingested record does not count', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own({ maturity: 'held' }) } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.report.superseded.length, 0, 'a record retracted at origin is not the node speaking for itself');
  const dir2 = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }) }, more: { resource: { r: { title: 'R', type: 'resource', sourceUri: `at://${NODE_DID}/x/y` } } } });
  assert.equal((await reconcileClaims({ dir: dir2, config: loadKmsConfig(dir2) })).report.superseded.length, 0);
});

test('reconcile --dry reports and changes nothing', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own() } });
  const before = readFileSync(join(dir, 'data', 'kb', 'organization.yaml'), 'utf8');
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir), dry: true });
  assert.equal(res.report.superseded.length, 1);
  assert.equal(readFileSync(join(dir, 'data', 'kb', 'organization.yaml'), 'utf8'), before);
});

test('reconcile is idempotent', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own() } });
  await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  const again = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.deepEqual(again.report.superseded, []);
});

test('reconcile never touches the node\'s own record', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own() } });
  const before = read(dir)['node-a-own'];
  await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.deepEqual(read(dir)['node-a-own'], before);
});

test('reconcile refuses in a public plane (it holds only what its canon exported)', async () => {
  const dir = instance(); const c = yaml.load(readFileSync(join(dir, 'kms.yaml'), 'utf8'));
  c.planes = { role: 'public', canon_dir: '../nowhere', regate: false }; writeFileSync(join(dir, 'kms.yaml'), yaml.dump(c));
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.ok, false); assert.match(res.report.error, /public plane/);
});

// ---- supersede -> publish ----

test('after reconcile, publish deletes the claim from ReFi DAO\'s repo via the manifest and leaves the rest', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own(), plain: { title: 'Plain', type: 'organization', public_use: 'ok-with-caveat' } } });
  const log = []; const first = await publish(dir, log);
  assert.equal(first.ok, true, JSON.stringify(first.report));
  assert.deepEqual(puts(log).map((p) => p[3].title).sort(), ['Node A', 'Plain']);
  const claimRkey = puts(log).find((p) => p[3].claim_for)[2];
  await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  const log2 = []; const second = await publish(dir, log2);
  assert.equal(second.ok, true, JSON.stringify(second.report));
  assert.deepEqual(log2.filter((l) => l[0] === 'del').map((l) => l[2]), [claimRkey]);
  assert.equal(second.report.atproto.deleted, 1);
  assert.equal(read(dir)['node-a-own'].title, 'Node A (own)');
});

test('a superseded claim of a shared type is deleted from the shared collection, not the instance namespace', () => {
  const manifest = { version: 1, objects: { c1: { slug: 'need-claim', type: 'need', rkey: 'c1', collection: 'example.commons.need', atUri: 'at://did:plc:me/example.commons.need/c1', cid: 'c', hash: 'h' } } };
  const plan = planPublish({ items: [], manifest, did: 'did:plc:me', authority: AUTH });
  assert.equal(plan.delete.length, 1); assert.equal(plan.delete[0].collection, 'example.commons.need');
});

test('mass-delete guard, op level: superseding the last published claim is refused loudly, deletes nothing, and the report names the guard', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own() } });
  const log = []; const first = await publish(dir, log);
  assert.equal(first.ok, true, JSON.stringify(first.report)); assert.equal(puts(log).length, 1);
  await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  const log2 = []; const res = await publish(dir, log2);
  assert.equal(res.ok, false);
  assert.equal(res.report.atproto.status, 'failed');
  assert.match(res.report.atproto.reason, /refusing to delete every published record/);
  assert.match(res.report.atproto.reason, /superseded claim/, 'names why: the last published record is a superseded claim');
  assert.equal(res.report.atproto.deleted, 0); assert.equal(res.report.atproto.wouldDelete, 1);
  assert.deepEqual(log2.filter((l) => l[0] === 'del'), []);
});

// ---- the op and the verb ----

test('claims.reconcile is registered, an exec op, and bound to no lifecycle event', async () => {
  const { LIFECYCLE_BINDINGS } = await import('../src/bind.mjs');
  assert.ok(OPS['claims.reconcile']); assert.equal(OPS['claims.reconcile'].kind, 'exec');
  for (const ops of Object.values(LIFECYCLE_BINDINGS)) assert.ok(!ops.includes('claims.reconcile'));
});

test('verb: `claims reconcile --dry --dir` routes to the op; an unknown subcommand is an error', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own() } });
  assert.deepEqual(dispatch(['claims', 'reconcile', '--dry', '--dir', dir], { dry: true }).flags, { dry: true, dir });
  const res = await dispatch(['claims', 'reconcile', '--dry', '--dir', dir]);
  assert.equal(res.ok, true); assert.equal(res.report.superseded.length, 1);
  assert.match((await dispatch(['claims', 'bogus', '--dir', dir])).error, /unknown subcommand/);
});

// ---- the export door ----

test('export (selectForPublication) refuses every claim, consented or not: the export policy strips the claim marks, so a claim would arrive looking like the node\'s own record', async () => {
  const { selectForPublication } = await import('../src/planes/select-for-publication.mjs');
  const dir = instance({ entries: { ok: claimOrg({ title: 'With consent' }), 'no-consent': claimOrg({ title: 'No consent', consent_atproto: undefined }),
    half: { title: 'Half a claim', type: 'organization', public_use: 'ok-with-caveat', claim_node_did: NODE_DID },
    plain: { title: 'Plain', type: 'organization', public_use: 'ok-with-caveat' } } });
  const verdicts = new Map(['ok', 'no-consent', 'half', 'plain'].map((s) => [`organization:${s}`, { ok: true }]));
  const on = { publish: { claims: true, claim_publisher: 'ReFi DAO' } };
  for (const config of [on, undefined, {}, { publish: { claims: false } }]) {
    const sel = selectForPublication({ root: dir, verdicts, config });
    assert.deepEqual(sel.selected.map((s) => s.key), ['organization:plain'], JSON.stringify(config));
    assert.deepEqual(sel.floorRejected.map((r) => r.key).sort(), ['organization:half', 'organization:no-consent', 'organization:ok']);
    for (const r of sel.floorRejected) assert.match(r.reason, /claims are not exported/);
  }
});

// ---- F4 (seat-7 fixes): reconcile must not withdraw a claim on a fuzzy match ----

test('normalizeUrl keeps the query and a non-default port; the fragment and a default port are dropped', () => {
  assert.notEqual(normalizeUrl('https://x.example/p?id=1'), normalizeUrl('https://x.example/p?id=2'));
  assert.notEqual(normalizeUrl('https://x.example:8443/p'), normalizeUrl('https://x.example/p'));
  // A fragment is read by the browser and never sent to the server: #a and #b are the same document, so they match.
  assert.equal(normalizeUrl('https://x.example/p#a'), normalizeUrl('https://x.example/p#b'));
  assert.equal(normalizeUrl('https://x.example:443/p'), normalizeUrl('https://x.example/p'));
  assert.equal(normalizeUrl('https://WWW.X.example/p/'), normalizeUrl('x.example/p'));
});

test('reconcile: with claim_node_did set the DID must match; a directory listing the node\'s url withdraws nothing', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }),
    'directory-listing': own({ title: 'Listed by a directory', sourceUri: `at://${OTHER_DID}/app.certified.actor.organization/listing`, url: 'https://node-a.example' }) } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.report.superseded.length, 0); assert.equal(res.report.unmatched, 1);
  assert.equal(read(dir)['node-a'].claim_status, 'claimed');
});

test('reconcile: a url match keeps the query: ?id=1 is not ?id=2', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg({ claim_for: 'https://node-a.example/p?id=1' }), 'other': own({ url: 'https://node-a.example/p?id=2' }) } });
  assert.equal((await reconcileClaims({ dir, config: loadKmsConfig(dir) })).report.superseded.length, 0);
  const dir2 = instance({ entries: { 'node-a': claimOrg({ claim_for: 'https://node-a.example:8443' }), 'other': own({ url: 'https://node-a.example' }) } });
  assert.equal((await reconcileClaims({ dir: dir2, config: loadKmsConfig(dir2) })).report.superseded.length, 0, 'a different port is a different site');
});

test('reconcile: with no DID known a url match still supersedes, and the report says plainly it was url-only', async () => {
  const dir = instance({ entries: { 'node-a': claimOrg(), 'node-a-own': own() } });
  const res = await reconcileClaims({ dir, config: loadKmsConfig(dir) });
  assert.equal(res.report.superseded.length, 1);
  assert.equal(res.report.superseded[0].matched, 'url');
  assert.equal(res.report.urlOnly, 1);
  assert.match(res.report.note, /url-only/);
  const dir2 = instance({ entries: { 'node-a': claimOrg({ claim_node_did: NODE_DID }), 'node-a-own': own() } });
  const r2 = await reconcileClaims({ dir: dir2, config: loadKmsConfig(dir2) });
  assert.equal(r2.report.superseded[0].matched, 'did'); assert.equal(r2.report.urlOnly, 0); assert.equal(r2.report.note, undefined);
});

// ---- F5 (seat-7 fixes): a date is a real calendar date; a claim_for is not just spaces ----

test('isDate: impossible calendar dates are refused, real ones (leap day, a datetime) are not', () => {
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29', '2026-11-00', '2026-11-19T25:00:00Z', 'yes', '', null, undefined, 20261119]) assert.equal(isDate(bad), false, String(bad));
  for (const good of ['2026-02-28', '2024-02-29', '2026-11-19', '2026-11-19T10:30:00Z', new Date('2026-11-19')]) assert.equal(isDate(good), true, String(good));
  assert.equal(isDate(new Date('nope')), false);
});

test('claimFloor: a consent date of 2026-02-31 is not a date', () => {
  const r = claimFloor(claimOrg({ consent_atproto: '2026-02-31' }), { publish: { claims: true, claim_publisher: 'ReFi DAO' } });
  assert.equal(r.ok, false); assert.match(r.reason, /consent_atproto/);
});

test('claimFloor: a claim_for of only whitespace says nothing about what the claim is for', () => {
  const cfg = { publish: { claims: true, claim_publisher: 'ReFi DAO' } };
  for (const blank of ['   ', '\t\n', ' ']) {
    const r = claimFloor(claimOrg({ claim_for: blank }), cfg);
    assert.equal(r.ok, false, JSON.stringify(blank)); assert.match(r.reason, /claim_for/);
  }
  assert.equal(claimFloor(claimOrg({ claim_for: 42 }), cfg).ok, false, 'a claim_for that is not text');
});
