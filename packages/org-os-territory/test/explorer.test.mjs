// packages/org-os-territory/test/explorer.test.mjs — the explorer: extra sample, perspectives capture, state model, tour, renderer, built page.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fw, loadExtensions, reset, cleanup } from '../demo/capture/env.mjs';
import { UNITS, RESOURCES, STREAMS } from '../demo/sample.mjs';
import { indexUnits } from '../src/units.mjs';

beforeEach(() => reset());
after(() => cleanup());

// ── Task 2: sample-extra ─────────────────────────────────────────────────────────────────────────────────────────────
import { EXPLORER_INSTANCE_DATA, EXTRA_NOTE, DRAFT_STREAM, PRIVATE_NOTE_UNIT, PRIVATE_FIELD, idOf, slug } from '../explorer/sample-extra.mjs';

test('sample-extra: labelled illustrative; composed from the demo sample; valid against the REAL schemas; unique identities', () => {
  assert.match(EXTRA_NOTE, /illustrative/i);
  loadExtensions({ extensions: ['org-os-territory'] });
  const d = EXPLORER_INSTANCE_DATA;
  assert.equal(Object.keys(d['territorial-unit']).length, UNITS.length);
  assert.equal(Object.keys(d.resource).length, RESOURCES.length);
  assert.equal(Object.keys(d['data-stream']).length, STREAMS.length + 1);
  for (const [schema, entries] of Object.entries(d)) for (const o of Object.values(entries)) assert.deepEqual(fw.validateObject(schema, o), { valid: true, errors: [] }, idOf(o));
  const ids = Object.values(d).flatMap((e) => Object.values(e)).map(idOf);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(slug('Plana de Vic (example unit)'), 'plana-de-vic-example-unit');
});

test('sample-extra: exactly one draft stream and exactly one private note', () => {
  const all = Object.values(EXPLORER_INSTANCE_DATA).flatMap((e) => Object.values(e));
  assert.deepEqual(all.filter((o) => o.public_use !== 'ok-with-caveat').map(idOf), [DRAFT_STREAM.title]);
  assert.deepEqual(all.filter((o) => PRIVATE_FIELD in o).map(idOf), [PRIVATE_NOTE_UNIT]);
});
