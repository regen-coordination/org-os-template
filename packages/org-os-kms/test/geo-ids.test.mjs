import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoIdFromUuid, derivedGeoId, isGeoId } from '../src/geo/ids.mjs';

test('geoIdFromUuid: dashed or dashless UUID → 32 lowercase hex', () => {
  assert.equal(geoIdFromUuid('11C13F39-90c4-49b1-b4ac-fca6a4c1f2ea'), '11c13f3990c449b1b4acfca6a4c1f2ea');
  assert.equal(geoIdFromUuid('11c13f3990c449b1b4acfca6a4c1f2ea'), '11c13f3990c449b1b4acfca6a4c1f2ea');
});

test('geoIdFromUuid: rejects non-UUIDs', () => {
  for (const bad of ['', 'existing-id', 'encyclopedia-entry:slug', null, 42, '11c13f39-90c4-49b1-b4ac-fca6a4c1f2e']) assert.throws(() => geoIdFromUuid(bad), /not a UUID/);
});

test('derivedGeoId: deterministic UUIDv8 (version nibble 8, RFC 4122 variant)', () => {
  const a = derivedGeoId('refidao:topic', 'carbon');
  assert.equal(a, derivedGeoId('refidao:topic', 'carbon'));
  assert.notEqual(a, derivedGeoId('refidao:topic', 'nature'));
  assert.notEqual(a, derivedGeoId('other:topic', 'carbon'));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a[12], '8');
  assert.ok('89ab'.includes(a[16]));
  assert.ok(isGeoId(a));
});

test('derivedGeoId: needs namespace and key', () => {
  assert.throws(() => derivedGeoId('', 'x'), /namespace and a key/);
  assert.throws(() => derivedGeoId('ns', ''), /namespace and a key/);
});

test('isGeoId: only 32 lowercase hex', () => {
  assert.equal(isGeoId('bd727a6ad6ec4a058f681ea9002a1fbf'), true);
  assert.equal(isGeoId('BD727A6AD6EC4A058F681EA9002A1FBF'), false);
  assert.equal(isGeoId('bd727a6a-d6ec-4a05-8f68-1ea9002a1fbf'), false);
  assert.equal(isGeoId(null), false);
});
