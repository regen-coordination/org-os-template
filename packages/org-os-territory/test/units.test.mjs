// packages/org-os-territory/test/units.test.mjs — the whole "query by place" story: index the unit tree, walk part_of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexUnits, unitsFor, objectsIn } from '../src/units.mjs';

const u = (unit_id, layer, level, part_of) => ({ title: unit_id, type: 'territorial-unit', unit_id, layer, level, ...(part_of ? { part_of } : {}) });
const UNITS = [
  u('administrative:pais:catalunya', 'administrative', 'pais'),
  u('administrative:comarca:osona', 'administrative', 'comarca', 'administrative:pais:catalunya'),
  u('administrative:municipi:vic', 'administrative', 'municipi', 'administrative:comarca:osona'),
  u('landscape:catalogue-area:comarques-centrals', 'landscape', 'catalogue-area'),
  u('landscape:unit:plana-de-vic', 'landscape', 'unit', 'landscape:catalogue-area:comarques-centrals'),
];

test('indexUnits builds byId and children', () => {
  const ix = indexUnits(UNITS);
  assert.equal(ix.byId.size, 5);
  assert.deepEqual(ix.children.get('administrative:pais:catalunya'), ['administrative:comarca:osona']);
  assert.deepEqual(ix.children.get('administrative:municipi:vic'), undefined);
});

test('indexUnits rejects a missing or duplicate unit_id', () => {
  assert.throws(() => indexUnits([{ title: 'x', layer: 'custom', level: 'site' }]), /unit without unit_id: "x"/);
  assert.throws(() => indexUnits([UNITS[0], UNITS[0]]), /duplicate unit_id: administrative:pais:catalunya/);
});

test('indexUnits rejects a dangling, cross-layer or cyclic part_of', () => {
  assert.throws(() => indexUnits([u('custom:site:a', 'custom', 'site', 'custom:site:nope')]), /custom:site:a: part_of names a missing unit: custom:site:nope/);
  assert.throws(() => indexUnits([UNITS[0], u('landscape:unit:x', 'landscape', 'unit', 'administrative:pais:catalunya')]), /landscape:unit:x: part_of crosses layers \(landscape -> administrative\)/);
  assert.throws(() => indexUnits([u('custom:site:a', 'custom', 'site', 'custom:site:b'), u('custom:site:b', 'custom', 'site', 'custom:site:a')]), /part_of cycle at custom:site:/);
});

test('unitsFor returns the refs and their ancestors, and reports unknown refs without throwing', () => {
  const ix = indexUnits(UNITS);
  const project = { title: 'Horta', type: 'resource', unit_refs: ['administrative:municipi:vic', 'landscape:unit:plana-de-vic', 'custom:site:ghost'] };
  const r = unitsFor(project, ix);
  assert.deepEqual(r.units, ['administrative:municipi:vic', 'landscape:unit:plana-de-vic', 'administrative:comarca:osona', 'administrative:pais:catalunya', 'landscape:catalogue-area:comarques-centrals']);
  assert.deepEqual(r.unknown, ['custom:site:ghost']);
  assert.deepEqual(unitsFor({ title: 'no refs' }, ix), { units: [], unknown: [] });
});

test('a territorial-unit counts as being in itself', () => {
  const ix = indexUnits(UNITS);
  assert.deepEqual(unitsFor(UNITS[2], ix).units, ['administrative:municipi:vic', 'administrative:comarca:osona', 'administrative:pais:catalunya']);
});

test('objectsIn descends part_of by default and can be told not to', () => {
  const ix = indexUnits(UNITS);
  const a = { title: 'A', unit_refs: ['administrative:municipi:vic'] };
  const b = { title: 'B', unit_refs: ['administrative:comarca:osona'] };
  const c = { title: 'C', unit_refs: ['landscape:unit:plana-de-vic'] };
  const all = [a, b, c];
  assert.deepEqual(objectsIn('administrative:comarca:osona', all, ix).map((o) => o.title), ['A', 'B']);
  assert.deepEqual(objectsIn('administrative:comarca:osona', all, ix, { includeDescendants: false }).map((o) => o.title), ['B']);
  assert.deepEqual(objectsIn('administrative:pais:catalunya', all, ix).map((o) => o.title), ['A', 'B']);
  assert.deepEqual(objectsIn('landscape:catalogue-area:comarques-centrals', all, ix).map((o) => o.title), ['C']);
  assert.throws(() => objectsIn('custom:site:ghost', all, ix), /unknown unit_id: custom:site:ghost/);
});
