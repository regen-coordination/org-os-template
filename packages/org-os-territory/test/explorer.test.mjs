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

// ── Task 4: streamsFor + the aggregator ──────────────────────────────────────────────────────────────────────────────
import { streamsFor, REASONS } from '../explorer/capture/streams-for.mjs';
import { capture, packFacts } from '../explorer/capture.mjs';

test('streamsFor: names this place / names a place above it / covers this whole layer; nothing for an uninformed layer', () => {
  const units = [...UNITS, { title: 'A custom site', type: 'territorial-unit', unit_id: 'custom:site:x', layer: 'custom', level: 'site' }];
  const s = streamsFor(units, STREAMS, indexUnits(units));
  const reason = (id, title) => (s[id].find((x) => x.title === title) || {}).reason;
  assert.equal(reason('administrative:pais:catalunya', 'Administrative divisions (GeoJSON)'), REASONS.direct);
  assert.equal(reason('administrative:municipi:vic', 'Administrative divisions (GeoJSON)'), REASONS.above);
  assert.equal(reason('hydrological:basin:example-basin', 'Water layers (WFS)'), REASONS.layer);
  assert.deepEqual(s['custom:site:x'], []);
  assert.equal(new Set(s['administrative:municipi:vic'].map((x) => x.title)).size, s['administrative:municipi:vic'].length, 'a stream is listed once');
});

test('packFacts: refuses an entity whose description was mis-parsed into stray keys', () => {
  const info = (entities) => ({ territory: { added: { entities }, manifest: { name: 'p', version: '1' } } });
  assert.throws(() => packFacts(info({ x: { maps_to_core: 'place', description: 'cut (a', b: null } })), /exactly maps_to_core \+ description/);
  assert.deepEqual(packFacts(info({ x: { maps_to_core: 'place', description: 'Whole.' } })).types, [{ name: 'x', mapsToCore: 'place', description: 'Whole.' }]);
});

test('capture: the five fact groups, serialisable, with the real pack descriptions', async () => {
  const f = await capture();
  assert.deepEqual(Object.keys(f), ['meta', 'territory', 'pack', 'perspectives', 'streamsFor']);
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
  assert.deepEqual(f.pack.types.map((t) => [t.name, t.mapsToCore]), [['territorial-unit', 'place'], ['data-stream', 'artifact']]);
  assert.equal(f.pack.optInLine, 'extensions: [org-os-territory]');
  assert.equal(f.territory.privateNoteUnit, PRIVATE_NOTE_UNIT);
  assert.deepEqual(Object.keys(f.streamsFor).sort(), UNITS.map((u) => u.unit_id).sort());
  assert.ok(!('verified' in f) && !('attempts' in f) && !('matrix' in f), 'the proof scenarios are not part of the explorer');
});

// ── Task 5: the tour data and reduce ─────────────────────────────────────────────────────────────────────────────────
import { STEPS } from '../explorer/tour.mjs';
import { initialState, reduce, view, VIEWS, SHARES } from '../explorer/model.mjs';

let FACTS; // captured once: capture() is the slow part, and the model only reads it
const facts = async () => (FACTS ||= await capture());
const CAT = 'administrative:pais:catalunya'; const PLANA = 'landscape:unit:plana-de-vic';

test('reduce: select, inside, view, share, drawer; anything unknown leaves the state untouched', async () => {
  const f = await facts(); const s0 = initialState();
  assert.deepEqual(s0, { selected: null, includeInside: true, view: 'you', share: 'nothing', drawer: null, tour: null });
  assert.equal(reduce(s0, { type: 'select', id: PLANA }, f).selected, PLANA);
  const bads = [{ type: 'select', id: 'custom:site:ghost' }, { type: 'select', id: 'toString' }, { type: 'select', id: 'constructor' }, { type: 'view', value: 'god' }, { type: 'share', value: 'all' }, { type: 'drawer', value: 'x' }, { type: 'set-inside' }, { type: 'set-inside', value: 'banana' }, { type: 'tour', value: 'bogus' }, { type: 'tour', value: 'next' }, { type: 'tour', value: 'back' }, { type: 'tour', value: 'end' }, { type: 'nope' }, null];
  for (const bad of bads) assert.equal(reduce(s0, bad, f), s0, JSON.stringify(bad));
  const running = reduce(s0, { type: 'tour', value: 'start' }, f);
  for (const bad of [{ type: 'tour', value: 'bogus' }, { type: 'tour', value: 'back' }]) assert.equal(reduce(running, bad, f), running, `while touring: ${JSON.stringify(bad)}`);
  assert.equal(reduce(s0, { type: 'toggle-inside' }, f).includeInside, false);
  assert.equal(reduce(s0, { type: 'set-inside', value: false }, f).includeInside, false);
  assert.equal(reduce(s0, { type: 'view', value: 'peer-nopack' }, f).view, 'peer-nopack');
  assert.equal(reduce(s0, { type: 'share', value: 'units' }, f).share, 'units');
  const open = reduce(s0, { type: 'drawer', value: 'pack' }, f);
  assert.equal(open.drawer, 'pack');
  assert.equal(reduce(open, { type: 'drawer', value: 'pack' }, f).drawer, null, 'the same drawer button closes it');
});

test('tour: six steps; every action is one reduce understands; start / next / back / end walk them', async () => {
  const f = await facts();
  assert.equal(STEPS.length, 6);
  const probe = { ...initialState(), drawer: 'about', includeInside: false, view: 'peer-nopack', share: 'units-streams', selected: 'hydrological:basin:example-basin' };
  for (const step of STEPS) for (const a of step.actions) assert.notEqual(reduce(probe, a, f), probe, `${step.title}: ${JSON.stringify(a)} must change a state that differs from it`);
  let s = reduce(initialState(), { type: 'tour', value: 'start' }, f);
  assert.deepEqual([s.tour, s.selected], [0, PLANA]);
  s = reduce(s, { type: 'tour', value: 'next' }, f);
  assert.deepEqual([s.tour, s.selected, s.includeInside], [1, CAT, true]);
  assert.equal(reduce(s, { type: 'tour', value: 'back' }, f).tour, 0);
  const seen = [];
  for (let i = 0; i < 3; i++) { s = reduce(s, { type: 'tour', value: 'next' }, f); seen.push(s.selected); }
  assert.deepEqual(seen, [PLANA, 'administrative:comarca:osona', 'administrative:comarca:osona'], 'steps 3-5 select what their text says');
  assert.deepEqual([s.tour, s.share, s.view], [4, 'units', 'peer-pack']);
  s = reduce(s, { type: 'tour', value: 'next' }, f);
  assert.deepEqual([s.tour, s.view, s.drawer], [5, 'you', 'pack']);
  assert.equal(reduce(s, { type: 'tour', value: 'next' }, f).tour, null, 'next on the last step finishes');
  assert.equal(reduce(s, { type: 'tour', value: 'end' }, f).tour, null);
});

// ── Task 6: view ─────────────────────────────────────────────────────────────────────────────────────────────────────
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children)]);
const allNodes = (v) => v.layers.flatMap((l) => flat(l.roots));

test('view: every unit is on the board once, selectable, and its panel is the recorded query', async () => {
  const f = await facts();
  assert.deepEqual(allNodes(view(initialState(), f)).map((n) => n.id).sort(), UNITS.map((u) => u.unit_id).sort());
  assert.equal(view(initialState(), f).panel, null);
  for (const u of UNITS) {
    const v = view(reduce(initialState(), { type: 'select', id: u.unit_id }, f), f); const q = f.territory.query[u.unit_id];
    assert.deepEqual(v.panel.here.map((x) => x.title), q.withDescendants);
    assert.deepEqual(v.panel.ancestors.map((a) => a.id), q.ancestors);
    assert.deepEqual(v.panel.overlaps.map((o) => o.id), q.overlaps.map((o) => o.other));
    assert.deepEqual(v.panel.streams.map((s) => s.title), f.streamsFor[u.unit_id].map((s) => s.title));
    assert.deepEqual(allNodes(v).filter((n) => n.selected).map((n) => n.id), [u.unit_id]);
    assert.deepEqual(allNodes(v).filter((n) => n.ancestor).map((n) => n.id).sort(), [...q.ancestors].sort());
  }
});

test('view: "include places inside it" switches between the two recorded answers (Catalunya: 3 ↔ 1)', async () => {
  const f = await facts();
  let s = reduce(initialState(), { type: 'select', id: CAT }, f);
  assert.equal(view(s, f).panel.here.length, 3);
  s = reduce(s, { type: 'toggle-inside' }, f);
  assert.deepEqual(view(s, f).panel.here.map((x) => x.title), f.territory.query[CAT].exact);
  assert.equal(view(s, f).panel.here.length, 1);
  assert.equal(allNodes(view(s, f)).find((n) => n.id === CAT).count, 1, 'the badge follows the toggle');
});

test('view: for all 3 × 3 share/view combinations, what is dimmed is exactly what that peer did not receive', async () => {
  const f = await facts(); const key = { 'peer-pack': 'peerWithPack', 'peer-nopack': 'peerWithout' };
  for (const share of SHARES) for (const who of VIEWS) {
    let s = reduce(reduce(initialState(), { type: 'share', value: share }, f), { type: 'view', value: who }, f);
    s = reduce(s, { type: 'select', id: CAT }, f);
    const v = view(s, f); const got = who === 'you' ? null : f.perspectives.modes[share][key[who]];
    assert.deepEqual(allNodes(v).filter((n) => n.dimmed).map((n) => n.id).sort(), got ? UNITS.map((u) => u.unit_id).filter((id) => !got.units.includes(id)).sort() : [], `${share}/${who} units`);
    assert.deepEqual(v.panel.streams.filter((x) => x.dimmed).map((x) => x.title), got ? v.panel.streams.map((x) => x.title).filter((t) => !got.streams.includes(t)) : [], `${share}/${who} streams`);
    assert.ok(v.panel.here.every((r) => !r.dimmed), 'the sample resources are shareable core items: every peer receives them');
    assert.deepEqual(v.bar.receivedCounts, got ? { units: got.units.length, streams: got.streams.length, resources: got.resources.length } : null);
  }
});

test('view: the unknown ref is in the tray; the private note is flagged on its unit only; the tour card mirrors the step', async () => {
  const f = await facts();
  assert.deepEqual(view(initialState(), f).tray.map((x) => x.ref), ['custom:site:ghost']);
  assert.equal(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f).panel.privateNote, true);
  assert.equal(view(reduce(initialState(), { type: 'select', id: CAT }, f), f).panel.privateNote, false);
  const t = view(reduce(initialState(), { type: 'tour', value: 'start' }, f), f).tour;
  assert.deepEqual([t.index, t.total, t.title, t.last], [0, 6, STEPS[0].title, false]);
});

// ── Task 7: renderer — board, panel, tray ────────────────────────────────────────────────────────────────────────────
import * as R from '../explorer/render.mjs';
const count = (html, re) => (html.match(re) || []).length;

test('renderBoard: every unit is a real labelled button; four layer rows; "not a map"; the tray names the unknown ref', async () => {
  const f = await facts();
  const html = R.renderBoard(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f));
  assert.equal(count(html, /<button type="button" class="unit[^"]*" data-action="select"/g), UNITS.length);
  assert.equal(count(html, /class="layer"/g), 4);
  for (const u of UNITS) assert.ok(html.includes(`data-key="unit:${u.unit_id}"`), u.unit_id);
  assert.match(html, /aria-pressed="true" aria-label="Plana de Vic \(example unit\) — landscape, unit, 1 thing \(selected\)"/);
  assert.equal(count(html, /is-overlapped/g), 3, 'Osona, Vic and PA20');
  assert.match(html, /Schematic — not a map/);
  assert.match(html, /Not placed anywhere[\s\S]*custom:site:ghost/);
});

test('renderPanel: empty prompt; then ancestors, the inside toggle, every share tagged invented, streams with steward / trust / licence', async () => {
  const f = await facts();
  assert.match(R.renderPanel(view(initialState(), f)), /Pick a place/);
  const plana = R.renderPanel(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f));
  assert.match(plana, /inside Landscape catalogue/);
  assert.match(plana, /93% of this place, 42% of theirs <span class="tag">invented<\/span>/);
  assert.equal(count(plana, /class="tag">invented</g), 3, 'one tag per overlap');
  assert.match(plana, /private note[\s\S]*never leaves/);
  assert.ok(!plana.includes('data-change="toggle-inside"'), 'a leaf place has nothing inside it to include');
  const cat = R.renderPanel(view(reduce(initialState(), { type: 'select', id: CAT }, f), f));
  assert.match(cat, /<input type="checkbox" data-change="toggle-inside" data-key="inside" checked>/);
  assert.match(cat, /looked after by Generalitat de Catalunya · download · trust: official · yearly · licence: CC-BY-4\.0/);
  const basin = R.renderPanel(view(reduce(initialState(), { type: 'select', id: 'hydrological:basin:example-basin' }, f), f));
  assert.match(basin, /covers this whole layer[\s\S]*licence: unverified/);
});

test('render: text from the facts is escaped', () => {
  assert.equal(R.esc(`<b a="1">&'`), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});
