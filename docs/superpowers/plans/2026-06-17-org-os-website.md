# org-os Website + Docs Site — Implementation Plan

> **Release status (2026-08-28):** Built + copy truthed-up (ship-and-validate Task 9 + final fix wave); deploy is masterplan WS-D; spec §16 theme decision resolved (current default locked). Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the org-os public framework website + docs site as a static Astro 5 app at `org-os/site/`, presenting the v0.5 module roadmap, rendering curated docs from a single source of truth, and federating live-at-build with the instance registry.

**Architecture:** Static Astro 5 (`output: "static"`). A build-time Node script aggregates `data/instances.yaml` + sibling instance `.well-known/` into `src/data/federation.json` (graceful degradation when a sibling is absent — the seam toward a future aggregator service). Docs render via Astro's `glob()` content loader pointed at `../docs` (no copying). A light "systems" theme lives in a `tokens.css` + `theme.css` + `themes/systems.css` swap architecture (the seam toward `org-os-website-generator`). The federation graph is pure deterministic SVG (zero client JS), modeled on refibcn-site's `NeuralWeb.astro`.

**Tech Stack:** Astro 5, `@fontsource-variable/geist` + `geist-mono` + `inter`, `js-yaml`, Node's built-in `node:test` (no extra test framework). **No** `d3`, **no** `maplibre-gl`.

**Spec:** `docs/superpowers/specs/2026-06-17-org-os-website-design.md`

---

## File Structure

```
org-os/site/
├── package.json                       # deps + scripts (dev/build/preview/aggregate/verify/test)
├── astro.config.mjs                   # output:"static", site, build.format:"directory"
├── tsconfig.json
├── .gitignore                         # dist, node_modules, .astro, generated federation.json + .well-known copy
├── README.md
├── scripts/
│   ├── federation-aggregate.mjs       # PURE functions (parse/enrich/edges/aggregate) — unit-tested
│   ├── aggregate-federation.mjs       # CLI wrapper: writes src/data/federation.json + copies .well-known
│   └── verify-build.mjs               # post-build route/asset/content checks
├── test/
│   ├── federation-aggregate.test.mjs  # node:test unit tests for the pure functions
│   └── fixtures/                       # tiny instances.yaml + a fake instance dir + a missing one
└── src/
    ├── env.d.ts
    ├── content.config.ts               # docs collection via glob() loader → ../docs
    ├── styles/
    │   ├── tokens.css                  # structural tokens (theme-invariant)
    │   ├── theme.css                   # one-line @import switch
    │   ├── themes/systems.css          # PRIMARY — light systems theme
    │   ├── themes/systems-dark.css     # stub dark theme (proves the swap)
    │   └── global.css                  # consumes theme vars only
    ├── data/
    │   ├── landing.yaml                # home/marketing copy (instance content)
    │   ├── modules.yaml                # v0.5 module roadmap cards
    │   ├── docs-allowlist.ts           # curated docs: file → slug/title/group
    │   └── federation.json             # GENERATED (gitignored)
    ├── lib/
    │   └── federation.ts               # typed loader for federation.json
    ├── components/
    │   ├── Layout.astro  Nav.astro  Footer.astro  Button.astro
    │   ├── Hero.astro  SectionBlock.astro
    │   ├── FederationGraph.astro  InstanceCard.astro
    │   ├── ModuleCard.astro  StatusBadge.astro
    └── pages/
        ├── index.astro  modules.astro  federation.astro  get-started.astro  about.astro
        ├── docs/index.astro  docs/[...slug].astro
        ├── llms.txt.ts  federation.json.ts
```

**Conventions to follow (from refibcn-site):** structural tokens live in `tokens.css`; palette/fonts/radius live in the active theme; `global.css` consumes only theme vars (no raw hex); `Layout.astro` imports fonts + the three style files + `Nav`/`Footer`.

---

## Task 1: Scaffold the Astro project

**Files:**
- Create: `org-os/site/package.json`
- Create: `org-os/site/astro.config.mjs`
- Create: `org-os/site/tsconfig.json`
- Create: `org-os/site/.gitignore`
- Create: `org-os/site/src/env.d.ts`
- Create: `org-os/site/src/pages/index.astro` (temporary minimal page)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "org-os-site",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "description": "org-os — the agent-native org operating system. Framework website + docs + live federation.",
  "scripts": {
    "aggregate": "node scripts/aggregate-federation.mjs",
    "dev": "npm run aggregate && astro dev",
    "build": "npm run aggregate && astro build && npm run verify",
    "preview": "astro preview",
    "verify": "node scripts/verify-build.mjs",
    "test": "node --test"
  },
  "dependencies": {
    "astro": "^5.0.0"
  },
  "devDependencies": {
    "@fontsource-variable/geist": "^5.0.0",
    "@fontsource-variable/geist-mono": "^5.0.0",
    "@fontsource-variable/inter": "^5.0.0",
    "js-yaml": "^4.1.1",
    "@types/js-yaml": "^4.0.9"
  }
}
```

- [ ] **Step 2: Create `astro.config.mjs`**

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  // Domain is an open decision (spec §16) — placeholder until decided.
  site: "https://org-os.dev",
  output: "static",
  build: { format: "directory" },
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
.astro/
# generated at build
src/data/federation.json
public/.well-known/
```

- [ ] **Step 5: Create `src/env.d.ts`**

```ts
/// <reference path="../.astro/types.d.ts" />
```

- [ ] **Step 6: Create a temporary `src/pages/index.astro`** (replaced in Task 10)

```astro
---
---
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>org-os</title></head>
<body><h1>org-os</h1></body></html>
```

- [ ] **Step 7: Install and build**

Run: `cd org-os/site && npm install && npm run build`
Expected: install succeeds; `npm run aggregate` fails (script not written yet) — that's OK, temporarily run `npx astro build` instead to confirm the scaffold builds:
Run: `cd org-os/site && npx astro build`
Expected: build succeeds, `dist/index.html` exists.

- [ ] **Step 8: Commit**

```bash
cd org-os/site
git add package.json astro.config.mjs tsconfig.json .gitignore src/env.d.ts src/pages/index.astro package-lock.json
git commit -m "feat(site): scaffold org-os Astro project"
```

---

## Task 2: Theme system — tokens, systems theme, global

**Files:**
- Create: `org-os/site/src/styles/tokens.css`
- Create: `org-os/site/src/styles/themes/systems.css`
- Create: `org-os/site/src/styles/theme.css`
- Create: `org-os/site/src/styles/global.css`

- [ ] **Step 1: Create `tokens.css`** (structural, theme-invariant)

```css
/* tokens.css — STRUCTURAL tokens only. Palette/fonts/radius live in the active theme. */
:root {
  /* Type scale (1.250 major third) */
  --text-xs: 0.64rem; --text-sm: 0.8rem; --text-base: 1rem; --text-md: 1.25rem;
  --text-lg: 1.563rem; --text-xl: 1.953rem; --text-2xl: 2.441rem; --text-3xl: 3.052rem;
  --text-4xl: 3.815rem;
  --leading-display: 1.08; --leading-heading: 1.2; --leading-body: 1.6; --leading-ui: 1.4;
  /* Spacing (4px base) */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
  --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem; --space-16: 4rem; --space-24: 6rem;
  --radius-pill: 9999px;
  --gutter: 1.5rem;
  --container: min(1200px, 100% - 2 * var(--gutter));
  --container-prose: 72ch;
  --t-fast: 120ms ease; --t-med: 260ms ease;
}
@media (prefers-reduced-motion: reduce) { :root { --t-fast: 0ms; --t-med: 0ms; } }
```

- [ ] **Step 2: Create `themes/systems.css`** (PRIMARY — light systems)

```css
/* themes/systems.css — light "systems/infrastructure" theme (primary). */
:root {
  --color-bg: #fbfbf9;
  --color-surface: #ffffff;
  --color-ink: #16191d;
  --color-muted: #52575e;
  --color-faint: #9aa0a6;
  --color-line: #e6e7e2;       /* hairline grid + borders */
  --color-accent: #1f883d;     /* regen green — swappable (spec §16) */
  --color-accent-ink: #ffffff;

  --font-display: "Geist Mono Variable", "IBM Plex Mono", ui-monospace, monospace;
  --font-mono: "Geist Mono Variable", ui-monospace, monospace;
  --font-body: "Inter Variable", system-ui, sans-serif;

  --radius: 4px;
  --radius-sm: 3px;
  --grid-size: 30px;
  --grid-line: #ebece8;
}
```

- [ ] **Step 3: Create `theme.css`** (one-line switch)

```css
/* theme.css — the active theme. Swap this single import to retheme the whole site. */
@import "./themes/systems.css";        /* ACTIVE — light systems (primary) */
/* @import "./themes/systems-dark.css";   dark variant (Task 3) */
```

- [ ] **Step 4: Create `global.css`** (consumes theme vars only)

```css
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background-color: var(--color-bg);
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: var(--grid-size) var(--grid-size);
  color: var(--color-ink);
  font-family: var(--font-body);
  line-height: var(--leading-body);
  font-size: var(--text-base);
}
main { min-height: 60vh; }
h1, h2, h3 { font-family: var(--font-display); line-height: var(--leading-heading); font-weight: 600; }
h1 { font-size: var(--text-3xl); line-height: var(--leading-display); letter-spacing: -0.01em; }
h2 { font-size: var(--text-2xl); }
h3 { font-size: var(--text-lg); }
a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, .mono { font-family: var(--font-mono); }
.eyebrow { font-family: var(--font-mono); font-size: var(--text-sm); letter-spacing: 0.14em; color: var(--color-accent); }
.container { width: var(--container); margin-inline: auto; }
.prose { max-width: var(--container-prose); }
.surface { background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius); }
```

- [ ] **Step 5: Verify the styles import (temporary check)**

Add `import "../styles/tokens.css"; import "../styles/theme.css"; import "../styles/global.css";` inside the frontmatter of the temporary `src/pages/index.astro`, then:
Run: `cd org-os/site && npx astro build`
Expected: build succeeds; `dist/index.html` contains a `<style>` link/inline referencing the grid background (search `dist` for `--color-accent` resolves at build — confirm no unresolved `@import` errors in console).

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add src/styles/ src/pages/index.astro
git commit -m "feat(site): light systems theme + structural tokens + global base"
```

---

## Task 3: Stub dark theme — prove the one-line swap

**Files:**
- Create: `org-os/site/src/styles/themes/systems-dark.css`

- [ ] **Step 1: Create `themes/systems-dark.css`**

```css
/* themes/systems-dark.css — dark variant. Same variable contract as systems.css. */
:root {
  --color-bg: #0d1117;
  --color-surface: #11161d;
  --color-ink: #e6edf3;
  --color-muted: #8b949e;
  --color-faint: #6e7681;
  --color-line: #21262d;
  --color-accent: #3fb950;
  --color-accent-ink: #0d1117;
  --font-display: "Geist Mono Variable", "IBM Plex Mono", ui-monospace, monospace;
  --font-mono: "Geist Mono Variable", ui-monospace, monospace;
  --font-body: "Inter Variable", system-ui, sans-serif;
  --radius: 4px; --radius-sm: 3px; --grid-size: 30px; --grid-line: #1b222c;
}
```

- [ ] **Step 2: Verify the swap works**

Temporarily edit `theme.css` to comment the systems import and enable systems-dark, then:
Run: `cd org-os/site && npx astro build`
Expected: build succeeds (proves both themes satisfy the same variable contract).
Then revert `theme.css` back to systems.css active.

- [ ] **Step 3: Commit**

```bash
cd org-os/site
git add src/styles/themes/systems-dark.css src/styles/theme.css
git commit -m "feat(site): stub dark theme to prove one-line theme swap"
```

---

## Task 4: Shell components — Layout, Nav, Footer, Button

**Files:**
- Create: `org-os/site/src/components/Layout.astro`
- Create: `org-os/site/src/components/Nav.astro`
- Create: `org-os/site/src/components/Footer.astro`
- Create: `org-os/site/src/components/Button.astro`

- [ ] **Step 1: Create `Button.astro`**

```astro
---
interface Props { href: string; variant?: "solid" | "ghost"; }
const { href, variant = "solid" } = Astro.props;
---
<a href={href} class:list={["btn", variant]}><slot /></a>
<style>
.btn { display: inline-block; font-family: var(--font-mono); font-size: var(--text-sm);
  font-weight: 600; padding: var(--space-2) var(--space-4); border-radius: var(--radius);
  border: 1px solid var(--color-line); transition: background var(--t-fast); }
.btn.solid { background: var(--color-accent); color: var(--color-accent-ink); border-color: var(--color-accent); }
.btn.ghost { background: var(--color-surface); color: var(--color-ink); }
.btn:hover { text-decoration: none; opacity: 0.92; }
</style>
```

- [ ] **Step 2: Create `Nav.astro`**

```astro
---
interface Props { current?: string; }
const { current = "home" } = Astro.props;
const links = [
  { id: "modules", href: "/modules", label: "Modules" },
  { id: "federation", href: "/federation", label: "Federation" },
  { id: "docs", href: "/docs", label: "Docs" },
  { id: "get-started", href: "/get-started", label: "Get started" },
  { id: "about", href: "/about", label: "About" },
];
---
<nav class="nav container">
  <a href="/" class="brand mono">~/org-os</a>
  <ul>
    {links.map((l) => (
      <li><a href={l.href} class:list={{ active: current === l.id }}>{l.label}</a></li>
    ))}
  </ul>
</nav>
<style>
.nav { display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) 0; border-bottom: 1px solid var(--color-line); }
.brand { font-weight: 600; color: var(--color-ink); }
.nav ul { display: flex; gap: var(--space-4); list-style: none; margin: 0; padding: 0;
  font-family: var(--font-mono); font-size: var(--text-sm); }
.nav a { color: var(--color-muted); }
.nav a.active, .nav a:hover { color: var(--color-accent); }
</style>
```

- [ ] **Step 3: Create `Footer.astro`**

```astro
---
const year = 2026; // build-stamped; bump as needed
---
<footer class="footer container">
  <span class="mono">org-os · framework · standards · orchestration hub</span>
  <span class="mono faint">MIT · {year} · <a href="https://github.com/regen-coordination/org-os-template">repo</a></span>
</footer>
<style>
.footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2);
  padding: var(--space-8) 0; margin-top: var(--space-16);
  border-top: 1px solid var(--color-line); font-size: var(--text-sm); color: var(--color-muted); }
.footer .faint { color: var(--color-faint); }
</style>
```

- [ ] **Step 4: Create `Layout.astro`**

```astro
---
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/inter";
import "../styles/tokens.css";
import "../styles/theme.css";
import "../styles/global.css";
import Nav from "./Nav.astro";
import Footer from "./Footer.astro";

interface Props { title: string; description?: string; current?: string; noindex?: boolean; }
const {
  title,
  description = "org-os — the agent-native org operating system. Framework, standards, and orchestration hub for a federation of regenerative organizations.",
  current = "home",
  noindex = false,
} = Astro.props;
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content={description} />
  {noindex && <meta name="robots" content="noindex" />}
  <title>{title} · org-os</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</head>
<body>
  <Nav current={current} />
  <main><slot /></main>
  <Footer />
</body>
</html>
```

- [ ] **Step 5: Verify build with the shell**

Replace the temporary `src/pages/index.astro` with one that uses the Layout:

```astro
---
import Layout from "../components/Layout.astro";
---
<Layout title="Home"><div class="container"><h1>org-os</h1></div></Layout>
```

Run: `cd org-os/site && npx astro build`
Expected: build succeeds; `dist/index.html` contains `~/org-os` (the brand) and the nav links `Modules`, `Federation`, `Docs`.

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add src/components/ src/pages/index.astro
git commit -m "feat(site): shell — Layout, Nav, Footer, Button"
```

---

## Task 5: Federation aggregation — pure functions (TDD)

**Files:**
- Create: `org-os/site/scripts/federation-aggregate.mjs`
- Create: `org-os/site/test/federation-aggregate.test.mjs`
- Create: `org-os/site/test/fixtures/instances.yaml`
- Create: `org-os/site/test/fixtures/present-instance/.well-known/members.json`

- [ ] **Step 1: Create the test fixtures**

`test/fixtures/instances.yaml`:

```yaml
schema_version: "2.0"
instances:
  - id: "present-instance"
    name: "Present Instance"
    type: "LocalNode"
    maturity: "production"
    repo: "https://example.com/present"
    local_path: "./present-instance"
    federation_network: "refi-dao"
    federation_role: "spoke"
    framework_version: "3.0"
    packages: ["operations"]
    drift: []
    notes: "Has readable local data."
  - id: "hub-instance"
    name: "Hub Instance"
    type: "Hub"
    maturity: "beta"
    repo: "https://example.com/hub"
    local_path: "./hub-instance"
    federation_network: "refi-dao"
    federation_role: "hub"
    framework_version: "3.0"
    packages: []
    drift: []
    notes: "The hub."
  - id: "missing-instance"
    name: "Missing Instance"
    type: "LocalNode"
    maturity: "alpha"
    repo: null
    local_path: "./does-not-exist"
    federation_network: "refi-dao"
    federation_role: "spoke"
    framework_version: null
    packages: []
    drift: ["no_masterplan"]
    notes: "Local path absent — must degrade gracefully."
```

`test/fixtures/present-instance/.well-known/members.json`:

```json
{ "members": [{ "id": "a" }, { "id": "b" }, { "id": "c" }] }
```

- [ ] **Step 2: Write the failing test**

`test/federation-aggregate.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { parseRegistry, toNode, enrichFromDisk, deriveEdges, aggregate } from "../scripts/federation-aggregate.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const registryYaml = readFileSync(join(FIX, "instances.yaml"), "utf8");

test("parseRegistry returns the raw instance array", () => {
  const raw = parseRegistry(registryYaml);
  assert.equal(raw.length, 3);
  assert.equal(raw[0].id, "present-instance");
});

test("toNode normalizes a registry entry", () => {
  const node = toNode(parseRegistry(registryYaml)[0]);
  assert.equal(node.id, "present-instance");
  assert.equal(node.role, "spoke");
  assert.equal(node.network, "refi-dao");
  assert.equal(node.available, false); // not enriched yet
});

test("enrichFromDisk sets available + counts when data is readable", () => {
  const node = toNode(parseRegistry(registryYaml)[0]);
  const enriched = enrichFromDisk(node, join(FIX, "present-instance"));
  assert.equal(enriched.available, true);
  assert.equal(enriched.counts.members, 3);
});

test("enrichFromDisk degrades gracefully when the path is absent", () => {
  const node = toNode(parseRegistry(registryYaml)[2]);
  const enriched = enrichFromDisk(node, join(FIX, "does-not-exist"));
  assert.equal(enriched.available, false);
  assert.deepEqual(enriched.counts, {});
});

test("deriveEdges links spokes to their hub and instances to the framework root", () => {
  const nodes = parseRegistry(registryYaml).map(toNode);
  const edges = deriveEdges(nodes, "org-os");
  assert.ok(edges.some((e) => e.from === "present-instance" && e.to === "hub-instance" && e.kind === "federation"));
  assert.ok(edges.some((e) => e.from === "present-instance" && e.to === "org-os" && e.kind === "framework"));
  // missing-instance has framework_version null → no framework edge
  assert.ok(!edges.some((e) => e.from === "missing-instance" && e.kind === "framework"));
});

test("aggregate produces a root + nodes + edges and never throws on a missing sibling", () => {
  const fed = aggregate({ registryYaml, baseDir: FIX, now: "2026-06-17T00:00:00Z" });
  assert.equal(fed.root.id, "org-os");
  assert.equal(fed.nodes.length, 3);
  assert.equal(fed.generatedAt, "2026-06-17T00:00:00Z");
  const missing = fed.nodes.find((n) => n.id === "missing-instance");
  assert.equal(missing.available, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd org-os/site && node --test test/federation-aggregate.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/federation-aggregate.mjs'`.

- [ ] **Step 4: Implement `scripts/federation-aggregate.mjs`**

```js
// federation-aggregate.mjs — PURE, testable aggregation logic. No process I/O here
// except the defensive disk reads in enrichFromDisk (which never throw).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

export function parseRegistry(registryYaml) {
  const doc = yaml.load(registryYaml);
  return Array.isArray(doc?.instances) ? doc.instances : [];
}

export function toNode(raw) {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    type: raw.type ?? "Instance",
    maturity: raw.maturity ?? null,
    role: raw.federation_role ?? null,
    network: raw.federation_network || null,
    frameworkVersion: raw.framework_version ?? null,
    packages: Array.isArray(raw.packages) ? raw.packages : [],
    drift: Array.isArray(raw.drift) ? raw.drift : [],
    repo: raw.repo ?? null,
    notes: raw.notes ?? "",
    localPath: raw.local_path ?? null,
    available: false,
    counts: {},
  };
}

function safeCount(path, key) {
  try {
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data?.[key]) ? data[key].length : undefined;
  } catch {
    return undefined;
  }
}

// Reads <instanceAbsPath>/.well-known/*.json defensively. Never throws.
export function enrichFromDisk(node, instanceAbsPath) {
  const wk = join(instanceAbsPath, ".well-known");
  if (!existsSync(wk)) return { ...node, available: false, counts: {} };
  const counts = {};
  const members = safeCount(join(wk, "members.json"), "members");
  const projects = safeCount(join(wk, "projects.json"), "projects");
  if (members !== undefined) counts.members = members;
  if (projects !== undefined) counts.projects = projects;
  return { ...node, available: true, counts };
}

export function deriveEdges(nodes, rootId) {
  const edges = [];
  const hubByNetwork = new Map();
  for (const n of nodes) if (n.role === "hub" && n.network) hubByNetwork.set(n.network, n.id);
  for (const n of nodes) {
    if (n.frameworkVersion) edges.push({ from: n.id, to: rootId, kind: "framework" });
    if (n.role === "spoke" && n.network && hubByNetwork.has(n.network)) {
      edges.push({ from: n.id, to: hubByNetwork.get(n.network), kind: "federation" });
    }
  }
  return edges;
}

const ROOT_NODE = {
  id: "org-os", name: "org-os", type: "Framework", maturity: "production",
  role: "root", network: null, frameworkVersion: null, packages: [], drift: [],
  repo: "https://github.com/regen-coordination/org-os-template", notes: "Framework + standards + orchestration hub.",
  localPath: ".", available: true, counts: {},
};

// baseDir = the org-os root (instances' local_path is relative to it).
export function aggregate({ registryYaml, baseDir, now }) {
  const nodes = parseRegistry(registryYaml)
    .map(toNode)
    .map((n) => (n.localPath ? enrichFromDisk(n, resolve(baseDir, n.localPath)) : n));
  const edges = deriveEdges(nodes, ROOT_NODE.id);
  return { root: ROOT_NODE, nodes, edges, generatedAt: now };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd org-os/site && node --test test/federation-aggregate.test.mjs`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add scripts/federation-aggregate.mjs test/
git commit -m "feat(site): federation aggregation pure functions + tests (graceful degradation)"
```

---

## Task 6: Federation aggregation — CLI wrapper + build wiring

**Files:**
- Create: `org-os/site/scripts/aggregate-federation.mjs`

- [ ] **Step 1: Implement the CLI wrapper**

```js
// aggregate-federation.mjs — CLI: reads ../data/instances.yaml, writes src/data/federation.json,
// copies ../.well-known into public/.well-known. Resolves the org-os root from this script's location.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate } from "./federation-aggregate.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));   // org-os/site/scripts
const siteRoot = resolve(scriptDir, "..");                   // org-os/site
const orgOsRoot = resolve(siteRoot, "..");                   // org-os

const registryPath = join(orgOsRoot, "data", "instances.yaml");
if (!existsSync(registryPath)) {
  console.error(`MISSING registry: ${registryPath}`);
  process.exit(1);
}
const registryYaml = readFileSync(registryPath, "utf8");
const fed = aggregate({ registryYaml, baseDir: orgOsRoot, now: new Date().toISOString() });

const outDir = join(siteRoot, "src", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "federation.json"), JSON.stringify(fed, null, 2));
console.log(`federation.json: ${fed.nodes.length} nodes, ${fed.edges.length} edges (${fed.nodes.filter((n) => n.available).length} enriched)`);

// Surface org-os's own .well-known into the static output.
const wkSrc = join(orgOsRoot, ".well-known");
const wkDst = join(siteRoot, "public", ".well-known");
if (existsSync(wkSrc)) {
  mkdirSync(wkDst, { recursive: true });
  for (const f of readdirSync(wkSrc)) if (f.endsWith(".json")) copyFileSync(join(wkSrc, f), join(wkDst, f));
  console.log(`.well-known: copied`);
}
```

- [ ] **Step 2: Run aggregation against the real registry**

Run: `cd org-os/site && npm run aggregate`
Expected: prints e.g. `federation.json: 7 nodes, N edges (M enriched)` and `.well-known: copied`. `src/data/federation.json` exists and contains a `root.id === "org-os"`.

- [ ] **Step 3: Confirm full build now works end-to-end**

Run: `cd org-os/site && npm run build`
Expected: aggregation runs, astro build succeeds. (`verify` will fail until Task 14 — temporarily run `npm run aggregate && npx astro build` if needed to confirm.)

- [ ] **Step 4: Commit**

```bash
cd org-os/site
git add scripts/aggregate-federation.mjs
git commit -m "feat(site): federation aggregation CLI + build wiring + .well-known surfacing"
```

---

## Task 7: Federation page — loader, graph, instance cards

**Files:**
- Create: `org-os/site/src/lib/federation.ts`
- Create: `org-os/site/src/components/FederationGraph.astro`
- Create: `org-os/site/src/components/InstanceCard.astro`
- Create: `org-os/site/src/pages/federation.astro`

- [ ] **Step 1: Create the typed loader `src/lib/federation.ts`**

```ts
import federation from "../data/federation.json";

export interface FederationNode {
  id: string; name: string; type: string; maturity: string | null;
  role: string | null; network: string | null; frameworkVersion: string | null;
  packages: string[]; drift: string[]; repo: string | null; notes: string;
  localPath: string | null; available: boolean;
  counts: { members?: number; projects?: number };
}
export interface FederationEdge { from: string; to: string; kind: "framework" | "federation"; }
export interface Federation { root: FederationNode; nodes: FederationNode[]; edges: FederationEdge[]; generatedAt: string; }

export const federationData = federation as unknown as Federation;
```

- [ ] **Step 2: Create `FederationGraph.astro`** (pure deterministic SVG, zero client JS)

```astro
---
import type { Federation } from "../lib/federation";
interface Props { federation: Federation; }
const { federation } = Astro.props;

const W = 640, H = 480, cx = W / 2, cy = H / 2;
// Root at center; all other nodes evenly on a ring.
const ring = [federation.root, ...federation.nodes];
const pos = new Map<string, { x: number; y: number }>();
pos.set(federation.root.id, { x: cx, y: cy });
const others = federation.nodes;
others.forEach((n, i) => {
  const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
  pos.set(n.id, { x: cx + Math.cos(a) * 190, y: cy + Math.sin(a) * 160 });
});
const edgeColor = (k: string) => (k === "federation" ? "var(--color-accent)" : "var(--color-faint)");
---
<svg class="fed-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="org-os federation network">
  {federation.edges.map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    return a && b ? (
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edgeColor(e.kind)} stroke-width="1"
            opacity={e.kind === "federation" ? "0.7" : "0.35"}
            stroke-dasharray={e.kind === "framework" ? "3 3" : "0"} />
    ) : null;
  })}
  {ring.map((n) => {
    const p = pos.get(n.id)!;
    const root = n.id === federation.root.id;
    return (
      <g>
        <circle cx={p.x} cy={p.y} r={root ? 8 : 5}
                fill={root || n.available ? "var(--color-accent)" : "var(--color-surface)"}
                stroke="var(--color-accent)" stroke-width="1.5" />
        <text x={p.x + 10} y={p.y + 3} class="fed-label">{n.id}</text>
      </g>
    );
  })}
</svg>
<style>
.fed-graph { width: 100%; height: auto; display: block; }
.fed-label { font-family: var(--font-mono); font-size: 11px; fill: var(--color-muted); }
</style>
```

- [ ] **Step 3: Create `InstanceCard.astro`**

```astro
---
import type { FederationNode } from "../lib/federation";
interface Props { node: FederationNode; }
const { node } = Astro.props;
---
<article class="surface card">
  <header>
    <span class="mono type">{node.type}</span>
    <h3>{node.name}</h3>
    <span class="mono id">{node.id}{!node.available && <em> · offline</em>}</span>
  </header>
  <p class="notes">{node.notes}</p>
  <dl class="meta mono">
    {node.network && <div><dt>network</dt><dd>{node.network} · {node.role}</dd></div>}
    {node.maturity && <div><dt>maturity</dt><dd>{node.maturity}</dd></div>}
    {node.counts.members !== undefined && <div><dt>members</dt><dd>{node.counts.members}</dd></div>}
    {node.counts.projects !== undefined && <div><dt>projects</dt><dd>{node.counts.projects}</dd></div>}
  </dl>
  {node.repo && <a href={node.repo} class="mono">repo →</a>}
</article>
<style>
.card { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.card h3 { margin: var(--space-1) 0; }
.card .type { font-size: var(--text-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent); }
.card .id { font-size: var(--text-sm); color: var(--color-faint); }
.card .notes { font-size: var(--text-sm); color: var(--color-muted); margin: 0; }
.meta { font-size: var(--text-sm); display: grid; gap: var(--space-1); margin: 0; }
.meta div { display: flex; gap: var(--space-2); }
.meta dt { color: var(--color-faint); min-width: 6rem; } .meta dd { margin: 0; }
</style>
```

- [ ] **Step 4: Create `src/pages/federation.astro`**

```astro
---
import Layout from "../components/Layout.astro";
import FederationGraph from "../components/FederationGraph.astro";
import InstanceCard from "../components/InstanceCard.astro";
import { federationData } from "../lib/federation";
---
<Layout title="Federation" current="federation" description="The org-os federation — instances, networks, and live-at-build state.">
  <div class="container">
    <p class="eyebrow">Federation</p>
    <h1>One OS, many nodes</h1>
    <p class="prose">Each node is a sovereign org-os instance. Edges show framework lineage (dashed) and federation membership (solid). State is aggregated at build from each instance's <code>.well-known/</code>.</p>
    <FederationGraph federation={federationData} />
    <p class="mono faint">Generated {federationData.generatedAt}</p>
    <div class="grid">
      {federationData.nodes.map((node) => <InstanceCard node={node} />)}
    </div>
  </div>
</Layout>
<style>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4); margin-top: var(--space-8); }
.faint { color: var(--color-faint); font-size: var(--text-sm); }
</style>
```

- [ ] **Step 5: Build and verify the federation page**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/federation/index.html` exists and contains `data` for each real instance id (e.g. `refi-bcn-os`, `refi-dao-os`, `regen-coordination-os`) and the string `One OS, many nodes`.

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add src/lib/federation.ts src/components/FederationGraph.astro src/components/InstanceCard.astro src/pages/federation.astro
git commit -m "feat(site): /federation — SVG graph + instance cards from aggregated data"
```

---

## Task 8: Docs — content collection + index + dynamic pages

**Files:**
- Create: `org-os/site/src/data/docs-allowlist.ts`
- Create: `org-os/site/src/content.config.ts`
- Create: `org-os/site/src/pages/docs/index.astro`
- Create: `org-os/site/src/pages/docs/[...slug].astro`

- [ ] **Step 1: Create `src/data/docs-allowlist.ts`** (curation = single source of curation)

```ts
// The curated docs surfaced on-site. `file` matches the markdown filename (without .md)
// in org-os/docs/. The long tail stays repo-only until promoted here.
export interface DocEntry { file: string; slug: string; title: string; group: string; }
export const DOCS_ALLOWLIST: DocEntry[] = [
  { file: "ARCHITECTURE",         slug: "architecture",          title: "Architecture",            group: "Concepts" },
  { file: "AGENTIC-ARCHITECTURE", slug: "agentic-architecture",  title: "Agentic Architecture",    group: "Concepts" },
  { file: "FEDERATION",           slug: "federation",            title: "Federation",              group: "Concepts" },
  { file: "ECOSYSTEM",            slug: "ecosystem",             title: "Ecosystem",               group: "Concepts" },
  { file: "DATA-MODEL",           slug: "data-model",            title: "Data Model",              group: "Reference" },
  { file: "EIP4824-GUIDE",        slug: "eip4824",               title: "EIP-4824 Guide",          group: "Reference" },
  { file: "PACKAGE-LIFECYCLE",    slug: "package-lifecycle",     title: "Package Lifecycle",       group: "Reference" },
  { file: "OPERATOR-GUIDE",       slug: "operator-guide",        title: "Operator Guide",          group: "Operating" },
];
export const docBySlug = (slug: string) => DOCS_ALLOWLIST.find((d) => d.slug === slug);
export const docByFile = (file: string) => DOCS_ALLOWLIST.find((d) => d.file === file);
```

> **Note:** The exact filenames above exist in `org-os/docs/` (verified). Root docs like `AGENTS.md`/`BOOTSTRAP.md` live one level up (`../`), not in `docs/` — defer them to a later widening (they need a second glob base). This keeps Task 8 to a single base.

- [ ] **Step 2: Create `src/content.config.ts`** (glob loader → ../docs)

```ts
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// base resolves relative to the Astro project root (org-os/site). org-os/docs = ../docs.
const docs = defineCollection({
  loader: glob({ pattern: "*.md", base: "../docs" }),
});

export const collections = { docs };
```

- [ ] **Step 3: Create `src/pages/docs/index.astro`**

```astro
---
import Layout from "../../components/Layout.astro";
import { DOCS_ALLOWLIST } from "../../data/docs-allowlist";
const groups = [...new Set(DOCS_ALLOWLIST.map((d) => d.group))];
---
<Layout title="Docs" current="docs" description="org-os documentation — architecture, federation, data model, operating.">
  <div class="container prose">
    <p class="eyebrow">Documentation</p>
    <h1>Docs</h1>
    <p>Curated from the org-os framework docs. The full set lives in the <a href="https://github.com/regen-coordination/org-os-template/tree/main/docs">repo</a>.</p>
    {groups.map((g) => (
      <section>
        <h2>{g}</h2>
        <ul>
          {DOCS_ALLOWLIST.filter((d) => d.group === g).map((d) => (
            <li><a href={`/docs/${d.slug}`}>{d.title}</a></li>
          ))}
        </ul>
      </section>
    ))}
  </div>
</Layout>
```

- [ ] **Step 4: Create `src/pages/docs/[...slug].astro`**

```astro
---
import { getCollection, render } from "astro:content";
import Layout from "../../components/Layout.astro";
import { DOCS_ALLOWLIST, docByFile } from "../../data/docs-allowlist";

export async function getStaticPaths() {
  const all = await getCollection("docs");
  // Only emit routes for allowlisted files; map filename id → friendly slug.
  return all
    .filter((entry) => docByFile(entry.id))
    .map((entry) => {
      const meta = docByFile(entry.id)!;
      return { params: { slug: meta.slug }, props: { entry, meta } };
    });
}
const { entry, meta } = Astro.props;
const { Content } = await render(entry);
---
<Layout title={meta.title} current="docs">
  <div class="container prose">
    <p class="eyebrow">{meta.group}</p>
    <h1>{meta.title}</h1>
    <article class="doc"><Content /></article>
  </div>
</Layout>
<style>
.doc :global(h2) { margin-top: var(--space-8); }
.doc :global(pre) { background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: var(--radius); padding: var(--space-4); overflow-x: auto; }
.doc :global(code) { font-size: var(--text-sm); }
</style>
```

- [ ] **Step 5: Build and verify docs render from a single source**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/docs/index.html` exists; `dist/docs/architecture/index.html` and `dist/docs/federation/index.html` exist and contain real content from `org-os/docs/ARCHITECTURE.md`. Confirm **no markdown files were copied** into `site/` (single source of truth):
Run: `ls org-os/site/src/content 2>/dev/null; find org-os/site -name "ARCHITECTURE.md"`
Expected: no `ARCHITECTURE.md` anywhere under `site/`.

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add src/data/docs-allowlist.ts src/content.config.ts src/pages/docs/
git commit -m "feat(site): /docs — curated content collection from ../docs (single source of truth)"
```

---

## Task 9: Modules roadmap

**Files:**
- Create: `org-os/site/src/data/modules.yaml`
- Create: `org-os/site/src/components/StatusBadge.astro`
- Create: `org-os/site/src/components/ModuleCard.astro`
- Create: `org-os/site/src/pages/modules.astro`

- [ ] **Step 1: Create `src/data/modules.yaml`**

```yaml
# v0.5 module roadmap. status: planned | in-dev | live
modules:
  - id: org-os-website-generator
    name: Website Generator
    status: in-dev
    summary: Turn any instance's data + docs into a federated site. This very site is its first reference output.
    link: /docs/architecture
  - id: org-os-kms
    name: Knowledge Management System
    status: planned
    summary: Compiled, indexed, linted knowledge commons across the federation.
    link: null
  - id: rad-org-os
    name: rad-org-os
    status: in-dev
    summary: Radicle-native sovereign p2p infrastructure for grassroots orgs.
    link: null
  - id: org-os-hermes
    name: Hermes Agent
    status: in-dev
    summary: Local agent runtime + Telegram gateway, replacing OpenClaw.
    link: null
  - id: org-os-members-hub
    name: Members Hub
    status: planned
    summary: Membership, roles, and contribution surfaces for instances.
    link: null
  - id: org-os-ideation
    name: Ideation System
    status: planned
    summary: Idea capture → triage → hatching pipeline, federated.
    link: null
```

- [ ] **Step 2: Create `StatusBadge.astro`**

```astro
---
interface Props { status: "planned" | "in-dev" | "live"; }
const { status } = Astro.props;
const label = { planned: "Planned", "in-dev": "In dev", live: "Live" }[status];
---
<span class:list={["badge", status]}>{label}</span>
<style>
.badge { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.08em;
  text-transform: uppercase; padding: 2px var(--space-2); border-radius: var(--radius-sm);
  border: 1px solid var(--color-line); }
.badge.live { background: var(--color-accent); color: var(--color-accent-ink); border-color: var(--color-accent); }
.badge.in-dev { color: var(--color-accent); border-color: var(--color-accent); }
.badge.planned { color: var(--color-faint); }
</style>
```

- [ ] **Step 3: Create `ModuleCard.astro`**

```astro
---
import StatusBadge from "./StatusBadge.astro";
interface Props { id: string; name: string; status: "planned" | "in-dev" | "live"; summary: string; link: string | null; }
const { id, name, status, summary, link } = Astro.props;
---
<article class="surface card">
  <header><span class="mono id">{id}</span><StatusBadge status={status} /></header>
  <h3>{name}</h3>
  <p>{summary}</p>
  {link && <a href={link} class="mono">learn more →</a>}
</article>
<style>
.card { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.card header { display: flex; justify-content: space-between; align-items: center; }
.card .id { font-size: var(--text-xs); color: var(--color-faint); }
.card h3 { margin: 0; } .card p { margin: 0; font-size: var(--text-sm); color: var(--color-muted); }
</style>
```

- [ ] **Step 4: Create `src/pages/modules.astro`**

```astro
---
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import Layout from "../components/Layout.astro";
import ModuleCard from "../components/ModuleCard.astro";
interface Module { id: string; name: string; status: "planned" | "in-dev" | "live"; summary: string; link: string | null; }
const doc = yaml.load(readFileSync(new URL("../data/modules.yaml", import.meta.url), "utf8")) as { modules: Module[] };
const modules = doc.modules;
---
<Layout title="Modules" current="modules" description="The org-os v0.5 module roadmap.">
  <div class="container">
    <p class="eyebrow">v0.5 roadmap</p>
    <h1>Modules</h1>
    <p class="prose">org-os v0.5 is a constellation of modules. Status is honest — badges show what ships today vs. what's planned.</p>
    <div class="grid">{modules.map((m) => <ModuleCard {...m} />)}</div>
  </div>
</Layout>
<style>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4); margin-top: var(--space-8); }
</style>
```

- [ ] **Step 5: Build and verify**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/modules/index.html` exists and contains `org-os-website-generator`, `org-os-kms`, and the badge labels `In dev` / `Planned`.

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add src/data/modules.yaml src/components/StatusBadge.astro src/components/ModuleCard.astro src/pages/modules.astro
git commit -m "feat(site): /modules — v0.5 roadmap with honest status badges"
```

---

## Task 10: Home page — hero, federation-at-a-glance, modules teaser

**Files:**
- Create: `org-os/site/src/data/landing.yaml`
- Create: `org-os/site/src/components/Hero.astro`
- Create: `org-os/site/src/components/SectionBlock.astro`
- Modify: `org-os/site/src/pages/index.astro` (replace scaffold)

- [ ] **Step 1: Create `src/data/landing.yaml`**

```yaml
eyebrow: "Framework · standards · orchestration hub"
title: "The agent-native org operating system"
subtitle: "One OS, many nodes. Shared standards, sovereign instances — fork it, federate, run your org agent-natively."
ctas:
  - { label: "$ npm run setup", href: "/get-started", variant: "solid" }
  - { label: "/docs", href: "/docs", variant: "ghost" }
  - { label: "/federation", href: "/federation", variant: "ghost" }
```

- [ ] **Step 2: Create `Hero.astro`**

```astro
---
import Button from "./Button.astro";
interface Cta { label: string; href: string; variant: "solid" | "ghost"; }
interface Props { eyebrow: string; title: string; subtitle: string; ctas: Cta[]; statline?: string; }
const { eyebrow, title, subtitle, ctas, statline } = Astro.props;
---
<header class="hero">
  <p class="eyebrow mono">~/org-os $ {eyebrow}</p>
  <h1>{title}</h1>
  <p class="subtitle prose">{subtitle}</p>
  <div class="ctas">{ctas.map((c) => <Button href={c.href} variant={c.variant}>{c.label}</Button>)}</div>
  {statline && <p class="mono statline">{statline}</p>}
</header>
<style>
.hero { padding: var(--space-16) 0 var(--space-12); }
.hero h1 { font-size: var(--text-4xl); margin: var(--space-4) 0; max-width: 16ch; }
.subtitle { font-size: var(--text-md); color: var(--color-muted); }
.ctas { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-6); }
.statline { color: var(--color-faint); font-size: var(--text-sm); margin-top: var(--space-8); }
</style>
```

- [ ] **Step 3: Create `SectionBlock.astro`**

```astro
---
interface Props { eyebrow?: string; title: string; href?: string; cta?: string; }
const { eyebrow, title, href, cta } = Astro.props;
---
<section class="block container">
  <div class="head">
    <div>{eyebrow && <p class="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>
    {href && cta && <a href={href} class="mono">{cta} →</a>}
  </div>
  <slot />
</section>
<style>
.block { margin: var(--space-16) auto; }
.head { display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid var(--color-line); padding-bottom: var(--space-3); margin-bottom: var(--space-6); }
</style>
```

- [ ] **Step 4: Replace `src/pages/index.astro`**

```astro
---
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import Layout from "../components/Layout.astro";
import Hero from "../components/Hero.astro";
import SectionBlock from "../components/SectionBlock.astro";
import FederationGraph from "../components/FederationGraph.astro";
import ModuleCard from "../components/ModuleCard.astro";
import { federationData } from "../lib/federation";

const landing = yaml.load(readFileSync(new URL("../data/landing.yaml", import.meta.url), "utf8")) as any;
const mod = yaml.load(readFileSync(new URL("../data/modules.yaml", import.meta.url), "utf8")) as any;
const teaserModules = mod.modules.slice(0, 3);
const statline = `${federationData.nodes.length} instances · framework v3.x · EIP-4824`;
---
<Layout title="Home" current="home">
  <div class="container">
    <Hero eyebrow={landing.eyebrow} title={landing.title} subtitle={landing.subtitle} ctas={landing.ctas} statline={statline} />
  </div>
  <SectionBlock eyebrow="Federation" title="One OS, many nodes" href="/federation" cta="Explore the network">
    <FederationGraph federation={federationData} />
  </SectionBlock>
  <SectionBlock eyebrow="v0.5 roadmap" title="Modules" href="/modules" cta="See all modules">
    <div class="grid">{teaserModules.map((m: any) => <ModuleCard {...m} />)}</div>
  </SectionBlock>
</Layout>
<style>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); }
</style>
```

- [ ] **Step 5: Build and verify the home page**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/index.html` contains `The agent-native`, the statline `instances · framework v3.x`, and at least 3 module ids.

- [ ] **Step 6: Commit**

```bash
cd org-os/site
git add src/data/landing.yaml src/components/Hero.astro src/components/SectionBlock.astro src/pages/index.astro
git commit -m "feat(site): home — hero + federation-at-a-glance + modules teaser"
```

---

## Task 11: Get-started page

**Files:**
- Create: `org-os/site/src/pages/get-started.astro`

- [ ] **Step 1: Create `src/pages/get-started.astro`**

```astro
---
import Layout from "../components/Layout.astro";
const repo = "https://github.com/regen-coordination/org-os-template";
const steps = [
  { n: "01", title: "Clone the framework", body: "Use the cloning engine to scaffold a new instance with package + skill selection.", code: "node scripts/clone-framework.mjs --target ../my-org --config config.yaml" },
  { n: "02", title: "Or run the guided interview", body: "Prefer a wizard? The interactive setup walks you through identity capture.", code: "npm run setup" },
  { n: "03", title: "Open a session", body: "Read MASTERPLAN.md, SOUL.md, IDENTITY.md, then initialize.", code: "/initialize" },
];
---
<Layout title="Get started" current="get-started" description="Spin up your own org-os instance.">
  <div class="container prose">
    <p class="eyebrow">Operators</p>
    <h1>Give your org an operating system</h1>
    <p>org-os is the canonical template. Downstream instances fork or sync from it. Requirements: Node ≥22, npm ≥10.9.2, git.</p>
    {steps.map((s) => (
      <section class="step">
        <span class="mono n">{s.n}</span>
        <div><h3>{s.title}</h3><p>{s.body}</p><pre class="mono">{s.code}</pre></div>
      </section>
    ))}
    <p>Next: read the <a href={`${repo}/blob/main/BOOTSTRAP.md`}>BOOTSTRAP</a> sequence and the <a href="/docs/operator-guide">Operator Guide</a>.</p>
  </div>
</Layout>
<style>
.step { display: flex; gap: var(--space-4); margin: var(--space-8) 0; }
.step .n { color: var(--color-accent); font-size: var(--text-lg); }
.step pre { background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: var(--radius); padding: var(--space-3); overflow-x: auto; font-size: var(--text-sm); }
</style>
```

- [ ] **Step 2: Build and verify**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/get-started/index.html` exists and contains `clone-framework.mjs` and `npm run setup`.

- [ ] **Step 3: Commit**

```bash
cd org-os/site
git add src/pages/get-started.astro
git commit -m "feat(site): /get-started — operator clone/bootstrap path"
```

---

## Task 12: About page

**Files:**
- Create: `org-os/site/src/pages/about.astro`

- [ ] **Step 1: Create `src/pages/about.astro`**

```astro
---
import Layout from "../components/Layout.astro";
---
<Layout title="About" current="about" description="What org-os is, why it exists, and who builds it.">
  <div class="container prose">
    <p class="eyebrow">About</p>
    <h1>The substrate beneath the regen federation</h1>
    <p>org-os is a framework, a set of standards, and an orchestration hub for a federation of regenerative organizations. The framework is itself an org-os instance — self-hosting since 2026.</p>
    <h2>Why</h2>
    <p>Grassroots and regenerative orgs need operational infrastructure that is sovereign, agent-native, and interoperable. org-os gives each org a working operating system while keeping every instance independent and federated.</p>
    <h2>How it federates</h2>
    <p>Instances publish structured data (<code>data/*.yaml</code>) and EIP-4824 schemas (<code>.well-known/</code>). The framework tracks the network in a registry; this site aggregates it live at build. See <a href="/federation">Federation</a> and the <a href="/docs/federation">Federation docs</a>.</p>
    <h2>License</h2>
    <p>MIT. Source on <a href="https://github.com/regen-coordination/org-os-template">GitHub</a>.</p>
  </div>
</Layout>
```

- [ ] **Step 2: Build and verify**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/about/index.html` exists and contains `The substrate beneath the regen federation`.

- [ ] **Step 3: Commit**

```bash
cd org-os/site
git add src/pages/about.astro
git commit -m "feat(site): /about — mission, federation, license"
```

---

## Task 13: Machine layer — llms.txt + federation.json endpoint

**Files:**
- Create: `org-os/site/src/pages/llms.txt.ts`
- Create: `org-os/site/src/pages/federation.json.ts`
- Create: `org-os/site/public/favicon.svg`

- [ ] **Step 1: Create `src/pages/llms.txt.ts`**

```ts
import type { APIRoute } from "astro";
import { DOCS_ALLOWLIST } from "../data/docs-allowlist";

export const GET: APIRoute = ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const lines = [
    "# org-os",
    "> The agent-native org operating system — framework, standards, and orchestration hub for a federation of regenerative organizations.",
    "",
    "## Pages",
    `- [Home](${base}/): what org-os is`,
    `- [Modules](${base}/modules): v0.5 module roadmap`,
    `- [Federation](${base}/federation): live network of instances`,
    `- [Get started](${base}/get-started): spin up an instance`,
    `- [About](${base}/about): mission and federation model`,
    "",
    "## Docs",
    ...DOCS_ALLOWLIST.map((d) => `- [${d.title}](${base}/docs/${d.slug}): ${d.group}`),
    "",
    "## Machine-readable",
    `- [Federation data](${base}/federation.json): aggregated instance registry + edges`,
    `- [.well-known/](${base}/.well-known/): EIP-4824 schemas`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
```

- [ ] **Step 2: Create `src/pages/federation.json.ts`**

```ts
import type { APIRoute } from "astro";
import { federationData } from "../lib/federation";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(federationData, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
```

- [ ] **Step 3: Create a minimal `public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#fbfbf9"/><circle cx="16" cy="16" r="5" fill="#1f883d"/><g stroke="#1f883d" stroke-width="1.5"><line x1="16" y1="16" x2="26" y2="8"/><line x1="16" y1="16" x2="6" y2="10"/><line x1="16" y1="16" x2="22" y2="26"/></g></svg>
```

- [ ] **Step 4: Build and verify the machine layer**

Run: `cd org-os/site && npm run aggregate && npx astro build`
Expected: `dist/llms.txt` exists and contains `# org-os` + doc slugs; `dist/federation.json` exists and parses as JSON with `root.id === "org-os"`; `dist/.well-known/` contains copied `*.json` files.

- [ ] **Step 5: Commit**

```bash
cd org-os/site
git add src/pages/llms.txt.ts src/pages/federation.json.ts public/favicon.svg
git commit -m "feat(site): machine layer — llms.txt + federation.json endpoint + favicon"
```

---

## Task 14: Build verification + federation resilience

**Files:**
- Create: `org-os/site/scripts/verify-build.mjs`

- [ ] **Step 1: Implement `scripts/verify-build.mjs`**

```js
// verify-build.mjs — integrity checks on the static build. Runs after `astro build`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const REQUIRED = [
  "index.html",
  "modules/index.html",
  "federation/index.html",
  "docs/index.html",
  "docs/architecture/index.html",
  "docs/federation/index.html",
  "get-started/index.html",
  "about/index.html",
  "llms.txt",
  "federation.json",
];
let failed = false;
for (const p of REQUIRED) {
  const full = join(DIST, p);
  if (!existsSync(full)) { console.error(`MISSING: ${full}`); failed = true; }
  else console.log(`OK:      ${full}`);
}

// federation.json shape check
try {
  const fed = JSON.parse(readFileSync(join(DIST, "federation.json"), "utf8"));
  if (fed.root?.id !== "org-os") { console.error("federation.json: root.id !== org-os"); failed = true; }
  if (!Array.isArray(fed.nodes) || fed.nodes.length === 0) { console.error("federation.json: no nodes"); failed = true; }
  else console.log(`federation.json: ${fed.nodes.length} nodes OK`);
} catch (e) { console.error(`federation.json: unreadable — ${e.message}`); failed = true; }

// Internal link check: docs index links resolve to built pages.
const docsIndex = readFileSync(join(DIST, "docs/index.html"), "utf8");
for (const m of docsIndex.matchAll(/href="(\/docs\/[a-z0-9-]+)"/g)) {
  const target = join(DIST, m[1].replace(/^\//, ""), "index.html");
  if (!existsSync(target)) { console.error(`BROKEN LINK: ${m[1]} → ${target}`); failed = true; }
}
console.log("link check: done");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the full build + verify**

Run: `cd org-os/site && npm run build`
Expected: aggregation → astro build → verify all pass; final `process.exit(0)`.

- [ ] **Step 3: Federation resilience check (graceful degradation at the real boundary)**

Temporarily rename one sibling instance dir to simulate absence, then build:
Run: `mv "../refi-med-os" "../refi-med-os.bak" && npm run build; mv "../refi-med-os.bak" "../refi-med-os"`
Expected: build still succeeds (exit 0); `dist/federation.json` shows the `refi-med-os` node with `"available": false`. (The rename is reverted on the same line.)

> If `refi-med-os` is not present locally, substitute any cloned sibling from `data/instances.yaml`. Do not rename a dir you cannot restore.

- [ ] **Step 4: Commit**

```bash
cd org-os/site
git add scripts/verify-build.mjs
git commit -m "feat(site): build verification + federation resilience check"
```

---

## Task 15: Site README + plan registration

**Files:**
- Create: `org-os/site/README.md`
- Modify: `org-os/docs/agent-plans/QUEUE.md`

- [ ] **Step 1: Create `org-os/site/README.md`**

```markdown
# org-os site

The org-os framework website + docs + live federation — one static Astro site.

## Run
\`\`\`bash
npm install        # one-time
npm run dev        # aggregates federation.json, then http://localhost:4321
npm run build      # aggregate → astro build → verify  (static site → dist/)
npm test           # unit tests for the federation aggregator
\`\`\`

## How it works
- **Docs** render from \`../docs/*.md\` via Astro's \`glob()\` content loader (single source of truth; curated in \`src/data/docs-allowlist.ts\`).
- **Federation** is aggregated at build by \`scripts/aggregate-federation.mjs\` from \`../data/instances.yaml\` + each sibling instance's \`.well-known/\` → \`src/data/federation.json\`. A missing sibling degrades gracefully (node flagged \`available: false\`); the build never fails.
- **Theme**: light "systems" theme. Palette/fonts/radius live in \`src/styles/themes/systems.css\`; swap the one \`@import\` in \`theme.css\` to retheme (a \`systems-dark.css\` stub proves the swap).

## The generator seam
\`src/styles\` + \`src/components\` + \`scripts/\` are the reusable core; \`src/data/*.yaml\` is org-os's own content. This split is the basis for the future \`org-os-website-generator\` module.

Built by the org-os framework. MIT.
```

- [ ] **Step 2: Mark the plan written in `org-os/docs/agent-plans/QUEUE.md`**

In the Active section, on the `org-os-website` entry, change `implementation plan: **pending** (writing-plans next)` to:
`implementation plan: [\`2026-06-17-org-os-website.md\`](../superpowers/plans/2026-06-17-org-os-website.md) (15 tasks)`

- [ ] **Step 3: Commit**

```bash
cd "org-os"
git add site/README.md docs/agent-plans/QUEUE.md
git commit -m "docs(site): README + register implementation plan in queue"
```

---

## Self-Review

**Spec coverage** (spec §-by-§):
- §1 scope (site only, modules as roadmap) → Tasks 8–9 present docs + modules; modules are data-only cards. ✓
- §2 audiences (5, layered) → home/modules (vision+funders), federation (ecosystem), get-started (operators), docs (devs), llms.txt+.well-known+federation.json (agents). ✓ (Tasks 7, 8, 10, 11, 13)
- §3 location org-os/site + reusable/instance split → Task 1 + README §generator seam. ✓
- §4 IA (6 routes + machine layer) → Tasks 7,8,9,10,11,12,13. ✓
- §5 theming (light systems, token/theme-swap, dark second theme) → Tasks 2,3. ✓
- §6 components (adapt patterns) → Tasks 4,7,9,10. ✓
- §7 docs (glob loader ../docs, curated allowlist) → Task 8. ✓
- §8 federation (build-time aggregate, graceful degradation, seam) → Tasks 5,6; resilience proven Task 14 step 3. ✓
- §9 modules roadmap (modules.yaml, status badges) → Task 9. ✓
- §10 machine layer (llms.txt, .well-known, federation.json) → Tasks 6 (copy) + 13. ✓
- §11 tech stack → Task 1 (note: d3 dropped — graph is pure SVG, Task 7; documented in plan header). ✓
- §12 testing/verification → Task 5 (unit) + Task 14 (build/link/shape/resilience). ✓
- §15 acceptance criteria 1–8 → builds (Task 14), 6 routes (Tasks 7–12), single-source docs (Task 8 step 5), federation + degradation (Tasks 7,14), modules badges (Task 9), machine layer (Task 13), one-line theme swap (Task 3). ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every code step is complete. The domain in `astro.config.mjs` uses an explicit placeholder value with a spec-§16 reference (open decision, not a code gap). ✓

**Type consistency:** `FederationNode`/`FederationEdge`/`Federation` defined in `lib/federation.ts` (Task 7) match the object shape emitted by `federation-aggregate.mjs` (Task 5: `id,name,type,maturity,role,network,frameworkVersion,packages,drift,repo,notes,localPath,available,counts`) and consumed by `FederationGraph`/`InstanceCard`. `DocEntry`/`docByFile`/`docBySlug` (Task 8) used consistently in `docs/[...slug].astro` + `llms.txt.ts`. Module shape consistent across `modules.yaml` → `ModuleCard` → `index.astro` teaser. ✓

**Deviation from spec noted:** spec §11 lists `d3`; the plan drops it (federation graph is pure deterministic SVG per `NeuralWeb.astro` precedent — fewer deps, zero client JS). This is an improvement within the spec's intent and is recorded here.
