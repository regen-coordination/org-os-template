// packages/org-os-kms/test/pages-entry.test.mjs — a knowledge page and its steward's preview (Task 18; spec §5.5, §5.6,
// §6, §8, K-13, K-15, K-16, K-25; R-7, R-32).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommons } from '../src/pages/model.mjs';
import { renderEntry } from '../src/pages/render-entry.mjs';
import { FIELD_MAP } from '../src/atproto/standard-site.mjs';
import { mapCss } from '../src/house/fedmap.mjs';
import * as F from './fixtures/pages/commons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE_CSS = join(here, '..', 'src', 'house', 'css', 'page.css');

const base = { items: F.items, allItems: F.allItems, manifest: F.manifest, config: F.config, knowledge: F.knowledge, reads: F.reads, now: F.NOW };
const pub = (o = {}) => buildCommons({ ...base, mode: 'public', ...o });
const prev = (o = {}) => buildCommons({ ...base, mode: 'preview', ...o });
const opts = { fonts: 'system', now: F.NOW };
const entry = (commons, id) => commons.entries.find((e) => e.id === id);
const render = (commons, id, o = {}) => renderEntry(entry(commons, id), commons, { ...opts, ...o });

// markup only: no <style>, no inline script, no JSON config
const body = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script\b[\s\S]*?<\/script>/g, '');
const article = (html) => body(html).match(/<article\b[\s\S]*?<\/article>/)[0];
const aside = (html) => body(html).match(/<aside\b[\s\S]*?<\/aside>/)[0];
const hrefs = (html) => [...body(html).matchAll(/\s(?:href|src|action|data-src)="([^"]*)"/g)].map((m) => m[1]);

test('exactly one Fraunces element: the title (K-16)', () => {
  const css = readFileSync(PAGE_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // every page.css rule that sets the display family
  const display = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /var\(--display\)/.test(m[2])).map((m) => m[1].trim());
  assert.deepEqual(display, ['.ed-title']);
  for (const id of ['id-living-mulch', 'id-rotational-grazing', 'id-cover-cropping']) {
    const b = body(render(pub(), id));
    assert.equal(b.match(/class="[^"]*\bed-title\b/g).length, 1, id);
    assert.match(b, /<h1 class="ed-title">[^<]+<\/h1>/);
    assert.equal(b.match(/<h1\b/g).length, 1);
    // nothing else on the page wears a Fraunces class from the map's sheet (the map's centre node) or the house's
    assert.doesNotMatch(b, /class="[^"]*\b(display|serif|node big)\b/);
  }
  // the map's Fraunces rule is scoped to the big map's node; the small map draws none of those
  assert.match(mapCss(), /\.node \.display/);
});

test('the title, then the description as the lead (the full description, not the one-line summary)', () => {
  const long = { ...F.grazing, object: { ...F.grazing.object, summary: `${'Moving animals between paddocks so each one rests. '.repeat(8)}The end.` } };
  const c = pub({ items: [F.living, F.cover, long, F.sisters, F.card, F.peerEntry] });
  const a = article(render(c, 'id-rotational-grazing'));
  assert.match(a, /<h1 class="ed-title">Rotational grazing<\/h1><p class="lead">Moving animals[^<]*The end\.<\/p>/);
  assert.ok(!a.includes('…'), 'the lead is not cut');
});

test('body headings: the FIELD_MAP fields in FIELD_MAP order, headed by their labels (H2), the description not repeated', () => {
  const rec = { schema: 'implementation-record', ref: 'data/kb/implementation-record.yaml#seed-library-year-one', object: {
    type: 'implementation-record', id: 'id-year-one', title: 'Seed library, year one', maturity: 'field-informed', public_use: 'reviewed-for-guidance',
    // keys deliberately out of FIELD_MAP order
    adaptations: 'Moved the returns to October.', what_failed: 'Late returns.', context: 'A valley library, first season.',
    what_returns_to_commons: 'The lending form.', what_worked: 'Packets labelled by grower.', updated: '2026-10-01' } };
  const config = { ...F.config, render: { labels: { what_failed: 'What did not work' } } };
  const c = pub({ items: [...F.items, rec], config });
  const a = article(render(c, 'id-year-one'));
  const heads = [...a.matchAll(/<h2 class="fh"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  const order = FIELD_MAP['implementation-record'].body.filter((f) => f !== FIELD_MAP['implementation-record'].description);
  assert.deepEqual(order, ['what_worked', 'what_failed', 'adaptations', 'what_returns_to_commons']);
  assert.deepEqual(heads, ['What worked', 'What did not work', 'Adaptations', 'What returns to the commons']);
  // the description is the lead, and only the lead
  assert.equal(a.split('A valley library, first season.').length - 1, 1);
  assert.match(a, /<p class="lead">A valley library, first season\.<\/p>/);
  // a list field (an array in the canon) reads as a list
  const mulch = article(render(pub(), 'id-living-mulch'));
  assert.match(mulch, /<h2 class="fh"[^>]*>Known tensions<\/h2><ul><li>Competes with young seedlings for water\.<\/li><li>Needs a mowing rhythm the crew can keep\.<\/li><\/ul>/);
});

test('the caveat callout for reviewed-for-explanation: one callout, sunken, info glyph, its sentence', () => {
  const a = article(render(pub(), 'id-rotational-grazing'));
  assert.equal(a.match(/class="callout/g).length, 1);
  assert.match(a, /<div class="callout caveat"><svg class="i" aria-hidden="true"><use href="#i-info"\/><\/svg><div><b>Reviewed for explanation\.<\/b> This entry explains the idea; it is not yet guidance\.<\/div><\/div>/);
  // no caveat, no callout
  assert.doesNotMatch(article(render(pub(), 'id-living-mulch')), /class="callout/);
  // the callout sits between the lead and the body
  assert.ok(a.indexOf('class="lead"') < a.indexOf('class="callout') && a.indexOf('class="callout') < a.indexOf('class="fh"'));
  const css = readFileSync(PAGE_CSS, 'utf8');
  assert.match(css, /\.callout\.caveat[^{]*\{[^}]*background:\s*var\(--sunken\)/);
});

test('a deprecated entry: "Deprecated — superseded by <entry>", linked when the successor is public (K-25)', () => {
  const a = article(render(pub(), 'id-three-sisters-guild'));
  assert.equal(a.match(/class="callout/g).length, 1);
  assert.match(a, /<div class="callout dep">[\s\S]*?<b>Deprecated<\/b> — superseded by <a href="\.\.\/\.\.\/k\/concept-lineage\/id-cover-cropping\.html">Cover cropping<\/a>\.<\/div><\/div>/);
  assert.match(aside(render(pub(), 'id-three-sisters-guild')), /<span class="sm closed">/);
  // successor not public: no title, no link — the public page cannot tell it exists
  const sisters = { ...F.sisters, object: { ...F.sisters.object, superseded_by: 'staff-handbook' } };
  const c = pub({ items: [F.living, F.cover, F.grazing, sisters, F.card, F.peerEntry] });
  const b = article(render(c, 'id-three-sisters-guild'));
  assert.match(b, /<div class="callout dep">[\s\S]*?<b>Deprecated\.<\/b>[^<]*<\/div><\/div>/);
  assert.ok(!b.includes('Staff handbook') && !b.includes('staff-handbook'));
  // and the same when a public page is rendered from a preview model (defence in depth)
  const pc = prev({ items: [F.living, F.cover, F.grazing, sisters, F.card, F.peerEntry], allItems: [F.living, F.cover, F.grazing, sisters, F.card, F.peerEntry, F.handbook, F.swapNotes] });
  const d = body(renderEntry(entry(pc, 'id-three-sisters-guild'), pc, { ...opts, preview: false }));
  assert.ok(!d.includes('Staff handbook') && !d.includes('staff-handbook'));
});

test('Review Focus 2: the page citing an internal entry and the page citing a missing slug are byte-identical (K-13)', () => {
  const MISSING = 'nothing-by-this-name';
  const withRefs = (refs) => {
    const living = { ...F.living, object: { ...F.living.object, related_concepts: refs } };
    const items = [living, ...F.items.filter((i) => i !== F.living)];
    return pub({ items, allItems: [living, ...F.allItems.filter((i) => i !== F.living)] });
  };
  const internal = render(withRefs(['cover-cropping', 'staff-handbook']), 'id-living-mulch');
  const broken = render(withRefs(['cover-cropping', MISSING]), 'id-living-mulch');
  assert.equal(broken.replaceAll(MISSING, 'staff-handbook'), internal);
  assert.equal(broken, internal);
  for (const html of [internal, broken]) {
    for (const bad of ['staff-handbook', 'Staff handbook', MISSING]) assert.ok(!html.includes(bad), bad);
  }
});

test('public page: no clay, no lock, no band, nothing internal — even from a preview model or a failed read', () => {
  const cases = [
    ['public', render(pub({ reads: F.readsFailed }), 'id-living-mulch')],
    ['public from preview model', render(prev({ reads: F.readsFailed }), 'id-living-mulch', { preview: false })],
    ['public grazing', render(pub(), 'id-rotational-grazing')],
  ];
  for (const [name, html] of cases) {
    const b = body(html);
    for (const bad of ['attn', 'sm needs', 'sm failed', 'i-lock', 'Internal only', 'couldn’t read', 'class="band', 'Preview', 'broken', 'No entry with this name',
      'Staff handbook', 'staff-handbook', 'no-such-note', 'Seed swap notes', 'Awaiting review']) {
      assert.ok(!b.includes(bad), `${name}: ${bad}`);
    }
  }
  // the public preview-model page counts only public backlinks
  assert.match(body(cases[1][1]), /<span>1 backlink<\/span>/);
  assert.throws(() => renderEntry(entry(prev(), 'id-staff-handbook'), prev(), opts), /internal/);
});

test('preview: the band, broken refs as clay rows with their fix, the lock on internal entries, a failed peer read', () => {
  const c = prev({ reads: F.readsFailed });
  const html = render(c, 'id-living-mulch', { preview: true });
  const b = body(html);
  assert.match(b, /<div class="band static"><svg class="i" aria-hidden="true"><use href="#i-eye"\/><\/svg><span><b>Preview — not published\.<\/b>/);
  assert.match(b, /<li><div class="row broken"><span class="ktile attn">[\s\S]*?<span class="t"><code>no-such-note<\/code><\/span><span class="s">No entry with this name\. Fix the reference or publish the entry\.<\/span>/);
  // the internal related row carries the lock; the published ones do not
  const rel = b.match(/<div class="embed"[\s\S]*?<\/ul><\/div>/)[0];
  const row = (t) => rel.match(new RegExp(`<li><a[^>]*>(?:(?!</li>).)*?${t}[\\s\\S]*?</li>`))[0];
  assert.match(row('Staff handbook'), /<span class="vis"><svg class="i" aria-hidden="true"><use href="#i-lock"\/><\/svg>Internal only<\/span>/);
  assert.doesNotMatch(row('Cover cropping'), /i-lock/);
  // the peer row: from its peer, and in clay that its last read failed
  assert.match(row('Seed saving for small farms'), /from hillside\.example ↗/);
  assert.match(row('Seed saving for small farms'), /<span class="age failed">couldn’t read · last 9 d ago<\/span>/);
  // an internal entry's own page in the preview: the lock in its meta line
  const hb = body(render(c, 'id-staff-handbook', { preview: true }));
  assert.match(hb.match(/<div class="kp-meta">[\s\S]*?<\/div>/)[0], /Internal only/);
  // awaiting review: the clay needs mark in the meta line
  const sw = body(render(c, 'id-seed-swap-notes', { preview: true }));
  assert.match(sw.match(/<div class="kp-meta">[\s\S]*?<\/div>/)[0], /<span class="sm needs">[\s\S]*?Awaiting review/);
  assert.match(html, /<title>Preview · Living mulch · Riverbend Commons<\/title>/);
});

test('every href is relative to k/<schema>/ or a safe external URL; none starts with /', () => {
  const ok = /^(#[\w-]+|\.\.\/\.\.\/(index\.html|k\/[a-z0-9-]+\/(index|[\w-]+)\.html|api\/[a-z0-9-]+\/[\w-]+\.json|api\/index\.json|_kms\/fonts\/[\w.-]+)|https?:\/\/[^\s"]+)$/;
  const cases = [];
  for (const id of ['id-living-mulch', 'id-rotational-grazing', 'id-three-sisters-guild', 'id-cover-cropping', 'id-seed-library']) {
    cases.push([id, render(pub(), id)], [`${id} preview`, render(prev({ reads: F.readsFailed }), id, { preview: true })]);
  }
  cases.push(['relative fonts', render(pub(), 'id-living-mulch', { fonts: { mode: 'house', embed: 'relative' } })]);
  for (const [name, html] of cases) {
    const hs = hrefs(html);
    assert.ok(hs.length > 5, name);
    for (const h of hs) {
      assert.ok(!h.startsWith('/'), `${name}: ${h}`);
      if (h.startsWith('#i-')) continue;
      assert.match(h, ok, `${name}: ${h}`);
    }
  }
  // the fonts, when written beside the pages, are fetched relative to the page too
  const rel = render(pub(), 'id-living-mulch', { fonts: { mode: 'house', embed: 'relative' } });
  assert.match(rel, /url\("\.\.\/\.\.\/_kms\/fonts\/geist-latin\.woff2"\)/);
  // the API twin: a ghost JSON link in the top bar
  assert.match(body(render(pub(), 'id-living-mulch')), /<a class="btn sm ghost has-ico" href="\.\.\/\.\.\/api\/encyclopedia-entry\/id-living-mulch\.json">[\s\S]*?JSON<\/a>/);
});

test('peer links (P-8): http(s) out with ↗; anything else — at://, javascript: — says "from <peer>" with no link', () => {
  const html = body(render(pub(), 'id-living-mulch'));
  assert.match(html, /<a class="row" href="https:\/\/hillside\.example\/resources\/seed-saving">/);
  // an AT URI from a peer that nothing here holds: no link
  const odd = 'at://did:plc:faraway/org.far.resource/abc';
  const living = { ...F.living, object: { ...F.living.object, related_resources: [odd] } };
  const c = pub({ items: [living, ...F.items.filter((i) => i !== F.living)] });
  const b = body(render(c, 'id-living-mulch'));
  assert.match(b, /<li><div class="row">[\s\S]*?from did:plc:faraway<\/span>/);
  assert.ok(!hrefs(b).some((h) => h.startsWith('at:')));
  // a peer entry whose URL is not http(s): its own page names the peer with no link
  const bad = { ...F.peerEntry, object: { ...F.peerEntry.object, url: 'javascript:alert(1)', sourceUri: F.PEER_URI } };
  const c2 = pub({ items: [...F.items.filter((i) => i !== F.peerEntry), bad] });
  const p = body(render(c2, 'id-peer-seed-saving'));
  assert.ok(!p.includes('javascript:'));
  assert.match(p.match(/<div class="kp-meta">[\s\S]*?<\/div>/)[0], /from did:plc:hillsidepeer/);
});

test('related: an embedded record block with its eyebrow head; "Where this comes from" names the cited source', () => {
  const a = article(render(pub(), 'id-living-mulch'));
  assert.match(a, /<div class="embed"><div class="embed-h"><svg class="i s14" aria-hidden="true"><use href="#i-link"\/><\/svg><span>2 entries<\/span><span class="end">from this commons and one peer<\/span><\/div>/);
  assert.match(a, /<a class="row" href="\.\.\/\.\.\/k\/concept-lineage\/id-cover-cropping\.html">[\s\S]*?<span class="t">Cover cropping<\/span><span class="s">Concept lineage<\/span>[\s\S]*?<span class="sm done">/);
  assert.match(a, /<h2 class="h-sec" id="h-from">Where this comes from<\/h2><p>From <a class="mention rec" href="\.\.\/\.\.\/k\/source-system\/id-seed-library\.html"><svg class="i" aria-hidden="true"><use href="#i-db"\/><\/svg>Riverbend Seed Library<\/a>\.<\/p><p id="cite">How to cite: Credit the Riverbend Seed Library, CC BY\.<\/p>/);
});

test('the aside: About this entry as field rows (mark, record chip), the Neighbourhood small map, Referenced by', () => {
  const html = render(pub(), 'id-living-mulch');
  const s = aside(html);
  assert.match(s, /^<aside class="kp-aside" aria-label="About this entry">/);
  assert.match(s, /<dl class="fields"><dt>Kind<\/dt><dd>Encyclopedia entry<\/dd><dt>Page type<\/dt><dd>Concept<\/dd><dt>Maturity<\/dt><dd><span class="sm done">/);
  assert.match(s, /<dt>Steward<\/dt><dd>Field steward<\/dd>/);
  assert.match(s, /<dt>Record<\/dt><dd><button class="addr" type="button" data-copy="at:\/\/did:plc:riverbendown\/org\.riverbend\.encyclopedia-entry\/id-living-mulch" aria-label="Copy the record’s AT URI"[^>]*>/);
  // the small map: the entry and its one-hop neighbours, each a relative link (peer: out, dashed)
  assert.match(s, /<h2[^>]*>Neighbourhood<\/h2><div class="fm-mini" data-size="page"/);
  assert.match(s, /<a class="mnode" href="\.\.\/\.\.\/k\/concept-lineage\/id-cover-cropping\.html"/);
  assert.match(s, /<a class="mnode away" href="https:\/\/hillside\.example\/resources\/seed-saving"/);
  assert.match(html, /\.fm-mini \{/, 'MAP_CSS is inlined');
  // no map page by default (R-32): "+N on the map" never links anywhere it cannot reach
  assert.doesNotMatch(body(html), /Federation map/);
  assert.match(body(render(pub(), 'id-living-mulch', { mapHref: 'federation-map.html' })), /href="\.\.\/\.\.\/federation-map\.html"[^>]*>[\s\S]*?Federation map/);
  assert.match(s, /<h2[^>]*>Referenced by <span class="faint">1<\/span><\/h2><ul class="rows surf">[\s\S]*?Cover cropping/);
  // the foot: Published by, the AT URI in Mono, JSON, How to cite
  assert.match(article(html), /<footer class="kp-foot"><span>Published by Riverbend Commons<\/span><code class="uri">at:\/\/did:plc:riverbendown\/org\.riverbend\.encyclopedia-entry\/id-living-mulch<\/code><a href="\.\.\/\.\.\/api\/encyclopedia-entry\/id-living-mulch\.json">JSON<\/a><a href="#cite">How to cite<\/a><\/footer>/);
});

test('landmarks: one main, one article, the aside labelled "About this entry", a skip link, <dl> field rows', () => {
  const b = body(render(pub(), 'id-living-mulch'));
  assert.equal(b.match(/<main\b/g).length, 1);
  assert.equal(b.match(/<article\b/g).length, 1);
  assert.equal(b.match(/<aside\b/g).length, 1);
  assert.match(b, /<aside class="kp-aside" aria-label="About this entry">/);
  assert.match(b, /<a class="skip" href="#main">Skip to the entry<\/a>/);
  assert.match(b, /<main id="main">/);
  assert.match(aside(b), /<dl class="fields">/);
  // the crumbs: Commons / Kind / title
  assert.match(b, /<div class="crumbs"><a href="\.\.\/\.\.\/index\.html">Commons<\/a><span class="slash" aria-hidden="true"><\/span><a href="\.\.\/\.\.\/k\/encyclopedia-entry\/index\.html">Encyclopedia entry<\/a><span class="slash" aria-hidden="true"><\/span><b aria-current="page">Living mulch<\/b><\/div>/);
  // the meta line: eyebrow, visibility, updated, backlinks
  assert.match(b, /<div class="kp-meta"><span class="eyebrow">Encyclopedia entry · concept<\/span><span class="vis">[\s\S]*?Public<\/span><span>Updated <time datetime="2026-10-20">20 Oct<\/time><\/span><span>1 backlink<\/span><\/div>/);
});

test('read-only: no editor bar, save state, presence, comments, form or editable text', () => {
  const b = body(render(prev(), 'id-living-mulch', { preview: true }));
  for (const bad of ['contenteditable', '<form', '<textarea', 'ed-bar', 'Saved', 'presence', 'comment', 'Comment', 'Edit']) assert.ok(!b.includes(bad), bad);
  // the only input is the ⌘K palette's search field
  assert.equal((b.match(/<input\b/g) ?? []).length, 1);
});

test('no request: nothing on the page fetches from anywhere (no <link>, <img>, external script or stylesheet)', () => {
  const html = render(pub(), 'id-living-mulch', { fonts: 'house' });
  assert.doesNotMatch(html, /<link\b|<img\b|<iframe\b|<script\s+src|@import/i);
  assert.doesNotMatch(html.match(/<style>[\s\S]*?<\/style>/)[0], /url\((?!"?data:)/);
});

test('page.css: no colour literal, no --o-dim, every var() a house token', () => {
  const css = readFileSync(PAGE_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/i);
  assert.doesNotMatch(css, /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold|navy|teal|canvastext|canvas|highlight)(?![\w-])/i);
  assert.ok(!css.includes('--o-dim'));
  const tokens = readFileSync(join(here, '..', 'src', 'house', 'house-tokens.css'), 'utf8');
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  for (const [, v] of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) assert.ok(defined.has(v), v);
});

// neighbours.more counts the rows past the small map's cut. A preview model counts internal entries there too, so on
// the public side, handed a preview model, the count cannot be trusted: no "+N on the map" (rule 2, K-13; R-40).
test('public page from a preview model: neighbours.more is not shown when internal rows were or may be cut', () => {
  const withNear = (c, extra, more) => {
    const e = entry(c, 'id-living-mulch');
    const items = [...e.neighbours.items.filter((r) => !r.internal), ...extra];
    return { ...c, entries: c.entries.map((x) => (x === e ? { ...e, neighbours: { items, more } } : x)) };
  };
  const handbookRow = { slug: 'staff-handbook', title: 'Staff handbook', href: '../../k/encyclopedia-entry/id-staff-handbook.html', internal: true, glyphType: 'encyclopedia-entry' };
  // a public model: the count is the public rows past the cut, and it shows
  assert.match(aside(render(withNear(pub(), [], 2), 'id-living-mulch')), /\+2 on the map/);
  // a preview model rendered publicly: an internal row filtered out → no count
  const filtered = aside(render(withNear(prev(), [handbookRow], 2), 'id-living-mulch', { preview: false }));
  assert.doesNotMatch(filtered, /on the map/);
  assert.doesNotMatch(filtered, /Staff handbook|staff-handbook/);
  // a preview model with no internal row in view: internal entries may still sit past the cut → no count
  assert.doesNotMatch(aside(render(withNear(prev(), [], 2), 'id-living-mulch', { preview: false })), /on the map/);
  // the steward's preview keeps it
  assert.match(aside(render(withNear(prev(), [handbookRow], 2), 'id-living-mulch', { preview: true })), /\+2 on the map/);
});
