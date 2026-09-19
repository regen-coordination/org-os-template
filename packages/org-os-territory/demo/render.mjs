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
<div class="card"><h3>After</h3><p>Core first, then any pack the instance opts into with ${code('extensions: [org-os-territory]')}.</p>
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

export function seg(action, attr, items, current) {
  return `<div class="seg" role="group">${items.map(([v, label]) => `<button type="button" class="btn" data-action="${esc(action)}" data-${esc(attr)}="${esc(v)}" aria-pressed="${v === current}">${esc(label)}</button>`).join('')}</div>`;
}

export function renderPackPanel(f, which) {
  const p = f.packInfo;
  if (which === 'none') {
    const n = p.none;
    return `<div class="card"><p>${chip('No pack loaded', 'warn')} The instance sees exactly the core: <strong>${esc(n.schemas.length)}</strong> schemas, <strong>${esc(n.lexiconCount)} lexicons</strong>, ${esc(Object.keys(n.bindings).length)} registry bindings.</p>
<p class="muted">Opt-in types today: ${n.optInTypes.map((t) => code(t)).join(' ')}. The territory types are simply unknown — ${code('territorial-unit')} is not a schema here.</p></div>`;
  }
  const t = p.territory; const a = t.added;
  const props = Object.entries(t.lexicon.defs.main.record.properties);
  const req = t.lexicon.defs.main.record.required;
  return `<div class="card"><p>${chip('org-os-territory loaded', 'ok')} <strong>${esc(t.schemas.length)}</strong> schemas (${esc(p.none.schemas.length)} core + ${esc(a.schemas.length)}), <strong>${esc(t.lexiconCount)} lexicons</strong> (${esc(p.none.lexiconCount)} + ${esc(a.lexicons)}). Kernel valid: ${chip(String(t.kernelValid), t.kernelValid ? 'ok' : 'bad')} Layer A untouched: ${chip(String(t.layerAUntouched), t.layerAUntouched ? 'ok' : 'bad')}</p>
<h4>pack.yaml</h4>${pre(JSON.stringify(t.manifest, null, 2))}
<h4>Layer-B entities it adds (each must map to a real core type)</h4>
<table><thead><tr><th>entity</th><th>maps_to_core</th><th>description</th></tr></thead><tbody>${Object.entries(a.entities).map(([k, v]) => `<tr><td>${code(k)}</td><td>${code(v.maps_to_core)}</td><td>${esc(v.description)}</td></tr>`).join('')}</tbody></table>
<h4>Publish-eligible (opt-in) types and registry bindings</h4>
<p>${a.optInTypes.map((x) => code(x)).join(' ')} — <em>eligible, not published</em> until the instance lists them in <code>publish.types_opt_in</code>.</p>
<table><thead><tr><th>schema</th><th>registry file</th></tr></thead><tbody>${Object.entries(a.bindings).map(([k, v]) => `<tr><td>${code(k)}</td><td>${code(v)}</td></tr>`).join('')}</tbody></table>
<h4>The generated lexicon <code>${esc(t.lexicon.id)}</code> — flat: string, integer, array of strings</h4>
<table><thead><tr><th>property</th><th>type</th><th>known values</th></tr></thead><tbody>${props.map(([k, v]) => `<tr><td>${code(k)}${req.includes(k) ? ' ' + chip('required') : ''}</td><td>${esc(v.type)}</td><td>${esc((v.knownValues || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>`;
}

export function renderPack(f) {
  return `${seg('pick-pack', 'which', [['none', 'No pack'], ['territory', 'org-os-territory']], 'territory')}
<div data-panel="pack">${renderPackPanel(f, 'territory')}</div>
${provenance('Measured by loading the pack through the real kms path (<code>loadExtensions</code>) and diffing <code>listSchemas()</code>, <code>extensionEntities()</code>, <code>optInTypes()</code>, <code>registryBindings()</code> and <code>generateAll()</code> before and after — <code>demo/capture/pack-info.mjs</code>.')}`;
}

register({ id: 'pack', order: 2, nav: '2 Load a pack', title: '2 · Load a pack', lead: 'Pick the instance configuration and see exactly what the framework registers.', render: renderPack });

const MATRIX_LABELS = [['no-pack', 'No pack'], ['no-pack-optin', 'No pack + opt-in listed'], ['pack-closed', 'Pack, not opted in'], ['pack-units', 'Pack, units opted in'], ['pack-units-streams', 'Pack, units + streams opted in']];

export function renderMatrixPanel(f, id) {
  const m = f.matrix.find((r) => r.id === id);
  const cfg = `${m.pack ? 'extensions: [org-os-territory]\n' : ''}publish:\n  base_url: https://demo.invalid${m.optIn.length ? `\n  types_opt_in: [${m.optIn.join(', ')}]` : ''}`;
  const head = `<div class="cols"><div><h4>The instance's kms.yaml (relevant lines)</h4>${pre(cfg)}<p class="muted">Same sample data every time: one resource, one unit carrying a private <code>notes</code> field, one public stream, one <code>not-public-yet</code> draft stream.</p></div>`;
  if (m.error) return `${head}<div><h4>Result</h4><div class="card res-bad">${chip('hard error', 'bad')} <code>publish</code> refused to run:${pre(m.error)}<p class="muted">Opting in to a type the instance does not know is an error, not a silent no-op.</p></div></div></div>`;
  const newTypes = m.collections.filter((c) => /territorialUnit|dataStream/.test(c.collection));
  const verdict = newTypes.length ? chip(`${newTypes.length} pack type${newTypes.length > 1 ? 's' : ''} published — the instance opted in`, 'warn') : chip('nothing new published', 'ok');
  return `${head}<div><h4>Result</h4><div class="card">${verdict}
<p><strong>Records written to the fake PDS</strong></p>
<table><thead><tr><th>collection</th><th>records</th></tr></thead><tbody>${m.collections.map((c) => `<tr><td>${code(c.collection)}</td><td>${esc(c.count)}</td></tr>`).join('')}</tbody></table>
${m.unitRecordKeys ? `<p><strong>Fields of the published unit record</strong> (the sample carried a private <code>notes</code> field; it is not among these):</p><ul class="fields">${m.unitRecordKeys.map((k) => `<li><code>${esc(k)}</code></li>`).join('')}</ul>` : ''}
<p><strong>Static surface</strong> — ${m.surfaceFiles.map((x) => code(x)).join(' ')} <span class="muted">+ ${esc(m.perItemFiles)} per-item files</span></p>
<p>Pack types in <code>api/context.jsonld</code>: ${m.contextPackTypes.length ? m.contextPackTypes.map((x) => code(x)).join(' ') : chip('none')} · <code>extensions.yaml</code>: ${chip(m.hasExtensionsYaml ? 'present' : 'absent')}</p></div></div></div>`;
}

export function renderOneProcess(f) {
  const o = f.oneProcess;
  const list = (a) => (a.length ? a.map((x) => code(x)).join(' ') : chip('none', 'ok'));
  return `<div class="cols"><div class="card"><h4>Instance A — the pack loaded</h4><p>types in its context: ${list(o.withPack.contextTypes)}<br><code>extensions.yaml</code>: ${chip(o.withPack.hasExtensionsYaml ? 'present' : 'absent')}</p></div>
<div class="card"><h4>Instance B — no packs, same process</h4><p>types in its context: ${list(o.packless.contextTypes)}<br><code>extensions.yaml</code>: ${chip(o.packless.hasExtensionsYaml ? 'present' : 'absent', 'ok')}</p></div></div>
<div class="card"><p>The process registry still holds ${o.registeredPacks.map((x) => code(x)).join(' ')} while B publishes. The call the static surface used to make, <code>toJsonLdContext()</code>, returns ${list(o.surfaceUsedToCall.unfiltered)} — that is what a pack-less instance would have published. It now makes <code>toJsonLdContext(undefined, { packs: [] })</code> for an instance with no packs, which returns ${list(o.surfaceUsedToCall.filtered)}.</p>
<p>${chip('caught in review', 'warn')} <strong>This was a real defect</strong>: the whole-branch review found it (no single task review could see it); it is fixed and now covered by a test.</p>
<p>A stale file is cleaned up too: an instance that had a pack and then dropped it had <code>extensions.yaml</code> ${chip(String(o.stale.before))} before republishing and ${chip(String(o.stale.after), 'ok')} after.</p></div>`;
}

export function renderGuarantees(f) {
  return `<h3>Publish matrix — the same data, five configurations</h3>
${seg('pick-matrix', 'id', MATRIX_LABELS, 'pack-units')}
<div data-panel="matrix">${renderMatrixPanel(f, 'pack-units')}</div>
${provenance('Each configuration is a temp instance published through the real <code>OPS.publish</code> op against a fake PDS client — <code>demo/capture/publish-matrix.mjs</code>.')}
<h3>One process, two instances</h3>
${renderOneProcess(f)}
${provenance('Two instances published in one process without resetting the registry, then the unfiltered and filtered <code>toJsonLdContext</code> calls compared — <code>demo/capture/one-process.mjs</code>.')}`;
}

register({ id: 'guarantees', order: 3, nav: '3 Guarantees', title: '3 · The guarantees', lead: 'A pack can never widen what an instance publishes, and one instance never sees another’s pack.', render: renderGuarantees });

export function renderAttemptPanel(f, id) {
  const a = f.attempts.find((x) => x.id === id);
  const files = Object.entries(a.files);
  const naming = a.namesPack ? chip('the error names the pack', 'ok') : chip('names only the offending item — a known gap', 'warn');
  return `<div class="card"><h3>${esc(a.title)}</h3><p class="muted">${esc(a.why)}</p>
<h4>Input — exactly the files written to a temp packages directory, then loaded with <code>${esc(a.action)}</code></h4>
${files.length ? files.map(([p, t]) => `<p class="filepath">${code(p)}</p>${pre(t)}`).join('') : '<p class="muted">(no files — the pack does not exist, or the name is rejected before any path is built)</p>'}
<h4>What the real loader threw</h4>${pre(a.error)}
<p>${naming}</p></div>`;
}

export function renderAttempts(f) {
  const first = f.attempts[0].id;
  return `<p class="muted">Eleven ways to get a pack wrong, each run for real against the loader. Pick one.</p>
${seg('pick-attempt', 'id', f.attempts.map((a) => [a.id, a.title]), first)}
<div data-panel="attempt">${renderAttemptPanel(f, first)}</div>
${provenance('Each attempt writes its files to a temp packages directory and calls the real <code>loadExtensions</code> (and, for connectors, <code>loadPackConnectors</code> + <code>mergeConnectors</code>); the build fails if an attempt does not fail or fails with a different message — <code>demo/capture/attempts.mjs</code>.')}`;
}

export function renderVerified(f) {
  const v = f.verified;
  const suites = v.skipped
    ? `<p>${chip('suites not run in this build', 'warn')} Rebuild without <code>--skip-suites</code> (<code>npm run demo</code>) to record the real pass counts here.</p>`
    : `<table><thead><tr><th>suite</th><th>tests</th><th>pass</th><th>fail</th><th>skipped</th></tr></thead><tbody>${v.suites.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.tests)}</td><td>${esc(s.pass)}</td><td>${esc(s.fail)}</td><td>${esc(s.skipped)}</td></tr>`).join('')}</tbody></table>`;
  return `<h3>Test suites</h3>${suites}
<h3>No pre-existing test was modified</h3>
<p>${chip(String(v.testDirsUnmodified), v.testDirsUnmodified ? 'ok' : 'bad')} <code>git diff ${esc(v.base.slice(0, 7))}..HEAD --diff-filter=MDR</code> over <code>packages/toolkit-framework/test</code> and <code>packages/org-os-kms/test</code> printed nothing: the branch adds tests and changes none that existed on <code>main</code>.</p>
<h3>The branch — ${esc(v.commits.length)} commits over <code>${esc(v.base.slice(0, 7))}</code></h3>
<ol class="commits">${v.commits.map((c) => `<li><code>${esc(c.slice(0, 7))}</code> ${esc(c.slice(8))}</li>`).join('')}</ol>
${provenance('Suite counts are parsed from each package’s real <code>node --test</code> run; the diff check and the commit list are read from git — <code>demo/capture/verified.mjs</code>. The build fails if any suite has a failing test or a pre-existing test file was touched.')}`;
}

register({ id: 'attempts', order: 4, nav: '4 Break it', title: '4 · Try to break it', lead: 'Every way of loading a pack wrong fails loudly, and says why.', render: renderAttempts });
register({ id: 'verified', order: 7, nav: '7 Verified', title: '7 · Verified', lead: 'What was measured, not claimed.', render: renderVerified });
