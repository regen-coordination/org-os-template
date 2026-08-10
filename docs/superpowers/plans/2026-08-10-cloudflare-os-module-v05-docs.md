# Cloudflare OS Module + v0.5 Self-Description — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Cloudflare OS integration org-os's first tracked module, and give org-os a layered self-description — README spine, `docs/MODULES.md` catalog, wired into the site — so the framework explains itself the way `os.cloudflare.app` does.

**Architecture:** No code moves. A manifest at `modules/org-os-cloudflare-os/module.yaml` describes the already-shipped `packages/cloudflare-os-integration/` in place, validated by the module engine's existing `validateManifest()`. Documentation flows down one canonical chain: `docs/POSITIONING.md` → README template + `site/src/data/landing.yaml` (narrative), and `docs/MODULES.md` → `site/src/data/modules.yaml` (catalog), with a test enforcing the catalog half.

**Tech Stack:** Node ≥22 ESM, `node --test` (repo standard), `js-yaml`, Astro 5 (site), the existing `templates/render.mjs` engine. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-cloudflare-os-module-v05-docs-design.md`
**Branch:** `autopoiesis-phase2-pilot` (current work branch)

---

## Discoveries that change the spec (read before starting)

Three things were verified in the repo after the spec was approved. **Task 0 folds them back into the spec** so spec and plan don't disagree.

1. **The module engine partially exists.** `scripts/modules.mjs` (70 lines, commits `9194990`, `c256135`) exports `validateManifest()`, `REQUIRED_FIELDS`, `MODULE_TYPES`, `KNOWN_FIELDS`, and `schemas/module.schema.json` is already written. The CLI, `loadRegistry`, `add`, and `adopt` are **not** implemented; there is no `npm run module` script and no `data/modules.yaml`. So the spec's "no validation tooling in this spec" is wrong in our favour — **the manifest can and must be validated by real tooling** (Task 2).
2. **`README.md` is generated**, not hand-written — `templates/README.framework.md` → `npm run render:templates` (`scripts/render-templates.mjs`). Editing `README.md` directly would be silently reverted on the next render. The spec says "README.md rewrite"; the real target is the **template**.
3. **The README's documentation list is alphabetical-and-blurbless by construction** — `render-templates.mjs` does `readdirSync(docs).sort().slice(0, 12)` with `blurb: ""`. That is why every entry renders as `- [AGENT MODES](docs/AGENT-MODES.md) — ` with a trailing dash and nothing after it. It also means `MODULES.md` (alphabetically 15th) **would never appear**. Task 4 replaces the slice with a curated spine.

Also note: `schemas/module.schema.json` sets `additionalProperties: false` and `validateManifest` rejects unknown fields, so the manifest may use **only** `id`, `version`, `type`, `description`, `dependencies`, `files`, `templates`, `checks`, `npm`.

---

## File structure

| File | Responsibility |
|---|---|
| `modules/org-os-cloudflare-os/module.yaml` | **Create.** The manifest — the module's identity and the files it owns in place |
| `modules/README.md` | **Create.** What `modules/` is, why it has one inhabitant, the in-place convention |
| `tests/scripts/module-manifests.test.mjs` | **Create.** Every `modules/*/module.yaml` parses, validates, and its `id` matches its directory |
| `docs/MODULES.md` | **Create.** The hand-authored v0.5 module catalog — the canonical list |
| `docs/PACKAGES.md` | **Modify.** Deprecation banner pointing at MODULES.md |
| `templates/README.framework.md` | **Modify.** The four-layer spine (what it is / how it's organized / what you can do / run it yourself) |
| `scripts/render-templates.mjs` | **Modify.** Curated `DOC_SPINE` with blurbs, replacing the alphabetical slice |
| `README.md` | **Generated** by `npm run render:templates` — never hand-edited |
| `site/src/data/landing.yaml` | **Modify.** Hero copy from POSITIONING.md |
| `site/src/data/modules.yaml` | **Modify.** Mirror of MODULES.md; `pilot` status added |
| `site/src/data/docs-allowlist.ts` | **Modify.** Surface MODULES.md at `/docs/modules` |
| `site/src/components/StatusBadge.astro` | **Modify.** `pilot` status: type, label, style |
| `site/src/components/ModuleCard.astro` | **Modify.** `pilot` in the Props union |
| `site/src/pages/modules.astro` | **Modify.** `pilot` in the Module interface |
| `site/scripts/verify-build.mjs` | **Modify.** Require `docs/modules/index.html` in the build |
| `site/test/modules-catalog.test.mjs` | **Create.** Enforces the MODULES.md → modules.yaml canonical chain |
| `docs/RAD-ORG-OS.md` | **Modify.** The substrate-seam section |
| `docs/integrations/cloudflare-os.md` | **Modify.** The deployment runbook checklist |
| `DECISIONS.md`, `HEARTBEAT.md`, `memory/2026-08-10.md` | **Modify/Create.** Process wiring |

**Status vocabulary** (used by MODULES.md, `modules.yaml`, and the three site components): `planned` → `in-dev` → `pilot` → `live`.

---

## Task 0: Fold the discoveries back into the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-cloudflare-os-module-v05-docs-design.md`

- [ ] **Step 1:** In §0's decision table, change the "Module framing" row's value to:

```
**Manifest-first.** `modules/org-os-cloudflare-os/module.yaml` conforming to the approved v5 format and **validated by the engine's existing `validateManifest()`**; `add`/`adopt` land with Phase 1. No file moves
```

- [ ] **Step 2:** In §1, replace the paragraph beginning "**Engine relationship.**" with:

```markdown
**Engine relationship.** `scripts/modules.mjs` already ships `validateManifest()` and
`schemas/module.schema.json` (v5 Phase 1, partially executed — the CLI, `loadRegistry`, `add`
and `adopt` are not built, and there is no `data/modules.yaml`). The manifest is therefore
validated by real tooling from day one, under a repo test that covers every
`modules/*/module.yaml`. `org-os-cloudflare-os` becomes the first inhabitant of `modules/` and
a live test of the manifest format against a real integration.

**In-place convention.** The v5 schema describes `files` as "source → target path map for
materialized content." This module materializes nothing — its content already sits at its
canonical paths. It therefore uses an **identity mapping** (`X: X`), read as "this module owns
these paths in place." That is an extension of the format, not a use of it as written, and it
is the first piece of feedback for Phase 1's `add`/`adopt`: adoption must treat an identity
mapping as "already installed, checksum it where it is" rather than copying a file onto itself.
```

- [ ] **Step 3:** In §2.1, replace the heading and first line so the generated-file reality is explicit:

```markdown
### 2.1 README spine (via `templates/README.framework.md`)

`README.md` is **generated** — `templates/README.framework.md` rendered by
`npm run render:templates`. The template is the edit target; hand-edits to `README.md` are
reverted by the next render. The template is restructured to the four-layer shape, with all
copy **sourced from `docs/POSITIONING.md`** — no new copywriting:
```

- [ ] **Step 4:** Append to §2.1, after the numbered list:

```markdown
The README's documentation list is also fixed here. Today `scripts/render-templates.mjs`
takes `readdirSync(docs).sort().slice(0, 12)` with an empty blurb for each — which is why
entries render as `- [AGENT MODES](docs/AGENT-MODES.md) — ` with nothing after the dash, and
why `MODULES.md` (alphabetically 15th) would never appear. It is replaced by a curated
`DOC_SPINE` constant with editorial order and real one-line blurbs, which fails the render
loudly if it names a doc that does not exist.
```

- [ ] **Step 5:** Commit:

```bash
git add docs/superpowers/specs/2026-08-10-cloudflare-os-module-v05-docs-design.md
git commit -m "spec(cloudflare-os): reconcile with shipped module engine and generated README"
```

---

## Task 1: `modules/` directory and its README

**Files:**
- Create: `modules/README.md`

- [ ] **Step 1:** Create `modules/README.md`:

```markdown
# modules/

Framework-side home of org-os **modules** — versioned units of organizational capability, each
described by a `module.yaml` manifest. See
[`docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md`](../docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md)
for the system design and [`docs/MODULES.md`](../docs/MODULES.md) for the operator-facing catalog.

## Current state

The module **engine** is partially built: `scripts/modules.mjs` validates manifests
(`validateManifest()`, mirrored by `schemas/module.schema.json`). Registry loading, `add`,
`adopt`, drift and health checks are v5 Phase 1–3 work and are not implemented yet. There is no
`data/modules.yaml` in any instance.

So a manifest here is, today, a **declaration**: it names a capability, its version, and the
files it owns. `tests/scripts/module-manifests.test.mjs` keeps every manifest valid and its id
matched to its directory, so the registry that Phase 1 builds will load a clean set.

## In-place modules

A module whose content already lives at canonical instance paths — an existing package, a
shipped doc — uses an **identity mapping** in `files`:

```yaml
files:
  packages/thing/**: packages/thing/**
```

Read as: *this module owns these paths where they are.* Nothing is copied. Phase 1's `adopt`
must treat an identity mapping as "already installed — checksum in place" rather than copying a
file onto itself.
```

- [ ] **Step 2:** Commit:

```bash
git add modules/README.md
git commit -m "docs(modules): framework modules directory + in-place convention"
```

---

## Task 2: The `org-os-cloudflare-os` manifest, TDD'd against the engine

**Files:**
- Create: `tests/scripts/module-manifests.test.mjs`
- Create: `modules/org-os-cloudflare-os/module.yaml`

- [ ] **Step 1:** Write the failing test `tests/scripts/module-manifests.test.mjs`:

```js
// tests/scripts/module-manifests.test.mjs
//
// Guards the real modules/ tree (not fixtures — that's modules.test.mjs). Every
// manifest the framework ships must parse, validate against the engine's
// contract, and live in a directory named after its id. This is what lets v5
// Phase 1's loadRegistry() assume a clean set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validateManifest } from '../../scripts/modules.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulesDir = join(rootDir, 'modules');

function moduleDirs() {
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

test('every module directory holds a valid manifest whose id matches the directory', () => {
  const dirs = moduleDirs();
  assert.ok(dirs.length > 0, 'expected at least one module in modules/');
  for (const dir of dirs) {
    const manifestPath = join(modulesDir, dir, 'module.yaml');
    assert.ok(existsSync(manifestPath), `${dir}/module.yaml is missing`);
    const manifest = yaml.load(readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(validateManifest(manifest), [], `${dir}/module.yaml failed validation`);
    assert.equal(manifest.id, dir, `${dir}/module.yaml declares id "${manifest.id}"`);
  }
});

test('org-os-cloudflare-os owns the integration package and its discovery doc', () => {
  const manifest = yaml.load(
    readFileSync(join(modulesDir, 'org-os-cloudflare-os', 'module.yaml'), 'utf-8'),
  );
  assert.equal(manifest.type, 'integration');
  assert.equal(manifest.npm, '@org-os/cloudflare-os-integration');
  // Identity mapping = "owns these paths in place" (see modules/README.md).
  for (const [src, target] of Object.entries(manifest.files)) {
    assert.equal(src, target, `files["${src}"] must be an identity mapping for an in-place module`);
  }
  assert.ok(Object.keys(manifest.files).includes('docs/integrations/cloudflare-os.md'));
});

test('every non-glob path a manifest claims actually exists', () => {
  for (const dir of moduleDirs()) {
    const manifest = yaml.load(readFileSync(join(modulesDir, dir, 'module.yaml'), 'utf-8'));
    for (const target of Object.values(manifest.files ?? {})) {
      if (target.includes('*')) continue; // globs are resolved by the engine, not here
      assert.ok(existsSync(join(rootDir, target)), `${dir}: claimed path missing — ${target}`);
    }
  }
});
```

- [ ] **Step 2:** Run and watch it fail:

```bash
node --test tests/scripts/module-manifests.test.mjs
```

Expected: FAIL — `ENOENT ... /modules` (the directory has only `README.md` from Task 1, so `moduleDirs()` returns `[]` and the first assertion trips: "expected at least one module in modules/").

- [ ] **Step 3:** Create `modules/org-os-cloudflare-os/module.yaml`:

```yaml
# org-os-cloudflare-os — the Cloudflare OS workspace integration.
#
# An IN-PLACE module: everything it owns already sits at its canonical path, so
# `files` is an identity mapping rather than a materialization map (see
# modules/README.md). Nothing here is copied on install.
#
# Status is tracked in docs/MODULES.md, not in this manifest — the v5 schema has
# no status field, and inventing one would fail `additionalProperties: false`.
id: org-os-cloudflare-os
version: 1.0.0
type: integration
description: >-
  Cloudflare OS workspace integration — the gatekeeper-org-os adapter, a pure page
  core shared with page-shim, GitHub/memory substrates, and the org-dashboard gadget.
dependencies:
  - org-os-standards
npm: "@org-os/cloudflare-os-integration"
files:
  packages/cloudflare-os-integration: packages/cloudflare-os-integration
  docs/integrations/cloudflare-os.md: docs/integrations/cloudflare-os.md
checks:
  - file-exists: packages/cloudflare-os-integration/src/adapter/gatekeeper-org-os/wrangler.jsonc
  - command: npm run test:cloudflare-os-integration
```

Note the `files` keys are plain directory paths, **not** `**` globs — the third test asserts every non-glob claimed path exists, and a literal `packages/…/**` string would not resolve on disk. The engine will expand a directory to its contents when `add`/`adopt` land.

- [ ] **Step 4:** Run the test:

```bash
node --test tests/scripts/module-manifests.test.mjs
```

Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5:** Run the full repo suite to confirm nothing else moved:

```bash
npm test
```

Expected: all green (the new file adds 3 tests to the existing count).

- [ ] **Step 6:** Commit:

```bash
git add modules/org-os-cloudflare-os tests/scripts/module-manifests.test.mjs
git commit -m "feat(modules): org-os-cloudflare-os manifest — first tracked module"
```

---

## Task 3: `docs/MODULES.md` — the v0.5 catalog

**Files:**
- Create: `docs/MODULES.md`
- Modify: `docs/PACKAGES.md`

The entry heading format `### <id> — <Name>` is **machine-read** by Task 6's test. Keep it exact.

- [ ] **Step 1:** Create `docs/MODULES.md`:

```markdown
# Modules — the org-os v0.5 catalog

> **Canonical list.** `site/src/data/modules.yaml` mirrors this file, and
> `site/test/modules-catalog.test.mjs` fails the build if the two drift. When they disagree,
> this file wins.
>
> **Hand-authored, for now.** v5 Phase 2 generates this from `modules/*/module.yaml` via the
> module engine (`scripts/modules.mjs`). Until then it is a maintained snapshot — and the
> format the generator should reproduce. Design:
> [`2026-08-02-org-os-v5-modularization-design.md`](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md).

A **module** is a versioned unit of organizational capability: a skill, a script, a schema, a
data template, an integration — or a bundle of all five. Modules are how org-os stays one
system instead of a pile of folders: each declares what it is and what files it owns, and
(from v5 Phase 1) each instance tracks which ones it has installed, at what version, and
whether they have drifted.

**Status vocabulary:** `planned` (specified, not built) · `in-dev` (being built) ·
`pilot` (built and verified, not yet running in production) · `live` (in production use).

---

## Tracked modules

Modules with a manifest in `modules/`.

### org-os-cloudflare-os — Cloudflare OS Integration

**What it is.** The bridge between an org-os instance and a
[Cloudflare OS](https://os.cloudflare.app/) workspace: org data, pages, and an org-literate
agent, reachable from a browser by people who will never touch git.

**How it works.** A `gatekeeper-org-os` Worker exposes read capabilities (`get_registry`,
`get_federation`, `get_schema`, `get_context_bundle`, `get_page`) over a **substrate
interface** — `GitHubSubstrate` today, with ETag/TTL caching and stale-while-revalidate; a
Radicle or workerd driver slots in without capability changes. All the meaning lives in
`packages/cloudflare-os-integration/` as pure, runtime-agnostic Node; the Worker is thin
wiring. Every answer carries provenance (the commit sha it was read from), and every read
authorizes an observation before it fetches.

**Status.** `pilot` — 86 tests green; verified against the live GitHub API for both a public
hub and a private instance on a local Cloudflare OS stack. Deployed-workspace verification and
the write path (M3) are pending.

**Links:** [manifest](../modules/org-os-cloudflare-os/module.yaml) ·
[discovery & runbook](integrations/cloudflare-os.md) ·
[design](superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md) ·
package `packages/cloudflare-os-integration/`

---

## The v5 core tranche

The seven modules the v5 spec migrates first. Each proves a different module shape; none has a
manifest yet.

### org-os-standards — Standards & Module Engine

**What it is.** The self-hosting core: EIP-4824 schema generation, structure validation, the
file-structure spec, and the module engine itself.

**How it works.** Everything else depends on it. It ships `scripts/modules.mjs`,
`schemas/module.schema.json`, and the validators wired into `npm run validate:schemas` and
`npm run validate:structure` — so the module system reaches instances through the same
materialization path as every other capability.

**Status.** `in-dev` — manifest validation and the schema ship today; registry loading, `add`,
`adopt`, drift and health checks are Phase 1–3.

**Links:** [v5 design](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md) ·
[file structure](FILE-STRUCTURE.md) · [EIP-4824 guide](EIP4824-GUIDE.md)

### org-os-federation — Federation

**What it is.** The protocol layer: how instances declare each other, publish machine-readable
state, and stay in lineage with the framework.

**How it works.** `federation.yaml` declares identity, peers, trust levels, and upstream;
`.well-known/*.json` publishes the instance to anyone who asks; `analyze:instances` reports
drift across the network; the federation map renders it all as a graph.

**Status.** `live` — running across 7 instances.

**Links:** [federation docs](FEDERATION.md) · package `packages/org-os-federation-map/`

### org-os-pm — Projects & Tasks

**What it is.** Workstream and task tracking: the projects registry, the plans queue, and the
dashboard sections that render them.

**How it works.** `data/projects.yaml` holds long-lived workstreams; `docs/agent-plans/`
holds short-lived execution plans queued against them; `/initialize` renders both.

**Status.** `live`.

**Links:** [data model](DATA-MODEL.md) · [plans](PLANS.md)

### org-os-meeting-processor — Meeting Processor

**What it is.** Transcript → structured meeting record → registry updates → knowledge base.

**How it works.** A skill-only module: `skills/meeting-processor/` plus the meeting templates
and the `data/meetings.yaml` shape. The simplest module shape in the system, which is why v5
uses it as a pilot.

**Status.** `live`.

**Links:** [data model](DATA-MODEL.md)

### org-os-knowledge — Knowledge Commons

**What it is.** Compiling, linting, indexing, and federating an org's knowledge.

**How it works.** A hybrid module: the `knowledge-curator` and `knowledge-graph` skills plus
the `@org-os/knowledge-commons` package and `data/knowledge-manifest.yaml`.

**Status.** `in-dev`.

**Links:** [knowledge commons quickref](knowledge-commons-quickref.md) ·
[practical guide](practical-knowledge-commons.md)

### org-os-funding — Funding

**What it is.** Grant and funding-opportunity tracking with deadline surfacing.

**How it works.** The `funding-scout` skill writes `data/funding-opportunities.yaml`;
`/initialize` surfaces deadlines inside 30 days.

**Status.** `live`.

### org-os-heartbeat — Heartbeat

**What it is.** The instance's live pulse — the module that consumes every other module's
health checks.

**How it works.** `heartbeat-monitor` aggregates checks into `HEARTBEAT.md`; from v5 Phase 3 it
calls the module engine's `check` and folds the results in as warnings.

**Status.** `in-dev`.

**Links:** [reliability](RELIABILITY.md)

---

## Distributions and surfaces

### rad-org-os — the sovereign distribution

**What it is.** The full org-os stack on [Radicle](https://radicle.xyz) — peer-to-peer, on
infrastructure no single platform can withdraw. And, because Radicle has no org or team
primitive of its own, the missing org layer for Radicle.

**How it works.** A substrate driver: the same capabilities org-os already runs against GitHub,
implemented against `radicle-httpd` and the `rad` CLI. The interface the Cloudflare OS module
shipped is the seam both sides build to.

**Status.** `in-dev`.

**Links:** [rad-org-os](RAD-ORG-OS.md)

### org-os-website-generator — Website Generator

**What it is.** Any instance's data and docs → a federated public site.

**How it works.** An Astro site reads `../docs` through a curated allowlist and federates
live-at-build from `data/instances.yaml` and sibling instances' `.well-known/`. The org-os site
is its first reference output.

**Status.** `in-dev`.

**Links:** [design](superpowers/specs/2026-06-17-org-os-website-design.md)

### org-os-kms — Knowledge Management System

**What it is.** A compiled, indexed, linted knowledge commons across the federation.

**How it works.** The toolkit-framework bound into org-os as a swappable module, with a
connector layer for external sources.

**Status.** `in-dev`.

**Links:** [connector layer design](superpowers/specs/2026-07-19-org-os-kms-connector-layer-design.md)

### org-os-hermes — Hermes Agent

**What it is.** A local agent runtime with a Telegram gateway — the chat surface of an
instance.

**How it works.** Hosts the org-os workspace for a persistent agent and bridges it to
messaging, replacing the OpenClaw host integration.

**Status.** `in-dev`.

**Links:** [host integration](HOST-INTEGRATION.md) · [chat interface](CHAT-INTERFACE.md)

### org-os-admin — Admin App

**What it is.** The framework's first read-**write** web surface: editing an instance's
registries through schema-driven forms.

**How it works.** A Hono API plus a Vite/React SPA writing comment-preserving YAML, committing
every change to git, with layered proposals for anything beyond plain registry edits.

**Status.** `in-dev` — M1 built, PR open.

**Links:** [design](superpowers/specs/2026-07-23-admin-app-design.md)

---

## Planned

Specified, not yet built. Boundaries are settled so later migration doesn't relitigate them —
see the v5 spec's §6 backlog.

| Module | What it will consolidate |
|---|---|
| **org-os-agent-core** | Identity/memory templates, `org-os-init`, `initialize.mjs`, session commands |
| **org-os-bootstrap** | The interview, `setup-org-os.mjs`, the SETUP/BOOTSTRAP docs |
| **org-os-ideas** | `idea-scout`, `data/ideas.yaml`, the hatching pipeline |
| **org-os-research** | The research skill, autoresearch loops, `data/knowledge-gaps.yaml` |
| **org-os-treasury** | `capital-flow`, `data/finances.yaml`, `data/assets.yaml` |
| **org-os-crm** | Members, relationships, channels, governance registries |
| **org-os-members-hub** | Membership, roles, and contribution surfaces |
| **org-os-comms** | Telegram and channel connectivity |
| **org-os-koi** | KOI-net bridges and the OPAL integration |
| **org-os-egregore** | `packages/egregore-core` |
| **org-os-web3** | Safe, Hats, and Gardens integrations |

---

## Not modules

Deliberate exclusions, so the boundary stays legible:

- **`workspace-improver`, `schema-generator`** — framework-maintenance tooling, absorbed into
  `org-os-standards`.
- **`packages/dashboard`, `webapps`, `agents-app`, `regen-agents`** — apps that *consume*
  modules. They stay npm workspaces.
- **`site/`** — a deployment, not a capability.
```

- [ ] **Step 2:** Add a deprecation banner to `docs/PACKAGES.md`. Insert immediately after the file's first heading line:

```markdown
> **Deprecated.** The conceptual package registry below is superseded by
> [`docs/MODULES.md`](MODULES.md) — the v0.5 module catalog — and by the module system design in
> [`2026-08-02-org-os-v5-modularization-design.md`](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md).
> Kept for reference until the v5 tranche has manifests. For the *lifecycle* of npm packages
> (which is a different thing from modules), see [`PACKAGE-LIFECYCLE.md`](PACKAGE-LIFECYCLE.md).
```

- [ ] **Step 3:** Verify the links resolve — every relative path in MODULES.md must exist. Paths are written relative to `docs/`, so they are checked from there (`docs/../modules/...` resolves correctly):

```bash
grep -o ']([^)]*)' docs/MODULES.md | sed 's/^](//;s/)$//' | grep -v '^https\?://' | while read -r p; do
  [ -e "docs/${p%%#*}" ] || echo "BROKEN: $p"
done
```

Expected: no output.

- [ ] **Step 4:** Commit:

```bash
git add docs/MODULES.md docs/PACKAGES.md
git commit -m "docs(modules): v0.5 module catalog; deprecate PACKAGES.md"
```

---

## Task 4: README spine — template + curated doc list

**Files:**
- Modify: `scripts/render-templates.mjs`
- Modify: `templates/README.framework.md`
- Generated: `README.md`

- [ ] **Step 1:** In `scripts/render-templates.mjs`, change the import on line 17 from:

```js
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
```

to:

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
```

- [ ] **Step 2:** Replace the `const docs = readdirSync(...)` block (the `docs` derivation, ~lines 36-45) with the curated spine:

```js
// Curated documentation spine — editorial order and real blurbs, deliberately not
// `readdirSync().sort().slice(0, 12)`. The old alphabetical slice produced entries with
// empty blurbs ("— " and nothing after it) and silently truncated anything past the
// twelfth filename, which is why docs/MODULES.md could never appear. Mirrors the site's
// curated set in site/src/data/docs-allowlist.ts; keep the two in step.
const DOC_SPINE = [
  { file: "ARCHITECTURE.md", title: "Architecture", blurb: "How an instance is put together" },
  { file: "MODULES.md", title: "Modules", blurb: "The v0.5 catalog — what ships, what's planned" },
  { file: "FEDERATION.md", title: "Federation", blurb: "Peers, trust levels, lineage, drift" },
  { file: "DATA-MODEL.md", title: "Data Model", blurb: "The registries and their cross-references" },
  { file: "EIP4824-GUIDE.md", title: "EIP-4824 Guide", blurb: "Machine-readable org schemas, generated from your data" },
  { file: "AGENTIC-ARCHITECTURE.md", title: "Agentic Architecture", blurb: "How agents read, act on, and improve the workspace" },
  { file: "OPERATOR-GUIDE.md", title: "Operator Guide", blurb: "Running a downstream instance day to day" },
  { file: "COMMANDS.md", title: "Commands", blurb: "Session lifecycle and the slash-command set" },
  { file: "FILE-STRUCTURE.md", title: "File Structure", blurb: "Canonical paths, and what validate:structure enforces" },
  { file: "SKILL-PROMOTION.md", title: "Skill Promotion", blurb: "How instance-proven patterns become canonical" },
  { file: "RAD-ORG-OS.md", title: "rad-org-os", blurb: "The sovereign distribution — org-os on Radicle" },
  { file: "VAULT-SAFETY.md", title: "Vault Safety", blurb: "Snapshots, audits, and the destructive-op bans" },
];

const missingDocs = DOC_SPINE.filter((d) => !existsSync(path.join(rootDir, "docs", d.file)));
if (missingDocs.length) {
  console.error(
    `render-templates: DOC_SPINE names docs that don't exist: ${missingDocs.map((d) => d.file).join(", ")}`,
  );
  process.exit(1);
}

const docs = DOC_SPINE.map((d) => ({ title: d.title, path: `docs/${d.file}`, blurb: d.blurb }));
```

- [ ] **Step 3:** Verify the render fails loudly on a missing doc (proving the guard works) — temporarily point an entry at a nonexistent file:

```bash
sed -i '' 's|file: "VAULT-SAFETY.md"|file: "NOPE.md"|' scripts/render-templates.mjs
node scripts/render-templates.mjs --dry >/dev/null; echo "exit=$?"
sed -i '' 's|file: "NOPE.md"|file: "VAULT-SAFETY.md"|' scripts/render-templates.mjs
```

Expected: the error line naming `NOPE.md`, then `exit=1`.

- [ ] **Step 4:** Replace `templates/README.framework.md` in full:

```markdown
# {{ org.name }}{{#if org.tagline }} — {{ org.tagline }}{{/if}}

> {{ org.short_description }}

**Type:** Framework + orchestration hub · **Version:** {{ org.version }} · **Status:** {{ org.status }}

---

## What org-os is

org-os is the operating system for organizations run by humans and AI agents together — a
git-native workspace where an org's knowledge, data, and operations live as files any agent can
read, act on, and federate.

Fork a repo, answer six questions, and your organization has a brain: identity and values
agents actually follow, structured data registries, session memory, {{ counts.skills }}
operational skills, machine-readable schemas, and a federation protocol connecting you to a
network of peer orgs. No SaaS, no lock-in — markdown, YAML, and git.

## How it's organized

Three nouns. Everything else is detail.

| | What it is | Where it lives |
|---|---|---|
| **Instances** | A git repo *is* the organization — identity files, data registries, memory, decisions. The framework is itself an instance, self-hosting since {{ org.bootstrap_date }} | `data/` · `memory/` · this repo |
| **Modules** | Versioned units of organizational capability — a skill, a script, a schema, an integration — tracked per instance with install and drift state | [`docs/MODULES.md`](docs/MODULES.md) · `modules/` |
| **Federation** | Instances declare peers, trust levels, and upstream lineage, and publish machine-readable schemas the others can read | `federation.yaml` · `.well-known/` |

Cutting across all three: **the agent runtime**. The same files work in Claude Code, Cursor,
OpenCode, and OpenClaw, because org-os rides the AGENTS.md and Agent Skills conventions instead
of inventing its own.

## What you can do

- **Run a session.** `/initialize` renders a dashboard from live data — projects, tasks,
  calendar, funding deadlines, federation status. `/close` writes memory and commits.
- **Keep organizational memory.** Daily logs, an indexed long-term memory, and an append-only
  decision record. Greppable, versioned, agent-readable.
- **Publish machine-readable org data.** EIP-4824/DAOstar `.well-known/` descriptors generated
  from your registries — extended with meetings, projects, finances, and skills.
- **Federate.** Publish schemas, subscribe to peers, share skills, keep sovereignty. Drift
  analysis and pull-based migrations mean the framework never breaks downstream.
- **Work from a browser or a chat.** The Cloudflare OS module puts the dashboard and an
  org-literate agent in a workspace, so members who will never touch git can still read the org
  and submit to it.

## Run it yourself

### You're an **operator** spinning up a new org

```bash
# Recommended: the cloning engine
node scripts/clone-framework.mjs --target ../my-new-org --config config.yaml

# Or: interactive guided interview
npm run setup
```

See `BOOTSTRAP.md` for the full first-run sequence, and `docs/SETUP-PATHS.md` for choosing
between them.

### You're a **contributor** to the framework

```bash
git clone <this-repo> && cd <repo>
npm install
npm run install:hooks    # pre-commit + advisory hooks
npm run selftest         # full reliability check
```

### You're an **agent** opening a session

Read `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, then run `/initialize`. `AGENTS.md` has the
deterministic startup sequence.

### You're a **visitor** evaluating org-os

Start with `SOUL.md` (mission and values), `IDENTITY.md` (what we are), then
[`docs/MODULES.md`](docs/MODULES.md) for what actually ships today.

---

## Active downstream instances

{{#if federation.downstream}}
{{#each federation.downstream}}
- **{{ name }}** ({{ type }}) — {{ status }}
{{/each}}
{{/if}}

See `data/instances.yaml` for the authoritative registry; `npm run analyze:instances` for
current drift state.

## Common operations

{{> cheatsheet }}

- **Skills:** {{ counts.skills }} total — see `SKILLS.md` and `data/skills-matrix.yaml`
- **Packages:** {{ counts.packages }} total — see `data/packages-matrix.yaml` + `docs/PACKAGE-LIFECYCLE.md`
- **Modules:** see [`docs/MODULES.md`](docs/MODULES.md) and `modules/`

## Documentation

{{#each docs}}
- [{{ title }}]({{ path }}) — {{ blurb }}
{{/each}}

## Requirements

- Node ≥22
- npm ≥10.9.2
- git

## License

MIT
```

- [ ] **Step 5:** Render and inspect:

```bash
npm run render:templates
head -40 README.md
grep -c "^- \[" README.md
```

Expected: `✓ wrote README.md`; the "What org-os is" section at the top; and the documentation list showing 12 entries **each with a blurb after the dash** (no bare `— ` endings). Confirm with:

```bash
grep -n "— *$" README.md || echo "no empty blurbs"
```

Expected: `no empty blurbs`.

- [ ] **Step 6:** Confirm MODULES.md now appears in the README:

```bash
grep -n "docs/MODULES.md" README.md
```

Expected: at least two hits (the "How it's organized" table and the documentation list).

- [ ] **Step 7:** Commit:

```bash
git add templates/README.framework.md scripts/render-templates.mjs README.md
git commit -m "docs(readme): four-layer self-description + curated doc spine"
```

---

## Task 5: Site — landing copy from POSITIONING

**Files:**
- Modify: `site/src/data/landing.yaml`

- [ ] **Step 1:** Replace `site/src/data/landing.yaml` in full:

```yaml
# Hero copy. Canon: docs/POSITIONING.md §1 (Definition). Edit there first, mirror here.
eyebrow: "Framework · standards · federation"
title: "The operating system for organizations run by humans and AI agents together"
subtitle: "A git-native workspace where your org's knowledge, data, and operations live as files any agent can read, act on, and federate. No SaaS, no lock-in — markdown, YAML, and git."
ctas:
  - { label: "$ npm run setup", href: "/get-started", variant: "solid" }
  - { label: "/modules", href: "/modules", variant: "ghost" }
  - { label: "/federation", href: "/federation", variant: "ghost" }
```

- [ ] **Step 2:** Verify the site still builds:

```bash
cd site && npm run build
```

Expected: build succeeds; `verify-build.mjs` prints `OK:` for every required path and exits 0.

- [ ] **Step 3:** Confirm the new hero is in the output:

```bash
grep -o "operating system for organizations run by humans" site/dist/index.html | head -1
```

Expected: one match.

- [ ] **Step 4:** Commit:

```bash
git add site/src/data/landing.yaml
git commit -m "feat(site): hero copy from POSITIONING four-layer thesis"
```

---

## Task 6: Site — module catalog mirror, `pilot` status, drift test

**Files:**
- Create: `site/test/modules-catalog.test.mjs`
- Modify: `site/src/data/modules.yaml`
- Modify: `site/src/components/StatusBadge.astro`
- Modify: `site/src/components/ModuleCard.astro`
- Modify: `site/src/pages/modules.astro`
- Modify: `site/src/data/docs-allowlist.ts`
- Modify: `site/scripts/verify-build.mjs`

- [ ] **Step 1:** Write the failing test `site/test/modules-catalog.test.mjs`:

```js
// site/test/modules-catalog.test.mjs
//
// Enforces the canonical chain declared at the top of docs/MODULES.md:
// MODULES.md is canon, site/src/data/modules.yaml mirrors it. Without this the
// "canonical" claim is a comment nobody checks, and the two lists drift the way
// modules.yaml and the v5 spec already had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATUSES = ["planned", "in-dev", "pilot", "live"];

const catalog = readFileSync(join(siteRoot, "..", "docs", "MODULES.md"), "utf8");
const modules = yaml.load(readFileSync(join(siteRoot, "src", "data", "modules.yaml"), "utf8")).modules;

// Entry headings are "### <id> — <Name>"; the em-dash separator is load-bearing.
const catalogIds = new Set([...catalog.matchAll(/^### ([a-z0-9-]+) — /gm)].map((m) => m[1]));

test("MODULES.md declares at least the tracked module", () => {
  assert.ok(catalogIds.has("org-os-cloudflare-os"), "catalog is missing org-os-cloudflare-os");
});

test("every module on the site appears in the MODULES.md catalog", () => {
  for (const m of modules) {
    assert.ok(catalogIds.has(m.id), `modules.yaml has "${m.id}", MODULES.md does not`);
  }
});

test("every site module uses the shared status vocabulary", () => {
  for (const m of modules) {
    assert.ok(STATUSES.includes(m.status), `"${m.id}" has unknown status "${m.status}"`);
  }
});

test("site module ids are unique", () => {
  const ids = modules.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate module id in modules.yaml");
});
```

- [ ] **Step 2:** Run it and watch it fail:

```bash
cd site && node --test test/modules-catalog.test.mjs
```

Expected: FAIL — the second test reports ids present in `modules.yaml` but absent from the catalog (`org-os-website-generator`, `org-os-members-hub`, `org-os-ideation`), because the current file uses different ids than MODULES.md.

- [ ] **Step 3:** Replace `site/src/data/modules.yaml` in full:

```yaml
# Mirror of docs/MODULES.md — that file is canon; this one feeds /modules.
# site/test/modules-catalog.test.mjs fails if an id here is missing from the catalog.
# status: planned | in-dev | pilot | live
modules:
  - id: org-os-cloudflare-os
    name: Cloudflare OS Integration
    status: pilot
    summary: Org data, pages, and an org-literate agent in a browser workspace — for the people who will never touch git.
    link: /docs/modules
  - id: org-os-federation
    name: Federation
    status: live
    summary: Peers, trust levels, lineage and drift across a network of sovereign instances.
    link: /docs/federation
  - id: rad-org-os
    name: rad-org-os
    status: in-dev
    summary: The sovereign distribution — org-os on Radicle, peer-to-peer. And the missing org layer for Radicle.
    link: /modules/rad-org-os
  - id: org-os-standards
    name: Standards & Module Engine
    status: in-dev
    summary: EIP-4824 schemas, structure validation, and the module system everything else is tracked by.
    link: /docs/modules
  - id: org-os-website-generator
    name: Website Generator
    status: in-dev
    summary: Turn any instance's data + docs into a federated site. This very site is its first reference output.
    link: /docs/architecture
  - id: org-os-kms
    name: Knowledge Management System
    status: in-dev
    summary: Compiled, indexed, linted knowledge commons across the federation.
    link: /docs/modules
  - id: org-os-admin
    name: Admin App
    status: in-dev
    summary: Schema-driven forms over an instance's registries, committing every edit to git.
    link: /docs/modules
  - id: org-os-hermes
    name: Hermes Agent
    status: in-dev
    summary: Local agent runtime + Telegram gateway, replacing OpenClaw.
    link: /docs/modules
  - id: org-os-members-hub
    name: Members Hub
    status: planned
    summary: Membership, roles, and contribution surfaces for instances.
    link: null
  - id: org-os-ideas
    name: Ideation System
    status: planned
    summary: Idea capture → triage → hatching pipeline, federated.
    link: null
```

- [ ] **Step 4:** Add `pilot` to `site/src/components/StatusBadge.astro` — replace its first four lines (the frontmatter) with:

```astro
---
interface Props { status: "planned" | "in-dev" | "pilot" | "live"; }
const { status } = Astro.props;
const label = { planned: "Planned", "in-dev": "In dev", pilot: "Pilot", live: "Live" }[status];
---
```

and add this rule to its `<style>` block, immediately after the `.badge.in-dev .pip` rule:

```css
.badge.pilot { color: var(--color-accent); border-color: var(--color-accent); border-style: dashed; }
```

`pilot` reads as "in-dev, but proven" — same accent, dashed border marks the not-yet-production state.

- [ ] **Step 5:** In `site/src/components/ModuleCard.astro`, widen the Props union (line 3):

```astro
interface Props { id: string; name: string; status: "planned" | "in-dev" | "pilot" | "live"; summary: string; link: string | null; }
```

and extend the accent-rail rule so pilot cards get the accent too:

```css
.card.live::after, .card.in-dev::after, .card.pilot::after { background: var(--color-accent); }
```

- [ ] **Step 6:** In `site/src/pages/modules.astro`, widen the interface (line 7):

```astro
interface Module { id: string; name: string; status: "planned" | "in-dev" | "pilot" | "live"; summary: string; link: string | null; }
```

- [ ] **Step 7:** Surface MODULES.md on the site — add this entry to `DOCS_ALLOWLIST` in `site/src/data/docs-allowlist.ts`, immediately after the `ARCHITECTURE` line:

```ts
  { file: "MODULES",              slug: "modules",               title: "Modules",                 group: "Concepts" },
```

**Check for a route collision first:** the site already has a `/modules` page (`src/pages/modules.astro`). This doc lands at `/docs/modules`, a different path — confirm with Step 9's build output.

- [ ] **Step 8:** Require the new page in `site/scripts/verify-build.mjs` — add to the `REQUIRED` array, after `"docs/architecture/index.html",`:

```js
  "docs/modules/index.html",
```

- [ ] **Step 9:** Run the test, then the build:

```bash
cd site && node --test test/modules-catalog.test.mjs && npm run build
```

Expected: 4 tests pass; build succeeds; `OK:      dist/docs/modules/index.html` in the verify output; `/modules/index.html` still present and distinct.

- [ ] **Step 10:** Run the whole site suite so nothing else regressed:

```bash
cd site && npm test
```

Expected: all green.

- [ ] **Step 11:** Commit:

```bash
git add site/src/data/modules.yaml site/src/data/docs-allowlist.ts site/src/components/StatusBadge.astro \
        site/src/components/ModuleCard.astro site/src/pages/modules.astro site/scripts/verify-build.mjs \
        site/test/modules-catalog.test.mjs
git commit -m "feat(site): module catalog mirrors MODULES.md, pilot status, drift test"
```

---

## Task 7: The substrate seam in `docs/RAD-ORG-OS.md`

**Files:**
- Modify: `docs/RAD-ORG-OS.md`

- [ ] **Step 1:** Read the doc's "Next" section to find the substrate-driver task this section feeds:

```bash
grep -n "^## \|substrate\|driver" docs/RAD-ORG-OS.md | head -20
```

- [ ] **Step 2:** Insert this section immediately **before** the doc's "Next" section (or append at the end if there is none):

```markdown
## The substrate seam (shipped 2026-08)

The driver interface rad-org-os needs is no longer hypothetical. The Cloudflare OS module
([`docs/MODULES.md`](MODULES.md)) shipped it, tested, as the way its capabilities reach an
org's repository — because the same problem appears whenever org-os runs somewhere that isn't
a local filesystem.

**The contract** (`packages/cloudflare-os-integration/src/substrate/`), all methods async:

| Method | Returns | Notes |
|---|---|---|
| `readFile(path)` | file contents as a string | throws `SubstrateError("NOT_FOUND")` when absent |
| `listDir(path)` | `[{ name, type: "file" \| "dir" }]` | direct children only |
| `head()` | `{ sha, date }` | the provenance stamp every capability response carries |
| `proposeChange({ files, message, branch })` | a change reference | M3; PR-only by design — never a direct commit |

Errors are a closed set: `SubstrateError` with `code` of `NOT_FOUND` or `UPSTREAM`. Callers
never see transport detail, which is what lets a capability be written once and run against any
driver.

**Two implementations exist today.** `MemorySubstrate` (a `{path: contents}` map, used by the
test suite) and `GitHubSubstrate` (the GitHub REST API with ETag revalidation, a TTL, and
stale-while-revalidate: a rate-limited refresh serves the last known-good content and flags
`lastReadStale` rather than failing the read). Capabilities never touch GitHub directly.

**What this means for rad-org-os.** A Radicle driver is an implementation of these four
methods over `radicle-httpd`'s read API and the `rad` CLI — not a new capability layer.
Everything already built on top (registry reads, federation reads, page rendering, the context
bundle, and M3's write path) works unchanged the moment the driver exists.

**What it deliberately does not cover.** `clone`, `sync`, `push`, and `publish-schema` are
*instance-lifecycle* operations — they act on a whole repository, not on paths within one — and
they are out of the read/write substrate on purpose. The open task "plan the substrate driver
interface" is therefore narrower than it was: it starts from this shipped contract and designs
the lifecycle layer above it, rather than designing both at once from a blank page.
```

- [ ] **Step 3:** Commit:

```bash
git add docs/RAD-ORG-OS.md
git commit -m "docs(rad-org-os): declare the shipped substrate interface as the driver seam"
```

---

## Task 8: The deployment runbook

**Files:**
- Modify: `docs/integrations/cloudflare-os.md`

- [ ] **Step 1:** Replace the `## M1 acceptance evidence` line and the `_(filled by Task 14 — requires the deployed workspace)_` line beneath it with the runbook section below, keeping the `## Adapter wiring runbook` section that follows it intact:

```markdown
## Deployment runbook (operator checklist)

Everything here needs a Cloudflare account and is deliberately outside every implementation
plan — the in-repo work is done and verified against a **local** Cloudflare OS stack. Work
top to bottom; each step's verification gates the next.

- [ ] **1. Deploy the starter.** Fork `https://github.com/cloudflare/cloudflare-os-starter`,
      deploy it into the pilot Cloudflare account (its README, or `https://os.cloudflare.app/deploy`).
      **Verify:** the workspace URL loads, a document can be created, the agent chat responds.
      **Record** the deployed URL and starter fork URL in this file's header.

- [ ] **2. Install `gatekeeper-org-os`.** Follow "Install" in
      [`../../packages/cloudflare-os-integration/src/adapter/README.md`](../../packages/cloudflare-os-integration/src/adapter/README.md):
      copy the adapter into the workspace, run `sync-core.mjs` + `sync-types.mjs`, generate
      Worker types, apply the `mainModule` fix, `pnpm run types:check`.
      **Verify:** `types:check` silent; `GATEKEEPER_ORG_OS` appears in the binding list.

- [ ] **3. Configure instances and the token.** Set `ORG_OS_INSTANCES` in `wrangler.jsonc`
      (hub + `refi-bcn-os`) and put a fine-grained PAT — **`contents: read` only**, scoped to
      `refibcn` — in the `ORG_OS_GITHUB_TOKEN` secret. Do **not** grant `pull-requests:write`;
      nothing before M3 opens a PR.
      **Check the hub `ref`:** it is pinned to the work branch because the integration is not on
      `main`. Update it when the branch merges, or the gatekeeper reads a stale tree.

- [ ] **4. Configure the model.** Ollama provider slot (the OpenAI-compatible one), API URL
      `https://opencode.ai/zen/go/v1`, the workspace's Go API key. The `openai` slot does not
      work — it speaks the Responses API. **Verify:** the model list populates, and a trivial
      chat completes (a `CreditsError` here means billing, not configuration).

- [ ] **5. M1 acceptance — org chat with real context.** In the deployed workspace chat, ask and
      verify each answer against the repos:
      1. "What are the active projects in org-os?" → matches `data/projects.yaml`
      2. "What were the last three decisions?" → matches `DECISIONS.md`
      3. "What's in refi-bcn-os's federation — who are its peers?" → matches its `federation.yaml`
      4. "What tasks are urgent right now?" → consistent with `HEARTBEAT.md` due dates.
         (This one requires mid-conversation capability invocation, which §D3 confirms the
         platform does — the context bundle alone does not carry `HEARTBEAT.md`.)

      Then ask "which commit is this from?" — the agent should report the provenance sha.
      **Record** the four Q/A pairs and their shas under "M1 acceptance evidence" below.

- [ ] **6. Install the org-dashboard gadget.** Create a gadget in the workspace, paste
      `packages/cloudflare-os-integration/blueprints/org-dashboard/gadget.html` as its source,
      and write `rpc.mjs` — a ~3-line shim adapting the injected binding to
      `callCapability(name, args)` (§D4).
      **Verify:** the dashboard renders for the hub; the instance switcher re-renders for
      `refi-bcn-os`; all 7 pages load; the provenance footer shows a real sha; and revoking the
      token (or going offline past the cache TTL) shows the **STALE** badge rather than an error.

- [ ] **7. Export the blueprint.** Export the gadget to a `.gadget` archive and commit it next to
      the HTML (§D6 — the HTML stays the human-editable source; the archive is the
      distributable). **Verify:** importing the archive into a second workspace reproduces the
      gadget.

- [ ] **8. Flip the status.** Update `docs/MODULES.md` — `org-os-cloudflare-os` status `pilot` →
      `live` — and `site/src/data/modules.yaml` to match. Run `cd site && npm test` to confirm
      the catalog test still passes, and note the deployment in `DECISIONS.md`.

## M1 acceptance evidence

_(filled by runbook step 5 — requires the deployed workspace)_
```

- [ ] **Step 2:** Verify the two relative links resolve from `docs/integrations/`:

```bash
ls docs/integrations/../../packages/cloudflare-os-integration/src/adapter/README.md
```

Expected: the path prints (no error).

- [ ] **Step 3:** Commit:

```bash
git add docs/integrations/cloudflare-os.md
git commit -m "docs(cloudflare-os): operator deployment runbook"
```

---

## Task 9: Process wiring and full verification

**Files:**
- Modify: `DECISIONS.md`, `HEARTBEAT.md`
- Create: `memory/2026-08-10.md`

- [ ] **Step 1:** Prepend a decision entry to `DECISIONS.md`, immediately after the `---` that follows the Conventions section (newest-first ordering), matching the existing entry format:

```markdown
## 2026-08-10 · Cloudflare OS is org-os's first tracked module; the framework describes itself

**Status:** active
**Scope:** framework, operator-ux, public-surfaces

**Decision** — Frame the Cloudflare OS integration as **`org-os-cloudflare-os`**, a
`type: integration` module declared by `modules/org-os-cloudflare-os/module.yaml` and validated
by the module engine's existing `validateManifest()` — **manifest-first**, ahead of the engine's
`add`/`adopt` commands, with no files moved. Because the module's content already sits at
canonical paths, `files` uses an **identity mapping** (`X: X`) meaning "owns these paths in
place" — an extension of the v5 format, and the first concrete feedback for Phase 1's `adopt`.
Alongside it, give org-os a **layered self-description** modeled on how Cloudflare OS explains
itself: a README spine (what it is → how it's organized, as three nouns: instances, modules,
federation → what you can do → run it yourself) generated from `templates/README.framework.md`,
and a hand-authored `docs/MODULES.md` catalog that deprecates `docs/PACKAGES.md`. One canonical
chain is enforced rather than asserted: `POSITIONING.md` → README + `landing.yaml`, and
`MODULES.md` → `site/src/data/modules.yaml`, the latter guarded by
`site/test/modules-catalog.test.mjs`. The shipped `Substrate` interface is declared in
`docs/RAD-ORG-OS.md` as the driver seam rad-org-os builds to.

**Why** — Three lists of modules existed (the v5 spec, the site, PACKAGES.md) and none was
canonical; the README opened on setup mechanics rather than identity; and "module" was a word
in a spec rather than a tracked thing. Manifest-first makes the claim true at the cost of one
file, and pressure-tests the manifest format against a real integration before six more modules
are written against it. Engine-first was rejected as blocking the docs on a separate execution
effort; docs-only was rejected because an untracked "module" is marketing. Deployment stays an
operator runbook: the in-repo work is verified against a local Cloudflare OS stack, and nothing
in the plan depends on a Cloudflare account.

**Refs** — spec `docs/superpowers/specs/2026-08-10-cloudflare-os-module-v05-docs-design.md` ·
plan `docs/superpowers/plans/2026-08-10-cloudflare-os-module-v05-docs.md` ·
`modules/org-os-cloudflare-os/module.yaml` · `docs/MODULES.md` ·
v5 design `docs/superpowers/specs/2026-08-02-org-os-v5-modularization-design.md` ·
integration design `docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md`
```

- [ ] **Step 2:** Update `HEARTBEAT.md` — mark the site-wiring task done and add the follow-ups this plan creates. Find the `org-os-website` line:

```bash
grep -n "org-os-website: wire\|Hygiene: \`.gitignore\`" HEARTBEAT.md
```

Replace the `org-os-website: wire ...` task line with:

```markdown
- [x] ~~org-os-website: wire `docs/POSITIONING.md` into `site/src/data/landing.yaml` + `modules.yaml`~~ — done 2026-08-10; `landing.yaml` carries the four-layer hero, `modules.yaml` mirrors `docs/MODULES.md` under a drift test
```

and add these new tasks immediately after it:

```markdown
- [ ] v5 module engine: implement `loadRegistry`/`add`/`adopt` + the `npm run module` script (`scripts/modules.mjs` is a 70-line validate-only scaffold). `adopt` must treat an identity mapping (`X: X`) as "already installed — checksum in place", per `modules/org-os-cloudflare-os/module.yaml`
- [ ] Give the v5 core tranche manifests (`org-os-standards` first — `org-os-cloudflare-os` already declares a dependency on it), then regenerate `docs/MODULES.md` from the registry instead of maintaining it by hand
- [ ] Execute the Cloudflare OS deployment runbook (`docs/integrations/cloudflare-os.md`) when a Cloudflare account is available; flip `org-os-cloudflare-os` `pilot` → `live` in `docs/MODULES.md` + `site/src/data/modules.yaml` on success
```

- [ ] **Step 3:** Write `memory/2026-08-10.md` (create; never overwrite if it exists — append instead):

```markdown
# 2026-08-10

## Session — Cloudflare OS as a module + v0.5 self-description

**Focus:** Turning the built-and-locally-verified Cloudflare OS integration into org-os's first
tracked module, and giving the framework a self-description modeled on how Cloudflare OS
explains itself at os.cloudflare.app.

### Key decisions

- **Manifest-first**, not engine-first: `modules/org-os-cloudflare-os/module.yaml` ships ahead
  of the engine's `add`/`adopt`, validated by the `validateManifest()` that already exists.
- **Identity mapping** (`X: X`) in `files` for in-place modules — an extension of the v5 format,
  documented in `modules/README.md` and fed back to Phase 1 as an `adopt` requirement.
- **One canonical chain, enforced:** `MODULES.md` → `site/src/data/modules.yaml` is guarded by a
  test, not a comment. `POSITIONING.md` → README + `landing.yaml` is guarded by convention plus
  the render step.
- Deployment stays **operator work**, written as a runbook rather than folded into a plan.

### Discoveries that changed the plan

- `scripts/modules.mjs` + `schemas/module.schema.json` already exist (v5 Phase 1, partial) —
  so the manifest is validated by real tooling instead of being declarative-only.
- `README.md` is **generated** from `templates/README.framework.md`; editing it directly would
  be reverted on the next render.
- The README's doc list was `readdirSync().sort().slice(0, 12)` with empty blurbs — the cause of
  the trailing `— ` entries, and the reason `MODULES.md` could never have appeared there.
  Replaced with a curated `DOC_SPINE` that fails the render if it names a missing doc.
- Three competing module lists existed (v5 spec, site `modules.yaml`, `PACKAGES.md`). Reconciled
  into `docs/MODULES.md`; `PACKAGES.md` deprecated.

### Follow-ups

- v5 Phase 1 remainder: registry loading, `add`, `adopt`, `npm run module`.
- Manifests for the core tranche, then generate `MODULES.md` from the registry.
- M3–M4 plan: `docs/superpowers/plans/2026-08-10-cloudflare-os-m3-m4.md`.
- Deployment runbook execution when a Cloudflare account is available.
```

- [ ] **Step 4:** Full verification sweep — every check this plan can affect:

```bash
npm test
npm run test:cloudflare-os-integration
npm run validate:structure
npm run validate:schemas
npm run render:templates
cd site && npm test && npm run build
```

Expected: all green. `render:templates` must report `✓ wrote README.md`; if `git status` then shows `README.md` modified, the template and the committed render had drifted — commit the regenerated file.

- [ ] **Step 5:** Confirm `validate:structure` is unbothered by the new top-level `modules/` directory:

```bash
npm run validate:structure | grep -i "modules\|failed"
```

Expected: `Results: N passed, 0 failed` and no complaint naming `modules/`. (Section 2 checks for *required* directories and does not reject extra ones — this step confirms that empirically rather than assuming it.)

- [ ] **Step 6:** Commit:

```bash
git add DECISIONS.md HEARTBEAT.md memory/2026-08-10.md README.md
git commit -m "chore(modules): decision log, heartbeat follow-ups, session memory"
```

---

## Self-review (done at plan time)

**Spec coverage.** §1 module → Tasks 1–2 · §2.1 README spine → Task 4 · §2.2 MODULES.md
catalog → Task 3 · §3 site wiring (landing, modules.yaml, status vocab, docs allowlist) →
Tasks 5–6 · §4 substrate seam → Task 7 · §5 deployment runbook → Task 8 · §6 verification →
Tasks 6/9 · §7 out-of-scope respected (no engine work, no Pages deploy, no M3–M4 code, no
per-module pages). Task 0 reconciles the three spec/repo mismatches found after approval.

**Placeholder scan.** No TBDs. Every code block is complete and paste-ready; every command has
an expected result. The one intentionally-unfilled section is "M1 acceptance evidence", which
is a runbook output requiring a deployed workspace — labelled as such, not a TODO.

**Type consistency.** Status vocabulary `planned|in-dev|pilot|live` is identical across
MODULES.md (§ status line), `modules.yaml`, `StatusBadge.astro`, `ModuleCard.astro`,
`modules.astro`, and the test's `STATUSES`. Manifest fields are exactly the nine
`KNOWN_FIELDS` the engine accepts (`additionalProperties: false` would reject any other).
The catalog heading regex `^### ([a-z0-9-]+) — ` matches the heading format used by every
entry in Task 3, and every `modules.yaml` id in Task 6 appears as such a heading.

**Ordering risk.** Task 6's test reads `docs/MODULES.md`, so Task 3 must land first; Task 2's
test requires Task 1's directory to exist. Tasks 4–8 are otherwise independent.
