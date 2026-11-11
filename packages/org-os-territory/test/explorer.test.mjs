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
import { EXPLORER_INSTANCE_DATA, EXTRA_NOTE, DRAFT_STREAM, PRIVATE_NOTE_UNIT, PRIVATE_FIELD, PRIVATE_VALUE, idOf, slug } from '../explorer/sample-extra.mjs';

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
  assert.equal(EXPLORER_INSTANCE_DATA['territorial-unit'][slug(PRIVATE_NOTE_UNIT)][PRIVATE_FIELD], PRIVATE_VALUE);
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
  assert.deepEqual(Object.keys(f.territory).sort(), ['extraNote', 'layers', 'note', 'privateNoteUnit', 'query', 'streams', 'units', 'unknownRefs'], 'the explorer carries no overlap sidecar, break-it scenarios or raw resources');
  assert.ok(!JSON.stringify(f).includes('same layer'), 'none of the report\'s break-it error strings ships in the page');
  assert.deepEqual(Object.keys(f.streamsFor).sort(), UNITS.map((u) => u.unit_id).sort());
  assert.ok(!('verified' in f) && !('attempts' in f) && !('matrix' in f), 'the proof scenarios are not part of the explorer');
});


// ── Task 5: the tour data and reduce ─────────────────────────────────────────────────────────────────────────────────
import { STEPS } from '../explorer/tour.mjs';
import { initialState, reduce, view, treeKey, VIEWS, SHARES } from '../explorer/model.mjs';

let FACTS; // captured once: capture() is the slow part, and the model only reads it
const facts = async () => (FACTS ||= await capture());
const CAT = 'administrative:pais:catalunya'; const PLANA = 'landscape:unit:plana-de-vic';
const PEER = { 'peer-pack': 'peerWithPack', 'peer-nopack': 'peerWithout' };

test('reduce: select, inside, view, share, drawer, menu, open/close a place; anything unknown leaves the state untouched', async () => {
  const f = await facts(); const s0 = initialState();
  assert.deepEqual(s0, { selected: null, includeInside: true, view: 'you', share: 'nothing', drawer: null, tour: null, menu: false, closed: [] });
  assert.equal(reduce(s0, { type: 'select', id: PLANA }, f).selected, PLANA);
  const bads = [{ type: 'select', id: 'custom:site:ghost' }, { type: 'select', id: 'toString' }, { type: 'select', id: 'constructor' }, { type: 'view', value: 'god' }, { type: 'share', value: 'all' }, { type: 'drawer', value: 'x' }, { type: 'set-inside' }, { type: 'set-inside', value: 'banana' }, { type: 'tour', value: 'bogus' }, { type: 'tour', value: 'next' }, { type: 'tour', value: 'back' }, { type: 'tour', value: 'end' }, { type: 'menu', value: 'sideways' }, { type: 'toggle-open', id: PLANA }, { type: 'toggle-open', id: 'toString' }, { type: 'toggle-open' }, { type: 'nope' }, null];
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
  const menu = reduce(s0, { type: 'menu', value: 'toggle' }, f);
  assert.equal(menu.menu, true);
  assert.equal(reduce(menu, { type: 'menu', value: 'close' }, f).menu, false);
  assert.equal(reduce(menu, { type: 'share', value: 'units' }, f).menu, true, 'choosing what you share keeps the menu open');
  assert.equal(reduce(menu, { type: 'view', value: 'peer-pack' }, f).menu, false, 'choosing who you view as closes it');
  assert.equal(reduce(menu, { type: 'tour', value: 'start' }, f).menu, false);
  const shut = reduce(s0, { type: 'toggle-open', id: CAT }, f);
  assert.deepEqual(shut.closed, [CAT]);
  assert.deepEqual(reduce(shut, { type: 'toggle-open', id: CAT }, f).closed, []);
  assert.deepEqual(reduce(shut, { type: 'select', id: 'administrative:municipi:vic' }, f).closed, [], 'selecting a place opens the places above it');
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
  assert.equal(allNodes(view(s, f)).find((n) => n.id === CAT).count, 1, 'the count follows the toggle');
});

test('view: for all 3 × 3 share/view combinations, on a place with and without overlaps, what is absent is exactly what that peer did not receive', async () => {
  const f = await facts(); let panels = 0; let hidden = 0; let absentStreams = 0;
  for (const share of SHARES) for (const who of VIEWS) for (const sel of [CAT, PLANA]) {
    let s = reduce(reduce(initialState(), { type: 'share', value: share }, f), { type: 'view', value: who }, f);
    s = reduce(s, { type: 'select', id: sel }, f);
    const v = view(s, f); const got = who === 'you' ? null : f.perspectives.modes[share][PEER[who]];
    const recv = (kind, ids) => (got ? ids.filter((id) => got[kind].includes(id)) : ids);
    const at = `${share}/${who}/${sel}`;
    assert.ok(!JSON.stringify(v).includes('dimmed'), `${at}: nothing is dimmed — it is drawn or it is absent`);
    assert.deepEqual(allNodes(v).map((n) => n.id).sort(), recv('units', UNITS.map((u) => u.unit_id)).sort(), `${at} units`);
    assert.ok(v.layers.every((l) => l.roots.length > 0), `${at}: a layer with nothing received is not drawn`);
    assert.deepEqual(v.tray.map((x) => x.resource), recv('resources', f.territory.unknownRefs.map((x) => x.resource)), `${at} tray`);
    assert.deepEqual(v.viewAs.counts, got ? { units: got.units.length, streams: got.streams.length, resources: got.resources.length } : null, `${at} counts`);
    if (!recv('units', [sel]).length) { assert.equal(v.panel, null, `${at}: the hidden place's inspector is the prompt`); hidden++; continue; }
    panels++;
    const q = f.territory.query[sel]; const streams = f.streamsFor[sel].map((x) => x.title);
    assert.deepEqual(v.panel.overlaps.map((o) => o.id), recv('units', q.overlaps.map((o) => o.other)), `${at} overlaps`);
    assert.deepEqual(v.panel.streams.map((x) => x.title), recv('streams', streams), `${at} streams`);
    assert.deepEqual(v.panel.here.map((x) => x.title), recv('resources', q.withDescendants), `${at} here`);
    assert.equal(v.panel.privateNote, who === 'you' && sel === PLANA, `${at}: the private note is drawn only for you`);
    absentStreams += streams.length - v.panel.streams.length;
  }
  assert.ok(panels > 0 && hidden > 0 && absentStreams > 0, 'the loop meets drawn panels, hidden places and absent streams, so no check is vacuous');
  assert.ok(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f).panel.overlaps.length > 0, 'the loop includes a place that has overlaps');
});

test('view: a hidden selected place keeps its selection and shows the prompt; Exit preview shows it again (P-12)', async () => {
  const f = await facts();
  let s = reduce(reduce(initialState(), { type: 'select', id: PLANA }, f), { type: 'view', value: 'peer-nopack' }, f);
  const v = view(s, f);
  assert.equal(s.selected, PLANA, 'the selection stays in state');
  assert.equal(v.panel, null);
  assert.match(R.renderPanel(v), /Pick a place/);
  const page = Object.values(R.slots(v)).join('');
  assert.ok(!page.includes(`data-key="unit:${PLANA}"`) && !page.includes('overmark'), 'neither the place nor its overlaps are drawn');
  assert.match(R.renderBand(v), /data-action="view" data-value="you" data-key="exit-preview">Exit preview<\/button>/);
  s = reduce(s, { type: 'view', value: 'you' }, f);
  assert.equal(view(s, f).panel.id, PLANA, 'Exit preview shows the place again');
});

test('view: the unknown ref is in the tray; the private note is flagged on its unit only; the tour card mirrors the step', async () => {
  const f = await facts();
  assert.deepEqual(view(initialState(), f).tray.map((x) => x.ref), ['custom:site:ghost']);
  assert.equal(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f).panel.privateNote, true);
  assert.equal(view(reduce(initialState(), { type: 'select', id: CAT }, f), f).panel.privateNote, false);
  const t = view(reduce(initialState(), { type: 'tour', value: 'start' }, f), f).tour;
  assert.deepEqual([t.index, t.total, t.title, t.last], [0, 6, STEPS[0].title, false]);
});

test('treeKey: the APG tree keys — ↑↓ move, → opens or enters, ← closes or climbs, Home/End, Enter/Space select, type-ahead', () => {
  const items = [{ id: 'a', depth: 1, expanded: true, name: 'Alpha' }, { id: 'b', depth: 2, expanded: null, name: 'Beta' }, { id: 'c', depth: 2, expanded: false, name: 'Gamma' }, { id: 'd', depth: 1, expanded: null, name: 'Delta' }];
  assert.deepEqual(treeKey(items, 0, 'ArrowDown'), { focus: 1 });
  assert.equal(treeKey(items, 3, 'ArrowDown'), null);
  assert.equal(treeKey(items, 0, 'ArrowUp'), null);
  assert.deepEqual(treeKey(items, 2, 'ArrowUp'), { focus: 1 });
  assert.deepEqual(treeKey(items, 2, 'Home'), { focus: 0 });
  assert.deepEqual(treeKey(items, 0, 'End'), { focus: 3 });
  assert.deepEqual(treeKey(items, 0, 'ArrowRight'), { focus: 1 }, 'open: to the first child');
  assert.deepEqual(treeKey(items, 2, 'ArrowRight'), { toggle: 'c' }, 'closed: opens');
  assert.equal(treeKey(items, 1, 'ArrowRight'), null, 'a leaf: nothing');
  assert.deepEqual(treeKey(items, 0, 'ArrowLeft'), { toggle: 'a' }, 'open: closes');
  assert.deepEqual(treeKey(items, 1, 'ArrowLeft'), { focus: 0 }, 'a child: to its parent');
  assert.deepEqual(treeKey(items, 2, 'ArrowLeft'), { focus: 0 }, 'a closed child: to its parent');
  assert.equal(treeKey(items, 3, 'ArrowLeft'), null, 'a root leaf: nothing');
  assert.deepEqual(treeKey(items, 1, 'Enter'), { select: 'b' });
  assert.deepEqual(treeKey(items, 1, ' '), { select: 'b' });
  assert.deepEqual(treeKey(items, 0, 'g'), { focus: 2 });
  assert.deepEqual(treeKey(items, 0, 'D'), { focus: 3 }, 'case-insensitive');
  assert.deepEqual(treeKey(items, 0, 'a'), { focus: 0 }, 'type-ahead wraps and may land where it started');
  for (const k of ['z', 'Tab', 'Shift', 'Escape', 'PageDown']) assert.equal(treeKey(items, 0, k), null, k);
});

// ── Task 7: renderer — board, panel, tray ────────────────────────────────────────────────────────────────────────────
import * as R from '../explorer/render.mjs';
const count = (html, re) => (html.match(re) || []).length;

test('renderBoard: one APG tree per layer — treeitems with level, expansion, selection and one tab stop each; overlap marks; the tray as rows', async () => {
  const f = await facts();
  const html = R.renderBoard(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f));
  assert.equal(count(html, /role="tree" aria-labelledby="layer-[a-z]+"/g), 4);
  assert.equal(count(html, /<li role="treeitem" aria-level="\d"/g), UNITS.length);
  for (const u of UNITS) assert.ok(html.includes(`data-action="select" data-id="${u.unit_id}" data-key="unit:${u.unit_id}"`), u.unit_id);
  assert.equal(count(html, /aria-selected="true"/g), 1);
  assert.match(html, /<li role="treeitem" aria-level="2" aria-selected="true" tabindex="0" aria-label="Plana de Vic \(example unit\), unit, 1 thing"/);
  assert.equal(count(html, /tabindex="0"/g), 4, 'one tab stop per tree (roving tabindex)');
  assert.match(html, /<li role="treeitem" aria-level="1" aria-expanded="true" aria-selected="false" tabindex="0" aria-label="Catalunya, pais, 3 things"/);
  assert.ok(html.includes('<ul role="group">'));
  assert.equal(count(html, /class="overmark"/g), 3, 'Osona, Vic and PA20');
  assert.match(html, /aria-label="Osona, comarca, [^"]*overlaps the selected place, 93%"[\s\S]*?class="tnode over"[\s\S]*?overlaps · 93%/);
  assert.match(html, /Not placed anywhere[\s\S]*class="row[^"]*"[\s\S]*Orphan note \(example\)[\s\S]*custom:site:ghost/);
  assert.ok(!/is-dimmed|class="unit/.test(html));
  const shut = R.renderBoard(view(reduce(initialState(), { type: 'toggle-open', id: CAT }, f), f));
  assert.match(shut, /aria-expanded="false" aria-selected="false" tabindex="0" aria-label="Catalunya/);
  assert.equal(count(shut, /role="treeitem"/g), UNITS.length - 6, 'a closed place hides the six beneath it');
  const none = R.renderBoard(view({ ...initialState(), view: 'peer-nopack' }, f));
  assert.equal(count(none, /role="tree"/g), 0);
  assert.match(none, /class="note[^"]*"[\s\S]*receives none of your places/);
});

test('renderPanel: the prompt; then a complementary inspector — field rows, the inside toggle, overlaps with a meter and an invented share, streams with provider · licence · trust', async () => {
  const f = await facts();
  assert.match(R.renderPanel(view(initialState(), f)), /<aside class="insp surf" id="panel" aria-labelledby="panel-h">[\s\S]*Pick a place/);
  const plana = R.renderPanel(view(reduce(initialState(), { type: 'select', id: PLANA }, f), f));
  assert.match(plana, /<span class="eyebrow">Place · landscape · unit<\/span><h2 id="panel-h" class="t">Plana de Vic \(example unit\)<\/h2>/);
  assert.match(plana, /<dt>Inside<\/dt><dd>Landscape catalogue/);
  assert.match(plana, /<dt>Codes<\/dt><dd><code>observatori:EXAMPLE-01<\/code><\/dd>/);
  assert.match(plana, /Private note<\/dt><dd><span class="restricted">Yours only · never leaves<\/span>/);
  assert.match(plana, /93%<span class="sr-only"> of this place<\/span>/);
  assert.match(plana, /<span>42% of theirs<\/span><span class="inv">invented<\/span>/);
  assert.equal(count(plana, /class="meter bar" aria-hidden="true"/g), 3, 'one meter per overlap');
  assert.equal(count(plana, /class="inv">invented</g), 3, 'one invented tag per overlap');
  assert.ok(!plana.includes('data-change="toggle-inside"'), 'a leaf place has nothing inside it to include');
  const cat = R.renderPanel(view(reduce(initialState(), { type: 'select', id: CAT }, f), f));
  assert.match(cat, /<input type="checkbox" data-change="toggle-inside" data-key="inside" checked> Include places inside it/);
  assert.match(cat, /<span>Institut Cartogràfic i Geològic de Catalunya<\/span><span>licence: CC-BY-4\.0<\/span><span>trust: official<\/span>/);
  assert.match(cat, /looked after by Generalitat de Catalunya<\/span><span>download<\/span><span>yearly<\/span>/);
  assert.ok(!/Private note/.test(cat));
  const basin = R.renderPanel(view(reduce(initialState(), { type: 'select', id: 'hydrological:basin:example-basin' }, f), f));
  assert.match(basin, /licence: unverified[\s\S]*covers this whole layer/);
});

test('render: text from the facts is escaped', () => {
  assert.equal(R.esc(`<b a="1">&'`), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

// ── Task 8: renderer — View as, drawers, tour card, the whole app ────────────────────────────────────────────────────
test('View as: a menu button; the menu\'s header holds the share group, then the three views; the band states the recorded counts and the floor', async () => {
  const f = await facts();
  const you = view(initialState(), f);
  assert.deepEqual(Object.keys(you.viewAs).sort(), ['counts', 'neverLeaves', 'resourceRefsTravel', 'sentence', 'share', 'who']);
  assert.equal(R.renderBand(you), '', 'no band while you look as yourself');
  const closed = R.renderTools(you);
  assert.match(closed, /data-key="tour-start">Take the tour<\/button>/);
  assert.match(closed, /aria-haspopup="menu" aria-expanded="false">[\s\S]*<span class="va-l">View as: you<\/span>/);
  assert.ok(!closed.includes('role="menu"'));
  const open = R.renderTools(view(reduce(initialState(), { type: 'menu', value: 'open' }, f), f));
  assert.match(open, /aria-expanded="true" aria-controls="viewas-menu"/);
  assert.match(open, /role="menu" id="viewas-menu" aria-labelledby="viewas" aria-describedby="viewas-floor"/);
  assert.equal(count(open, /role="menuitemradio"/g), 6);
  assert.ok(open.indexOf('Of your territory, you share') < open.indexOf('data-action="view"'), 'the share group is the menu\'s header');
  assert.match(open, /aria-checked="true" tabindex="-1" data-action="share" data-value="nothing"/);
  assert.match(open, /aria-checked="true" tabindex="-1" data-action="view" data-value="you"/);
  assert.match(open, /Never leaves, whatever you share: “Draft stream \(example, not public yet\)”; the private <code>notes<\/code>/);
  assert.match(open, /keep their place references, which a peer without the pack cannot look up/);
  let s = reduce(reduce(initialState(), { type: 'share', value: 'units' }, f), { type: 'view', value: 'peer-pack' }, f);
  assert.match(R.renderTools(view(s, f)), /<span class="va-l">View as: a peer with the pack<\/span>/);
  assert.match(R.renderBand(view(s, f)), /<b>Previewing as a peer with the pack\.<\/b> They receive your 12 places and 0 data streams\. The private note and 1 stream never leave\./);
  s = reduce(s, { type: 'share', value: 'units-streams' }, f);
  assert.match(R.renderBand(view(s, f)), /They receive your 12 places and 5 data streams\./);
  s = reduce(s, { type: 'view', value: 'peer-nopack' }, f);
  assert.match(R.renderBand(view(s, f)), /<b>Previewing as a peer without the pack\.<\/b> Their org-os doesn’t know what a place or a data stream is, so it never asks for one\. They receive 0 places and 0 data streams\. The private note and 1 stream never leave\./);
});

test('renderDrawers: closed by default; the pack drawer uses the captured descriptions and marks the fallback "not built yet"', async () => {
  const f = await facts();
  const closed = R.renderDrawers(view(initialState(), f));
  assert.match(closed, /data-key="drawer-pack" aria-expanded="false"/);
  assert.ok(!closed.includes('class="drawer'));
  const pack = R.renderDrawers(view(reduce(initialState(), { type: 'drawer', value: 'pack' }, f), f));
  for (const t of f.pack.types) assert.ok(pack.includes(R.esc(t.description)), t.name);
  assert.match(pack, /could one day read a place as a plain <code>place<\/code>\.[\s\S]*?<span class="w">Not built yet<\/span>[\s\S]*?Today such a peer simply receives nothing/);
  assert.match(pack, /extensions: \[org-os-territory\]/);
  const about = R.renderDrawers(view(reduce(initialState(), { type: 'drawer', value: 'about' }, f), f));
  assert.ok(about.includes(f.meta.commit) && about.includes('npm run demo') && /invented/.test(about));
});

test('renderTour + slots: no card outside the tour; a labelled non-modal pop card inside it; every step target exists in that step\'s page, from any View as', async () => {
  const f = await facts();
  assert.equal(R.renderTour(view(initialState(), f)), '');
  for (const share of SHARES) for (const who of VIEWS) {
    let s = reduce({ ...initialState(), share, view: who }, { type: 'tour', value: 'start' }, f);
    for (let i = 0; i < STEPS.length; i++) {
      const v = view(s, f); const html = Object.values(R.slots(v)).join('');
      assert.match(html, new RegExp(`class="coach" id="tour" role="dialog" aria-modal="false" aria-labelledby="tour-h" data-target="${STEPS[i].target.replace(/[:]/g, '\\$&')}"`));
      assert.ok(html.includes(`Step ${i + 1} of 6`));
      assert.ok(html.includes(`data-key="${STEPS[i].target}"`), `${share}/${who} step ${i + 1} points at something on the page: ${STEPS[i].target}`);
      assert.match(html, i > 0 ? /class="btn ghost" data-action="tour" data-value="back"/ : /^(?![\s\S]*data-value="back")/);
      assert.match(html, /class="btn primary" data-action="tour" data-value="next"/);
      s = reduce(s, { type: 'tour', value: 'next' }, f);
    }
  }
  const app = R.renderApp(view(initialState(), f));
  for (const id of ['banner', 'board', 'panel', 'drawers']) assert.ok(app.includes(`id="${id}"`), id);
  assert.match(app, /^<div id="banner" role="note"><div class="callout">[\s\S]*?<b>Illustrative sample\.<\/b> Unit names are examples/);
  assert.ok(!app.includes('id="live"') && !app.includes('role="status"'), 'the live region and the band\'s status sit outside the re-rendered subtree');
  assert.deepEqual(Object.keys(R.slots(view(initialState(), f))), ['tools', 'band', 'app']);
});

// ── Task 9: the build ────────────────────────────────────────────────────────────────────────────────────────────────
import { assemble, build, inlineModule, pageScript, withoutFontFaces, atoms, GLYPHS, DEFAULT_OUT, MODULES } from '../explorer/build.mjs';
const BUDGET = 300 * 1024;
const scriptOf = (html) => html.match(/<script>([\s\S]*?)<\/script>/)[1];
const factsOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="facts">([\s\S]*?)<\/script>/)[1]);
const explorerSrc = (file) => readFileSync(new URL(`../explorer/${file}`, import.meta.url), 'utf8');

test('inlineModule: import lines and export keywords go, nothing else', () => {
  assert.equal(inlineModule(`import { a } from './a.mjs';\nexport const x = 1;\nexport function f() {}\nconst exported = 2;\n`), `\nconst x = 1;\nfunction f() {}\nconst exported = 2;\n`);
  assert.deepEqual(MODULES, ['tour.mjs', 'model.mjs', 'render.mjs'], 'inlined in dependency order');
});

test('the page: one self-contained file in the house — pre-rendered, facts embedded, script compiles, nothing fetched, within budget (P-10)', async () => {
  const f = await facts(); const html = assemble(f);
  const lean = withoutFontFaces(html);
  assert.ok(Buffer.byteLength(lean) < BUDGET, `under the budget with the font block removed: ${Buffer.byteLength(lean)} bytes`);
  assert.ok((html.match(/@font-face/g) || []).length >= 3 && /url\("data:font\/woff2;base64,/.test(html), 'the house fonts are inlined');
  assert.deepEqual(factsOf(html), JSON.parse(JSON.stringify(f)));
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
  assert.ok(!/^\s*(import|export)\s/m.test(scriptOf(html)));
  assert.ok(!/(?:src|href)\s*=\s*["']?https?:|url\(\s*["']?https?:|@import|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/i.test(html), 'no external resource, no request of any kind');
  assert.ok(!/position:\s*fixed/.test(html), 'embeddable: no fixed chrome');
  for (const use of html.matchAll(/href="#i-([a-z0-9-]+)"/g)) assert.ok(html.includes(`<symbol id="i-${use[1]}"`), `glyph ${use[1]} is in the sprite`);
  for (const g of GLYPHS) assert.ok(html.includes(`<symbol id="i-${g}"`), g);
  assert.match(html, /<header class="art-bar"><span class="seal">[\s\S]*<h1 class="art-name">A territory in org-os<\/h1>/);
  assert.match(html, /<div id="app" class="xp-app"><div id="banner" role="note">/, 'the first paint is pre-rendered');
  assert.match(html, /<div id="band" class="xp-band" role="status"><\/div>/, 'the band\'s status region is there from the start, empty');
  assert.match(html, /<\/main>\s*<\/div>\s*<p class="sr-only" id="live" aria-live="polite"><\/p>/, 'one persistent live region, outside the re-rendered #app');
  assert.match(html, /data-key="tour-start">Take the tour/);
  assert.match(html, /@media print/);
});

test('no dimming, no theme toggle (P-11): nothing is drawn faded, and light and dark follow the reader', async () => {
  const f = await facts(); const html = assemble(f);
  const pages = SHARES.flatMap((share) => VIEWS.flatMap((who) => UNITS.map((u) => Object.values(R.slots(view({ ...initialState(), selected: u.unit_id, share, view: who, menu: true }, f))).join(''))));
  for (const text of [html, ...pages]) {
    assert.ok(!/is-dimmed|--o-dim|opacity:\s*var\(--dim\)/.test(text.replace(/<style>[\s\S]*?<\/style>/, '')), 'no dimming class or token in the markup');
    assert.ok(!/data-action="theme"|toggle-theme/.test(text), 'no theme control');
  }
  assert.ok(!/<html[^>]*data-theme/.test(html), 'the page sets no theme');
  assert.ok(!/matchMedia|dataset\.theme/.test(explorerSrc('app.js')), 'app.js never touches the theme');
});

test('explorer/styles.css: layout only, tokens only — no colour literal, no token definitions, no theme rules; the inspector stacks under 860', () => {
  const css = explorerSrc('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'no hex colour');
  assert.ok(!/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(css), 'no colour function');
  const named = /(?:^|[\s:,(])(?:white|black|red|green|blue|gray|grey|silver|maroon|purple|fuchsia|lime|olive|yellow|navy|teal|aqua|orange|pink|brown)(?=[\s;,)!]|$)/im;
  assert.ok(!named.test(css), 'no named colour');
  assert.ok(!/(?:^|[{;\s])--[a-z0-9-]+\s*:/i.test(css), 'tokens come from the house; the explorer defines none');
  assert.ok(!/prefers-color-scheme|data-theme/.test(css), 'the house tokens own light and dark');
  assert.ok(!/--o-dim|opacity/.test(css), 'nothing is faded');
  assert.match(css, /@container art \(max-width: 860px\) \{[^}]*\.xp-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.insp \.fields \{ grid-template-columns: minmax\(var\(--w-kind\), max-content\) minmax\(0, 1fr\); \}/, 'R-30: the inspector keeps its field rows side by side, as the gallery draws them');
  assert.match(css, /\.va-l \{ position: absolute; width: var\(--sp-1\); height: var\(--sp-1\); overflow: hidden; clip-path: inset\(50%\)/, 'on a phone the View as words are clipped, never display:none');
});

test('the page script: render atoms come from kms, and the browser gets the same ones', () => {
  const a = atoms();
  assert.equal(R.ic('pin'), '<svg class="i" aria-hidden="true"><use href="#i-pin"/></svg>');
  assert.equal(R.ktile('stream'), a.ktile.stream);
  assert.match(R.ATOMS.band, /^<div class="band static">/);
  const ctx = {};
  vm.runInNewContext(`${pageScript({ app: '' })}\nthis.out = ic('pin') + ktile('swap') + note('x');`, ctx);
  assert.equal(ctx.out, R.ic('pin') + R.ktile('swap') + R.note('x'));
});

test('build writes the file where told and nowhere else', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'explorer-out-')), 'x', 'index.html');
  const r = await build({ out });
  assert.equal(r.out, out); assert.ok(existsSync(out)); assert.ok(r.leanBytes < BUDGET);
  assert.match(DEFAULT_OUT, /explorer\/dist\/index\.html$/);
});

// ── Task 10: the wiring, driven without a browser ────────────────────────────────────────────────────────────────────
// A minimal stand-in for the DOM: three slots (#tools, #band, #app) filled by app.js; an element is found by its data-key, and its
// attributes are read back from the markup the slots hold.
function boot(html) {
  const handlers = {}; const focused = []; const marked = []; const scrolled = []; const live = { textContent: '' };
  const slots = { tools: { innerHTML: '' }, band: { innerHTML: '' }, app: { innerHTML: '' } };
  const all = () => slots.tools.innerHTML + slots.band.innerHTML + slots.app.innerHTML;
  const keyOf = (sel) => (sel.match(/^\[data-key="(.*)"\]$/) || [])[1];
  const tagOf = (k) => { const m = all().match(new RegExp(`<[a-z][a-z0-9]* [^>]*data-key="${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`)); return m && m[0]; };
  const attr = (tag, a) => { const m = tag.match(new RegExp(` ${a}="([^"]*)"`)); return m ? m[1] : null; };
  const cache = new Map(); const ring = new Set(); // keys whose element carries is-tour-target
  function handle(k) {
    if (!tagOf(k)) return null;
    if (!cache.has(k)) {
      const e = { focus() { focused.push(k); }, classList: { add(c) { marked.push([k, c]); if (c === 'is-tour-target') ring.add(k); }, remove(c) { if (c === 'is-tour-target') ring.delete(k); }, contains: (c) => c === 'is-tour-target' && ring.has(k) }, scrollIntoView(o) { scrolled.push([k, o && o.block]); },
        getAttribute: (a) => attr(tagOf(k), a), hasAttribute: (a) => attr(tagOf(k), a) !== null, setAttribute() {},
        get dataset() { const t = tagOf(k); return { action: attr(t, 'data-action'), value: attr(t, 'data-value'), id: attr(t, 'data-id'), key: k, name: attr(t, 'data-name'), change: attr(t, 'data-change') }; },
        closest(sel) {
          if (sel === '[role="treeitem"]') return attr(tagOf(k), 'role') === 'treeitem' ? e : null;
          if (sel === '[role="tree"]') { if (attr(tagOf(k), 'role') !== 'treeitem') return null; const layer = all().split(/role="tree"/).find((part) => part.includes(`data-key="${k}"`)); return { querySelectorAll: () => [...layer.matchAll(/<li role="treeitem"[^>]*data-key="([^"]*)"/g)].map((m) => handle(m[1])) }; }
          if (sel === '[data-action]') return attr(tagOf(k), 'data-action') ? e : null;
          if (sel === '[data-change]') return attr(tagOf(k), 'data-change') ? e : null;
          if (sel === '[role="menu"]') return null;
          return null;
        } };
      cache.set(k, e);
    }
    return cache.get(k);
  }
  const query = (sel) => { const k = keyOf(sel); return k ? handle(k) : null; };
  const document = {
    getElementById: (id) => { if (id === 'facts') return { textContent: html.match(/id="facts">([\s\S]*?)<\/script>/)[1] }; if (id === 'live') return live; if (slots[id]) return slots[id];
      if (id === 'tour') { const m = all().match(/id="tour"[^>]*data-target="([^"]*)"/); return m ? { dataset: { target: m[1] } } : null; } return null; },
    querySelector: query, querySelectorAll: (sel) => (sel === '.is-tour-target' ? [...ring].map(handle).filter(Boolean) : []),
    addEventListener: (type, fn) => { handlers[type] = fn; } };
  vm.runInNewContext(scriptOf(html), { document, window: {}, JSON, Array, Object, String, Boolean, Math, Set, Number });
  const raw = (dataset) => ({ dataset, closest: (sel) => (sel === '[data-action]' && dataset.action ? raw(dataset) : sel === '[data-change]' && dataset.change ? raw(dataset) : null) });
  return { slots, live, focused, marked, scrolled, handle, ringed: () => [...ring].filter((k) => tagOf(k)),
    click: (dataset) => handlers.click({ target: raw(dataset) }),
    change: (dataset, value) => handlers.change({ target: { ...raw(dataset), value } }),
    key: (key, k) => { let prevented = false; handlers.keydown({ key, target: k ? handle(k) : raw({}), preventDefault() { prevented = true; } }); return prevented; } };
}

test('app.js: a click selects, a change switches what you share, the menu picks who you view as, the band appears and goes, the tour runs and Esc ends it', async () => {
  const page = boot(assemble(await facts()));
  page.click({ action: 'select', id: CAT });
  assert.match(page.slots.app.innerHTML, /<h2 id="panel-h" class="t">Catalunya<\/h2>[\s\S]*What’s here<\/h3><span class="cnt">3<\/span>/);
  assert.equal(page.live.textContent, 'Catalunya selected, 3 things here.', 'the persistent live region is updated outside #app');
  page.change({ change: 'toggle-inside', key: 'inside' });
  assert.match(page.slots.app.innerHTML, /What’s here<\/h3><span class="cnt">1<\/span>/);
  page.click({ action: 'menu', value: 'toggle', key: 'viewas' });
  assert.match(page.slots.tools.innerHTML, /role="menu"/);
  page.click({ action: 'share', value: 'units', key: 'share:units' });
  assert.match(page.slots.tools.innerHTML, /role="menu"/, 'still open after choosing what you share');
  page.click({ action: 'view', value: 'peer-nopack', key: 'view:peer-nopack' });
  assert.ok(!page.slots.tools.innerHTML.includes('role="menu"'), 'closed after choosing who you view as');
  assert.match(page.slots.band.innerHTML, /Previewing as a peer without the pack/);
  assert.match(page.slots.app.innerHTML, /Pick a place/, 'Catalunya is not received by this peer: the prompt');
  assert.equal(page.focused.at(-1), 'viewas', 'focus returns to the View as button');
  page.click({ action: 'view', value: 'you', key: 'exit-preview' });
  assert.equal(page.slots.band.innerHTML, '');
  assert.match(page.slots.app.innerHTML, /<h2 id="panel-h" class="t">Catalunya<\/h2>/, 'Exit preview shows it again');
  page.click({ action: 'tour', value: 'start' });
  assert.match(page.slots.app.innerHTML, /Step 1 of 6/);
  page.click({ action: 'tour', value: 'next' });
  assert.match(page.slots.app.innerHTML, /Step 2 of 6/);
  page.key('Escape');
  assert.ok(!page.slots.app.innerHTML.includes('id="tour"'));
  page.click({ action: 'menu', value: 'toggle', key: 'viewas' });
  page.key('Escape');
  assert.ok(!page.slots.tools.innerHTML.includes('role="menu"'), 'Esc closes the menu');
  assert.equal(page.focused.at(-1), 'viewas');
});

test('app.js: the trees answer the APG keys through treeKey — arrows move focus, → / ← open and close, Enter selects', async () => {
  const page = boot(assemble(await facts()));
  page.click({ action: 'select', id: CAT });
  assert.ok(page.key('ArrowDown', `unit:${CAT}`));
  assert.equal(page.focused.at(-1), 'unit:administrative:vegueria:catalunya-central');
  page.key('End', `unit:${CAT}`);
  assert.equal(page.focused.at(-1), 'unit:administrative:municipi:manresa');
  page.key('ArrowLeft', `unit:${CAT}`);
  assert.match(page.slots.app.innerHTML, /aria-expanded="false"[^>]*aria-label="Catalunya/, '← closes an open place');
  assert.equal(page.focused.at(-1), `unit:${CAT}`, 'and focus stays on it');
  page.key('ArrowRight', `unit:${CAT}`);
  assert.match(page.slots.app.innerHTML, /aria-expanded="true"[^>]*aria-label="Catalunya/);
  page.key('Enter', 'unit:administrative:comarca:osona');
  assert.match(page.slots.app.innerHTML, /<h2 id="panel-h" class="t">Osona<\/h2>/);
  assert.equal(page.key('x', 'unit:administrative:comarca:osona'), false, 'a key with no meaning is left alone');
  assert.match(explorerSrc('app.js'), /treeKey\(/);
});

test('app.js: focus goes where the visitor expects — the clicked control, the tour card, and back to "Take the tour" when the tour ends by Skip, Finish or Esc; the highlighted target is scrolled into view', async () => {
  const page = boot(assemble(await facts()));
  page.click({ action: 'select', id: CAT });
  assert.equal(page.focused.at(-1), `unit:${CAT}`);
  page.click({ action: 'tour', value: 'start', key: 'tour-start' });
  assert.equal(page.focused.at(-1), 'tour-h');
  assert.deepEqual(page.marked.at(-1), [`unit:${PLANA}`, 'is-tour-target']);
  assert.deepEqual(page.scrolled.at(-1), [`unit:${PLANA}`, 'nearest']);
  page.click({ action: 'tour', value: 'end', key: 'tour-end' });
  assert.equal(page.focused.at(-1), 'tour-start', 'Skip');
  page.click({ action: 'tour', value: 'start', key: 'tour-start' });
  for (let i = 0; i < 4; i++) page.click({ action: 'tour', value: 'next', key: 'tour-next' });
  assert.match(page.slots.app.innerHTML, /Step 5 of 6/);
  assert.deepEqual(page.marked.at(-1), ['band', 'is-tour-target'], 'step 5 points at the band');
  page.click({ action: 'tour', value: 'next', key: 'tour-next' });
  assert.deepEqual(page.marked.at(-1), ['drawer-pack-body', 'is-tour-target']);
  page.click({ action: 'tour', value: 'next', key: 'tour-next' });
  assert.ok(!page.slots.app.innerHTML.includes('id="tour"'));
  assert.equal(page.focused.at(-1), 'tour-start', 'Finish');
  page.click({ action: 'tour', value: 'start', key: 'tour-start' });
  page.key('Escape');
  assert.equal(page.focused.at(-1), 'tour-start', 'Esc');
});

test('app.js: the tour ring goes with the tour — ending at step 5 (the band, which outlives the re-render) by Skip or Esc leaves no element ringed', async () => {
  for (const end of ['skip', 'esc']) {
    const page = boot(assemble(await facts()));
    page.click({ action: 'tour', value: 'start', key: 'tour-start' });
    for (let i = 0; i < 4; i++) page.click({ action: 'tour', value: 'next', key: 'tour-next' });
    assert.deepEqual(page.ringed(), ['band'], 'step 5 rings the band, and only the band');
    if (end === 'skip') page.click({ action: 'tour', value: 'end', key: 'tour-end' }); else page.key('Escape');
    assert.match(page.slots.band.innerHTML, /Previewing as a peer with the pack/, `${end}: the band is still there (the view did not change)`);
    assert.deepEqual(page.ringed(), [], `${end}: no element carries is-tour-target`);
  }
  const page = boot(assemble(await facts()));
  page.click({ action: 'tour', value: 'start', key: 'tour-start' });
  page.click({ action: 'tour', value: 'next', key: 'tour-next' });
  assert.deepEqual(page.ringed(), ['inside'], 'moving on moves the ring: one target at a time');
});

// ── Task 11: whole-page acceptance ───────────────────────────────────────────────────────────────────────────────────

test('acceptance: it is an explorer, not a report — none of the report\'s vocabulary or jargon reaches the visitor, in any place, share, view, drawer or tour step', async () => {
  const f = await facts();
  const states = UNITS.flatMap((u) => SHARES.flatMap((share) => VIEWS.map((who) => ({ ...initialState(), selected: u.unit_id, share, view: who, menu: true }))));
  const pages = states.flatMap((st) => [st, { ...st, drawer: 'pack' }, { ...st, drawer: 'about' }]).map((st) => { const v = view(st, f); return `${Object.values(R.slots(v)).join('')} ${v.live}`; });
  let t = reduce(initialState(), { type: 'tour', value: 'start' }, f);
  for (const step of STEPS) { pages.push(Object.values(R.slots(view(t, f))).join(''), `${step.title} ${step.text}`); t = reduce(t, { type: 'tour', value: 'next' }, f); }
  const visible = [assemble(f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ''), ...pages].join('\n');
  assert.equal(pages.length, UNITS.length * SHARES.length * VIEWS.length * 3 + STEPS.length * 2, 'the scan covers every place × share × view × drawer, and every tour step (card + text)');
  assert.ok(visible.includes('Step 6 of 6'), 'including the last one');
  for (const banned of [/publish matrix/i, /try to break it/i, /ℹ pass/, /lexicon/i, /\bNSID\b/, /\bschema\b/i, /Layer-[AB]/, /collection/i, /\bPDS\b/, /atproto/i, /\d+ tests?\b/i, /grey(?:ed)?[- ]out/i, /!/]) assert.ok(!banned.test(visible.replace(/<!--[\s\S]*?-->|<!DOCTYPE html>/gi, '')), String(banned));
});

test('acceptance: honesty — the banner is always there, every share on every place is tagged invented, no claim beyond the build', async () => {
  const f = await facts();
  for (const u of UNITS) {
    const html = R.renderApp(view(reduce(initialState(), { type: 'select', id: u.unit_id }, f), f));
    assert.match(html, /id="banner" role="note">[\s\S]*?Illustrative sample/);
    assert.equal(count(html, /% of theirs/g), count(html, /% of theirs<\/span><span class="inv">invented<\/span>/g), u.unit_id);
    assert.equal(count(html, /class="meter-l"/g), count(html, /class="inv">invented</g), `${u.unit_id}: every share drawn on a meter is tagged`);
  }
  const everything = UNITS.flatMap((u) => SHARES.flatMap((share) => VIEWS.map((who) => R.renderApp(view({ ...initialState(), selected: u.unit_id, share, view: who, drawer: 'pack' }, f))))).join('');
  // A source system's own name in the illustrative catalogue is a recorded fact, not an integration claim: "Decidim" may appear only as a recorded provider's title.
  const withoutProviders = f.territory.streams.providers.reduce((text, p) => text.replaceAll(R.esc(p.title), ''), everything);
  for (const unbuilt of [/hatch/i, /geojson file|geometry_ref/i, /downgrad/i]) assert.ok(!unbuilt.test(everything), String(unbuilt));
  assert.ok(!/decidim/i.test(withoutProviders), 'no Decidim wording outside a provider\'s own recorded title');
  assert.equal(count(everything, /Not built yet/g), UNITS.length * SHARES.length * VIEWS.length, 'the fallback sentence is marked wherever the pack drawer is open');
});

test('acceptance: accessible basics — one h1, one main, a skip link, APG trees, a complementary inspector, a status band, a live region, typed buttons', async () => {
  const f = await facts();
  const html = assemble(f).replace(/<script>[\s\S]*?<\/script>/, '');
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.equal(count(html, /<main[ >]/g), 1);
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<section class="surf xp-board" id="board" aria-labelledby="board-h">/);
  assert.match(html, /<aside class="insp surf" id="panel" aria-labelledby="panel-h">/);
  assert.equal(count(html, /<ul class="tree" role="tree"/g), 4);
  for (const m of html.matchAll(/role="tree" aria-labelledby="([^"]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), m[1]);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  const all = [html, ...SHARES.flatMap((share) => VIEWS.map((who) => Object.values(R.slots(view({ ...initialState(), selected: PLANA, share, view: who, menu: true, drawer: 'pack' }, f))).join('')))].join('');
  assert.equal(count(all, /<button(?![^>]*type="button")/g), 0, 'every button declares its type');
  assert.ok(!/aria-controls="([^"]+)"/.test(html) || [...html.matchAll(/aria-controls="([^"]+)"/g)].every((m) => html.includes(`id="${m[1]}"`)), 'aria-controls only names what is there');
  assert.equal(count(html, /<html lang="en"/g), 1);
});
