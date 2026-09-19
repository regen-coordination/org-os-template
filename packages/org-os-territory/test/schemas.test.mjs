// packages/org-os-territory/test/schemas.test.mjs — the pack loads through the real kms path; both schemas validate, reject and generate lexicons.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fw from '../../org-os-kms/src/framework.mjs';
import { loadExtensions } from '../../org-os-kms/src/extensions.mjs';
import { registryBindings, resetRegistryBindings } from '../../org-os-kms/src/bind.mjs';
import { validateKernel } from '../../toolkit-framework/src/index.mjs'; // kms does not re-export it; same module instance, so it sees the registered pack

const load = () => loadExtensions({ extensions: ['org-os-territory'] });
beforeEach(() => { fw.resetPacks(); resetRegistryBindings(); });

const UNIT = { title: 'Plana de Vic', type: 'territorial-unit', unit_id: 'landscape:unit:plana-de-vic', layer: 'landscape', level: 'unit' };
const STREAM = { title: 'Divisions administratives (GeoJSON)', type: 'data-stream', source_system: 'icgc', access: 'download' };

test('the pack loads: schemas, entities, opt-in types and registry bindings', () => {
  const [pack] = load();
  assert.equal(pack.name, 'org-os-territory');
  assert.ok(fw.listSchemas().includes('territorial-unit') && fw.listSchemas().includes('data-stream'));
  assert.equal(fw.extensionEntities()['territorial-unit'].maps_to_core, 'place');
  assert.equal(fw.extensionEntities()['data-stream'].maps_to_core, 'artifact');
  assert.deepEqual(fw.optInTypes().slice(-2), ['territorial-unit', 'data-stream']);
  assert.ok(!fw.PUBLISHABLE_TYPES.includes('territorial-unit'));
  assert.equal(registryBindings()['territorial-unit'], 'data/territorial-units.yaml');
  assert.equal(registryBindings()['data-stream'], 'data/data-streams.yaml');
});

test('the kernel stays valid with the pack loaded, and Layer A is untouched', () => {
  const before = JSON.stringify(fw.loadSchema('core-entities'));
  load();
  assert.deepEqual(validateKernel(), { valid: true, errors: [] });
  assert.equal(JSON.stringify(fw.loadSchema('core-entities')), before, 'the pack maps to place — it never adds to or alters Layer A');
  assert.equal(fw.toJsonLdContext()['@context']['territorial-unit'], 'https://regen-commons.org/ns/territorial-unit');
});

test('territorial-unit: a minimal unit is valid; each required field is required; layer is an enum; level is free', () => {
  load();
  assert.deepEqual(fw.validateObject('territorial-unit', UNIT), { valid: true, errors: [] });
  for (const f of ['title', 'unit_id', 'layer', 'level']) {
    const { [f]: _, ...rest } = UNIT;
    assert.equal(fw.validateObject('territorial-unit', rest).valid, false, `missing ${f} must fail`);
  }
  assert.equal(fw.validateObject('territorial-unit', { ...UNIT, layer: 'political' }).valid, false);
  assert.equal(fw.validateObject('territorial-unit', { ...UNIT, level: 'any-local-word' }).valid, true);
  for (const layer of ['administrative', 'landscape', 'ecological', 'hydrological', 'custom']) {
    assert.equal(fw.validateObject('territorial-unit', { ...UNIT, layer }).valid, true, layer);
  }
});

test('territorial-unit: array fields must be arrays; the full shape is valid', () => {
  load();
  const full = { ...UNIT, part_of: 'landscape:catalogue-area:comarques-centrals', overlaps_with: ['administrative:comarca:osona'],
    codes: ['observatori:CC-12', 'one_earth:PA20'], geometry_ref: 'data/geometry/landscape/plana-de-vic.geojson', area_km2: 612,
    defined_by: 'observatori-unitats-de-paisatge', node_did: '', node_repo: '' };
  assert.deepEqual(fw.validateObject('territorial-unit', full), { valid: true, errors: [] });
  assert.equal(fw.validateObject('territorial-unit', { ...UNIT, codes: 'one_earth:PA20' }).valid, false);
  assert.equal(fw.validateObject('territorial-unit', { ...UNIT, overlaps_with: 'x' }).valid, false);
});

test('data-stream: a minimal stream is valid; required fields; access and trust are enums', () => {
  load();
  assert.deepEqual(fw.validateObject('data-stream', STREAM), { valid: true, errors: [] });
  for (const f of ['title', 'source_system', 'access']) {
    const { [f]: _, ...rest } = STREAM;
    assert.equal(fw.validateObject('data-stream', rest).valid, false, `missing ${f} must fail`);
  }
  assert.equal(fw.validateObject('data-stream', { ...STREAM, access: 'ftp' }).valid, false);
  assert.equal(fw.validateObject('data-stream', { ...STREAM, trust: 'rumour' }).valid, false);
  for (const access of ['open-api', 'graphql', 'wfs', 'wms', 'download', 'scrape', 'manual']) assert.equal(fw.validateObject('data-stream', { ...STREAM, access }).valid, true, access);
  for (const trust of ['official', 'verified-community', 'unverified']) assert.equal(fw.validateObject('data-stream', { ...STREAM, trust }).valid, true, trust);
  assert.equal(fw.validateObject('data-stream', { ...STREAM, unit_refs: 'x' }).valid, false);
});

test('both types generate flat lexicons under the instance authority, and a record validates', () => {
  load();
  const AUTH = 'cat.regenerant.kb';
  const docs = fw.generateAll({ authority: AUTH });
  const unit = docs[`${AUTH}.territorialUnit`]; const stream = docs[`${AUTH}.dataStream`];
  assert.ok(unit && stream);
  assert.deepEqual(unit.defs.main.record.properties.codes, { type: 'array', items: { type: 'string' } });
  assert.deepEqual(unit.defs.main.record.properties.area_km2, { type: 'integer' });
  assert.deepEqual(unit.defs.main.record.properties.layer.knownValues, ['administrative', 'landscape', 'ecological', 'hydrological', 'custom']);
  for (const p of Object.values({ ...unit.defs.main.record.properties, ...stream.defs.main.record.properties })) {
    assert.ok(['string', 'boolean', 'integer', 'array'].includes(p.type), `flat lexicon types only, got ${p.type}`);
  }
  const rec = fw.toRecord(UNIT, `${AUTH}.territorialUnit`);
  assert.deepEqual(fw.validateRecord(rec, unit), { ok: true, errors: [] });
  assert.equal(fw.typeForNsid(`${AUTH}.dataStream`, AUTH), 'data-stream');
});
