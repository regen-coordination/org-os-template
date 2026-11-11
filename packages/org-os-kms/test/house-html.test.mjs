// The house page shell, atoms and rows as HTML strings (plan Task 12; spec §4, §5.1, §8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  esc, houseCss, page, artBar, mark, visibility, kindTile, dataRow, groupRow, fieldRows,
  note, callout, band, readAge,
} from '../src/house/html.mjs';
import { ICONS, iconSprite, icon, glyphFor } from '../src/house/icons.mjs';
import * as fedmap from '../src/house/fedmap.mjs';
import { MAP_ICONS } from '../../org-os-federation-map/src/icons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const count = (s, re) => (s.match(re) || []).length;

const BRIEF_ICONS = ('inst book db sprout branch quote sliders hammer route signal file link layers pin stream '
  + 'clock alert info globe lock search menu x check swap ext list map fit chev-r seal braces copy dash-circle').split(' ');

test('esc escapes & < > " and \'', () => {
  assert.equal(esc(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(3), '3');
});

test('page() is one self-contained document', () => {
  const html = page({ title: 'Example DAO <Commons> & “map”', body: '<main id="main">x</main>', icons: ['seal'] });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.equal(count(html, /<style[\s>]/g), 1);
  assert.equal(count(html, /<svg width="0" height="0" aria-hidden="true">/g), 1, 'one sprite');
  assert.doesNotMatch(html, /href="http/);
  assert.doesNotMatch(html, /\ssrc=/);
  assert.doesNotMatch(html, /@import/);
  assert.doesNotMatch(html, /<link\b/);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>Example DAO &lt;Commons&gt; &amp; “map”<\/title>/);
  assert.match(html, /<main id="main">x<\/main>/);
});

test('page(): lang escaped, body class, script inline and safe', () => {
  const html = page({ title: 't', lang: 'pt"x', body: '', bodyClass: 'kms map', script: 'let s = "</script>";' });
  assert.match(html, /<html lang="pt&quot;x" dir="ltr">/);
  assert.match(html, /<body class="kms map">/);
  assert.equal(count(html, /<\/script>/gi), 1, 'the inline script cannot end its element early');
  assert.match(html, /<script>let s = "<\\\/script>";<\/script>/);
  assert.doesNotMatch(page({ title: 't', body: '' }), /<script/);
});

test('page(): the one <style> holds tokens, then groups, then fonts, then extra — in that order', () => {
  const html = page({ title: 't', body: '', groups: ['base', 'rows'], extraCss: ['.extra-one{}'], fonts: 'house' });
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const at = (s) => { const i = style.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('--paper:') < at('font-optical-sizing') && at('font-optical-sizing') < at('.rows'));
  assert.ok(at('.rows') < at('@font-face') && at('@font-face') < at('.extra-one{}'));
  assert.ok(!style.includes('.art-bar'), 'only the groups asked for');
});

test('fonts: house inlines data: URIs by default; relative points at the base; system emits no @font-face', () => {
  const inline = page({ title: 't', body: '' });
  assert.equal(count(inline, /@font-face/g), 3);
  assert.match(inline, /url\("data:font\/woff2;base64,/);
  const rel = page({ title: 't', body: '', fontEmbed: 'relative', fontBase: '../_kms/fonts/' });
  assert.match(rel, /url\("\.\.\/_kms\/fonts\/geist-latin\.woff2"\)/);
  assert.doesNotMatch(rel, /data:font/);
  const sys = page({ title: 't', body: '', fonts: 'system' });
  assert.doesNotMatch(sys, /@font-face/);
  assert.match(sys, /--sans:/, 'the token stacks still fall back');
});

test('houseCss(): tokens first, then each group, then extra strings', () => {
  const css = houseCss(['art', 'base'], { extra: ['/*x*/'] });
  assert.ok(css.indexOf('--paper:') < css.indexOf('.art-bar'));
  assert.ok(css.indexOf('.art-bar') < css.indexOf('font-optical-sizing'));
  assert.ok(css.trimEnd().endsWith('/*x*/'));
  assert.throws(() => houseCss(['nope']), /unknown css group/);
});

test('page() sprite holds the icons asked for plus those the body references', () => {
  const html = page({ title: 't', icons: ['globe'], body: `<p>${icon('lock')}</p>` });
  const sprite = html.slice(html.indexOf('<svg width="0"'), html.indexOf('</svg>', html.indexOf('<svg width="0"')) + 6);
  assert.deepEqual([...sprite.matchAll(/id="i-([a-z-]+)"/g)].map((m) => m[1]).sort(), ['globe', 'lock']);
});

// spec §4-6
const MATURITY = [
  ['reviewed', 'done', 'Reviewed'], ['field-informed', 'done', 'Field-informed'], ['pattern-generating', 'done', 'Pattern'],
  ['source-linked', 'ok', 'Source-linked'], ['draft', 'open', 'Draft'], ['candidate', 'open', 'Candidate'],
  ['raw', 'aged', 'Raw'], ['held', 'aged', 'Held'], ['deprecated', 'closed', 'Deprecated'], ['archived', 'closed', 'Archived'],
];

test('mark() for every maturity gives the spec word and a shape class; the shape is aria-hidden', () => {
  for (const [m, shape, word] of MATURITY) {
    const h = mark(m);
    assert.match(h, new RegExp(`^<span class="sm ${shape}"><i aria-hidden="true"></i><span class="w">${word}</span></span>$`), m);
  }
});

test('mark(): wordless keeps the word as screen-reader text; L4 marks take a word; unknown throws', () => {
  assert.equal(mark('reviewed', { wordless: true }), '<span class="sm done"><i aria-hidden="true"></i><span class="sr-only">Reviewed</span></span>');
  assert.match(mark('needs', { word: 'Awaiting review' }), /class="sm needs".*>Awaiting review</);
  assert.match(mark('failed'), /class="sm failed".*>Couldn’t read</);
  assert.match(mark('ok', { word: '<b>' }), />&lt;b&gt;</);
  assert.throws(() => mark('nonsense'), /unknown mark/);
});

test('glyphFor covers every type in spec §4-7 and falls back by maps_to_core, then file', () => {
  const table = {
    'encyclopedia-entry': 'book', 'concept-lineage': 'branch', 'claim-evidence': 'quote', 'option-entry': 'sliders',
    'implementation-record': 'hammer', track: 'route', 'source-system': 'db', resource: 'file', signal: 'signal',
    'relationship-record': 'link', deployment: 'layers', place: 'pin', 'territorial-unit': 'pin', 'data-stream': 'stream',
    instance: 'inst', 'knowledge-peer': 'book', source: 'db', ecosystem: 'sprout', self: 'seal',
  };
  for (const [type, glyph] of Object.entries(table)) assert.equal(glyphFor(type), glyph, type);
  assert.equal(glyphFor('seed-bank', { mapsToCore: 'resource' }), 'file');
  assert.equal(glyphFor('watershed', { mapsToCore: 'territorial-unit' }), 'pin');
  assert.equal(glyphFor('mystery'), 'file');
  assert.equal(glyphFor('mystery', { mapsToCore: 'also-unknown' }), 'file');
  for (const g of Object.values(table)) assert.ok(Object.hasOwn(ICONS, g), g);
});

test('ICONS holds every name the brief lists; the map’s glyphs come from MAP_ICONS (one source, R-6)', () => {
  for (const n of BRIEF_ICONS) assert.ok(Object.hasOwn(ICONS, n), n);
  for (const [n, markup] of Object.entries(MAP_ICONS)) assert.equal(ICONS[n], markup, n);
  const src = readFileSync(join(here, '..', 'src', 'house', 'icons.mjs'), 'utf8');
  assert.match(src, /ISC License/);
  assert.match(src, /Lucide Contributors/);
  for (const n of Object.keys(MAP_ICONS)) assert.doesNotMatch(src, new RegExp(`^\\s*'?${n}'?: '<`, 'm'), `${n} is copied, not imported`);
});

test('iconSprite holds exactly the names asked, once each, in order; an unknown name throws', () => {
  const s = iconSprite(['globe', 'seal', 'globe', 'x']);
  assert.ok(s.startsWith('<svg width="0" height="0" aria-hidden="true"><defs>'));
  assert.deepEqual([...s.matchAll(/<symbol id="i-([a-z-]+)" viewBox="0 0 24 24">/g)].map((m) => m[1]), ['globe', 'seal', 'x']);
  assert.equal(iconSprite([]), '<svg width="0" height="0" aria-hidden="true"><defs></defs></svg>');
  assert.throws(() => iconSprite(['nope']), /unknown icon/);
});

test('icon() references the sprite and is hidden from assistive tech', () => {
  assert.equal(icon('globe'), '<svg class="i" aria-hidden="true"><use href="#i-globe"/></svg>');
  assert.equal(icon('globe', { cls: 'i s14' }), '<svg class="i s14" aria-hidden="true"><use href="#i-globe"/></svg>');
  assert.throws(() => icon('nope'), /unknown icon/);
});

test('artBar(): seal on the solid tile, the name escaped, sub as given, tools trailing', () => {
  const h = artBar({ name: 'Example DAO & Co', sub: 'Federation map · generated <time datetime="2026-10-29T06:10">29 Oct 2026 06:10</time>', tools: '<button>Fit</button>' });
  assert.match(h, /^<header class="art-bar">/);
  assert.match(h, /<span class="seal"><svg class="i" aria-hidden="true"><use href="#i-seal"\/><\/svg><\/span>/);
  assert.match(h, /<h1 class="art-name">Example DAO &amp; Co<\/h1>/);
  assert.match(h, /<span class="art-sub">Federation map · generated <time datetime="2026-10-29T06:10">/);
  assert.match(h, /<div class="tools"><button>Fit<\/button><\/div><\/header>$/);
  assert.doesNotMatch(artBar({ name: 'x', sub: '' }), /class="tools"/);
});

test('visibility(): globe Public, lock Internal only', () => {
  assert.equal(visibility('public'), `<span class="vis">${icon('globe')}Public</span>`);
  assert.equal(visibility('internal'), `<span class="vis">${icon('lock')}Internal only</span>`);
  assert.throws(() => visibility('members'), /unknown visibility/);
});

test('kindTile(): glyph tile, dashed for what comes from a peer', () => {
  assert.equal(kindTile('book'), `<span class="ktile">${icon('book')}</span>`);
  assert.equal(kindTile('branch', { dashed: true }), `<span class="ktile dashed">${icon('branch')}</span>`);
});

test('dataRow(): link row with tile, title, second line, mark column and end', () => {
  const h = dataRow({ href: 'k/a.html', glyph: 'book', title: 'Seed <libraries>', sub: 'Concept', markHtml: mark('reviewed'), end: '<time datetime="2026-10-12">12 Oct</time>' });
  assert.match(h, /^<li><a class="row krow" href="k\/a\.html">/);
  assert.match(h, /<span class="ktile">/);
  assert.match(h, /<span class="main"><span class="t">Seed &lt;libraries&gt;<\/span><span class="s">Concept<\/span><\/span>/);
  assert.match(h, /<span class="c-mark"><span class="sm done">/);
  assert.match(h, /<span class="end"><time datetime="2026-10-12">12 Oct<\/time><\/span><\/a><\/li>$/);
});

test('dataRow(): without href a div; no mark → three columns; deprecated and dashed classes pass through', () => {
  const h = dataRow({ glyph: 'branch', dashed: true, title: 'Old', cls: 'dep' });
  assert.match(h, /^<li><div class="row dep">/);
  assert.match(h, /<span class="ktile dashed">/);
  assert.doesNotMatch(h, /c-mark/);
  assert.match(h, /<span class="end"><\/span><\/div><\/li>$/);
  assert.match(dataRow({ href: 'javascript:alert(1)', glyph: 'x', title: 't' }), /^<li><div class="row">/, 'unsafe hrefs are dropped');
  assert.match(dataRow({ href: 'a"b', glyph: 'x', title: 't' }), /href="a&quot;b"/);
});

test('groupRow(): label, count, optional end', () => {
  assert.equal(groupRow({ label: 'Peers & co', count: 2 }), '<li class="grp-h"><span>Peers &amp; co</span><span class="c">2</span></li>');
  assert.match(groupRow({ label: 'Encyclopedia', count: 31, end: '<a href="#">All 31</a>' }), /<span class="end"><a href="#">All 31<\/a><\/span><\/li>$/);
});

test('fieldRows(): a <dl> of labels (escaped) and values (html), in the box its container query measures', () => {
  assert.equal(fieldRows([['Kind', 'Encyclopedia entry'], ['A<b', mark('reviewed')]]),
    `<div class="fields-box"><dl class="fields"><dt>Kind</dt><dd>Encyclopedia entry</dd><dt>A&lt;b</dt><dd>${mark('reviewed')}</dd></dl></div>`);
});

test('note, callout, band', () => {
  assert.equal(note('No peers <yet>'), `<p class="note">${icon('info')}<span>No peers &lt;yet&gt;</span></p>`);
  assert.match(note('Nothing', { glyph: 'dash-circle', tone: 'empty' }), /^<p class="note empty"><svg class="i" aria-hidden="true"><use href="#i-dash-circle"\/>/);
  assert.equal(callout({ html: '<b>Reviewed for explanation.</b> Read it as context.', cls: 'caveat' }),
    `<div class="callout caveat">${icon('info')}<div><b>Reviewed for explanation.</b> Read it as context.</div></div>`);
  assert.equal(band({ html: '<b>Preview — not published.</b>' }), `<div class="band static">${icon('eye')}<span><b>Preview — not published.</b></span></div>`);
  assert.match(band({ html: 'x', action: '<a class="btn" href="#">Exit</a>' }), /<\/span><a class="btn" href="#">Exit<\/a><\/div>$/);
});

test('readAge(): minutes, hours, days; empty when unknown', () => {
  const now = '2026-10-29T12:00:00Z';
  assert.equal(readAge('2026-10-29T11:56:00Z', now), 'Read 4 min ago');
  assert.equal(readAge('2026-10-29T10:00:00Z', now), 'Read 2 h ago');
  assert.equal(readAge('2026-10-26T12:00:00Z', now), 'Read 3 d ago');
  assert.equal(readAge(null, now), '');
  assert.equal(readAge('not a date', now), '');
});

test('fedmap.mjs re-exports the federation map and its stylesheet', () => {
  for (const f of ['layoutMap', 'nodeView', 'renderStaticMap', 'renderListTwin', 'renderSmallMap', 'fmEsc', 'mapSprite']) {
    assert.equal(typeof fedmap[f], 'function', f);
  }
  assert.ok(Array.isArray(fedmap.ICONS_USED));
  assert.equal(fedmap.MAP_ICONS, MAP_ICONS);
  assert.equal(fedmap.mapCss(), readFileSync(join(here, '..', '..', 'org-os-federation-map', 'src', 'map.css'), 'utf8'));
});

const hrefOf = (href) => { const m = dataRow({ href, glyph: 'file', title: 't' }).match(/^<li><a class="row" href="([^"]*)">/); return m ? m[1] : null; };

test('dataRow() hrefs are an allow-list: script schemes hidden by tabs, newlines or control characters are dropped', () => {
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'jav\rascript:x',
    '\x01javascript:alert(1)', ' \x00javascript:alert(1)', '\x1fjavascript:x', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)',
    'javascript&colon;x:', 'foo:bar', '//evil.example/x', '', '   ',
    // browsers read `\` as `/` in a URL: `/\host` and `\\host` are another host (R-40)
    '/\\evil.example', '\\\\evil', '\\evil.example/x', '/\t\\evil.example', 'a\\b']) {
    assert.equal(hrefOf(bad), null, JSON.stringify(bad));
  }
  assert.equal(hrefOf('k/x/y.html'), 'k/x/y.html');
  assert.equal(hrefOf('../../api/a/b.json'), '../../api/a/b.json');
  assert.equal(hrefOf('./a.html'), './a.html');
  assert.equal(hrefOf('/k/a.html'), '/k/a.html');
  assert.equal(hrefOf('#node=hill'), '#node=hill');
  assert.equal(hrefOf('?q=seed'), '?q=seed');
  assert.equal(hrefOf('a.html?x=1:2#b:c'), 'a.html?x=1:2#b:c', 'a colon after the path starts is fine');
  assert.equal(hrefOf('https://example.org/a'), 'https://example.org/a');
  assert.equal(hrefOf('HTTP://example.org/a'), 'HTTP://example.org/a');
  assert.equal(hrefOf('obsidian://open?vault=v'), 'obsidian://open?vault=v');
  assert.equal(hrefOf('mailto:steward@example.org'), 'mailto:steward@example.org');
  assert.equal(hrefOf(' \thttps://example.org/a\n'), 'https://example.org/a', 'the cleaned value is emitted');
  assert.equal(hrefOf('k/a b.html'), 'k/ab.html', 'whitespace is stripped, as browsers do');
});
