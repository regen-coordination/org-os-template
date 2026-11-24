// packages/org-os-kms/test/visibility.test.mjs — the visibility floor: core enforces what a gated pack declares (kms plan Task 7).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from '../src/framework.mjs';
import { OPS } from '../src/ops.mjs';
import { resetRegistryBindings } from '../src/bind.mjs';
import { loadKmsConfig } from '../src/config.mjs';
import { visibilityFloor, publishRequires, scrubUnpublishedRefs } from '../src/visibility.mjs';
import { planPublish } from '../src/atproto/publish.mjs';
import { loadSharedLexicons } from '../src/pack-publish.mjs';

const AUTH = 'xyz.example.kb';
const need = (visibility) => ({ id: 'n1', title: 'Need', type: 'need', category: 'Tools and tech', text: 'x', public_use: 'ok-with-caveat', ...(visibility ? { visibility } : {}) });

beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

function instance({ gate = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vis-'));
  mkdirSync(join(dir, 'data', 'kb'), { recursive: true });
  writeFileSync(join(dir, 'data', 'kb', 'resource.yaml'), yaml.dump({ entries: { a: { title: 'A', type: 'resource', public_use: 'ok-with-caveat' } } }));
  writeFileSync(join(dir, 'data', 'kb', 'need.yaml'), yaml.dump({ entries: { 'm-need': { ...need('matching-only'), id: undefined } } }));
  if (gate) writeFileSync(join(dir, 'gate.mjs'), 'export function isPublishable(){ return { ok: true }; }');
  writeFileSync(join(dir, 'kms.yaml'), yaml.dump({ instance: 't', adapter: 'repo-data', target: '.', extensions: ['org-os-needs-offers'],
    publish: { base_url: 'https://t.example', types_opt_in: ['need'], ...(gate ? { gate: 'gate.mjs' } : {}) },
    atproto: { did: 'did:plc:me', handle: 'x.test', pds: 'https://pds.test', nsid_authority: AUTH } }));
  return dir;
}

test('public passes', () => { loadKmsConfig(instance()); assert.equal(visibilityFloor(need('public'), 'need').ok, true); });
test('matching-only is refused', () => { loadKmsConfig(instance()); const r = visibilityFloor(need('matching-only'), 'need'); assert.equal(r.ok, false); assert.match(r.reason, /visibility/); });
test('private is refused', () => { loadKmsConfig(instance()); assert.equal(visibilityFloor(need('private'), 'need').ok, false); });
test('missing visibility is refused, not passed', () => { loadKmsConfig(instance()); assert.equal(visibilityFloor(need(), 'need').ok, false); });
test('a schema with no requirement passes (a core resource)', () => {
  loadKmsConfig(instance());
  assert.equal(visibilityFloor({ title: 'R', type: 'resource' }, 'resource').ok, true);
  assert.deepEqual(Object.keys(publishRequires()).sort(), ['need', 'offer']);
});

test('planPublish fails closed for a matching-only item even when called directly', async () => {
  const config = loadKmsConfig(instance());
  const plan = planPublish({ items: [{ schema: 'need', object: need('matching-only'), ref: 'data/kb/need.yaml#m-need' }], manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH, shared: await loadSharedLexicons(config.packs) });
  assert.equal(plan.ok, false); assert.deepEqual(plan.create, []);
  assert.match(plan.errors[0].errors[0], /^visibility floor:/);
});

test('an instance gate that returns { ok: true } for everything does not widen it', async () => {
  const dir = instance({ gate: true }); const log = [];
  const client = () => ({ async login() {}, async putRecord(op) { log.push(op.collection); return { uri: `at://x/${op.collection}/${op.rkey}`, cid: 'c' }; }, async deleteRecord() {} });
  const res = await OPS.publish.run({ dir, flags: { apply: true }, deps: { createClient: client, env: { ATPROTO_APP_PASSWORD: 'pw' }, allowPlaceholderLexicons: true } });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(log, [`${AUTH}.resource`]);
  assert.equal(res.report.withheld.visibility, 1);
});

// ── scrubUnpublishedRefs (spec 6.3: a public record never names an object that is not itself public) ──
const it = (schema, slug, object = {}) => ({ schema, ref: `data/kb/${schema}.yaml#${slug}`, object: { title: slug, type: schema, ...object } });
const A = 'at://did:plc:other/xyz.example.kb.resource/abc';

test('scrub: drops slug, id and type:slug refs to an unselected local object from related and every ref array; keeps the rest', () => {
  const pubNeed = it('need', 'p-need', { id: 'id-p' });
  const m = it('need', 'm-need', { id: 'id-m' });
  const r = it('resource', 'r', { related: ['m-need', 'need:m-need', 'id-m', 'p-need', 'need:p-need', 'id-p', A, 'nowhere'],
    related_concepts: ['m-need'], related_options: ['id-m', 'p-need'], related_resources: ['need:m-need'], source_traditions: ['m-need', 'nowhere'] });
  const out = scrubUnpublishedRefs([r, pubNeed], [r, pubNeed, m]);
  assert.deepEqual(out[0].object.related, ['p-need', 'need:p-need', 'id-p', A, 'nowhere']);
  assert.deepEqual(out[0].object.related_concepts, []);
  assert.deepEqual(out[0].object.related_options, ['p-need']);
  assert.deepEqual(out[0].object.related_resources, []);
  assert.deepEqual(out[0].object.source_traditions, ['nowhere']);
  assert.deepEqual(r.object.related.slice(0, 2), ['m-need', 'need:m-need'], 'the input is not mutated');
  assert.equal(out[1], pubNeed, 'an item with nothing to scrub is returned as is');
});

test('scrub: a bare slug that names a selected AND an unselected object is ambiguous and dropped; the typed form of the selected one stays', () => {
  const pr = it('resource', 'dup'); const hidden = it('need', 'dup'); const r = it('resource', 'r', { related: ['dup', 'resource:dup', 'need:dup'] });
  assert.deepEqual(scrubUnpublishedRefs([r, pr], [r, pr, hidden])[0].object.related, ['resource:dup']);
});

test('scrub: with no `all` there is nothing known to hide, so nothing is dropped', () => {
  const r = it('resource', 'r', { related: ['whatever'] });
  assert.deepEqual(scrubUnpublishedRefs([r])[0].object.related, ['whatever']);
});

test('scrub BY VALUE: an unlisted field (superseded_by, supersedes, parent, see_also, a nested object) loses a non-public slug, id or type:slug', () => {
  const pubNeed = it('need', 'p-need', { id: 'id-p' });
  const m = it('need', 'm-need', { id: 'id-m' });
  const r = it('resource', 'r', {
    superseded_by: 'm-need', supersedes: ['need:m-need', 'p-need'], parent: 'id-m', see_also: ['m-need', A, 'nowhere'], kept_scalar: 'p-need',
    nested: { cites: ['id-m', 'p-need'], deeper: [{ about: 'need:m-need', label: 'x' }, ['m-need', 'nowhere']], solo: 'm-need' },
  });
  const o = scrubUnpublishedRefs([r, pubNeed], [r, pubNeed, m])[0].object;
  assert.equal('superseded_by' in o, false, 'a scalar naming a non-public object is dropped, key and all');
  assert.deepEqual(o.supersedes, ['p-need']);
  assert.equal('parent' in o, false);
  assert.deepEqual(o.see_also, [A, 'nowhere']);
  assert.equal(o.kept_scalar, 'p-need', 'a scalar naming a public object stays');
  assert.deepEqual(o.nested, { cites: ['p-need'], deeper: [{ label: 'x' }, ['nowhere']] });
  assert.equal(JSON.stringify(r.object).includes('"m-need"'), true, 'the input is not mutated');
});

test('scrub BY VALUE: free text is out of scope (only exact equality is removed)', () => {
  const m = it('need', 'm-need'); const r = it('resource', 'r', { notes: 'see m-need for more', related: ['m-need'] });
  const o = scrubUnpublishedRefs([r], [r, m])[0].object;
  assert.equal(o.notes, 'see m-need for more'); assert.deepEqual(o.related, []);
});

test('scrub BY VALUE: the item\'s own id, slug, type and title are never touched while they equal the slug it is filed under, even when a hidden object has that slug', () => {
  const hidden = { ...it('need', 'dup', { id: 'dup' }) };
  const r = { schema: 'resource', ref: 'data/kb/resource.yaml#dup', object: { id: 'dup', slug: 'dup', type: 'dup', title: 'dup', related: ['dup'], parent: 'dup' } };
  const o = scrubUnpublishedRefs([r], [r, hidden])[0].object;
  assert.deepEqual([o.id, o.slug, o.type, o.title], ['dup', 'dup', 'dup', 'dup']);
  assert.deepEqual(o.related, []); assert.equal('parent' in o, false, 'a non-identity field with the same value is still scrubbed');
});

test('scrub BY VALUE: a field whose schema declares an enum or an axis keeps its value, even when it equals a hidden slug (the collision case)', () => {
  // option-entry.category is `enum: [governance, …]`; `maturity` is an axis-backed K1 field. A private object slugged like either must not eat the value.
  const hidden = it('need', 'governance'); const hiddenM = it('need', 'reviewed');
  const r = { schema: 'option-entry', ref: 'data/kb/option-entry.yaml#o', object: { title: 'o', type: 'option-entry', category: 'governance', maturity: 'reviewed', see_also: ['governance'], parent: 'reviewed' } };
  const o = scrubUnpublishedRefs([r], [r, hidden, hiddenM])[0].object;
  assert.equal(o.category, 'governance'); assert.equal(o.maturity, 'reviewed');
  assert.deepEqual(o.see_also, []); assert.equal('parent' in o, false, 'the same value in an undeclared field is a ref and goes');
});

// ── Round 4: the exempt fields are checked against their vocabulary; the lookup is normalised; keys are tested; the drop is counted ──
const res4 = (extra) => ({ schema: 'resource', ref: 'data/kb/resource.yaml#r', object: { title: 'r', type: 'resource', ...extra } });

test('scrub round 4 (1): an enum field keeps a value only when it is IN the declared enum; one outside it is scrubbed like any value', () => {
  const m = it('need', 'm-need'); const act = it('need', 'active');
  const o = scrubUnpublishedRefs([res4({ link_status: 'm-need' })], [res4({}), m])[0].object;
  assert.equal('link_status' in o, false, 'link_status: m-need is not in the enum, so it is a ref and goes');
  const kept = scrubUnpublishedRefs([res4({ link_status: 'active' })], [res4({}), act])[0].object;
  assert.equal(kept.link_status, 'active', 'a value in the enum survives a colliding private slug');
});

test('scrub round 4 (1): an axis field keeps a value only when it is in the axis list (maturity, lifecycle_state)', () => {
  const m = it('need', 'm-need', { id: 'id-private-1' }); const rev = it('need', 'reviewed');
  const o = scrubUnpublishedRefs([res4({ maturity: 'm-need', lifecycle_state: 'id-private-1' })], [res4({}), m])[0].object;
  assert.equal('maturity' in o, false); assert.equal('lifecycle_state' in o, false);
  const kept = scrubUnpublishedRefs([res4({ maturity: 'reviewed' })], [res4({}), rev])[0].object;
  assert.equal(kept.maturity, 'reviewed');
});

test('scrub round 4 (2, 3): the lookup trims and lower-cases both sides (" m-need ", "m-need\n", "M-NEED", a mixed-case private slug)', () => {
  const m = it('need', 'm-need'); const mixed = it('need', 'Mixed-Slug', { id: 'ID-Mixed' });
  const r = res4({ related: [' m-need ', 'm-need\n', 'M-NEED', '\tneed:M-Need ', 'mixed-slug', 'MIXED-SLUG', 'id-mixed', 'nowhere'], parent: ' M-need\n' });
  const o = scrubUnpublishedRefs([r], [r, m, mixed])[0].object;
  assert.deepEqual(o.related, ['nowhere']); assert.equal('parent' in o, false);
});

test('scrub round 4 (4): a KEY that equals a private slug is dropped, at the top level and at every depth', () => {
  const m = it('need', 'm-need'); const x = it('need', 'x-need');
  const r = res4({ 'm-need': 'anything', nested: { 'x-need': 1, ' M-NEED ': 2, keep: { 'm-need': [1], fine: 'ok' } }, list: [{ 'x-need': true, ok: 1 }] });
  const o = scrubUnpublishedRefs([r], [r, m, x])[0].object;
  assert.equal('m-need' in o, false);
  assert.deepEqual(o.nested, { keep: { fine: 'ok' } });
  assert.deepEqual(o.list, [{ ok: 1 }]);
  assert.equal(JSON.stringify(o).includes('need'), false);
});

test('scrub round 4 (5): each item reports HOW MANY values and keys were removed, never what they were', () => {
  const m = it('need', 'm-need'); const p = it('need', 'p-need');
  const r = res4({ related: ['m-need', 'p-need', 'M-NEED'], parent: 'm-need', 'm-need': 1, nested: { a: ['m-need'], 'm-need': 2 } });
  const clean = res4({ related: ['nowhere'] }); clean.ref = 'data/kb/resource.yaml#clean';
  const out = scrubUnpublishedRefs([r, p, clean], [r, p, clean, m]);
  assert.equal(out[0].scrubbed, 6, 'two array values, one scalar, two keys, one nested array value');
  assert.equal(out[1].scrubbed, undefined); assert.equal(out[2].scrubbed, undefined, 'an item with nothing removed carries no count');
  assert.equal(JSON.stringify(out.map((i) => i.scrubbed)).includes('m-need'), false);
  const stats = {}; scrubUnpublishedRefs([r, p, clean], [r, p, clean, m], stats);
  assert.deepEqual(stats, { total: 6, items: [{ ref: 'data/kb/resource.yaml#r', count: 6 }] });
});

test('planPublish scrubs again, whatever the caller did: a record built from unscrubbed items carries no hidden slug', () => {
  loadKmsConfig(instance());
  const m = { schema: 'need', object: { ...need('matching-only'), id: 'id-m' }, ref: 'data/kb/need.yaml#m-need' };
  const r = { schema: 'resource', object: { id: 'id-r', title: 'R', type: 'resource', public_use: 'ok-with-caveat', related: ['m-need', 'nowhere'], related_concepts: ['need:m-need'] }, ref: 'data/kb/resource.yaml#r' };
  const plan = planPublish({ items: [r], all: [r, m], manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH });
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(JSON.stringify(plan.create).includes('m-need'), false);
  assert.deepEqual(plan.create[0].record.related, ['nowhere']);
});

// ── Polish N4: a YAML-number id is still an id ──
test('scrub N4: a private object with a YAML-number id is indexed, so related: [424242] and \'424242\' do not publish; a null id is ignored', () => {
  const m = it('need', 'm-need', { id: 424242 }); const nul = it('need', 'n-need', { id: null });
  const r = it('resource', 'r', { related: [424242, '424242', 'nowhere', 7], parent: 424242, nested: { cites: [424242, 7] } });
  const stats = {};
  const o = scrubUnpublishedRefs([r], [r, m, nul], stats)[0].object;
  assert.deepEqual(o.related, ['nowhere', 7]);
  assert.equal('parent' in o, false);
  assert.deepEqual(o.nested, { cites: [7] });
  assert.equal(stats.total, 4);
});

// ── Polish N5: the identity exemption holds only for the item's OWN identity ──
test('scrub N5: id, slug, type or title naming ANOTHER (private) object is scrubbed; the item\'s own slug, id, title and type stay', () => {
  const hidden = it('offer', 'priv-offer', { id: 'id-priv' });
  const own = { schema: 'resource', ref: 'data/kb/resource.yaml#r', object: { id: 'r-id', slug: 'r', type: 'resource', title: 'Own Title' } };
  const o1 = scrubUnpublishedRefs([own], [own, hidden]);
  assert.equal(o1[0], own, 'an item whose identity fields hold only its own values is returned as is');
  const bad = { schema: 'resource', ref: 'data/kb/resource.yaml#r', object: { id: 'id-priv', slug: 'priv-offer', type: 'offer:priv-offer', title: 'priv-offer' } };
  const stats = {};
  const o = scrubUnpublishedRefs([bad], [bad, hidden], stats)[0].object;
  assert.deepEqual(Object.keys(o), [], 'every identity field that names the private object is dropped');
  assert.equal(stats.total, 4);
  const titled = { schema: 'resource', ref: 'data/kb/resource.yaml#r', object: { title: 'priv-offer', slug: 'priv-offer-x' } };
  assert.equal('title' in scrubUnpublishedRefs([titled], [titled, hidden])[0].object, false, 'a title that is another object\'s slug is a value, and goes');
});

// ── Polish N6: a mistyped type prefix still finds the slug ──
test('scrub N6: Need:Priv-Offer (the wrong type, mixed case) for a private offer is dropped like offer:priv-offer; a real typed ref to a public object stays', () => {
  const hidden = it('offer', 'priv-offer'); const pub = it('resource', 'dup'); const hiddenDup = it('need', 'dup');
  const r = it('resource', 'r', { related: ['Need:Priv-Offer', 'offer:priv-offer', 'thing:priv-offer', ' x : priv-offer', 'resource:dup', 'offer:dup', 'https://example.org/a:priv-offer', 'foo:bar'], parent: 'Need:Priv-Offer' });
  const stats = {};
  const o = scrubUnpublishedRefs([r, pub], [r, pub, hidden, hiddenDup], stats)[0].object;
  assert.deepEqual(o.related, ['resource:dup', 'https://example.org/a:priv-offer', 'foo:bar']);
  assert.equal('parent' in o, false);
  assert.equal(stats.total, 6);
});

// ── Polish N7: a refusal caused by the scrub says so ──
test('planPublish N7: a required field removed by the scrub is refused with the cause named, never the value; a field that was never there is not blamed on the scrub', async () => {
  const config = loadKmsConfig(instance());
  const shared = await loadSharedLexicons(config.packs); const base = { manifest: { version: 1, objects: {} }, did: 'did:plc:me', authority: AUTH, shared };
  const m = { schema: 'need', object: { ...need('matching-only'), id: 'id-m' }, ref: 'data/kb/need.yaml#m-need' };
  const eaten = { schema: 'need', object: { ...need('public'), id: 'id-p', text: 'm-need' }, ref: 'data/kb/need.yaml#p-need' };
  const plan = planPublish({ ...base, items: [eaten], all: [eaten, m] });
  assert.equal(plan.ok, false);
  const msgs = plan.errors.flatMap((e) => e.errors);
  assert.ok(msgs.includes('missing required field: text (removed: matched a non-public object)'), JSON.stringify(msgs));
  assert.equal(JSON.stringify(plan.errors).includes('m-need'), false, 'the value that matched is never named');
  const never = { schema: 'need', object: { ...need('public'), id: 'id-q', text: undefined }, ref: 'data/kb/need.yaml#q-need' };
  const plan2 = planPublish({ ...base, items: [never], all: [never, m] });
  assert.deepEqual(plan2.errors.flatMap((e) => e.errors), ['missing required field: text']);
});
