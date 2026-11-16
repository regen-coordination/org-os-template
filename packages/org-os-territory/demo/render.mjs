// demo/render.mjs — pure functions: facts → HTML strings. No imports, no DOM, no I/O, and no computation of claims: every value shown is read
// from `facts`. Plain ES module for the tests; the build inlines it into the page with the `export` keywords stripped, so only
// `export const`, `export function` and `export async function` may appear here.
//
// The house atoms (marks, glyphs, the note line, the callout) are kms's markup, not copies: build.mjs renders each once through kms's
// helpers (`mark`, `icon`, `note`, `callout`) with SLOT where the words go, fills ATOMS with them, and inlines the same ATOMS into the
// page, so a panel the browser re-renders is drawn from the same strings as the one the build wrote (spec §5.9, gallery §08).
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const SLOT = '@@SLOT@@';
export const ATOMS = { icon: {}, mark: {}, note: '', callout: '' };
const fill = (tpl, html) => tpl.replace(SLOT, () => html);
export function ic(name) { const h = ATOMS.icon[name]; if (!h) throw new Error(`no glyph: ${name}`); return h; }
export function mk(shape, word) { const h = ATOMS.mark[shape]; if (!h) throw new Error(`no mark: ${shape}`); return fill(h, esc(word)); }
// `html` is trusted static markup written in this file, or escaped by the caller.
export const note = (html) => fill(ATOMS.note, html);
export const callout = (html) => fill(ATOMS.callout, html);

export const code = (s) => `<code>${esc(s)}</code>`;
export const codes = (a) => a.map((x) => code(x)).join(' ');
// Captured output (errors, files, documents) goes in a Mono well, verbatim.
export const well = (s) => `<pre class="well">${esc(s)}</pre>`;
export const wellList = (items) => `<ul class="well list">${items.map((x) => `<li>${code(x)}</li>`).join('')}</ul>`;
// `text` is trusted static markup written in this file (never facts).
export const provenance = (text) => `<details class="prov"><summary>How this was produced</summary><p>${text}</p></details>`;

// A guarantee: the done disc, the claim, its evidence (the capture file in Mono and what it measured). `held` is read from the facts;
// a claim that did not hold could never reach the page (the build fails closed), but it would be drawn as one.
export const ck = () => `<span class="ck">${ic('check')}</span>`;
export const ev = (file, measured) => `<span class="ev">${code(file)}<span>${measured}</span></span>`;
export function claim(html, evidence = '', held = true) {
  return `<li class="claim">${held ? ck() : `<span class="nck">${mk('failed', 'Did not hold')}</span>`}<span class="ct">${html}</span>${evidence}</li>`;
}
export const claims = (items) => `<ul class="claims">${items.join('')}</ul>`;

// Rows, never tables (spec §5.9): `t` and `s` are html; `s` may be an array of html parts (set apart by the house's dot).
export function row({ t, s = '', end = '' }) {
  const sub = Array.isArray(s) ? s.filter(Boolean).map((x) => `<span>${x}</span>`).join('') : s;
  return `<li><div class="row plain"><span class="main"><span class="t">${t}</span>${sub ? `<span class="s">${sub}</span>` : ''}</span><span class="end">${end}</span></div></li>`;
}
export const rows = (items) => `<ul class="rows surf">${items.join('')}</ul>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function day(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? esc(iso) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }

const REGISTRY = [];
function register(section) { REGISTRY.push(section); }
export function sections() { return [...REGISTRY].sort((a, b) => a.order - b.order); }
export const sectionNo = (s) => String(s.order).padStart(2, '0');

export function renderIntro(f) {
  return `<div class="intro"><p class="lead">An instance opts into a pack with one line of <code>kms.yaml</code>. Core always wins, nothing publishes by default, and an instance without packs is unchanged.</p>
${callout('<b>Every number, error message and file list on this page was captured by running the real code</b> — nothing is mocked — and the build refuses to produce the page if any of it fails to hold. <b>The sample in section 05 is illustrative</b>: example names, invented overlap shares, no geometry.')}</div>`;
}

export function renderFooter(f) {
  return `<p>Captured <time datetime="${esc(f.meta.capturedAt)}">${esc(f.meta.capturedAt)}</time> · org-os <code>${esc(f.meta.commit)}</code> · Node ${esc(f.meta.node)} · regenerate with <code>npm run demo</code> in <code>packages/org-os-territory</code>.</p>`;
}

export function renderSeam(f) {
  const n = f.packInfo.none; const t = f.packInfo.territory;
  return `<div class="vs">
<div class="surf"><span class="eyebrow">Before</span><div class="slot">core schemas <b>${esc(n.schemas.length)}</b></div><p>One fixed schema directory. A new type means editing the framework.</p><p class="meta">Every instance inherits every type, and the framework copy drifts from its upstream.</p></div>
<span class="arrow">${ic('chev-r')}</span>
<div class="surf"><span class="eyebrow">After</span><div class="slot">core schemas <b>${esc(n.schemas.length)}</b></div><div class="slot on">+ pack ${codes(t.added.schemas)}</div><p>Core first, then any pack the instance opts into with ${code('extensions: [org-os-territory]')}.</p><p class="meta">Core wins on every name; a collision is a load error, never a shadow.</p></div>
</div>
${claims([
    claim(`An instance without <code>extensions</code> is <b>unchanged</b>: its schemas are exactly the ${esc(n.schemas.length)} core ones (sections 03 and 07).`, ev('demo/capture/pack-info.mjs', `${esc(n.schemas.length)} schemas, ${esc(n.lexiconCount)} lexicons without the pack`)),
    claim('Pack types are publish-eligible, <b>never published by default</b> — the instance must list them in <code>publish.types_opt_in</code> (section 03).', ev('demo/capture/publish-matrix.mjs', `${esc(f.matrix.length)} configurations published`)),
    claim('A pack maps its types onto the frozen core (<code>territorial-unit</code> → <code>place</code>); it <b>cannot alter Layer A</b> (section 02).', ev('demo/capture/pack-info.mjs', `kernel valid: ${esc(t.kernelValid)} · Layer A untouched: ${esc(t.layerAUntouched)}`), t.kernelValid && t.layerAUntouched),
    claim('Every way of loading a pack wrong <b>fails loudly</b> and says why (section 04).', ev('demo/capture/attempts.mjs', `${esc(f.attempts.length)} attempts, each refused`), f.attempts.every((a) => a.error)),
  ])}
${provenance('Schema counts come from <code>listSchemas()</code> before and after <code>loadExtensions({ extensions: [\'org-os-territory\'] })</code> — <code>demo/capture/pack-info.mjs</code>.')}`;
}

register({ id: 'seam', order: 1, nav: 'The seam', title: 'The seam', lead: 'What changed in the framework, and what did not.', render: renderSeam });

export function seg(action, attr, items, current, label = '') {
  return `<div class="seg" role="group"${label ? ` aria-label="${esc(label)}"` : ''}>${items.map(([v, text]) => `<button type="button" data-action="${esc(action)}" data-${esc(attr)}="${esc(v)}" aria-pressed="${v === current}">${esc(text)}</button>`).join('')}</div>`;
}
// A longer choice: a numbered list of buttons beside (or, narrow, above) the panel it switches.
export function picks(action, attr, items, current, label) {
  return `<div class="picks" role="group" aria-label="${esc(label)}">${items.map(([v, text], i) => `<button type="button" class="pick" data-action="${esc(action)}" data-${esc(attr)}="${esc(v)}" aria-pressed="${v === current}"><span class="no">${String(i + 1).padStart(2, '0')}</span><span>${esc(text)}</span></button>`).join('')}</div>`;
}

export function renderPackPanel(f, which) {
  const p = f.packInfo;
  if (which === 'none') {
    const n = p.none;
    return `<div class="panel"><p class="status">${mk('open', 'No pack loaded')}<span>The instance sees exactly the core: <b>${esc(n.schemas.length)}</b> schemas, <b>${esc(n.lexiconCount)} lexicons</b>, ${esc(Object.keys(n.bindings).length)} registry bindings.</span></p>
<p class="meta">Opt-in types today: ${codes(n.optInTypes)}. The territory types are simply unknown — ${code('territorial-unit')} is not a schema here.</p></div>`;
  }
  const t = p.territory; const a = t.added;
  const props = Object.entries(t.lexicon.defs.main.record.properties);
  const req = t.lexicon.defs.main.record.required;
  return `<div class="panel"><p class="status">${mk('done', 'org-os-territory loaded')}<span><b>${esc(t.schemas.length)}</b> schemas (${esc(p.none.schemas.length)} core + ${esc(a.schemas.length)}), <b>${esc(t.lexiconCount)} lexicons</b> (${esc(p.none.lexiconCount)} + ${esc(a.lexicons)}).</span></p>
${claims([
    claim('The kernel stays <b>valid</b>.', ev('validateKernel()', esc(t.kernelValid)), t.kernelValid),
    claim('Layer A is <b>untouched</b>: <code>core-entities</code> reads the same before and after.', ev('loadSchema(\'core-entities\')', esc(t.layerAUntouched)), t.layerAUntouched),
  ])}
<h4>pack.yaml</h4>${well(JSON.stringify(t.manifest, null, 2))}
<h4>Layer-B entities it adds (each must map to a real core type)</h4>
${rows(Object.entries(a.entities).map(([k, v]) => row({ t: code(k), s: [`maps_to_core ${code(v.maps_to_core)}`, esc(v.description)] })))}
<h4>Publish-eligible (opt-in) types and registry bindings</h4>
<p>${codes(a.optInTypes)} — <em>eligible, not published</em> until the instance lists them in <code>publish.types_opt_in</code>.</p>
${rows(Object.entries(a.bindings).map(([k, v]) => row({ t: code(k), s: [`registry file ${code(v)}`] })))}
<h4>The generated lexicon <code>${esc(t.lexicon.id)}</code> — flat: ${esc([...new Set(props.map(([, v]) => v.type))].join(', '))}</h4>
${rows(props.map(([k, v]) => row({ t: code(k), s: (v.knownValues || []).length ? [`known values: ${esc(v.knownValues.join(', '))}`] : '', end: `${esc(v.type)}${req.includes(k) ? ' · required' : ''}` })))}</div>`;
}

export function renderPack(f) {
  return `${seg('pick-pack', 'which', [['none', 'No pack'], ['territory', 'org-os-territory']], 'territory', 'Instance configuration')}
<div data-panel="pack">${renderPackPanel(f, 'territory')}</div>
${provenance('Measured by loading the pack through the real kms path (<code>loadExtensions</code>) and diffing <code>listSchemas()</code>, <code>extensionEntities()</code>, <code>optInTypes()</code>, <code>registryBindings()</code> and <code>generateAll()</code> before and after — <code>demo/capture/pack-info.mjs</code>.')}`;
}

register({ id: 'pack', order: 2, nav: 'Load a pack', title: 'Load a pack', lead: 'Pick the instance configuration and see exactly what the framework registers.', render: renderPack });

const MATRIX_LABELS = [['no-pack', 'No pack'], ['no-pack-optin', 'No pack + opt-in listed'], ['pack-closed', 'Pack, not opted in'], ['pack-units', 'Pack, units opted in'], ['pack-units-streams', 'Pack, units + streams opted in']];

export function renderMatrixPanel(f, id) {
  const m = f.matrix.find((r) => r.id === id);
  const cfg = `${m.pack ? 'extensions: [org-os-territory]\n' : ''}publish:\n  base_url: https://demo.invalid${m.optIn.length ? `\n  types_opt_in: [${m.optIn.join(', ')}]` : ''}`;
  const head = `<h4>The instance’s kms.yaml (relevant lines)</h4>${well(cfg)}<p class="meta">Same sample data every time: one resource, one unit carrying a private <code>notes</code> field, one public stream, one <code>not-public-yet</code> draft stream.</p>`;
  if (m.error) return `<div class="panel">${head}<h4>Result</h4><p class="status">${mk('done', 'Refused — a hard error')}<span><code>publish</code> refused to run:</span></p>${well(m.error)}<p class="meta">Opting in to a type the instance does not know is an error, not a silent no-op.</p></div>`;
  const newTypes = m.collections.filter((c) => /territorialUnit|dataStream/.test(c.collection));
  const verdict = newTypes.length ? mk('ok', `${plural(newTypes.length, 'pack type', 'pack types')} published — the instance opted in`) : mk('done', 'Nothing new published');
  return `<div class="panel">${head}<h4>Result</h4><p class="status">${verdict}</p>
<h4>Records written to the fake PDS</h4>
${rows(m.collections.map((c) => row({ t: code(c.collection), end: esc(c.count) })))}
${m.unitRecordKeys ? `<p>Fields of the published unit record (the sample carried a private <code>notes</code> field; it is not among these):</p><ul class="codes">${m.unitRecordKeys.map((k) => `<li>${code(k)}</li>`).join('')}</ul>` : ''}
<h4>Static surface — ${esc(m.surfaceFiles.length)} files + ${esc(m.perItemFiles)} per-item files</h4>${wellList(m.surfaceFiles)}
<p>Pack types in <code>api/context.jsonld</code>: ${m.contextPackTypes.length ? codes(m.contextPackTypes) : 'none'} · <code>extensions.yaml</code>: ${m.hasExtensionsYaml ? 'present' : 'absent'}</p></div>`;
}

export function renderOneProcess(f) {
  const o = f.oneProcess;
  const list = (a) => (a.length ? codes(a) : 'none');
  return `<div class="pair"><div class="surf"><span class="eyebrow">Instance A — the pack loaded</span><p>Types in its context: ${list(o.withPack.contextTypes)}</p><p><code>extensions.yaml</code>: ${o.withPack.hasExtensionsYaml ? 'present' : 'absent'}</p></div>
<div class="surf"><span class="eyebrow">Instance B — no packs, same process</span><p>Types in its context: ${list(o.packless.contextTypes)}</p><p><code>extensions.yaml</code>: ${o.packless.hasExtensionsYaml ? 'present' : 'absent'}</p></div></div>
${claims([
    claim(`The process registry still holds ${codes(o.registeredPacks)} while B publishes. The call the static surface used to make, <code>toJsonLdContext()</code>, returns ${list(o.surfaceUsedToCall.unfiltered)} — that is what a pack-less instance would have published. It now makes <code>toJsonLdContext(undefined, { packs: [] })</code> for an instance with no packs, which returns ${list(o.surfaceUsedToCall.filtered)}.`, `<span class="ev">${mk('done', 'Caught in review, fixed, now tested')}<span>a real defect: the whole-branch review found it; no single task review could see it</span></span>`, o.packless.contextTypes.length === 0),
    claim(`A stale file is cleaned up too: an instance that had a pack and then dropped it had <code>extensions.yaml</code> ${o.stale.before ? 'present' : 'absent'} before republishing and ${o.stale.after ? 'present' : 'absent'} after.`, ev('demo/capture/one-process.mjs', `before: ${esc(o.stale.before)} · after: ${esc(o.stale.after)}`), o.stale.before && !o.stale.after),
  ])}`;
}

export function renderGuarantees(f) {
  return `<h3>Publish matrix — the same data, five configurations</h3>
<div class="chooser">${picks('pick-matrix', 'id', MATRIX_LABELS, 'pack-units', 'Publish configuration')}
<div data-panel="matrix">${renderMatrixPanel(f, 'pack-units')}</div></div>
${provenance('Each configuration is a temp instance published through the real <code>OPS.publish</code> op against a fake PDS client — <code>demo/capture/publish-matrix.mjs</code>.')}
<h3>One process, two instances</h3>
${renderOneProcess(f)}
${provenance('Two instances published in one process without resetting the registry, then the unfiltered and filtered <code>toJsonLdContext</code> calls compared — <code>demo/capture/one-process.mjs</code>.')}`;
}

register({ id: 'guarantees', order: 3, nav: 'Guarantees', title: 'The guarantees', lead: 'A pack can never widen what an instance publishes, and one instance never sees another’s pack.', render: renderGuarantees });

export function renderAttemptPanel(f, id) {
  const a = f.attempts.find((x) => x.id === id);
  const files = Object.entries(a.files);
  const naming = a.namesPack ? mk('done', 'The error names the pack') : mk('open', 'Names only the offending item — a known gap');
  return `<div class="panel"><h3>${esc(a.title)}</h3><p class="meta">${esc(a.why)}</p>
<h4>Input — exactly the files written to a temp packages directory, then loaded with <code>${esc(a.action)}</code></h4>
${files.length ? files.map(([p, t]) => `<p class="filepath">${code(p)}</p>${well(t)}`).join('') : '<p class="meta">(no files — the pack does not exist, or the name is rejected before any path is built)</p>'}
<h4>What the real loader threw</h4>${well(a.error)}
<p class="status">${naming}</p></div>`;
}

export function renderAttempts(f) {
  const first = f.attempts[0].id;
  return `<p class="meta">${esc(f.attempts.length)} ways to get a pack wrong, each run for real against the loader. Pick one.</p>
<div class="chooser">${picks('pick-attempt', 'id', f.attempts.map((a) => [a.id, a.title]), first, 'Attempt to pick')}
<div data-panel="attempt">${renderAttemptPanel(f, first)}</div></div>
${provenance('Each attempt writes its files to a temp packages directory and calls the real <code>loadExtensions</code> (and, for connectors, <code>loadPackConnectors</code> + <code>mergeConnectors</code>); the build fails if an attempt does not fail or fails with a different message — <code>demo/capture/attempts.mjs</code>.')}`;
}

const TEST_DIRS = '<code>packages/toolkit-framework/test</code> and <code>packages/org-os-kms/test</code>';

export function renderVerified(f) {
  const v = f.verified;
  const suites = v.skipped
    ? note('Suites not run in this build. Rebuild without <code>--skip-suites</code> (<code>npm run demo</code>) to record the real pass counts here.')
    : rows(v.suites.map((s) => row({ t: esc(s.name), s: [`<b>${esc(s.tests)}</b> tests`, `<b>${esc(s.pass)}</b> pass`, `<b>${esc(s.fail)}</b> fail`, `<b>${esc(s.skipped)}</b> skipped`], end: s.fail === 0 ? mk('done', 'No failures') : mk('failed', `${s.fail} failing`) })));
  const onBase = v.commits.length === 0;
  const modified = v.testDirsModified || [];
  const diffCmd = `<code>git diff ${esc(v.base.slice(0, 7))}..HEAD --diff-filter=MDR</code>`;
  let tests;
  if (onBase) tests = `<p class="status">${mk('open', 'Built on the base branch')}<span>There is no branch diff to check: <code>${esc(v.head)}</code> is <code>${esc(v.base.slice(0, 7))}</code> itself.</span></p>`;
  else if (!modified.length) tests = `<p class="status">${mk('done', 'None changed')}<span>${diffCmd} over ${TEST_DIRS} printed nothing: the branch adds tests and changes none that existed on <code>main</code>.</span></p>`;
  else tests = `<p class="status">${mk('ok', 'Changed on purpose')}<span>${diffCmd} over ${TEST_DIRS} lists ${esc(plural(modified.length, 'pre-existing test file', 'pre-existing test files'))}. The branch changes these pre-existing tests on purpose; they are listed here, not hidden.</span></p>${wellList(modified)}`;
  const branch = onBase ? '' : `<h3>The branch — ${esc(v.commits.length)} commits over <code>${esc(v.base.slice(0, 7))}</code></h3>
<details class="more"><summary>The ${esc(v.commits.length)} commits, newest first</summary><ol class="commits">${v.commits.map((c) => { const i = c.indexOf(' '); return `<li><code>${esc(c.slice(0, i))}</code> ${esc(c.slice(i + 1))}</li>`; }).join('')}</ol></details>`;
  return `<h3>Test suites</h3>${suites}
<h3>Pre-existing tests</h3>
${tests}
${branch}
${provenance('Suite counts are parsed from each package’s real <code>node --test</code> run; the diff check and the commit list are read from git — <code>demo/capture/verified.mjs</code>. The build fails if any suite has a failing test; pre-existing test files the branch changed are listed, never hidden.')}`;
}

register({ id: 'attempts', order: 4, nav: 'Break it', title: 'Try to break it', lead: 'Every way of loading a pack wrong fails loudly, and says why.', render: renderAttempts });
register({ id: 'verified', order: 7, nav: 'Verified', title: 'Verified', lead: 'What was measured, not claimed.', render: renderVerified });

const share = (n) => esc(String(n));

export function renderUnitPanel(f, id) {
  const t = f.territory; const u = t.units.find((x) => x.unit_id === id); const q = t.query[id];
  const list = (a, empty) => (a.length ? `<ul class="plain">${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="meta">${esc(empty)}</p>`);
  const dl = (pairs) => `<div class="fields-box"><dl class="fields">${pairs.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
  return `<div class="panel"><h3>${esc(u.title)}</h3>
${dl([
    ['Unit', code(u.unit_id)],
    ['Layer · level', `${esc(u.layer)} · ${esc(u.level)}`],
    ...((u.codes || []).length ? [['Codes', codes(u.codes)]] : []),
    ['part_of chain', q.ancestors.length ? q.ancestors.map((a) => code(a)).join(' → ') : '<span class="meta">(top of its layer)</span>'],
    ['Children', q.children.length ? codes(q.children) : '<span class="meta">none</span>'],
  ])}
<h4><code>objectsIn(unit, …, { includeDescendants: false })</code></h4>${list(q.exact, 'nothing is placed directly in this unit')}
<h4><code>objectsIn(unit, …)</code> — includeDescendants defaults to true</h4>${list(q.withDescendants, 'nothing here or beneath')}
<h4 class="status">Overlaps with other layers ${mk('aged', 'Invented shares')}</h4>
${q.overlaps.length ? rows(q.overlaps.map((o) => row({ t: code(o.other), s: [`share of this unit <b>${share(o.shareSelf)}</b>`, `share of the other <b>${share(o.shareOther)}</b>`] }))) : '<p class="meta">no overlap recorded in the sample</p>'}</div>`;
}

export function renderOverlapPanel(f, id) {
  const o = f.territory.overlaps;
  const item = id === 'valid' ? { title: 'A valid sidecar', doc: o.valid.doc, errors: o.valid.result.errors, ok: o.valid.result.valid } : { ...o.faults.find((x) => x.id === id), ok: false };
  return `<div class="panel"><h3>${esc(item.title)}</h3>${well(JSON.stringify(item.doc, null, 2))}
<h4>What the real <code>validateOverlaps</code> returned</h4>${item.ok ? `<p class="status">${mk('done', 'Valid')}<span>no errors</span></p>` : `<ul class="well list">${item.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`}</div>`;
}

export function renderTerritory(f) {
  const t = f.territory; const first = 'administrative:comarca:osona';
  const layers = t.layers.map((layer) => `<div class="layer"><span class="eyebrow">${esc(layer)}</span>${t.units.filter((u) => u.layer === layer).map((u) => `<button type="button" class="unit" data-depth="${esc(t.query[u.unit_id].ancestors.length)}" data-action="pick-unit" data-id="${esc(u.unit_id)}" aria-pressed="${u.unit_id === first}">${esc(u.title)}<small>${esc(u.unit_id)}</small></button>`).join('')}</div>`).join('');
  return `${callout(esc(t.note))}
<div class="chooser wide"><div class="schematic surf" role="group" aria-label="Territorial units by layer (schematic, not a map)"><p class="meta">Schematic — <b>not a map</b>. Indentation is <code>part_of</code> depth. Pick a unit.</p>${layers}</div>
<div data-panel="unit">${renderUnitPanel(f, first)}</div></div>
<h3>Unknown references are reported, never thrown</h3>
<p>${t.unknownRefs.map((r) => `${code(r.resource)} points at ${code(r.ref)}, which is not in the tree`).join('; ')} — <code>unitsFor()</code> returns it under <code>unknown</code> and lets the instance decide whether that is an error.</p>
<h3>The overlaps sidecar has a validator</h3>
<p class="meta">Overlap shares are derived data in <code>data/territory-overlaps.json</code>, never published. The script that computes them from geometry comes in spec 2; this is the contract it must meet.</p>
<div class="chooser">${picks('pick-overlap', 'id', [['valid', 'A valid sidecar'], ...t.overlaps.faults.map((x) => [x.id, x.title])], 'valid', 'Overlaps document')}
<div data-panel="overlap">${renderOverlapPanel(f, 'valid')}</div></div>
${provenance('Every answer is precomputed by calling the real <code>indexUnits</code>, <code>unitsFor</code>, <code>objectsIn</code> and <code>validateOverlaps</code> for each unit and fault — <code>demo/capture/territory.mjs</code>. The sample is illustrative.')}`;
}

export function renderFederation(f) {
  const t = f.territory; const g = f.federation;
  const provTitle = Object.fromEntries(t.streams.providers.map((p) => [p.slug, p.title]));
  const yamlLines = g.extensionsYaml.split('\n').length;
  return `<h3>Data streams — what data exist for a place and a kind of work</h3>
<p class="meta">A ${code('source-system')} is the provider; a ${code('data-stream')} is one thing it offers. Licences are shown only where verified.</p>
${rows(t.streams.streams.map((s) => row({ t: esc(s.title), s: [esc(provTitle[s.source_system]), `access ${esc(s.access)}`, esc(s.format), `licence ${esc(s.licence)}`, `trust ${esc(s.trust)}`, codes(s.layer_refs)] })))}
<h3>What a peer sees</h3>
<div class="pair"><div class="surf"><span class="eyebrow">The published extensions.yaml</span>
<p class="status">${mk('done', 'federateCheck')}<span>${esc(g.federateCheck.compatible.length)} compatible, ${esc(g.federateCheck.incompatible.length)} incompatible — every entity maps to a real core type.</span></p>
<details class="more"><summary>extensions.yaml as published (${esc(yamlLines)} lines)</summary>${well(g.extensionsYaml)}</details></div>
<div class="surf"><span class="eyebrow">Collections a peer requests</span>
<p>With the pack: <b>${esc(g.peer.withPack.count)}</b> — the core ones plus ${codes(g.peer.withPack.extra)}.</p><p>Without it: <b>${esc(g.peer.without.count)}</b>. A peer that does not load the pack never asks for those two.</p>
<p>An inbound ${code('territorial-unit')} record, with the pack, keeps ${codes(g.inbound.withPack.keys)} — the peer’s private <code>notes</code> is dropped. Without the pack: ${esc(g.inbound.withoutPack.mapped)} mapped — the record is dropped.</p></div></div>
<p class="meta">Downgrading an unknown type to its core mapping on ingest is not built yet (spec 4).</p>
${provenance('<code>federateCheck</code> runs over the real published file; the collection counts come from a fake-PDS run of the real atproto connector with and without the pack loaded; the inbound record goes through the connector’s real <code>map</code> — <code>demo/capture/federation.mjs</code>.')}`;
}

register({ id: 'territory', order: 5, nav: 'Territory', title: 'The territory model', lead: 'Units on four layers, queried by place — over an illustrative sample.', render: renderTerritory });
register({ id: 'federation', order: 6, nav: 'Streams and federation', title: 'Data streams and federation', lead: 'What data exist for a place, and what a peer sees of an instance.', render: renderFederation });
