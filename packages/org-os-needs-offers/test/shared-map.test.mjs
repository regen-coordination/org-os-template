// packages/org-os-needs-offers/test/shared-map.test.mjs — the shared-lexicon mapping (kms plan Task 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSharedRecord, translateSurveyCategory } from '../src/shared-map.mjs';

test('a public need becomes a record with $type example.commons.need and no contact_route', () => {
  const rec = toSharedRecord({ id: 'n1', title: 'T', type: 'need', category: 'Tools and tech', text: 'x', when: 'Q1', status: 'open',
    visibility: 'public', public_use: 'ok-with-caveat', contact_route: 'SECRET', intro_wanted: true, notes: 'n', maturity: 'raw' });
  assert.equal(rec.$type, 'example.commons.need');
  assert.equal(rec.category, 'tools-and-tech'); assert.equal(rec.text, 'x'); assert.equal(rec.when, 'Q1');
  for (const k of ['contact_route', 'intro_wanted', 'visibility', 'notes', 'public_use', 'maturity', 'id']) assert.equal(rec[k], undefined, k);
});

test("translateSurveyCategory('Other') has no home in the lexicon", () => {
  assert.equal(translateSurveyCategory('Other'), null);
});

test('translateSurveyCategory of an unknown value has no home either', () => {
  assert.equal(translateSurveyCategory('Crypto vibes'), null);
  assert.equal(translateSurveyCategory(undefined), null);
});
