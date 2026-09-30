import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGeoConfig, TESTNET_API } from '../src/geo/config.mjs';
import { readGeoRegistry, writeGeoRegistry, readVocabulary, GEO_REGISTRY_PATH } from '../src/geo/registry.mjs';

const H = (c) => c.repeat(32);
const full = { space: H('1'), space_kind: 'personal', author_space: H('2'), url_property: H('3'),
  types: { 'encyclopedia-entry': { type_id: H('a'), url: 'https://k.example/concepts/{slug}' } },
  vocabularies: [{ path: 'content/topics.json', namespace: 'refidao:topic', type_id: H('b'), links: [{ field: 'maps_to.geo_topic', property_id: H('c'), to_space: H('e') }] }],
  relations: [{ from_field: 'domain', to_vocabulary: 'refidao:topic', property_id: H('d') }] };

test('a full config is valid and normalized', () => {
  const r = readGeoConfig({ geo: full });
  assert.equal(r.ok, true, r.errors.join('; ')); assert.deepEqual(r.applyErrors, []);
  assert.equal(r.geo.spaceKind, 'personal'); assert.equal(r.geo.network, 'testnet'); assert.equal(r.geo.api, TESTNET_API);
  assert.deepEqual(r.geo.select, []);
});

test('space, space_kind, author_space missing → plan still valid, apply refused', () => {
  const { space, space_kind, author_space, ...rest } = full;
  const r = readGeoConfig({ geo: rest });
  assert.equal(r.ok, true);
  assert.equal(r.applyErrors.length, 3);
  assert.match(r.applyErrors.join(' '), /geo\.space/); assert.match(r.applyErrors.join(' '), /space_kind/); assert.match(r.applyErrors.join(' '), /author_space/);
});

test('mainnet, bad ids, a url without {slug}, an undeclared vocabulary are config errors', () => {
  const r = readGeoConfig({ geo: { ...full, network: 'mainnet',
    types: { 'encyclopedia-entry': { type_id: 'nope', url: 'https://k.example/x' } },
    relations: [{ from_field: 'domain', to_vocabulary: 'missing', property_id: H('d') }] } });
  assert.equal(r.ok, false);
  const all = r.errors.join(' | ');
  assert.match(all, /only "testnet"/); assert.match(all, /type_id/); assert.match(all, /\{slug\}/); assert.match(all, /not a declared vocabulary/);
});

test('a type with a url needs url_property before apply', () => {
  const { url_property, ...rest } = full;
  assert.match(readGeoConfig({ geo: rest }).applyErrors.join(' '), /url_property/);
});

test('no geo block → valid, empty', () => {
  const r = readGeoConfig({});
  assert.equal(r.ok, true); assert.deepEqual(r.geo.types, {}); assert.deepEqual(r.geo.vocabularies, []);
});

test('registry: default when absent; round trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-geo-reg-'));
  assert.deepEqual(readGeoRegistry(dir), { version: 1, network: null, space: null, entities: {} });
  const reg = { version: 1, network: 'testnet', space: H('1'), entities: { [H('f')]: { key: 'k', hash: 'h', editId: 'e', cid: 'c', txHash: 't', registeredAt: 'now', indexed: false } } };
  assert.equal(writeGeoRegistry(dir, reg), join(dir, GEO_REGISTRY_PATH));
  assert.deepEqual(readGeoRegistry(dir), reg);
});

test('readVocabulary: an array, or an object holding one array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-geo-voc-'));
  mkdirSync(join(dir, 'content'));
  writeFileSync(join(dir, 'content', 'a.json'), JSON.stringify([{ id: 'x', name: 'X' }]));
  writeFileSync(join(dir, 'content', 'b.json'), JSON.stringify({ topics: [{ id: 'y', name: 'Y' }] }));
  writeFileSync(join(dir, 'content', 'c.json'), JSON.stringify({ n: 1 }));
  assert.equal(readVocabulary(join(dir, 'content', 'a.json'))[0].id, 'x');
  assert.equal(readVocabulary(join(dir, 'content', 'b.json'))[0].id, 'y');
  assert.throws(() => readVocabulary(join(dir, 'content', 'c.json')), /no list of records/);
  assert.throws(() => readVocabulary(join(dir, 'content', 'missing.json')), /vocabulary file not found/);
});

test('types as array or string → config error, no throw', () => {
  const r1 = readGeoConfig({ geo: { ...full, types: ['x'] } });
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(' '), /geo\.types must be a map/);
  const r2 = readGeoConfig({ geo: { ...full, types: 'ab' } });
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join(' '), /geo\.types must be a map/);
});

test('vocabularies and relations as non-array → config error, no throw', () => {
  const r = readGeoConfig({ geo: { ...full, vocabularies: { a: 1 }, relations: 'x' } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /geo\.vocabularies must be a list/);
  assert.match(r.errors.join(' '), /geo\.relations must be a list/);
});

test('null vocabulary entry → errors for that entry and undeclared vocabulary, no throw', () => {
  const r = readGeoConfig({ geo: { ...full, vocabularies: [null], relations: [{ from_field: 'domain', to_vocabulary: 'refidao:topic', property_id: H('d') }] } });
  assert.equal(r.ok, false);
  const all = r.errors.join(' | ');
  assert.match(all, /geo\.vocabularies\[0\]/);
  assert.match(all, /not a declared vocabulary/);
});
