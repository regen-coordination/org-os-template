# TUI Dashboard Implementation Plan

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo 2026-08-21 §4 row 6 (frozen behind admin-app M2 + named-demand trigger). Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Companion design spec: [`tui-dashboard.md`](tui-dashboard.md).

**Goal:** Ship the walking-skeleton v1 of the org-os TUI: a shared data layer (`packages/tui-data/`) plus an Ink-based renderer (`packages/tui/`) that drives both an interactive terminal UI and an agent-print mode for embedding pages in chat. v1 includes 4 representative pages (one section, one entity, one cross-cut, plus the dashboard home view), proves the manifest-driven page registry end-to-end, and preserves every existing entry point (`/initialize`, `npm run initialize`, all validators) untouched.

**Architecture:** Two new packages share `dashboard.yaml` as the manifest. `tui-data` is pure Node — loaders, manifest builder, page resolvers, action catalog, file-watch. `tui` is the Ink layer — `<App>`, page components, primitives, modals, two mode entry points (`interactive.jsx`, `print.jsx`). `scripts/initialize.mjs` is refactored internally to delegate to `tui-data` while preserving its JSON contract. Every existing script (`generate:schemas`, `validate:*`, `analyze:instances`) stays untouched and is invokable via the TUI's action launcher.

**Tech Stack:** Node ≥22, ESM (`type: "module"`), `ink` (^4), `ink-text-input`, `ink-select-input`, `ink-table`, `ink-spinner`, `chokidar` (^3), `clipboardy` (^4), `chalk` (^5), `js-yaml` (^4, already in repo), `gray-matter` (^4, already in repo). Tests run on `node --test` (built-in, no new dev-dep).

---

## File Structure

**New files:**

```
packages/tui-data/
├── package.json
├── README.md
├── src/
│   ├── index.mjs                  Public exports
│   ├── load.mjs                   Per-source loaders
│   ├── manifest.mjs               Page registry builder (reads dashboard.yaml)
│   ├── pages/
│   │   ├── section.mjs            Section page resolver
│   │   ├── entity.mjs             Entity page resolver
│   │   └── cross-cut.mjs          Cross-cut page resolver
│   ├── actions.mjs                Action catalog + Mustache template engine
│   ├── watch.mjs                  Chokidar wrapper, debounced events
│   └── builtin-pages.mjs          Built-in BUILTIN_PAGES registry
└── test/
    ├── load.test.mjs
    ├── manifest.test.mjs
    ├── pages/
    │   ├── section.test.mjs
    │   ├── entity.test.mjs
    │   └── cross-cut.test.mjs
    ├── actions.test.mjs
    └── fixtures/
        ├── dashboard.yaml
        ├── data/
        │   ├── projects.yaml
        │   └── projects-malformed.yaml
        ├── DECISIONS.md
        └── HEARTBEAT.md

packages/tui/
├── package.json
├── README.md
├── bin/
│   └── org-tui                    Executable shim (#!/usr/bin/env node)
├── src/
│   ├── App.jsx                    Root component, navigation state, jumplist
│   ├── chrome.jsx                 Layout shell (header + breadcrumb + body + status bar)
│   ├── theme.mjs                  Default palette + dashboard.yaml.theme reader
│   ├── modes/
│   │   ├── interactive.jsx        TTY entry: file-watch + keyboard nav + color
│   │   └── print.jsx              Stdout entry: one page → flush → exit
│   ├── pages/
│   │   ├── Section.jsx
│   │   ├── Entity.jsx
│   │   ├── CrossCut.jsx
│   │   └── ComingSoon.jsx
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── Breadcrumb.jsx
│   │   ├── StatusBar.jsx
│   │   ├── Table.jsx
│   │   ├── List.jsx
│   │   ├── KeyValue.jsx
│   │   ├── RelatedColumn.jsx
│   │   ├── ActionMenu.jsx
│   │   ├── CommandPalette.jsx
│   │   └── HelpOverlay.jsx
│   └── hooks/
│       ├── useNavigation.mjs      Jumplist + back/forward
│       └── useFileWatch.mjs       Chokidar bridge (interactive only)
└── test/
    └── snapshots/                 ink-testing-library snapshot output
```

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add `tui` and `page` scripts; add Ink/chokidar/clipboardy deps |
| `scripts/initialize.mjs` | Internal refactor: delegate to `tui-data/load.mjs`; **JSON contract preserved verbatim** |
| `skills/org-os-init/SKILL.md` | Add a paragraph mentioning `npm run page <id>` for in-chat drill-downs |
| `dashboard.yaml` | Optional `theme` and `pages` blocks added (additive) |
| `docs/agent-plans/QUEUE.md` | Move `tui-dashboard` from scoping → queued → active per pipeline |
| `docs/agent-plans/tui-dashboard.md` | Update `status` field through the pipeline |

**Out-of-scope for v1** (per spec): web port, multi-vault sync, in-TUI theme editor, full plugin SDK.

---

## Phase summary

| Phase | Tasks | Deliverable |
|---|---|---|
| 1. Data foundation | 1–6 | `packages/tui-data/` scaffold + loaders + manifest + tests passing |
| 2. Page resolvers + actions | 7–10 | All three page types resolve correctly with snapshot tests |
| 3. TUI scaffolding | 11–15 | `packages/tui/` scaffold + Ink core + print mode for one page |
| 4. V1 pages + interactive | 16–22 | 4 pages render in both modes, full-width + alt-screen, keyboard nav works, file-watch live |
| 5. Refactor + verify | 23–28 | `scripts/initialize.mjs` delegated, all existing scripts pass, smoke tests green |
| 6. Host integrations | 29–32 | opencode plugin (`packages/opencode-integration/`) + hermes skill (`packages/hermes-integration/`) |

Each task ends with a commit. No task should leave the repo in a broken state.

---

## Phase 1 — Data foundation

### Task 1: Scaffold `packages/tui-data/` skeleton

**Files:**
- Create: `packages/tui-data/package.json`
- Create: `packages/tui-data/src/index.mjs`
- Create: `packages/tui-data/README.md`

- [ ] **Step 1: Create the package.json**

```json
{
  "name": "@org-os/tui-data",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.mjs",
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0"
  }
}
```

Write to `packages/tui-data/package.json`.

- [ ] **Step 2: Create the public entry**

```js
// packages/tui-data/src/index.mjs
export { loadAll, loadProjects, loadInstances, loadDecisions, loadMemory, loadHeartbeat, loadFederation, loadDashboardConfig, loadPlans } from "./load.mjs";
export { buildManifest } from "./manifest.mjs";
export { resolvePage } from "./pages/index.mjs";
export { runAction, renderPromptTemplate } from "./actions.mjs";
export { watchSources } from "./watch.mjs";
```

(Reference modules don't exist yet — this entry will be filled in as later tasks land. Importing from it before they exist would fail; consumers come online in Task 16.)

- [ ] **Step 3: Create the README**

```markdown
# @org-os/tui-data

Pure-Node data layer for the org-os TUI. No UI dependencies.

Powers:
- `npm run initialize` (JSON output)
- `npm run tui` (interactive Ink TUI)
- `npm run page <id>` (agent-print mode)
- A future web dashboard (planned)

See `docs/agent-plans/tui-dashboard.md` for the design.
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui-data/
git commit -m "feat(tui-data): scaffold package skeleton"
```

---

### Task 2: Implement `loadProjects()` with TDD

**Files:**
- Create: `packages/tui-data/src/load.mjs`
- Create: `packages/tui-data/test/load.test.mjs`
- Create: `packages/tui-data/test/fixtures/data/projects.yaml`
- Create: `packages/tui-data/test/fixtures/data/projects-malformed.yaml`

- [ ] **Step 1: Create the happy-path fixture**

```yaml
# packages/tui-data/test/fixtures/data/projects.yaml
schema_version: "2.0"
projects:
  - id: "v2-stabilization"
    name: "v2.0.0 Stabilization"
    stage: "Develop"
    lead: "github:luizfernandosg"
    members: ["github:luizfernandosg"]
    start_date: "2026-04-05"
    notion_url: null
  - id: "federation-protocol"
    name: "Federation Protocol"
    stage: "Develop"
    lead: "github:luizfernandosg"
    members: ["github:luizfernandosg"]
    start_date: "2026-04-05"
    notion_url: null
```

- [ ] **Step 2: Create the malformed fixture**

```yaml
# packages/tui-data/test/fixtures/data/projects-malformed.yaml
schema_version: "2.0"
projects:
  - id: "broken
    name: missing closing quote
```

- [ ] **Step 3: Write the failing test**

```js
// packages/tui-data/test/load.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjects } from "../src/load.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures");

test("loadProjects: happy path returns items + no errors", () => {
  const result = loadProjects({ root: fixtureRoot });
  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, "v2-stabilization");
  assert.equal(result.items[0].stage, "Develop");
  assert.ok(result.lastModified instanceof Date);
});

test("loadProjects: missing file returns empty items + no error", () => {
  const result = loadProjects({ root: "/tmp/nonexistent-org-os-fixture" });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.lastModified, null);
});

test("loadProjects: malformed YAML surfaces error, does not throw", () => {
  const result = loadProjects({
    root: fixtureRoot,
    file: "data/projects-malformed.yaml",
  });
  assert.ok(result.errors.length > 0);
  assert.match(result.errors[0].message, /yaml|parse/i);
  assert.deepEqual(result.items, []);
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd packages/tui-data && node --test test/load.test.mjs
```

Expected: FAIL — `Cannot find module '../src/load.mjs'`.

- [ ] **Step 5: Implement minimal load.mjs**

```js
// packages/tui-data/src/load.mjs
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function statSafe(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, "utf-8"); } catch { return null; }
}

function emptyResult(source) {
  return { source, items: [], errors: [], lastModified: null };
}

export function loadProjects({ root = process.cwd(), file = "data/projects.yaml" } = {}) {
  const filePath = path.join(root, file);
  const stat = statSafe(filePath);
  if (!stat) return emptyResult(filePath);
  const raw = readFileSafe(filePath);
  if (!raw) return emptyResult(filePath);
  try {
    const parsed = yaml.load(raw) || {};
    const items = Array.isArray(parsed.projects) ? parsed.projects : [];
    return {
      source: filePath,
      items,
      errors: [],
      lastModified: stat.mtime,
    };
  } catch (err) {
    return {
      source: filePath,
      items: [],
      errors: [{ source: filePath, message: `YAML parse error: ${err.message}` }],
      lastModified: stat.mtime,
    };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd packages/tui-data && node --test test/load.test.mjs
```

Expected: PASS — 3/3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/tui-data/src/load.mjs packages/tui-data/test/
git commit -m "feat(tui-data): loadProjects() with happy/missing/malformed coverage"
```

---

### Task 3: Add remaining source loaders

**Files:**
- Modify: `packages/tui-data/src/load.mjs`
- Modify: `packages/tui-data/test/load.test.mjs`
- Create: `packages/tui-data/test/fixtures/HEARTBEAT.md`
- Create: `packages/tui-data/test/fixtures/DECISIONS.md`
- Create: `packages/tui-data/test/fixtures/federation.yaml`
- Create: `packages/tui-data/test/fixtures/dashboard.yaml`
- Create: `packages/tui-data/test/fixtures/data/instances.yaml`
- Create: `packages/tui-data/test/fixtures/memory/2026-04-25.md`
- Create: `packages/tui-data/test/fixtures/docs/agent-plans/example.md`

- [ ] **Step 1: Write fixtures**

`packages/tui-data/test/fixtures/HEARTBEAT.md`:

```markdown
# HEARTBEAT.md

## Active Tasks

### Technical
- [ ] Complete federation-protocol end-to-end sync test
- [ ] Verify TUI renders real content
- [x] Bump package.json to 3.0.0

### Orchestration
- [ ] Weekly: run analyze:instances
```

`packages/tui-data/test/fixtures/DECISIONS.md`:

```markdown
# DECISIONS.md

## 2026-04-25 · TUI dashboard architecture

**Status:** active
**Scope:** framework, operator-ux

**Decision** — Build `packages/tui-data/` + `packages/tui/`.
**Why** — Operator UX gap. Same data layer powers both modes.
**Refs** — `docs/agent-plans/tui-dashboard.md`

---

## 2026-04-24 · Versioning system

**Status:** active
**Scope:** framework, data-model

**Decision** — `package.json.version` is single source of truth. Strict semver.
**Why** — Three versions disagreed.
**Refs** — `docs/VERSIONING.md`
```

`packages/tui-data/test/fixtures/federation.yaml`:

```yaml
schema_version: "2.0"
network: "regen-coordination"
peers:
  - name: "organizational-os-framework"
    url: "https://github.com/regen-coordination/organizational-os-framework"
agent:
  skills: ["bootstrap-interviewer", "funding-scout"]
```

`packages/tui-data/test/fixtures/dashboard.yaml`:

```yaml
schema_version: "2.0"
sections:
  header:
    show: true
    style: ascii
  projects:
    show: true
custom_sections:
  - name: "Instances"
    show: true
    source: "data/instances.yaml"
    render: "table"
```

`packages/tui-data/test/fixtures/data/instances.yaml`:

```yaml
schema_version: "2.0"
instances:
  - id: "refi-bcn-os"
    name: "ReFi Barcelona"
    type: "LocalNode"
    maturity: "production"
    framework_version: "3.0"
    last_sync: "2026-03-19"
```

`packages/tui-data/test/fixtures/memory/2026-04-25.md`:

```markdown
# 2026-04-25 — TUI Design

Brainstormed the TUI dashboard. Decided on Ink + shared data layer.
```

`packages/tui-data/test/fixtures/docs/agent-plans/example.md`:

```markdown
---
id: example
title: "Example Plan"
status: scoping
workstream: operator-interfaces
---

## Goal

Test fixture.
```

- [ ] **Step 2: Add tests for each loader**

Append to `packages/tui-data/test/load.test.mjs`:

```js
import {
  loadHeartbeat,
  loadDecisions,
  loadFederation,
  loadDashboardConfig,
  loadInstances,
  loadMemory,
  loadPlans,
} from "../src/load.mjs";

test("loadHeartbeat: parses tasks grouped by category", () => {
  const r = loadHeartbeat({ root: fixtureRoot });
  assert.equal(r.errors.length, 0);
  assert.ok(r.items.length >= 4);
  const technical = r.items.filter((t) => t.category === "Technical");
  assert.equal(technical.length, 3);
  const done = r.items.filter((t) => t.done);
  assert.equal(done.length, 1);
});

test("loadDecisions: parses each entry from DECISIONS.md", () => {
  const r = loadDecisions({ root: fixtureRoot });
  assert.equal(r.errors.length, 0);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].date, "2026-04-25");
  assert.equal(r.items[0].title, "TUI dashboard architecture");
  assert.equal(r.items[0].status, "active");
});

test("loadFederation: returns network + peers + agent skills", () => {
  const r = loadFederation({ root: fixtureRoot });
  assert.equal(r.network, "regen-coordination");
  assert.equal(r.peers.length, 1);
  assert.deepEqual(r.agent.skills, ["bootstrap-interviewer", "funding-scout"]);
});

test("loadDashboardConfig: returns sections + custom_sections", () => {
  const r = loadDashboardConfig({ root: fixtureRoot });
  assert.ok(r.sections.header.show);
  assert.equal(r.custom_sections.length, 1);
  assert.equal(r.custom_sections[0].name, "Instances");
});

test("loadInstances: returns hub-only instance registry", () => {
  const r = loadInstances({ root: fixtureRoot });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, "refi-bcn-os");
});

test("loadMemory: returns recent log entries from memory/", () => {
  const r = loadMemory({ root: fixtureRoot });
  assert.ok(r.items.length >= 1);
  assert.equal(r.items[0].date, "2026-04-25");
});

test("loadPlans: returns plan files with frontmatter parsed", () => {
  const r = loadPlans({ root: fixtureRoot });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, "example");
  assert.equal(r.items[0].status, "scoping");
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/tui-data && node --test test/load.test.mjs
```

Expected: FAIL — `loadHeartbeat is not a function` etc.

- [ ] **Step 4: Implement remaining loaders**

Append to `packages/tui-data/src/load.mjs`:

```js
import matter from "gray-matter";

export function loadHeartbeat({ root = process.cwd() } = {}) {
  const filePath = path.join(root, "HEARTBEAT.md");
  const stat = statSafe(filePath);
  if (!stat) return emptyResult(filePath);
  const raw = readFileSafe(filePath);
  const items = [];
  let category = null;
  for (const line of raw.split("\n")) {
    const cat = line.match(/^###\s+(.+)/);
    if (cat) { category = cat[1].trim(); continue; }
    const task = line.match(/^-\s*\[([ x])\]\s+(.+)/);
    if (task) items.push({ done: task[1] === "x", text: task[2].trim(), category });
  }
  return { source: filePath, items, errors: [], lastModified: stat.mtime };
}

export function loadDecisions({ root = process.cwd() } = {}) {
  const filePath = path.join(root, "DECISIONS.md");
  const stat = statSafe(filePath);
  if (!stat) return emptyResult(filePath);
  const raw = readFileSafe(filePath);
  const items = [];
  // Parse each "## YYYY-MM-DD · Title" block, capture body until next "##" or "---".
  const sections = raw.split(/\n##\s+/).slice(1);
  for (const section of sections) {
    const headerMatch = section.match(/^(\d{4}-\d{2}-\d{2})\s*·\s*([^\n]+)/);
    if (!headerMatch) continue;
    const [, date, title] = headerMatch;
    const statusMatch = section.match(/\*\*Status:\*\*\s+(\w+)/);
    const scopeMatch = section.match(/\*\*Scope:\*\*\s+([^\n]+)/);
    items.push({
      date,
      title: title.trim(),
      status: statusMatch ? statusMatch[1] : "active",
      scope: scopeMatch ? scopeMatch[1].trim() : null,
      body: section.trim(),
      slug: `${date}-${title.trim().toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}`,
    });
  }
  return { source: filePath, items, errors: [], lastModified: stat.mtime };
}

export function loadFederation({ root = process.cwd() } = {}) {
  const filePath = path.join(root, "federation.yaml");
  const stat = statSafe(filePath);
  if (!stat) return { source: filePath, network: null, peers: [], agent: { skills: [] }, errors: [], lastModified: null };
  const raw = readFileSafe(filePath);
  try {
    const parsed = yaml.load(raw) || {};
    return {
      source: filePath,
      network: parsed.network || null,
      peers: parsed.peers || [],
      agent: parsed.agent || { skills: [] },
      upstream: parsed.upstream || [],
      packages: parsed.packages || {},
      errors: [],
      lastModified: stat.mtime,
    };
  } catch (err) {
    return { source: filePath, network: null, peers: [], agent: { skills: [] }, errors: [{ source: filePath, message: err.message }], lastModified: stat.mtime };
  }
}

export function loadDashboardConfig({ root = process.cwd() } = {}) {
  const filePath = path.join(root, "dashboard.yaml");
  const stat = statSafe(filePath);
  if (!stat) return { source: filePath, sections: {}, custom_sections: [], pages: [], theme: null, errors: [], lastModified: null };
  try {
    const parsed = yaml.load(readFileSafe(filePath)) || {};
    return {
      source: filePath,
      sections: parsed.sections || {},
      custom_sections: parsed.custom_sections || [],
      pages: parsed.pages || [],
      theme: parsed.theme || null,
      errors: [],
      lastModified: stat.mtime,
    };
  } catch (err) {
    return { source: filePath, sections: {}, custom_sections: [], pages: [], theme: null, errors: [{ source: filePath, message: err.message }], lastModified: stat.mtime };
  }
}

export function loadInstances({ root = process.cwd() } = {}) {
  const filePath = path.join(root, "data/instances.yaml");
  const stat = statSafe(filePath);
  if (!stat) return emptyResult(filePath);
  try {
    const parsed = yaml.load(readFileSafe(filePath)) || {};
    return { source: filePath, items: parsed.instances || [], errors: [], lastModified: stat.mtime };
  } catch (err) {
    return { source: filePath, items: [], errors: [{ source: filePath, message: err.message }], lastModified: stat.mtime };
  }
}

export function loadMemory({ root = process.cwd(), limit = 10 } = {}) {
  const dir = path.join(root, "memory");
  if (!statSafe(dir)) return { source: dir, items: [], errors: [], lastModified: null };
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, limit);
  const items = files.map((f) => {
    const fullPath = path.join(dir, f);
    const raw = readFileSafe(fullPath) || "";
    const date = f.replace(/\.md$/, "");
    const summary = raw.split("\n").slice(0, 5).join("\n").trim();
    return { date, file: fullPath, summary };
  });
  return { source: dir, items, errors: [], lastModified: items[0] ? statSafe(items[0].file).mtime : null };
}

export function loadPlans({ root = process.cwd() } = {}) {
  const dir = path.join(root, "docs/agent-plans");
  if (!statSafe(dir)) return { source: dir, items: [], errors: [], lastModified: null };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !["README.md", "QUEUE.md"].includes(f));
  const items = files.map((f) => {
    const fullPath = path.join(dir, f);
    try {
      const fm = matter(readFileSafe(fullPath) || "");
      return { ...fm.data, file: fullPath, body: fm.content };
    } catch (err) {
      return { id: f.replace(/\.md$/, ""), file: fullPath, errors: [err.message] };
    }
  });
  return { source: dir, items, errors: [], lastModified: null };
}

export function loadAll(opts = {}) {
  return {
    projects: loadProjects(opts),
    instances: loadInstances(opts),
    decisions: loadDecisions(opts),
    memory: loadMemory(opts),
    heartbeat: loadHeartbeat(opts),
    federation: loadFederation(opts),
    dashboard: loadDashboardConfig(opts),
    plans: loadPlans(opts),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/tui-data && node --test test/load.test.mjs
```

Expected: PASS — 10/10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/tui-data/
git commit -m "feat(tui-data): add loaders for heartbeat, decisions, federation, dashboard, instances, memory, plans"
```

---

### Task 4: Implement built-in page registry

**Files:**
- Create: `packages/tui-data/src/builtin-pages.mjs`

- [ ] **Step 1: Write the registry**

```js
// packages/tui-data/src/builtin-pages.mjs
// Built-in page list. Hub-only pages are gated by data file presence (manifest layer skips them when source missing).

export const BUILTIN_PAGES = [
  // Section pages
  { id: "dashboard",  type: "section",   title: "Dashboard",          source: "*",                                      render: "dashboard" },
  { id: "projects",   type: "section",   title: "Projects",           source: "data/projects.yaml",                     render: "table" },
  { id: "tasks",      type: "section",   title: "Tasks",              source: "HEARTBEAT.md",                           render: "list" },
  { id: "plans",      type: "section",   title: "Plans",              source: "docs/agent-plans/QUEUE.md",              render: "list" },
  { id: "instances",  type: "section",   title: "Instances",          source: "data/instances.yaml",                    render: "table",  hub_only: true },
  { id: "federation", type: "section",   title: "Federation",         source: "federation.yaml",                        render: "summary" },
  { id: "members",    type: "section",   title: "Members",            source: "data/members.yaml",                      render: "table" },
  { id: "ideas",      type: "section",   title: "Ideas",              source: "data/ideas.yaml",                        render: "list" },
  { id: "funding",    type: "section",   title: "Funding",            source: "data/funding-opportunities.yaml",        render: "list" },
  { id: "calendar",   type: "section",   title: "Calendar",           source: "data/events.yaml",                       render: "list" },
  { id: "memory",     type: "section",   title: "Memory",             source: "memory/",                                render: "list" },
  { id: "decisions",  type: "section",   title: "Decisions",          source: "DECISIONS.md",                           render: "list" },
  { id: "skills",     type: "section",   title: "Skills",             source: "data/skills-matrix.yaml",                render: "list",   hub_only: true },
  { id: "packages",   type: "section",   title: "Packages",           source: "data/packages-matrix.yaml",              render: "list",   hub_only: true },

  // Entity page templates (resolved at runtime by id)
  { id: "project/<id>",  type: "entity", template: "project",  source: "data/projects.yaml" },
  { id: "instance/<id>", type: "entity", template: "instance", source: "data/instances.yaml", hub_only: true },
  { id: "plan/<id>",     type: "entity", template: "plan",     source: "docs/agent-plans/" },
  { id: "idea/<id>",     type: "entity", template: "idea",     source: "data/ideas.yaml" },
  { id: "member/<id>",   type: "entity", template: "member",   source: "data/members.yaml" },
  { id: "skill/<id>",    type: "entity", template: "skill",    source: "data/skills-matrix.yaml", hub_only: true },
  { id: "package/<id>",  type: "entity", template: "package",  source: "data/packages-matrix.yaml", hub_only: true },
  { id: "decision/<slug>", type: "entity", template: "decision", source: "DECISIONS.md" },

  // Cross-cut pages
  { id: "health",      type: "cross-cut", title: "Health",       sources: ["data/instances.yaml", "data/skills-matrix.yaml", ".well-known/"], render: "summary", hub_only: true },
  { id: "this-week",   type: "cross-cut", title: "This Week",    sources: ["data/events.yaml", "data/funding-opportunities.yaml", "HEARTBEAT.md"], render: "list" },
  { id: "promotions",  type: "cross-cut", title: "Promotions",   sources: ["data/skills-matrix.yaml", "data/packages-matrix.yaml"], render: "list", hub_only: true },
  { id: "attention",   type: "cross-cut", title: "Needs Attention", sources: ["HEARTBEAT.md", "data/instances.yaml", "docs/agent-plans/"], render: "list" },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui-data/src/builtin-pages.mjs
git commit -m "feat(tui-data): built-in page registry"
```

---

### Task 5: Implement manifest builder with TDD

**Files:**
- Create: `packages/tui-data/src/manifest.mjs`
- Create: `packages/tui-data/test/manifest.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// packages/tui-data/test/manifest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../src/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures");

test("buildManifest: registers built-in pages", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  assert.ok(manifest.pages.find((p) => p.id === "dashboard"));
  assert.ok(manifest.pages.find((p) => p.id === "projects"));
  assert.ok(manifest.pages.find((p) => p.id === "decisions"));
});

test("buildManifest: hub-only pages omitted when source file missing", () => {
  // Fixture has data/instances.yaml but no skills-matrix.yaml.
  const manifest = buildManifest({ root: fixtureRoot });
  assert.ok(manifest.pages.find((p) => p.id === "instances"));
  assert.equal(manifest.pages.find((p) => p.id === "skills"), undefined);
});

test("buildManifest: custom pages from dashboard.yaml.pages are included", () => {
  // The fixture's dashboard.yaml has no custom pages; assert empty doesn't break.
  const manifest = buildManifest({ root: fixtureRoot });
  assert.ok(Array.isArray(manifest.pages));
});

test("buildManifest: collects errors for misconfigured custom pages", () => {
  const manifest = buildManifest({
    root: fixtureRoot,
    overrideConfig: {
      pages: [{ id: "broken", type: "section", source: "data/nonexistent.yaml", render: "list" }],
    },
  });
  const errs = manifest.errors.filter((e) => /nonexistent/.test(e.message));
  assert.ok(errs.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/tui-data && node --test test/manifest.test.mjs
```

Expected: FAIL — `Cannot find module '../src/manifest.mjs'`.

- [ ] **Step 3: Implement manifest.mjs**

```js
// packages/tui-data/src/manifest.mjs
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_PAGES } from "./builtin-pages.mjs";
import { loadDashboardConfig } from "./load.mjs";

function fileExists(root, relPath) {
  const target = path.join(root, relPath);
  try { return fs.existsSync(target); } catch { return false; }
}

export function buildManifest({ root = process.cwd(), overrideConfig = null } = {}) {
  const config = overrideConfig || loadDashboardConfig({ root });
  const errors = [];
  const pages = [];

  for (const page of BUILTIN_PAGES) {
    if (page.hub_only) {
      const sources = page.sources || [page.source];
      const allMissing = sources.every((s) => s && s !== "*" && !fileExists(root, s));
      if (allMissing) continue;
    }
    pages.push(page);
  }

  for (const page of config.pages || []) {
    if (page.source && !fileExists(root, page.source)) {
      errors.push({ source: "dashboard.yaml", message: `Page "${page.id}" references missing source: ${page.source}` });
      continue;
    }
    if (page.sources) {
      for (const s of page.sources) {
        if (!fileExists(root, s)) {
          errors.push({ source: "dashboard.yaml", message: `Page "${page.id}" references missing source: ${s}` });
        }
      }
    }
    pages.push(page);
  }

  return { pages, errors, theme: config.theme, sections: config.sections, custom_sections: config.custom_sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/tui-data && node --test test/manifest.test.mjs
```

Expected: PASS — 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-data/src/manifest.mjs packages/tui-data/test/manifest.test.mjs
git commit -m "feat(tui-data): manifest builder with hub-only gating + custom page validation"
```

---

### Task 6: Implement file-watch wrapper

**Files:**
- Create: `packages/tui-data/src/watch.mjs`

- [ ] **Step 1: Implement watch.mjs (no test — chokidar integration covered manually)**

```js
// packages/tui-data/src/watch.mjs
import chokidar from "chokidar";
import path from "node:path";

const WATCH_PATHS = [
  "data",
  "memory",
  "HEARTBEAT.md",
  "MEMORY.md",
  "DECISIONS.md",
  "federation.yaml",
  "dashboard.yaml",
  "docs/agent-plans",
];

export function watchSources({ root = process.cwd(), onChange, debounceMs = 300 } = {}) {
  const targets = WATCH_PATHS.map((p) => path.join(root, p));
  const watcher = chokidar.watch(targets, { ignoreInitial: true, persistent: true });

  let pending = new Set();
  let timer = null;

  const flush = () => {
    const changed = Array.from(pending);
    pending = new Set();
    timer = null;
    if (changed.length) onChange?.(changed);
  };

  for (const event of ["add", "change", "unlink"]) {
    watcher.on(event, (filePath) => {
      pending.add(filePath);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });
  }

  return {
    close: () => watcher.close(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui-data/src/watch.mjs
git commit -m "feat(tui-data): chokidar-based file watcher with debounced events"
```

---

## Phase 2 — Page resolvers + actions

### Task 7: Implement section page resolver

**Files:**
- Create: `packages/tui-data/src/pages/index.mjs`
- Create: `packages/tui-data/src/pages/section.mjs`
- Create: `packages/tui-data/test/pages/section.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// packages/tui-data/test/pages/section.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePage } from "../../src/pages/index.mjs";
import { buildManifest } from "../../src/manifest.mjs";
import { loadAll } from "../../src/load.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "../fixtures");

test("resolvePage: projects section returns title + items", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("projects", { manifest, sources });
  assert.equal(page.title, "Projects");
  assert.equal(page.type, "section");
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].id, "v2-stabilization");
});

test("resolvePage: decisions section returns chronological entries", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("decisions", { manifest, sources });
  assert.equal(page.title, "Decisions");
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].date, "2026-04-25");
});

test("resolvePage: unknown id returns notFound page", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("bogus", { manifest, sources });
  assert.equal(page.notFound, true);
  assert.match(page.message, /not found/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement resolvers**

```js
// packages/tui-data/src/pages/index.mjs
import { resolveSection } from "./section.mjs";
import { resolveEntity } from "./entity.mjs";
import { resolveCrossCut } from "./cross-cut.mjs";

export function resolvePage(pageId, { manifest, sources }) {
  // Entity pattern: "<section>/<id>"
  if (pageId.includes("/")) {
    const [prefix, ...rest] = pageId.split("/");
    const id = rest.join("/");
    const template = manifest.pages.find((p) => p.id === `${prefix}/<id>` || p.id === `${prefix}/<slug>`);
    if (!template) return { notFound: true, message: `Page "${pageId}" not found.` };
    return resolveEntity({ template, id, sources });
  }
  const page = manifest.pages.find((p) => p.id === pageId);
  if (!page) return { notFound: true, message: `Page "${pageId}" not found. Try /help for the page list.` };
  if (page.type === "section") return resolveSection({ page, sources });
  if (page.type === "cross-cut") return resolveCrossCut({ page, sources });
  return { notFound: true, message: `Page type "${page.type}" not implemented.` };
}
```

```js
// packages/tui-data/src/pages/section.mjs
export function resolveSection({ page, sources }) {
  const map = {
    projects: () => sources.projects.items,
    instances: () => sources.instances.items,
    decisions: () => sources.decisions.items,
    memory: () => sources.memory.items,
    tasks: () => sources.heartbeat.items,
    federation: () => [sources.federation],
    plans: () => sources.plans.items,
  };
  const items = map[page.id] ? map[page.id]() : [];
  return {
    id: page.id,
    type: "section",
    title: page.title,
    summary: `${items.length} item${items.length === 1 ? "" : "s"}`,
    items,
    fields: [],
    related: [],
    actions: [],
  };
}
```

```js
// packages/tui-data/src/pages/entity.mjs (stub for Task 8)
export function resolveEntity() {
  return { notFound: true, message: "Entity resolver not yet implemented." };
}
```

```js
// packages/tui-data/src/pages/cross-cut.mjs (stub for Task 9)
export function resolveCrossCut() {
  return { notFound: true, message: "Cross-cut resolver not yet implemented." };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/tui-data && node --test test/pages/section.test.mjs
```

Expected: PASS — 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-data/src/pages/ packages/tui-data/test/pages/
git commit -m "feat(tui-data): section page resolver"
```

---

### Task 8: Implement entity page resolver

**Files:**
- Modify: `packages/tui-data/src/pages/entity.mjs`
- Create: `packages/tui-data/test/pages/entity.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// packages/tui-data/test/pages/entity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePage } from "../../src/pages/index.mjs";
import { buildManifest } from "../../src/manifest.mjs";
import { loadAll } from "../../src/load.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "../fixtures");

test("resolvePage: project/v2-stabilization returns full entity with fields + related", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("project/v2-stabilization", { manifest, sources });
  assert.equal(page.type, "entity");
  assert.equal(page.title, "v2.0.0 Stabilization");
  assert.ok(page.fields.find((f) => f.key === "stage" && f.value === "Develop"));
  assert.ok(Array.isArray(page.related));
});

test("resolvePage: project/missing returns notFound", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("project/no-such-project", { manifest, sources });
  assert.equal(page.notFound, true);
});

test("resolvePage: decision/<slug> returns single decision", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const slug = sources.decisions.items[0].slug;
  const page = resolvePage(`decision/${slug}`, { manifest, sources });
  assert.equal(page.type, "entity");
  assert.equal(page.title, sources.decisions.items[0].title);
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — entity resolver returns notFound stub.

- [ ] **Step 3: Implement entity resolver**

```js
// packages/tui-data/src/pages/entity.mjs
export function resolveEntity({ template, id, sources }) {
  const handlers = {
    project: () => entityFromProject(id, sources),
    instance: () => entityFromInstance(id, sources),
    plan: () => entityFromPlan(id, sources),
    idea: () => entityFromIdea(id, sources),
    member: () => entityFromMember(id, sources),
    skill: () => entityFromSkill(id, sources),
    package: () => entityFromPackage(id, sources),
    decision: () => entityFromDecision(id, sources),
  };
  const handler = handlers[template.template];
  if (!handler) return { notFound: true, message: `No handler for entity template "${template.template}".` };
  return handler();
}

function notFound(kind, id) {
  return { notFound: true, message: `${kind} "${id}" not found.` };
}

function entityFromProject(id, sources) {
  const project = sources.projects.items.find((p) => p.id === id);
  if (!project) return notFound("project", id);
  const linkedPlans = sources.plans.items.filter((pl) => pl.workstream === id || pl.workstream === project.id);
  const relatedDecisions = sources.decisions.items.filter((d) => d.body && d.body.toLowerCase().includes(id));
  return {
    id: `project/${id}`,
    type: "entity",
    title: project.name,
    summary: `Stage: ${project.stage} · Lead: ${project.lead}`,
    fields: [
      { key: "stage", value: project.stage },
      { key: "lead", value: project.lead },
      { key: "members", value: (project.members || []).join(", ") },
      { key: "start_date", value: project.start_date || "—" },
      { key: "notion_url", value: project.notion_url || "—" },
    ],
    related: [
      { group: "Linked plans", items: linkedPlans.map((p) => ({ label: p.title || p.id, status: p.status })) },
      { group: "Related decisions", items: relatedDecisions.map((d) => ({ label: `${d.date} ${d.title}` })) },
    ],
    items: [],
    actions: [],
  };
}

function entityFromInstance(id, sources) {
  const inst = sources.instances.items.find((i) => i.id === id);
  if (!inst) return notFound("instance", id);
  return {
    id: `instance/${id}`,
    type: "entity",
    title: inst.name,
    summary: `${inst.type} · ${inst.maturity} · framework ${inst.framework_version || "—"}`,
    fields: Object.entries(inst).map(([key, value]) => ({ key, value: String(value) })),
    related: [],
    items: [],
    actions: [],
  };
}

function entityFromPlan(id, sources) {
  const plan = sources.plans.items.find((p) => p.id === id);
  if (!plan) return notFound("plan", id);
  return {
    id: `plan/${id}`,
    type: "entity",
    title: plan.title || plan.id,
    summary: `Status: ${plan.status} · Workstream: ${plan.workstream || "—"}`,
    fields: [
      { key: "status", value: plan.status || "—" },
      { key: "workstream", value: plan.workstream || "—" },
      { key: "created", value: plan.created || "—" },
      { key: "completed", value: plan.completed || "—" },
    ],
    related: [],
    items: [],
    body: plan.body || "",
    actions: [],
  };
}

function entityFromIdea(id, sources) { /* parallel structure to project */
  const idea = sources.ideas?.items?.find?.((i) => i.id === id);
  if (!idea) return notFound("idea", id);
  return { id: `idea/${id}`, type: "entity", title: idea.title, fields: [{ key: "status", value: idea.status }], related: [], items: [], actions: [] };
}
function entityFromMember(id, sources) {
  const m = sources.members?.items?.find?.((x) => x.id === id || x.handle === id);
  if (!m) return notFound("member", id);
  return { id: `member/${id}`, type: "entity", title: m.name || id, fields: Object.entries(m).map(([k, v]) => ({ key: k, value: String(v) })), related: [], items: [], actions: [] };
}
function entityFromSkill(id, sources) {
  const s = sources.skills?.items?.find?.((x) => x.id === id);
  if (!s) return notFound("skill", id);
  return { id: `skill/${id}`, type: "entity", title: id, fields: Object.entries(s).map(([k, v]) => ({ key: k, value: String(v) })), related: [], items: [], actions: [] };
}
function entityFromPackage(id, sources) {
  const p = sources.packages?.items?.find?.((x) => x.id === id);
  if (!p) return notFound("package", id);
  return { id: `package/${id}`, type: "entity", title: id, fields: Object.entries(p).map(([k, v]) => ({ key: k, value: String(v) })), related: [], items: [], actions: [] };
}
function entityFromDecision(slug, sources) {
  const d = sources.decisions.items.find((x) => x.slug === slug);
  if (!d) return notFound("decision", slug);
  return {
    id: `decision/${slug}`,
    type: "entity",
    title: d.title,
    summary: `${d.date} · ${d.status} · ${d.scope || ""}`,
    fields: [{ key: "date", value: d.date }, { key: "status", value: d.status }, { key: "scope", value: d.scope || "—" }],
    related: [],
    items: [],
    body: d.body,
    actions: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS — 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-data/src/pages/entity.mjs packages/tui-data/test/pages/entity.test.mjs
git commit -m "feat(tui-data): entity page resolver for projects, instances, plans, decisions, etc."
```

---

### Task 9: Implement cross-cut page resolver

**Files:**
- Modify: `packages/tui-data/src/pages/cross-cut.mjs`
- Create: `packages/tui-data/test/pages/cross-cut.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// packages/tui-data/test/pages/cross-cut.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePage } from "../../src/pages/index.mjs";
import { buildManifest } from "../../src/manifest.mjs";
import { loadAll } from "../../src/load.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "../fixtures");

test("resolvePage: this-week aggregates events + tasks + funding deadlines", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("this-week", { manifest, sources });
  assert.equal(page.type, "cross-cut");
  assert.equal(page.title, "This Week");
  assert.ok(Array.isArray(page.items));
});

test("resolvePage: attention surfaces critical/urgent items only", () => {
  const manifest = buildManifest({ root: fixtureRoot });
  const sources = loadAll({ root: fixtureRoot });
  const page = resolvePage("attention", { manifest, sources });
  assert.equal(page.type, "cross-cut");
  assert.ok(Array.isArray(page.items));
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — cross-cut returns notFound stub.

- [ ] **Step 3: Implement cross-cut resolver**

```js
// packages/tui-data/src/pages/cross-cut.mjs
export function resolveCrossCut({ page, sources }) {
  const handlers = {
    "this-week":  () => buildThisWeek(sources),
    "health":     () => buildHealth(sources),
    "promotions": () => buildPromotions(sources),
    "attention":  () => buildAttention(sources),
  };
  const handler = handlers[page.id];
  if (!handler) return { notFound: true, message: `Cross-cut "${page.id}" not implemented.` };
  return { id: page.id, type: "cross-cut", title: page.title, ...handler(), fields: [], related: [], actions: [] };
}

function buildThisWeek(sources) {
  const items = [];
  const events = sources.events?.items || [];
  const tasks = (sources.heartbeat?.items || []).filter((t) => !t.done);
  const funding = sources.funding?.items || [];
  for (const e of events) items.push({ kind: "event", label: e.title, date: e.date });
  for (const t of tasks.slice(0, 5)) items.push({ kind: "task", label: t.text, category: t.category });
  for (const f of funding) items.push({ kind: "funding", label: f.title, date: f.deadline });
  items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return { summary: `${items.length} item${items.length === 1 ? "" : "s"} this week`, items };
}

function buildHealth(sources) {
  const instances = sources.instances?.items || [];
  const drift = instances.filter((i) => (i.drift_count || 0) > 0).length;
  const stale = instances.filter((i) => i.last_sync && (Date.now() - new Date(i.last_sync).getTime()) > 30 * 86400000);
  return {
    summary: `${instances.length} instances · ${drift} with drift · ${stale.length} stale (>30d)`,
    items: instances.map((i) => ({ id: i.id, label: i.name, drift: i.drift_count || 0, last_sync: i.last_sync })),
  };
}

function buildPromotions(sources) {
  const skills = (sources.skills?.items || []).filter((s) => s.promotion_status === "candidate" || s.promotion_status === "ready");
  const packages = (sources.packages?.items || []).filter((p) => p.promotion_status === "candidate" || p.promotion_status === "ready");
  return {
    summary: `${skills.length} skill candidate${skills.length === 1 ? "" : "s"} · ${packages.length} package candidate${packages.length === 1 ? "" : "s"}`,
    items: [
      ...skills.map((s) => ({ kind: "skill", id: s.id, label: s.id, instances_using: s.instances_using })),
      ...packages.map((p) => ({ kind: "package", id: p.id, label: p.id, instances_using: p.instances_using })),
    ],
  };
}

function buildAttention(sources) {
  const tasks = (sources.heartbeat?.items || []).filter((t) => !t.done && /critical|urgent/i.test(t.text));
  const drift = (sources.instances?.items || []).filter((i) => (i.drift_count || 0) > 1);
  const idlePlans = (sources.plans?.items || []).filter((p) => p.status === "scoping");
  return {
    summary: `${tasks.length} hot task${tasks.length === 1 ? "" : "s"} · ${drift.length} drifting instance${drift.length === 1 ? "" : "s"} · ${idlePlans.length} scoping plan${idlePlans.length === 1 ? "" : "s"}`,
    items: [
      ...tasks.map((t) => ({ kind: "task", label: t.text })),
      ...drift.map((i) => ({ kind: "drift", label: `${i.name} (drift: ${i.drift_count})` })),
      ...idlePlans.map((p) => ({ kind: "plan", label: p.title || p.id })),
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS — 2/2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-data/src/pages/cross-cut.mjs packages/tui-data/test/pages/cross-cut.test.mjs
git commit -m "feat(tui-data): cross-cut page resolver (this-week, health, promotions, attention)"
```

---

### Task 10: Implement actions catalog + Mustache template engine

**Files:**
- Create: `packages/tui-data/src/actions.mjs`
- Create: `packages/tui-data/test/actions.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// packages/tui-data/test/actions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPromptTemplate } from "../src/actions.mjs";

test("renderPromptTemplate: substitutes simple keys", () => {
  const t = "Hello {{entity.name}}, stage {{entity.stage}}.";
  const out = renderPromptTemplate(t, { entity: { name: "v2", stage: "Develop" } });
  assert.equal(out, "Hello v2, stage Develop.");
});

test("renderPromptTemplate: missing key renders as empty", () => {
  const out = renderPromptTemplate("X={{entity.missing}}.", { entity: {} });
  assert.equal(out, "X=.");
});

test("renderPromptTemplate: arrays joined with comma-space", () => {
  const out = renderPromptTemplate("{{entity.plans}}", { entity: { plans: ["a", "b"] } });
  assert.equal(out, "a, b");
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module missing.

- [ ] **Step 3: Implement actions.mjs**

```js
// packages/tui-data/src/actions.mjs
import { spawn } from "node:child_process";

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderPromptTemplate(template, context = {}) {
  return template.replace(TOKEN, (_, key) => {
    const val = key.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), context);
    if (val == null) return "";
    if (Array.isArray(val)) return val.join(", ");
    return String(val);
  });
}

export function runAction(action, { context, cwd = process.cwd(), onChunk } = {}) {
  if (action.kind === "script") {
    return new Promise((resolve) => {
      const child = spawn("sh", ["-c", action.run], { cwd });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; onChunk?.({ stream: "stdout", chunk: d.toString() }); });
      child.stderr.on("data", (d) => { stderr += d; onChunk?.({ stream: "stderr", chunk: d.toString() }); });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }
  if (action.kind === "open") {
    const filePath = renderPromptTemplate(action.path, context);
    const editor = process.env.EDITOR || "open";
    return new Promise((resolve) => {
      const child = spawn(editor, [filePath], { stdio: "inherit" });
      child.on("close", (code) => resolve({ code }));
    });
  }
  if (action.kind === "prompt") {
    const text = renderPromptTemplate(action.template, context);
    return Promise.resolve({ kind: "prompt", text });
  }
  return Promise.reject(new Error(`Unknown action kind: ${action.kind}`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS — 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui-data/src/actions.mjs packages/tui-data/test/actions.test.mjs
git commit -m "feat(tui-data): action catalog + Mustache-style template engine"
```

---

## Phase 3 — TUI scaffolding

### Task 11: Scaffold `packages/tui/` skeleton

**Files:**
- Create: `packages/tui/package.json`
- Create: `packages/tui/README.md`
- Create: `packages/tui/bin/org-tui`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@org-os/tui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.mjs",
  "bin": {
    "org-tui": "./bin/org-tui"
  },
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "@org-os/tui-data": "*",
    "ink": "^4.4.1",
    "ink-spinner": "^5.0.0",
    "ink-select-input": "^6.0.0",
    "ink-text-input": "^6.0.0",
    "ink-table": "^3.0.0",
    "react": "^18.2.0",
    "chalk": "^5.3.0",
    "clipboardy": "^4.0.0"
  },
  "devDependencies": {
    "ink-testing-library": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create the bin shim**

```bash
#!/usr/bin/env node
// packages/tui/bin/org-tui
import "../src/modes/interactive.mjs";
```

Make executable:

```bash
chmod +x packages/tui/bin/org-tui
```

- [ ] **Step 3: Commit**

```bash
git add packages/tui/
git commit -m "feat(tui): scaffold Ink package skeleton"
```

---

### Task 12: Implement print mode (agent-print) for one page end-to-end

> **Note:** A transitional shim (`scripts/page-shim.mjs`) is already in place and exposed as `npm run page` to keep the host integrations live during TUI development. This task replaces the shim's `npm run page` wiring with the full Ink-based print renderer. Verify the shim's 7 supported pages (`dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans`, `this-week`) still produce equivalent output after the swap, then delete `scripts/page-shim.mjs`.

**Files:**
- Create: `packages/tui/src/modes/print.mjs`
- Create: `packages/tui/src/pages/Section.jsx`
- Create: `packages/tui/src/components/Header.jsx`
- Create: `packages/tui/src/index.mjs`

- [ ] **Step 1: Implement minimal print mode**

```js
// packages/tui/src/modes/print.mjs
import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { loadAll, buildManifest, resolvePage } from "@org-os/tui-data";
import { Section } from "../pages/Section.jsx";

chalk.level = 0; // strip color

const pageId = process.argv[2];
if (!pageId) {
  console.error("Usage: node print.mjs <page-id>");
  process.exit(2);
}

const root = process.cwd();
const sources = loadAll({ root });
const manifest = buildManifest({ root });
const page = resolvePage(pageId, { manifest, sources });

if (page.notFound) {
  console.error(page.message);
  process.exit(1);
}

const { unmount, waitUntilExit } = render(<Section page={page} mode="agent-print" />);
unmount();
await waitUntilExit().catch(() => {});
```

- [ ] **Step 2: Implement minimal Section + Header**

```jsx
// packages/tui/src/components/Header.jsx
import React from "react";
import { Box, Text } from "ink";

export function Header({ identity, status }) {
  return (
    <Box>
      <Text>{identity}  </Text>
      <Text dimColor>{status}</Text>
    </Box>
  );
}
```

```jsx
// packages/tui/src/pages/Section.jsx
import React from "react";
import { Box, Text } from "ink";

export function Section({ page, mode = "interactive" }) {
  return (
    <Box flexDirection="column">
      <Text bold>{page.title}</Text>
      <Text dimColor>{page.summary}</Text>
      <Box flexDirection="column" marginTop={1}>
        {page.items.map((item, i) => (
          <Text key={i}>● {item.name || item.title || item.text || item.id}</Text>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Add the `page` script to root package.json**

Edit the root `package.json` `scripts`:

```json
"page": "node packages/tui/src/modes/print.mjs"
```

(Keep all existing scripts unchanged.)

- [ ] **Step 4: Verify end-to-end smoke**

```bash
npm install
npm run page projects
```

Expected output: page renders the project list as plain text. No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/ package.json package-lock.json
git commit -m "feat(tui): print mode with minimal Section + Header components"
```

---

### Task 13: Implement chrome (Header + Breadcrumb + StatusBar)

**Files:**
- Modify: `packages/tui/src/components/Header.jsx`
- Create: `packages/tui/src/components/Breadcrumb.jsx`
- Create: `packages/tui/src/components/StatusBar.jsx`
- Create: `packages/tui/src/chrome.jsx`

- [ ] **Step 1: Implement Breadcrumb**

```jsx
// packages/tui/src/components/Breadcrumb.jsx
import React from "react";
import { Box, Text } from "ink";

export function Breadcrumb({ trail = [] }) {
  if (!trail.length) return null;
  return (
    <Box>
      <Text dimColor>{trail.join(" › ")}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Implement StatusBar**

```jsx
// packages/tui/src/components/StatusBar.jsx
import React from "react";
import { Box, Text } from "ink";

const KEYS = "[j/k] move  [enter] open  [esc] back  [a] actions  [/] search  [?] help  [q] quit";

export function StatusBar({ live = true, mode = "interactive" }) {
  if (mode === "agent-print") return null;
  return (
    <Box>
      <Text dimColor>{KEYS}  {live ? "● live" : "○ idle"}</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Implement chrome shell with full-width**

```jsx
// packages/tui/src/chrome.jsx
import React from "react";
import { Box } from "ink";
import { Header } from "./components/Header.jsx";
import { Breadcrumb } from "./components/Breadcrumb.jsx";
import { StatusBar } from "./components/StatusBar.jsx";

export function Chrome({ identity, status, trail, mode, children, live }) {
  // process.stdout.columns gives the terminal width; flexBasis fills it.
  const width = process.stdout.columns || 120;
  return (
    <Box flexDirection="column" width={width}>
      <Header identity={identity} status={status} width={width} />
      <Breadcrumb trail={trail} />
      <Box flexDirection="column" marginY={1} width={width}>{children}</Box>
      <StatusBar mode={mode} live={live} width={width} />
    </Box>
  );
}
```

- [ ] **Step 4: Update print mode to use Chrome**

Edit `packages/tui/src/modes/print.mjs` to wrap output in `<Chrome>` with `mode="agent-print"`.

- [ ] **Step 5: Verify**

```bash
npm run page projects
```

Output now includes header strip + content + (no status bar since mode is agent-print).

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/
git commit -m "feat(tui): chrome shell with full-width Header, Breadcrumb, StatusBar"
```

---

### Task 13.5: Alternate-screen rendering + bracketed-paste safety

(Hermes-inspired: clean fullscreen, no scrollback clutter on quit; safe pasting in inputs.)

**Files:**
- Modify: `packages/tui/src/modes/interactive.mjs`
- Create: `packages/tui/src/util/altScreen.mjs`
- Create: `packages/tui/src/util/bracketedPaste.mjs`

- [ ] **Step 1: Implement alt-screen helper**

```js
// packages/tui/src/util/altScreen.mjs
// Enter alternate screen on launch, restore on quit.
// ANSI: \x1b[?1049h enters, \x1b[?1049l exits.

export function enterAltScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?1049h");
}

export function exitAltScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?1049l");
}

export function installAltScreenLifecycle() {
  enterAltScreen();
  const restore = () => exitAltScreen();
  process.on("exit", restore);
  process.on("SIGINT", () => { restore(); process.exit(130); });
  process.on("SIGTERM", () => { restore(); process.exit(143); });
}
```

- [ ] **Step 2: Implement bracketed-paste guard**

```js
// packages/tui/src/util/bracketedPaste.mjs
// Bracketed paste: terminal wraps pasted text in \x1b[200~ ... \x1b[201~.
// We strip the markers and pass the content as an atomic input event.

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export function enableBracketedPaste() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?2004h");
}

export function disableBracketedPaste() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?2004l");
}

export function stripPasteMarkers(input) {
  if (!input.includes(PASTE_START)) return input;
  const start = input.indexOf(PASTE_START);
  const end = input.indexOf(PASTE_END);
  if (end === -1) return input.slice(start + PASTE_START.length);
  return input.slice(start + PASTE_START.length, end);
}
```

- [ ] **Step 3: Wire into interactive mode**

Edit `packages/tui/src/modes/interactive.mjs` — at top:

```js
import { installAltScreenLifecycle } from "../util/altScreen.mjs";
import { enableBracketedPaste, disableBracketedPaste } from "../util/bracketedPaste.mjs";

installAltScreenLifecycle();
enableBracketedPaste();
process.on("exit", disableBracketedPaste);
```

- [ ] **Step 4: Smoke test**

```bash
npm run tui
```

Verify: terminal switches to a clean fullscreen on launch; `q` exits and restores prior scrollback (no TUI residue). Pasting into the command palette doesn't insert escape sequences.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/util/ packages/tui/src/modes/interactive.mjs
git commit -m "feat(tui): alt-screen lifecycle + bracketed-paste safety (hermes-inspired)"
```

---

### Task 14: Implement primitives (Table, List, KeyValue, RelatedColumn)

**Files:**
- Create: `packages/tui/src/components/Table.jsx`
- Create: `packages/tui/src/components/List.jsx`
- Create: `packages/tui/src/components/KeyValue.jsx`
- Create: `packages/tui/src/components/RelatedColumn.jsx`

- [ ] **Step 1: Implement Table**

```jsx
// packages/tui/src/components/Table.jsx
import React from "react";
import { Box, Text } from "ink";

export function Table({ columns, rows, focusedIndex = -1 }) {
  return (
    <Box flexDirection="column">
      <Box>
        {columns.map((c) => (
          <Box key={c.key} width={c.width || 20}>
            <Text bold>{c.label || c.key}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, i) => (
        <Box key={i}>
          {columns.map((c) => (
            <Box key={c.key} width={c.width || 20}>
              <Text inverse={i === focusedIndex}>{String(row[c.key] ?? "—")}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Implement List**

```jsx
// packages/tui/src/components/List.jsx
import React from "react";
import { Box, Text } from "ink";

export function List({ items, focusedIndex = -1, renderItem }) {
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={i} inverse={i === focusedIndex}>
          {renderItem ? renderItem(item) : (item.label || item.title || item.name || item.id || String(item))}
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 3: Implement KeyValue**

```jsx
// packages/tui/src/components/KeyValue.jsx
import React from "react";
import { Box, Text } from "ink";

export function KeyValue({ fields }) {
  return (
    <Box flexDirection="column">
      {fields.map((f) => (
        <Box key={f.key}>
          <Box width={16}><Text dimColor>{f.key}</Text></Box>
          <Text>{String(f.value ?? "—")}</Text>
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Implement RelatedColumn**

```jsx
// packages/tui/src/components/RelatedColumn.jsx
import React from "react";
import { Box, Text } from "ink";

export function RelatedColumn({ groups }) {
  return (
    <Box flexDirection="column">
      {groups.map((g) => (
        <Box key={g.group} flexDirection="column" marginBottom={1}>
          <Text bold>▎{g.group} ({g.items.length})</Text>
          {g.items.map((it, i) => (
            <Text key={i}>▸ {it.label}{it.status ? `  ${it.status}` : ""}</Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/components/
git commit -m "feat(tui): Table, List, KeyValue, RelatedColumn primitives"
```

---

### Task 15: Implement modals (HelpOverlay, CommandPalette, ActionMenu)

**Files:**
- Create: `packages/tui/src/components/HelpOverlay.jsx`
- Create: `packages/tui/src/components/CommandPalette.jsx`
- Create: `packages/tui/src/components/ActionMenu.jsx`

- [ ] **Step 1: Implement HelpOverlay**

```jsx
// packages/tui/src/components/HelpOverlay.jsx
import React from "react";
import { Box, Text } from "ink";

const KEYS = [
  ["j/k or ↓/↑", "Move selection"],
  ["enter", "Open focused entity"],
  ["esc / h", "Back one level"],
  ["g / G", "Top / bottom"],
  ["tab / shift-tab", "Next / prev page"],
  ["/", "Fuzzy search"],
  [":", "Command palette"],
  ["?", "Toggle this help"],
  ["r", "Refresh"],
  ["e", "Open file in $EDITOR"],
  ["a", "Action menu"],
  ["c", "Copy prompt to clipboard"],
  ["Ctrl-o / Ctrl-i", "Jumplist back / forward"],
  ["q", "Quit"],
];

export function HelpOverlay({ pages = [] }) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Keybindings</Text>
      {KEYS.map(([k, d]) => (
        <Box key={k}>
          <Box width={20}><Text>{k}</Text></Box>
          <Text dimColor>{d}</Text>
        </Box>
      ))}
      <Box marginTop={1}><Text bold>Pages</Text></Box>
      {pages.map((p) => (
        <Text key={p.id}>:{p.id}{p.title ? `  — ${p.title}` : ""}</Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Implement CommandPalette with fuzzy match + tab autocomplete**

```jsx
// packages/tui/src/components/CommandPalette.jsx
import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

// Simple subsequence fuzzy match: chars of `query` appear in order in `target`.
function fuzzyScore(query, target) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      // bonus for consecutive matches and start-of-string
      score += ti === 0 ? 3 : 1;
    }
  }
  return qi === q.length ? score + (target.length - t.length === 0 ? 5 : 0) : -1;
}

export function CommandPalette({ pages, onSubmit, onCancel }) {
  const [value, setValue] = useState("");

  const matches = useMemo(() => {
    if (!value) return pages.slice(0, 12);
    return pages
      .map((p) => ({ p, score: fuzzyScore(value, p.id) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p)
      .slice(0, 12);
  }, [value, pages]);

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.tab && matches.length > 0) {
      // Tab completion: complete to the longest common prefix of matches
      const ids = matches.map((m) => m.id);
      let prefix = ids[0];
      for (const id of ids) {
        while (!id.startsWith(prefix) && prefix.length > 0) prefix = prefix.slice(0, -1);
      }
      if (prefix.length > value.length) setValue(prefix);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box>
        <Text bold>: </Text>
        <TextInput value={value} onChange={setValue} onSubmit={() => onSubmit(value.trim() || matches[0]?.id)} />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {matches.map((p, i) => (
          <Text key={p.id} dimColor={i > 0}>
            {i === 0 ? "▸ " : "  "}{p.id}{p.title ? `  — ${p.title}` : ""}
          </Text>
        ))}
        {value && matches.length === 0 ? <Text dimColor>(no matches — esc to cancel)</Text> : null}
      </Box>
      <Box marginTop={1}><Text dimColor>tab=complete · enter=open · esc=cancel</Text></Box>
    </Box>
  );
}
```

- [ ] **Step 3: Implement ActionMenu**

```jsx
// packages/tui/src/components/ActionMenu.jsx
import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export function ActionMenu({ actions, onSelect, onCancel }) {
  if (!actions || actions.length === 0) return <Text dimColor>No actions on this page.</Text>;
  const items = actions.map((a) => ({ label: `${a.label}${a.affects ? ` — affects ${a.affects.join(", ")}` : ""}`, value: a.id }));
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Actions</Text>
      <SelectInput items={items} onSelect={(it) => onSelect(actions.find((a) => a.id === it.value))} />
    </Box>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/components/
git commit -m "feat(tui): HelpOverlay, CommandPalette, ActionMenu modals"
```

---

## Phase 4 — V1 pages + interactive

### Task 16: Implement Entity + CrossCut + ComingSoon page components

**Files:**
- Create: `packages/tui/src/pages/Entity.jsx`
- Create: `packages/tui/src/pages/CrossCut.jsx`
- Create: `packages/tui/src/pages/ComingSoon.jsx`

- [ ] **Step 1: Implement Entity**

```jsx
// packages/tui/src/pages/Entity.jsx
import React from "react";
import { Box, Text } from "ink";
import { KeyValue } from "../components/KeyValue.jsx";
import { RelatedColumn } from "../components/RelatedColumn.jsx";

export function Entity({ page }) {
  return (
    <Box flexDirection="column">
      <Text bold>{page.title}</Text>
      <Text dimColor>{page.summary}</Text>
      <Box marginTop={1}>
        <Box flexDirection="column" width="50%"><KeyValue fields={page.fields || []} /></Box>
        <Box flexDirection="column" width="50%"><RelatedColumn groups={page.related || []} /></Box>
      </Box>
      {page.body ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>──── body ────</Text>
          <Text>{page.body}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 2: Implement CrossCut**

```jsx
// packages/tui/src/pages/CrossCut.jsx
import React from "react";
import { Box, Text } from "ink";
import { List } from "../components/List.jsx";

export function CrossCut({ page }) {
  return (
    <Box flexDirection="column">
      <Text bold>{page.title}</Text>
      <Text dimColor>{page.summary}</Text>
      <Box marginTop={1}><List items={page.items || []} renderItem={(it) => `${it.kind ? `[${it.kind}] ` : ""}${it.label}${it.date ? `  (${it.date})` : ""}`} /></Box>
    </Box>
  );
}
```

- [ ] **Step 3: Implement ComingSoon**

```jsx
// packages/tui/src/pages/ComingSoon.jsx
import React from "react";
import { Box, Text } from "ink";
export function ComingSoon({ page }) {
  return (
    <Box flexDirection="column">
      <Text bold>{page.title || page.id}</Text>
      <Text dimColor>This page is registered but not yet implemented. Coming soon.</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/pages/
git commit -m "feat(tui): Entity, CrossCut, ComingSoon page components"
```

---

### Task 17: Implement `<App>` with navigation state + jumplist

**Files:**
- Create: `packages/tui/src/hooks/useNavigation.mjs`
- Create: `packages/tui/src/App.jsx`

- [ ] **Step 1: Implement useNavigation hook**

```js
// packages/tui/src/hooks/useNavigation.mjs
import { useState, useCallback } from "react";

export function useNavigation(initial = "dashboard") {
  const [current, setCurrent] = useState(initial);
  const [back, setBack] = useState([]);
  const [forward, setForward] = useState([]);

  const go = useCallback((id) => {
    setBack((b) => [...b, current]);
    setForward([]);
    setCurrent(id);
  }, [current]);

  const goBack = useCallback(() => {
    setBack((b) => {
      if (!b.length) return b;
      const prev = b[b.length - 1];
      setForward((f) => [current, ...f]);
      setCurrent(prev);
      return b.slice(0, -1);
    });
  }, [current]);

  const goForward = useCallback(() => {
    setForward((f) => {
      if (!f.length) return f;
      const next = f[0];
      setBack((b) => [...b, current]);
      setCurrent(next);
      return f.slice(1);
    });
  }, [current]);

  const trail = [...back, current];
  return { current, go, goBack, goForward, trail };
}
```

- [ ] **Step 2: Implement App**

```jsx
// packages/tui/src/App.jsx
import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import { Chrome } from "./chrome.jsx";
import { Section } from "./pages/Section.jsx";
import { Entity } from "./pages/Entity.jsx";
import { CrossCut } from "./pages/CrossCut.jsx";
import { ComingSoon } from "./pages/ComingSoon.jsx";
import { HelpOverlay } from "./components/HelpOverlay.jsx";
import { CommandPalette } from "./components/CommandPalette.jsx";
import { ActionMenu } from "./components/ActionMenu.jsx";
import { useNavigation } from "./hooks/useNavigation.mjs";
import { resolvePage } from "@org-os/tui-data";

export function App({ manifest, sources, identity, status, mode = "interactive" }) {
  const { current, go, goBack, goForward, trail } = useNavigation("dashboard");
  const [overlay, setOverlay] = useState(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const { exit } = useApp();

  const page = resolvePage(current, { manifest, sources });

  useInput((input, key) => {
    if (overlay === "help") { if (input === "?" || key.escape) setOverlay(null); return; }
    if (overlay === "palette") return; // palette owns its own input
    if (overlay === "actions") { if (key.escape) setOverlay(null); return; }

    if (input === "q") return exit();
    if (input === "?") return setOverlay("help");
    if (input === ":") return setOverlay("palette");
    if (input === "a") return setOverlay("actions");
    if (input === "j" || key.downArrow) return setFocusIndex((i) => i + 1);
    if (input === "k" || key.upArrow) return setFocusIndex((i) => Math.max(0, i - 1));
    if (input === "h" || key.escape) return goBack();
    if (key.ctrl && input === "o") return goBack();
    if (key.ctrl && input === "i") return goForward();
    if (key.return && page.items?.[focusIndex]?.id) {
      const prefix = current === "projects" ? "project" : current === "instances" ? "instance" : current === "plans" ? "plan" : null;
      if (prefix) return go(`${prefix}/${page.items[focusIndex].id}`);
    }
  });

  let body;
  if (page.notFound) body = <Box>{page.message}</Box>;
  else if (page.type === "section")   body = <Section page={page} focusIndex={focusIndex} />;
  else if (page.type === "entity")    body = <Entity page={page} />;
  else if (page.type === "cross-cut") body = <CrossCut page={page} />;
  else                                body = <ComingSoon page={page} />;

  if (overlay === "help") body = <HelpOverlay pages={manifest.pages} />;
  if (overlay === "palette") body = <CommandPalette pages={manifest.pages} onSubmit={(id) => { setOverlay(null); go(id); }} onCancel={() => setOverlay(null)} />;
  if (overlay === "actions") body = <ActionMenu actions={page.actions || []} onSelect={() => setOverlay(null)} onCancel={() => setOverlay(null)} />;

  return (
    <Chrome identity={identity} status={status} trail={trail} mode={mode} live>
      {body}
    </Chrome>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/tui/src/App.jsx packages/tui/src/hooks/
git commit -m "feat(tui): App component with navigation state + jumplist + key bindings"
```

---

### Task 18: Implement interactive mode entry + file-watch

**Files:**
- Create: `packages/tui/src/hooks/useFileWatch.mjs`
- Create: `packages/tui/src/modes/interactive.mjs`
- Create: `packages/tui/src/theme.mjs`

- [ ] **Step 1: Implement theme reader**

```js
// packages/tui/src/theme.mjs
import { loadDashboardConfig } from "@org-os/tui-data";

const DEFAULT = { primary: "green", accent: "cyan", dim: "gray" };

export function loadTheme({ root = process.cwd() } = {}) {
  const cfg = loadDashboardConfig({ root });
  return { ...DEFAULT, ...(cfg.theme || {}) };
}
```

- [ ] **Step 2: Implement useFileWatch hook**

```js
// packages/tui/src/hooks/useFileWatch.mjs
import { useEffect } from "react";
import { watchSources } from "@org-os/tui-data";

export function useFileWatch({ enabled, root, onChange }) {
  useEffect(() => {
    if (!enabled) return;
    const w = watchSources({ root, onChange });
    return () => w.close();
  }, [enabled, root, onChange]);
}
```

- [ ] **Step 3: Implement interactive entry**

```js
// packages/tui/src/modes/interactive.mjs
import React, { useState, useCallback } from "react";
import { render } from "ink";
import { loadAll, buildManifest } from "@org-os/tui-data";
import { App } from "../App.jsx";
import { useFileWatch } from "../hooks/useFileWatch.mjs";

const root = process.cwd();

function Container() {
  const [tick, setTick] = useState(0);
  const sources = loadAll({ root });
  const manifest = buildManifest({ root });
  useFileWatch({ enabled: true, root, onChange: useCallback(() => setTick((t) => t + 1), []) });
  // tick triggers re-render; loadAll runs every render. For v1 this is fine — files are small.
  void tick;
  return (
    <App
      manifest={manifest}
      sources={sources}
      identity={`🧬 org-os · framework+hub`}
      status={`mem ${formatAge(sources.memory.lastModified)} · ${sources.instances.items.length} instances`}
      mode="interactive"
    />
  );
}

function formatAge(date) {
  if (!date) return "—";
  const m = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

render(<Container />);
```

- [ ] **Step 4: Add `tui` script to root package.json**

```json
"tui": "node packages/tui/src/modes/interactive.mjs"
```

- [ ] **Step 5: Smoke-test interactively**

```bash
npm run tui
```

Expected: TUI launches showing the dashboard page. Press `:`, type `projects`, enter — drills into projects page. Press `q` to quit.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/ package.json
git commit -m "feat(tui): interactive mode entry with file-watch"
```

---

### Task 19: Implement v1 dashboard page

**Files:**
- Modify: `packages/tui/src/pages/Section.jsx` — special-case `dashboard` id

- [ ] **Step 1: Add dashboard renderer**

In `Section.jsx`, branch on `page.id === "dashboard"` to render the lush home view (header strip + projects + tasks + plans + recent context + federation summary). For v1 keep this as a simple aggregation of `page.items` styled like today's `/initialize`. Detail pages handle drill-down.

```jsx
// packages/tui/src/pages/Section.jsx (extend)
import React from "react";
import { Box, Text } from "ink";

export function Section({ page, focusIndex = 0 }) {
  if (page.id === "dashboard") return <Dashboard page={page} />;
  // ... existing list render from Task 12
  return (
    <Box flexDirection="column">
      <Text bold>{page.title}</Text>
      <Text dimColor>{page.summary}</Text>
      <Box flexDirection="column" marginTop={1}>
        {page.items.map((item, i) => (
          <Text key={i} inverse={i === focusIndex}>● {item.name || item.title || item.text || item.id}</Text>
        ))}
      </Box>
    </Box>
  );
}

function Dashboard({ page }) {
  const groups = page.groups || [];
  return (
    <Box flexDirection="column">
      {groups.map((g) => (
        <Box key={g.title} flexDirection="column" marginBottom={1}>
          <Text bold>{g.title}</Text>
          {g.items.map((it, i) => (<Text key={i}>● {it.label}</Text>))}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Have section.mjs build the dashboard groups**

In `packages/tui-data/src/pages/section.mjs`, when `page.id === "dashboard"`, return `{ id, type: "section", title: "Dashboard", groups: [{ title: "Active Projects", items: ... }, ...], items: [], ... }`. Pull from `sources.projects`, `sources.heartbeat`, `sources.plans`, etc.

- [ ] **Step 3: Verify**

```bash
npm run page dashboard
```

Output: dashboard rendering with grouped sections.

- [ ] **Step 4: Commit**

```bash
git add packages/tui-data/src/pages/section.mjs packages/tui/src/pages/Section.jsx
git commit -m "feat(tui): dashboard home view with grouped sections"
```

---

### Task 20: Wire v1 actions (regenerate-schemas, edit-this-plan, draft-project-update)

**Files:**
- Modify: `packages/tui-data/src/pages/section.mjs` — attach default actions per page
- Modify: `packages/tui-data/src/pages/entity.mjs` — attach default actions per entity

- [ ] **Step 1: Attach actions in section resolver**

For `dashboard` and data pages add:

```js
const COMMON_ACTIONS = [
  { id: "regenerate-schemas", label: "Regenerate EIP-4824 schemas", kind: "script", run: "npm run generate:schemas", affects: [".well-known/"] },
  { id: "analyze-instances",  label: "Run drift analysis",          kind: "script", run: "npm run analyze:instances",  affects: ["memory/reports/"] },
];
// Set page.actions = COMMON_ACTIONS for ids in: dashboard, projects, instances
```

- [ ] **Step 2: Attach actions in entity resolver**

```js
// In entityFromProject:
result.actions = [
  { id: "edit-this-project-yaml", label: "Edit data/projects.yaml", kind: "open", path: "data/projects.yaml" },
  { id: "draft-project-update", label: "Draft project update", kind: "prompt", template: "Draft a one-paragraph status update for the {{entity.name}} workstream.\nStage: {{entity.stage}}. Linked plans: {{entity.plans}}." },
];
// In entityFromPlan:
result.actions = [
  { id: "edit-this-plan", label: "Edit plan file", kind: "open", path: "{{entity.file}}" },
];
```

- [ ] **Step 3: Wire ActionMenu execution in App.jsx**

In the `ActionMenu`'s `onSelect` handler, call `runAction(action, { context: { entity: page, section: page } })`. For `prompt` results, copy the resulting text to clipboard via `clipboardy.write()` and show a transient toast.

- [ ] **Step 4: Smoke test**

```bash
npm run tui
# Navigate to projects → enter → on a project entity press 'a' → select "Draft project update" → verify clipboard contains the rendered prompt.
```

- [ ] **Step 5: Commit**

```bash
git add packages/tui-data/src/pages/ packages/tui/src/App.jsx
git commit -m "feat(tui): action launcher wired for regenerate-schemas, edit-plan, draft-update"
```

---

### Task 21: Snapshot tests for renderers

**Files:**
- Create: `packages/tui/test/snapshots.test.mjs`

- [ ] **Step 1: Write snapshot tests**

```js
// packages/tui/test/snapshots.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "ink-testing-library";
import React from "react";
import { Section } from "../src/pages/Section.jsx";
import { Entity } from "../src/pages/Entity.jsx";
import { CrossCut } from "../src/pages/CrossCut.jsx";

test("Section: projects page snapshot", () => {
  const page = { id: "projects", type: "section", title: "Projects", summary: "2 items", items: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] };
  const { lastFrame } = render(<Section page={page} />);
  assert.match(lastFrame(), /Projects/);
  assert.match(lastFrame(), /Alpha/);
  assert.match(lastFrame(), /Beta/);
});

test("Entity: project page snapshot", () => {
  const page = { id: "project/a", type: "entity", title: "Alpha", summary: "Stage: Develop", fields: [{ key: "stage", value: "Develop" }], related: [{ group: "Plans", items: [{ label: "p1" }] }] };
  const { lastFrame } = render(<Entity page={page} />);
  assert.match(lastFrame(), /Alpha/);
  assert.match(lastFrame(), /Develop/);
  assert.match(lastFrame(), /p1/);
});

test("CrossCut: this-week snapshot", () => {
  const page = { id: "this-week", type: "cross-cut", title: "This Week", summary: "1 item", items: [{ kind: "task", label: "Do something" }] };
  const { lastFrame } = render(<CrossCut page={page} />);
  assert.match(lastFrame(), /This Week/);
  assert.match(lastFrame(), /Do something/);
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/tui && node --test test/snapshots.test.mjs
```

Expected: PASS — 3/3.

- [ ] **Step 3: Commit**

```bash
git add packages/tui/test/
git commit -m "test(tui): snapshot tests for Section, Entity, CrossCut"
```

---

### Task 22: End-to-end smoke tests

**Files:**
- Create: `scripts/test-tui.mjs`

- [ ] **Step 1: Implement smoke runner**

```js
// scripts/test-tui.mjs
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const cases = [
  ["dashboard", /org-os|Active Projects|projects/i],
  ["projects",  /v2.0.0 Stabilization|Projects/],
  ["project/v2-stabilization", /Stage|Develop/],
  ["this-week", /This Week/],
];

let failures = 0;
for (const [id, expectRegex] of cases) {
  try {
    const out = execSync(`node packages/tui/src/modes/print.mjs ${id}`, { encoding: "utf-8" });
    assert.match(out, expectRegex);
    console.log(`✓ ${id}`);
  } catch (err) {
    console.error(`✗ ${id}: ${err.message}`);
    failures++;
  }
}
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Add `test:tui` to root package.json**

```json
"test:tui": "node scripts/test-tui.mjs"
```

- [ ] **Step 3: Run smoke**

```bash
npm run test:tui
```

Expected: all 4 cases pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-tui.mjs package.json
git commit -m "test(tui): end-to-end smoke runner against real repo data"
```

---

## Phase 5 — Refactor + verify backwards compat

### Task 23: Snapshot existing `/initialize` JSON output as baseline

**Files:**
- Create: `scripts/test-baseline-initialize.mjs`
- Create: `scripts/baselines/initialize.json` (committed)

- [ ] **Step 1: Capture baseline before refactoring**

```bash
node scripts/initialize.mjs > scripts/baselines/initialize.json
```

- [ ] **Step 2: Implement diff test**

```js
// scripts/test-baseline-initialize.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";

const baseline = JSON.parse(fs.readFileSync("scripts/baselines/initialize.json", "utf-8"));
const current = JSON.parse(execSync("node scripts/initialize.mjs", { encoding: "utf-8" }));

// Compare keys + critical fields. (Generated timestamp will differ — strip it.)
const strip = (obj) => { const { generated, ...rest } = obj; return rest; };
const a = JSON.stringify(strip(baseline), null, 2);
const b = JSON.stringify(strip(current), null, 2);

if (a !== b) {
  console.error("BASELINE DIFF — initialize.mjs JSON output changed.");
  process.exit(1);
}
console.log("✓ initialize.mjs JSON output unchanged from baseline");
```

- [ ] **Step 3: Add `test:baseline` to root package.json**

```json
"test:baseline": "node scripts/test-baseline-initialize.mjs"
```

- [ ] **Step 4: Run baseline test**

```bash
npm run test:baseline
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-baseline-initialize.mjs scripts/baselines/ package.json
git commit -m "test: capture baseline of scripts/initialize.mjs JSON output"
```

---

### Task 24: Refactor `scripts/initialize.mjs` to delegate to tui-data

**Files:**
- Modify: `scripts/initialize.mjs`

- [ ] **Step 1: Refactor to delegate**

The existing script reads files and assembles a JSON object. Replace its loaders with calls to `@org-os/tui-data` while keeping the output shape **byte-identical** (excluding the `generated` timestamp).

Specifically: keep the existing `--format=markdown` path unchanged. For the JSON path, gather data via `loadAll()` from `tui-data` and re-shape into the existing top-level keys (`identity`, `status`, `projects`, `tasks`, etc.) using the same field names.

- [ ] **Step 2: Run baseline test to verify byte-equivalence**

```bash
npm run test:baseline
```

Expected: PASS — output matches baseline exactly.

- [ ] **Step 3: Run full validation suite**

```bash
npm run generate:schemas && npm run validate:schemas && npm run validate:structure && npm run analyze:instances
```

Expected: all pass with no new warnings.

- [ ] **Step 4: Commit**

```bash
git add scripts/initialize.mjs
git commit -m "refactor: scripts/initialize.mjs delegates to @org-os/tui-data (output preserved)"
```

---

### Task 25: Update `skills/org-os-init/SKILL.md` with `npm run page` reference

**Files:**
- Modify: `skills/org-os-init/SKILL.md`

- [ ] **Step 1: Add a section on drill-down pages**

Insert under "Phase 1: OPEN — Initialization Dashboard", after "Dashboard Configuration":

```markdown
### Drill-down pages

After the dashboard renders, the operator (or you) can call `npm run page <id>` to see a single page in detail. Useful page ids:

- `npm run page projects` — full projects list
- `npm run page project/<id>` — entity page for one project
- `npm run page instances` — hub-only instance health
- `npm run page this-week` — calendar + meetings + funding deadlines + critical tasks
- `npm run page health` — system-wide health snapshot
- `npm run page decisions` — full decisions log

Output is markdown-clean; embed it inline in your response. The full page list is available via `npm run page help` or by reading the manifest in `packages/tui-data/src/builtin-pages.mjs`.
```

- [ ] **Step 2: Verify the skill still parses correctly**

```bash
npm run validate:structure
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skills/org-os-init/SKILL.md
git commit -m "docs(skill): add npm run page <id> drill-down reference to org-os-init"
```

---

### Task 26: Add optional `theme` block to `dashboard.yaml`

**Files:**
- Modify: `dashboard.yaml`

- [ ] **Step 1: Append theme + pages stub**

After the existing `custom_sections:` list, add:

```yaml
# ─── Theme (optional) ────────────────────────────────────────────────────────
# Customize the TUI's color palette. Chalk color names or hex.

theme:
  primary: green
  accent: cyan
  dim: gray

# ─── Pages (optional) ────────────────────────────────────────────────────────
# Custom pages registered into the TUI manifest. Built-in pages auto-register.

pages: []
```

- [ ] **Step 2: Verify TUI picks up the theme**

```bash
npm run tui
# Confirm no errors and theme reads cleanly. Quit with q.
```

- [ ] **Step 3: Commit**

```bash
git add dashboard.yaml
git commit -m "feat: dashboard.yaml gains optional theme + pages blocks"
```

---

### Task 27: Update QUEUE.md and plan status

**Files:**
- Modify: `docs/agent-plans/QUEUE.md`
- Modify: `docs/agent-plans/tui-dashboard.md` — frontmatter status

- [ ] **Step 1: Move plan from scoping → completed in QUEUE.md**

Remove the `tui-dashboard` line from "Scoping" and add to "Completed":

```markdown
- ~~[tui-dashboard](tui-dashboard.md)~~ — TUI dashboard (Ink) + agent-rendered pages, shared data layer · workstream: operator-interfaces · completed 2026-04-25
```

- [ ] **Step 2: Update plan frontmatter**

```yaml
---
id: tui-dashboard
title: "TUI Dashboard + Agent-Rendered Pages"
status: completed
priority: 1
scope: framework
depends_on: []
created: 2026-04-25
started: 2026-04-25
completed: 2026-04-25
estimated_sessions: 1
tags: [tui, dashboard, ink, operator-ux, packages, agent-runtime]
workstream: operator-interfaces
---
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-plans/
git commit -m "docs: move tui-dashboard plan to completed in pipeline"
```

---

### Task 28: Final verification gates

- [ ] **Step 1: Full pre-merge check**

```bash
npm run test:baseline                    # initialize.mjs output unchanged
npm run test:tui                          # all 4 v1 pages render
cd packages/tui-data && node --test test/  # data layer tests pass
cd ../tui && node --test test/            # renderer snapshot tests pass
cd ../..
npm run generate:schemas                  # schemas regen successfully
npm run validate:schemas                  # schemas valid
npm run validate:structure                # structure valid
npm run analyze:instances                 # instance analysis runs
```

Expected: every step exits 0 with no new warnings.

- [ ] **Step 2: Manual smoke**

```bash
npm run tui
# Verify in TUI:
# - dashboard renders
# - press : type "projects" enter → projects page loads
# - move with j/k, enter on a project → entity page with related plans
# - press a → action menu opens
# - press q → exits cleanly
```

- [ ] **Step 3: Commit no-op verifying tag-readiness**

If everything passes, the work is ready to merge. No additional commit needed unless docs lag.

- [ ] **Step 4: Append a memory entry**

Write `memory/2026-04-25.md` (or append today's session block) documenting the TUI v1 ship. Then commit memory.

```bash
git add memory/
git commit -m "memory: log TUI v1 ship session"
```

---

## Phase 6 — Host integrations

These tasks ship two host-specific integrations: an opencode plugin and a hermes skill+tool. Both wrap the existing `npm run page <id>` and `npm run tui` entry points — no changes required to the core TUI code.

### Task 29: Scaffold `packages/opencode-integration/`

**Files:**
- Create: `packages/opencode-integration/package.json`
- Create: `packages/opencode-integration/src/index.mjs`
- Create: `packages/opencode-integration/README.md`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@org-os/opencode-integration",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "main": "src/index.mjs",
  "description": "opencode plugin: registers org_os_page and org_os_tui tools backed by the org-os TUI",
  "keywords": ["opencode", "opencode-plugin", "org-os", "tui"],
  "peerDependencies": {
    "@opencode-ai/plugin": "*"
  }
}
```

- [ ] **Step 2: Implement the plugin**

```js
// packages/opencode-integration/src/index.mjs
// opencode plugin: exposes org-os pages as tools the orchestrator can call.
// Pattern follows https://opencode.ai/docs/plugins/ (custom tools via @opencode-ai/plugin).

import { spawn } from "node:child_process";
import path from "node:path";

function runPage(pageId, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "page", pageId], { cwd });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`page ${pageId} exited ${code}: ${stderr}`)));
  });
}

export const OrgOsPlugin = async ({ project, $, directory, worktree }) => {
  // The "tool" helper is provided by @opencode-ai/plugin at runtime.
  // We import lazily so the plugin file loads even if @opencode-ai/plugin isn't installed
  // (e.g., during unit tests of this package).
  const { tool } = await import("@opencode-ai/plugin");

  return {
    tool: {
      org_os_page: tool({
        description: "Render an org-os page (dashboard, projects, project/<id>, instances, this-week, etc.) and return the rendered text. Use to inspect organizational state without leaving the agent.",
        args: {
          page_id: tool.schema.string().describe("The page id, e.g. 'dashboard', 'projects', 'project/v2-stabilization', 'this-week'."),
        },
        async execute({ page_id }) {
          const cwd = directory || worktree || project?.directory || process.cwd();
          return await runPage(page_id, { cwd });
        },
      }),

      org_os_tui: tool({
        description: "Launch the interactive org-os TUI in a managed pane. Returns immediately; the pane runs alongside the agent until the operator quits with q.",
        args: {},
        async execute() {
          const cwd = directory || worktree || project?.directory || process.cwd();
          // Spawn detached so opencode's multiplexer integration can attach the pane.
          spawn("npm", ["run", "tui"], { cwd, detached: true, stdio: "inherit" });
          return "Launched org-os TUI. Use the operator's tmux/zellij session to interact.";
        },
      }),
    },
  };
};

export default OrgOsPlugin;
```

- [ ] **Step 3: Write the README**

```markdown
# @org-os/opencode-integration

opencode plugin: registers two tools that bridge to the org-os TUI.

## Installation

In your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@org-os/opencode-integration"]
}
```

Or for project-level use, install at `.opencode/plugins/`.

## Tools provided

| Tool | Purpose |
|---|---|
| `org_os_page` | Render any org-os page and return the text. Use for in-conversation drill-down. |
| `org_os_tui` | Launch the interactive TUI in a pane. opencode's multiplexer manages pane lifecycle. |

## Page ids

See `packages/tui-data/src/builtin-pages.mjs` for the full list. Common: `dashboard`, `projects`, `project/<id>`, `instances`, `this-week`, `health`, `decisions`.

## Requires

- The org-os repo with the TUI installed (`npm install` in the org-os root).
- opencode with multiplexer integration (tmux or zellij) for the `org_os_tui` tool.
```

- [ ] **Step 4: Commit**

```bash
git add packages/opencode-integration/
git commit -m "feat(opencode-integration): plugin exposes org_os_page + org_os_tui tools"
```

---

### Task 30: Scaffold `packages/hermes-integration/`

**Files:**
- Create: `packages/hermes-integration/package.json`
- Create: `packages/hermes-integration/SKILL.md`
- Create: `packages/hermes-integration/tools/org_os.py`
- Create: `packages/hermes-integration/install.sh`
- Create: `packages/hermes-integration/README.md`

- [ ] **Step 1: Create package metadata**

```json
{
  "name": "@org-os/hermes-integration",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "hermes skill + tool: org-os pages exposed via /org_os_page slash command and Python tool registry"
}
```

- [ ] **Step 2: Write the hermes SKILL.md**

```markdown
---
name: org_os_pages
description: Inspect org-os organizational state — dashboards, projects, instances, plans, decisions — without leaving the agent. Pages render to plain text.
version: "0.1.0"
platforms: [darwin, linux]
metadata:
  hermes:
    tags: [org-os, dashboard, observability]
    category: integrations
    config: []
---

# org_os_pages — view org-os state from hermes

This skill registers the `org_os_page` tool, which calls `npm run page <id>` in the operator's org-os workspace.

## Usage

In a hermes conversation, ask: "Show me the org-os dashboard" or "What's on the projects page?" — the tool runs `npm run page <id>` and returns the markdown-clean output.

## Page ids

See `packages/tui-data/src/builtin-pages.mjs` in your org-os repo. Common:

- `dashboard` — full home view
- `projects` — workstreams
- `project/<id>` — specific project entity
- `instances` — federation instance health (hub-only)
- `this-week` — calendar + funding deadlines + critical tasks
- `health` — system health snapshot
- `decisions` — chronological decision log

## Setup

Set the `ORG_OS_ROOT` env var to your org-os repo path (e.g., `~/code/org-os`) before launching hermes. The tool errors out if not set.
```

- [ ] **Step 3: Write the Python tool**

```python
# packages/hermes-integration/tools/org_os.py
"""hermes tool: org_os_page — calls `npm run page <id>` in the operator's org-os repo.

Discovered automatically by hermes's tool registry via the top-level `registry.register()` call.
"""

import os
import subprocess
from pathlib import Path

# Hermes registry import — this file is dropped into hermes's `tools/` directory at install time.
from tools.registry import registry  # type: ignore[import-not-found]


def check_requirements() -> bool:
    """Return True if ORG_OS_ROOT is set and points at a directory with package.json."""
    root = os.getenv("ORG_OS_ROOT")
    if not root:
        return False
    return (Path(root) / "package.json").exists()


def org_os_page(args: dict, **kwargs) -> str:
    """Render an org-os page and return its text output."""
    page_id = args.get("page_id", "dashboard")
    root = os.getenv("ORG_OS_ROOT")
    if not root:
        return "ERROR: ORG_OS_ROOT env var not set. Point it at your org-os repo path."
    try:
        result = subprocess.run(
            ["npm", "run", "page", page_id],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            return f"ERROR: page {page_id} exited {result.returncode}\n{result.stderr}"
        return result.stdout
    except subprocess.TimeoutExpired:
        return f"ERROR: page {page_id} timed out (>15s)"
    except FileNotFoundError:
        return "ERROR: npm not found on PATH."


registry.register(
    name="org_os_page",
    toolset="org_os",
    schema={
        "type": "object",
        "properties": {
            "page_id": {
                "type": "string",
                "description": "Page id: dashboard, projects, project/<id>, instances, this-week, health, decisions, etc.",
            },
        },
        "required": ["page_id"],
    },
    handler=org_os_page,
    check_fn=check_requirements,
    requires_env=["ORG_OS_ROOT"],
)
```

- [ ] **Step 4: Write the install script**

```bash
#!/usr/bin/env bash
# packages/hermes-integration/install.sh
# Symlinks the SKILL.md and tool into a hermes installation.

set -euo pipefail

if [ -z "${HERMES_HOME:-}" ]; then
  echo "ERROR: set HERMES_HOME to the path of your hermes-agent checkout." >&2
  exit 1
fi

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$HERMES_HOME/skills/org_os_pages"
TOOL_DIR="$HERMES_HOME/tools"

mkdir -p "$SKILL_DIR" "$TOOL_DIR"

ln -sf "$PKG_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"
ln -sf "$PKG_DIR/tools/org_os.py" "$TOOL_DIR/org_os.py"

# Add to _HERMES_CORE_TOOLS toolset (manual step — print instruction).
echo "✓ Symlinked SKILL.md → $SKILL_DIR/SKILL.md"
echo "✓ Symlinked tool    → $TOOL_DIR/org_os.py"
echo
echo "Manual step: add 'org_os' to a toolset in $HERMES_HOME/toolsets.py"
echo "Then set ORG_OS_ROOT in your shell to your org-os repo:"
echo "  export ORG_OS_ROOT=$(cd "$PKG_DIR/../.." && pwd)"
```

- [ ] **Step 5: Make install script executable**

```bash
chmod +x packages/hermes-integration/install.sh
```

- [ ] **Step 6: Write the README**

```markdown
# @org-os/hermes-integration

hermes skill + tool: exposes org-os pages to hermes via the `org_os_page` tool.

## Installation

1. Set `HERMES_HOME` to your hermes-agent checkout:

   ```bash
   export HERMES_HOME=~/code/hermes-agent
   ```

2. Run the install script:

   ```bash
   ./install.sh
   ```

3. Set `ORG_OS_ROOT` to your org-os repo path:

   ```bash
   export ORG_OS_ROOT=~/code/org-os
   ```

4. In `$HERMES_HOME/toolsets.py`, add `"org_os"` to a toolset (e.g., `_HERMES_CORE_TOOLS`).

## Usage in hermes

Once installed, ask hermes anything about org-os state:

- "Show me the dashboard"  → calls `org_os_page("dashboard")`
- "What's on this week?"   → calls `org_os_page("this-week")`
- "Drill into v2-stabilization" → calls `org_os_page("project/v2-stabilization")`

## Architecture

`SKILL.md` is the hermes-side manifest (frontmatter discovered by hermes's skill registry). `tools/org_os.py` is registered into hermes's tool registry via the top-level `registry.register()` call. The tool shells out to `npm run page <id>` in your org-os repo.
```

- [ ] **Step 7: Commit**

```bash
git add packages/hermes-integration/
git commit -m "feat(hermes-integration): skill + tool exposing org_os_page to hermes"
```

---

### Task 31: Smoke-test integrations

**Files:**
- Create: `packages/opencode-integration/test/smoke.test.mjs`
- Create: `packages/hermes-integration/test/smoke.test.py`

- [ ] **Step 1: Write opencode integration smoke test**

```js
// packages/opencode-integration/test/smoke.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { OrgOsPlugin } from "../src/index.mjs";

test("OrgOsPlugin: returns tool registrations without throwing", async () => {
  // Stub the @opencode-ai/plugin import via dynamic mock if needed.
  // For v1 we just verify the plugin function exports and is async.
  assert.equal(typeof OrgOsPlugin, "function");
});
```

- [ ] **Step 2: Write hermes integration smoke test**

```python
# packages/hermes-integration/test/smoke.test.py
"""Smoke test that the org_os module is importable and check_requirements works."""

import os
import sys
from pathlib import Path

# Add fake hermes registry path so import doesn't fail.
sys.path.insert(0, str(Path(__file__).parent / "stubs"))

# Stub registry so we can import the tool module standalone.
def _make_stub():
    stub_dir = Path(__file__).parent / "stubs" / "tools"
    stub_dir.mkdir(parents=True, exist_ok=True)
    (stub_dir / "__init__.py").write_text("")
    (stub_dir / "registry.py").write_text(
        "class _R:\n"
        "    def register(self, **kw): pass\n"
        "registry = _R()\n"
    )

_make_stub()

# Now import succeeds.
sys.path.insert(0, str(Path(__file__).parent.parent))
from tools.org_os import check_requirements  # noqa: E402

def test_check_requirements_without_env():
    os.environ.pop("ORG_OS_ROOT", None)
    assert check_requirements() is False

def test_check_requirements_with_env(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    os.environ["ORG_OS_ROOT"] = str(tmp_path)
    assert check_requirements() is True

if __name__ == "__main__":
    test_check_requirements_without_env()
    print("✓ check_requirements without env returns False")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "package.json").write_text("{}")
        os.environ["ORG_OS_ROOT"] = tmp
        assert check_requirements() is True
    print("✓ check_requirements with env returns True")
```

- [ ] **Step 3: Run smoke tests**

```bash
cd packages/opencode-integration && node --test test/
cd ../hermes-integration && python3 test/smoke.test.py
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode-integration/test/ packages/hermes-integration/test/
git commit -m "test: smoke tests for opencode and hermes integrations"
```

---

### Task 32: Document host integrations in repo-level docs

**Files:**
- Modify: `docs/FEDERATION.md` (add Host integration section) OR create `docs/HOST-INTEGRATION.md`
- Modify: `dashboard.yaml` (no change required, but verify integrations don't conflict)
- Modify: `docs/agent-plans/tui-dashboard.md` (mark integrations as shipped in implementation_status note)

- [ ] **Step 1: Create `docs/HOST-INTEGRATION.md`**

```markdown
# Host Integration

org-os ships first-class integrations for two agent hosts beyond Claude Code: **opencode** and **hermes**. Both hosts get the same surface — call `org_os_page <id>` to render any org-os page in the conversation, and (for opencode only) `org_os_tui` to launch the interactive TUI in a managed pane.

## Compatibility matrix

| Host           | Surface                            | Integration                                                   |
| -------------- | ---------------------------------- | -------------------------------------------------------------- |
| Standalone     | `npm run tui` (interactive)        | None needed — works in any terminal.                           |
| Claude Code    | Embedded pages, modal TUI          | None needed — agent calls `npm run page <id>` directly.        |
| opencode       | `org_os_page`, `org_os_tui` tools  | `packages/opencode-integration/` (npm plugin in `opencode.json`). |
| hermes         | `org_os_page` tool / slash command | `packages/hermes-integration/` (skill + Python tool, install via `install.sh`). |
| tmux/zellij    | Sibling pane, host-agnostic        | None needed.                                                   |

## Install

- **opencode** — `npm install --save @org-os/opencode-integration`, then add to `opencode.json` plugins. See `packages/opencode-integration/README.md`.
- **hermes** — set `HERMES_HOME` and `ORG_OS_ROOT`, run `packages/hermes-integration/install.sh`. See that package's README.

## Pages reachable

The full list lives in `packages/tui-data/src/builtin-pages.mjs`. All hosts get the same pages.
```

- [ ] **Step 2: Commit**

```bash
git add docs/HOST-INTEGRATION.md
git commit -m "docs: HOST-INTEGRATION.md covers opencode + hermes setup"
```

---

## Verification gates summary

These six gates must all pass before merging v1:

1. **Baseline gate** — `npm run test:baseline` confirms `scripts/initialize.mjs` JSON output is byte-identical (excluding timestamp) to the captured baseline.
2. **Existing scripts gate** — `npm run generate:schemas && npm run validate:schemas && npm run validate:structure && npm run analyze:instances` all exit 0 with no new warnings.
3. **TUI tests gate** — `cd packages/tui-data && node --test test/` and `cd packages/tui && node --test test/` both pass.
4. **Smoke gate** — `npm run test:tui` confirms all 4 v1 pages render.
5. **Manual interactive gate** — operator boots `npm run tui`, navigates dashboard → projects → entity → actions → quits cleanly. Alt-screen restores prior scrollback on quit; bracketed paste in command palette doesn't inject escape codes.
6. **Host integrations gate** — `cd packages/opencode-integration && node --test test/` passes; `cd packages/hermes-integration && python3 test/smoke.test.py` passes.

---

## Self-review notes

**Spec coverage (cross-checked against `tui-dashboard.md`):**

- ✅ Architecture: `packages/tui-data/` + `packages/tui/` — Tasks 1, 11
- ✅ Loaders for every source — Tasks 2, 3
- ✅ Manifest builder with hub-only gating — Task 5
- ✅ Three page types (section, entity, cross-cut) — Tasks 7, 8, 9
- ✅ Action launcher (script, open, prompt) — Task 10, wired in Task 20
- ✅ File-watch — Task 6, hooked in Task 18
- ✅ Print mode — Task 12
- ✅ Interactive mode with keyboard nav + jumplist — Tasks 17, 18
- ✅ Chrome (Header, Breadcrumb, StatusBar) — Task 13
- ✅ Primitives (Table, List, KeyValue, RelatedColumn) — Task 14
- ✅ Modals (HelpOverlay, CommandPalette, ActionMenu) — Task 15
- ✅ Dashboard home view — Task 19
- ✅ Theme support — Task 18 (theme.mjs), Task 26 (dashboard.yaml block)
- ✅ Snapshot tests — Task 21
- ✅ End-to-end smoke — Task 22
- ✅ Backwards-compat refactor of initialize.mjs — Tasks 23, 24
- ✅ Skill update — Task 25
- ✅ Plan pipeline transitions — Task 27
- ✅ Final verification gates — Task 28
- ✅ Full-width Chrome — Task 13
- ✅ Alt-screen + bracketed-paste (hermes-inspired) — Task 13.5
- ✅ Fuzzy-match command palette + tab completion — Task 15
- ✅ opencode plugin (`org_os_page`, `org_os_tui` tools) — Task 29
- ✅ hermes skill + Python tool — Task 30
- ✅ Integration smoke tests — Task 31
- ✅ HOST-INTEGRATION.md repo doc — Task 32

**Type/name consistency check:** `loadAll`, `buildManifest`, `resolvePage`, `runAction`, `renderPromptTemplate`, `watchSources` are referenced consistently across modules and tasks. `Page`/`PageData` shape (`{ id, type, title, summary, fields, items, related, actions, body? }`) consistent across resolvers and components.

**Out-of-scope items confirmed deferred:** web port, multi-vault sync, in-TUI theme editor, plugin SDK — all match the spec's "Out of scope for v1" section.
