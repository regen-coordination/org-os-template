// packages/org-os-kms/src/pages/render-index.mjs — the commons index, a kind page, and the steward's preview of
// them (spec §5.4, §5.6, §6; L4 §5, §9.2, §10.2; gallery §04). Pure: the page model in, one HTML string out.
//
// One static, self-contained house page: the sidebar (≥1100), L4's rail (760–1099), a 48px top bar and a menu
// sheet under 760 (no bottom bar — these are pages to read, K-12); the head; the entries as data rows grouped by
// kind. Without a script that is the whole page: the filters, the views and search stay `hidden` and one line
// says "Search needs JavaScript. Browse the commons by kind instead." With a script: List and Table, filter
// chips and sort over the rows already in the page, and a ⌘K palette over `_kms/search.json`. From file://
// (where fetch is refused) or when the fetch fails, the palette searches the rows already in the page.
//
// Public side (rule 1–2): no clay, no lock, no review queue, and nothing internal — even if handed a preview
// model, entries marked `internal` are left out and the counts are taken again. Every href is relative to the
// page's own depth (the index at the root, a kind page at k/<schema>/index.html) or a safe http(s) URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { page, dataRow, groupRow, mark, band, visibility, esc, safeHref } from '../house/html.mjs';
import { glyphFor, icon } from '../house/icons.mjs';
import { GLYPHS as LABEL_GLYPHS, MATURITY_MARK, publicUseWord } from './labels.mjs';

let frameCss = null;
export const FRAME_CSS = () => (frameCss ??= readFileSync(fileURLToPath(new URL('../house/css/frame.css', import.meta.url)), 'utf8'));

export const BAND = '<b>Preview — not published.</b> Internal entries, broken references and the review queue are shown here; the public pages leave them out.';
const NOJS = 'Search needs JavaScript. Browse the commons by kind instead.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The house glyph for a kind. The model's `glyphType` comes from labels.mjs's own table, whose names drift from
// the house sprite ('database' vs 'db'); it is only used to find the core type a pack type maps to, and the
// glyph itself always comes from the house `glyphFor`.
export function houseGlyph(schema, labelGlyph) {
  const core = labelGlyph && labelGlyph !== 'file' ? Object.keys(LABEL_GLYPHS).find((s) => LABEL_GLYPHS[s] === labelGlyph) : undefined;
  return glyphFor(schema, { mapsToCore: core });
}

// A link out of the commons (a peer's entry): http(s) only (P-8).
export const outHref = (u) => { const h = safeHref(u); return h && /^https?:\/\//i.test(h) ? h : null; };
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function day(iso, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const y = String(now ?? '').slice(0, 4);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${y && y !== m[1] ? ` ${m[1]}` : ''}`;
}
export const time = (iso, now) => (iso && day(iso, now) ? `<time datetime="${esc(iso.slice(0, 10))}">${day(iso, now)}</time>` : '');
const shortDid = (d) => (d.length > 24 ? `${d.slice(0, 12)}…${d.slice(-4)}` : d);
const attrs = (o) => Object.entries(o).map(([k, v]) => ` data-${k}="${esc(v ?? '')}"`).join('');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

export function fontOpts(fonts, up) {
  const f = fonts == null || typeof fonts === 'string' ? { mode: fonts ?? 'house' } : fonts;
  return { fonts: f.mode ?? 'house', fontEmbed: f.embed ?? 'inline', fontBase: `${up}${f.base ?? '_kms/fonts/'}` };
}

// What the page may show: the public side never shows an internal entry, whatever it was handed.
export function visible(commons, preview) {
  const entries = (commons.entries ?? []).filter((e) => preview || !e.internal);
  const byKind = new Map();
  for (const e of entries) {
    if (!byKind.has(e.schema)) byKind.set(e.schema, { schema: e.schema, label: e.kindLabel, glyph: houseGlyph(e.schema, e.glyphType), count: 0 });
    byKind.get(e.schema).count++;
  }
  const kinds = [...byKind.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { entries, kinds, review: preview ? (commons.needsReview ?? []) : [] };
}

const byUpdated = (a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || a.title.localeCompare(b.title);

// Facets the filters offer: Kind, Maturity, Public use, Source — values as the rows carry them.
const facetOf = {
  kind: (e) => [e.schema, e.kindLabel],
  mat: (e) => [e.maturity ?? '', e.mark?.word ?? (e.maturity ? e.maturity : 'No maturity')],
  use: (e) => [e.publicUse ?? '', publicUseWord(e.publicUse) ?? 'Not set'],
  from: (e) => [e.origin ? e.origin.peer : '', e.origin ? e.origin.peer : 'This commons'],
};
const FACETS = [['kind', 'Kind'], ['mat', 'Maturity'], ['use', 'Public use'], ['from', 'Source']];
const rowData = (e) => ({ kind: e.schema, mat: e.maturity ?? '', use: e.publicUse ?? '', from: e.origin ? e.origin.peer : '', d: e.updated ?? '', t: e.title, k: e.kindLabel });

function markFor(e) {
  if (e.maturity && Object.hasOwn(MATURITY_MARK, e.maturity) && !(e.deprecated && MATURITY_MARK[e.maturity].shape !== 'closed')) return mark(e.maturity);
  if (e.deprecated) return mark('deprecated');
  return '<span></span>';
}

// The second line: the lock (preview), where a peer's entry comes from, the summary, what supersedes it.
function subLine(e, preview) {
  const parts = [];
  if (preview && e.internal) parts.push(visibility('internal'));
  const o = e.origin;
  if (o) {
    const out = outHref(o.href);
    parts.push(`<span class="ext">${icon('link')}from ${esc(o.peer)}${out ? ' ↗' : ''}</span>`);
    if (preview && o.failed) parts.push(`<span class="age failed">couldn’t read${o.readAge ? ` · last ${esc(o.readAge)} ago` : ''}</span>`);
    else if (o.readAge) parts.push(`<span>read ${esc(o.readAge)} ago</span>`);
  }
  if (e.summary) parts.push(`<span>${esc(e.summary)}</span>`);
  if (e.deprecated) parts.push(`<span>${e.deprecated.byTitle ? `Superseded by “${esc(e.deprecated.byTitle)}”.` : 'Deprecated.'}</span>`);
  return parts.join(' · ');
}

function listRow(e, { up, preview, now, g, review = false }) {
  const href = e.origin ? outHref(e.origin.href) : `${up}${e.href}`;
  const html = dataRow({
    href, glyph: houseGlyph(e.schema, e.glyphType), dashed: !!e.origin, title: e.title, sub: subLine(e, preview),
    markHtml: review ? mark('needs', { word: 'Awaiting review' }) : markFor(e), end: time(e.updated, now),
    cls: !review && (e.deprecated || e.mark?.shape === 'closed') ? 'dep' : '',
  });
  return html.replace(/^<li>/, `<li${attrs({ g, ...rowData(e) })}>`);
}

function tableRow(e, { up, preview, now }) {
  const href = e.origin ? outHref(e.origin.href) : `${up}${e.href}`;
  const dep = e.deprecated || e.mark?.shape === 'closed';
  const title = href ? `<a href="${esc(href)}">${esc(e.title)}${e.origin ? ' ↗' : ''}</a>` : esc(e.title);
  const use = [preview && e.internal ? visibility('internal') : '', esc(publicUseWord(e.publicUse) ?? '')].filter(Boolean).join(' ');
  const src = e.origin ? `from ${esc(e.origin.peer)}` : 'This commons';
  return `<tr${dep ? ' class="dep"' : ''}${attrs(rowData(e))}><td class="c-t">${title}</td>`
    + `<td><span class="tk">${icon(houseGlyph(e.schema, e.glyphType))}${esc(e.kindLabel)}</span></td>`
    + `<td>${markFor(e)}</td><td>${use}</td><td>${time(e.updated, now)}</td><td>${src}</td></tr>`;
}

function filterPanel(entries) {
  const sets = FACETS.map(([key, legend]) => {
    const vals = new Map();
    for (const e of entries) {
      const [v, l] = facetOf[key](e);
      if (!vals.has(v)) vals.set(v, { l, n: 0 });
      vals.get(v).n++;
    }
    const opts = [...vals].sort((a, b) => a[1].l.localeCompare(b[1].l))
      .map(([v, { l, n }]) => `<label><input type="checkbox" value="${esc(v)}" data-l="${esc(l)}"><span>${esc(l)}</span><span class="n">${n}</span></label>`).join('');
    return `<fieldset data-f="${key}"><legend>${legend}</legend>${opts}</fieldset>`;
  }).join('');
  return `<div class="fpanel" id="fpanel" hidden>${sets}</div>`;
}

function navLinks({ up, kinds, kind, total, mapHref, apiHref, preview, did, ids = '' }) { // apiHref null: no JSON API link (the preview writes no API tree)
  const cur = (on) => (on ? ' aria-current="page"' : '');
  const link = (href, glyph, label, n, on, extra = '') => `<a href="${esc(href)}"${cur(on)} title="${esc(label)}">${icon(glyph)}<span class="lbl">${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ''}${extra}</a>`;
  const main = link(`${up}index.html`, 'list', 'Commons', total, !kind)
    + (mapHref ? link(mapHref, 'map', 'Federation map', null, false) : '');
  const kindsNav = kinds.length
    ? `<div class="nav"><div class="nav-h" id="kinds-h${ids}">Kinds</div>${kinds.map((k) => link(`${up}k/${k.schema}/index.html`, k.glyph, k.label, k.count, kind === k.schema)).join('')}</div>`
    : '';
  const foot = `<div class="nav side-foot">${apiHref ? link(apiHref, 'braces', 'JSON API', null, false, `<span class="ext-i">${icon('ext')}</span>`) : ''}`
    + `<div class="who"><span class="hatmark">${icon('seal')}</span><div class="w"><div class="w-t">${preview ? 'Steward’s preview' : 'Published commons'}</div>`
    + `${did ? `<code class="w-s" title="${esc(did)}">${esc(shortDid(did))}</code>` : ''}</div></div></div>`;
  return `<div class="nav">${main}</div>${kindsNav}${foot}`;
}

// The frame every commons page shares (spec §5.4–5.5; L4 §5): the sidebar (≥1100) / rail (760–1099), the top bar
// (crumbs html, trailing tools html), the phone bar and menu sheet (<760), the preview band, `main` (html, holding
// <main id="main">), the live region and the ⌘K palette. `current` is the schema whose kind link is current (null:
// Commons). Exported for the knowledge page (render-entry.mjs), which wears the same frame.
export function frame({ instance, did, kinds, total, up, current = null, preview, map, crumbs, tools = '', where, main, skip, api = true }) {
  const apiHref = api ? `${up}api/index.json` : null;
  const nav = (ids) => navLinks({ up, kinds, kind: current, total, mapHref: map, apiHref, preview, did, ids });
  const side = `<nav class="side" aria-label="Commons">`
    + `<div class="org"><span class="seal">${icon('seal')}</span><span class="nm">${esc(instance)}</span></div>`
    + `<button class="search" type="button" data-pal-open hidden aria-keyshortcuts="Meta+K Control+K" title="Search the commons">${icon('search')}<span class="lbl">Search the commons</span><kbd>⌘K</kbd></button>`
    + `${nav('')}</nav>`;
  const top = `<header class="topbar"><div class="crumbs">${crumbs}</div>`
    + `${tools ? `<div class="tools">${tools}</div>` : ''}</header>`;
  const ptop = `<header class="ptop"><span class="seal">${icon('seal')}</span><b>${esc(where)}</b><span class="tools">`
    + `<button class="btn icon ghost" type="button" data-pal-open hidden aria-label="Search the commons">${icon('search')}</button>`
    + `<button class="btn icon ghost" type="button" popovertarget="sheet" aria-label="Menu">${icon('menu')}</button></span></header>`;
  const sheet = `<div class="sheet" id="sheet" popover><div class="grab" aria-hidden="true"></div>`
    + `<nav aria-label="Commons menu">${nav('-sheet')}</nav>`
    + `<button class="btn sheet-close" type="button" popovertarget="sheet" popovertargetaction="hide">Close</button></div>`;

  // ── the palette ──────────────────────────────────────────────────────────
  const jump = [{ t: 'Commons', g: 'list', h: `${up}index.html`, sub: plural(total, 'entry', 'entries') },
    ...kinds.map((k) => ({ t: k.label, g: k.glyph, h: `${up}k/${k.schema}/index.html`, sub: plural(k.count, 'entry', 'entries') })),
    ...(map ? [{ t: 'Federation map', g: 'map', h: map, sub: '' }] : [])];
  const cfg = { up, src: preview ? null : `${up}_kms/search.json`, kinds: kinds.map((k) => ({ l: k.label, g: k.glyph })), jump };
  const pal = `<dialog class="pal" id="pal" aria-label="Search the commons">`
    + `<div class="pal-in">${icon('search')}<input type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-label="Search the commons" placeholder="Search entries and kinds" autocomplete="off" spellcheck="false">`
    + `<button class="btn icon ghost pal-x" type="button" data-pal-close aria-label="Close search">${icon('x')}</button></div>`
    + `<div class="pal-list" id="pal-list" role="listbox" aria-label="Results"></div><p class="pal-none" role="status" hidden></p>`
    + `<div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div></dialog>`
    + `<script type="application/json" id="kms-pal">${json(cfg)}</script>`;

  return `<a class="skip" href="#main">${esc(skip)}</a>`
    + `<div class="hf">${side}<div class="mainc">${top}${ptop}${preview ? band({ html: BAND }) : ''}`
    + `${main}`
    + `</div></div>${sheet}<p class="sr-only" id="live" aria-live="polite"></p>${pal}`;
}

/**
 * renderIndex(commons, { kind, preview, fonts, now, mapHref }) → HTML string.
 *   kind     null → the index (public/index.html); a schema → that kind's page (public/k/<schema>/index.html)
 *   preview  the steward's preview (renders/preview/): band, review queue first, internal rows with the lock
 *   fonts    'house' | 'system' | { mode, embed: 'inline'|'relative', base } — a relative base is taken from the
 *            site root and made relative to this page's depth
 *   now      ISO time the pages were generated ("Updated 29 Oct")
 *   mapHref  where the federation map is, from the site root (omitted: no map link)
 *   json     false: no JSON API link (the preview writes no API tree, R-33)
 */
export function renderIndex(commons, { kind = null, preview = false, fonts = 'house', now = null, mapHref = null, json: withApi = true } = {}) {
  const { entries, kinds, review } = visible(commons, preview);
  if (kind && !kinds.some((k) => k.schema === kind)) throw new Error(`unknown kind: ${kind}`);
  const up = kind ? '../../' : '';
  const rel = (h) => { const s = safeHref(h); if (!s) return null; return /^https?:\/\//i.test(s) ? s : (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') ? null : `${up}${s}`); };
  const map = mapHref ? rel(mapHref) : null;
  const instance = commons.instance ?? 'Knowledge commons';
  const kindInfo = kind ? kinds.find((k) => k.schema === kind) : null;
  const shown = (kind ? entries.filter((e) => e.schema === kind) : entries).slice().sort(byUpdated);
  const queue = (kind ? review.filter((e) => e.schema === kind) : review).slice().sort(byUpdated);
  const where = kindInfo ? kindInfo.label : 'Commons';
  const ctx = { up, preview, now };

  const crumbs = kindInfo
    ? `<span>${esc(instance)}</span><span class="slash" aria-hidden="true"></span><a href="${up}index.html">Commons</a><span class="slash" aria-hidden="true"></span><b>${esc(kindInfo.label)}</b>`
    : `<span>${esc(instance)}</span><span class="slash" aria-hidden="true"></span><b>Commons</b>`;

  // ── head ─────────────────────────────────────────────────────────────────
  const facts = kindInfo
    ? [plural(kindInfo.count, 'entry', 'entries')]
    : [plural(entries.length, 'entry', 'entries'), plural(kinds.length, 'kind', 'kinds'), plural(commons.counts?.sources ?? 0, 'source', 'sources'), plural(commons.counts?.peersRead ?? 0, 'peer read', 'peers read')];
  const head = `<div class="kh"><span class="eyebrow">Knowledge commons</span><h1 id="h1">${esc(kindInfo ? kindInfo.label : instance)}</h1>`
    + `<p class="facts-l">${facts.map((f) => `<span>${esc(f)}</span>`).join('<span class="dot-sep"></span>')}</p>`
    + `${!kindInfo && commons.sentence ? `<p class="lede">${esc(commons.sentence)}</p>` : ''}`
    + `${kindInfo ? `<a class="kh-back" href="${up}index.html">Back to the commons</a>` : ''}</div>`;

  // ── the entries ──────────────────────────────────────────────────────────
  let views;
  if (!shown.length && !queue.length) {
    views = preview
      ? '<div class="note-block"><b>No entries in the canon yet.</b><span>Entries appear here as soon as the canon holds one, published or not.</span></div>'
      : '<div class="note-block"><b>Nothing published yet.</b><span>Entries appear here once the steward publishes them from the canon.</span></div>';
  } else {
    const groups = [];
    if (queue.length) groups.push({ g: 'review', label: 'Needs review', rows: queue, review: true });
    for (const k of kinds) {
      if (kind && k.schema !== kind) continue;
      groups.push({ g: k.schema, label: k.label, rows: shown.filter((e) => e.schema === k.schema), all: kind ? null : `${up}k/${k.schema}/index.html` });
    }
    const list = groups.map((grp) => groupRow({
      label: grp.label, count: grp.rows.length,
      end: grp.all ? `<a href="${esc(grp.all)}">All ${grp.rows.length}<span class="sr-only"> · ${esc(grp.label)}</span></a>` : '',
    }) + grp.rows.map((e) => listRow(e, { ...ctx, g: grp.g, review: grp.review })).join('')).join('');
    const table = `<table class="tbl"><caption class="sr-only">${esc(where)}, as a table</caption><thead><tr>`
      + ['Title', 'Kind', 'Maturity', 'Public use', 'Updated', 'Source'].map((h) => `<th scope="col">${h}</th>`).join('')
      + `</tr></thead><tbody>${shown.map((e) => tableRow(e, ctx)).join('')}</tbody></table>`;
    const vbar = `<div class="vbar" hidden><div class="tabs" role="tablist" aria-label="Views">`
      + `<button type="button" role="tab" id="tab-list" data-v="list" aria-selected="true" aria-controls="p-list">${icon('list')}List</button>`
      + `<button type="button" role="tab" id="tab-table" data-v="table" aria-selected="false" aria-controls="p-table" tabindex="-1">${icon('table')}Table</button></div>`
      + `<div class="end"><span class="chips" data-chips></span>`
      + `<div class="fpick"><button type="button" class="fchip add" data-fbtn aria-expanded="false" aria-controls="fpanel">${icon('plus')}Filter</button>${filterPanel(shown)}</div>`
      + `<button type="button" class="fchip add" data-sort="updated">${icon('sort')}<span class="sr-only">Sort by </span><span class="v">Updated</span></button></div></div>`;
    views = `<p class="note nojs" data-nojs>${icon('info')}<span>${NOJS}</span></p>${vbar}`
      + `<div class="views" data-view="list">`
      + `<div class="p-list" role="tabpanel" id="p-list" aria-labelledby="tab-list"><div class="surf"><ul class="rows">${list}</ul></div></div>`
      + `<div class="p-table" role="tabpanel" id="p-table" aria-labelledby="tab-table" hidden><div class="surf">${table}</div></div>`
      + `<p class="note empty" data-none hidden>${icon('info')}<span>Nothing matches these filters. <button type="button" class="act" data-clear>Clear filters</button></span></p>`
      + `</div>`;
  }

  const bodyHtml = frame({
    instance, did: commons.did, kinds, total: entries.length, up, current: kind, preview, map, crumbs, where, api: withApi,
    tools: now ? `Updated ${time(now, now)}` : '', skip: 'Skip to the entries',
    main: `<main id="main"><div class="content">${head}<section class="idx" aria-labelledby="h-entries"><h2 class="sr-only" id="h-entries">Entries</h2>${views}</section></div></main>`,
  });

  const title = `${preview ? 'Preview · ' : ''}${kindInfo ? `${kindInfo.label} · ${instance}` : instance}`;
  return page({
    title, groups: ['base', 'atoms', 'rows'], extraCss: [FRAME_CSS()], ...fontOpts(fonts, up),
    icons: ['file', 'x', 'search', 'list', 'map', ...kinds.map((k) => k.glyph)], body: bodyHtml, script: `(${client})();`,
  });
}

/** searchIndex(commons) → [{ t, k, h, s }] for `_kms/search.json`: published entries only; h from the site root. */
export function searchIndex(commons) {
  return (commons.entries ?? []).filter((e) => !e.internal).flatMap((e) => {
    const h = e.origin ? outHref(e.origin.href) : e.href;
    return h ? [{ t: e.title, k: e.kindLabel, h, s: e.summary ?? '' }] : [];
  });
}

// ── the page script ─────────────────────────────────────────────────────────
// Serialised into the page with Function.prototype.toString: it must not close over anything in this module.
export function client() {
  const doc = document;
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => [...r.querySelectorAll(s)];
  const cfg = JSON.parse($('#kms-pal').textContent);
  const live = $('#live');
  const say = (t) => { live.textContent = live.textContent === t ? `${t} ` : t; };
  const NS = 'http://www.w3.org/2000/svg';
  const glyph = (g) => { const s = doc.createElementNS(NS, 'svg'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); const u = doc.createElementNS(NS, 'use'); u.setAttribute('href', `#i-${g}`); s.append(u); return s; };
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // our own index, still checked: http(s), or relative and not from the root or another host
  const safe = (h) => typeof h === 'string' && (/^https?:\/\//i.test(h) || (!/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^[/\\]/.test(h) && !/[\u0000- ]/.test(h)));

  // what only works with a script comes out; the line that says so goes
  $$('[data-nojs]').forEach((n) => n.remove());
  $$('.vbar, [data-pal-open], .p-table').forEach((n) => n.removeAttribute('hidden'));

  // ── views: List · Table (APG tabs, automatic activation) ──
  const views = $('.views');
  const tabs = $$('.tabs [role="tab"]');
  const setView = (v, focus) => {
    views.dataset.view = v;
    tabs.forEach((t) => { const on = t.dataset.v === v; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setView(t.dataset.v));
    t.addEventListener('keydown', (e) => {
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      setView(tabs[(j + tabs.length) % tabs.length].dataset.v, true);
    });
  });

  // ── filters and sort, over the rows already in the page ──
  const fbtn = $('[data-fbtn]');
  const panel = $('#fpanel');
  const chips = $('[data-chips]');
  const none = $('[data-none]');
  const ul = $('.p-list .rows');
  const tbody = $('.tbl tbody');
  const facets = panel ? $$('fieldset', panel).map((fs) => ({ key: fs.dataset.f, legend: $('legend', fs).textContent, boxes: $$('input', fs) })) : [];
  const items = () => [...(ul ? $$(':scope > li[data-g]', ul) : []), ...(tbody ? [...tbody.rows] : [])];
  const openPanel = (open, back) => {
    if (!panel) return;
    panel.hidden = !open;
    fbtn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('input')?.focus();
    else if (back) fbtn.focus();
  };
  const apply = () => {
    const act = facets.map((f) => ({ f, on: f.boxes.filter((b) => b.checked) })).filter((x) => x.on.length);
    let shown = 0;
    for (const n of items()) {
      const ok = act.every(({ f, on }) => on.some((b) => b.value === n.dataset[f.key]));
      n.hidden = !ok;
      if (ok && n.tagName === 'LI' && n.dataset.g !== 'review') shown++;
    }
    if (ul) {
      let head = null; let count = 0;
      const close = () => { if (head) { head.querySelector('.c').textContent = String(count); head.hidden = count === 0; } };
      for (const li of ul.children) {
        if (li.classList.contains('grp-h')) { close(); head = li; count = 0; } else if (!li.hidden) count++;
      }
      close();
    }
    if (none) none.hidden = shown > 0;
    chips.textContent = '';
    for (const { f, on } of act) {
      const b = el('button', 'fchip');
      b.type = 'button';
      b.append(el('span', 'sr-only', 'Remove filter: '), el('span', 'k', `${f.legend} is`), ` ${on.map((x) => x.dataset.l).join(', ')}`, glyph('x'));
      b.addEventListener('click', () => { on.forEach((x) => { x.checked = false; }); apply(); fbtn.focus(); });
      chips.append(b);
    }
    say(`${shown} ${shown === 1 ? 'entry' : 'entries'} shown`);
  };
  if (panel) {
    fbtn.addEventListener('click', () => openPanel(panel.hidden));
    panel.addEventListener('change', apply);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); openPanel(false, true); } });
    doc.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.fpick')) openPanel(false); });
    doc.addEventListener('focusin', (e) => { if (!panel.hidden && !e.target.closest('.fpick')) openPanel(false); });
  }
  $('[data-clear]')?.addEventListener('click', () => { facets.forEach((f) => f.boxes.forEach((b) => { b.checked = false; })); apply(); fbtn.focus(); });

  const sortBtn = $('[data-sort]');
  const sortBy = (k) => {
    sortBtn.dataset.sort = k;
    $('.v', sortBtn).textContent = k === 'title' ? 'Title' : 'Updated';
    const cmp = k === 'title'
      ? (a, b) => a.dataset.t.localeCompare(b.dataset.t)
      : (a, b) => b.dataset.d.localeCompare(a.dataset.d) || a.dataset.t.localeCompare(b.dataset.t);
    if (ul) {
      const out = []; let grp = [];
      const flush = () => { out.push(...grp.sort(cmp)); grp = []; };
      for (const li of [...ul.children]) { if (li.classList.contains('grp-h')) { flush(); out.push(li); } else grp.push(li); }
      flush();
      out.forEach((li) => ul.append(li));
    }
    if (tbody) [...tbody.rows].sort(cmp).forEach((tr) => tbody.append(tr));
    say(`Sorted by ${k === 'title' ? 'title' : 'last updated'}`);
  };
  sortBtn?.addEventListener('click', () => sortBy(sortBtn.dataset.sort === 'updated' ? 'title' : 'updated'));

  // ── ⌘K: the palette, over _kms/search.json — or, where that cannot be read (file://), the rows in the page ──
  const dlg = $('#pal');
  const input = $('input', dlg);
  const list = $('#pal-list');
  const nothing = $('.pal-none', dlg);
  const glyphOf = Object.fromEntries(cfg.kinds.map((k) => [k.l, k.g]));
  let index = null; let loading = null; let opts = []; let active = -1; let opener = null;
  const fromRows = () => {
    const seen = new Set(); const out = [];
    for (const li of $$('.p-list .rows > li[data-g]')) {
      const a = li.querySelector('a.row');
      const h = a && a.getAttribute('href');
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push({ t: li.dataset.t, k: li.dataset.k, h, s: li.querySelector('.s')?.textContent ?? '' });
    }
    return out;
  };
  const load = () => {
    if (index) return Promise.resolve(index);
    if (!loading) {
      const http = /^https?:$/.test(location.protocol);
      loading = (cfg.src && http
        ? fetch(cfg.src, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .then((a) => a.filter((x) => x && typeof x.t === 'string' && safe(x.h)).map((x) => ({ t: x.t, k: String(x.k ?? ''), s: String(x.s ?? ''), h: /^https?:/i.test(x.h) ? x.h : cfg.up + x.h })))
        : Promise.reject(new Error('no fetch here')))
        .catch(() => fromRows())
        .then((a) => { index = a; return a; });
    }
    return loading;
  };
  const setActive = (i) => {
    active = i;
    opts.forEach((o, j) => o.n.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', opts[i].n.id); opts[i].n.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const go = (h) => { if (safe(h)) location.href = h; };
  const titled = (t, q) => {
    const s = el('span', 'pt'); const i = q ? t.toLowerCase().indexOf(q) : -1;
    if (i < 0) { s.textContent = t; return s; }
    s.append(t.slice(0, i), el('mark', '', t.slice(i, i + q.length)), t.slice(i + q.length));
    return s;
  };
  const render = () => {
    const raw = input.value.trim(); const q = raw.toLowerCase();
    list.textContent = ''; opts = [];
    const groups = [];
    if (q && index) {
      const hits = index.map((e) => {
        const i = e.t.toLowerCase().indexOf(q);
        const r = i === 0 ? 0 : i > 0 ? 1 : (e.k.toLowerCase().includes(q) || e.s.toLowerCase().includes(q)) ? 2 : -1;
        return { e, r };
      }).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.e.t.localeCompare(b.e.t)).slice(0, 20);
      if (hits.length) groups.push(['Entries', hits.map(({ e }) => ({ t: e.t, sub: e.k, g: glyphOf[e.k] ?? 'file', h: e.h }))]);
    }
    const jumps = cfg.jump.filter((j) => !q || j.t.toLowerCase().includes(q));
    if (jumps.length) groups.push(['Jump to', jumps]);
    groups.forEach(([name, rows], gi) => {
      const g = el('div'); g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', `pal-g${gi}`);
      const h = el('div', 'pal-g', name); h.id = `pal-g${gi}`; h.setAttribute('role', 'presentation');
      g.append(h);
      for (const it of rows) {
        const idx = opts.length;
        const o = el('div', 'pal-o'); o.id = `pal-o${idx}`; o.setAttribute('role', 'option');
        o.append(glyph(it.g), titled(it.t, q));
        if (it.sub) o.append(el('span', 'sub', it.sub));
        o.addEventListener('click', () => go(it.h));
        o.addEventListener('pointermove', () => { if (active !== idx) setActive(idx); });
        g.append(o);
        opts.push({ n: o, h: it.h });
      }
      list.append(g);
    });
    list.hidden = !opts.length;
    nothing.hidden = !!opts.length;
    nothing.textContent = opts.length ? '' : `Nothing matches “${raw}”. Try a kind or a word from a title.`;
    setActive(opts.length ? 0 : -1);
  };
  const open = () => {
    if (dlg.open) return;
    opener = doc.activeElement;
    input.value = '';
    render();
    dlg.showModal();
    input.focus();
    load().then(render);
  };
  input.addEventListener('input', () => { render(); load().then(() => render()); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (opts.length) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length);
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); go(opts[active].h); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-pal-close]')) dlg.close(); });
  dlg.addEventListener('close', () => { if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus(); });
  $$('[data-pal-open]').forEach((b) => b.addEventListener('click', () => { $('#sheet')?.hidePopover?.(); open(); }));
  doc.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dlg.open) dlg.close(); else open(); }
  });
}
