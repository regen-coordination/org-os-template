import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGeoRegistration } from '../src/geo/plan.mjs';
import { derivedGeoId } from '../src/geo/ids.mjs';

const H = (c) => c.repeat(32);
const SPACE = H('1'), ROOT = H('e'), THEIRS = H('4');
const geo = (over = {}) => ({ space: SPACE, spaceKind: 'personal', authorSpace: H('2'), network: 'testnet', api: 'x', urlProperty: H('3'), select: [],
  types: { 'encyclopedia-entry': { type_id: H('a'), url: 'https://k.example/concepts/{slug}' } },
  vocabularies: [{ path: 'content/topics.json', namespace: 'refidao:topic', type_id: H('b'), links: [{ field: 'maps_to.geo_topic', property_id: H('c'), to_space: ROOT }] }],
  relations: [{ from_field: 'domain', to_vocabulary: 'refidao:topic', property_id: H('d') }], ...over });
const U1 = '11c13f39-90c4-49b1-b4ac-fca6a4c1f2ea', U2 = '58409dea-6e64-4df8-a619-e6b8aec58839';
const item = (slug, object, schema = 'encyclopedia-entry') => ({ schema, ref: `data/kb/${schema}.yaml#${slug}`, object });
const items = () => [item('activation', { id: U1, title: 'Activation stations', summary: 'A reusable pattern.', domain: 'funding-public-goods' })];
const vocab = (g = geo()) => [{ decl: g.vocabularies[0], records: [{ id: 'funding', name: 'Funding', description: 'Funding and public goods.', aliases: { domains: ['funding-public-goods'], impact_areas: ['💰 Funding'] }, maps_to: { geo_topic: THEIRS } }] }];
const empty = () => ({ version: 1, network: null, space: null, entities: {} });
const asRegistry = (plan) => ({ version: 1, network: 'testnet', space: SPACE, entities: Object.fromEntries([...plan.create, ...plan.update].map((o) => [o.geoId, { key: o.key, hash: o.hash }])) });

test('plans a topic and a concept with derived ids, alias relation, page url and cross-space link', () => {
  const p = planGeoRegistration({ items: items(), vocabularies: vocab(), geo: geo(), registry: empty() });
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.equal(p.create.length, 2);
  const topic = p.create.find((o) => o.key === 'refidao:topic:funding');
  const concept = p.create.find((o) => o.key === 'encyclopedia-entry:activation');
  assert.equal(topic.geoId, derivedGeoId('refidao:topic', 'funding'));
  assert.deepEqual(topic.relations, [{ toGeoId: THEIRS, propertyId: H('c'), toSpace: ROOT }]);
  assert.equal(concept.geoId, '11c13f3990c449b1b4acfca6a4c1f2ea');
  assert.equal(concept.url, 'https://k.example/concepts/activation');
  assert.equal(concept.description, 'A reusable pattern.');
  assert.deepEqual(concept.relations, [{ toGeoId: topic.geoId, propertyId: H('d') }]);
});

test('unchanged entities are skipped; a changed one is an update', () => {
  const first = planGeoRegistration({ items: items(), vocabularies: vocab(), geo: geo(), registry: empty() });
  const again = planGeoRegistration({ items: items(), vocabularies: vocab(), geo: geo(), registry: asRegistry(first) });
  assert.equal(again.create.length, 0); assert.equal(again.update.length, 0); assert.equal(again.skip.length, 2);
  const changed = items(); changed[0].object.summary = 'A different summary.';
  const upd = planGeoRegistration({ items: changed, vocabularies: vocab(), geo: geo(), registry: asRegistry(first) });
  assert.equal(upd.update.length, 1); assert.equal(upd.update[0].key, 'encyclopedia-entry:activation');
});

test('select restricts to the ticked ids or slugs', () => {
  const two = [...items(), item('lineage-x', { id: U2, title: 'X', short_description: 'x', domain: 'funding-public-goods' })];
  const g = geo({ types: { ...geo().types, 'concept-lineage': { type_id: H('a') } } });
  two[1].schema = 'concept-lineage'; two[1].ref = 'data/kb/concept-lineage.yaml#lineage-x';
  const p = planGeoRegistration({ items: two, vocabularies: vocab(g), geo: { ...g, select: ['lineage-x'] }, registry: empty() });
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.deepEqual(p.create.map((o) => o.key).sort(), ['concept-lineage:lineage-x', 'refidao:topic:funding']);
});

test('a select entry that matches nothing fails and names it', () => {
  const p = planGeoRegistration({ items: items(), vocabularies: vocab(), geo: geo({ select: ['activation', 'activaton'] }), registry: empty() });
  assert.equal(p.ok, false); assert.match(p.errors.join(' '), /activaton/); assert.doesNotMatch(p.errors.join(' '), /"activation"/);
});

test('a registry that belongs to another space is refused, naming both', () => {
  const p = planGeoRegistration({ items: items(), vocabularies: vocab(), geo: geo(), registry: { version: 1, network: 'testnet', space: H('9'), entities: {} } });
  assert.equal(p.ok, false); assert.match(p.errors.join(' '), new RegExp(H('9'))); assert.match(p.errors.join(' '), new RegExp(SPACE));
});

test('a domain with no vocabulary entry → warning, entity still planned without that relation', () => {
  const it = items(); it[0].object.domain = 'unmapped-domain';
  const p = planGeoRegistration({ items: it, vocabularies: vocab(), geo: geo(), registry: empty() });
  assert.equal(p.ok, true);
  assert.match(p.warnings.join(' '), /unmapped-domain/);
  assert.deepEqual(p.create.find((o) => o.key === 'encyclopedia-entry:activation').relations, []);
});

test('objects without a UUID id, or duplicated ids, are errors', () => {
  const noId = planGeoRegistration({ items: [item('a', { title: 'A', domain: 'x' })], vocabularies: [], geo: geo({ relations: [], vocabularies: [] }), registry: empty() });
  assert.equal(noId.ok, false); assert.match(noId.errors.join(' '), /has no id/);
  const dup = planGeoRegistration({ items: [item('a', { id: U1, title: 'A' }), item('b', { id: U1, title: 'B' })], vocabularies: [], geo: geo({ relations: [], vocabularies: [] }), registry: empty() });
  assert.equal(dup.ok, false); assert.match(dup.errors.join(' '), /duplicate Geo id/);
});

test('objects of a type not in geo.types are ignored; registry entries no longer planned are orphaned', () => {
  const other = [item('r', { id: U2, title: 'R' }, 'resource')];
  const reg = { version: 1, network: 'testnet', space: SPACE, entities: { [H('7')]: { key: 'encyclopedia-entry:gone', hash: 'h' } } };
  const p = planGeoRegistration({ items: other, vocabularies: [], geo: geo({ relations: [], vocabularies: [] }), registry: reg });
  assert.equal(p.ok, true); assert.equal(p.create.length, 0);
  assert.deepEqual(p.orphaned, [{ geoId: H('7'), key: 'encyclopedia-entry:gone' }]);
});

test('long descriptions are clipped to 300 characters on one line', () => {
  const it = items(); it[0].object.summary = `line one\n\n${'x'.repeat(400)}`;
  const d = planGeoRegistration({ items: it, vocabularies: vocab(), geo: geo(), registry: empty() }).create.find((o) => o.key.startsWith('encyclopedia')).description;
  assert.equal(d.length, 300); assert.ok(!d.includes('\n')); assert.ok(d.endsWith('…'));
});

test('a select entry given as a dashless 32-hex Geo id matches the object', () => {
  const p = planGeoRegistration({ items: items(), vocabularies: vocab(), geo: geo({ select: ['11c13f3990c449b1b4acfca6a4c1f2ea'] }), registry: empty() });
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.ok(p.create.some((o) => o.key === 'encyclopedia-entry:activation'));
});
