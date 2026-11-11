// packages/org-os-kms/test/pages-index.test.mjs — the commons index, kind pages and search (Task 17; spec §5.4, §5.6, §6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommons } from '../src/pages/model.mjs';
import { renderIndex, searchIndex } from '../src/pages/render-index.mjs';
import * as F from './fixtures/pages/commons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FRAME_CSS = join(here, '..', 'src', 'house', 'css', 'frame.css');

const base = { items: F.items, allItems: F.allItems, manifest: F.manifest, config: F.config, knowledge: F.knowledge, reads: F.reads, now: F.NOW };
const pub = (o = {}) => buildCommons({ ...base, mode: 'public', ...o });
const prev = (o = {}) => buildCommons({ ...base, mode: 'preview', ...o });
const opts = { fonts: 'system', now: F.NOW };

// the page without its <style> and the inline script (markup only)
const body = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/g, '');
const groups = (html) => [...body(html).matchAll(/<li class="grp-h"><span>([^<]+)<\/span><span class="c">(\d+)<\/span>/g)].map((m) => [m[1], Number(m[2])]);
// list rows (the List view), in order: [title, the row's <li> markup]
const rows = (html) => [...body(html).matchAll(/<li data-g="[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => [m[1].match(/<span class="t">([^<]+)<\/span>/)[1], m[0]]);
const hrefs = (html) => [...body(html).matchAll(/\s(?:href|src|data-src)="([^"]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('#'));

const PUBLIC_TITLES = ['Cover cropping', 'Living mulch', 'Riverbend Seed Library', 'Rotational grazing', 'Seed saving for small farms', 'Three sisters guild'];

test('public index lists exactly the gated entries, grouped by kind with counts', () => {
  const html = renderIndex(pub(), opts);
  assert.deepEqual(groups(html), [['Concept lineage', 1], ['Encyclopedia entry', 2], ['Option entry', 1], ['Resource', 1], ['Source system', 1]]);
  assert.deepEqual(rows(html).map(([t]) => t).sort(), PUBLIC_TITLES);
  // the sidebar: Commons with its count, and one link per kind with its count
  assert.match(body(html), /<a href="index.html" aria-current="page"[^>]*>[\s\S]*?<span class="lbl">Commons<\/span><span class="n">6<\/span>/);
  for (const [schema, n] of [['encyclopedia-entry', 2], ['concept-lineage', 1], ['source-system', 1]]) {
    assert.match(body(html), new RegExp(`<a href="k/${schema}/index.html"[^>]*>[\\s\\S]*?<span class="n">${n}</span>`), schema);
  }
  // the head: eyebrow, name, facts line, the knowledge.json sentence
  assert.match(body(html), /<span class="eyebrow">Knowledge commons<\/span>/);
  assert.match(body(html), /<h1 id="h1">Riverbend Commons<\/h1>/);
  assert.match(body(html), /6 entries<\/span><span class="dot-sep"><\/span><span>5 kinds<\/span><span class="dot-sep"><\/span><span>1 source<\/span><span class="dot-sep"><\/span><span>1 peer read/);
  assert.match(body(html), /Field notes and practice from the Riverbend growers\./);
  // the foot: JSON API ↗ and the DID in Mono
  assert.match(body(html), /href="api\/index.json"[^>]*>[\s\S]*?JSON API/);
  assert.match(body(html), /<code class="w-s"[^>]*>did:plc:/);
  // each group row has "All N" to its kind page
  assert.match(body(html), /<a href="k\/encyclopedia-entry\/index.html">All 2<span class="sr-only"> · Encyclopedia entry<\/span><\/a>/);
});

test('rows: kind tile from the house glyphs, maturity mark with its word, the date; peer and deprecated rows per K-25', () => {
  const html = renderIndex(pub(), opts);
  const r = Object.fromEntries(rows(html));
  assert.match(r['Living mulch'], /href="k\/encyclopedia-entry\/id-living-mulch.html"/);
  assert.match(r['Living mulch'], /<use href="#i-book"\/>/);
  assert.match(r['Living mulch'], /<span class="sm done"><i aria-hidden="true"><\/i><span class="w">Reviewed<\/span><\/span>/);
  assert.match(r['Living mulch'], /<time datetime="2026-10-20">20 Oct<\/time>/);
  // the house glyph, not labels.mjs's name ('database' is no house glyph)
  assert.match(r['Riverbend Seed Library'], /<use href="#i-db"\/>/);
  // a peer entry: dashed tile, "from <peer> ↗ · read 3 d ago", links out to the peer's safe URL only
  assert.match(r['Seed saving for small farms'], /class="ktile dashed"/);
  assert.match(r['Seed saving for small farms'], /from hillside\.example ↗/);
  assert.match(r['Seed saving for small farms'], /read 3 d ago/);
  assert.match(r['Seed saving for small farms'], /href="https:\/\/hillside\.example\/resources\/seed-saving"/);
  // deprecated: closed mark, the dep class (mute title, faint second line, outlined tile), superseded words
  assert.match(r['Three sisters guild'], /class="row krow dep"/);
  assert.match(r['Three sisters guild'], /<span class="sm closed">/);
  assert.match(r['Three sisters guild'], /Superseded by “Cover cropping”\./);
});

test('a peer row whose URL is not http(s) is drawn without a link (P-8)', () => {
  const c = pub();
  const peer = c.entries.find((e) => e.origin);
  peer.origin.href = 'javascript:alert(1)';
  const html = renderIndex(c, opts);
  const [, row] = rows(html).find(([t]) => t === 'Seed saving for small farms');
  assert.doesNotMatch(row, /<a /);
  assert.doesNotMatch(html, /javascript:/);
});

test('no clay, no lock, no "Needs review" on the public index', () => {
  const html = body(renderIndex(pub(), opts));
  for (const bad of ['Needs review', 'Awaiting review', 'Internal only', 'i-lock', 'sm needs', 'sm failed', 'ktile attn', 'Preview', 'class="band']) {
    assert.ok(!html.includes(bad), bad);
  }
});

test('public rendering of a preview commons still leaks nothing internal (defence in depth)', () => {
  const html = renderIndex(prev(), { ...opts, preview: false });
  for (const bad of ['Staff handbook', 'Seed swap notes', 'staff-handbook', 'seed-swap-notes', 'Claim evidence', 'claim-evidence']) assert.ok(!html.includes(bad), bad);
  for (const bad of ['Needs review', 'Awaiting review', 'Internal only', 'i-lock', 'Preview']) assert.ok(!body(html).includes(bad), bad);
  assert.deepEqual(rows(html).map(([t]) => t).sort(), PUBLIC_TITLES);
  assert.match(body(html), /6 entries<\/span>/);
});

test('preview shows the band, Needs review first with the clay mark, the lock on the internal entry', () => {
  const html = renderIndex(prev(), { ...opts, preview: true });
  const b = body(html);
  assert.match(b, /<div class="band static"><svg class="i" aria-hidden="true"><use href="#i-eye"\/><\/svg><span><b>Preview — not published\.<\/b> Internal entries, broken references and the review queue are shown here; the public pages leave them out\.<\/span><\/div>/);
  const g = groups(html);
  assert.deepEqual(g[0], ['Needs review', 1]);
  assert.ok(g.some(([l, n]) => l === 'Encyclopedia entry' && n === 3));
  const [first] = rows(html);
  assert.equal(first[0], 'Seed swap notes');
  assert.match(first[1], /<span class="sm needs"><i aria-hidden="true"><\/i><span class="w">Awaiting review<\/span><\/span>/);
  const handbook = rows(html).find(([t]) => t === 'Staff handbook')[1];
  assert.match(handbook, /<span class="vis"><svg class="i" aria-hidden="true"><use href="#i-lock"\/><\/svg>Internal only<\/span>/);
  // the published rows carry no lock
  const mulch = rows(html).find(([t]) => t === 'Living mulch')[1];
  assert.doesNotMatch(mulch, /i-lock/);
});

test('preview: a peer entry whose last read failed says so in clay', () => {
  const html = renderIndex(prev({ reads: F.readsFailed }), { ...opts, preview: true });
  const row = rows(html).find(([t]) => t === 'Seed saving for small farms')[1];
  assert.match(row, /<span class="age failed">couldn’t read · last 9 d ago<\/span>/);
  // never on the public side
  assert.doesNotMatch(body(renderIndex(pub({ reads: F.readsFailed }), opts)), /couldn’t read/);
});

test('the instance name is Sans, not Fraunces', () => {
  const html = renderIndex(pub(), opts);
  assert.doesNotMatch(body(html).match(/<div class="kh">[\s\S]*?<\/div>/)[0], /display|serif|fraunces/i);
  const css = readFileSync(FRAME_CSS, 'utf8');
  assert.doesNotMatch(css, /var\(--display\)/);
  assert.match(css, /\.kh h1 \{[^}]*font:\s*var\(--fw-strong\) var\(--fs-title\)\/var\(--lh-title\) var\(--sans\)/);
});

test('every href is relative to the page or a safe external URL; none starts with /', () => {
  const cases = [
    ['index', renderIndex(pub(), opts), ''],
    ['kind', renderIndex(pub(), { ...opts, kind: 'encyclopedia-entry' }), '../../'],
    ['preview', renderIndex(prev(), { ...opts, preview: true }), ''],
    ['preview kind', renderIndex(prev(), { ...opts, preview: true, kind: 'claim-evidence' }), '../../'],
  ];
  for (const [name, html, up] of cases) {
    const hs = hrefs(html);
    assert.ok(hs.length > 5, name);
    for (const h of hs) {
      assert.ok(!h.startsWith('/'), `${name}: ${h}`);
      if (/^[a-z][a-z0-9+.-]*:/i.test(h)) assert.match(h, /^https?:\/\//, `${name}: ${h}`);
      else if (up) assert.ok(h.startsWith(up), `${name}: ${h} is not relative to k/<schema>/`);
    }
  }
  // the palette's index is fetched relative to the page
  assert.match(body(cases[1][1]), /"src":"\.\.\/\.\.\/_kms\/search\.json"/);
  assert.match(body(cases[0][1]), /"src":"_kms\/search\.json"/);
});

test('a kind page lists one kind and links back to the commons', () => {
  const html = renderIndex(pub(), { ...opts, kind: 'encyclopedia-entry' });
  const b = body(html);
  assert.deepEqual(rows(html).map(([t]) => t), ['Living mulch', 'Rotational grazing']);
  assert.deepEqual(groups(html), [['Encyclopedia entry', 2]]);
  assert.match(b, /<h1 id="h1">Encyclopedia entry<\/h1>/);
  assert.match(b, /<a class="kh-back" href="\.\.\/\.\.\/index.html">/);
  assert.match(b, /<a href="\.\.\/\.\.\/k\/encyclopedia-entry\/index.html" aria-current="page"/);
  assert.match(b, /href="\.\.\/\.\.\/k\/encyclopedia-entry\/id-living-mulch.html"/);
  assert.match(html, /<title>Encyclopedia entry · Riverbend Commons<\/title>/);
  assert.throws(() => renderIndex(pub(), { ...opts, kind: 'no-such-kind' }), /unknown kind/);
});

test('searchIndex holds only public entries, no internal title', () => {
  const s = searchIndex(pub());
  assert.deepEqual(s.map((x) => x.t).sort(), PUBLIC_TITLES);
  for (const x of s) assert.deepEqual(Object.keys(x), ['t', 'k', 'h', 's']);
  assert.deepEqual(s.find((x) => x.t === 'Living mulch'), { t: 'Living mulch', k: 'Encyclopedia entry', h: 'k/encyclopedia-entry/id-living-mulch.html', s: 'A cover crop kept growing between rows to hold soil and feed the next planting.' });
  assert.equal(s.find((x) => x.t === 'Seed saving for small farms').h, 'https://hillside.example/resources/seed-saving');
  const fromPreview = JSON.stringify(searchIndex(prev()));
  for (const bad of ['Staff handbook', 'Seed swap notes', 'staff-handbook', 'seed-swap-notes']) assert.ok(!fromPreview.includes(bad), bad);
  // and the public page's palette data holds none either
  assert.ok(!renderIndex(prev(), opts).includes('Staff handbook'));
});

test('without script: the message is present and the filters, views and search are hidden until the script runs', () => {
  const html = renderIndex(pub(), opts);
  const b = body(html);
  assert.match(b, /<p class="note nojs" data-nojs>[\s\S]*Search needs JavaScript\. Browse the commons by kind instead\./);
  assert.match(b, /<div class="vbar" hidden>/);
  assert.match(b, /<button class="search" type="button" data-pal-open hidden[^>]*>/);
  assert.match(b, /<div class="p-table" role="tabpanel"[^>]*hidden>/);
  // the script reveals them, removes the message, and searches _kms/search.json — or, from file://, the rows in the page
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /removeAttribute\('hidden'\)/);
  assert.match(script, /data-nojs/);
  assert.match(script, /protocol/);
});

test('views: List by default, a Table with the six columns, a ⌘K palette with Entries and Jump to, no Actions', () => {
  const html = renderIndex(pub(), opts);
  const b = body(html);
  assert.match(b, /role="tab"[^>]*aria-selected="true"[^>]*>[\s\S]*?List<\/button>/);
  const heads = [...b.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Title', 'Kind', 'Maturity', 'Public use', 'Updated', 'Source']);
  assert.match(b, /<dialog class="pal"/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /'Entries'/);
  assert.match(script, /'Jump to'/);
  assert.doesNotMatch(b + script, /'Actions'|>Actions</);
  // the filter facets: Kind, Maturity, Public use, Source; sort Updated / Title
  for (const f of ['Kind', 'Maturity', 'Public use', 'Source']) assert.match(b, new RegExp(`<legend>${f}</legend>`));
  assert.match(b, /data-sort="updated"/);
});

test('no bottom bar markup', () => {
  const b = body(renderIndex(pub(), opts));
  assert.doesNotMatch(b, /bbar|bottom-bar|bottombar/i);
  assert.doesNotMatch(readFileSync(FRAME_CSS, 'utf8'), /bbar|--h-bottombar/);
});

test('empty: "Nothing published yet." publicly, "No entries in the canon yet." in the preview', () => {
  const empty = { ...pub(), entries: [], kinds: [], counts: { entries: 0, kinds: 0, sources: 0, peersRead: 0 } };
  assert.match(body(renderIndex(empty, opts)), /<b>Nothing published yet\.<\/b>/);
  assert.match(body(renderIndex({ ...empty, needsReview: [] }, { ...opts, preview: true })), /<b>No entries in the canon yet\.<\/b>/);
});

test('one main, a skip link, the sidebar is a labelled nav; landmarks hold', () => {
  const b = body(renderIndex(pub(), opts));
  assert.equal(b.match(/<main\b/g).length, 1);
  assert.match(b, /<a class="skip" href="#main">/);
  assert.match(b, /<nav class="side" aria-label="Commons">/);
  assert.equal(b.match(/<h1\b/g).length, 1);
});

test('frame.css: no colour literal, no --o-dim, tokens only', () => {
  const css = readFileSync(FRAME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/i);
  assert.doesNotMatch(css, /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold|navy|teal|canvastext|canvas|highlight)(?![\w-])/i);
  assert.ok(!css.includes('--o-dim'));
});
