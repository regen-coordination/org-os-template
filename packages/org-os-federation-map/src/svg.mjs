// src/svg.mjs
// Pure string renderer: layout in, SVG out. All interactivity lives in element.mjs;
// this stays headless-testable. Torchlight = radial gradient + per-ring CSS classes.
import { nodeRadius, RING_RADIUS } from './sim.mjs';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSVG({ nodes, links, width, height, cx, cy, unit }) {
  const rings = Object.values(RING_RADIUS)
    .map((f) => `<circle class="ring-guide" cx="${cx}" cy="${cy}" r="${(f * unit).toFixed(1)}"/>`)
    .join('');
  const edges = links.map((l) => {
    const s = l.source, t = l.target;
    return `<line class="edge ${esc(l.kind)}" data-from="${esc(s.id)}" data-to="${esc(t.id)}" ` +
      `x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}"/>`;
  }).join('');
  const circles = nodes.map((n) => {
    const r = nodeRadius(n);
    const label = n.name || n.id;
    return `<g class="node ${esc(n.kind)} ring-${n.ring}${n.live ? ' live' : ''}" data-id="${esc(n.id)}" tabindex="0">` +
      `<circle class="halo" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r + 5}"/>` +
      `<circle class="dot" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r}"/>` +
      `<text class="label" x="${(n.x + r + 4).toFixed(1)}" y="${(n.y + 3).toFixed(1)}">${esc(label)}</text>` +
      `</g>`;
  }).join('');
  const selfName = esc(nodes[0]?.name || nodes[0]?.id || 'instance');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" ` +
    `aria-label="Federation map of ${selfName}: ${nodes.length - 1} external nodes across instances, frontier, and sources">` +
    `<defs><radialGradient id="torch" class="torch-gradient" cx="50%" cy="50%" r="55%">` +
    `<stop offset="0%" stop-color="var(--fedmap-self, #f5c04e)" stop-opacity="0.14"/>` +
    `<stop offset="45%" stop-color="var(--fedmap-self, #f5c04e)" stop-opacity="0.04"/>` +
    `<stop offset="100%" stop-color="var(--fedmap-self, #f5c04e)" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect class="torch-wash" width="${width}" height="${height}" fill="url(#torch)"/>` +
    rings + `<g class="edges">${edges}</g><g class="nodes">${circles}</g></svg>`;
}
