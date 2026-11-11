// test/static.test.mjs — the map as static HTML (spec §5.1–5.2, L4 §8–§9.2): both layouts, the
// list twin, the small map, escaping, and the stylesheet's tokens-only rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  esc, renderStaticMap, renderListTwin, renderSmallMap, ICONS_USED,
} from '../src/static.mjs';
import { instanceCount } from '../src/view.mjs';

const MAP = JSON.parse(readFileSync(new URL('./fixtures/house-map.json', import.meta.url), 'utf8'));
const CSS = readFileSync(new URL('../src/map.css', import.meta.url), 'utf8');
const NOW = '2026-10-29T12:00:00Z';
const vault = () => renderStaticMap(MAP, { surface: 'vault', now: NOW });
const web = () => renderStaticMap(MAP, { surface: 'web', now: NOW });
const count = (s, re) => (s.match(re) || []).length;
// the HTML between the opening tag that carries `marker` and the start of `endMarker`
const slice = (html, marker, endMarker) => {
  const i = html.indexOf(marker);
  assert.ok(i >= 0, `missing ${marker}`);
  const j = endMarker ? html.indexOf(endMarker, i + marker.length) : html.length;
  return html.slice(i, j < 0 ? html.length : j);
};
const DRAWN = MAP.nodes.filter((n) => n.kind !== 'ecosystem').map((n) => n.id);

test('esc escapes the five characters once', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(3), '3');
});

test('both layouts present, one per container width', () => {
  const html = vault();
  assert.match(html, /^<div class="fm" data-fm[ >]/);
  assert.equal(count(html, /class="fm-box /g), 2);
  assert.equal(count(html, /class="fm-box fm-wide"/g), 1);
  assert.equal(count(html, /class="fm-box fm-narrow"/g), 1);
  assert.ok(html.indexOf('fm-wide') < html.indexOf('fm-narrow'));
  assert.match(html, /class="fm-box fm-wide" role="group" aria-label="6 instances and 3 sources, as a map"/);
  assert.match(html, /<p class="fm-cap" aria-live="polite">/);
  assert.match(html, /<ul class="fm-twin rows" aria-label="6 instances and 3 sources, as a list">/);
  // geometry is inline data: the wide canvas is as wide as its layout, the narrow one 358
  assert.match(slice(html, 'fm-wide', 'fm-narrow'), /class="fm-canvas" style="width:1275px;height:744px"/);
  assert.match(slice(html, 'fm-narrow', 'fm-cap'), /class="fm-canvas" style="width:358px;height:816px"/);
});

test('every node of the map appears once per layout, once in the twin', () => {
  const html = vault();
  const wide = slice(html, 'fm-wide', 'fm-narrow');
  const narrow = slice(html, 'fm-narrow', 'class="fm-cap"');
  const twin = slice(html, 'class="fm-twin');
  for (const id of [MAP.self.id, ...DRAWN]) {
    const attr = `data-id="${esc(id)}"`;
    assert.equal(count(wide, new RegExp(`class="node[^"]*"[^>]*${attr}`, 'g')), 1, `wide ${id}`);
    assert.equal(count(narrow, new RegExp(`class="node[^"]*"[^>]*${attr}`, 'g')), 1, `narrow ${id}`);
  }
  for (const id of DRAWN) assert.equal(count(twin, new RegExp(`data-id="${esc(id)}"`, 'g')), 1, `twin ${id}`);
  assert.equal(count(twin, /<li><a class="row/g), DRAWN.length);
  // a group, not a node
  assert.equal(count(wide, /class="group"/g), 1);
  assert.match(wide, /class="group"[^>]*data-id="watershed-commons"/);
  assert.match(wide, /<svg class="i" aria-hidden="true"><use href="#i-sprout"\/><\/svg>Watershed Commons/);
});

test('self is the only .display, big, with the eyebrow and no glyph', () => {
  const html = vault();
  assert.equal(count(html, /class="nn display"/g), 2); // once per layout
  const self = html.match(/<button class="node big[^"]*"[^>]*data-id="Riverbend Commons"[\s\S]*?<\/button>/)[0];
  assert.match(self, /<span class="nk">This instance<\/span>/);
  assert.match(self, /<span class="nn display">Riverbend Commons<\/span>/);
  assert.doesNotMatch(self, /<svg class="i"[^>]*><use href="#i-seal"/);
  assert.match(self, /142 entries · 3 sources/);
  assert.equal(count(html, /class="node big/g), 2);
});

test('nodes: button, geometry inline, glyph by href, accessible name and description', () => {
  const html = vault();
  const wide = slice(html, 'fm-wide', 'fm-narrow');
  const h = wide.match(/<button class="node[^"]*"[^>]*data-id="hillside-coop"[\s\S]*?<\/button>/)[0];
  assert.match(h, /type="button"/);
  assert.match(h, /style="inset-inline-start:278.5px;top:324px;width:192px;min-height:70px"/);
  assert.match(h, /aria-label="Hillside Coop, peer, Coop · 3 members · 2 projects"/);
  const d = h.match(/aria-describedby="([^"]+)"/)[1];
  assert.match(h, new RegExp(`<span class="sr-only" id="${d}">peers with Riverbend Commons; sees one hop beyond: Valley Commons</span>`));
  assert.match(h, /<use href="#i-inst"\/>/);
  // ids are unique across the two layouts
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  // narrow: no kind glyph, facts are the short words
  const narrow = slice(html, 'fm-narrow', 'class="fm-cap"');
  const hn = narrow.match(/<button class="node[^"]*"[^>]*data-id="hillside-coop"[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(hn, /#i-inst/);
  assert.match(hn, /<span class="nm">3 members<\/span>/);
  // iconHref is honoured
  const custom = renderStaticMap(MAP, { surface: 'vault', now: NOW, iconHref: (n) => `sprite.svg#g-${n}` });
  assert.match(custom, /<use href="sprite.svg#g-inst"\/>/);
  assert.doesNotMatch(custom, /href="#i-/);
});

test('R-18: one count of instances — status line, map and twin agree (ring-1 instances)', () => {
  const html = vault();
  assert.match(html, /<p class="fm-status">[\s\S]*?<span>6 instances · 3 sources/);
  assert.equal(count(html, /aria-label="6 instances and 3 sources, as a map"/g), 2);
  assert.match(html, /aria-label="6 instances and 3 sources, as a list"/);
  assert.equal(instanceCount(MAP), 6);
  const one = { ...MAP, nodes: MAP.nodes.filter((n) => n.kind !== 'instance' || n.id === 'hillside-coop') };
  assert.match(renderStaticMap(one, { surface: 'vault', now: NOW }), /aria-label="1 instance and 3 sources, as a map"/);
});

test('R-20: accessible names say each state once', () => {
  const html = vault();
  const label = (id) => html.match(new RegExp(`<button class="node[^"]*" data-id="${id}"[^>]*aria-label="([^"]*)"`))[1];
  assert.equal(label('watershed-network'), 'Watershed Network, upstream, couldn’t read · 3 d');
  assert.equal(label('market-garden'), 'Market Garden, downstream, no frontier yet, needs a steward');
  for (const id of ['watershed-network', 'market-garden']) {
    assert.equal(count(label(id), /couldn’t read|no frontier/g), 1, id);
  }
});

test('R-20: the host-supplied idPrefix is escaped', () => {
  const html = renderStaticMap(MAP, { surface: 'vault', now: NOW, idPrefix: 'x"><img src=y onerror=z>' });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /" onerror=/);
  assert.match(html, /id="x&quot;&gt;&lt;img src=y onerror=z&gt;-w-/);
});

test('R-20: a pre-selected node carries .sel and aria-current, in both layouts', () => {
  const html = renderStaticMap(MAP, { surface: 'vault', now: NOW, selected: 'hillside-coop' });
  const sel = [...html.matchAll(/<button class="([^"]*)" data-id="hillside-coop"[^>]*>/g)];
  assert.equal(sel.length, 2);
  for (const m of sel) { assert.match(m[1], /(^| )sel( |$)/); assert.match(m[0], / aria-current="true"/); }
  assert.equal(count(html, /aria-current=/g), 2);
  assert.equal(count(html, /class="node[^"]*\bsel\b/g), 2);
  assert.equal(count(vault(), /aria-current=|\bsel\b/g), 0);
  // an id that is not on the map selects nothing
  assert.equal(count(renderStaticMap(MAP, { surface: 'vault', now: NOW, selected: 'nope' }), /aria-current=/g), 0);
});

test('vault: Watershed has .dot and "couldn’t read"; web: no .dot, no "couldn’t", no obsidian: link', () => {
  const v = vault();
  const ws = v.match(/<button class="node[^"]*"[^>]*data-id="watershed-network"[\s\S]*?<\/button>/)[0];
  assert.match(ws, /class="node failed"/);
  assert.match(ws, /<span class="dot" aria-hidden="true"><\/span>/);
  assert.match(ws, /<span class="nm clay"><svg class="i" aria-hidden="true"><use href="#i-alert"\/><\/svg>couldn’t read · 3 d<\/span>/);
  assert.match(v, /couldn’t read/);
  assert.match(v, /<span class="sm failed" aria-hidden="true"><i><\/i><\/span>/);

  const withLink = { ...MAP, nodes: MAP.nodes.map((n) => (n.id === 'hillside-coop' ? { ...n, portal: 'obsidian://open?vault=x&file=y', url: 'obsidian://open?vault=x' } : n)) };
  const w = renderStaticMap(withLink, { surface: 'web', now: NOW, selected: 'hillside-coop' });
  assert.doesNotMatch(w, /class="dot"/);
  assert.doesNotMatch(w, /couldn’t|couldn't/);
  assert.doesNotMatch(w, /obsidian:/);
  assert.doesNotMatch(w, /not reached/);
  assert.match(w, /not mapped/);
  // the vault copy of the same node keeps its vault link in the caption
  const vv = renderStaticMap(withLink, { surface: 'vault', now: NOW, selected: 'hillside-coop' });
  assert.match(slice(vv, 'class="fm-cap"', 'class="fm-twin'), /href="obsidian:\/\/open\?vault=x&amp;file=y"/);
});

test('web: a node with a safe link is an <a>, others stay buttons', () => {
  const m = { ...MAP, nodes: MAP.nodes.map((n) => (n.id === 'hillside-coop' ? { ...n, url: 'https://hillside.example/' } : n)) };
  const w = renderStaticMap(m, { surface: 'web', now: NOW });
  assert.equal(count(w, /<a class="node[^"]*" data-id="hillside-coop" href="https:\/\/hillside.example\/"/g), 2);
  assert.doesNotMatch(w, /<a class="node[^"]*"[^>]*type="button"/);
  assert.match(w, /<button class="node[^"]*" data-id="youth-circle" type="button"/);
  // the vault never turns nodes into links
  assert.equal(count(renderStaticMap(m, { surface: 'vault', now: NOW }), /<a class="node/g), 0);
});

test('static map escapes every remote string and filters links with safeUrl', () => {
  const evil = '</button><img src=x onerror=alert(1)>';
  const m = JSON.parse(JSON.stringify(MAP));
  const h = m.nodes.find((n) => n.id === 'hillside-coop');
  h.name = evil; h.url = 'javascript:alert(1)'; h.repo = 'javascript:alert(2)'; h.type = '"><script>x</script>';
  const v = m.nodes.find((n) => n.id === 'Valley Commons');
  v.name = 'Seeds & Soil';
  m.nodes.find((n) => n.id === 'watershed-commons').name = '<b>eco</b>';
  for (const surface of ['vault', 'web']) {
    const html = renderStaticMap(m, { surface, now: NOW, selected: 'hillside-coop' });
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<b>eco/);
    assert.doesNotMatch(html, /javascript:/i);
    assert.match(html, /&lt;\/button&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Seeds &amp; Soil/);
    assert.doesNotMatch(html, /&amp;amp;/);
    const twin = renderListTwin(m, { surface, now: NOW });
    assert.doesNotMatch(twin, /<img|<script|javascript:/i);
    assert.match(twin, /Seeds &amp; Soil/);
    assert.doesNotMatch(twin, /&amp;amp;/);
  }
  // an id with quotes cannot break out of its attribute
  const q = JSON.parse(JSON.stringify(MAP));
  q.nodes.find((n) => n.id === 'Pantry Network').id = 'x" onclick="y';
  q.edges.forEach((e) => { if (e.to === 'Pantry Network') e.to = 'x" onclick="y'; });
  const qh = renderStaticMap(q, { surface: 'vault', now: NOW });
  assert.doesNotMatch(qh, /" onclick="/);
  assert.match(qh, /data-id="x&quot; onclick=&quot;y"/);
});

test('edges: one hidden svg per layout, paths by kind, labels are the words', () => {
  const html = vault();
  assert.equal(count(html, /<svg class="fm-edges" aria-hidden="true"/g), 2);
  const wide = slice(html, 'fm-wide', 'fm-narrow');
  assert.match(wide, /<path class="edge kind-federation" d="M/);
  assert.match(wide, /<path class="edge kind-provenance" d="M/);
  const labels = [...wide.matchAll(/<span class="elabel"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
  for (const w of ['peers', 'reads', 'feeds', 'one hop', 'upstream', 'downstream']) assert.ok(labels.includes(w), w);
  assert.match(wide, /<span class="elabel" style="inset-inline-start:495px;top:377px"[^>]*>peers<\/span>/);
  // the narrow layout drops what does not fit, and keeps the rest
  const narrow = slice(html, 'fm-narrow', 'class="fm-cap"');
  const nl = [...narrow.matchAll(/<span class="elabel"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.ok(!nl.includes('peers'));
  assert.ok(nl.includes('upstream'));
});

test('status line and caption', () => {
  const html = vault();
  assert.match(html, /<p class="fm-status"><span class="sm failed" aria-hidden="true"><i><\/i><\/span><span>6 instances · 3 sources · <span class="ink">1 couldn’t be read<\/span><span class="long"> · frontier read 2 h ago<\/span><\/span><\/p>/);
  const cap = slice(html, 'class="fm-cap"', 'class="fm-twin');
  assert.match(cap, /<b>Riverbend Commons<\/b>/);
  assert.match(cap, /142 entries · 3 sources/);
  assert.match(cap, /This instance — 142 entries from 3 sources\./);
  const sel = renderStaticMap(MAP, { surface: 'vault', now: NOW, selected: 'hillside-coop' });
  const c2 = slice(sel, 'class="fm-cap"', 'class="fm-twin');
  assert.match(c2, /<b>Hillside Coop<\/b> <span class="fm-cap-facts">Coop · peer · read 2 h ago<\/span>/);
  assert.match(c2, /A peer Riverbend Commons federates with, read from its local clone\./);
  assert.doesNotMatch(c2, /<a /); // its repo is not a URL, so there is nothing to link
  const linked = { ...MAP, nodes: MAP.nodes.map((n) => (n.id === 'hillside-coop' ? { ...n, url: 'https://hillside.example' } : n)) };
  const c3 = slice(renderStaticMap(linked, { surface: 'vault', now: NOW, selected: 'hillside-coop' }), 'class="fm-cap"', 'class="fm-twin');
  assert.match(c3, /<a href="https:\/\/hillside.example">visit ↗<\/a>/);
  assert.match(c3, /<a href="https:\/\/hillside.example\/federation.json">federation.json ↗<\/a>/);
  assert.match(web(),/<p class="fm-status"><span class="sm ok" aria-hidden="true"><i><\/i><\/span>/);
});

test('twin groups in order with counts, each row with its one mark and read age', () => {
  const twin = renderListTwin(MAP, { surface: 'vault', now: NOW });
  assert.match(twin, /^<ul class="fm-twin rows" aria-label="6 instances and 3 sources, as a list">/);
  const heads = [...twin.matchAll(/<li class="grp-h"><span>([^<]+)<\/span><span class="c">(\d+)<\/span><\/li>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(heads, ['Upstream 1', 'Peers 3', 'Downstream 2', 'One hop beyond 3', 'Sources 3']);
  const row = (id) => twin.match(new RegExp(`<li><a class="row"[^>]*data-id="${esc(id)}"[\\s\\S]*?</a></li>`))[0];
  assert.match(row('watershed-network'), /<span class="sm failed"><i aria-hidden="true"><\/i><span class="w">Couldn’t read<\/span><\/span>/);
  assert.match(row('hillside-coop'), /<span class="sm ok"><i aria-hidden="true"><\/i><span class="w">Read <time datetime="2026-10-29T10:00:00Z" title="2026-10-29T10:00:00Z">2 h<\/time> ago<\/span><\/span>/);
  assert.match(row('hillside-coop'), /<span class="s">Coop · peer · 3 members<\/span>/);
  assert.match(row('youth-circle'), /<span class="sm aged">/);
  assert.match(row('market-garden'), /<span class="sm needs">[\s\S]*No frontier yet/);
  assert.match(row('lowland-guild'), /<span class="sm open">[\s\S]*No address to read/);
  assert.match(row('Valley Commons'), /class="ktile dashed"/);
  assert.match(row('Valley Commons'), /<span class="s">via Hillside Coop<\/span>/);
  assert.match(row('field-notes-archive'), /<span class="s">Watershed Commons<\/span>/);
  assert.match(row('field-notes-archive'), /href="#node=field-notes-archive"/);
  assert.match(row('Valley Commons'), /href="#node=Valley%20Commons"/);
  // web: no attention, no "couldn’t"
  const w = renderListTwin(MAP, { surface: 'web', now: NOW });
  assert.doesNotMatch(w, /couldn’t|Couldn’t|sm failed|sm needs|No frontier/);
  assert.match(w, /Not mapped/);
  // the twin inside the static map is the same list
  assert.ok(vault().includes(twin));
});

test('small map: 7 neighbours → 6 placed + "+1 on the map"', () => {
  const centre = { id: 'c', name: 'Seed libraries', glyph: 'book' };
  const nb = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, name: `Neighbour ${i}`, glyph: 'branch', href: `/k/n${i}/` }));
  const html = renderSmallMap(centre, nb, { moreHref: '/map/#node=c' });
  assert.match(html, /^<div class="fm-mini" data-size="page" role="group" aria-label="Seed libraries and its neighbours">/);
  assert.equal(count(html, /class="mnode me"/g), 1);
  assert.equal(count(html, /class="mnode( away)?" href=/g), 6);
  assert.doesNotMatch(html, /Neighbour 6/);
  assert.match(html, /<a class="fm-mini-more" href="\/map\/#node=c">\+1 on the map<\/a>/);
  for (const slot of ['above-start', 'above-end', 'below-start', 'below-end', 'start', 'end']) assert.match(html, new RegExp(`data-slot="${slot}"`));
  assert.equal(count(html, /<line class="edge"/g), 6);
  // inspector size, `more` adds to the overflow, unsafe hrefs are dropped, names escaped
  const small = renderSmallMap({ id: 'c', name: 'A & B' }, [{ id: 'x', name: '<i>x</i>', href: 'javascript:alert(1)', away: true }], { size: 'inspector', more: 4 });
  assert.match(small, /data-size="inspector"/);
  assert.match(small, /\+4 on the map/);
  assert.doesNotMatch(small, /javascript:|<i>x/);
  assert.match(small, /<span class="mnode away"[^>]*>&lt;i&gt;x&lt;\/i&gt;<\/span>/);
  assert.match(small, /A &amp; B/);
  assert.doesNotMatch(renderSmallMap(centre, nb.slice(0, 3)), /on the map/);
});

test('ICONS_USED names every glyph the static map references', () => {
  const html = vault() + renderSmallMap({ id: 'c', name: 'C', glyph: 'inst' }, []);
  const used = new Set([...html.matchAll(/href="#i-([a-z-]+)"/g)].map((m) => m[1]));
  for (const n of used) assert.ok(ICONS_USED.includes(n), n);
  for (const n of ['inst', 'book', 'db', 'sprout', 'alert', 'clock', 'seal']) assert.ok(ICONS_USED.includes(n), n);
});

test('map.css holds no colour literal and uses the house tokens', () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/i);
  const named = /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|canvastext|canvas|buttontext|highlight|graytext)(?![\w-])/i;
  assert.doesNotMatch(css, named);
  for (const t of ['--sunken', '--raised', '--rule-strong', '--edge', '--attn', '--map-dot', '--shadow-raise', '--display', '--mono', '--o-dim']) assert.ok(css.includes(`var(${t}`), t);
  assert.match(css, /@container map \(max-width: 680px\)/);
  assert.match(css, /\.fm-box \{[^}]*overflow: auto/);
  assert.match(css, /animation-iteration-count: 2/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /hyphens: auto/);
  assert.doesNotMatch(css, /text-overflow: ellipsis/);
  // Fraunces only for self's name
  assert.equal(count(css, /var\(--display\)/g), 1);
  assert.match(css, /\.display \{[^}]*var\(--display\)/);
});
