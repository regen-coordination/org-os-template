// src/element.mjs
// <federation-map> — interaction layer over parse/sim/svg (spec §4).
// Attributes: src="url of map.json" | inline <script type="application/json"> child;
//             mode="full" (default) | "mini" (no pan/zoom/panel/tooltip, sparse labels).
// Deep-link: #node=<id> focuses + lights a node on load.
// Guarded so the module imports cleanly in node (no DOM at top level).
import { normalizeMap } from './parse.mjs';
import { buildLayout } from './sim.mjs';
import { renderSVG } from './svg.mjs';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

const STYLES = /* css */ `
:host { display: block; position: relative; background: var(--fedmap-bg, #0a0d13);
  border-radius: 8px; overflow: hidden; font-family: var(--fedmap-font, ui-monospace, monospace); }
svg { display: block; width: 100%; height: auto; cursor: grab; }
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

export class FederationMap extends Base {
  async connectedCallback() {
    this.attachShadow({ mode: 'open' });
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
    this.#wireHover();
    if (!this.mini) { this.#wireClick(); this.#wirePanZoom(); this.#wireDrag(); this.#focusFromHash(); }
  }

  #byId(id) { return this.layout.nodes.find((n) => n.id === id); }
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
      const n = this.#byId(g.dataset.id);
      const links = [
        n.url && `<a href="${n.url}" target="_blank" rel="noopener">visit ↗</a>`,
        n.repo && `<a href="${n.repo}" target="_blank" rel="noopener">repository ↗</a>`,
        n.url && n.kind === 'instance' && `<a href="${n.url.replace(/\/$/, '')}/federation.json" target="_blank" rel="noopener">federation.json ↗</a>`,
        n.portal && `<a href="${n.portal}">→ view inside (portal)</a>`,
      ].filter(Boolean).join('');
      const dl = [['kind', n.kind], ['type', n.type], ['ring', n.ring], ['trust', n.trust],
        ['ecosystem', n.ecosystem], ['last seen', n.last_seen]]
        .filter(([, v]) => v != null)
        .map(([k, v]) => `<dt>${k}</dt><dd>${String(v)}</dd>`).join('');
      body.innerHTML = `<h3>${n.name || n.id}</h3><dl>${dl}</dl>${links}`;
      panel.classList.add('open');
    });
    panel.querySelector('.close').addEventListener('click', () => panel.classList.remove('open'));
  }

  #wirePanZoom() {
    let vb = this.svg.viewBox.baseVal;
    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const k = ev.deltaY > 0 ? 1.1 : 0.9;
      const nw = Math.min(Math.max(vb.width * k, 220), 2200);
      vb.x += (vb.width - nw) / 2; vb.y += (vb.height - nw * (vb.height / vb.width)) / 2;
      vb.height *= nw / vb.width; vb.width = nw;
    }, { passive: false });
    let pan = null;
    this.svg.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.node')) return;
      pan = { x: ev.clientX, y: ev.clientY }; this.svg.classList.add('panning');
    });
    this.svg.addEventListener('pointermove', (ev) => {
      if (!pan) return;
      const scale = vb.width / this.svg.clientWidth;
      vb.x -= (ev.clientX - pan.x) * scale; vb.y -= (ev.clientY - pan.y) * scale;
      pan = { x: ev.clientX, y: ev.clientY };
    });
    this.svg.addEventListener('pointerup', () => { pan = null; this.svg.classList.remove('panning'); });
  }

  #wireDrag() {
    let drag = null;
    this.svg.addEventListener('pointerdown', (ev) => {
      const g = ev.target.closest('.node'); if (!g || g.dataset.id === this.map.self.id) return;
      drag = this.#byId(g.dataset.id);
      this.layout.sim.alphaTarget(0.25).restart();
      this.layout.sim.on('tick', () => this.#updatePositions());
      ev.stopPropagation();
    });
    this.svg.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(this.svg.getScreenCTM().inverse());
      drag.fx = pt.x; drag.fy = pt.y;
    });
    this.svg.addEventListener('pointerup', () => {
      if (!drag) return;
      drag.fx = null; drag.fy = null; drag = null;
      this.layout.sim.alphaTarget(0);
    });
  }

  #updatePositions() {
    for (const n of this.layout.nodes) {
      const g = this.shadowRoot.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`); if (!g) continue;
      g.querySelectorAll('circle').forEach((c) => { c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); });
      const t = g.querySelector('text');
      t.setAttribute('x', n.x + 10); t.setAttribute('y', n.y + 3);
    }
    this.shadowRoot.querySelectorAll('.edge').forEach((e) => {
      const s = this.#byId(e.dataset.from), t = this.#byId(e.dataset.to);
      e.setAttribute('x1', s.x); e.setAttribute('y1', s.y);
      e.setAttribute('x2', t.x); e.setAttribute('y2', t.y);
    });
  }

  #focusFromHash() {
    const m = (location.hash || '').match(/node=([^&]+)/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    if (this.#byId(id)) this.#light(id);
  }

  #srTable() {
    const rows = this.layout.nodes.map((n) =>
      `<tr><td>${n.name || n.id}</td><td>${n.kind}</td><td>${n.ring}</td></tr>`).join('');
    return `<table class="sr-only"><caption>Federation map nodes</caption>` +
      `<thead><tr><th>name</th><th>kind</th><th>ring</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
}

export function define() {
  if (typeof customElements !== 'undefined' && !customElements.get('federation-map')) {
    customElements.define('federation-map', FederationMap);
  }
}
