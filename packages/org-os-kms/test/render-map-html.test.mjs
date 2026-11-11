// test/render-map-html.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMapHtml, renderLinksIndex } from '../src/render-map-html.mjs';
import { dispatch } from '../src/cli.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map', 'full');
const CLOSERS_BUNDLE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bundle-with-closers.js.txt');
const FAKE_BUNDLE = 'customElements.define("federation-map",class extends HTMLElement{});';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-html-'));
  cpSync(FIX, dir, { recursive: true });
  const bundle = join(dir, 'bundle.js');
  writeFileSync(bundle, FAKE_BUNDLE);
  return { dir, bundle };
}

test('writes a self-contained HTML with inlined bundle + inlined map data', () => {
  const { dir, bundle } = scratch();
  const r = renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  assert.equal(r.ok, true);
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  assert.ok(html.includes(FAKE_BUNDLE), 'bundle inlined');
  assert.ok(html.includes('"full-os"'), 'map data inlined');
  assert.ok(html.includes('<federation-map'), 'element present');
  assert.ok(!html.includes('src='), 'no external fetches — fully offline');
});

test('JSON is script-safe: </script> sequences are escaped', () => {
  const { dir, bundle } = scratch();
  // poison a name with a script-closing sequence
  writeFileSync(join(dir, 'federation.yaml'),
    'identity:\n  name: full-os\ndownstream:\n  - id: evil\n    name: "</script><script>alert(1)</script>"\n');
  renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  assert.ok(!html.includes('</script><script>alert(1)'), 'closing sequence neutralized');
});

// The script elements as an HTML parser sees them: each runs from its start tag to the first
// `</script` (any case) that follows — whatever JS context that `</script` sits in.
function scriptsOf(html) {
  const out = [];
  const open = /<script\b([^>]*)>/gi;
  let m;
  while ((m = open.exec(html))) {
    const start = m.index + m[0].length;
    const close = html.slice(start).search(/<\/script/i);
    assert.notEqual(close, -1, 'every script element is closed');
    out.push({ attrs: m[1], text: html.slice(start, start + close) });
    open.lastIndex = start + close;
  }
  return out;
}

test('the real component bundle survives inlining: the page script parses', () => {
  const { dir } = scratch();
  renderMapHtml({ dir, now: '2026-07-19T12:00:00Z' }); // default bundle: the built component
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  const code = scriptsOf(html).filter((s) => !/application\/json/.test(s.attrs));
  assert.equal(code.length, 1, 'one inline code script');
  assert.ok(code[0].text.includes('federation-map'), 'it is the component bundle');
  assert.doesNotThrow(() => new vm.Script(code[0].text, { filename: 'inline-bundle.js' }));
});

test('inlining keeps the bundle\'s meaning: </ and </script in regexes, strings and templates', () => {
  const { dir } = scratch();
  renderMapHtml({ dir, bundlePath: CLOSERS_BUNDLE, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  const scripts = scriptsOf(html);
  assert.equal(scripts.length, 2, 'no </script in the bundle closes or opens a tag');
  const run = (src) => { const ctx = vm.createContext({}); new vm.Script(src).runInContext(ctx); return JSON.stringify(ctx.out); };
  assert.equal(run(scripts[1].text), run(readFileSync(CLOSERS_BUNDLE, 'utf8')), 'same values as the bundle on disk');
});

test('inline JSON cannot leave its script element and still parses to the same map', () => {
  const { dir, bundle } = scratch();
  const evil = '</SCRIPT><!--<script>alert(1)</script>';
  writeFileSync(join(dir, 'federation.yaml'),
    `identity:\n  name: full-os\ndownstream:\n  - id: evil\n    name: ${JSON.stringify(evil)}\n`);
  renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  const [data, code] = scriptsOf(html);
  assert.match(data.attrs, /application\/json/);
  // `<!--` followed by `<script` would put the parser in the double-escaped state, where the
  // real closing tag no longer closes — so the data may hold neither.
  assert.ok(!/<!--|<script|<\/script/i.test(data.text), 'no tag-like sequence in the data');
  assert.ok(code.text.includes(readFileSync(bundle, 'utf8')), 'the bundle script follows intact');
  const names = JSON.parse(data.text).nodes.map((n) => n.name);
  assert.ok(names.includes(evil), 'the poisoned name round-trips exactly');
});

test('uses vault surface: builder runs with surface=vault', () => {
  const { dir, bundle } = scratch();
  // full fixture's source-systems have no portal_vault (map.json v1's key for a node's vault link); add one to prove
  // the surface switch
  writeFileSync(join(dir, 'data', 'source-systems.yaml'),
    '- id: koi-network\n  title: KOI\n  portal_vault: "obsidian://open?file=koi"\n  portal_web: "/docs/koi"\n');
  renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  assert.ok(html.includes('obsidian://open?file=koi'));
  assert.ok(!html.includes('/docs/koi'));
});

test('links index lists every node with a deep-link into the vault artifact', () => {
  const { dir } = scratch();
  const r = renderLinksIndex({ dir, now: '2026-07-19T12:00:00Z' });
  assert.equal(r.ok, true);
  const md = readFileSync(join(dir, 'renders', 'federation-links.md'), 'utf8');
  assert.ok(md.includes('[Child](federation-map.html#node=child-os)'));
  assert.ok(md.includes('[KOI Network](federation-map.html#node=koi-network)') || md.includes('#node=koi-network'));
  assert.ok(md.includes('## Instances'), 'grouped by kind');
});

test('links index is deterministic for fixed now (safe to regenerate)', () => {
  const { dir } = scratch();
  renderLinksIndex({ dir, now: 'T' });
  const a = readFileSync(join(dir, 'renders', 'federation-links.md'), 'utf8');
  renderLinksIndex({ dir, now: 'T' });
  const b = readFileSync(join(dir, 'renders', 'federation-links.md'), 'utf8');
  assert.equal(a, b);
});

test('the instance name is escaped in title and heading', () => {
  const { dir, bundle } = scratch();
  writeFileSync(join(dir, 'federation.yaml'), 'identity:\n  name: "<img src=x onerror=alert(1)>"\n');
  renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  const escaped = '&lt;img src=x onerror=alert(1)&gt;';
  assert.ok(html.includes(`<title>${escaped}`), 'title escaped');
  assert.ok(/<h1[^>]*>[^<]*&lt;img/.test(html) && html.includes(escaped), 'heading escaped');
  const outsideJson = html.replace(/<script type="application\/json">[\s\S]*?<\/script>/, '');
  assert.ok(!outsideJson.includes('<img'), 'no raw <img outside the JSON script');
});

test('links index says what the map shows', () => {
  const { dir } = scratch();
  renderLinksIndex({ dir, now: '2026-07-19T12:00:00Z' });
  const md = readFileSync(join(dir, 'renders', 'federation-links.md'), 'utf8');
  assert.ok(md.includes('## One hop beyond'));
  assert.ok(/^- \[Sibling\]\(federation-map\.html#node=sibling-os\) — DAO · not reached$/m.test(md), 'unreached line ends "<type> · not reached"');
  assert.ok(md.includes('[the federation map](federation-map.html)'));
  assert.ok(!md.includes('torch') && !md.includes('Frontier'));
  assert.ok(md.includes('## Instances'));
  assert.ok(md.includes('](federation-map.html#node='));
});

// ── the vault artifact in the house (spec §5.1, §6, §8; plan Task 14) ──────────────────────────────
import { NOW } from './fixtures/map/house/now.mjs';
import { buildMap } from '../src/map.mjs';
import { statusLine } from '../../org-os-federation-map/src/view.mjs';

const HOUSE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map', 'house');
function houseScratch() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-house-html-'));
  cpSync(HOUSE, dir, { recursive: true });
  const bundle = join(dir, 'bundle.js');
  writeFileSync(bundle, FAKE_BUNDLE);
  return { dir, bundle };
}
function renderHouse(prep) {
  const s = houseScratch();
  if (prep) prep(s.dir);
  renderMapHtml({ dir: s.dir, bundlePath: s.bundle, now: NOW });
  return { ...s, html: readFileSync(join(s.dir, 'renders', 'federation-map.html'), 'utf8') };
}
const noScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
// the page's own words: the inlined font data and the code are not words a reader sees
const words = (html) => noScripts(html).replace(/url\("data:[^"]*"\)/g, '');

test('house: works without JavaScript — every node, the edges and the list twin are in the page', () => {
  const { dir, html } = renderHouse();
  const page = noScripts(html);
  const map = buildMap({ dir, surface: 'vault', now: NOW });
  for (const n of map.nodes.filter((x) => x.kind !== 'ecosystem')) assert.ok(page.includes(`>${n.name}<`), `node ${n.name} drawn`);
  assert.ok(page.includes(`>${map.self.name}<`), 'this instance drawn');
  assert.ok(page.includes('>Watershed Commons<') || /class="group"/.test(page), 'the ecosystem group drawn');
  assert.match(page, /<svg class="fm-edges"[^>]*>[\s\S]*?<path class="edge/, 'edges as one inline svg');
  assert.match(page, /<ul class="fm-twin rows"[^>]*aria-label="6 instances and 3 sources, as a list"/, 'the list twin');
  assert.match(page, /<federation-map id="fedmap" data-surface="vault">\s*<div class="fm" data-fm>/, 'pre-drawn in the element\'s light DOM');
});

test('house: one <style>, house fonts inline by default, none with render.fonts: system', () => {
  const { html } = renderHouse();
  assert.equal((html.match(/<style\b/g) || []).length, 1, 'one style element');
  assert.match(html, /@font-face[\s\S]*?url\("data:font\/woff2;base64,/, 'fonts inline');
  const sys = renderHouse((dir) => writeFileSync(join(dir, 'kms.yaml'),
    readFileSync(join(dir, 'kms.yaml'), 'utf8') + 'render:\n  fonts: system\n')).html;
  assert.equal((sys.match(/<style\b/g) || []).length, 1);
  assert.ok(!sys.includes('@font-face'), 'no font faces with fonts: system');
});

test('house: fonts default to the house set without a kms.yaml', () => {
  const { html } = renderHouse((dir) => rmSync(join(dir, 'kms.yaml')));
  assert.match(html, /@font-face/);
});

test('house: no torch words — the frontier is "one hop beyond"', () => {
  const { html } = renderHouse();
  assert.doesNotMatch(words(html), /torch|\bembers?\b|🔦|cast light/i);
  assert.ok(words(html).includes('one hop'), 'the frontier in words');
});

test('house: the artifact bar — one h1, the generated line with its time in Mono, List · Map and Fit drive the map', () => {
  const { html } = renderHouse();
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'exactly one h1');
  assert.match(html, /<h1 class="art-name">Riverbend Commons<\/h1>/);
  assert.match(html, /Federation map<span class="gen"> · generated <time datetime="2026-10-29T12:00:00Z">29 Oct 2026 12:00 UTC<\/time><\/span>/);
  assert.match(html, /<button type="button" data-fm-view="list" aria-controls="fedmap" aria-pressed="false">/);
  assert.match(html, /<button type="button" data-fm-view="map" aria-controls="fedmap" aria-pressed="true">/);
  assert.match(html, /<button class="btn icon" type="button" data-fm-fit aria-controls="fedmap" aria-label="Fit to view">/);
  // without the component the controls would do nothing: hidden until it is defined
  assert.match(html, /:has\(federation-map:not\(:defined\)\)[^{]*\.tools[^{]*\{\s*display: none;/);
});

test('house: deep-link target and status line', () => {
  const { dir, html } = renderHouse();
  assert.ok(html.includes('data-id="hillside-coop"'), 'deep-link target');
  const map = buildMap({ dir, surface: 'vault', now: NOW });
  const status = html.match(/<p class="fm-status">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(status, statusLine(map, { surface: 'vault', now: NOW }).text);
});

test('house: a peer whose frontier was never fetched — the page names the command', () => {
  const { html } = renderHouse();
  assert.match(noScripts(html), /no frontier yet/i);
  assert.match(noScripts(html), /<code>org-os-kms federate frontier<\/code>/);
});

test('house: a cloned peer with no frontier snapshot is never fetched too — its words and the command note', () => {
  const { dir, html } = renderHouse((d) => rmSync(join(d, 'data', 'federation', 'frontier', 'hillside-coop.json')));
  const map = buildMap({ dir, surface: 'vault', now: NOW });
  assert.equal(map.nodes.find((n) => n.id === 'hillside-coop').live, true, 'the peer is cloned here');
  const page = noScripts(html);
  assert.match(page, /aria-label="Hillside Coop, peer, no frontier yet, needs a steward"/);
  assert.match(page, /Hillside Coop and Market Garden have no frontier yet\. Read them with <code>org-os-kms federate frontier<\/code>\./);
});

test('house: no peers — this instance alone and the note', () => {
  const { html } = renderHouse((dir) => {
    writeFileSync(join(dir, 'federation.yaml'), 'identity:\n  name: "Riverbend Commons"\n  type: "Hub"\n');
    writeFileSync(join(dir, 'kms.yaml'), 'name: riverbend-commons\nadapter: repo-data\ntarget: "."\n');
    for (const f of ['source-systems.yaml', 'ecosystems.yaml']) rmSync(join(dir, 'data', f), { force: true });
    rmSync(join(dir, 'data', 'federation'), { recursive: true, force: true });
  });
  assert.ok(noScripts(html).includes('No peers yet. Add one with <code>org-os-kms federate add --card &lt;file&gt;</code>.'));
  assert.ok(noScripts(html).includes('>Riverbend Commons<'));
  const { html: full } = renderHouse();
  assert.ok(!full.includes('No peers yet'), 'no note when there are peers');
});

test('house: the page makes no request', () => {
  const { html } = renderHouse();
  const page = noScripts(html);
  assert.ok(!/\ssrc=/i.test(page), 'no src=');
  assert.ok(!/@import/i.test(html), 'no @import');
  assert.ok(!/<link\b/i.test(page), 'no <link>');
  for (const m of page.matchAll(/url\(\s*["']?([^"')]*)/g)) assert.match(m[1], /^data:/, 'only data: urls in CSS');
  for (const m of page.matchAll(/<(\w+)\b[^>]*\shref="https?:/gi)) assert.equal(m[1].toLowerCase(), 'a', 'remote hrefs only on links');
});

// 2026-11-05 (PF-R118): "portal" is the house's public site; the map's per-node links are links, and their index is
// federation-links.md. The old file name is no longer written.
test('the links index is "Federation links", and says what its lines are', () => {
  const { dir } = scratch();
  const r = renderLinksIndex({ dir, now: 'T' });
  assert.equal(typeof r.report.links, "number", "a count of the nodes listed"); assert.equal(r.report.portals, undefined);
  const md = readFileSync(join(dir, 'renders', 'federation-links.md'), 'utf8');
  assert.match(md, /^# Federation links — /);
  assert.match(md, /^> Links between the internal note graph and \[the federation map\]\(federation-map\.html\)\./m);
  assert.doesNotMatch(md, /portal|door/i);
});

test('render map html writes renders/federation-links.md beside the map, and never federation-portals.md', async () => {
  const { dir } = scratch();
  const r = await dispatch(['render', 'map', 'html', '--dir', dir]);
  assert.equal(r.ok, true);
  assert.equal(r.report.links, join(dir, 'renders', 'federation-links.md'));
  assert.equal(r.report.portals, undefined);
  assert.ok(existsSync(join(dir, 'renders', 'federation-map.html')));
  assert.ok(existsSync(join(dir, 'renders', 'federation-links.md')));
  assert.ok(!existsSync(join(dir, 'renders', 'federation-portals.md')));
});
