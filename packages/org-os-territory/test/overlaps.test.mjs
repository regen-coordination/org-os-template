// packages/org-os-territory/test/overlaps.test.mjs — the contract for the generated sidecar (the script that fills it is a later spec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexUnits } from '../src/units.mjs';
import { validateOverlaps, OVERLAPS_PATH } from '../src/overlaps.mjs';

const ix = indexUnits([
  { title: 'Osona', unit_id: 'administrative:comarca:osona', layer: 'administrative', level: 'comarca' },
  { title: 'Bages', unit_id: 'administrative:comarca:bages', layer: 'administrative', level: 'comarca' },
  { title: 'Plana de Vic', unit_id: 'landscape:unit:plana-de-vic', layer: 'landscape', level: 'unit' },
]);
const ok = (overlaps) => ({ version: 1, generated: '2026-09-19T00:00:00Z', method: 'turf.intersect / area ratio', overlaps });
const PAIR = { a: 'landscape:unit:plana-de-vic', b: 'administrative:comarca:osona', share_a: 0.93, share_b: 0.42 };

test('the sidecar lives at a fixed path', () => assert.equal(OVERLAPS_PATH, 'data/territory-overlaps.json'));

test('the documented shape is valid; an empty list is valid; a share of exactly 1 is valid', () => {
  assert.deepEqual(validateOverlaps(ok([PAIR]), ix), { valid: true, errors: [] });
  assert.deepEqual(validateOverlaps(ok([]), ix), { valid: true, errors: [] });
  assert.equal(validateOverlaps(ok([{ ...PAIR, share_a: 1 }]), ix).valid, true);
});

test('the envelope is checked', () => {
  assert.match(validateOverlaps({ ...ok([]), version: 2 }, ix).errors[0], /version must be 1/);
  assert.match(validateOverlaps({ version: 1, generated: 'x', method: 'm' }, ix).errors[0], /overlaps must be an array/);
  assert.match(validateOverlaps({ ...ok([]), method: '' }, ix).errors[0], /method is required/);
  assert.match(validateOverlaps(null, ix).errors[0], /document must be an object/);
});

test('both units must exist, be different, and sit on different layers', () => {
  assert.match(validateOverlaps(ok([{ ...PAIR, b: 'administrative:comarca:ghost' }]), ix).errors[0], /overlaps\[0\]: unknown unit_id: administrative:comarca:ghost/);
  assert.match(validateOverlaps(ok([{ ...PAIR, a: 'administrative:comarca:bages' }]), ix).errors[0], /overlaps\[0\]: same layer \(administrative\)/);
  assert.match(validateOverlaps(ok([{ ...PAIR, a: PAIR.b }]), ix).errors[0], /overlaps\[0\]: a and b are the same unit/);
});

test('shares are numbers in (0, 1]', () => {
  for (const bad of [0, -0.1, 1.01, '0.5', null, undefined, NaN]) {
    const r = validateOverlaps(ok([{ ...PAIR, share_b: bad }]), ix);
    assert.equal(r.valid, false, `share_b=${bad}`);
    assert.match(r.errors[0], /overlaps\[0\]: share_b must be a number in \(0, 1\]/);
  }
});

test('a pair may appear only once, in either order; every error is reported, not just the first', () => {
  const flipped = { a: PAIR.b, b: PAIR.a, share_a: PAIR.share_b, share_b: PAIR.share_a };
  assert.match(validateOverlaps(ok([PAIR, flipped]), ix).errors[0], /overlaps\[1\]: duplicate pair/);
  const r = validateOverlaps(ok([{ ...PAIR, share_a: 0 }, { ...PAIR, b: 'x:y:z' }]), ix);
  assert.equal(r.errors.length, 2);
});
