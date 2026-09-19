// demo/render.mjs — pure functions: facts → HTML strings. No imports, no DOM, no I/O, and no computation of claims: every value shown is read
// from `facts`. Plain ES module for the tests; the build inlines it into the page with the `export` keywords stripped, so only
// `export const`, `export function` and `export async function` may appear here.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const code = (s) => `<code>${esc(s)}</code>`;
export const pre = (s) => `<pre class="code"><code>${esc(s)}</code></pre>`;
export const chip = (text, kind = '') => `<span class="chip ${esc(kind)}">${esc(text)}</span>`;
// `text` is trusted static markup written in this file (never facts).
export const provenance = (text) => `<details class="prov"><summary>How this was produced</summary><p>${text}</p></details>`;

const REGISTRY = [];
function register(section) { REGISTRY.push(section); }
export function sections() { return [...REGISTRY].sort((a, b) => a.order - b.order); }

export function renderHeader(f) {
  return `<div class="wrap"><p class="eyebrow">org-os · extension packs</p>
<h1>Packs for the knowledge plane — a demo from real runs</h1>
<p class="sub">An instance opts into a pack with one line of <code>kms.yaml</code>. Core always wins, nothing publishes by default, and an instance without packs is unchanged.</p>
<p class="banner" role="note"><strong>Every number, error message and file list on this page was captured by running the real code</strong> — nothing is mocked — and the build refuses to produce the page if any of it fails to hold. <strong>The sample in section 5 is illustrative</strong>: example names, invented overlap shares, no geometry.</p>
<button class="btn" type="button" data-action="toggle-theme" aria-pressed="false">Toggle theme</button></div>`;
}

export function renderFooter(f) {
  return `<div class="wrap"><p>Captured ${esc(f.meta.capturedAt)} · org-os <code>${esc(f.meta.commit)}</code> · Node ${esc(f.meta.node)} · regenerate with <code>npm run demo</code> in <code>packages/org-os-territory</code>.</p></div>`;
}

export function renderSeam(f) {
  const n = f.packInfo.none; const t = f.packInfo.territory;
  return `<div class="seam">
<div class="card"><h3>Before</h3><p>One fixed schema directory. A new type means editing the framework.</p>
<div class="stack"><div class="box core">core schemas <b>${esc(n.schemas.length)}</b></div></div>
<p class="muted">Every instance inherits every type, and the framework copy drifts from its upstream.</p></div>
<div class="arrow" aria-hidden="true">→</div>
<div class="card"><h3>After</h3><p>Core first, then any pack the instance opts into with ${code('extensions: [org-os-territory]')}</p>
<div class="stack"><div class="box core">core schemas <b>${esc(n.schemas.length)}</b></div>
<div class="box pack">+ pack: ${t.added.schemas.map((s) => code(s)).join(' ')}</div></div>
<p class="muted">Core wins on every name; a collision is a load error, never a shadow.</p></div></div>
<ul class="claims">
<li>${chip('opt-in', 'ok')} An instance without <code>extensions</code> is <strong>unchanged</strong>: its schemas are exactly the ${esc(n.schemas.length)} core ones (sections 3 and 7).</li>
<li>${chip('publish', 'ok')} Pack types are <strong>publish-eligible, never published by default</strong> — the instance must list them in <code>publish.types_opt_in</code> (section 3).</li>
<li>${chip('core', 'ok')} A pack maps its types onto the frozen core (<code>territorial-unit</code> → <code>place</code>); it cannot alter Layer A (section 2).</li>
<li>${chip('errors', 'ok')} Every way of loading a pack wrong fails loudly and says why (section 4).</li>
</ul>
${provenance('Schema counts come from <code>listSchemas()</code> before and after <code>loadExtensions({ extensions: [\'org-os-territory\'] })</code> — <code>demo/capture/pack-info.mjs</code>.')}`;
}

register({ id: 'seam', order: 1, nav: '1 Seam', title: '1 · The seam', lead: 'What changed in the framework, and what did not.', render: renderSeam });
