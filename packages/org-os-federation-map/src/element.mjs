// src/element.mjs
// <federation-map> — interaction layer over parse/sim/svg (spec §4).
// Attributes: src="url of map.json" | inline <script type="application/json"> child;
//             mode="full" (default) | "mini" (no pan/zoom/panel/tooltip, sparse labels).
// Deep-link: #node=<id> focuses + lights a node on load.
// Guarded so the module imports cleanly in node (no DOM at top level).
import { normalizeMap } from './parse.mjs';
import { buildLayout, nodeRadius } from './sim.mjs';
import { renderSVG, esc } from './svg.mjs';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

const STYLES = /* css */ `
:host { display: block; position: relative; background: var(--fedmap-bg, #0a0d13);
  border-radius: 8px; overflow: hidden; font-family: var(--fedmap-font, ui-monospace, monospace); }
svg { display: block; width: 100%; height: auto; cursor: grab; touch-action: none; }
svg.panning { cursor: grabbing; }
.ring-guide { fill: none; stroke: var(--fedmap-text, #9aa4b2); stroke-opacity: 0.08; stroke-dasharray: 2 5; }
.edge { stroke: var(--fedmap-instance, #2dd4a8); stroke-width: 1; stroke-opacity: 0.35; }
.edge.provenance { stroke: var(--fedmap-source, #8b7cf6); }
.edge.knowledge { stroke: var(--fedmap-source, #8b7cf6); stroke-dasharray: 4 3; }
.edge.frontier { stroke: var(--fedmap-ember, #e8946a); stroke-opacity: 0.14; }
.edge.upstream, .edge.downstream { stroke-dasharray: 6 3; }
.node { cursor: pointer; }
.node .halo { fill: none; }
.node .dot { fill: var(--fedmap-instance, #2dd4a8); }
.node.self .dot { fill: var(--fedmap-self, #f5c04e); }
.node.self .halo { fill: var(--fedmap-self, #f5c04e); fill-opacity: 0.10; }
.node.source .dot, .node.ecosystem .dot { fill: var(--fedmap-source, #8b7cf6); }
.node.frontier .dot { fill: var(--fedmap-ember, #e8946a); animation: ember 3.2s ease-in-out infinite; }
.ring-0 { opacity: 1; } .ring-1 { opacity: 0.92; } .ring-2 { opacity: 0.45; } .ring-3 { opacity: 0.7; }
.label { fill: var(--fedmap-text, #9aa4b2); font-size: 10px; pointer-events: none; }
.node.frontier .label { opacity: 0; } .node.frontier.lit .label { opacity: 1; }
@keyframes ember { 0%,100% { fill-opacity: 0.35; } 50% { fill-opacity: 0.75; } }
@media (prefers-reduced-motion: reduce) { .node.frontier .dot { animation: none; } }
:host(.torching) .node:not(.lit) { opacity: 0.18; }
:host(.torching) .edge:not(.lit) { stroke-opacity: 0.05; }
.node.lit, .edge.lit { opacity: 1 !important; }
.edge.lit { stroke-opacity: 0.9 !important; }
.tooltip { position: absolute; pointer-events: none; background: #11151d; color: #d7dde6;
  border: 1px solid #2a3140; border-radius: 6px; padding: 6px 9px; font-size: 11px;
  max-width: 240px; z-index: 2; display: none; }
.panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(290px, 85%);
  background: #0e121a; color: #d7dde6; border-left: 1px solid #2a3140; padding: 14px;
  font-size: 12px; overflow-y: auto; transform: translateX(100%); transition: transform 0.18s ease; z-index: 3; }
.panel.open { transform: translateX(0); }
.panel h3 { margin: 0 0 4px; color: var(--fedmap-self, #f5c04e); font-size: 14px; }
.panel a { color: var(--fedmap-instance, #2dd4a8); display: block; margin-top: 6px; }
.panel .close { position: absolute; top: 8px; right: 10px; cursor: pointer; background: none;
  border: none; color: #9aa4b2; font-size: 14px; }
.panel dl { margin: 8px 0; } .panel dt { color: #6b7480; margin-top: 6px; } .panel dd { margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.empty { color: #6b7480; padding: 32px; text-align: center; font-size: 12px; }
:host([mode="mini"]) svg { cursor: default; }
:host([mode="mini"]) .label { display: none; }
:host([mode="mini"]) .node.self .label, :host([mode="mini"]) .node.instance .label { display: block; }
`;

// Node fields (name/url/repo/portal/type) can originate from REMOTE peer manifests
// (fetchFrontier → buildMap → map.json), so the panel is untrusted HTML. safeUrl
// allow-lists link schemes (blocks javascript:/data:) and nodePanelHTML escapes every
// interpolation — both pure + exported so they're unit-tested without a DOM.
const SAFE_SCHEME = /^(https?:|obsidian:)/i;
export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim();
  if (/^[/#]/.test(s)) return s;           // same-origin relative links are safe
  return SAFE_SCHEME.test(s) ? s : null;   // otherwise only http(s)/obsidian
}

export function nodePanelHTML(n) {
  const link = (href, label) => {
    const s = safeUrl(href);
    return s ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
  };
  const links = [
    link(n.url, 'visit ↗'),
    link(n.repo, 'repository ↗'),
    n.url && n.kind === 'instance' ? link(`${String(n.url).replace(/\/$/, '')}/federation.json`, 'federation.json ↗') : '',
    link(n.portal, '→ view inside (portal)'),
  ].filter(Boolean).join('');
  const dl = [['kind', n.kind], ['type', n.type], ['ring', n.ring], ['trust', n.trust],
    ['ecosystem', n.ecosystem], ['last seen', n.last_seen]]
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return `<h3>${esc(n.name || n.id)}</h3><dl>${dl}</dl>${links}`;
}

export class FederationMap extends Base {
  async connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' }); // re-entrant safe
    const data = await this.#loadData();
    this.map = normalizeMap(data);
    this.#render();
  }

  async #loadData() {
    const inline = this.querySelector('script[type="application/json"]');
    if (inline) { try { return JSON.parse(inline.textContent); } catch { return null; } }
    const src = this.getAttribute('src');
    if (!src) return null;
    try { const res = await fetch(src); return res.ok ? await res.json() : null; } catch { return null; }
  }

  #render() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${STYLES}</style>`;
    if (!this.map.ok) {
      root.innerHTML += `<div class="empty">No federation data — run <code>org-os-kms render map</code>.</div>`;
      return;
    }
    this.layout = buildLayout(this.map, { width: 900, height: 640 });
    const wrap = document.createElement('div');
    wrap.innerHTML = renderSVG(this.layout) +
      `<div class="tooltip"></div>` +
      `<div class="panel" role="dialog" aria-label="node details"><button class="close" aria-label="close">✕</button><div class="panel-body"></div></div>` +
      this.#srTable();
    root.appendChild(wrap);
    this.svg = root.querySelector('svg');
    this.mini = this.getAttribute('mode') === 'mini';
    this.#cacheEls();
    this.layout.sim.on('tick', () => this.#scheduleUpdate()); // only fires while reheated (drag)
    this.#wireHover();
    if (!this.mini) { this.#wireClick(); this.#wirePointer(); this.#focusFromHash(); }
  }

  // Cache element refs + a node-by-id map once, so per-tick updates are a tight loop
  // with zero DOM queries (the old per-tick querySelector storm was a big clunk source).
  #cacheEls() {
    this.nodeById = new Map(this.layout.nodes.map((n) => [n.id, n]));
    this.nodeEls = new Map();
    for (const g of this.shadowRoot.querySelectorAll('.node')) {
      this.nodeEls.set(g.dataset.id, { circles: g.querySelectorAll('circle'), text: g.querySelector('text') });
    }
    this.edgeEls = [...this.shadowRoot.querySelectorAll('.edge')].map((e) => ({
      e, s: this.nodeById.get(e.dataset.from), t: this.nodeById.get(e.dataset.to),
    }));
  }

  #scheduleUpdate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.#updatePositions(); });
  }

  #byId(id) { return this.nodeById ? this.nodeById.get(id) : this.layout.nodes.find((n) => n.id === id); }
  #neighbors(id) {
    const lit = new Set([id]);
    for (const l of this.layout.links) {
      if (l.source.id === id) lit.add(l.target.id);
      if (l.target.id === id) lit.add(l.source.id);
    }
    return lit;
  }

  #light(id) {
    const lit = this.#neighbors(id);
    this.classList.add('torching');
    this.shadowRoot.querySelectorAll('.node').forEach((g) => g.classList.toggle('lit', lit.has(g.dataset.id)));
    this.shadowRoot.querySelectorAll('.edge').forEach((e) =>
      e.classList.toggle('lit', e.dataset.from === id || e.dataset.to === id));
  }
  #unlight() {
    this.classList.remove('torching');
    this.shadowRoot.querySelectorAll('.lit').forEach((el) => el.classList.remove('lit'));
  }

  #wireHover() {
    const tip = this.shadowRoot.querySelector('.tooltip');
    this.svg.addEventListener('pointerover', (ev) => {
      const g = ev.target.closest('.node'); if (!g) return;
      this.#light(g.dataset.id);
      if (this.mini) return;
      const n = this.#byId(g.dataset.id);
      const bits = [n.name || n.id, n.type, n.trust && `trust: ${n.trust}`,
        n.live != null && (n.live ? '● live' : '○ unreached'),
        n.counts && Object.entries(n.counts).map(([k, v]) => `${v} ${k}`).join(' · '),
        n.last_seen && `seen ${n.last_seen.slice(0, 10)}`].filter(Boolean);
      tip.textContent = bits.join(' — ');
      tip.style.display = 'block';
      const r = this.getBoundingClientRect();
      tip.style.left = `${ev.clientX - r.left + 12}px`;
      tip.style.top = `${ev.clientY - r.top + 12}px`;
    });
    this.svg.addEventListener('pointerout', (ev) => {
      if (ev.target.closest('.node')) { this.#unlight(); tip.style.display = 'none'; }
    });
  }

  #wireClick() {
    const panel = this.shadowRoot.querySelector('.panel');
    const body = panel.querySelector('.panel-body');
    this.svg.addEventListener('click', (ev) => {
      const g = ev.target.closest('.node'); if (!g) return;
      body.innerHTML = nodePanelHTML(this.#byId(g.dataset.id)); // escaped + scheme-allowlisted
      panel.classList.add('open');
    });
    panel.querySelector('.close').addEventListener('click', () => panel.classList.remove('open'));
  }

  // One capture-based pointer handler for pan + drag + zoom. Pointer capture keeps
  // tracking even when the cursor leaves the SVG; a movement threshold means a plain
  // click never engages a drag (so it never reheats the sim → clicks feel instant).
  #wirePointer() {
    const svg = this.svg;
    const vb = svg.viewBox.baseVal;
    const THRESH = 4; // px of travel before a node-press promotes to a drag
    const toSvg = (ev) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    let mode = null;             // 'pan' | 'pending' | 'drag'
    let startX = 0, startY = 0, lastX = 0, lastY = 0, dragNode = null;

    // Zoom anchored on the cursor: the SVG point under the pointer stays put.
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const k = ev.deltaY > 0 ? 1.12 : 0.89;
      const nw = Math.min(Math.max(vb.width * k, 200), 2400);
      const nh = nw * (vb.height / vb.width);
      const p = toSvg(ev);
      const fx = (p.x - vb.x) / vb.width, fy = (p.y - vb.y) / vb.height;
      vb.x = p.x - fx * nw; vb.y = p.y - fy * nh; vb.width = nw; vb.height = nh;
    }, { passive: false });

    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const g = ev.target.closest('.node');
      startX = lastX = ev.clientX; startY = lastY = ev.clientY;
      svg.setPointerCapture(ev.pointerId);
      if (g && g.dataset.id !== this.map.self.id) { mode = 'pending'; dragNode = this.#byId(g.dataset.id); }
      else if (!g) { mode = 'pan'; svg.classList.add('panning'); }
      else { mode = null; } // self is pinned — no drag, no pan; click still opens its panel
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!mode) return;
      if (mode === 'pan') {
        const scale = vb.width / svg.clientWidth;
        vb.x -= (ev.clientX - lastX) * scale; vb.y -= (ev.clientY - lastY) * scale;
        lastX = ev.clientX; lastY = ev.clientY; return;
      }
      if (mode === 'pending' && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) >= THRESH) {
        mode = 'drag'; this.layout.sim.alphaTarget(0.12).restart(); // gentle reheat, neighbours ease
      }
      if (mode === 'drag' && dragNode) {
        const p = toSvg(ev); dragNode.fx = p.x; dragNode.fy = p.y; this.#scheduleUpdate();
      }
    });

    const end = (ev) => {
      if (mode === 'pan') svg.classList.remove('panning');
      if (mode === 'drag' && dragNode) { dragNode.fx = null; dragNode.fy = null; this.layout.sim.alphaTarget(0); }
      try { svg.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      mode = null; dragNode = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  #updatePositions() {
    for (const n of this.layout.nodes) {
      const c = this.nodeEls.get(n.id); if (!c) continue;
      const r = nodeRadius(n);
      for (const el of c.circles) { el.setAttribute('cx', n.x); el.setAttribute('cy', n.y); }
      if (c.text) { c.text.setAttribute('x', n.x + r + 4); c.text.setAttribute('y', n.y + 3); }
    }
    for (const { e, s, t } of this.edgeEls) {
      e.setAttribute('x1', s.x); e.setAttribute('y1', s.y);
      e.setAttribute('x2', t.x); e.setAttribute('y2', t.y);
    }
  }

  #focusFromHash() {
    const m = (location.hash || '').match(/node=([^&]+)/);
    if (!m) return;
    const n = this.#byId(decodeURIComponent(m[1]));
    if (!n) return;
    this.#light(n.id);
    const vb = this.svg.viewBox.baseVal; // walk toward it: centre the viewBox on the node
    vb.x = n.x - vb.width / 2; vb.y = n.y - vb.height / 2;
  }

  #srTable() {
    const rows = this.layout.nodes.map((n) =>
      `<tr><td>${esc(n.name || n.id)}</td><td>${esc(n.kind)}</td><td>${esc(n.ring)}</td></tr>`).join('');
    return `<table class="sr-only"><caption>Federation map nodes</caption>` +
      `<thead><tr><th>name</th><th>kind</th><th>ring</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
}

export function define() {
  if (typeof customElements !== 'undefined' && !customElements.get('federation-map')) {
    customElements.define('federation-map', FederationMap);
  }
}
