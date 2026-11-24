import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTestTitle, leafletText, mapRecord } from '../src/connectors/hypercerts/map.mjs';
import * as fw from '../src/framework.mjs';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/hypercerts/${name}.json`, import.meta.url), 'utf8'));
const flat = (v) => ({ uri: v.uri, cid: v.cid, did: v.did, value: v.record });
const acts = fx('activities').pages.flatMap((p) => p.activities).map(flat);
const atts = fx('attachments').pages.flatMap((p) => p.attachments).map(flat);
const orgView = fx('organizations-by-did').organizations[0].organization;
const org = { ...flat(orgView.organization), profile: orgView.profile.record };
const A = 'did:plc:fakeaaaaaaaaaaaaaaaaaaaa';
const ACT1 = `at://${A}/org.hypercerts.claim.activity/3a1`;
const byRk = (list, rk) => list.find((r) => r.uri.endsWith(`/${rk}`));

function one(args, schema) {
  const out = mapRecord(args); assert.equal(out.length, 1);
  assert.equal(out[0].schema, schema); assert.equal(out[0].object.type, schema);
  const v = fw.validateObject(schema, out[0].object);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  return out[0].object;
}

test('organization → organization (title from the profile name, org_type, url, sourceUri)', () => {
  const o = one({ kind: 'organization', rec: org }, 'organization');
  assert.equal(o.title, 'Alpha Cooperative'); assert.equal(o.org_type, 'cooperative');
  assert.equal(o.url, 'https://example.org/alphacooperative'); assert.equal(o.sourceUri, org.uri);
});

test('activity → implementation-record (self-report, in-progress, context cut to 400, sourceUri)', () => {
  const o = one({ kind: 'activity', rec: byRk(acts, '3a1') }, 'implementation-record');
  assert.equal(o.title, 'Community seed library'); assert.equal(o.source_position, 'self-report'); assert.equal(o.record_stage, 'in-progress');
  assert.equal(o.context, 'A seed library run by neighbours.'); assert.equal(o.sourceUri, ACT1);
  const long = { ...byRk(acts, '3a1'), value: { ...byRk(acts, '3a1').value, shortDescription: undefined, description: { $type: 'org.hypercerts.defs#descriptionString', value: 'x'.repeat(900) } } };
  assert.equal(mapRecord({ kind: 'activity', rec: long })[0].object.context.length, 400);
});

test('attachment evidence|report|audit → claim-evidence (claim, evidence, neutral)', () => {
  const rec = byRk(atts, '4a2');
  const o = one({ kind: 'attachment', rec, activityTitles: new Map([[ACT1, 'Community seed library']]) }, 'claim-evidence');
  assert.equal(o.title, 'report for Community seed library'); assert.equal(o.claim, 'attached as report to Community seed library');
  assert.equal(o.evidence, rec.uri); assert.equal(o.evidence_stance, 'neutral'); assert.equal(o.sourceUri, rec.uri);
  for (const ct of ['evidence', 'audit']) {
    const r2 = { ...rec, value: { ...rec.value, contentType: ct } };
    assert.equal(mapRecord({ kind: 'attachment', rec: r2 })[0].schema, 'claim-evidence');
  }
});

test('attachment update → signal (signal_type implementation, notes from the body)', () => {
  const rec = byRk(atts, '4a1');
  const o = one({ kind: 'attachment', rec, activityTitles: new Map([[ACT1, 'Community seed library']]) }, 'signal');
  assert.equal(o.title, 'update on Community seed library'); assert.equal(o.signal_type, 'implementation');
  assert.match(o.notes, /^First paragraph\./); assert.equal(o.sourceUri, rec.uri);
});

test('isTestTitle: test, QA, e2e, demo and untitled are tests; real names are not', () => {
  assert.equal(isTestTitle('E2E write-through test'), true);
  assert.equal(isTestTitle('🤖 E2E write-through test UPDATED 2026-11-20'), true);
  assert.equal(isTestTitle('QA Test Org'), true); assert.equal(isTestTitle('Demo day'), true);
  assert.equal(isTestTitle(undefined), true); assert.equal(isTestTitle('   '), true);
  assert.equal(isTestTitle('Bread.lk'), false); assert.equal(isTestTitle('Desert Refillery'), false);
  assert.equal(isTestTitle('Greenpill Brasil'), false);
});

test('a gallery attachment maps to nothing', () => {
  assert.deepEqual(mapRecord({ kind: 'attachment', rec: byRk(atts, '4b1') }), []);
  for (const ct of ['photo', 'audio', 'soundscape', 'comment', 'receipts']) {
    const rec = byRk(atts, '4b1'); assert.deepEqual(mapRecord({ kind: 'attachment', rec: { ...rec, value: { ...rec.value, contentType: ct } } }), []);
  }
});

test('a funding receipt is never mapped, and no mapped object carries donor, wallet or receipt keys', () => {
  assert.deepEqual(mapRecord({ kind: 'receipt', rec: { uri: 'at://did:plc:x/org.hypercerts.funding.receipt/1', value: { from: 'did:plc:donor', amount: '5' } } }), []);
  const all = [mapRecord({ kind: 'organization', rec: org }), mapRecord({ kind: 'activity', rec: byRk(acts, '3a1') }),
    mapRecord({ kind: 'attachment', rec: byRk(atts, '4a1') }), mapRecord({ kind: 'attachment', rec: byRk(atts, '4a2') })].flat();
  assert.equal(all.length, 4);
  for (const { object } of all) assert.ok(Object.keys(object).every((k) => !/donor|wallet|receipt/i.test(k)), Object.keys(object).join());
});

test('langs are carried into notes, not a field', () => {
  const o = mapRecord({ kind: 'attachment', rec: byRk(atts, '4a1') })[0].object;
  assert.match(o.notes, /\n\[langs: ml, en\]$/); assert.equal(o.langs, undefined);
  const noLangs = byRk(atts, '4a1'); const bare = { ...noLangs, value: { ...noLangs.value, langs: undefined } };
  assert.doesNotMatch(mapRecord({ kind: 'attachment', rec: bare })[0].object.notes, /langs/);
});

test('a Malayalam body survives', () => {
  const o = mapRecord({ kind: 'attachment', rec: byRk(atts, '4a1') })[0].object;
  assert.ok(o.notes.includes('മലയാളം ടെസ്റ്റ്'));
  assert.equal(leafletText({ $type: 'pub.leaflet.pages.linearDocument', blocks: [{ block: { plaintext: 'ക' } }] }), 'ക');
});

test('an attachment uses the activity title from activityTitles and falls back to the URI', () => {
  const rec = byRk(atts, '4a1');
  assert.equal(mapRecord({ kind: 'attachment', rec, activityTitles: new Map([[ACT1, 'Seeds']]) })[0].object.title, 'update on Seeds');
  assert.equal(mapRecord({ kind: 'attachment', rec, activityTitles: new Map() })[0].object.title, `update on ${ACT1}`);
  assert.equal(mapRecord({ kind: 'attachment', rec })[0].object.title, `update on ${ACT1}`);
});

test('every mapped object has title and type, and none sets maturity, public_use or ai_assisted', () => {
  const all = [mapRecord({ kind: 'organization', rec: org }), mapRecord({ kind: 'activity', rec: byRk(acts, '3a1') }),
    mapRecord({ kind: 'attachment', rec: byRk(atts, '4a1') }), mapRecord({ kind: 'attachment', rec: byRk(atts, '4a2') })].flat();
  for (const { schema, object } of all) {
    assert.ok(object.title && object.type === schema);
    for (const k of ['maturity', 'public_use', 'ai_assisted']) assert.equal(object[k], undefined);
  }
});

test('leafletText: plain strings pass through; nested blocks are read in order; junk gives an empty string', () => {
  assert.equal(leafletText('plain'), 'plain');
  assert.equal(leafletText(undefined), ''); assert.equal(leafletText({ blocks: 'nope' }), '');
  assert.equal(leafletText({ blocks: [{ block: { plaintext: 'a' } }, { block: { $type: 'pub.leaflet.blocks.image' } }, { block: { plaintext: 'b' } }] }), 'a\n\nb');
});
