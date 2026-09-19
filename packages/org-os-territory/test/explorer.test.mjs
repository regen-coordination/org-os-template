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

// ── Task 3: perspectives ─────────────────────────────────────────────────────────────────────────────────────────────
import { perspectives, MODES } from '../explorer/capture/perspectives.mjs';

test('perspectives: three share modes, published through the real publish op and received through the real connector', async () => {
  const p = await perspectives();
  assert.deepEqual(Object.keys(p.modes), MODES.map((m) => m.id));
  const n = (side) => [side.units.length, side.streams.length, side.resources.length];
  assert.deepEqual(n(p.modes.nothing.published), [0, 0, RESOURCES.length]);
  assert.deepEqual(n(p.modes.units.published), [UNITS.length, 0, RESOURCES.length]);
  assert.deepEqual(n(p.modes['units-streams'].published), [UNITS.length, STREAMS.length, RESOURCES.length]);
  for (const m of Object.values(p.modes)) {
    assert.deepEqual(n(m.peerWithPack), n(m.published), 'a peer with the pack receives exactly what was published');
    assert.deepEqual(n(m.peerWithout), [0, 0, RESOURCES.length], 'a peer without the pack receives no pack type');
  }
});

test('perspectives: the draft stream and the private note never leave, in any mode, on any side', async () => {
  const p = await perspectives();
  assert.deepEqual(p.neverLeaves, { streams: [DRAFT_STREAM.title], fields: [PRIVATE_FIELD] });
  for (const m of Object.values(p.modes)) for (const side of Object.values(m)) {
    assert.ok(!side.streams.includes(DRAFT_STREAM.title));
    assert.ok(!Object.values(side.fields).flat().includes(PRIVATE_FIELD));
  }
  assert.ok(p.modes.units.peerWithPack.fields.units.includes('unit_id'));
  assert.equal(p.resourceRefsTravel, true, 'core resources keep unit_refs on the wire — the page says so');
});
