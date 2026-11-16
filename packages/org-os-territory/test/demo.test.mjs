// packages/org-os-territory/test/demo.test.mjs — the demo: sample data, real-run capture, renderer, built page.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fw, loadExtensions, reset, cleanup } from '../demo/capture/env.mjs';
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
import { assemble, build, stripExports, safeJson, pageScript, withoutFontFaces, DEFAULT_OUT } from '../demo/build.mjs';
import * as R from '../demo/render.mjs';

beforeEach(() => reset());
after(() => cleanup());

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

test('verified (--skip-suites): commit list and the modified-test list are read from git (shape only — this worktree is read, never written); suites are marked skipped', () => {
  const v = verified({ skipSuites: true });
  assert.equal(v.skipped, true);
  assert.match(v.base, /^[0-9a-f]{40}$/);
  assert.ok(Array.isArray(v.commits) && v.commits.every((c) => /^[0-9a-f]{7,} \S/.test(c)), 'each commit line is "<hash> <subject>"');
  assert.ok(Array.isArray(v.testDirsModified) && v.testDirsModified.every((p) => /^packages\/(toolkit-framework|org-os-kms)\/test\//.test(p)), 'modified pre-existing tests, by path');
  assert.equal(v.testDirsUnmodified, v.testDirsModified.length === 0);
  assert.deepEqual(v.suites, []);
});

// R-3: a branch that changes pre-existing tests on purpose is reported, not refused. Run against a fresh repo under os.tmpdir().
test('verified: modified pre-existing tests are listed as evidence (equal to what git reports), never a build failure', () => {
  const repo = mkdtempSync(join(tmpdir(), 'demo-verified-'));
  try {
    const git = (...a) => {
      const r = spawnSync('git', ['-c', 'user.name=Field steward', '-c', 'user.email=steward@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: repo, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const put = (rel, text) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text); };
    git('init', '-q', '-b', 'main');
    put('packages/org-os-kms/test/a.test.mjs', 'a\n');
    put('packages/org-os-kms/test/keep.test.mjs', 'keep\n');
    put('packages/toolkit-framework/test/b.test.mjs', 'b\n');
    put('packages/other/test/c.test.mjs', 'c\n');
    git('add', 'packages');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feat');
    put('packages/org-os-kms/test/a.test.mjs', 'a changed\n');
    rmSync(join(repo, 'packages/toolkit-framework/test/b.test.mjs'));
    put('packages/org-os-kms/test/new.test.mjs', 'added, not pre-existing\n');
    put('packages/other/test/c.test.mjs', 'c changed, outside the two directories\n');
    git('add', 'packages');
    git('commit', '-q', '-m', 'change two pre-existing tests');
    const v = verified({ skipSuites: true, repo });
    const fromGit = git('diff', `${v.base}..HEAD`, '--name-only', '--diff-filter=MDR', '--', 'packages/toolkit-framework/test', 'packages/org-os-kms/test').split('\n').filter(Boolean);
    assert.deepEqual(v.testDirsModified, fromGit);
    assert.deepEqual(v.testDirsModified, ['packages/org-os-kms/test/a.test.mjs', 'packages/toolkit-framework/test/b.test.mjs']);
    assert.equal(v.testDirsUnmodified, false);
    assert.equal(v.commits.length, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
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

test('the page: the house shell — artifact bar, intro callout, the seam section, embedded facts; no theme control (K-19), no table, no request; compiles; within budget (P-10)', async () => {
  const facts = await getFacts();
  const html = assemble(facts);
  assert.match(html, /<section id="seam"/);
  assert.match(html, /captured by running the real code/);
  assert.match(html, /<header class="art-bar">[\s\S]*?<h1 class="art-name">Packs for the knowledge plane<\/h1>/, 'the artifact bar, from kms');
  assert.ok(html.includes(`<time datetime="${facts.meta.capturedAt}">`), 'the capture time, machine-readable');
  assert.ok(!/toggle-theme/.test(html) && !/<html[^>]*\sdata-theme=/.test(html) && !/<button[^>]*>[^<]*theme/i.test(html), 'no theme control: light and dark follow the reader (the house tokens answer prefers-color-scheme)');
  assert.ok(!/<table\b/i.test(html), 'every table became rows');
  assert.match(html, /class="skip" href="#main"/);
  assert.match(html, /<main id="main"/);
  const m = /<script type="application\/json" id="facts">([\s\S]*?)<\/script>/.exec(html);
  assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(facts)));
  assert.equal((html.match(/<\/script>/g) || []).length, 2, 'exactly the facts block and the code block');
  assert.doesNotThrow(() => new vm.Script(pageScript()), 'the inlined code must compile');
  assert.ok(!/(?:src|href)\s*=\s*["']https?:/i.test(html) && !/url\(\s*["']?https?:/i.test(html) && !/\bfetch\s*\(/.test(html) && !/@import\b/.test(html), 'no external resources');
  assert.ok((html.match(/@font-face/g) || []).length >= 3 && /url\("data:font\/woff2;base64,/.test(html), 'the house fonts are inlined');
  const lean = withoutFontFaces(html);
  assert.ok(!/@font-face/.test(lean));
  assert.ok(Buffer.byteLength(lean) < 300 * 1024, `under the size budget with the font block removed: ${Buffer.byteLength(lean)} bytes`);
  for (const use of html.matchAll(/href="#i-([a-z0-9-]+)"/g)) assert.ok(html.includes(`<symbol id="i-${use[1]}"`), `glyph ${use[1]} is in the sprite`);
});

test('demo/styles.css: report layout only, tokens only — no colour literal, no token definitions, no theme rules', () => {
  const css = demoSrc('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'no hex colour');
  assert.ok(!/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(css), 'no colour function');
  const named = /(?:^|[\s:,(])(?:white|black|red|green|blue|gray|grey|silver|maroon|purple|fuchsia|lime|olive|yellow|navy|teal|aqua|orange|pink|brown)(?=[\s;,)!]|$)/im;
  assert.ok(!named.test(css), 'no named colour');
  assert.ok(!/(?:^|[{;\s])--[a-z0-9-]+\s*:/i.test(css), 'tokens come from the house; the report defines none');
  assert.ok(!/prefers-color-scheme|data-theme/.test(css), 'the house tokens own light and dark');
  assert.ok(!/<table|\btable\b|\bth\b|\btd\b/.test(css), 'no table styles');
});

test('the page script: render atoms come from kms (mark, icon, note, callout), and the browser gets the same ones', () => {
  assert.match(R.mk('done', 'Held'), /^<span class="sm done"><i aria-hidden="true"><\/i><span class="w">Held<\/span><\/span>$/);
  assert.equal(R.mk('open', '<x>'), '<span class="sm open"><i aria-hidden="true"></i><span class="w">&lt;x&gt;</span></span>');
  assert.equal(R.ic('check'), '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>');
  assert.match(R.ck(), /class="ck"/);
  const ctx = {};
  vm.runInNewContext(`${pageScript({ app: '' })}\nthis.out = mk('done', 'Held') + ic('check');`, ctx);
  assert.equal(ctx.out, R.mk('done', 'Held') + R.ic('check'));
});

test('renderSeam: reads the core schema count and the pack-added schemas from the captured facts; before/after surfaces with the pack in a moss slot; the claims are check rows', async () => {
  const f = await getFacts();
  const h = R.renderSeam(f);
  assert.ok(h.includes(`core schemas <b>${f.packInfo.none.schemas.length}</b>`));
  assert.match(h, /<div class="vs">[\s\S]*Before[\s\S]*After/);
  const slot = /<div class="slot on">([\s\S]*?)<\/div>/.exec(h);
  assert.ok(slot, 'the pack addition sits in the moss slot');
  for (const s of f.packInfo.territory.added.schemas) assert.ok(slot[1].includes(`<code>${s}</code>`), s);
  assert.match(h, /unchanged/);
  assert.equal((h.match(/<li class="claim">/g) || []).length, 4);
  assert.equal((h.match(/class="ck"/g) || []).length, 4, 'each claim carries the done disc');
  assert.match(h, /<span class="ev">/, 'each claim names its evidence');
  assert.ok(!/<table\b/.test(h));
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
  };
  vm.runInNewContext(pageScript(), { document: doc });
  const el = (dataset) => ({ dataset, setAttribute() {}, parentElement: { querySelectorAll: () => [] } });
  return {
    panels, doc,
    click: (action, data = {}) => listeners.click({ target: { closest: () => el({ action, ...data }) } }),
    change: (name, value, data = {}) => listeners.change({ target: { closest: () => ({ ...el({ change: name, ...data }), value }) } }),
  };
}

test('section 2: the pack panel is rendered from the captured facts as rows; the selector switches it; there is no theme toggle', async () => {
  const f = await getFacts();
  const on = R.renderPackPanel(f, 'territory');
  assert.match(on, /territorial-unit/);
  assert.match(on, /maps_to_core/);
  assert.ok(on.includes('<code>place</code>') && on.includes('<code>artifact</code>'));
  assert.ok(on.includes('<span class="t"><code>unit_id</code>'), 'a lexicon property is a row');
  assert.ok(on.includes('<span class="t"><code>territorial-unit</code></span>'), 'an entity is a row');
  assert.ok(on.includes('<code>data/territorial-units.yaml</code>'), 'a registry binding is a row');
  assert.match(on, /<pre class="well">[\s\S]*&gt;=0\.3\.0/, 'the manifest, with its requires floor, in a well');
  assert.match(on, /flat: [a-z, ]*boolean/);
  assert.ok(!/<table\b/.test(on));
  assert.ok(on.includes(`<b>${f.packInfo.territory.lexiconCount} lexicons</b>`));
  assert.ok(R.renderPack(f).includes('role="group" aria-label="Instance configuration"'), 'the selector is a labelled group');
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
  assert.ok(!/theme|matchMedia/.test(demoSrc('app.js')), 'light and dark follow the reader (K-19)');
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
  const units = f.matrix.find((m) => m.id === 'pack-units');
  for (const c of units.collections) assert.ok(h('pack-units').includes(`<span class="t"><code>${c.collection}</code></span></span><span class="end">${c.count}</span>`), `${c.collection} is a row with its record count`);
  for (const m of f.matrix) assert.ok(!/<table\b/.test(h(m.id)), `${m.id}: rows, not a table`);
  assert.match(h('no-pack-optin'), /<pre class="well">[^<]*unknown publishable type/, 'the refusal, verbatim, in a well');
  assert.ok(R.renderGuarantees(f).includes('role="group" aria-label="Publish configuration"'));
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
  for (const a of f.attempts) assert.ok(R.renderAttemptPanel(f, a.id).includes(`<pre class="well">${R.esc(a.error)}</pre>`), `${a.id}: the error sits in a well`);
  assert.ok(R.renderAttemptPanel(f, 'unquoted-yaml').includes('&lt;packages&gt;/bad-pack/pack.yaml'));
  assert.ok(R.sections().some((s) => s.id === 'attempts' && s.order === 4));
  assert.ok(R.renderAttempts(f).includes(`${f.attempts.length} ways to get a pack wrong`), 'the attempts count is read from the facts');
  const app = runApp(f);
  app.click('pick-attempt', { id: 'unmet-requires' });
  assert.match(app.panels.attempt.innerHTML, /requires framework &gt;=99\.0\.0/);
});

test('section 7: suites as rows, the pre-existing-test check and the commit list render from the facts; a skipped build says so; modified tests are listed in Mono as deliberate', async () => {
  const f = await getFacts();
  const skipped = R.renderVerified(f);
  assert.match(skipped, /not run in this build/i);
  assert.match(skipped, /<h3>Pre-existing tests<\/h3>/);
  // Branch-specific output depends on whether the branch has commits over main, so it is asserted on explicit facts, never on git state.
  const clean = { ...f.verified, commits: ['abcdef0 a subject', '1234567 another'], testDirsModified: [], testDirsUnmodified: true };
  const withBranch = R.renderVerified({ ...f, verified: clean });
  assert.match(withBranch, /diff-filter=MDR/);
  assert.match(withBranch, /printed nothing/);
  assert.ok(withBranch.includes('<code>abcdef0</code> a subject') && withBranch.includes('<code>1234567</code> another'));
  assert.match(withBranch, /2 commits over/);
  const modified = ['packages/org-os-kms/test/map.test.mjs', 'packages/toolkit-framework/test/x.test.mjs'];
  const changed = R.renderVerified({ ...f, verified: { ...clean, testDirsModified: modified, testDirsUnmodified: false } });
  assert.doesNotMatch(changed, /printed nothing/);
  assert.match(changed, /changes these pre-existing tests on purpose/);
  assert.match(changed, /2 pre-existing test files/);
  for (const p of modified) assert.ok(changed.includes(`<li><code>${p}</code></li>`), `${p} listed in Mono`);
  const ran = R.renderVerified({ ...f, verified: { ...clean, skipped: false, commits: ['abcdef0 a subject'], suites: [{ name: 'toolkit-framework', tests: 205, pass: 205, fail: 0, skipped: 0 }, { name: 'org-os-kms', tests: 181, pass: 180, fail: 0, skipped: 1 }] } });
  assert.ok(ran.includes('<span class="t">toolkit-framework</span>') && ran.includes('<span class="t">org-os-kms</span>'), 'each suite is a row');
  assert.ok(ran.includes('<b>205</b> tests') && ran.includes('<b>180</b> pass') && ran.includes('<b>1</b> skipped'));
  assert.ok(!/<table\b/.test(ran));
  assert.ok(!/not run in this build/i.test(ran));
  assert.ok(ran.includes('<code>abcdef0</code> a subject'));
  assert.ok(R.sections().some((s) => s.id === 'verified' && s.order === 7));
});

test('section 7: on the base branch (no commits over main) the page says there is no branch diff to check, instead of claiming an empty diff', async () => {
  const f = await getFacts();
  const onBase = R.renderVerified({ ...f, verified: { ...f.verified, commits: [] } });
  assert.match(onBase, /no branch diff to check/);
  assert.doesNotMatch(onBase, /printed nothing/);
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
  assert.ok(pv.includes('<span class="t"><code>administrative:comarca:osona</code></span>'), 'each overlap is a row');
  assert.ok(!/<table\b/.test(pv) && !/<table\b/.test(t));
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
  for (const s of f.territory.streams.streams) assert.ok(h.includes(`<span class="t">${R.esc(s.title)}</span>`), `${s.title} is a row`);
  assert.ok(!/<table\b/.test(h));
  for (const p of f.territory.streams.providers) assert.ok(h.includes(R.esc(p.title)), p.title);
  assert.match(h, /unverified/);
  assert.match(h, /CC-BY-NC-4\.0/);
  assert.ok(h.includes('territorial-unit:'), 'the published extensions.yaml');
  assert.match(h, /incompatible/i);
  assert.ok(h.includes('<b>14</b>') && h.includes('<b>12</b>'));
  assert.ok(h.includes('territorialUnit') && h.includes('dataStream'));
  assert.match(h, /dropped/i);
  assert.ok(R.sections().some((s) => s.id === 'federation' && s.order === 6));
});

test('section 5: a cross-layer unit pick clears the previous selection (exactly one unit button is pressed)', async () => {
  const f = await getFacts();
  const listeners = {}; const panels = {};
  const doc = {
    getElementById: () => ({ textContent: JSON.stringify(f) }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: (sel) => { const m = /data-panel="([^"]+)"/.exec(sel); return m ? (panels[m[1]] ??= { innerHTML: '' }) : null; },
  };
  vm.runInNewContext(pageScript(), { document: doc });
  const layerA = { kids: [] }; const layerB = { kids: [] }; const schematic = { kids: [] };
  for (const l of [layerA, layerB]) l.querySelectorAll = () => l.kids;
  schematic.querySelectorAll = () => [...layerA.kids, ...layerB.kids];
  const btn = (layer, id, pressed) => {
    const b = { dataset: { action: 'pick-unit', id }, attrs: { 'aria-pressed': String(pressed) }, parentElement: layer };
    b.setAttribute = (k, v) => { b.attrs[k] = v; };
    b.closest = (sel) => (sel === '.schematic' ? schematic : b);
    layer.kids.push(b); return b;
  };
  const osona = btn(layerA, 'administrative:comarca:osona', true);
  btn(layerA, 'administrative:pais:catalunya', false);
  const plana = btn(layerB, 'landscape:unit:plana-de-vic', false);
  listeners.click({ target: { closest: () => plana } });
  const pressed = schematic.querySelectorAll().filter((b) => b.attrs['aria-pressed'] === 'true');
  assert.deepEqual(pressed.map((b) => b.dataset.id), ['landscape:unit:plana-de-vic']);
  assert.equal(osona.attrs['aria-pressed'], 'false');
  assert.match(panels.unit.innerHTML, /Plana de Vic/);
});

test('the whole page: seven sections in order, navigable, accessible basics, and the captured numbers are the ones on the page', async () => {
  const f = await getFacts();
  const html = assemble(f);
  const ids = [...html.matchAll(/<section id="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['seam', 'pack', 'guarantees', 'attempts', 'territory', 'federation', 'verified']);
  for (const id of ids) {
    assert.ok(html.includes(`<a href="#${id}">`), `nav link for ${id}`);
    assert.ok(new RegExp(`<h2 id="${id}-h">`).test(html), `heading for ${id}`);
  }
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.equal((html.match(/<button(?![^>]*\stype=)/g) || []).length, 0, 'every button has an explicit type');
  assert.ok(!/<img\b/.test(html), 'no images to describe');
  assert.ok((html.match(/aria-pressed="(true|false)"/g) || []).length >= 15, 'segmented controls expose their state');
  assert.ok(!/<table\b/.test(html), 'no table anywhere');
  assert.ok(html.includes(`<b>${f.packInfo.territory.lexiconCount} lexicons</b>`));
  assert.ok(html.includes(`<b>${f.federation.peer.withPack.count}</b>`));
  for (const a of f.attempts) assert.ok(html.includes(R.esc(a.title)), `attempt "${a.id}" is selectable`);
  assert.ok(Buffer.byteLength(withoutFontFaces(html)) < 300 * 1024);
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('the generator writes only to demo/dist by default', () => {
  assert.ok(DEFAULT_OUT.endsWith(join('org-os-territory', 'demo', 'dist', 'index.html')));
});
