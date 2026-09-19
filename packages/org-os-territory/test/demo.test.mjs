// packages/org-os-territory/test/demo.test.mjs — the demo: sample data, real-run capture, renderer, built page.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fw, loadExtensions, reset } from '../demo/capture/env.mjs';
import { UNITS, RESOURCES, STREAMS, PROVIDERS, OVERLAPS_VALID, OVERLAP_FAULTS, SAMPLE_NOTE } from '../demo/sample.mjs';
import { indexUnits } from '../src/units.mjs';
import { validateOverlaps } from '../src/overlaps.mjs';
import { packInfo } from '../demo/capture/pack-info.mjs';
import { publishMatrix } from '../demo/capture/publish-matrix.mjs';

beforeEach(() => reset());

test('sample: labelled illustrative; every unit and stream validates against the REAL schemas', () => {
  assert.match(SAMPLE_NOTE, /illustrative/i);
  loadExtensions({ extensions: ['org-os-territory'] });
  for (const u of UNITS) assert.deepEqual(fw.validateObject('territorial-unit', u), { valid: true, errors: [] }, u.unit_id);
  for (const s of STREAMS) assert.deepEqual(fw.validateObject('data-stream', s), { valid: true, errors: [] }, s.title);
  const ix = indexUnits(UNITS);
  assert.equal(ix.byId.size, UNITS.length);
  assert.deepEqual(new Set(UNITS.map((u) => u.layer)), new Set(['administrative', 'landscape', 'ecological', 'hydrological']));
  assert.ok(UNITS.filter((u) => (u.codes || []).length).every((u) => u.codes.every((c) => /^(one_earth:PA20|observatori:EXAMPLE-\d+)$/.test(c))), 'only PA20 is a real code');
  for (const s of STREAMS) assert.ok(PROVIDERS.some((p) => p.slug === s.source_system), `provider for ${s.title}`);
  assert.ok(STREAMS.every((s) => ['CC-BY-4.0', 'CC-BY-NC-4.0', 'unverified', 'n/a'].includes(s.licence)), 'licences only where verified');
  assert.ok(RESOURCES.some((r) => r.unit_refs.includes('custom:site:ghost')), 'includes one unknown ref');
});

test('sample: the valid overlaps document passes the real validator; each fault fails with its expected error', () => {
  const ix = indexUnits(UNITS);
  assert.deepEqual(validateOverlaps(OVERLAPS_VALID, ix), { valid: true, errors: [] });
  assert.match(OVERLAPS_VALID.method, /ILLUSTRATIVE/);
  assert.ok(OVERLAP_FAULTS.length >= 5);
  for (const f of OVERLAP_FAULTS) {
    const r = validateOverlaps(f.doc, ix);
    assert.equal(r.valid, false, f.id);
    assert.ok(r.errors.some((e) => f.expect.test(e)), `${f.id}: ${r.errors.join(' | ')}`);
  }
});

test('packInfo: loading the pack adds exactly its schemas, entities, opt-in types, bindings and two lexicons; Layer A is untouched', () => {
  const { none, territory } = packInfo();
  assert.ok(!none.schemas.includes('territorial-unit'));
  assert.equal(none.lexiconCount, 12);
  assert.deepEqual(territory.added.schemas.sort(), ['data-stream', 'territorial-unit']);
  assert.equal(territory.added.entities['territorial-unit'].maps_to_core, 'place');
  assert.equal(territory.added.entities['data-stream'].maps_to_core, 'artifact');
  assert.deepEqual(territory.added.optInTypes, ['territorial-unit', 'data-stream']);
  assert.deepEqual(territory.added.bindings, { 'territorial-unit': 'data/territorial-units.yaml', 'data-stream': 'data/data-streams.yaml' });
  assert.equal(territory.lexiconCount, 14);
  assert.equal(territory.kernelValid, true);
  assert.equal(territory.layerAUntouched, true);
  assert.deepEqual(territory.manifest.requires, { framework: '>=0.3.0', kms: '>=0.1.0' });
  assert.equal(territory.lexicon.id, 'cat.regenerant.kb.territorialUnit');
  assert.ok(Object.values(territory.lexicon.defs.main.record.properties).every((p) => ['string', 'boolean', 'integer', 'array'].includes(p.type)), 'flat lexicon');
});

test('publishMatrix: no pack → core only; unknown opt-in errors; pack not opted in → nothing new; opted in → unit (projected) and the public stream, never the draft', async () => {
  const m = Object.fromEntries((await publishMatrix()).map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(m), ['no-pack', 'no-pack-optin', 'pack-closed', 'pack-units', 'pack-units-streams']);
  const cols = (r) => Object.fromEntries(r.collections.map((c) => [c.collection.replace('cat.regenerant.kb.', ''), c.count]));
  assert.deepEqual(cols(m['no-pack']), { resource: 1 });
  assert.deepEqual(m['no-pack'].contextPackTypes, []);
  assert.equal(m['no-pack'].hasExtensionsYaml, false);
  assert.equal(m['no-pack-optin'].ok, false);
  assert.match(m['no-pack-optin'].error, /unknown publishable type: territorial-unit/);
  assert.deepEqual(cols(m['pack-closed']), { resource: 1 });
  assert.deepEqual(m['pack-closed'].contextPackTypes, ['territorial-unit', 'data-stream']);
  assert.equal(m['pack-closed'].hasExtensionsYaml, true);
  assert.deepEqual(cols(m['pack-units']), { resource: 1, territorialUnit: 1 });
  assert.ok(m['pack-units'].unitRecordKeys.includes('unit_id') && !m['pack-units'].unitRecordKeys.includes('notes'), 'notes is a private field');
  assert.deepEqual(cols(m['pack-units-streams']), { resource: 1, territorialUnit: 1, dataStream: 1 });
});
