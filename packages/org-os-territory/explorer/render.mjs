// explorer/render.mjs — pure view → HTML string functions (the build renders the first paint with them; the page inlines them for re-renders).
// Every interactive element carries data-action (what it dispatches) and data-key (so focus survives a re-render and the tour can point at it).
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (...names) => names.filter(Boolean).join(' ');
const pct = (n) => `${Math.round(n * 100)}%`;
const LAYER_LABEL = { administrative: 'Administrative', landscape: 'Landscape', ecological: 'Ecological', hydrological: 'Hydrological' };
const VIEW_LABEL = { you: 'You', 'peer-pack': 'A peer with the pack', 'peer-nopack': 'A peer without it' };
const SHARE_LABEL = { nothing: 'nothing', units: 'your places', 'units-streams': 'your places + data streams' };
const things = (n) => `${n} thing${n === 1 ? '' : 's'}`;

function renderUnit(n) {
  const state = [n.selected && 'selected', n.ancestor && 'contains the selected place', n.overlapped && 'overlaps the selected place', n.dimmed && 'not received by this peer'].filter(Boolean).join(', ');
  const label = `${n.title} — ${n.layer}, ${n.level}, ${things(n.count)}${state ? ` (${state})` : ''}`;
  return `<li><button type="button" class="${cls('unit', n.selected && 'is-selected', n.ancestor && 'is-ancestor', n.overlapped && 'is-overlapped', n.dimmed && 'is-dimmed')}" data-action="select" data-id="${esc(n.id)}" data-key="unit:${esc(n.id)}" aria-pressed="${n.selected}" aria-label="${esc(label)}">`
    + `<span class="unit-title">${esc(n.title)}</span> <span class="unit-level">${esc(n.level)}</span>${n.count ? ` <span class="badge" aria-hidden="true">${n.count}</span>` : ''}${n.overlapped ? ' <span class="mark" aria-hidden="true">⇄</span>' : ''}</button>`
    + `${n.children.length ? `<ul>${n.children.map(renderUnit).join('')}</ul>` : ''}</li>`;
}

export function renderBoard(v) {
  return `<section class="board" id="board" aria-labelledby="board-h"><h2 id="board-h">Layers</h2><p class="caption">Schematic — not a map. Boxes nest by "is part of"; ⇄ marks places on other layers that overlap the selected one.</p>`
    + v.layers.map((l) => `<div class="layer" data-layer="${esc(l.layer)}"><h3>${esc(LAYER_LABEL[l.layer] || l.layer)}</h3><ul class="tree">${l.roots.map(renderUnit).join('')}</ul></div>`).join('')
    + (v.tray.length ? `<div class="tray" id="tray"><h3>Not placed anywhere</h3><ul>${v.tray.map((x) => `<li class="${cls(x.dimmed && 'is-dimmed')}">${esc(x.resource)} — refers to <code>${esc(x.ref)}</code>, a place this territory doesn't have.</li>`).join('')}</ul></div>` : '')
    + `</section>`;
}

export function renderPanel(v) {
  const p = v.panel;
  if (!p) return `<section class="panel" id="panel" aria-labelledby="panel-h"><h2 id="panel-h">Pick a place</h2><p>Click any place on the left to see what it holds, what it overlaps, and which data exist for it — or take the tour.</p></section>`;
  const li = (dimmed, html) => `<li class="${cls(dimmed && 'is-dimmed')}">${html}${dimmed ? ' <span class="why">not received by this peer</span>' : ''}</li>`;
  return `<section class="panel" id="panel" aria-labelledby="panel-h"><h2 id="panel-h" class="${cls(p.dimmed && 'is-dimmed')}">${esc(p.title)}</h2>`
    + `<p class="meta">${esc(LAYER_LABEL[p.layer] || p.layer)} layer · ${esc(p.level)}${p.ancestors.length ? ` · inside ${p.ancestors.map((a) => esc(a.title)).join(' › ')}` : ''}${p.codes.length ? ` · <code>${p.codes.map(esc).join('</code> <code>')}</code>` : ''}</p>`
    + (p.privateNote ? `<p class="private">This place carries a private note. It is yours only — it never leaves, whatever you share.</p>` : '')
    + `<h3>What's here (${p.here.length})</h3>`
    + (p.hasInside ? `<label class="inside"><input type="checkbox" data-change="toggle-inside" data-key="inside"${p.includeInside ? ' checked' : ''}> include places inside it</label>` : '')
    + (p.here.length ? `<ul>${p.here.map((r) => li(r.dimmed, esc(r.title))).join('')}</ul>` : `<p class="none">Nothing placed here${p.hasInside && !p.includeInside ? ' directly' : ''}.</p>`)
    + `<h3 data-key="overlaps" tabindex="-1">Overlaps with (${p.overlaps.length})</h3>`
    + (p.overlaps.length ? `<ul>${p.overlaps.map((o) => li(o.dimmed, `<button type="button" class="link" data-action="select" data-id="${esc(o.id)}" data-key="overlap:${esc(o.id)}">${esc(o.title)}</button> <span class="meta">${esc(o.layer)}</span> — ${pct(o.shareSelf)} of this place, ${pct(o.shareOther)} of theirs <span class="tag">invented</span>`)).join('')}</ul>` : `<p class="none">No overlaps recorded.</p>`)
    + `<h3 data-key="streams" tabindex="-1">Data about this place (${p.streams.length})</h3>`
    + (p.streams.length ? `<ul class="streams">${p.streams.map((s) => li(s.dimmed, `<strong>${esc(s.title)}</strong> <span class="tag">${esc(s.reason)}</span><br><span class="meta">${esc(s.provider)} · looked after by ${esc(s.steward)} · ${esc(s.access)} · trust: ${esc(s.trust)} · ${esc(s.cadence)} · licence: ${esc(s.licence)}</span>`)).join('')}</ul>` : `<p class="none">No data streams catalogued for this place.</p>`)
    + `</section>`;
}

export function renderBar(v) {
  const b = v.bar;
  const group = (name, legend, labels, current) => `<fieldset><legend>${legend}</legend>${Object.entries(labels).map(([value, label]) => `<label><input type="radio" name="${name}" value="${value}" data-change="${name}" data-key="${name}:${value}"${value === current ? ' checked' : ''}> ${esc(label)}</label>`).join('')}</fieldset>`;
  return `<section class="bar" id="bar" data-key="bar" tabindex="-1" aria-labelledby="bar-h"><h2 id="bar-h">Who sees what</h2>`
    + group('view', 'View as', VIEW_LABEL, b.view) + group('share', 'Of your territory, you share', SHARE_LABEL, b.share)
    + `<p class="sentence">${esc(b.sentence)}${b.receivedCounts ? ` They received ${b.receivedCounts.units} places, ${b.receivedCounts.streams} data streams and ${b.receivedCounts.resources} other items.` : ''}</p>`
    + `<p class="floor">Never leaves, whatever you share: ${b.neverLeaves.streams.map((s) => `"${esc(s)}"`).join(', ')}; the private <code>${b.neverLeaves.fields.map(esc).join('</code>, <code>')}</code> on a place.</p>`
    + `<p class="floor">Ordinary items (the projects placed here) are not part of the pack: they are shared by their own setting, not by this switch${b.resourceRefsTravel ? ' — and they keep their place references, which a peer without the pack cannot look up' : ''}.</p>`
    + `</section>`;
}

export function renderDrawers(v) {
  const btn = (id, label) => `<button type="button" class="drawer-btn" data-action="drawer" data-value="${id}" data-key="drawer-${id}" aria-expanded="${v.drawer === id}" aria-controls="drawer-${id}-body">${label}</button>`;
  const pack = v.drawer === 'pack' ? `<div class="drawer" id="drawer-pack-body"><p><strong>Everything you just explored is one opt-in pack</strong> — <code>${esc(v.pack.name)}</code> ${esc(v.pack.version)}. org-os itself was not changed to make room for it.</p>`
    + `<dl>${v.pack.types.map((t) => `<dt><code>${esc(t.name)}</code></dt><dd>${esc(t.description)} <span class="meta">Falls back to the built-in <code>${esc(t.mapsToCore)}</code>.</span></dd>`).join('')}</dl>`
    + `<p>The fallback is declared so that a peer without the pack could one day read a place as a plain <code>place</code>. <span class="tag">not built yet</span> Today such a peer simply receives nothing of these types.</p>`
    + `<p>An organisation turns the pack on with one line in its <code>kms.yaml</code>: <code>${esc(v.pack.optInLine)}</code>. Without that line, nothing changes. Territory is the first pack; others can follow the same pattern.</p></div>` : '';
  const about = v.drawer === 'about' ? `<div class="drawer" id="drawer-about-body"><p>This page was generated by running the real org-os code (commit <code>${esc(v.meta.commit)}</code>, ${esc(v.meta.capturedAt.slice(0, 10))}, Node ${esc(v.meta.node)}) over an illustrative sample and recording what it answered. The page only switches between recorded answers.</p><p>${esc(v.note)} ${esc(v.extraNote)}</p><p>For the engineering verification report, run <code>npm run demo</code> in <code>packages/org-os-territory</code>.</p></div>` : '';
  return `<section class="drawers" id="drawers" aria-label="More">${btn('pack', 'What is a pack?')}${btn('about', 'About this page')}${pack}${about}</section>`;
}

export function renderTour(v) {
  const t = v.tour;
  if (!t) return '';
  return `<aside class="tour" id="tour" role="dialog" aria-modal="false" aria-labelledby="tour-h" data-target="${esc(t.target)}"><p class="step">Step ${t.index + 1} of ${t.total}</p><h2 id="tour-h" data-key="tour-h" tabindex="-1">${esc(t.title)}</h2><p>${esc(t.text)}</p>`
    + `<p class="tour-nav">${t.index > 0 ? `<button type="button" data-action="tour" data-value="back" data-key="tour-back">Back</button>` : ''}<button type="button" data-action="tour" data-value="next" data-key="tour-next">${t.last ? 'Finish' : 'Next'}</button><button type="button" class="link" data-action="tour" data-value="end" data-key="tour-end">Skip tour</button></p></aside>`;
}

export function renderApp(v) {
  return `<p class="banner" id="banner" role="note">${esc(v.note)}</p>${renderTour(v)}<div class="cols">${renderBoard(v)}${renderPanel(v)}</div>${renderBar(v)}${renderDrawers(v)}<p class="sr" id="live" aria-live="polite">${esc(v.live)}</p>`;
}
