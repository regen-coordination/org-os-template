---
id: org-os-website
title: "org-os v0.5 — Framework Website + Docs Site (Design)"
status: design-approved
type: feature-spec
created: 2026-06-17
last_updated: 2026-06-17
brainstorming_session: 2026-06-17
operator: luizfernandosg
location: org-os/site/
workstream: public-surfaces
---

# org-os v0.5 — Framework Website + Docs Site

> **Theme:** The public face of org-os — one Astro site that *presents* the framework + its v0.5 module vision, *documents* it from a single source of truth, and *federates* with the live instances. Built in the org-os monorepo, borrowing refibcn-site's theme/data architecture, structured so its reusable core becomes the future `org-os-website-generator`.

This is **sub-project #1** of the wider org-os v0.5 effort. The other v0.5 modules (`org-os-kms`, `rad-org-os`, `org-os-hermes`, `org-os-website-generator`, `org-os-members-hub`, ideation system, …) are **separate future sub-projects**; this site *presents* them as a roadmap but does not build them.

> **Note on "v0.5".** The org-os *framework* is internally at v3.x (see `CHANGELOG.md`). "v0.5" is the operator's milestone label for **the public website + the first articulation of the module constellation** — a product/vision namespace, not the framework's semver. The site displays the framework version (v3.x) for the framework itself; "v0.5" labels this public-surface milestone. (Final version-display copy is an open decision, §16.)

---

## 1. Scope

**In scope (this spec):**
- A static Astro 5 site at `org-os/site/` — marketing/vision + curated docs + live-at-build federation + a machine layer.
- A build-time federation aggregation script (the reusable seam).
- A light "systems" theme implemented in a token/theme-swap architecture.
- Curated on-site rendering of ~8–12 existing `org-os/docs/*.md` files.

**Out of scope (separate future sub-projects):**
- Building any actual v0.5 module (kms, hermes, members-hub, ideation, rad-org-os).
- The federation aggregator *service* (runtime API) — pattern "C" below; only the build-time seam is built now.
- Starlight migration (docs framework "A1") — architected toward, not done.
- Per-module detail pages; docs sidebar/search; regenerating refibcn-site from the generator; hosting/CI/domain provisioning.

---

## 2. Audiences (all five, layered)

The site serves five audiences in an intentional layering, not a compromise:

| Layer | Audience | Primary surface |
|---|---|---|
| Vision | Funders / evaluators / curious visitors | `/`, `/modules` |
| Ecosystem | ReFi/regen network, federation peers | `/`, `/federation` |
| Get-started | Operators / adopters | `/get-started` |
| Reference | Developers / contributors | `/docs` |
| Machine | AI agents | `/llms.txt`, `.well-known/`, `/federation.json` |

---

## 3. Architecture & location — org-os monorepo

The site lives **inside the org-os repo** because its two data sources (the docs and the federation registry) live here. Co-location = single source of truth, versions-with-framework, plans + code together, and the reusable core lands in the framework it belongs to.

```
org-os/
├── docs/                    ← 25+ markdown docs  (SINGLE SOURCE OF TRUTH for docs)
├── data/
│   ├── instances.yaml       ← federation registry
│   ├── packages-matrix.yaml ← maps to the v0.5 modules where applicable
│   └── skills-matrix.yaml
├── .well-known/             ← org-os's own EIP-4824 schemas
│
├── site/                    ← ✦ NEW — the Astro site (this project)
│   ├── astro.config.mjs     ← output: "static"
│   ├── package.json         ← dev/build/preview/astro scripts
│   ├── scripts/
│   │   ├── aggregate-federation.mjs   ← build-time: reads ../data + sibling instances
│   │   └── verify-build.mjs           ← post-build route/asset check
│   └── src/
│       ├── styles/          ← tokens.css + theme.css + themes/systems.css (+ dark later)
│       ├── components/      ← shell + federation graph + cards (adapted from refibcn-site patterns)
│       ├── content/         ← docs content collection (glob loader → ../docs, from project root)
│       ├── data/
│       │   ├── landing.yaml ← org-os's OWN marketing copy (instance content)
│       │   └── modules.yaml ← v0.5 module roadmap cards
│       └── pages/           ← /, /modules, /federation, /docs/[...slug], /get-started, /about
│
└── (siblings, read at build for federation aggregation)
    ../refi-bcn-os/  ../refi-dao-os/  ../regen-coordination-os/  ../refi-med-os/
```

**Reusable-vs-instance split** (mirrors refibcn-site's theme/data split): `site/src/styles` + `components` + `scripts` = reusable generator core; `site/src/data/*.yaml` = org-os's own content a downstream fork would replace. This split *is* `org-os-website-generator` in embryo (§14).

---

## 4. Information architecture

```
/                     HOME — systems hero · what org-os is · federation-at-a-glance (mini graph)
                             · v0.5 module roadmap teaser · get-started CTA
├── /modules          ROADMAP — v0.5 modules as cards w/ status badges [planned|in-dev|live]
├── /federation       NETWORK — live-at-build graph + instance cards (instances.yaml + .well-known + data)
├── /docs             DOCS INDEX — curated set, grouped
│   └── /docs/[...slug]  rendered from ../docs/*.md via content collection
├── /get-started      OPERATORS — clone/bootstrap path, requirements, setup commands, links to BOOTSTRAP/OPERATOR-GUIDE
└── /about            WHAT/WHY/WHO — mission (SOUL), identity, license  (optional / foldable into /)

machine layer:  /llms.txt   ·   /.well-known/*  (EIP-4824, surfaced)   ·   /federation.json  (aggregated artifact)
```

`/modules` may alias `/roadmap`. `/about` is optional (foldable into `/`). Per-module detail pages, docs sidebar, and search are deferred to the Starlight (A1) step.

---

## 5. Theming — light systems (primary), generator seam

Borrows refibcn-site's **three-file system**:
- `tokens.css` — structural tokens (spacing, type scale, motion, radius). Theme-invariant.
- `theme.css` — a one-line `@import` switch selecting the active theme.
- `themes/systems.css` — **the primary theme**: a *light* "systems/infrastructure" aesthetic — warm paper base (~`#fbfbf9`), near-black ink, Geist Mono headings + eyebrows, hairline structural grid, terminal/console motifs, a regen-green accent (~`#1f883d`, swappable — §16).

`global.css` consumes only theme vars (no raw hex). A **dark variant** is a future second theme file — trivial under this architecture, and the proof that the theme-swap (hence the generator) works. Fonts via `@fontsource-variable/geist` + `geist-mono` (already proven in refibcn-site) + Inter for body.

---

## 6. Components — adapt, don't fork

Carry the *patterns* from refibcn-site (re-implement in the systems theme; do **not** import or depend on the refibcn-site repo):

| refibcn-site pattern | org-os site role |
|---|---|
| `Layout` / `Nav` / `Footer` / `Button` | shell |
| `NeuralWeb` + `NetworkSection` | **federation graph** (nodes = instances, edges = federation links) |
| `PillarBadge` | **status badge** (planned / in-dev / live) |
| `ProjectCard` / `ServiceCard` | **ModuleCard** (roadmap) and **InstanceCard** (federation) |
| `SectionBlock` / `Tile` | content blocks |
| `Hero` | systems hero |

---

## 7. Data flow — docs

A `docs` content collection defined via Astro 5's `glob()` loader pointing at `org-os/docs` — the `base` resolves relative to the Astro project root (`site/`), i.e. `base: "../docs"` (exact value to be verified against Astro's resolution semantics during implementation). **Curation = an explicit allowlist** (the ~8–12 files) so the long tail stays repo-only until widened. `/docs/[...slug]` renders the markdown in the systems theme. Single source of truth, zero copying.

**Initial curated set** (final list = open decision §16): `ARCHITECTURE`, `FEDERATION`, `DATA-MODEL`, `EIP4824-GUIDE`, `OPERATOR-GUIDE`, `PACKAGE-LIFECYCLE`, `AGENTIC-ARCHITECTURE`, `ECOSYSTEM`, plus root `AGENTS.md` + `BOOTSTRAP.md`.

---

## 8. Data flow — federation (build-time aggregation, pattern A)

`scripts/aggregate-federation.mjs` runs pre-build:
1. Read `../data/instances.yaml` (the registry — authoritative node list).
2. For each instance, read `../../<instance>/.well-known/*` + `data/*.yaml` (name, type, status, scope, links, counts).
3. Normalize → `src/data/federation.json`.

`/federation` + the home mini-graph consume `federation.json`.

**Resilience (required):** a missing/unreadable sibling repo degrades gracefully — that node renders from `instances.yaml` registry data alone, flagged `metadata: unavailable`. **The build never fails on a missing sibling.** This degraded path is exactly what the future aggregator service (pattern C) removes. The aggregation script is the **clean seam** to add C later without touching pages.

---

## 9. Modules roadmap

`src/data/modules.yaml` (org-os-owned content) drives `/modules` — one card per v0.5 module with `status: planned | in-dev | live`, a short description, and a link (repo / plan / docs) when one exists. Sourced from / cross-checked against `data/packages-matrix.yaml` where a module maps to a package. Presents the vision **honestly** — status badges prevent implying anything ships before it does.

---

## 10. Machine layer

- `/llms.txt` — a curated machine map of the site + curated docs (generated at build).
- `.well-known/*` — org-os's existing EIP-4824 schemas, surfaced/linked (copied into the static output).
- `/federation.json` — the aggregated artifact exposed as a static endpoint.

Cheap to build; makes the "agent-native" claim concrete for audience E.

---

## 11. Tech stack

- **Astro 5**, `output: "static"`, `build.format: "directory"` — mirrors refibcn-site.
- Deps: `astro`, `d3` (federation graph), `@fontsource-variable/geist` + `geist-mono`, `@fontsource-variable/inter`, `js-yaml` (read instance YAML at build).
- **No** `maplibre-gl` (no maps on this site).
- npm scripts: `dev`, `build`, `preview`, `astro`, plus a `prebuild`/build step that runs `aggregate-federation.mjs`.

---

## 12. Testing / verification

Static content site — no heavy test framework:
- `scripts/verify-build.mjs` — clean build succeeds + all expected routes/assets exist (pattern from refibcn-site).
- Internal link check over nav + curated-docs slugs.
- Schema/shape check on generated `federation.json`.
- Federation resilience check: build still succeeds with a sibling repo absent.

---

## 13. Relationship to refibcn-site

refibcn-site (`refi-bcn-os/repos/refibcn-site`) is the **reference shell we borrow patterns from** — it is **not** forked, imported, or moved. It stays exactly as-is and continues to serve refi-bcn. The org-os site re-implements the proven token/theme/data conventions in its own systems theme.

---

## 14. The `org-os-website-generator` seam

This site is the **first reference output** of the eventual generator, not the generator itself. The reusable core (`site/src/styles` + `components` + `scripts/aggregate-federation.mjs`) is kept cleanly separable from org-os's own content (`site/src/data/*.yaml`). A later sub-project extracts that core into a package/template so any instance can generate its site. Building toward this seam is a design constraint here; building the generator is out of scope.

---

## 15. Acceptance criteria (done-bar)

This sub-project is done when **all** are true:
1. `org-os/site/` builds cleanly to static output via `npm run build`.
2. All six routes render in the light systems theme: `/`, `/modules`, `/federation`, `/docs/[…]`, `/get-started`, `/about`.
3. `/docs/*` renders the curated set from `../docs/*.md` with **no file duplication** (single source of truth verified).
4. `/federation` + the home mini-graph render from `federation.json` aggregated at build from `instances.yaml` + live sibling reads, and **the build still succeeds with a sibling repo absent** (graceful degradation).
5. `/modules` renders every v0.5 module with an accurate status badge.
6. Machine layer present: `/llms.txt`, surfaced `.well-known/`, `/federation.json`.
7. `verify-build.mjs` + link check + `federation.json` shape check pass.
8. Theme is swappable in one line (`theme.css`) — proven by a stub dark theme toggling cleanly (even if dark is not finished).

---

## 16. Open decisions (resolve during planning / deploy)

- **Domain** — `org-os.foundation` / `orgos.dev` / subdomain. Deploy-time.
- **Accent color** — regen green (`#1f883d`) shown; indigo/teal are alternatives.
- **Version-display copy** — how the site reconciles framework v3.x with the "v0.5" public-surface label.
- **Final curated docs allowlist** — confirm the ~8–12 files (§7 is the starting set).
- **`/about` vs fold into `/`**.
- **Hosting / CI** — and whether siblings are git-submoduled for hosted builds (ties to pattern C). Separate sub-project.

---

## 17. Future sub-projects (presented by this site, built later)

`org-os-kms` · `rad-org-os` · `org-os-hermes` · `org-os-website-generator` · `org-os-members-hub` · ideation system · the federation aggregator service (pattern C) · Starlight docs migration (A1). Each gets its own spec → plan → build cycle, registered in org-os.
