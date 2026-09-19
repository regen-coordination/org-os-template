// demo/capture/territory.mjs — section 5: the unit tree queried by the REAL helpers (indexUnits / unitsFor / objectsIn) and the overlaps
// sidecar checked by the REAL validateOverlaps, over the illustrative sample. Every unit's answers are precomputed for the page.
import { fw, loadExtensions, reset, expect } from './env.mjs';
import { UNITS, RESOURCES, STREAMS, PROVIDERS, OVERLAPS_VALID, OVERLAP_FAULTS, SAMPLE_NOTE } from '../sample.mjs';
import { indexUnits, unitsFor, objectsIn } from '../../src/units.mjs';
import { validateOverlaps } from '../../src/overlaps.mjs';

export function territory() {
  reset();
  loadExtensions({ extensions: ['org-os-territory'] });
  for (const u of UNITS) expect(fw.validateObject('territorial-unit', u).valid, `sample unit ${u.unit_id} must validate against the real schema`);
  for (const s of STREAMS) expect(fw.validateObject('data-stream', s).valid, `sample stream "${s.title}" must validate against the real schema`);
  const ix = indexUnits(UNITS);
  const query = {};
  for (const u of UNITS) {
    const id = u.unit_id;
    query[id] = {
      withDescendants: objectsIn(id, RESOURCES, ix).map((r) => r.title),
      exact: objectsIn(id, RESOURCES, ix, { includeDescendants: false }).map((r) => r.title),
      ancestors: unitsFor(u, ix).units.slice(1),
      children: ix.children.get(id) || [],
      overlaps: OVERLAPS_VALID.overlaps.filter((o) => o.a === id || o.b === id)
        .map((o) => (o.a === id ? { other: o.b, shareSelf: o.share_a, shareOther: o.share_b } : { other: o.a, shareSelf: o.share_b, shareOther: o.share_a })),
    };
  }
  const unknownRefs = RESOURCES.flatMap((r) => unitsFor(r, ix).unknown.map((ref) => ({ resource: r.title, ref })));
  const valid = validateOverlaps(OVERLAPS_VALID, ix);
  expect(valid.valid, `the valid overlaps sidecar must validate: ${valid.errors.join('; ')}`);
  const faults = OVERLAP_FAULTS.map((f) => {
    const r = validateOverlaps(f.doc, ix);
    expect(!r.valid && r.errors.some((e) => f.expect.test(e)), `overlap fault "${f.id}" must produce its expected error, got: ${r.errors.join(' | ')}`);
    return { id: f.id, title: f.title, doc: f.doc, errors: r.errors };
  });
  expect(query['administrative:pais:catalunya'].withDescendants.length === 3 && unknownRefs.length === 1, 'the sample queries must behave as documented');
  return { note: SAMPLE_NOTE, layers: ['administrative', 'landscape', 'ecological', 'hydrological'], units: UNITS, resources: RESOURCES, query, unknownRefs,
    overlaps: { valid: { doc: OVERLAPS_VALID, result: valid }, faults }, streams: { providers: PROVIDERS, streams: STREAMS } };
}
