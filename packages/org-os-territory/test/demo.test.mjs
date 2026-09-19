// packages/org-os-territory/test/demo.test.mjs — the demo: sample data, real-run capture, renderer, built page.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fw, loadExtensions, reset } from '../demo/capture/env.mjs';
import { UNITS, RESOURCES, STREAMS, PROVIDERS, OVERLAPS_VALID, OVERLAP_FAULTS, SAMPLE_NOTE } from '../demo/sample.mjs';
import { indexUnits } from '../src/units.mjs';
import { validateOverlaps } from '../src/overlaps.mjs';

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
