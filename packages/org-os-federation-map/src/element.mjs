// src/element.mjs — <federation-map>: the house map (spec §5.1–5.2, §8; L4 §8.5–8.6).
//
// It renders the static map (static.mjs — the same HTML kms pre-draws for pages without JavaScript)
// into its shadow root and enhances it: selection, keys, List · Map, Fit, zoom, the #node= deep link.
// Nothing moves on its own except the steward's attention ring, which map.css runs twice.
//
// Attributes: src="<map.json url>" | an inline <script type="application/json"> child;
//             mode="full" (default) | "mini" (the small map, the whole element one link: href, default #);
//             data-surface="vault" (the steward's copy: attention, vault links) — else the public copy.
// Controls outside the element: any button with data-fm-view="list|map" or data-fm-fit, whose
// aria-controls names this element's id (or carries no aria-controls, for the page's first map).
//
// The module imports cleanly in node: no DOM at top level. MapController holds the state every key,
// click and hash goes through, so it is tested without a DOM.
import { normalizeMap } from './parse.mjs';
import { layoutMap, nearestInDirection, LAYOUT } from './layout.mjs';
import { nodeView, safeUrl } from './view.mjs';
import { renderStaticMap, renderCaption, renderSmallMap, layoutText, esc } from './static.mjs';
import { mapSprite } from './icons.mjs';
import { HOUSE_TOKENS_CSS } from './house-tokens.mjs';

// Node fields (name/url/repo/portal/type) can originate from REMOTE peer manifests
// (fetchFrontier → buildMap → map.json), so everything shown is untrusted. safeUrl
// allow-lists link schemes (blocks javascript:/data:) and nodePanelHTML escapes every
// interpolation — both pure and exported so they are unit-tested without a DOM.
export { safeUrl };

export function nodePanelHTML(n) {
  const link = (href, label) => {
    const s = safeUrl(href);
    return s ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
  };
  const links = [
    link(n.url, 'visit ↗'),
    link(n.repo, 'repository ↗'),
    n.url && n.kind === 'instance' ? link(`${String(n.url).replace(/\/$/, '')}/federation.json`, 'federation.json ↗') : '',
    link(n.portal, '→ view inside'), // map.json v1 keeps the key `portal` for a node's link (PF-R120)
  ].filter(Boolean).join('');
  const dl = [['kind', n.kind], ['type', n.type], ['ring', n.ring], ['trust', n.trust],
    ['ecosystem', n.ecosystem], ['last seen', n.last_seen]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return `<h3>${esc(n.name || n.id)}</h3><dl>${dl}</dl>${links}`;
}

// What the component adds to map.css inside its shadow root (house tokens only, every one of them
// read by map.css too, so HOUSE_TOKENS_CSS covers them).
export const COMPONENT_CSS = `
:host { display: block; min-width: 0; }
:host([hidden]) { display: none; }
/* the glyph sprite takes no room (an inline <svg> of zero size still opens a line box above the map) */
svg[width="0"][height="0"] { position: absolute; overflow: hidden; }
.fm > .fm-box { display: block; }
.fm-zoom { position: relative; margin-inline: auto; }
.fm-zoom > .fm-canvas { position: absolute; inset-block-start: 0; inset-inline-start: 0; margin: 0; transform-origin: 0 0; }
.fm-zoom:dir(rtl) > .fm-canvas { transform-origin: 100% 0; }
.fm-live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.fm-cap:focus { outline: none; }
.fm-cap:focus-visible { outline: var(--focus-w) solid var(--focus); outline-offset: 2px; }
.fm-empty { margin: 0; padding: var(--sp-10); color: var(--mute); font: var(--fw-regular) var(--fs-meta)/var(--lh-row) var(--sans); }
.fm-mini-link { display: block; color: inherit; text-decoration: none; border-radius: var(--radius); }
.fm-mini-link:focus-visible { outline: var(--focus-w) solid var(--focus); outline-offset: 2px; }
@media (hover: hover) { .fm-mini-link:hover .fm-mini { border-color: var(--edge); } }
/* K-26: under 300px of map width the centre node is the layout's "small" box (only the component lays
   out that narrow; the static map's narrow layout is 358 wide) */
@container map (max-width: 300px) {
  .fm-narrow .node.big { padding: var(--sp-6) var(--sp-5); }
  .fm-narrow .node .display { font-size: .75rem; }
}
`;

const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 1.25;
const clampZoom = (k) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(k * 1000) / 1000));
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const NODE_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc', ...Object.keys(ARROWS)]);
const hashId = (hash) => {
  const m = String(hash ?? '').match(/(?:^#|&)node=([^&]*)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};

// ── the state ───────────────────────────────────────────────────────────────

export class MapController {
  constructor(map, { surface = 'web', now, width = LAYOUT.wideWidth, measure, rtl = false } = {}) {
    this.map = map;
    this.surface = surface === 'vault' ? 'vault' : 'web';
    this.now = now;
    this.rtl = rtl;
    this.selfId = map.self?.id ?? map.self?.name;
    this.selected = null;
    this.active = this.selfId;   // where Tab enters (roving tabindex)
    this.view = 'map';
    this.zoom = 1;
    this.zoomed = false;         // the reader zoomed: a re-layout keeps their zoom instead of fitting
    this.expanded = [];          // reporters whose "+N one hop beyond" opened (K-9)
    this.text = layoutText(map, { surface: this.surface, now });
    this.relayout({ width, measure });
  }

  relayout({ width = this.width, measure = this.measure } = {}) {
    this.width = width;
    this.measure = measure;
    this.layout = layoutMap(this.map, { width, text: this.text, expanded: this.expanded, ...(measure ? { measure } : {}) });
    this.byId = new Map(this.layout.nodes.map((n) => [n.id, n]));
    if (!this.byId.has(this.active)) this.active = this.selfId;
    return this.layout;
  }

  node(id) {
    if (id === this.selfId) return this.map.self;
    return (this.map.nodes || []).find((n) => n.id === id) ?? null;
  }

  // An id the map draws, opening the fold that hides it if it must.
  reveal(id) {
    if (this.byId.has(id)) return id;
    if (!this.node(id)) return null;
    const fold = this.layout.nodes.find((n) => n.collapsed?.members.includes(id));
    if (!fold) return null;
    this.expand(fold.collapsed.reporter);
    return this.byId.has(id) ? id : null;
  }

  expand(reporter) {
    if (!this.expanded.includes(reporter)) this.expanded = [...this.expanded, reporter];
    this.relayout();
  }

  select(id) {
    const at = id == null ? null : this.reveal(id);
    if (id != null && !at) return null;
    this.selected = at;
    if (at) this.active = at;
    return at;
  }

  // `#node=<id>` → the id selected, or null (unknown ids leave the selection alone).
  fromHash(hash) {
    const id = hashId(hash);
    return id == null ? null : this.select(id);
  }

  setView(v) { this.view = v === 'list' ? 'list' : 'map'; return this.view; }
  toggleView() { return this.setView(this.view === 'map' ? 'list' : 'map'); }

  move(dir) {
    const d = this.rtl && (dir === 'left' || dir === 'right') ? (dir === 'left' ? 'right' : 'left') : dir;
    const next = nearestInDirection(this.active, d, this.layout);
    if (next) this.active = next;
    return next;
  }

  // The first link a node offers that this surface may open (the public copy: never a vault link).
  firstLink(id) {
    const node = this.node(id);
    if (!node) return null;
    const v = nodeView(node, this.map, { surface: this.surface, now: this.now });
    const l = v.links.find((x) => safeUrl(x.href) && !(this.surface === 'web' && /^obsidian:/i.test(x.href)));
    return l ? safeUrl(l.href) : null;
  }

  // The selection's path: its own edges, and the shortest way from it to this instance.
  path(id) {
    const L = this.layout;
    const groups = new Map((L.groups || []).map((g) => [g.id, g.members]));
    const ends = (x) => groups.get(x) ?? [x];
    const adj = new Map();
    const link = (a, b, i) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, i]); };
    L.edges.forEach((e, i) => { for (const a of ends(e.from)) for (const b of ends(e.to)) { link(a, b, i); link(b, a, i); } });
    const nodes = new Set([id]), edges = new Set();
    for (const [b, i] of adj.get(id) || []) { nodes.add(b); edges.add(i); }
    const prev = new Map([[id, null]]);
    const queue = [id];
    while (queue.length && !prev.has(this.selfId)) {
      const a = queue.shift();
      for (const [b, i] of adj.get(a) || []) if (!prev.has(b)) { prev.set(b, [a, i]); queue.push(b); }
    }
    for (let at = this.selfId; prev.get(at); at = prev.get(at)[0]) {
      nodes.add(at); nodes.add(prev.get(at)[0]); edges.add(prev.get(at)[1]);
    }
    return { nodes, edges };
  }

  fitZoom(boxWidth) { return clampZoom(Math.min(1, boxWidth / this.layout.width)); }

  zoomBy(f) { this.zoom = clampZoom(this.zoom * f); this.zoomed = true; return this.zoom; }

  // A key → { action, id?, href?, reporter? } for the element to carry out, or null when the key is
  // not the map's. action: move | none | select | open | expand | leave | view | fit | zoom
  key(key, { meta = false, ctrl = false, alt = false, shift = false } = {}) {
    if ((meta || ctrl) && !alt) {
      if (key === '0') return { action: 'fit' };
      if (key === '+' || key === '=') { this.zoomBy(ZOOM_STEP); return { action: 'zoom' }; }
      if (key === '-' || key === '_') { this.zoomBy(1 / ZOOM_STEP); return { action: 'zoom' }; }
      return null;
    }
    if (meta || ctrl || alt) return null;
    if (key === 'v' || key === 'V') { this.toggleView(); return { action: 'view' }; }
    if (shift) return null;
    if (ARROWS[key]) { const id = this.move(ARROWS[key]); return id ? { action: 'move', id } : { action: 'none' }; }
    const id = this.active;
    const fold = this.byId.get(id)?.collapsed;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      if (fold) return { action: 'expand', id, reporter: fold.reporter };
      const href = key === 'Enter' ? this.firstLink(id) : null;
      if (href) return { action: 'open', id, href };
      this.select(id);
      return { action: 'select', id };
    }
    if (key === 'Escape' || key === 'Esc') return { action: 'leave' };
    return null;
  }
}

// ── measuring with the real fonts ───────────────────────────────────────────

// layoutMap's `measure` over a raw one. Names and facts in Sans and Fraunces are measured a hair
// generous: an extra line costs a little air, a missing one would let a node outgrow its box. Mono
// advances one fixed width per glyph, so it is measured exactly — edge labels are Mono, and K-26 keeps
// a label only when its measured width fits — rounded to 0.01px, so a gap sized to a label never
// loses it to float noise.
export function slackMeasure(raw, slack) {
  return (str, opts = {}) => {
    const w = raw(str, opts);
    return opts.font === 'mono' ? Math.round(w * 100) / 100 : Math.ceil((w * slack + 0.5) * 100) / 100;
  };
}

// What a ResizeObserver tick does at width `w`: 'skip' (the layout is for this width), 'paint', or
// 'fit' — back to the width two layouts ago, within `quick` ms of the last: a page scrollbar our own
// re-layout toggled, so fit instead of looping. A reader's A→B→A→B (a sidebar, a phone turning) is
// slower than that and re-lays out every time.
export function resizeAction({ w, painted, history = [], now, lastPaint = -Infinity, quick = 250 }) {
  if (!w || w === painted) return 'skip';
  if (history.length >= 2 && history.at(-2) === w && now - lastPaint < quick) return 'fit';
  return 'paint';
}

// Raw text widths from canvas metrics, in the fonts the shadow root resolved.
const WEIGHT = { sans: 500, display: 400, mono: 500 };
function canvasMeasure(families) {
  let ctx = null;
  try { ctx = document.createElement('canvas').getContext('2d'); } catch { /* no canvas */ }
  if (!ctx || typeof ctx.measureText !== 'function') return null;
  const ok = {};
  for (const f of Object.keys(WEIGHT)) {
    ctx.font = '10px serif';
    const before = ctx.font;
    if (families[f]) ctx.font = `${WEIGHT[f]} 20px ${families[f]}`;
    ok[f] = Boolean(families[f]) && ctx.font !== before;
  }
  if (!ok.sans || !ok.mono) return null;
  const cache = new Map();
  return (str, { font = 'sans', size = 13 } = {}) => {
    const f = ok[font] ? font : 'sans';
    const k = `${f}|${size}|${str}`;
    let w = cache.get(k);
    if (w == null) {
      ctx.font = `${WEIGHT[f]} ${size}px ${families[f]}`;
      w = ctx.measureText(String(str ?? '')).width;
      cache.set(k, w);
    }
    return w;
  };
}

// ── the element ─────────────────────────────────────────────────────────────

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;
let instances = 0;
let mapCss = null;
async function loadMapCss() {
  // map.css is bundled as text (esbuild --loader:.css=text); node has no loader for it.
  if (mapCss == null) {
    try { mapCss = (await import('./map.css')).default; } catch { mapCss = ''; }
  }
  return mapCss;
}

export class FederationMap extends Base {
  static get observedAttributes() { return ['src', 'mode']; }

  #ctl = null;
  #raw = null;
  #idp = `fm${++instances}`;
  #slack = 1.01;
  #w = 0;
  #widths = [];
  #lastPaint = -Infinity;
  #frame = 0;
  #ro = null;
  #els = null;
  #live = null;
  #pendingScroll = false;
  #wired = false;
  #rootWired = false;
  #onDocKey = (e) => this.#docKey(e);
  #onDocClick = (e) => this.#docClick(e);
  #onHash = () => this.#hashChanged();
  #onFonts = () => this.#schedule(true);

  get view() { return this.#ctl?.view ?? 'map'; }
  set view(v) { this.#setView(v); }
  get zoom() { return this.#ctl?.zoom ?? 1; }
  fit() { this.#fit(true); }

  async connectedCallback() {
    this.#raw = await this.#loadData();
    if (!this.isConnected) return;
    await this.#start();
  }

  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#ro = null;
    this.#wired = false;
    document.removeEventListener('keydown', this.#onDocKey);
    document.removeEventListener('click', this.#onDocClick);
    window.removeEventListener('hashchange', this.#onHash);
    document.fonts?.removeEventListener?.('loadingdone', this.#onFonts);
  }

  attributeChangedCallback(name, was, now) {
    if (was === now || !this.shadowRoot || !this.isConnected) return;
    this.disconnectedCallback();
    this.connectedCallback();
  }

  async #loadData() {
    const inline = this.querySelector(':scope > script[type="application/json"]');
    if (inline) { try { return JSON.parse(inline.textContent); } catch { return null; } }
    const src = this.getAttribute('src');
    if (!src) return null;
    try { const res = await fetch(src); return res.ok ? await res.json() : null; } catch { return null; }
  }

  get #surface() { return this.getAttribute('data-surface') === 'vault' ? 'vault' : 'web'; }
  get #mini() { return this.getAttribute('mode') === 'mini'; }

  async #start() {
    const norm = normalizeMap(this.#raw);
    // A page that pre-drew the map (kms) keeps its drawing when the data cannot be read.
    const predrawn = [...this.children].some((c) => !(c.tagName === 'SCRIPT' && c.type === 'application/json'));
    if (!norm.ok && predrawn) return;
    const css = await loadMapCss();
    if (!this.isConnected) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const root = this.shadowRoot;
    // the house tokens come from the page; without them, the house values (with the --fedmap-* aliases)
    const pageTokens = getComputedStyle(this).getPropertyValue('--paper').trim() !== '';
    if (!root.querySelector('[part="map"]')) {
      // built once: one polite live region for the caption and the view switch, outside the drawing
      root.innerHTML = `<style></style>${mapSprite()}<p class="fm-live" aria-live="polite"></p><div part="map"></div>`;
    }
    root.querySelector('style').textContent = `${pageTokens ? '' : HOUSE_TOKENS_CSS}${css}${COMPONENT_CSS}`;
    this.#live = root.querySelector('.fm-live');
    this.#live.textContent = '';
    this.#els = { mount: root.querySelector('[part="map"]') };
    this.#els.mount.replaceChildren();
    this.#wireRoot();
    if (!norm.ok) {
      this.#ctl = null;
      this.#els.mount.innerHTML = '<div class="fm"><p class="fm-empty">No federation data yet. Run <code>org-os-kms render map</code>.</p></div>';
      return;
    }
    const map = { ...this.#raw, self: norm.self, nodes: norm.nodes, edges: norm.edges };
    const now = new Date().toISOString();
    if (this.#mini) { this.#renderMini(map, now); return; }

    const rtl = getComputedStyle(this).direction === 'rtl';
    this.#ctl = new MapController(map, { surface: this.#surface, now, width: this.#boxWidth() || LAYOUT.wideWidth, rtl });
    this.#w = 0;
    this.#widths = [];
    this.#pendingScroll = Boolean(this.#ctl.fromHash(location.hash));
    this.#wire();
    this.#paint(); // hidden (zero width): the first ResizeObserver tick paints, and scrolls to a deep link
  }

  // ── the small map (L4 §8.6): this instance and up to six neighbours, one link ──
  #renderMini(map, now) {
    const surface = this.#surface;
    const selfId = map.self.id;
    const order = { upstream: 0, federation: 1, knowledge: 2, downstream: 3, provenance: 4, frontier: 5 };
    const seen = new Set();
    const near = [];
    for (const e of [...map.edges].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))) {
      const other = e.from === selfId ? e.to : e.to === selfId ? e.from : null;
      const n = other != null && map.nodes.find((x) => x.id === other);
      if (!n || n.kind === 'ecosystem' || seen.has(other)) continue;
      seen.add(other);
      const v = nodeView(n, map, { surface, now });
      near.push({ id: n.id, name: v.name, glyph: v.glyph, away: v.states.includes('away') || v.states.includes('beyond') });
    }
    const sv = nodeView(map.self, map, { surface, now });
    const href = safeUrl(this.getAttribute('href') ?? '#') ?? '#';
    this.#els.mount.innerHTML = `<a class="fm-mini-link" href="${esc(href)}" aria-label="${esc(`${sv.name} on the federation map`)}">`
      + `${renderSmallMap({ id: selfId, name: sv.name, glyph: 'seal' }, near.slice(0, 6), { more: Math.max(0, near.length - 6), size: 'inspector' })}</a>`;
  }

  // ── painting ──
  #boxWidth() { return Math.max(0, Math.floor(this.getBoundingClientRect().width) - 2 * LAYOUT.border); }

  #families() {
    const fm = this.shadowRoot.querySelector('.fm');
    const cs = getComputedStyle(fm || this);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { sans: v('--sans') || cs.fontFamily, mono: v('--mono') || 'monospace', display: v('--display') || v('--sans') };
  }

  #paint() {
    const ctl = this.#ctl;
    const root = this.shadowRoot;
    const width = this.#boxWidth();
    if (!width) return;
    const had = root.activeElement;
    const focusId = had?.closest?.('.node, .row')?.dataset.id ?? null;
    const focusRow = Boolean(had?.closest?.('.row'));
    const capFocused = Boolean(had?.closest?.('.fm-cap'));
    const box0 = root.querySelector('.fm-box');
    const scroll = box0 ? box0.scrollLeft : 0;

    // the first draw resolves the fonts in the shadow root; then measure in them
    // (a fresh canvas measure each paint: fonts that loaded since change the widths)
    if (!root.querySelector('.fm')) this.#draw(width, undefined);
    const raw = canvasMeasure(this.#families());
    let measure = raw ? slackMeasure(raw, this.#slack) : undefined;
    this.#draw(width, measure);
    // a node whose real text outgrew its computed box: measure names and facts more generously
    for (let tries = 0; tries < 2 && measure && this.#overgrown(); tries++) {
      this.#slack += 0.04;
      measure = slackMeasure(raw, this.#slack);
      this.#draw(width, measure);
    }
    this.#w = width;
    this.#lastPaint = performance.now();
    this.#widths = [...this.#widths.slice(-2), width];
    if (!ctl.zoomed) ctl.zoom = ctl.fitZoom(width);
    this.#applyZoom();
    if (this.#els.box) this.#els.box.scrollLeft = scroll;
    if (focusId) this.#focus(focusRow ? 'row' : 'node', focusId);
    else if (capFocused) this.#els.cap?.focus({ preventScroll: true });
    if (this.#pendingScroll && ctl.selected) {
      this.#pendingScroll = false;
      this.#els.nodes.get(ctl.selected)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  #draw(width, measure) {
    const ctl = this.#ctl;
    ctl.relayout({ width, measure });
    const html = renderStaticMap(ctl.map, { surface: ctl.surface, now: ctl.now, selected: ctl.selected, idPrefix: this.#idp,
      width, measure, expanded: ctl.expanded });
    const mount = this.#els.mount;
    mount.innerHTML = html;
    const fm = mount.querySelector('.fm');
    fm.dataset.view = ctl.view;
    const canvas = fm.querySelector('.fm-canvas');
    const zoom = document.createElement('div');
    zoom.className = 'fm-zoom';
    canvas.replaceWith(zoom);
    zoom.appendChild(canvas);
    this.#els = { mount, fm, zoom, canvas, box: fm.querySelector('.fm-box'), nodes: new Map() };
    for (const el of fm.querySelectorAll('.fm-box .node')) this.#els.nodes.set(el.dataset.id, el);
    this.#prepCaption();
    this.#roving();
    this.#applySelection();
  }

  #overgrown() {
    for (const n of this.#ctl.layout.nodes) {
      const el = this.#els.nodes.get(n.id);
      if (el && el.offsetHeight > n.h + 1) return true;
    }
    return false;
  }

  #prepCaption() {
    const cap = this.#els.fm.querySelector('.fm-cap');
    this.#els.cap = cap;
    if (!cap) return;
    cap.removeAttribute('aria-live'); // one live region: ours
    cap.tabIndex = -1;
  }

  #roving() {
    if (!this.#els?.nodes) return; // not drawn yet (hidden): the first paint applies it
    for (const [id, el] of this.#els.nodes) el.tabIndex = id === this.#ctl.active ? 0 : -1;
  }

  #applySelection() {
    if (!this.#els?.nodes) return;
    const ctl = this.#ctl;
    const sel = ctl.selected;
    const p = sel ? ctl.path(sel) : null;
    for (const [id, el] of this.#els.nodes) {
      el.classList.toggle('sel', id === sel);
      if (id === sel) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
      el.classList.toggle('dim', Boolean(p) && !p.nodes.has(id));
    }
    for (const el of this.#els.fm.querySelectorAll('.fm-box [data-edge]')) {
      const on = Boolean(p) && p.edges.has(Number(el.dataset.edge));
      el.classList.toggle('on', on);
      el.classList.toggle('dim', Boolean(p) && !on);
    }
    for (const el of this.#els.fm.querySelectorAll('.fm-twin .row')) el.classList.toggle('sel', el.dataset.id === sel);
  }

  #applyZoom() {
    const { zoom, canvas } = this.#els;
    const L = this.#ctl.layout, k = this.#ctl.zoom;
    zoom.style.width = `${Math.round(L.width * k * 100) / 100}px`;
    zoom.style.height = `${Math.round(L.height * k * 100) / 100}px`;
    canvas.style.transform = k === 1 ? '' : `scale(${k})`;
  }

  #fit(announce) {
    const ctl = this.#ctl;
    if (!ctl || !this.#els?.zoom) return;
    ctl.zoomed = false;
    ctl.zoom = ctl.fitZoom(this.#boxWidth());
    this.#applyZoom();
    if (announce) this.#say(`Fitted to view, ${Math.round(ctl.zoom * 100)} %`);
  }

  #zoomTo(apply, clientX, before = this.#ctl.zoom) {
    const { box } = this.#els;
    apply();
    const r = box.getBoundingClientRect();
    const x = clientX == null ? r.width / 2 : clientX - r.left;
    const at = (box.scrollLeft + x) / before;
    this.#applyZoom();
    box.scrollLeft = at * this.#ctl.zoom - x;
    this.#say(`Zoom ${Math.round(this.#ctl.zoom * 100)} %`);
  }

  #say(text) {
    if (this.#live) this.#live.textContent = text;
  }

  #focus(kind, id) {
    const fm = this.#els?.fm;
    if (!fm) return false;
    const el = kind === 'row' ? [...fm.querySelectorAll('.fm-twin .row')].find((r) => r.dataset.id === id) : this.#els.nodes.get(id);
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  // ── what the reader does ──
  #select(id, { focus = false, say = true } = {}) {
    const ctl = this.#ctl;
    const before = ctl.layout;
    if (!ctl.select(id)) return false;
    if (!this.#els?.nodes) { this.#pendingScroll = true; return true; } // hidden: the first paint draws it
    if (ctl.layout !== before) this.#paint(); // a fold opened
    const tpl = document.createElement('template');
    tpl.innerHTML = renderCaption(ctl.map, { surface: ctl.surface, now: ctl.now, selected: ctl.selected });
    this.#els.cap?.replaceWith(tpl.content.firstElementChild);
    this.#prepCaption();
    this.#roving();
    this.#applySelection();
    if (focus) this.#focus('node', ctl.selected);
    if (say && this.#els.cap) this.#say(this.#els.cap.textContent.replace(/\s+/g, ' ').trim());
    return true;
  }

  #expand(reporter, id) {
    const ctl = this.#ctl;
    const count = ctl.byId.get(id)?.collapsed?.count;
    ctl.expand(reporter);
    const first = ctl.layout.nodes.find((n) => ctl.layout.edges.some((e) => e.from === reporter && e.to === n.id && e.kind === 'frontier'));
    if (first) ctl.active = first.id;
    this.#paint();
    if (first) this.#focus('node', first.id);
    const who = ctl.node(reporter)?.name ?? reporter;
    this.#say(`Showing ${count ?? 'every'} one hop beyond, via ${who}`);
  }

  #setView(v, { say = true } = {}) {
    const ctl = this.#ctl;
    if (!ctl) return;
    if (!this.#els?.fm) { ctl.setView(v); this.#syncControls(); return; } // not drawn yet
    const inside = this.shadowRoot.activeElement != null;
    ctl.setView(v);
    this.#els.fm.dataset.view = ctl.view;
    this.#syncControls();
    if (ctl.view === 'map' && this.#boxWidth() !== this.#w) this.#paint();
    if (inside) {
      if (ctl.view === 'list') {
        if (!this.#focus('row', ctl.selected ?? ctl.active)) this.#els.fm.querySelector('.fm-twin .row')?.focus();
      } else this.#focus('node', ctl.active);
    }
    if (say) this.#say(ctl.view === 'list' ? 'Showing the list' : 'Showing the map');
    this.dispatchEvent(new CustomEvent('fedmap-view', { detail: { view: ctl.view }, bubbles: true }));
  }

  #open(href) {
    const a = document.createElement('a');
    a.href = href;
    if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    a.click();
  }

  // The shadow root outlives a disconnect, so its listeners are added once (a reconnect must not
  // double them); the document's are added on connect and removed on disconnect.
  #wireRoot() {
    if (this.#rootWired) return;
    this.#rootWired = true;
    const root = this.shadowRoot;
    const ctl = () => this.#ctl;
    root.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || !ctl()) return;
      const onNode = e.target.closest?.('.fm-box .node');
      if (NODE_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !onNode) return; // links and rows keep their keys
      if (onNode) ctl().active = onNode.dataset.id;
      const z0 = ctl().zoom;
      const r = ctl().key(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
      if (!r) return;
      e.preventDefault();
      if (r.action === 'move') { this.#roving(); this.#focus('node', r.id); }
      else if (r.action === 'select') this.#select(r.id);
      else if (r.action === 'open') this.#open(r.href);
      else if (r.action === 'expand') this.#expand(r.reporter, r.id);
      else if (r.action === 'leave') this.#els.cap?.focus();
      else if (r.action === 'view') this.#setView(ctl().view);
      else if (r.action === 'fit') this.#fit(true);
      else if (r.action === 'zoom') this.#zoomTo(() => {}, null, z0);
    });
    root.addEventListener('focusin', (e) => {
      const n = e.target.closest?.('.fm-box .node');
      if (n && ctl() && n.dataset.id !== ctl().active) { ctl().active = n.dataset.id; this.#roving(); }
    });
    root.addEventListener('click', (e) => {
      if (!ctl() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const n = e.target.closest?.('.fm-box .node');
      if (n) {
        e.preventDefault(); // a click selects; the node's links are in the caption (Enter opens the first)
        const fold = ctl().byId.get(n.dataset.id)?.collapsed;
        if (fold) this.#expand(fold.reporter, n.dataset.id);
        else this.#select(n.dataset.id);
        return;
      }
      const row = e.target.closest?.('.fm-twin .row');
      if (row) { // the row's #node= link (kept for the address bar): show the node on the map
        this.#setView('map', { say: false });
        this.#select(row.dataset.id, { focus: true });
      }
    });
    root.addEventListener('wheel', (e) => {
      if (!ctl() || !(e.ctrlKey || e.metaKey) || !e.target.closest?.('.fm-box')) return;
      e.preventDefault();
      this.#zoomTo(() => ctl().zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX);
    }, { passive: false });
  }

  #wire() {
    if (this.#wired) return;
    this.#wired = true;
    document.addEventListener('keydown', this.#onDocKey);
    document.addEventListener('click', this.#onDocClick);
    window.addEventListener('hashchange', this.#onHash);
    document.fonts?.addEventListener?.('loadingdone', this.#onFonts);
    document.fonts?.ready?.then(() => this.#schedule(true));
    if (typeof ResizeObserver !== 'undefined') {
      this.#ro = new ResizeObserver(() => this.#schedule(false));
      this.#ro.observe(this);
    }
    this.#syncControls();
  }

  #schedule(force) {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (!this.#ctl || !this.isConnected) return;
      const w = this.#boxWidth();
      const now = performance.now();
      const act = force ? (w ? 'paint' : 'skip')
        : resizeAction({ w, painted: this.#w, history: this.#widths, now, lastPaint: this.#lastPaint });
      if (act === 'skip') return;
      if (act === 'fit') { // the scrollbar loop: keep this layout, fit it, and remember the width
        this.#fit(false);
        this.#widths = [...this.#widths.slice(-2), w];
        this.#lastPaint = now;
        return;
      }
      if (this.#ctl.view === 'list' && this.#els?.nodes) { this.#w = -1; return; } // re-laid out when the map shows
      this.#paint();
    });
  }

  #hashChanged() {
    const ctl = this.#ctl;
    const id = hashId(location.hash);
    if (!ctl || id == null || id === ctl.selected) return;
    const inside = this.shadowRoot.activeElement != null;
    if (ctl.view === 'list') this.#setView('map', { say: false });
    if (this.#select(id, { focus: inside })) this.#els?.nodes?.get(ctl.selected)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  // Controls that name no map drive the page's first full map.
  #isDefault() {
    return document.querySelector('federation-map:not([mode="mini"])') === this;
  }

  #controls(el) {
    const target = el.getAttribute('aria-controls');
    return target ? Boolean(this.id) && target.split(/\s+/).includes(this.id) : this.#isDefault();
  }

  #syncControls() {
    if (!this.#ctl) return;
    for (const b of document.querySelectorAll('[data-fm-view]')) {
      if (this.#controls(b)) b.setAttribute('aria-pressed', String(b.getAttribute('data-fm-view') === this.#ctl.view));
    }
  }

  #docClick(e) {
    const b = e.target.closest?.('[data-fm-view], [data-fm-fit]');
    if (!b || !this.#controls(b)) return;
    if (b.hasAttribute('data-fm-fit')) this.#fit(true);
    else this.#setView(b.getAttribute('data-fm-view'));
  }

  // R-28 (WCAG 2.1.4): `v` toggles only with focus in the map (the shadow root's keydown) or on one of
  // its own controls — never from elsewhere on the page.
  #docKey(e) {
    if (!this.#ctl || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'v' && e.key !== 'V')) return;
    const t = e.composedPath?.()[0] ?? e.target;
    const control = t?.closest?.('[data-fm-view], [data-fm-fit]');
    if (!control || !this.#controls(control)) return;
    e.preventDefault();
    this.#setView(this.#ctl.view === 'map' ? 'list' : 'map');
  }
}

export function define() {
  if (typeof customElements !== 'undefined' && !customElements.get('federation-map')) {
    customElements.define('federation-map', FederationMap);
  }
}
