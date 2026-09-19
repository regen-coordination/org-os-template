// packages/org-os-territory/test/demo.test.mjs — the demo: sample data, real-run capture, renderer, built page.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { verified } from '../demo/capture/verified.mjs';
import { capture } from '../demo/capture.mjs';
import { assemble, build, stripExports, safeJson } from '../demo/build.mjs';
import * as R from '../demo/render.mjs';

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

test('verified (--skip-suites): commit list and the no-pre-existing-test-modified check are real; suites are marked skipped', () => {
  const v = verified({ skipSuites: true });
  assert.equal(v.skipped, true);
  assert.match(v.base, /^[0-9a-f]{40}$/);
  assert.ok(v.commits.length >= 12, 'the branch has at least the twelve pack commits');
  assert.equal(v.testDirsUnmodified, true);
  assert.deepEqual(v.suites, []);
});

test('capture: every section key is present, the whole thing serialises, and it fits the page budget', async () => {
  const facts = await capture({ skipSuites: true });
  assert.deepEqual(Object.keys(facts), ['meta', 'packInfo', 'matrix', 'oneProcess', 'attempts', 'territory', 'federation', 'verified']);
  assert.match(facts.meta.commit, /^[0-9a-f]{7,}$/);
  assert.equal(facts.meta.node, process.version);
  const json = JSON.stringify(facts);
  assert.ok(json.length < 150_000, `facts are ${json.length} chars`);
  assert.deepEqual(JSON.parse(json).matrix.map((m) => m.id), facts.matrix.map((m) => m.id));
});

let _facts;
const getFacts = () => (_facts ??= capture({ skipSuites: true }));
const demoSrc = (f) => readFileSync(new URL(`../demo/${f}`, import.meta.url), 'utf8');

test('build helpers: safeJson can never end its script block; stripExports removes only export keywords', () => {
  const nasty = { x: '</script><!--', y: String.fromCharCode(0x2028) };
  const out = safeJson(nasty);
  assert.ok(!out.includes('</script>') && !out.includes(String.fromCharCode(0x2028)));
  assert.deepEqual(JSON.parse(out), nasty);
  assert.equal(stripExports('export const a = 1;\nexport function b() {}\nexport async function c() {}\nconst d = 2;'), 'const a = 1;\nfunction b() {}\nasync function c() {}\nconst d = 2;');
});

test('the page: header, banner, theme control, the seam section, embedded facts; no external resources; compiles; within budget', async () => {
  const facts = await getFacts();
  const html = assemble(facts);
  assert.match(html, /<section id="seam"/);
  assert.match(html, /captured by running the real code/);
  assert.match(html, /data-action="toggle-theme"/);
  assert.match(html, /class="skip" href="#main"/);
  const m = /<script type="application\/json" id="facts">([\s\S]*?)<\/script>/.exec(html);
  assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(facts)));
  assert.equal((html.match(/<\/script>/g) || []).length, 2, 'exactly the facts block and the code block');
  assert.doesNotThrow(() => new vm.Script(stripExports(demoSrc('render.mjs')) + '\n' + demoSrc('app.js')), 'the inlined code must compile');
  assert.ok(!/(?:src|href)\s*=\s*["']https?:/i.test(html) && !/url\(\s*["']?https?:/i.test(html) && !/\bfetch\s*\(/.test(html), 'no external resources');
  assert.ok(Buffer.byteLength(html) < 300 * 1024, 'under the size budget');
});

test('renderSeam: reads the core schema count and the pack-added schemas from the captured facts', async () => {
  const f = await getFacts();
  const h = R.renderSeam(f);
  assert.ok(h.includes(`core schemas <b>${f.packInfo.none.schemas.length}</b>`));
  for (const s of f.packInfo.territory.added.schemas) assert.ok(h.includes(`<code>${s}</code>`), s);
  assert.match(h, /unchanged/);
});

test('build writes the file where told and nowhere else', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'demo-out-')), 'index.html');
  const r = await build({ skipSuites: true, out });
  assert.equal(r.out, out);
  assert.ok(existsSync(out) && statSync(out).size === r.bytes);
});

function runApp(facts) {
  const listeners = {}; const panels = {};
  const doc = {
    getElementById: () => ({ textContent: JSON.stringify(facts) }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: (sel) => { const m = /data-panel="([^"]+)"/.exec(sel); return m ? (panels[m[1]] ??= { innerHTML: '' }) : null; },
    documentElement: { dataset: { theme: 'auto' } },
  };
  const win = { matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(stripExports(demoSrc('render.mjs')) + '\n' + demoSrc('app.js'), { document: doc, window: win });
  const el = (dataset) => ({ dataset, setAttribute() {}, parentElement: { querySelectorAll: () => [] } });
  return {
    panels, doc,
    click: (action, data = {}) => listeners.click({ target: { closest: () => el({ action, ...data }) } }),
    change: (name, value, data = {}) => listeners.change({ target: { closest: () => ({ ...el({ change: name, ...data }), value }) } }),
  };
}

test('section 2: the pack panel is rendered from the captured facts; the selector switches it; the theme toggle works', async () => {
  const f = await getFacts();
  const on = R.renderPackPanel(f, 'territory');
  assert.match(on, /territorial-unit/);
  assert.match(on, /maps_to_core/);
  assert.ok(on.includes('<code>place</code>') && on.includes('<code>artifact</code>'));
  assert.ok(on.includes('<code>unit_id</code>'), 'lexicon property table');
  assert.match(on, /&gt;=0\.3\.0/, 'the manifest requires floor');
  const off = R.renderPackPanel(f, 'none');
  assert.match(off, /No pack loaded/);
  assert.ok(off.includes(`${f.packInfo.none.lexiconCount} lexicons`));
  assert.ok(!off.includes('unit_id'));
  assert.ok(R.sections().some((s) => s.id === 'pack' && s.order === 2));

  const app = runApp(f);
  app.click('pick-pack', { which: 'none' });
  assert.match(app.panels.pack.innerHTML, /No pack loaded/);
  app.click('pick-pack', { which: 'territory' });
  assert.match(app.panels.pack.innerHTML, /territorial-unit/);
  app.click('toggle-theme');
  assert.equal(app.doc.documentElement.dataset.theme, 'dark');
  app.click('toggle-theme');
  assert.equal(app.doc.documentElement.dataset.theme, 'light');
});

test('section 3: each of the five configurations renders its captured result; the one-process panel shows the leak, the filtered call and the stale file', async () => {
  const f = await getFacts();
  const h = (id) => R.renderMatrixPanel(f, id);
  assert.match(h('no-pack'), /resource/);
  assert.ok(!/territorialUnit/.test(h('no-pack')));
  assert.match(h('no-pack'), /extensions\.yaml/);
  assert.match(h('no-pack-optin'), /unknown publishable type: territorial-unit/);
  assert.match(h('pack-closed'), /nothing new published/i);
  assert.ok(h('pack-closed').includes('cat.regenerant.kb.resource'));
  assert.ok(!h('pack-closed').includes('cat.regenerant.kb.territorialUnit'));
  assert.ok(h('pack-units').includes('cat.regenerant.kb.territorialUnit'));
  assert.ok(h('pack-units').includes('<li><code>unit_id</code></li>'));
  assert.ok(!h('pack-units').includes('<li><code>notes</code></li>'), 'the private notes field is never among the published fields');
  assert.ok(h('pack-units-streams').includes('cat.regenerant.kb.dataStream'));
  const o = R.renderOneProcess(f);
  assert.match(o, /toJsonLdContext\(\)/);
  assert.match(o, /packs: \[\]/);
  assert.match(o, /stale/i);
  assert.ok(R.sections().some((s) => s.id === 'guarantees' && s.order === 3));

  const app = runApp(f);
  app.click('pick-matrix', { id: 'no-pack-optin' });
  assert.match(app.panels.matrix.innerHTML, /unknown publishable type/);
  app.click('pick-matrix', { id: 'pack-units' });
  assert.match(app.panels.matrix.innerHTML, /territorialUnit/);
});

test('section 4: every attempt renders its real input and real error; the known gap is shown, not hidden; the selector switches', async () => {
  const f = await getFacts();
  for (const a of f.attempts) {
    const h = R.renderAttemptPanel(f, a.id);
    assert.ok(h.includes(R.esc(a.error)), `${a.id}: the real error appears verbatim (escaped)`);
    assert.ok(h.includes(R.esc(a.title)));
    for (const path of Object.keys(a.files)) assert.ok(h.includes(R.esc(path)), `${a.id}: file ${path}`);
  }
  assert.match(R.renderAttemptPanel(f, 'connector-core-name'), /known gap/i);
  assert.match(R.renderAttemptPanel(f, 'schema-core-collision'), /names the pack/i);
  assert.match(R.renderAttemptPanel(f, 'missing-pack'), /no files/i);
  assert.ok(R.renderAttemptPanel(f, 'unquoted-yaml').includes('&lt;packages&gt;/bad-pack/pack.yaml'));
  assert.ok(R.sections().some((s) => s.id === 'attempts' && s.order === 4));
  assert.ok(R.renderAttempts(f).includes(`${f.attempts.length} ways to get a pack wrong`), 'the attempts count is read from the facts');
  const app = runApp(f);
  app.click('pick-attempt', { id: 'unmet-requires' });
  assert.match(app.panels.attempt.innerHTML, /requires framework &gt;=99\.0\.0/);
});

test('section 7: suites, the no-pre-existing-test-modified check and the commit list render from the facts; a skipped build says so', async () => {
  const f = await getFacts();
  const skipped = R.renderVerified(f);
  assert.match(skipped, /not run in this build/i);
  assert.match(skipped, /diff-filter/);
  assert.ok(skipped.includes(f.verified.commits[0].slice(0, 7)));
  const ran = R.renderVerified({ ...f, verified: { ...f.verified, skipped: false, suites: [{ name: 'toolkit-framework', tests: 205, pass: 205, fail: 0, skipped: 0 }, { name: 'org-os-kms', tests: 181, pass: 180, fail: 0, skipped: 1 }] } });
  assert.ok(ran.includes('<td>205</td>') && ran.includes('org-os-kms'));
  assert.ok(!/not run in this build/i.test(ran));
  assert.ok(R.sections().some((s) => s.id === 'verified' && s.order === 7));
});

test('section 5: the schematic lists every unit by layer; a unit panel shows the real query answers; the overlap panels show the real validator errors; unknown refs are reported', async () => {
  const f = await getFacts();
  const t = R.renderTerritory(f);
  assert.match(t, /not a map/i);
  assert.match(t, /illustrative/i);
  for (const u of f.territory.units) assert.ok(t.includes(R.esc(u.unit_id)), u.unit_id);
  const osona = R.renderUnitPanel(f, 'administrative:comarca:osona');
  assert.ok(osona.includes('Regenerative agriculture pilot (example)'), 'descendants include the municipality resource');
  assert.match(osona, /includeDescendants/);
  assert.ok(osona.includes('administrative:municipi:vic'));
  const pv = R.renderUnitPanel(f, 'landscape:unit:plana-de-vic');
  assert.ok(pv.includes('0.93') && pv.includes('0.42'));
  assert.match(pv, /invented/i);
  assert.match(t, /custom:site:ghost/);
  assert.match(R.renderOverlapPanel(f, 'valid'), /valid/);
  for (const flt of f.territory.overlaps.faults) for (const e of flt.errors) assert.ok(R.renderOverlapPanel(f, flt.id).includes(R.esc(e)), `${flt.id}: ${e}`);
  assert.ok(R.sections().some((s) => s.id === 'territory' && s.order === 5));
  const app = runApp(f);
  app.click('pick-unit', { id: 'administrative:pais:catalunya' });
  assert.match(app.panels.unit.innerHTML, /Catalonia-wide funding scan/);
  app.click('pick-overlap', { id: 'same-layer' });
  assert.match(app.panels.overlap.innerHTML, /same layer \(administrative\)/);
});

test('section 6: the stream catalogue, published extensions.yaml with the federateCheck verdict, the 14-vs-12 peer view, and inbound projection', async () => {
  const f = await getFacts();
  const h = R.renderFederation(f);
  for (const s of f.territory.streams.streams) assert.ok(h.includes(R.esc(s.title)), s.title);
  for (const p of f.territory.streams.providers) assert.ok(h.includes(R.esc(p.title)), p.title);
  assert.match(h, /unverified/);
  assert.match(h, /CC-BY-NC-4\.0/);
  assert.ok(h.includes('territorial-unit:'), 'the published extensions.yaml');
  assert.match(h, /incompatible/i);
  assert.ok(h.includes('<strong>14</strong>') && h.includes('<strong>12</strong>'));
  assert.ok(h.includes('territorialUnit') && h.includes('dataStream'));
  assert.match(h, /dropped/i);
  assert.ok(R.sections().some((s) => s.id === 'federation' && s.order === 6));
});
