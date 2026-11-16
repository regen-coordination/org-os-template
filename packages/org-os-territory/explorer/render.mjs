// explorer/render.mjs — pure view → HTML string functions (the build renders the first paint with them; the page inlines them for re-renders).
// Every interactive element carries data-action (what it dispatches) and data-key (so focus survives a re-render and the tour can point at it).
// No imports, no DOM: the build inlines this file as classic script text, with its `export` keywords stripped.
//
// Drawn in the house (spec §5.8, gallery §07). The house atoms — glyphs, kind tiles, the open mark, the note line, the callout, the band and
// the field-row box — are kms's markup, not copies: build.mjs renders each once through kms's helpers with SLOT where the words go, fills
// ATOMS with them, and inlines the same ATOMS into the page, so what the browser re-renders is drawn from the same strings the build wrote.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SLOT = '@@SLOT@@';
export const SLOT2 = '@@SLOT2@@';
export const ATOMS = { icon: {}, ktile: {}, mark: {}, note: '', callout: '', band: '', fields: '' };
const fill = (tpl, html, html2 = '') => tpl.replace(SLOT, () => html).replace(SLOT2, () => html2);
export function ic(name) { const h = ATOMS.icon[name]; if (!h) throw new Error(`no glyph: ${name}`); return h; }
export function ktile(glyph) { const h = ATOMS.ktile[glyph]; if (!h) throw new Error(`no kind tile: ${glyph}`); return h; }
export function mk(shape, word) { const h = ATOMS.mark[shape]; if (!h) throw new Error(`no mark: ${shape}`); return fill(h, esc(word)); }
export const note = (text) => fill(ATOMS.note, esc(text));
// `html` arguments below are trusted static markup written in this file, or escaped by the caller.
export const callout = (html) => fill(ATOMS.callout, html);
export const fields = (pairs) => fill(ATOMS.fields, pairs.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join(''));

const cls = (...names) => names.filter(Boolean).join(' ');
const pct = (n) => `${Math.round(n * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const things = (n) => plural(n, 'thing', 'things');
const LAYER_LABEL = { administrative: 'Administrative', landscape: 'Landscape', ecological: 'Ecological', hydrological: 'Hydrological' };
const VIEW_LABEL = { you: 'You', 'peer-pack': 'A peer with the pack', 'peer-nopack': 'A peer without it' };
const SHARE_LABEL = { nothing: 'Nothing', units: 'Your places', 'units-streams': 'Your places and data streams' };
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// A data row (house §9.2): kind tile · title and its parts · end. `t`, parts and `end` are html. `attrs` makes the row a button.
function row({ glyph, t, s = [], tag = '', s2 = [], end = '', attrs = '', extra = '' }) {
  const parts = (list) => list.map((x) => `<span>${x}</span>`).join('');
  const inner = `${ktile(glyph)}<span class="main"><span class="t">${t}</span>${s.length || tag ? `<span class="s">${parts(s)}${tag}</span>` : ''}${s2.length ? `<span class="s s2">${parts(s2)}</span>` : ''}</span><span class="end">${end}</span>`;
  const c = cls('row', 'xr', extra);
  return attrs ? `<li><button type="button" class="${c}" ${attrs}>${inner}</button></li>` : `<li><div class="${c}">${inner}</div></li>`;
}
const rows = (items) => `<ul class="rows surf">${items.join('')}</ul>`;

// ── the artifact bar's tools: Take the tour, and View as (L4 §5.9) with its menu ───────────────────────────────────────
export function renderTools(v) {
  const va = v.viewAs;
  const item = (action, value, label, on) => `<button type="button" role="menuitemradio" class="mi" aria-checked="${on}" tabindex="-1" data-action="${action}" data-value="${value}" data-key="${action}:${value}"><span>${esc(label)}</span>${ic('check')}</button>`;
  const group = (id, head, action, labels, current) => `<div role="group" aria-labelledby="${id}"><span class="mh eyebrow" id="${id}">${head}</span>${Object.entries(labels).map(([value, label]) => item(action, value, label, value === current)).join('')}</div>`;
  const floor = `<p class="floor" id="viewas-floor">Never leaves, whatever you share: ${va.neverLeaves.streams.map((s) => `“${esc(s)}”`).join(', ')}; the private <code>${va.neverLeaves.fields.map(esc).join('</code>, <code>')}</code> on a place. `
    + `Ordinary items (the projects placed here) are not part of the pack: they are shared by their own setting, not by this menu${va.resourceRefsTravel ? ' — and they keep their place references, which a peer without the pack cannot look up' : ''}.</p>`;
  const menu = v.menu ? `<div class="menu" id="viewas-pop"><div role="menu" id="viewas-menu" aria-labelledby="viewas" aria-describedby="viewas-floor">`
    + group('va-share-h', 'Of your territory, you share', 'share', SHARE_LABEL, va.share) + '<div role="separator" class="sep"></div>'
    + group('va-view-h', 'View as', 'view', VIEW_LABEL, va.who) + `</div>${floor}</div>` : '';
  return `<button type="button" class="btn" data-action="tour" data-value="start" data-key="tour-start">Take the tour</button>`
    + `<div class="va"><button type="button" class="viewas" id="viewas" data-action="menu" data-value="toggle" data-key="viewas" aria-haspopup="menu" aria-expanded="${v.menu}"${v.menu ? ' aria-controls="viewas-menu"' : ''}>`
    + `${ic('eye')}<span class="va-l">View as: ${esc(lower(VIEW_LABEL[va.who]))}</span><span class="chev">${ic('chev-r')}</span></button>${menu}</div>`;
}

// ── the previewing band (house §5.9): only while viewing as a peer; it carries the counts the old dimming conveyed ─────
export function renderBand(v) {
  const va = v.viewAs; const c = va.counts;
  if (!c) return '';
  const k = va.neverLeaves.streams.length;
  const never = `The private note and ${plural(k, 'stream', 'streams')} never leave.`;
  const body = va.who === 'peer-pack'
    ? `<b>Previewing as a peer with the pack.</b> They receive your ${plural(c.units, 'place', 'places')} and ${plural(c.streams, 'data stream', 'data streams')}. ${never}`
    : `<b>Previewing as a peer without the pack.</b> Their org-os doesn’t know what a place or a data stream is, so it never asks for one. They receive ${plural(c.units, 'place', 'places')} and ${plural(c.streams, 'data stream', 'data streams')}. ${never}`;
  const exit = '<button type="button" class="btn" data-action="view" data-value="you" data-key="exit-preview">Exit preview</button>';
  return `<div class="xp-bandin" data-key="band">${fill(ATOMS.band, body, exit)}</div>`;
}

// ── layers: one APG tree per layer (house §9.7) ───────────────────────────────────────────────────────────────────────
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children)]);

function treeItem(n, stop) {
  const label = [n.title, n.level, things(n.count), n.ancestor && 'contains the selected place', n.overlap && `overlaps the selected place, ${pct(n.overlap.shareSelf)}`].filter(Boolean).join(', ');
  const tg = n.expanded === null ? '<span class="tg"></span>' : `<span class="tg" data-action="toggle-open" data-id="${esc(n.id)}" aria-hidden="true">${ic('chev-r')}</span>`;
  const end = `${n.overlap ? `<span class="overmark">${ic('swap')}overlaps · ${pct(n.overlap.shareSelf)}</span>` : ''}<span class="cntc">${n.count || ''}</span>`;
  return `<li role="treeitem" aria-level="${n.depth}"${n.expanded === null ? '' : ` aria-expanded="${n.expanded}"`} aria-selected="${n.selected}" tabindex="${n.id === stop ? 0 : -1}" aria-label="${esc(label)}" data-action="select" data-id="${esc(n.id)}" data-key="unit:${esc(n.id)}" data-name="${esc(n.title)}">`
    + `<div class="${cls('tnode', n.selected && 'sel', n.overlap && 'over')}">${tg}<span class="pin">${ic('pin')}</span><span class="nmx"><b>${esc(n.title)}</b><span class="lvl">${esc(n.level)}</span></span>${end}</div>`
    + `${n.children.length ? `<ul role="group">${n.children.map((c) => treeItem(c, stop)).join('')}</ul>` : ''}</li>`;
}

function renderLayer(l) {
  const id = `layer-${esc(l.layer)}`;
  const items = flat(l.roots);
  const stop = (items.find((n) => n.selected) || items[0]).id; // roving tabindex: one tab stop per tree
  return `<div class="xp-layer" data-layer="${esc(l.layer)}"><h3 class="eyebrow" id="${id}">${esc(LAYER_LABEL[l.layer] || l.layer)}</h3>`
    + `<ul class="tree" role="tree" aria-labelledby="${id}">${l.roots.map((n) => treeItem(n, stop)).join('')}</ul></div>`;
}

export function renderBoard(v) {
  const none = v.viewAs.who === 'peer-nopack'
    ? 'A peer without the pack receives none of your places: its org-os doesn’t know what a place is.'
    : 'This peer receives none of your places: you share nothing of your territory.';
  const tray = v.tray.length ? `<div class="xp-layer xp-tray" id="tray"><h3 class="eyebrow" id="tray-h">Not placed anywhere</h3>`
    + rows(v.tray.map((x) => row({ glyph: 'file', t: esc(x.resource), s: [`refers to <code>${esc(x.ref)}</code>, a place this territory doesn’t have`] }))) + '</div>' : '';
  return `<section class="surf xp-board" id="board" aria-labelledby="board-h"><h2 id="board-h" class="sr-only">Places, by layer</h2>`
    + (v.layers.length ? v.layers.map(renderLayer).join('') : note(none)) + tray + '</section>';
}

// ── the place inspector (house §5.10): complementary ─────────────────────────────────────────────────────────────────
function sec(id, title, n, body, { key = '', extra = '' } = {}) {
  return `<section class="xp-sec" aria-labelledby="${id}"><div class="sec-h"><h3 id="${id}"${key ? ` data-key="${key}" tabindex="-1"` : ''}>${title}</h3><span class="cnt">${n}</span>${extra}</div>${body}</section>`;
}

export function renderPanel(v) {
  const p = v.panel;
  if (!p) {
    return '<aside class="insp surf" id="panel" aria-labelledby="panel-h"><div class="insp-h"><div class="insp-name"><span class="eyebrow">Place</span><h2 id="panel-h" class="t">Pick a place</h2></div></div>'
      + '<div class="insp-b"><p class="insp-lead">Choose any place in the layers to see what it holds, what it overlaps, and which data exist for it — or take the tour.</p></div></aside>';
  }
  const pairs = [];
  if (p.ancestors.length) pairs.push(['Inside', esc(p.ancestors.map((a) => a.title).join(' › '))]);
  if (p.codes.length) pairs.push(['Codes', p.codes.map((c) => `<code>${esc(c)}</code>`).join(' ')]);
  if (p.privateNote) pairs.push([`${ic('lock')}Private note`, '<span class="restricted">Yours only · never leaves</span>']);
  const inside = p.hasInside ? `<label class="xp-inside"><input type="checkbox" data-change="toggle-inside" data-key="inside"${p.includeInside ? ' checked' : ''}> Include places inside it</label>` : '';
  const here = p.here.length ? rows(p.here.map((r) => row({ glyph: 'file', t: esc(r.title) }))) : note(`Nothing placed here${p.hasInside && !p.includeInside ? ' directly' : ''}.`);
  const overlaps = p.overlaps.length ? rows(p.overlaps.map((o) => row({
    glyph: 'swap', t: esc(o.title), s: [esc(o.layer), `${pct(o.shareOther)} of theirs`], tag: '<span class="inv">invented</span>', extra: 'wrap-end',
    end: `<span class="meter bar" aria-hidden="true"><b style="inline-size: ${pct(o.shareSelf)}"></b></span><span class="meter-l">${pct(o.shareSelf)}<span class="sr-only"> of this place</span></span>`,
    attrs: `data-action="select" data-id="${esc(o.id)}" data-key="overlap:${esc(o.id)}"`,
  }))) : note('No overlaps recorded.');
  const streams = p.streams.length ? rows(p.streams.map((s) => row({
    glyph: 'stream', t: esc(s.title), s: [esc(s.provider), `licence: ${esc(s.licence)}`, `trust: ${esc(s.trust)}`],
    s2: [esc(s.reason), `looked after by ${esc(s.steward)}`, esc(s.access), esc(s.cadence)],
  }))) : note('No data streams catalogued for this place.');
  return `<aside class="insp surf" id="panel" aria-labelledby="panel-h"><div class="insp-h"><span class="ktile lg">${ic('pin')}</span><div class="insp-name"><span class="eyebrow">Place · ${esc(p.layer)} · ${esc(p.level)}</span><h2 id="panel-h" class="t">${esc(p.title)}</h2></div></div>`
    + `<div class="insp-b">${pairs.length ? fields(pairs) : ''}`
    + sec('here-h', 'What’s here', p.here.length, here, { extra: inside })
    + sec('overlaps-h', 'Overlaps with', p.overlaps.length, overlaps, { key: 'overlaps' })
    + sec('streams-h', 'Data about this place', p.streams.length, streams, { key: 'streams' })
    + '</div></aside>';
}

// ── more about the page: the pack, and how the page was made ─────────────────────────────────────────────────────────
export function renderDrawers(v) {
  const open = (id) => v.drawer === id;
  const btn = (id, label) => `<button type="button" class="btn ghost" data-action="drawer" data-value="${id}" data-key="drawer-${id}" aria-expanded="${open(id)}"${open(id) ? ` aria-controls="drawer-${id}-body"` : ''}>${label}</button>`;
  const pack = open('pack') ? `<div class="surf xp-drawer" id="drawer-pack-body" data-key="drawer-pack-body"><p><b>Everything you just explored is one opt-in pack</b> — <code>${esc(v.pack.name)}</code> ${esc(v.pack.version)}. org-os itself was not changed to make room for it.</p>`
    + fields(v.pack.types.map((t) => [`<code>${esc(t.name)}</code>`, `${esc(t.description)} <span class="meta">Falls back to the built-in <code>${esc(t.mapsToCore)}</code>.</span>`]))
    + `<p>The fallback is declared so that a peer without the pack could one day read a place as a plain <code>place</code>. ${mk('open', 'Not built yet')} Today such a peer simply receives nothing of these types.</p>`
    + `<p>An organisation turns the pack on with one line in its <code>kms.yaml</code>: <code>${esc(v.pack.optInLine)}</code>. Without that line, nothing changes. Territory is the first pack; others can follow the same pattern.</p></div>` : '';
  const about = open('about') ? `<div class="surf xp-drawer" id="drawer-about-body" data-key="drawer-about-body"><p>This page was generated by running the real org-os code (commit <code>${esc(v.meta.commit)}</code>, <time datetime="${esc(v.meta.capturedAt)}">${esc(v.meta.capturedAt.slice(0, 10))}</time>, Node ${esc(v.meta.node)}) over an illustrative sample and recording what it answered. The page only switches between recorded answers.</p>`
    + `<p>${esc(v.note)} ${esc(v.extraNote)}</p><p>For the engineering verification report, run <code>npm run demo</code> in <code>packages/org-os-territory</code>.</p></div>` : '';
  return `<section class="xp-more" id="drawers" aria-label="More about this page"><div class="xp-more-btns">${btn('pack', 'What is a pack?')}${btn('about', 'About this page')}</div>${pack}${about}</section>`;
}

// ── the tour: a pop card anchored to its target (app.js places it), non-modal; Esc ends it ───────────────────────────
export function renderTour(v) {
  const t = v.tour;
  if (!t) return '';
  return `<div class="coach" id="tour" role="dialog" aria-modal="false" aria-labelledby="tour-h" data-target="${esc(t.target)}"><span class="step">Step ${t.index + 1} of ${t.total}</span><h2 id="tour-h" data-key="tour-h" tabindex="-1">${esc(t.title)}</h2><p>${esc(t.text)}</p>`
    + '<div class="acts"><button type="button" class="btn ghost" data-action="tour" data-value="end" data-key="tour-end">Skip tour</button><span class="sp"></span>'
    + `${t.index > 0 ? '<button type="button" class="btn ghost" data-action="tour" data-value="back" data-key="tour-back">Back</button>' : ''}`
    + `<button type="button" class="btn primary" data-action="tour" data-value="next" data-key="tour-next">${t.last ? 'Finish' : 'Next'}</button></div></div>`;
}

// The sample note as the house callout: "Illustrative sample: …" → a bold lead and the rest.
function banner(text) {
  const m = String(text).match(/^([^:]+):\s*(.*)$/s);
  const html = m ? `<b>${esc(m[1])}.</b> ${esc(m[2].charAt(0).toUpperCase() + m[2].slice(1))}` : esc(text);
  return `<div id="banner" role="note">${callout(html)}</div>`;
}

export function renderApp(v) {
  return `${banner(v.note)}${renderTour(v)}<div class="xp-grid">${renderBoard(v)}${renderPanel(v)}</div>${renderDrawers(v)}`;
}

// What app.js writes into the page's three slots: the bar's tools, the band's status region, and the explorer.
export function slots(v) {
  return { tools: renderTools(v), band: renderBand(v), app: renderApp(v) };
}
