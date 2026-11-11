// src/static.mjs — the house map as static HTML strings (spec §5.1–5.2, L4 §8, §9.2).
// Pure: no DOM, no clock (callers pass `now`), no network. kms pre-renders it into the vault
// artifact so the map works without JavaScript; the <federation-map> component renders the same
// output into its shadow root and enhances it; knowledge pages use the small map.
//
// Two layouts ship in one output (P-3): the wide one at LAYOUT.wideWidth and the narrow one at
// LAYOUT.narrowWidth; map.css shows one per container width (`@container map`). Positions are
// computed by layout.mjs and written inline as data (left, top, width, min-height); the look is
// map.css. Every string that can come from a remote manifest is escaped once, here, and every
// link goes through safeUrl.
import { layoutMap, LAYOUT } from './layout.mjs';
import { nodeView, statusLine, captionSentence, groupsForList, safeUrl, age, instanceCount } from './view.mjs';

// The glyphs this file references (hosts include them in their sprite: icons.mjs `mapSprite()`).
export const ICONS_USED = Object.freeze(['inst', 'book', 'db', 'seal', 'sprout', 'clock', 'alert']);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

const defaultIconHref = (name) => `#i-${name}`;
const icon = (name, iconHref) => `<svg class="i" aria-hidden="true"><use href="${esc(iconHref(name))}"/></svg>`;
const cls = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const px = (v) => `${v}px`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const selfIdOf = (map) => map.self?.id ?? map.self?.name;
function nodeOf(map, id) {
  if (id === selfIdOf(map)) return map.self;
  return (map.nodes || []).find((n) => n.id === id) ?? null;
}
const nameOf = (map, id) => nodeOf(map, id)?.name ?? id;
const relationOf = (map, id) => (map.edges || []).find((e) => e.from === selfIdOf(map) && e.to === id)?.kind ?? null;
const reportersOf = (map, id) => (map.edges || []).filter((e) => e.kind === 'frontier' && e.to === id)
  .map((e) => String(nameOf(map, e.from))).sort((a, b) => a.localeCompare(b));
const readAtOf = (node) => node?.frontier?.fetched_at ?? node?.last_seen ?? null;
const REL_WORD = { federation: 'peer', upstream: 'upstream', downstream: 'downstream', knowledge: 'knowledge peer' };

// The map's counts in words, for the accessible names of the map and its twin — the same
// instance count as the status line (R-18).
function countsLabel(map) {
  const inst = instanceCount(map);
  const src = (map.nodes || []).filter((n) => n.kind === 'source').length;
  return `${plural(inst, 'instance', 'instances')} and ${plural(src, 'source', 'sources')}`;
}

// One view per node id: nodeView's, or the folded "+N one hop beyond" node the layout makes.
function viewsFor(map, opts) {
  const cache = new Map();
  return (node) => {
    if (cache.has(node.id)) return cache.get(node.id);
    let v;
    if (node.collapsed) {
      const rep = String(nameOf(map, node.collapsed.reporter));
      const count = node.collapsed.count;
      v = { id: node.id, glyph: 'inst', name: `+${count} one hop beyond`, display: false, eyebrow: null,
        facts: `one hop · via ${rep}`, factsShort: 'one hop', factsTone: 'mute', factsGlyph: null,
        states: ['beyond', 'collapsed'], dot: false,
        accessibleName: `${count} more one hop beyond, via ${rep}`, description: `seen one hop beyond from ${rep}`, links: [] };
    } else {
      v = nodeView(node, map, opts);
    }
    cache.set(node.id, v);
    return v;
  };
}

// The web surface links a node only to a public address (never a vault-only link).
function webHref(v) {
  const l = v.links.find((x) => !/^obsidian:/i.test(x.href));
  return l ? l.href : null;
}

// ── one layout ──────────────────────────────────────────────────────────────

function nodeHTML(ln, v, { narrow, surface, iconHref, id, selected, dx = 0, dy = 0 }) {
  const href = surface === 'web' ? webHref(v) : null;
  const isSel = selected != null && ln.id === selected;
  const classes = ['node', ...(ln.big ? ['big'] : []), ...v.states.map(cls), ...(isSel ? ['sel'] : [])].join(' ');
  const style = `inset-inline-start:${px(Math.round((ln.x - dx) * 100) / 100)};top:${px(Math.round((ln.y - dy) * 100) / 100)};width:${px(ln.w)};min-height:${px(ln.h)}`;
  const descId = v.description ? `${id}-d` : null;
  const tag = href ? 'a' : 'button';
  const extra = (ln.collapsed ? ` aria-expanded="false" data-reporter="${esc(ln.collapsed.reporter)}"` : '')
    + (isSel ? ' aria-current="true"' : '');
  const open = `<${tag} class="${classes}" data-id="${esc(ln.id)}" ${href ? `href="${esc(href)}"` : 'type="button"'} style="${style}"`
    + ` aria-label="${esc(v.accessibleName)}"${descId ? ` aria-describedby="${descId}"` : ''}${extra}>`;
  const eyebrow = v.eyebrow ? `<span class="nk">${esc(v.eyebrow)}</span>` : '';
  const glyph = !narrow && !v.display && v.glyph ? icon(v.glyph, iconHref) : '';
  const name = `<span class="nt">${glyph}<span class="nn${v.display ? ' display' : ''}">${esc(v.name)}</span></span>`;
  const factsText = narrow ? v.factsShort : v.facts;
  const tone = v.factsTone && v.factsTone !== 'mute' ? ` ${cls(v.factsTone)}` : '';
  const facts = factsText ? `<span class="nm${tone}">${v.factsGlyph ? icon(v.factsGlyph, iconHref) : ''}${esc(factsText)}</span>` : '';
  const dot = v.dot && surface !== 'web' ? '<span class="dot" aria-hidden="true"></span>' : '';
  const desc = descId ? `<span class="sr-only" id="${descId}">${esc(v.description)}</span>` : '';
  return `${open}${eyebrow}${name}${facts}${dot}${desc}</${tag}>`;
}

function layoutHTML(map, layout, { view, narrow, surface, iconHref, idp, selected }) {
  const B = LAYOUT.border;
  const syntheticOf = (ln) => ({ id: ln.id, kind: 'frontier', name: `+${ln.collapsed.count} one hop beyond`, collapsed: ln.collapsed });
  const nodeFor = (ln) => (ln.collapsed ? syntheticOf(ln) : nodeOf(map, ln.id));
  const parts = [];
  parts.push(`<svg class="fm-edges" aria-hidden="true" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`
    + layout.edges.map((e, i) => `<path class="edge kind-${cls(e.kind)}" d="${esc(e.d)}" data-edge="${i}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"/>`).join('')
    + '</svg>');
  layout.edges.forEach((e, i) => {
    if (e.label && e.labelAt) parts.push(`<span class="elabel" style="inset-inline-start:${px(e.labelAt.x)};top:${px(e.labelAt.y)}" data-edge="${i}">${esc(e.label)}</span>`);
  });
  layout.groups.forEach((g, gi) => {
    const gid = `${idp}-g${gi}`;
    const members = layout.nodes.filter((ln) => ln.grouped === g.id);
    const inner = members.map((ln) => {
      const k = layout.nodes.indexOf(ln);
      return nodeHTML(ln, view(nodeFor(ln)), { narrow, surface, iconHref, selected, id: `${idp}-${k}`, dx: g.x + B, dy: g.y + B });
    }).join('');
    parts.push(`<div class="group" role="group" data-id="${esc(g.id)}" aria-labelledby="${gid}" style="inset-inline-start:${px(g.x)};top:${px(g.y)};width:${px(g.w)};min-height:${px(g.h)}">`
      + `<span class="eyebrow" id="${gid}">${icon('sprout', iconHref)}${esc(g.name)}</span>${inner}</div>`);
  });
  layout.nodes.forEach((ln, k) => {
    if (ln.grouped) return;
    const node = nodeFor(ln);
    if (!node) return;
    parts.push(nodeHTML(ln, view(node), { narrow, surface, iconHref, selected, id: `${idp}-${k}` }));
  });
  return `<div class="fm-canvas" style="width:${px(layout.width)};height:${px(layout.height)}">${parts.join('')}</div>`;
}

// ── status line and caption ─────────────────────────────────────────────────

function statusHTML(map, opts) {
  const { mark, text } = statusLine(map, opts);
  let words = '';
  String(text).split(' · ').filter(Boolean).forEach((p, i) => {
    const sep = i ? ' · ' : '';
    if (/^frontier read/.test(p)) words += `<span class="long">${sep}${esc(p)}</span>`;
    else if (/couldn’t be read/.test(p)) words += `${sep}<span class="ink">${esc(p)}</span>`;
    else words += `${sep}${esc(p)}`;
  });
  return `<p class="fm-status"><span class="sm ${cls(mark)}" aria-hidden="true"><i></i></span><span>${words}</span></p>`;
}

// What a row or the caption says about a node's read: { mark, word (HTML), plain }.
function readState(node, v, { surface, now }) {
  const web = surface === 'web';
  const st = new Set(v.states);
  const at = readAtOf(node);
  const a = at ? age(at, now) : null;
  const when = a ? `<time datetime="${esc(at)}" title="${esc(at)}">${esc(a)}</time>` : '';
  if (st.has('failed')) return { mark: 'failed', word: 'Couldn’t read', plain: `couldn’t read${a ? ` · last ${a} ago` : ''}` };
  if (st.has('never')) return { mark: 'needs', word: 'No frontier yet', plain: 'no frontier yet' };
  if (st.has('noaddr')) return { mark: 'open', word: 'No address to read', plain: 'no address to read' };
  if (st.has('away')) return web ? { mark: 'open', word: 'Not mapped', plain: 'not mapped' } : { mark: 'open', word: 'Not reached', plain: 'not reached' };
  if (a) return { mark: st.has('aged') ? 'aged' : 'ok', word: `Read ${when} ago`, plain: `read ${a} ago` };
  return { mark: 'open', word: 'Not read yet', plain: 'not read yet' };
}

function captionFacts(node, v, opts) {
  const st = new Set(v.states);
  if (st.has('self') || st.has('beyond') || st.has('source')) return v.facts;
  const rel = REL_WORD[relationOf(opts.map, node.id)];
  const head = st.has('peer-knowledge') ? [v.facts] : [node.type, rel];
  return [...head, readState(node, v, opts).plain].filter(Boolean).join(' · ');
}

function captionHTML(map, view, { selected, surface, now, iconHref }) {
  const id = selected != null && nodeOf(map, selected) ? selected : selfIdOf(map);
  const node = nodeOf(map, id);
  if (!node) return '<p class="fm-cap" aria-live="polite"></p>';
  const v = view(node);
  const tile = `<span class="ktile${v.states.includes('beyond') ? ' dashed' : ''}">${icon(v.glyph || 'inst', iconHref)}</span>`;
  const facts = captionFacts(node, v, { map, surface, now });
  const say = captionSentence(node, map, { surface, now });
  const shown = v.links.map((l) => ({ ...l, href: safeUrl(l.href) }))
    .filter((l) => l.href && !(surface === 'web' && /^obsidian:/i.test(l.href)));
  const links = shown.length
    ? ` <span class="fm-cap-links">${shown.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(' ')}</span>`
    : '';
  return `<p class="fm-cap" aria-live="polite">${tile}<span class="fm-cap-body"><b>${esc(v.name)}</b> `
    + `<span class="fm-cap-facts">${esc(facts)}</span> <span class="fm-cap-say">${esc(say)}</span>${links}</span></p>`;
}

// ── the list twin (L4 §9.2 data rows, grouped as groupsForList) ─────────────

function twinRow(node, v, map, opts) {
  const st = new Set(v.states);
  const { iconHref } = opts;
  let second, mark = null;
  if (st.has('beyond')) {
    second = `via ${list(reportersOf(map, node.id)) || 'a peer'}`;
  } else if (st.has('source')) {
    second = node.ecosystem != null && nodeOf(map, node.ecosystem) ? String(nameOf(map, node.ecosystem)) : v.facts;
  } else {
    const m = node.counts?.members;
    second = st.has('peer-knowledge') ? v.facts
      : [node.type, REL_WORD[relationOf(map, node.id)], m != null ? plural(m, 'member', 'members') : null].filter(Boolean).join(' · ');
    mark = readState(node, v, opts);
  }
  const end = mark ? `<span class="sm ${mark.mark}"><i aria-hidden="true"></i><span class="w">${mark.word}</span></span>` : '';
  return `<li><a class="row" href="#node=${esc(encodeURIComponent(node.id))}" data-id="${esc(node.id)}">`
    + `<span class="ktile${st.has('beyond') ? ' dashed' : ''}">${icon(v.glyph || 'inst', iconHref)}</span>`
    + `<span class="main"><span class="t">${esc(v.name)}</span><span class="s">${esc(second)}</span></span>`
    + `<span class="end">${end}</span></a></li>`;
}

function twinHTML(map, view, opts) {
  const rows = groupsForList(map).map(([title, ids]) => `<li class="grp-h"><span>${esc(title)}</span><span class="c">${ids.length}</span></li>`
    + ids.map((id) => twinRow(nodeOf(map, id), view(nodeOf(map, id)), map, opts)).join('')).join('');
  return `<ul class="fm-twin rows" aria-label="${esc(countsLabel(map))}, as a list">${rows}</ul>`;
}

export function renderListTwin(map, { surface = 'vault', now, iconHref = defaultIconHref } = {}) {
  if (!map?.self) return '<ul class="fm-twin rows" aria-label="0 instances and 0 sources, as a list"></ul>';
  return twinHTML(map, viewsFor(map, { surface, now }), { surface, now, iconHref });
}

// ── the map ─────────────────────────────────────────────────────────────────

// The words layoutMap sizes nodes by: the same view model the nodes are drawn from.
const wordsOf = (view) => (n, { narrow }) => {
  const v = view(n);
  return { name: v.name, facts: narrow ? v.factsShort : v.facts, eyebrow: v.eyebrow, factsGlyph: v.factsGlyph };
};
export function layoutText(map, { surface = 'vault', now } = {}) {
  return wordsOf(viewsFor(map, { surface, now }));
}

// `width` (the <federation-map> component): one layout at that width instead of the two, with the
// component's `measure` (real fonts) and `expanded` reporters (K-9). Without it, both layouts ship.
export function renderStaticMap(map, { surface = 'vault', now, iconHref = defaultIconHref, selected = null, idPrefix = 'fm',
  width = null, measure, expanded = [] } = {}) {
  if (!map?.self) return '<div class="fm" data-fm></div>';
  const view = viewsFor(map, { surface, now });
  const text = wordsOf(view);
  const label = esc(countsLabel(map));
  const idp = esc(idPrefix); // host-supplied: escaped once here, used in every id and idref (R-20)
  const sel = selected != null && nodeOf(map, selected) ? selected : null;
  const wanted = width == null ? [['wide', LAYOUT.wideWidth], ['narrow', LAYOUT.narrowWidth]]
    : [[width < LAYOUT.narrowAt ? 'narrow' : 'wide', width]];
  const boxes = wanted.map(([which, width]) => {
    const layout = layoutMap(map, { width, text, expanded, ...(measure ? { measure } : {}) });
    const inner = layoutHTML(map, layout, { view, narrow: which === 'narrow', surface, iconHref, idp: `${idp}-${which[0]}`, selected: sel });
    return `<div class="fm-box fm-${which}" role="group" aria-label="${label}, as a map">${inner}</div>`;
  }).join('');
  return `<div class="fm" data-fm>${statusHTML(map, { surface, now })}${boxes}`
    + `${captionHTML(map, view, { selected, surface, now, iconHref })}`
    + `${twinHTML(map, view, { surface, now, iconHref })}</div>`;
}

// The caption alone, as renderStaticMap draws it (the component swaps it in when the selection moves).
export function renderCaption(map, { surface = 'vault', now, iconHref = defaultIconHref, selected = null } = {}) {
  if (!map?.self) return '<p class="fm-cap" aria-live="polite"></p>';
  return captionHTML(map, viewsFor(map, { surface, now }), { selected, surface, now, iconHref });
}

// ── the small map (L4 §8.6) ─────────────────────────────────────────────────

// The fixed radial template: [slot, x %, y %] around the centre at (50 %, 50 %).
const SLOTS = [['above-start', 27, 17], ['above-end', 73, 17], ['below-start', 27, 83], ['below-end', 73, 83], ['start', 13, 50], ['end', 87, 50]];

export function renderSmallMap(centre, neighbours = [], { more = 0, size = 'page', moreHref, iconHref = defaultIconHref } = {}) {
  const c = centre || {};
  const placed = (neighbours || []).slice(0, SLOTS.length);
  const extra = Math.max(0, Number(more) || 0) + Math.max(0, (neighbours || []).length - SLOTS.length);
  // start and end hold to the box's edges (map.css: no centring translate), so a long name stays inside
  const pos = (x, y, slot) => (slot === 'start' ? `inset-inline-start:2%;top:${y}%`
    : slot === 'end' ? `inset-inline-end:2%;top:${y}%` : `inset-inline-start:${x}%;top:${y}%`);
  const lines = placed.map((_, i) => `<line class="edge" x1="50" y1="50" x2="${SLOTS[i][1]}" y2="${SLOTS[i][2]}"/>`).join('');
  const me = `<span class="mnode me" style="${pos(50, 50)}">${c.glyph ? icon(c.glyph, iconHref) : ''}${esc(c.name ?? c.id)}</span>`;
  const nodes = placed.map((n, i) => {
    const href = safeUrl(n.href);
    const k = `mnode${n.away ? ' away' : ''}`;
    const inner = `${n.glyph ? icon(n.glyph, iconHref) : ''}${esc(n.name ?? n.id)}`;
    const at = ` data-slot="${SLOTS[i][0]}" data-id="${esc(n.id)}" style="${pos(SLOTS[i][1], SLOTS[i][2], SLOTS[i][0])}"`;
    return href ? `<a class="${k}" href="${esc(href)}"${at}>${inner}</a>` : `<span class="${k}"${at}>${inner}</span>`;
  }).join('');
  const moreHrefSafe = safeUrl(moreHref);
  const moreEl = extra ? (moreHrefSafe ? `<a class="fm-mini-more" href="${esc(moreHrefSafe)}">+${extra} on the map</a>` : `<span class="fm-mini-more">+${extra} on the map</span>`) : '';
  return `<div class="fm-mini" data-size="${size === 'inspector' ? 'inspector' : 'page'}" role="group" aria-label="${esc(c.name ?? c.id)} and its neighbours">`
    + `<svg class="fm-mini-edges" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>${me}${nodes}${moreEl}</div>`;
}
