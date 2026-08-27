# Federation Map ("The Torch") Implementation Plan

> **Release status (2026-08-28):** Completed 2026-08-02 (spec status: implemented; QUEUE Completed) — checkboxes were never ticked; treat the spec + QUEUE as authoritative. Open follow-up (bundle-drift test) tracked in HEARTBEAT. Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive federation/provenance map — `<federation-map>` web component + `org-os-kms render map` data builder — embedded in the site's `/federation` page and home, with frontier discovery and a self-contained vault artifact.

**Architecture:** Strict view/data split. `packages/org-os-kms` grows a `map.mjs` builder (federation.yaml + kms peers + KB sources + ecosystems + frontier cache → `map.json`) and a `frontier.mjs` fetcher. New package `packages/org-os-federation-map` is a dumb custom element (d3-force only dep): hybrid orbital rings × force constellation × torchlight styling. Spec: `docs/superpowers/specs/2026-07-19-federation-map-design.md`.

**Tech Stack:** Node 22 `node --test`, plain ESM (no TypeScript in packages), `d3-force`, Astro 5 site, `esbuild` (devDep, P3 bundle only).

**Repo facts the engineer must know:**
- No npm workspaces. Packages resolve siblings by **relative path** (see `packages/org-os-kms/src/framework.mjs`). Each package has its own `node_modules` via `npm install` run inside it.
- kms CLI pattern: `src/cli.mjs` `dispatch(argv, {dry})`, hand-rolled `--flag value` parsing, verbs in a `VERBS` set, JSON to stdout.
- The org-os **root has no `kms.yaml`** — `render map` must tolerate that (spec §6 degradation).
- Site build: `site/package.json` `"aggregate"` runs `site/scripts/aggregate-federation.mjs` before `astro dev`/`astro build`. Site tests live in `site/test/` with fixtures.
- Pre-commit hook runs `npm run validate:structure` — new packages **must** be registered in `data/packages-matrix.yaml` with valid `promotion_status` + `lifecycle_status`.
- `Date.now()`/`new Date()` are fine here (this is app code, not a Workflow script).

**Planned deviation from spec §5 (flagged during planning):** KB objects currently live in YAML registries, not markdown notes — there are no "boundary notes" to stamp yet. Task 14 builds `renders/federation-portals.md` (a portal index linkable from Obsidian) instead of mutating notes. In-note stamping waits until a KB-note format exists.

**File structure (end state):**

```
packages/org-os-federation-map/
  package.json                 d3-force dep; esbuild devDep (P3)
  README.md
  src/hash.mjs                 fnv-1a → deterministic angle
  src/parse.mjs                normalizeMap(): validate/normalize map.json
  src/sim.mjs                  buildLayout(): d3-force, seeded, ring-pinned
  src/svg.mjs                  renderSVG(): pure string renderer
  src/element.mjs              <federation-map> custom element (interaction)
  src/index.mjs                define() + exports (bundle entry)
  demo/demo.html + demo/map.json
  dist/federation-map.iife.js  committed standalone bundle (P3)
  test/*.test.mjs
packages/org-os-kms/
  src/map.mjs                  buildMap() aggregation          (NEW)
  src/frontier.mjs             fetchFrontier() + cache         (NEW, P2)
  src/render-map-html.mjs      renderMapHtml() vault artifact  (NEW, P3)
  src/cli.mjs                  + `render map`, `federate frontier` verbs (MODIFY)
  test/map.test.mjs, frontier.test.mjs, render-map-html.test.mjs, fixtures/map/…
site/
  astro.config.mjs             + vite fs.allow                 (MODIFY)
  scripts/aggregate-federation.mjs  + map.json emission        (MODIFY)
  src/components/FederationMapIsland.astro                     (NEW)
  src/pages/federation.astro, index.astro  swap graph          (MODIFY)
  src/components/FederationGraph.astro                         (DELETE, task 8)
  test/map.test.mjs                                            (NEW)
data/ecosystems.yaml                                           (NEW, P2)
data/packages-matrix.yaml    + org-os-federation-map entry     (MODIFY)
```

---

## Phase 1 — the map exists

### Task 1: Scaffold `org-os-federation-map` + register in packages-matrix

**Files:**
- Create: `packages/org-os-federation-map/package.json`
- Create: `packages/org-os-federation-map/README.md`
- Modify: `data/packages-matrix.yaml` (append entry)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@org-os/federation-map",
  "version": "0.1.0",
  "description": "org-os federation map — 'the torch'. Framework-agnostic <federation-map> custom element rendering an instance's external world (federated instances, frontier, sources/provenance, ecosystems) as an interactive orbital-constellation with torchlight styling. Consumes map.json produced by @org-os/kms `render map`; never reads YAML itself.",
  "type": "module",
  "main": "src/index.mjs",
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "d3-force": "^3.0.0"
  },
  "license": "MIT",
  "keywords": ["org-os", "federation", "graph", "provenance", "web-component", "d3-force"]
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# @org-os/federation-map — "the torch"

Interactive map of an instance's *external* world: federated instances (ring 1),
frontier peers-of-peers (ring 2, embers), sources/ecosystems (ring 3). The
deliberate counterpart to the internal note graph — two linked views.

Design spec: `../../docs/superpowers/specs/2026-07-19-federation-map-design.md`.

## Use

```html
<script type="module">import "@org-os/federation-map";</script>
<federation-map src="/map.json"></federation-map>          <!-- fetch -->
<federation-map mode="mini"><script type="application/json">{…}</script></federation-map>  <!-- inline -->
```

Data plane: `org-os-kms render map` produces `map.json`. This package is
view-only — data in, pixels out. Theme via CSS custom properties
(`--fedmap-bg`, `--fedmap-self`, `--fedmap-instance`, `--fedmap-source`,
`--fedmap-ember`, `--fedmap-text`).
```

- [ ] **Step 3: Install deps**

Run: `cd "packages/org-os-federation-map" && npm install`
Expected: `node_modules/d3-force` exists; `package-lock.json` created.

- [ ] **Step 4: Register in packages-matrix** — append to `data/packages-matrix.yaml` after the `org-os-kms` entry:

```yaml
  - id: "org-os-federation-map"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "canonical"
    lifecycle_status: "active"
    notes: "@org-os/federation-map — 'the torch'. View-plane web component for the federation/provenance map (d3-force only dep). Data plane is org-os-kms `render map`. Spec: docs/superpowers/specs/2026-07-19-federation-map-design.md."
```

- [ ] **Step 5: Validate + commit**

Run: `npm run validate:structure` (from org-os root)
Expected: `packages-matrix: all 23 entries have valid lifecycle_status` (count goes 22→23), 0 failed.

```bash
git add packages/org-os-federation-map data/packages-matrix.yaml
git commit -m "feat(federation-map): scaffold @org-os/federation-map package + matrix registration"
```

---

### Task 2: `parse.mjs` — normalize map.json (TDD)

**Files:**
- Create: `packages/org-os-federation-map/src/parse.mjs`
- Test: `packages/org-os-federation-map/test/parse.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap } from '../src/parse.mjs';

const GOOD = {
  version: '1',
  self: { id: 'org-os', name: 'org-os', type: 'Project' },
  nodes: [
    { id: 'refi-bcn-os', kind: 'instance', ring: 1 },
    { id: 'koi-network', kind: 'source', ring: 3 },
  ],
  edges: [
    { from: 'org-os', to: 'refi-bcn-os', kind: 'downstream' },
    { from: 'ghost', to: 'refi-bcn-os', kind: 'federation' }, // dangling
  ],
};

test('valid map: ok, nodes kept, dangling edges dropped', () => {
  const m = normalizeMap(GOOD);
  assert.equal(m.ok, true);
  assert.equal(m.nodes.length, 2);
  assert.equal(m.edges.length, 1, 'edge referencing unknown "ghost" is dropped');
});

test('nodes missing id or kind are dropped', () => {
  const m = normalizeMap({ ...GOOD, nodes: [...GOOD.nodes, { name: 'nameless' }, { id: 'x' }] });
  assert.equal(m.nodes.length, 2);
});

test('empty/invalid input → ok:false, empty collections (quiet empty-state)', () => {
  for (const bad of [null, undefined, 42, 'nope', {}, { self: null, nodes: [] }, { self: { id: 'a' } }]) {
    const m = normalizeMap(bad);
    assert.equal(m.ok, false);
    assert.deepEqual(m.nodes, []);
    assert.deepEqual(m.edges, []);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd "packages/org-os-federation-map" && node --test test/parse.test.mjs`
Expected: FAIL — `Cannot find module '../src/parse.mjs'`.

- [ ] **Step 3: Implement**

```js
// src/parse.mjs
// Validate + normalize a map.json payload (spec §3). Never throws: bad input →
// { ok:false } so the element can render a quiet empty-state (spec §6).
const EMPTY = Object.freeze({ ok: false, self: null, nodes: [], edges: [] });

export function normalizeMap(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  if (!raw.self || typeof raw.self !== 'object' || !raw.self.id) return { ...EMPTY };
  if (!Array.isArray(raw.nodes)) return { ...EMPTY };
  const nodes = raw.nodes.filter((n) => n && typeof n === 'object' && n.id && n.kind);
  const ids = new Set([raw.self.id, ...nodes.map((n) => n.id)]);
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e) => e && ids.has(e.from) && ids.has(e.to));
  return { ok: true, self: raw.self, nodes, edges };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/parse.test.mjs` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-federation-map/src/parse.mjs packages/org-os-federation-map/test/parse.test.mjs
git commit -m "feat(federation-map): normalizeMap — tolerant map.json validation"
```

---

### Task 3: `hash.mjs` + `sim.mjs` — deterministic ring-pinned force layout (TDD)

**Files:**
- Create: `packages/org-os-federation-map/src/hash.mjs`
- Create: `packages/org-os-federation-map/src/sim.mjs`
- Test: `packages/org-os-federation-map/test/sim.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/sim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashAngle } from '../src/hash.mjs';
import { buildLayout, RING_RADIUS } from '../src/sim.mjs';
import { normalizeMap } from '../src/parse.mjs';

const MAP = normalizeMap({
  self: { id: 'org-os', name: 'org-os' },
  nodes: [
    { id: 'peer-a', kind: 'instance', ring: 1 },
    { id: 'peer-b', kind: 'instance', ring: 1 },
    { id: 'far-x', kind: 'frontier', ring: 2 },
    { id: 'src-y', kind: 'source', ring: 3 },
  ],
  edges: [
    { from: 'org-os', to: 'peer-a', kind: 'downstream' },
    { from: 'peer-a', to: 'far-x', kind: 'frontier' },
    { from: 'src-y', to: 'org-os', kind: 'provenance' },
  ],
});

test('hashAngle is deterministic and spread over [0, 2π)', () => {
  assert.equal(hashAngle('refi-bcn-os'), hashAngle('refi-bcn-os'));
  assert.notEqual(hashAngle('a'), hashAngle('b'));
  for (const id of ['a', 'b', 'refi-bcn-os']) {
    const v = hashAngle(id);
    assert.ok(v >= 0 && v < Math.PI * 2);
  }
});

test('buildLayout: self pinned center, others near their ring radius', () => {
  const { nodes, width, height } = buildLayout(MAP, { width: 800, height: 600 });
  const cx = width / 2, cy = height / 2, unit = Math.min(width, height);
  const self = nodes.find((n) => n.id === 'org-os');
  assert.equal(self.x, cx); assert.equal(self.y, cy);
  const peer = nodes.find((n) => n.id === 'peer-a');
  const r = Math.hypot(peer.x - cx, peer.y - cy);
  const target = RING_RADIUS[1] * unit;
  assert.ok(Math.abs(r - target) < target * 0.35, `ring-1 node settles near its radius (${r} vs ${target})`);
});

test('buildLayout is deterministic: same data → same positions', () => {
  const a = buildLayout(MAP, { width: 800, height: 600 }).nodes.map((n) => [n.id, n.x, n.y]);
  const b = buildLayout(MAP, { width: 800, height: 600 }).nodes.map((n) => [n.id, n.x, n.y]);
  assert.deepEqual(a, b);
});

test('buildLayout returns links resolved to node objects', () => {
  const { links } = buildLayout(MAP, { width: 800, height: 600 });
  assert.equal(links.length, 3);
  assert.equal(typeof links[0].source, 'object', 'd3-force resolves ids to node refs');
  assert.equal(links[0].kind, 'downstream');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/sim.test.mjs` → FAIL (modules missing).

- [ ] **Step 3: Implement `hash.mjs`**

```js
// src/hash.mjs
// FNV-1a → stable initial angle per node id. Deterministic start = same data,
// same map (spec §4) — the layout breathes on settle but never reshuffles.
export function hashAngle(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h / 0x100000000) * Math.PI * 2;
}
```

- [ ] **Step 4: Implement `sim.mjs`**

```js
// src/sim.mjs
// Hybrid layout (spec §4): forceRadial pins rings (orbital), link/charge forces
// settle nodes within them (constellation). Seeded randomSource + hashed initial
// angles keep it deterministic. Pure module — no DOM; testable under node.
import { forceSimulation, forceLink, forceManyBody, forceRadial, forceCollide } from 'd3-force';
import { hashAngle } from './hash.mjs';

export const RING_RADIUS = { 1: 0.28, 2: 0.42, 3: 0.55 }; // fraction of min(width,height)
const NODE_R = { self: 11, instance: 7, frontier: 4, source: 5, ecosystem: 6 };

export function nodeRadius(n) { return NODE_R[n.kind] ?? 5; }

function seededRandom() {
  let s = 0x2f6e2b1; // fixed seed — determinism over novelty
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function buildLayout(map, { width = 900, height = 640, ticks = 220 } = {}) {
  const cx = width / 2, cy = height / 2, unit = Math.min(width, height);
  const ringR = (n) => (RING_RADIUS[n.ring] ?? RING_RADIUS[3]) * unit;
  const nodes = [
    { ...map.self, kind: 'self', ring: 0, x: cx, y: cy, fx: cx, fy: cy },
    ...map.nodes.map((n) => {
      const r = ringR(n), a = hashAngle(n.id);
      return { ...n, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    }),
  ];
  const links = map.edges.map((e) => ({ source: e.from, target: e.to, kind: e.kind }));
  const sim = forceSimulation()
    .randomSource(seededRandom())
    .nodes(nodes)
    .force('link', forceLink(links).id((d) => d.id).strength(0.06).distance(40))
    .force('charge', forceManyBody().strength(-42))
    .force('radial', forceRadial((d) => (d.ring === 0 ? 0 : ringR(d)), cx, cy).strength(0.85))
    .force('collide', forceCollide((d) => nodeRadius(d) + 9))
    .stop();
  sim.tick(ticks);
  return { nodes, links, sim, width, height, cx, cy, unit };
}
```

- [ ] **Step 5: Run to verify pass** — `node --test test/sim.test.mjs` → all PASS. If the ring-distance assertion is marginally off, loosen the force constants (`charge` toward −30), not the test tolerance.

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-federation-map/src/hash.mjs packages/org-os-federation-map/src/sim.mjs packages/org-os-federation-map/test/sim.test.mjs
git commit -m "feat(federation-map): deterministic ring-pinned force layout (hash + sim)"
```

---

### Task 4: `svg.mjs` — pure-string SVG renderer with torchlight classes (TDD)

**Files:**
- Create: `packages/org-os-federation-map/src/svg.mjs`
- Test: `packages/org-os-federation-map/test/svg.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap } from '../src/parse.mjs';
import { buildLayout } from '../src/sim.mjs';
import { renderSVG } from '../src/svg.mjs';

const MAP = normalizeMap({
  self: { id: 'org-os', name: 'org-os' },
  nodes: [
    { id: 'peer-a', kind: 'instance', ring: 1, name: 'Peer A', live: true },
    { id: 'far-x', kind: 'frontier', ring: 2, name: 'Far X' },
    { id: 'src-y', kind: 'source', ring: 3, name: 'Src Y' },
  ],
  edges: [
    { from: 'org-os', to: 'peer-a', kind: 'downstream' },
    { from: 'peer-a', to: 'far-x', kind: 'frontier' },
  ],
});
const layout = buildLayout(MAP, { width: 800, height: 600 });

test('renders one <g class="node …"> per node incl. self, with data-id', () => {
  const svg = renderSVG(layout);
  assert.equal((svg.match(/class="node /g) || []).length, 4);
  for (const id of ['org-os', 'peer-a', 'far-x', 'src-y']) assert.ok(svg.includes(`data-id="${id}"`));
});

test('kind + ring classes drive torchlight falloff; frontier is an ember', () => {
  const svg = renderSVG(layout);
  assert.ok(svg.includes('node frontier ring-2'));
  assert.ok(svg.includes('node self ring-0'));
  assert.ok(svg.includes('class="torch-gradient"') || svg.includes('id="torch"'), 'torch radial gradient present');
});

test('renders one edge line per link with kind class + endpoint ids', () => {
  const svg = renderSVG(layout);
  assert.equal((svg.match(/class="edge /g) || []).length, 2);
  assert.ok(svg.includes('data-from="peer-a" data-to="far-x"'));
});

test('accessibility: role=img + label; escapes node names', () => {
  const m = normalizeMap({ self: { id: 's', name: 'a<b&"c"' }, nodes: [], edges: [] });
  const svg = renderSVG(buildLayout(m, { width: 100, height: 100 }));
  assert.ok(svg.includes('role="img"'));
  assert.ok(!svg.includes('a<b&"c"'), 'raw specials never emitted');
  assert.ok(svg.includes('a&lt;b&amp;&quot;c&quot;'));
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/svg.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run to verify pass** — `node --test test/svg.test.mjs` → all PASS. (Note the escape test asserts on `esc` output of `"` as `&quot;`; `'` is left alone — fine inside double-quoted attributes we control.)

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-federation-map/src/svg.mjs packages/org-os-federation-map/test/svg.test.mjs
git commit -m "feat(federation-map): pure-string SVG renderer with torchlight classes"
```

---

### Task 5: `element.mjs` + `index.mjs` — the custom element (interaction layer)

**Files:**
- Create: `packages/org-os-federation-map/src/element.mjs`
- Create: `packages/org-os-federation-map/src/index.mjs`
- Test: `packages/org-os-federation-map/test/element.test.mjs`
- Create: `packages/org-os-federation-map/demo/demo.html`, `packages/org-os-federation-map/demo/map.json`

The element has real DOM behavior we do NOT jsdom-test (visual/manual check in Step 6 + site smoke in Task 8). The node test asserts the module imports cleanly headless and exposes the right surface — this catches accidental top-level DOM references.

- [ ] **Step 1: Write the failing test**

```js
// test/element.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('element module imports cleanly in node (no top-level DOM access)', async () => {
  const mod = await import('../src/element.mjs');
  assert.equal(typeof mod.FederationMap, 'function');
  assert.equal(typeof mod.define, 'function');
  assert.doesNotThrow(() => mod.define()); // no customElements in node → silent no-op
});

test('index.mjs re-exports the full surface', async () => {
  const mod = await import('../src/index.mjs');
  for (const k of ['FederationMap', 'define', 'normalizeMap', 'buildLayout', 'renderSVG']) {
    assert.ok(k in mod, `missing export: ${k}`);
  }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/element.test.mjs` → FAIL.

- [ ] **Step 3: Implement `element.mjs`** (complete file):

```js
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
```

- [ ] **Step 4: Implement `index.mjs`** (bundle entry — defines on import):

```js
// src/index.mjs
export { FederationMap, define } from './element.mjs';
export { normalizeMap } from './parse.mjs';
export { buildLayout, RING_RADIUS, nodeRadius } from './sim.mjs';
export { renderSVG, esc } from './svg.mjs';
import { define } from './element.mjs';
define();
```

- [ ] **Step 5: Run all package tests** — `node --test` → parse, sim, svg, element all PASS.

- [ ] **Step 6: Demo for manual visual check.** Create `demo/map.json`:

```json
{
  "version": "1",
  "generated_at": "2026-07-19T00:00:00Z",
  "self": { "id": "org-os", "name": "org-os", "type": "Project", "emoji": "🧬" },
  "nodes": [
    { "id": "refi-bcn-os", "kind": "instance", "name": "ReFi Barcelona", "type": "LocalNode", "ring": 1, "trust": "full", "live": true, "url": "https://github.com/luizfernandosg/refi-bcn-os", "counts": { "members": 3, "projects": 26 } },
    { "id": "refi-dao-os", "kind": "instance", "name": "ReFi DAO", "type": "DAO", "ring": 1, "trust": "full", "live": true, "counts": { "projects": 12 } },
    { "id": "regen-coordination-os", "kind": "instance", "name": "Regen Coordination", "type": "Hub", "ring": 1, "trust": "full", "live": false },
    { "id": "refi-lisboa", "kind": "frontier", "name": "ReFi Lisboa", "ring": 2 },
    { "id": "refi-medellin", "kind": "frontier", "name": "ReFi Medellín", "ring": 2 },
    { "id": "celo-eco", "kind": "frontier", "name": "Celo Ecosystem", "ring": 2 },
    { "id": "koi-network", "kind": "source", "name": "KOI Network", "ring": 3, "ecosystem": "regen-commons", "counts": { "objects": 14 } },
    { "id": "regen-registry", "kind": "source", "name": "Regen Registry", "ring": 3, "ecosystem": "regen-commons" },
    { "id": "regen-commons", "kind": "ecosystem", "name": "Regen Commons", "ring": 3, "url": "https://example.org" }
  ],
  "edges": [
    { "from": "org-os", "to": "refi-bcn-os", "kind": "downstream" },
    { "from": "org-os", "to": "refi-dao-os", "kind": "downstream" },
    { "from": "org-os", "to": "regen-coordination-os", "kind": "downstream" },
    { "from": "refi-dao-os", "to": "refi-lisboa", "kind": "frontier" },
    { "from": "refi-dao-os", "to": "refi-medellin", "kind": "frontier" },
    { "from": "refi-bcn-os", "to": "celo-eco", "kind": "frontier" },
    { "from": "koi-network", "to": "org-os", "kind": "provenance" },
    { "from": "regen-registry", "to": "org-os", "kind": "provenance" },
    { "from": "regen-commons", "to": "koi-network", "kind": "provenance" },
    { "from": "regen-commons", "to": "regen-registry", "kind": "provenance" }
  ]
}
```

Create `demo/demo.html`:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>federation-map demo</title>
<style>body{background:#06080c;margin:0;padding:24px;max-width:960px;margin-inline:auto}</style>
</head><body>
<federation-map src="./map.json"></federation-map>
<script type="module">import "../src/index.mjs";</script>
</body></html>
```

Run: `cd "packages/org-os-federation-map" && npx serve demo` (or any static server; a server is required — `import "../src/index.mjs"` uses a bare `d3-force` specifier, so instead run `npx vite demo` which resolves it from `node_modules`).
Expected (manual): rings + torch gradient visible; hover lights neighborhoods; click opens panel; frontier nodes pulse; drag works; `#node=refi-bcn-os` in URL lights that node.

- [ ] **Step 7: Commit**

```bash
git add packages/org-os-federation-map/src packages/org-os-federation-map/test/element.test.mjs packages/org-os-federation-map/demo
git commit -m "feat(federation-map): <federation-map> custom element — torch interaction layer + demo"
```

---

### Task 6: kms `map.mjs` — buildMap aggregation (TDD)

**Files:**
- Create: `packages/org-os-kms/src/map.mjs`
- Test: `packages/org-os-kms/test/map.test.mjs`
- Create fixtures: `packages/org-os-kms/test/fixtures/map/full/…` and `packages/org-os-kms/test/fixtures/map/bare/…`

- [ ] **Step 1: Create fixtures.** `test/fixtures/map/bare/federation.yaml` (minimal instance — degradation case):

```yaml
identity:
  name: "bare-os"
  type: "Project"
peers: []
downstream:
  - name: "Peer One"
    id: "peer-one"
    repo: "example/peer-one"
    url: "https://github.com/example/peer-one"
    type: "LocalNode"
    trust: "full"
    local_path: "../peer-one"
```

`test/fixtures/map/full/federation.yaml`:

```yaml
identity:
  name: "full-os"
  type: "Hub"
  emoji: "🔦"
peers:
  - name: "Sibling"
    id: "sibling-os"
    repo: "example/sibling-os"
    url: "https://github.com/example/sibling-os"
    type: "DAO"
    trust: "full"
downstream:
  - name: "Child"
    id: "child-os"
    repo: "example/child-os"
    url: "https://github.com/example/child-os"
    type: "LocalNode"
    trust: "full"
    local_path: "siblings/child-os"
```

`test/fixtures/map/full/kms.yaml`:

```yaml
name: full-os
adapter: repo-data
target: "."
peers:
  knowledge-peer: "data/kb/cards/knowledge-peer.yaml"
```

`test/fixtures/map/full/data/source-systems.yaml`:

```yaml
- id: koi-network
  title: KOI Network
  url: https://example.org/koi
- id: regen-registry
  title: Regen Registry
```

`test/fixtures/map/full/data/kb/index.json`:

```json
{ "total": 14, "by_type": { "resource": 9, "concept": 5 }, "review_queue": [] }
```

`test/fixtures/map/full/siblings/child-os/.well-known/members.json`:

```json
{ "members": [{ "id": "a" }, { "id": "b" }, { "id": "c" }] }
```

`test/fixtures/map/full/siblings/child-os/.well-known/projects.json`:

```json
{ "projects": [{ "id": "p1" }, { "id": "p2" }] }
```

- [ ] **Step 2: Write the failing tests**

```js
// test/map.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap } from '../src/map.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map');
const NOW = '2026-07-19T12:00:00Z';

test('bare instance: federation.yaml alone is enough (spec §6)', () => {
  const m = buildMap({ dir: join(FIX, 'bare'), now: NOW });
  assert.equal(m.version, '1');
  assert.equal(m.self.id, 'bare-os');
  assert.deepEqual(m.nodes.map((n) => n.id), ['peer-one']);
  const peer = m.nodes[0];
  assert.equal(peer.kind, 'instance');
  assert.equal(peer.ring, 1);
  assert.equal(peer.live, false, 'local_path missing on disk → unreached');
  assert.deepEqual(m.edges, [{ from: 'bare-os', to: 'peer-one', kind: 'downstream' }]);
});

test('full instance: peers + downstream + kms knowledge peers + sources', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const ids = m.nodes.map((n) => n.id);
  assert.ok(ids.includes('sibling-os'), 'federation peer');
  assert.ok(ids.includes('child-os'), 'downstream');
  assert.ok(ids.includes('knowledge-peer'), 'kms.yaml peer');
  assert.ok(ids.includes('koi-network') && ids.includes('regen-registry'), 'source-systems');
  const kinds = Object.fromEntries(m.nodes.map((n) => [n.id, n.kind]));
  assert.equal(kinds['koi-network'], 'source');
  assert.ok(m.edges.some((e) => e.kind === 'federation' && e.to === 'sibling-os'));
  assert.ok(m.edges.some((e) => e.kind === 'knowledge' && e.to === 'knowledge-peer'));
  assert.ok(m.edges.some((e) => e.kind === 'provenance' && e.from === 'koi-network' && e.to === 'full-os'));
});

test('live enrichment: cloned sibling → live:true + counts from .well-known', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const child = m.nodes.find((n) => n.id === 'child-os');
  assert.equal(child.live, true);
  assert.equal(child.counts.members, 3);
  assert.equal(child.counts.projects, 2);
  assert.equal(child.last_seen, NOW);
});

test('sources carry object counts from the KB index when present', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const src = m.nodes.find((n) => n.id === 'koi-network');
  assert.equal(src.ring, 3);
  assert.equal(src.counts.objects, 14, 'total objects surfaced on sources (per-source split needs richer index — total for now)');
});

test('no federation.yaml → throws with a clear message', () => {
  assert.throws(() => buildMap({ dir: join(FIX, 'nowhere') }), /no federation\.yaml/);
});

test('duplicate ids across sections keep one node, both edges', () => {
  // sibling listed as peer AND (hypothetically) downstream must not duplicate the node
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  assert.equal(m.nodes.filter((n) => n.id === 'sibling-os').length, 1);
});
```

- [ ] **Step 3: Run to verify failure** — `cd "packages/org-os-kms" && node --test test/map.test.mjs` → FAIL.

- [ ] **Step 4: Implement `src/map.mjs`**

```js
// src/map.mjs
// buildMap() — the map.json aggregation (spec §3). Tolerant of every input except
// federation.yaml itself; degradation table in spec §6. Pure filesystem reads, no
// network — frontier data comes pre-fetched from data/federation/frontier/ (P2).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

function readYaml(p) { try { return yaml.load(readFileSync(p, 'utf8')); } catch { return null; } }
function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function firstArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x).find(Array.isArray) || [];
  return [];
}

export function buildMap({ dir = '.', surface = 'web', now = new Date().toISOString() } = {}) {
  const fed = readYaml(join(dir, 'federation.yaml'));
  if (!fed || !fed.identity || !fed.identity.name) throw new Error(`no federation.yaml with identity in: ${dir}`);
  const self = {
    id: fed.identity.name, name: fed.identity.name, type: fed.identity.type || null,
    emoji: fed.identity.emoji || null, url: fed.hub || null,
  };
  const nodes = [], edges = [], seen = new Map(); // id → node
  const edgeKeys = new Set();
  const addEdge = (from, to, kind) => {
    const k = `${from}→${to}:${kind}`;
    if (!edgeKeys.has(k)) { edgeKeys.add(k); edges.push({ from, to, kind }); }
  };
  const addNode = (n) => { if (!seen.has(n.id)) { seen.set(n.id, n); nodes.push(n); } return seen.get(n.id); };

  // ── ring 1: instances from federation.yaml ──────────────────────────────────
  const instance = (entry, edgeKind) => {
    const id = entry.id || entry.name;
    if (!id || id === self.id) return;
    const localAbs = entry.local_path ? join(dir, entry.local_path) : null;
    const live = !!(localAbs && existsSync(localAbs));
    const counts = {};
    if (live) {
      const members = readJson(join(localAbs, '.well-known', 'members.json'));
      if (Array.isArray(members?.members)) counts.members = members.members.length;
      const projects = readJson(join(localAbs, '.well-known', 'projects.json'));
      if (Array.isArray(projects?.projects)) counts.projects = projects.projects.length;
    }
    addNode({
      id, kind: 'instance', name: entry.name || id, type: entry.type || null, ring: 1,
      trust: entry.trust || null, live, url: entry.url || null, repo: entry.repo || null,
      counts, last_seen: live ? now : null,
    });
    addEdge(self.id, id, edgeKind);
  };
  for (const p of fed.peers || []) instance(p, 'federation');
  for (const u of fed.upstream || []) instance(u, 'upstream');
  for (const d of fed.downstream || []) instance(d, 'downstream');

  // ── ring 1: knowledge peers from kms.yaml (optional) ────────────────────────
  const kms = readYaml(join(dir, 'kms.yaml'));
  for (const slug of Object.keys(kms?.peers || {})) {
    addNode({ id: slug, kind: 'instance', name: slug, type: null, ring: 1, trust: null,
      live: false, url: null, repo: null, counts: {}, last_seen: null });
    addEdge(self.id, slug, 'knowledge');
  }

  // ── ring 3: sources from data/source-systems.yaml + KB index (optional) ─────
  const kb = readJson(join(dir, 'data', 'kb', 'index.json'));
  for (const s of firstArray(readYaml(join(dir, 'data', 'source-systems.yaml')))) {
    const id = s.id || s.title;
    if (!id) continue;
    const counts = {};
    if (kb && typeof kb.total === 'number') counts.objects = kb.total;
    addNode({ id, kind: 'source', name: s.title || id, type: null, ring: 3,
      ecosystem: s.ecosystem || null, url: s.url || null, counts,
      portal: (surface === 'vault' ? s.portal_vault : s.portal_web) || null });
    addEdge(id, self.id, 'provenance');
  }

  // ── ring 3: curated ecosystems (optional; P2 populates data/ecosystems.yaml) ─
  const eco = readYaml(join(dir, 'data', 'ecosystems.yaml'));
  for (const e of eco?.ecosystems || []) {
    if (!e.id) continue;
    addNode({ id: e.id, kind: 'ecosystem', name: e.name || e.id, type: null, ring: 3,
      url: e.url || null, counts: {} });
    for (const sid of e.sources || []) {
      if (seen.has(sid)) { seen.get(sid).ecosystem = e.id; addEdge(e.id, sid, 'provenance'); }
    }
  }

  // ── ring 2: frontier from cached snapshots (optional; written by P2 op) ─────
  const frontierDir = join(dir, 'data', 'federation', 'frontier');
  if (existsSync(frontierDir)) {
    for (const f of readdirSync(frontierDir).filter((f) => f.endsWith('.json'))) {
      const owner = f.replace(/\.json$/, '');
      if (!seen.has(owner)) continue; // snapshot for a peer we no longer list
      const snap = readJson(join(frontierDir, f));
      for (const p of snap?.peers || []) {
        const pid = p.id || p.name;
        if (!pid || pid === self.id) continue;
        if (!seen.has(pid)) {
          addNode({ id: pid, kind: 'frontier', name: p.name || pid, type: p.type || null,
            ring: 2, live: false, url: p.url || null, repo: p.repo || null, counts: {} });
        }
        addEdge(owner, pid, 'frontier'); // ring-1 dup → edge retargets existing node (spec §3 dedup)
      }
    }
  }

  return { version: '1', generated_at: now, self, nodes, edges };
}
```

- [ ] **Step 5: Run to verify pass** — `node --test test/map.test.mjs` → all PASS.

- [ ] **Step 6: Run the whole kms suite** — `node --test` → all pre-existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/org-os-kms/src/map.mjs packages/org-os-kms/test/map.test.mjs packages/org-os-kms/test/fixtures/map
git commit -m "feat(kms): buildMap — federation/provenance map.json aggregation"
```

---

### Task 7: kms CLI — `render map` verb (TDD)

**Files:**
- Modify: `packages/org-os-kms/src/cli.mjs`
- Test: `packages/org-os-kms/test/cli.test.mjs` (append)

- [ ] **Step 1: Append failing tests to `test/cli.test.mjs`**

```js
// — render map (federation map builder) —
import { mkdtempSync, writeFileSync as wf, readFileSync as rf, mkdirSync as mkd } from 'node:fs';
import { tmpdir } from 'node:os';

test('dispatch dry-routes render map', () => {
  const r = dispatch(['render', 'map', '--out', 'x.json'], { dry: true });
  assert.deepEqual(r, { verb: 'render', args: ['map'], flags: { out: 'x.json' } });
});

test('render map builds map.json from federation.yaml (no kms.yaml needed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-map-'));
  wf(join(dir, 'federation.yaml'), 'identity:\n  name: tmp-os\n  type: Project\ndownstream:\n  - id: kid\n    name: Kid\n');
  const r = dispatch(['render', 'map', '--dir', dir, '--out', 'out/map.json']);
  assert.equal(r.ok, true);
  const written = JSON.parse(rf(join(dir, 'out', 'map.json'), 'utf8'));
  assert.equal(written.self.id, 'tmp-os');
  assert.equal(written.nodes.length, 1);
});
```

(Adjust imports at the top of the file to whatever it already imports — it already imports `dispatch`, `test`, `assert`, `join`; add the fs/os imports above.)

- [ ] **Step 2: Run to verify failure** — `node --test test/cli.test.mjs` → the two new tests FAIL (`render map` currently falls through to the dashboard branch and throws on `loadKmsConfig`).

- [ ] **Step 3: Implement.** In `src/cli.mjs`:

Add imports:

```js
import { buildMap } from './map.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname as pathDirname } from 'node:path';
```

Replace the `case 'render': { … }` block with:

```js
    case 'render': {
      if (args[0] === 'map') {
        // No loadKmsConfig here — the map degrades gracefully without kms.yaml (spec §6).
        const map = buildMap({ dir, surface: flags.surface || 'web' });
        const out = join(dir, flags.out || 'data/kb/map.json');
        mkdirSync(pathDirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify(map, null, 2));
        return { ok: true, report: { wrote: out, nodes: map.nodes.length, edges: map.edges.length } };
      }
      const cfg = loadKmsConfig(dir);
      if (args[0] === 'site') return renderSiteData({ dir, target: cfg.target, outPath: (cfg.render && cfg.render.site_data) || 'src/data/kms-index.json' });
      const a = fw.getAdapter(cfg.adapter);
      return { section: renderDashboardSection(a.index(join(dir, cfg.target))) };
    }
```

- [ ] **Step 4: Run to verify pass** — `node --test test/cli.test.mjs` → all PASS. Then `node --test` → full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src/cli.mjs packages/org-os-kms/test/cli.test.mjs
git commit -m "feat(kms): render map CLI verb — writes map.json, tolerates missing kms.yaml"
```

---

### Task 8: Site integration — emit map.json, embed the island, swap both pages

**Files:**
- Modify: `site/scripts/aggregate-federation.mjs`
- Modify: `site/astro.config.mjs`
- Create: `site/src/components/FederationMapIsland.astro`
- Modify: `site/src/pages/federation.astro`, `site/src/pages/index.astro`
- Delete: `site/src/components/FederationGraph.astro`
- Test: `site/test/map.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// site/test/map.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildMap } from "../../packages/org-os-kms/src/map.mjs";

const orgOsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("buildMap runs against the real org-os root (siblings may be absent)", () => {
  const map = buildMap({ dir: orgOsRoot, now: "2026-07-19T00:00:00Z" });
  assert.equal(map.self.id, "org-os");
  assert.ok(map.nodes.length >= 2, "at least the federation.yaml peers/downstream render");
  assert.ok(map.nodes.every((n) => n.id && n.kind && typeof n.ring === "number"));
});
```

Run: `cd site && node --test test/map.test.mjs` → should PASS immediately (buildMap exists since Task 6) — this is an integration guard, not strict TDD; verify it does pass, which also proves the relative import path is right.

- [ ] **Step 2: Emit map.json in the aggregate script.** In `site/scripts/aggregate-federation.mjs`, add after the `federation.json` write:

```js
// Federation map (spec: docs/superpowers/specs/2026-07-19-federation-map-design.md).
// kms owns aggregation; the site just asks for the web-surface map and serves it.
import { buildMap } from "../../packages/org-os-kms/src/map.mjs";
```

(put the import at the top with the others), and after the `console.log(\`federation.json: …\`)` line:

```js
const map = buildMap({ dir: orgOsRoot, surface: "web", now: new Date().toISOString() });
const mapJson = JSON.stringify(map, null, 2);
writeFileSync(join(outDir, "map.json"), mapJson);
mkdirSync(join(siteRoot, "public"), { recursive: true });
writeFileSync(join(siteRoot, "public", "map.json"), mapJson);   // fetched at runtime by <federation-map src="/map.json">
console.log(`map.json: ${map.nodes.length} nodes, ${map.edges.length} edges`);
```

Run: `cd site && npm run aggregate`
Expected: `map.json: N nodes, M edges` printed; `site/public/map.json` and `site/src/data/map.json` exist.

- [ ] **Step 3: Let Vite reach `packages/`.** In `site/astro.config.mjs`:

```js
export default defineConfig({
  site: "https://org-os.dev",
  output: "static",
  build: { format: "directory" },
  vite: { server: { fs: { allow: [".."] } } },  // dev server may import ../packages/*
});
```

- [ ] **Step 4: Create `site/src/components/FederationMapIsland.astro`**

```astro
---
// Thin Astro wrapper around the framework-agnostic element (spec §1: "B's ergonomics,
// zero lock-in"). mode="mini" renders the sparse home-page variant wrapped in a link.
interface Props { mode?: "full" | "mini" }
const { mode = "full" } = Astro.props;
---
{mode === "mini" ? (
  <a href="/federation" class="mini-wrap" aria-label="Explore the federation map">
    <federation-map mode="mini" src="/map.json"></federation-map>
  </a>
) : (
  <federation-map src="/map.json"></federation-map>
)}
<noscript><p class="mono">Interactive map needs JavaScript — the data is at <a href="/map.json">/map.json</a>.</p></noscript>
<script>
  import "../../../packages/org-os-federation-map/src/index.mjs";
</script>
<style>
  .mini-wrap { display: block; text-decoration: none; }
  .mini-wrap federation-map { pointer-events: none; }
</style>
```

- [ ] **Step 5: Swap `/federation`.** In `site/src/pages/federation.astro`: replace the `FederationGraph` import with `import FederationMapIsland from "../components/FederationMapIsland.astro";`, and replace `<FederationGraph federation={federationData} />` with `<FederationMapIsland />`. Keep `federationData` import, generated-stamp line, and the `InstanceCard` grid untouched.

- [ ] **Step 6: Swap the home mini.** In `site/src/pages/index.astro`: replace the `FederationGraph` import with the island import and `<FederationGraph federation={federationData} />` with `<FederationMapIsland mode="mini" />`. The `statline` still uses `federationData` — leave it.

- [ ] **Step 7: Delete the superseded component.**

Run: `git rm site/src/components/FederationGraph.astro`
Then: `grep -rn "FederationGraph" site/src` → Expected: no matches.

- [ ] **Step 8: Build + manual check**

Run: `cd site && npm run build`
Expected: build succeeds (aggregate → astro build → verify). Then `npm run dev` and check http://localhost:4321/federation — interactive map renders; hover lights neighborhoods; click opens the panel; home shows the mini linking to /federation. Also `node --test` in `site/` → all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A site
git commit -m "feat(site): swap static federation graph for interactive <federation-map> island"
```

**Phase 1 gate:** demo + /federation page render the torch from real data. Stop and review before Phase 2.

---

## Phase 2 — the frontier

### Task 9: kms `frontier.mjs` + CLI `federate frontier` (TDD)

**Files:**
- Create: `packages/org-os-kms/src/frontier.mjs`
- Modify: `packages/org-os-kms/src/cli.mjs`
- Test: `packages/org-os-kms/test/frontier.test.mjs`
- Fixture: add `packages/org-os-kms/test/fixtures/map/full/siblings/child-os/federation.yaml`:

```yaml
identity:
  name: "child-os"
  type: "LocalNode"
peers:
  - name: "Grandpeer"
    id: "grand-peer"
    repo: "example/grand-peer"
    url: "https://github.com/example/grand-peer"
    type: "DAO"
```

- [ ] **Step 1: Write the failing tests**

```js
// test/frontier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFrontier } from '../src/frontier.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map', 'full');
const NOW = '2026-07-19T12:00:00Z';
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-frontier-'));
  cpSync(FIX, dir, { recursive: true });
  return dir;
}
const noFetch = async () => { throw new Error('network disabled in test'); };

test('local cloned sibling: reads its federation.yaml, writes a snapshot', async () => {
  const dir = scratch();
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const child = r.report.find((x) => x.id === 'child-os');
  assert.equal(child.ok, true);
  assert.equal(child.source, 'local');
  const snap = JSON.parse(readFileSync(join(dir, 'data', 'federation', 'frontier', 'child-os.json'), 'utf8'));
  assert.equal(snap.fetched_at, NOW);
  assert.deepEqual(snap.peers.map((p) => p.id), ['grand-peer']);
});

test('remote peer: fetches raw-GitHub federation.yaml via injected fetchFn', async () => {
  const dir = scratch();
  const fakeFetch = async (url) => {
    assert.ok(url.includes('raw.githubusercontent.com/example/sibling-os/HEAD/federation.yaml'));
    return { ok: true, text: async () => 'identity:\n  name: sibling-os\npeers:\n  - id: remote-friend\n    name: Remote Friend\n' };
  };
  const r = await fetchFrontier({ dir, fetchFn: fakeFetch, now: NOW });
  const sib = r.report.find((x) => x.id === 'sibling-os');
  assert.equal(sib.ok, true);
  const snap = JSON.parse(readFileSync(join(dir, 'data', 'federation', 'frontier', 'sibling-os.json'), 'utf8'));
  assert.deepEqual(snap.peers.map((p) => p.id), ['remote-friend']);
});

test('fetch failure: reports error, keeps the stale cache (never deletes)', async () => {
  const dir = scratch();
  const cacheDir = join(dir, 'data', 'federation', 'frontier');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'sibling-os.json'), JSON.stringify({ fetched_at: 'old', peers: [] }));
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  const sib = r.report.find((x) => x.id === 'sibling-os');
  assert.ok(sib.error);
  assert.equal(sib.cached, true);
  const snap = JSON.parse(readFileSync(join(cacheDir, 'sibling-os.json'), 'utf8'));
  assert.equal(snap.fetched_at, 'old', 'stale cache untouched');
});

test('peer with no local_path and no repo is reported skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kms-frontier-'));
  writeFileSync(join(dir, 'federation.yaml'), 'identity:\n  name: x\npeers:\n  - id: ghost\n    name: Ghost\n');
  const r = await fetchFrontier({ dir, fetchFn: noFetch, now: NOW });
  assert.equal(r.report[0].skipped, 'no local_path or repo');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/frontier.test.mjs` → FAIL.

- [ ] **Step 3: Implement `src/frontier.mjs`**

```js
// src/frontier.mjs
// `federate frontier` — fetch each ring-1 peer's federation manifest one hop out
// (spec §3). Local clone first (no network), then raw-GitHub fallback. Snapshots
// under data/federation/frontier/<id>.json; `render map` reads ONLY this cache, so
// fetch failures can never break a build. Stale cache beats broken build.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

function normalizePeers(manifest) {
  const out = [];
  for (const section of ['peers', 'upstream', 'downstream']) {
    for (const p of manifest?.[section] || []) {
      const id = p.id || p.name;
      if (id) out.push({ id, name: p.name || id, repo: p.repo || null, url: p.url || null, type: p.type || null });
    }
  }
  return out;
}

export async function fetchFrontier({ dir = '.', fetchFn = globalThis.fetch, now = new Date().toISOString() } = {}) {
  const fed = yaml.load(readFileSync(join(dir, 'federation.yaml'), 'utf8'));
  const entries = [...(fed.peers || []), ...(fed.upstream || []), ...(fed.downstream || [])];
  const outDir = join(dir, 'data', 'federation', 'frontier');
  mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const entry of entries) {
    const id = entry.id || entry.name;
    if (!id) continue;
    const cachePath = join(outDir, `${id}.json`);
    try {
      let manifest = null, source = null;
      const localFed = entry.local_path ? join(dir, entry.local_path, 'federation.yaml') : null;
      if (localFed && existsSync(localFed)) {
        manifest = yaml.load(readFileSync(localFed, 'utf8'));
        source = 'local';
      } else if (entry.repo) {
        const url = `https://raw.githubusercontent.com/${entry.repo}/HEAD/federation.yaml`;
        const res = await fetchFn(url);
        if (res.ok) { manifest = yaml.load(await res.text()); source = url; }
      } else {
        report.push({ id, skipped: 'no local_path or repo' });
        continue;
      }
      if (!manifest) { report.push({ id, skipped: 'unreached', cached: existsSync(cachePath) }); continue; }
      const snap = { fetched_at: now, source, peers: normalizePeers(manifest) };
      writeFileSync(cachePath, JSON.stringify(snap, null, 2));
      report.push({ id, ok: true, source, count: snap.peers.length });
    } catch (e) {
      report.push({ id, error: e.message, cached: existsSync(cachePath) });
    }
  }
  return { ok: true, report };
}
```

- [ ] **Step 4: Wire the CLI verb.** In `src/cli.mjs` add `import { fetchFrontier } from './frontier.mjs';` and inside `case 'federate':` add before the unknown-subcommand line:

```js
      if (args[0] === 'frontier') return fetchFrontier({ dir });
```

Note `dispatch` now returns a Promise for this path — the entry point's `console.log(JSON.stringify(result))` must handle it. Change the entry point to:

```js
    const result = await dispatch(process.argv.slice(2));
```

(top-level await is fine in ESM; keep the try/catch). Add a dry-route test to `cli.test.mjs`:

```js
test('dispatch dry-routes federate frontier', () => {
  const r = dispatch(['federate', 'frontier'], { dry: true });
  assert.deepEqual(r, { verb: 'federate', args: ['frontier'], flags: {} });
});
```

- [ ] **Step 5: Run to verify pass** — `node --test` (full kms suite) → all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-kms/src/frontier.mjs packages/org-os-kms/src/cli.mjs packages/org-os-kms/test/frontier.test.mjs packages/org-os-kms/test/fixtures/map
git commit -m "feat(kms): federate frontier — one-hop peer manifest fetch with snapshot cache"
```

---

### Task 10: buildMap frontier + ecosystems coverage (TDD)

`buildMap` already merges frontier cache + ecosystems (Task 6 code) — this task **proves** it with tests and creates the real `data/ecosystems.yaml`.

**Files:**
- Test: `packages/org-os-kms/test/map.test.mjs` (append)
- Fixture: `packages/org-os-kms/test/fixtures/map/full/data/federation/frontier/child-os.json`, `…/full/data/ecosystems.yaml`
- Create: `data/ecosystems.yaml` (org-os root)

- [ ] **Step 1: Create fixture frontier snapshot** `test/fixtures/map/full/data/federation/frontier/child-os.json`:

```json
{
  "fetched_at": "2026-07-19T11:00:00Z",
  "source": "local",
  "peers": [
    { "id": "grand-peer", "name": "Grandpeer", "repo": "example/grand-peer", "url": null, "type": "DAO" },
    { "id": "sibling-os", "name": "Sibling", "repo": "example/sibling-os", "url": null, "type": "DAO" }
  ]
}
```

And `test/fixtures/map/full/data/ecosystems.yaml`:

```yaml
ecosystems:
  - id: regen-commons
    name: Regen Commons
    url: https://example.org/regen-commons
    sources: [koi-network, regen-registry]
```

- [ ] **Step 2: Append failing tests to `test/map.test.mjs`**

```js
test('frontier snapshots become ring-2 nodes; ring-1 dups keep edge only (spec §3 dedup)', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const grand = m.nodes.find((n) => n.id === 'grand-peer');
  assert.equal(grand.kind, 'frontier');
  assert.equal(grand.ring, 2);
  assert.ok(m.edges.some((e) => e.from === 'child-os' && e.to === 'grand-peer' && e.kind === 'frontier'));
  // sibling-os is already ring 1 → stays a single instance node, frontier edge retargets it
  assert.equal(m.nodes.filter((n) => n.id === 'sibling-os').length, 1);
  assert.equal(m.nodes.find((n) => n.id === 'sibling-os').kind, 'instance');
  assert.ok(m.edges.some((e) => e.from === 'child-os' && e.to === 'sibling-os' && e.kind === 'frontier'));
});

test('ecosystems: node added, sources tagged + edged', () => {
  const m = buildMap({ dir: join(FIX, 'full'), now: NOW });
  const eco = m.nodes.find((n) => n.id === 'regen-commons');
  assert.equal(eco.kind, 'ecosystem');
  assert.equal(m.nodes.find((n) => n.id === 'koi-network').ecosystem, 'regen-commons');
  assert.ok(m.edges.some((e) => e.from === 'regen-commons' && e.to === 'koi-network' && e.kind === 'provenance'));
});
```

- [ ] **Step 3: Run** — `node --test test/map.test.mjs`. Expected: PASS if Task 6's merge code is correct; if anything fails, fix `map.mjs` (not the tests).

- [ ] **Step 4: Create the real `data/ecosystems.yaml`** at org-os root:

```yaml
# data/ecosystems.yaml — curated ecosystem nodes for the federation map ("the torch").
# Spec: docs/superpowers/specs/2026-07-19-federation-map-design.md §3.
# Each entry becomes a ring-3 ecosystem node; `sources` lists source-system ids it groups.
ecosystems:
  - id: regen-commons
    name: Regen Commons
    url: https://github.com/regen-coordination
    sources: []
  - id: refi-network
    name: ReFi Network
    url: https://refidao.com
    sources: []
  - id: agent-standards
    name: Agent-Native Standards
    url: https://agentsmd.com
    sources: []
```

- [ ] **Step 5: Run frontier for real + rebuild the site data**

Run (org-os root):
```bash
node packages/org-os-kms/src/cli.mjs federate frontier
cd site && npm run aggregate && node --test && cd ..
```
Expected: frontier report lists each cloned instance with `source: "local"`; aggregate prints a larger node count (frontier + ecosystems included); site tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-kms/test data/ecosystems.yaml data/federation site/public/map.json site/src/data/map.json
git commit -m "feat(federation-map): frontier + ecosystems live — ring-2 embers from real peer manifests"
```

**Phase 2 gate:** /federation shows dim frontier nodes one hop beyond ring 1. Review before Phase 3.

---

## Phase 3 — vault artifact + portals

### Task 11: Standalone IIFE bundle (esbuild)

**Files:**
- Modify: `packages/org-os-federation-map/package.json`
- Create (generated, committed): `packages/org-os-federation-map/dist/federation-map.iife.js`
- Test: `packages/org-os-federation-map/test/dist.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/dist.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'federation-map.iife.js');

test('committed standalone bundle exists, is self-contained, defines the element', () => {
  assert.ok(existsSync(dist), 'run `npm run build` in packages/org-os-federation-map');
  const src = readFileSync(dist, 'utf8');
  assert.ok(src.includes('federation-map'), 'defines the custom element');
  assert.ok(!src.includes('from"d3-force"') && !src.includes("from'd3-force'"), 'd3-force is bundled, not imported');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/dist.test.mjs` → FAIL (no dist).

- [ ] **Step 3: Add esbuild + build script.** In `packages/org-os-federation-map/package.json` add:

```json
  "scripts": {
    "test": "node --test",
    "build": "esbuild src/index.mjs --bundle --minify --format=iife --outfile=dist/federation-map.iife.js"
  },
  "devDependencies": {
    "esbuild": "^0.24.0"
  }
```

Run: `cd "packages/org-os-federation-map" && npm install && npm run build`
Expected: `dist/federation-map.iife.js` created (~30–50 KB minified).

- [ ] **Step 4: Run to verify pass** — `node --test test/dist.test.mjs` → PASS. Check the repo root `.gitignore` does not exclude `dist/` (`grep -n "dist" ../../.gitignore`); if it does, force-add.

- [ ] **Step 5: Commit** (the dist is committed by design — instances consume the vault artifact without a build step):

```bash
git add packages/org-os-federation-map/package.json packages/org-os-federation-map/package-lock.json packages/org-os-federation-map/dist packages/org-os-federation-map/test/dist.test.mjs
git commit -m "build(federation-map): committed standalone IIFE bundle for the vault artifact"
```

---

### Task 12: kms `render map --html` — self-contained vault artifact (TDD)

**Files:**
- Create: `packages/org-os-kms/src/render-map-html.mjs`
- Modify: `packages/org-os-kms/src/cli.mjs`
- Test: `packages/org-os-kms/test/render-map-html.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/render-map-html.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMapHtml } from '../src/render-map-html.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'map', 'full');
const FAKE_BUNDLE = 'customElements.define("federation-map",class extends HTMLElement{});';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'kms-html-'));
  cpSync(FIX, dir, { recursive: true });
  const bundle = join(dir, 'bundle.js');
  writeFileSync(bundle, FAKE_BUNDLE);
  return { dir, bundle };
}

test('writes a self-contained HTML with inlined bundle + inlined map data', () => {
  const { dir, bundle } = scratch();
  const r = renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  assert.equal(r.ok, true);
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  assert.ok(html.includes(FAKE_BUNDLE), 'bundle inlined');
  assert.ok(html.includes('"full-os"'), 'map data inlined');
  assert.ok(html.includes('<federation-map'), 'element present');
  assert.ok(!html.includes('src='), 'no external fetches — fully offline');
});

test('JSON is script-safe: </script> sequences are escaped', () => {
  const { dir, bundle } = scratch();
  // poison a name with a script-closing sequence
  writeFileSync(join(dir, 'federation.yaml'),
    'identity:\n  name: full-os\ndownstream:\n  - id: evil\n    name: "</script><script>alert(1)</script>"\n');
  renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  assert.ok(!html.includes('</script><script>alert(1)'), 'closing sequence neutralized');
});

test('uses vault surface: builder runs with surface=vault', () => {
  const { dir, bundle } = scratch();
  // full fixture's source-systems have no portal_vault; add one to prove the surface switch
  writeFileSync(join(dir, 'data', 'source-systems.yaml'),
    '- id: koi-network\n  title: KOI\n  portal_vault: "obsidian://open?file=koi"\n  portal_web: "/docs/koi"\n');
  renderMapHtml({ dir, bundlePath: bundle, now: '2026-07-19T12:00:00Z' });
  const html = readFileSync(join(dir, 'renders', 'federation-map.html'), 'utf8');
  assert.ok(html.includes('obsidian://open?file=koi'));
  assert.ok(!html.includes('/docs/koi'));
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/render-map-html.test.mjs` → FAIL.

- [ ] **Step 3: Implement `src/render-map-html.mjs`**

```js
// src/render-map-html.mjs
// `render map --html` — the vault artifact (spec §5): ONE self-contained HTML with the
// component bundle + map data inlined, openable offline from inside Obsidian. Portals
// use the vault surface (obsidian:// links).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap } from './map.mjs';

const DEFAULT_BUNDLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'org-os-federation-map', 'dist', 'federation-map.iife.js',
);

export function renderMapHtml({ dir = '.', out = 'renders/federation-map.html', bundlePath = DEFAULT_BUNDLE, now = new Date().toISOString() } = {}) {
  const map = buildMap({ dir, surface: 'vault', now });
  const bundle = readFileSync(bundlePath, 'utf8');
  // </script> inside inlined JSON/bundle would close our tags early — neutralize.
  const data = JSON.stringify(map).replace(/<\//g, '<\\/');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${map.self.name} — federation map</title>
<style>body{background:#06080c;margin:0;padding:20px;max-width:980px;margin-inline:auto;font-family:ui-monospace,monospace}
h1{color:#f5c04e;font-size:15px;font-weight:normal}p{color:#5b6472;font-size:11px}</style>
</head><body>
<h1>🔦 ${map.self.name} — federation map</h1>
<federation-map><script type="application/json">${data}</script></federation-map>
<p>generated ${now} · the torch: hover to cast light, click a node to walk toward it · counterpart of the internal note graph</p>
<script>${bundle.replace(/<\//g, '<\\/')}</script>
</body></html>`;
  const outPath = join(dir, out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  return { ok: true, report: { wrote: outPath, nodes: map.nodes.length, edges: map.edges.length } };
}
```

**Ordering note:** the inline `<script type="application/json">` child must be readable by the element — `element.mjs` `#loadData()` already checks `this.querySelector('script[type="application/json"]')` before `src`, and the bundle `<script>` executes after the element markup exists, so `connectedCallback` sees the child. Verify this in Step 5's manual check.

- [ ] **Step 4: Wire the CLI.** In `src/cli.mjs`: `import { renderMapHtml } from './render-map-html.mjs';` and extend the `render` case's map branch:

```js
      if (args[0] === 'map') {
        if (args[1] === 'html') {
          return renderMapHtml({ dir, out: flags.out || 'renders/federation-map.html' });
        }
        const map = buildMap({ dir, surface: flags.surface || 'web' });
        // … (existing map.json write from Task 7 unchanged)
```

Note the canonical form is positional — `render map html` — NOT a `--html` flag: `parseFlags` consumes the next token as a flag's value, so a boolean flag would swallow whatever follows. Support test:

```js
test('dispatch dry-routes render map html', () => {
  const r = dispatch(['render', 'map', 'html'], { dry: true });
  assert.deepEqual(r, { verb: 'render', args: ['map', 'html'], flags: {} });
});
```

(In the implementation branch above, keep only the `args[1] === 'html'` check — drop the `flags.html` check to match.)

- [ ] **Step 5: Run + manual check**

Run: `node --test` (kms suite) → PASS.
Run for real (org-os root): `node packages/org-os-kms/src/cli.mjs render map html`
Expected: `renders/federation-map.html` written. Open it directly in a browser (file://) — the torch renders fully offline.

- [ ] **Step 6: Commit**

```bash
git add packages/org-os-kms/src/render-map-html.mjs packages/org-os-kms/src/cli.mjs packages/org-os-kms/test/render-map-html.test.mjs renders/federation-map.html
git commit -m "feat(kms): render map html — self-contained vault artifact of the torch"
```

---

### Task 13: Portal index — `renders/federation-portals.md` (TDD)

**Planned deviation from spec §5 (see header):** portal index file instead of in-note stamping — KB objects are YAML registry entries today, not markdown notes.

**Files:**
- Modify: `packages/org-os-kms/src/render-map-html.mjs` (add `renderPortalIndex`)
- Test: `packages/org-os-kms/test/render-map-html.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

```js
import { renderPortalIndex } from '../src/render-map-html.mjs';

test('portal index lists every node with a deep-link into the vault artifact', () => {
  const { dir } = scratch();
  const r = renderPortalIndex({ dir, now: '2026-07-19T12:00:00Z' });
  assert.equal(r.ok, true);
  const md = readFileSync(join(dir, 'renders', 'federation-portals.md'), 'utf8');
  assert.ok(md.includes('[Child](federation-map.html#node=child-os)'));
  assert.ok(md.includes('[KOI Network](federation-map.html#node=koi-network)') || md.includes('#node=koi-network'));
  assert.ok(md.includes('## Instances'), 'grouped by kind');
});

test('portal index is deterministic for fixed now (safe to regenerate)', () => {
  const { dir } = scratch();
  renderPortalIndex({ dir, now: 'T' });
  const a = readFileSync(join(dir, 'renders', 'federation-portals.md'), 'utf8');
  renderPortalIndex({ dir, now: 'T' });
  const b = readFileSync(join(dir, 'renders', 'federation-portals.md'), 'utf8');
  assert.equal(a, b);
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement** (append to `render-map-html.mjs`):

```js
const KIND_HEADINGS = [['instance', 'Instances'], ['frontier', 'Frontier'], ['source', 'Sources'], ['ecosystem', 'Ecosystems']];

export function renderPortalIndex({ dir = '.', out = 'renders/federation-portals.md', now = new Date().toISOString() } = {}) {
  const map = buildMap({ dir, surface: 'vault', now });
  const lines = [
    `# Federation portals — ${map.self.name}`,
    '',
    `> Doors between the internal note graph and [the torch](federation-map.html). Generated ${now} — regenerate with \`org-os-kms render map html\`. Link to these anchors from any note.`,
  ];
  for (const [kind, heading] of KIND_HEADINGS) {
    const group = map.nodes.filter((n) => n.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
    if (!group.length) continue;
    lines.push('', `## ${heading}`, '');
    for (const n of group) {
      const extras = [n.type, n.live === false && n.kind === 'instance' ? 'unreached' : null].filter(Boolean).join(' · ');
      lines.push(`- [${n.name || n.id}](federation-map.html#node=${encodeURIComponent(n.id)})${extras ? ` — ${extras}` : ''}`);
    }
  }
  const outPath = join(dir, out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n') + '\n');
  return { ok: true, report: { wrote: outPath, portals: map.nodes.length } };
}
```

Wire into the CLI's `render map html` branch so both artifacts regenerate together:

```js
        if (args[1] === 'html') {
          const html = renderMapHtml({ dir, out: flags.out || 'renders/federation-map.html' });
          const portals = renderPortalIndex({ dir });
          return { ok: true, report: { ...html.report, portals: portals.report.wrote } };
        }
```

- [ ] **Step 4: Run to verify pass** — `node --test` → all PASS. Regenerate for real: `node packages/org-os-kms/src/cli.mjs render map html` → `renders/federation-portals.md` exists; open it in Obsidian and click a portal — the map opens focused on that node.

- [ ] **Step 5: Commit**

```bash
git add packages/org-os-kms/src packages/org-os-kms/test renders/
git commit -m "feat(kms): federation portal index — note-graph doors into the torch"
```

---

### Task 14: Docs + close-out

**Files:**
- Modify: `docs/FEDERATION.md` (append section)
- Modify: `data/packages-matrix.yaml` (kms notes + federation-map instances_using)
- Modify: `docs/superpowers/specs/2026-07-19-federation-map-design.md` (status)

- [ ] **Step 1: Append to `docs/FEDERATION.md`:**

```markdown
## The Federation Map ("the torch")

Every instance can render an interactive map of its external world — federated
instances (ring 1), frontier peers-of-peers (ring 2), knowledge sources and
ecosystems (ring 3) — the counterpart of the internal note graph.

- **Data:** `org-os-kms render map` → `map.json` (aggregates `federation.yaml`,
  `kms.yaml` peers, KB source-systems, `data/ecosystems.yaml`, frontier cache).
- **Frontier:** `org-os-kms federate frontier` fetches each peer's
  `federation.yaml` (local clone first, raw-GitHub fallback) one hop out into
  `data/federation/frontier/`. Fetch failures keep the stale cache; builds never break.
- **View:** `@org-os/federation-map` — `<federation-map>` web component
  (packages/org-os-federation-map). Embedded on the site (`/federation` + home mini).
- **Vault:** `org-os-kms render map html` → `renders/federation-map.html`
  (self-contained, offline) + `renders/federation-portals.md` (note-graph doors).

Design spec: `docs/superpowers/specs/2026-07-19-federation-map-design.md`.
```

- [ ] **Step 2: Update matrices.** In `data/packages-matrix.yaml`: set `org-os-federation-map` `instances_using: ["org-os"]`; append to the `org-os-kms` entry's `notes`: `" + map builder/frontier/vault-artifact (federation map, 2026-07)"`.

- [ ] **Step 3: Update spec front-matter** `status: approved-design` → `status: implemented`.

- [ ] **Step 4: Full verification sweep**

```bash
cd "packages/org-os-federation-map" && node --test && cd ../org-os-kms && node --test && cd ../../site && npm run build && node --test && cd ..
npm run validate:structure
```
Expected: every suite PASS; site build green; structure validation 0 failed.

- [ ] **Step 5: Commit**

```bash
git add docs/FEDERATION.md data/packages-matrix.yaml docs/superpowers/specs/2026-07-19-federation-map-design.md
git commit -m "docs(federation-map): FEDERATION.md torch section + matrix + spec status"
```

---

## Verification (whole feature)

1. `node --test` green in `packages/org-os-federation-map`, `packages/org-os-kms`, `site`.
2. `site npm run build` green **with sibling repos absent** (rename `../refi-bcn-os` temporarily → nodes go `live:false`, build still succeeds — spec §6).
3. Manual: `/federation` — hover lights neighborhoods, click panel links out, frontier embers pulse, `#node=refi-bcn-os` deep-link works, home mini links through.
4. Manual: `renders/federation-map.html` opens offline from Obsidian; portals index round-trips.
5. `npm run validate:structure` — 0 failed.
