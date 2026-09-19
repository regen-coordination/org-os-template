// packages/org-os-territory/test/demo.test.mjs — the demo: sample data, real-run capture, renderer, built page.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fw, loadExtensions, reset } from '../demo/capture/env.mjs';
import { UNITS, RESOURCES, STREAMS, PROVIDERS, OVERLAPS_VALID, OVERLAP_FAULTS, SAMPLE_NOTE } from '../demo/sample.mjs';
import { indexUnits } from '../src/units.mjs';
import { validateOverlaps } from '../src/overlaps.mjs';
import { packInfo } from '../demo/capture/pack-info.mjs';
import { publishMatrix } from '../demo/capture/publish-matrix.mjs';
import { oneProcess } from '../demo/capture/one-process.mjs';
import { federation } from '../demo/capture/federation.mjs';
import { attempts } from '../demo/capture/attempts.mjs';
import { territory } from '../demo/capture/territory.mjs';

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

test('oneProcess: a pack-less instance in the same process publishes no pack type; the unfiltered call is what leaked; a dropped pack removes the stale file', async () => {
  const r = await oneProcess();
  assert.deepEqual(r.registeredPacks, ['org-os-territory']);
  assert.deepEqual(r.withPack.contextTypes, ['territorial-unit', 'data-stream']);
  assert.equal(r.withPack.hasExtensionsYaml, true);
  assert.deepEqual(r.packless.contextTypes, []);
  assert.equal(r.packless.hasExtensionsYaml, false);
  assert.deepEqual(r.surfaceUsedToCall.unfiltered, ['territorial-unit', 'data-stream']);
  assert.deepEqual(r.surfaceUsedToCall.filtered, []);
  assert.deepEqual(r.stale, { before: true, after: false });
});

test('federation: extensions.yaml passes federateCheck; a peer with the pack asks for 14 collections, without it 12; inbound records are projected', async () => {
  const f = await federation();
  assert.match(f.extensionsYaml, /territorial-unit:/);
  assert.deepEqual(f.federateCheck.incompatible, []);
  assert.ok(f.federateCheck.compatible.includes('territorial-unit') && f.federateCheck.compatible.includes('data-stream'));
  assert.equal(f.peer.withPack.count, 14);
  assert.deepEqual(f.peer.withPack.extra, ['territorialUnit', 'dataStream']);
  assert.equal(f.peer.without.count, 12);
  assert.equal(f.inbound.withPack.schema, 'territorial-unit');
  assert.ok(!f.inbound.withPack.keys.includes('notes') && f.inbound.withPack.keys.includes('unit_id'));
  assert.equal(f.inbound.withoutPack.mapped, 0);
});

test('attempts: eleven real failures; each error names the pack or the offending item; only the core-connector collision names the item alone; no temp path leaks', async () => {
  const list = await attempts();
  assert.deepEqual(list.map((a) => a.id), ['schema-core-collision', 'entity-core-collision', 'entity-bad-map', 'connector-core-name', 'binding-core', 'type-no-schema', 'missing-pack', 'unmet-requires', 'path-traversal', 'unquoted-yaml', 'connector-import-throws']);
  for (const a of list) {
    assert.ok(a.error, `${a.id} must fail`);
    assert.ok(a.namesPack || a.namesItem, `${a.id}: ${a.error}`);
    assert.ok(!/demo-pk-/.test(a.error), `${a.id} leaks a temp path`);
    assert.ok(a.title && a.why && a.action);
  }
  assert.deepEqual(list.filter((a) => !a.namesPack).map((a) => a.id), ['connector-core-name']);
  assert.match(list.find((a) => a.id === 'unquoted-yaml').error, /<packages>\/bad-pack\/pack\.yaml/);
  assert.match(list.find((a) => a.id === 'unmet-requires').error, /requires framework >=99\.0\.0, found \d+\.\d+\.\d+/);
});

test('territory: queries computed by the real helpers for every unit; unknown refs reported; every overlap fault yields its real error', () => {
  const t = territory();
  assert.match(t.note, /illustrative/i);
  assert.deepEqual(t.layers, ['administrative', 'landscape', 'ecological', 'hydrological']);
  assert.equal(Object.keys(t.query).length, t.units.length);
  const q = t.query;
  assert.deepEqual(q['landscape:unit:plana-de-vic'].exact, ['Regenerative agriculture pilot (example)']);
  assert.deepEqual(q['administrative:comarca:osona'].exact, []);
  assert.deepEqual(q['administrative:comarca:osona'].withDescendants, ['Regenerative agriculture pilot (example)']);
  assert.equal(q['administrative:pais:catalunya'].exact.length, 1);
  assert.equal(q['administrative:pais:catalunya'].withDescendants.length, 3);
  assert.deepEqual(q['administrative:municipi:vic'].ancestors, ['administrative:comarca:osona', 'administrative:vegueria:catalunya-central', 'administrative:pais:catalunya']);
  assert.deepEqual(q['administrative:comarca:osona'].children, ['administrative:municipi:vic', 'administrative:municipi:taradell']);
  assert.ok(q['landscape:unit:plana-de-vic'].overlaps.some((o) => o.other === 'administrative:comarca:osona' && o.shareSelf === 0.93 && o.shareOther === 0.42));
  assert.deepEqual(t.unknownRefs, [{ resource: 'Orphan note (example)', ref: 'custom:site:ghost' }]);
  assert.deepEqual(t.overlaps.valid.result, { valid: true, errors: [] });
  assert.ok(t.overlaps.faults.length >= 6 && t.overlaps.faults.every((f) => f.errors.length > 0));
  assert.equal(t.streams.streams.length, 5);
});
