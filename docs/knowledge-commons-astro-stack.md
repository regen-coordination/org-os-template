# Astro Knowledge Commons — Research & Recommended Stack

> Deep-research report (2026-07-22) for **org-os-kms**: a modern Astro knowledge
> infrastructure that fully replaces Obsidian Publish and Quartz — including the
> knowledge graph — reusable across org-os instances.
> Method: 5-angle web sweep → 22 sources fetched → 108 claims extracted →
> 25 adversarially verified (24 confirmed, 1 refuted). Sources 2024–2026.

## Verdict in one paragraph

No off-the-shelf theme does what we need — the reusable layer must be **assembled,
not installed**. The winning stack: **Astro 5.x/6 Content Layer API** (typed,
pluggable, cached loaders that mix vault Markdown with org registries) +
**BrainDB-style content graph** for wikilinks/backlinks/broken links +
**Graphology** as the graph data model + a **WebGL renderer (sigma.js or
cosmos.gl) in a client island** for the knowledge graph + **Server Islands** for
live per-org data. stereobooster's *astro-digital-garden* recipe catalog provides
near-complete Quartz parity to copy from; the multi-instance packaging layer is
ours to build — which is exactly the org-os value-add.

## Confirmed findings (adversarially verified)

### 1. Foundation: Astro Content Layer API (high confidence, 3-0)

- Stabilized in **Astro 5.0** (Dec 3 2024). Each collection uses a pluggable
  loader — local Markdown via `glob()`, remote APIs, CMSes, arbitrary filesystem
  paths — in one unified, type-safe (Zod) content model. Local caching between
  builds; incremental updates via stored metadata (last-modified, sync tokens,
  `generateDigest()`).
  ([content-layer-deep-dive](https://astro.build/blog/content-layer-deep-dive/),
  [astro-5](https://astro.build/blog/astro-5/),
  [loader reference](https://docs.astro.build/en/reference/content-loader-reference/))
- **Performance**: up to 5× faster Markdown builds, 2× faster MDX, 25–50% less
  memory vs legacy collections. (First-party benchmark; corroborated by a
  third-party 8k-post migration: 2h → 14min.)
- **Server Islands** stable in 5.0: static HTML + dynamic server-rendered
  components on the same page, per-island cache headers, encrypted props.
  ⚠ Requires an SSR adapter — pure static hosting can't serve them.
- ⚠ **Astro 6 went stable March 2026** (removes legacy collections, adds live
  collections). New builds should target Astro 6; all Content Layer findings
  carry over (it's now the only model).
- Refuted claim (1-2): "Content Layer debuted with the Astro 5 beta" — it
  actually debuted experimentally in **Astro 4.14**.

### 2. Wikilinks/backlinks: BrainDB (high confidence, 3-0 — with risk)

- **BrainDB** (stereobooster) is the only library explicitly positioned as a
  *reusable* content-graph layer for Astro/Next/Nuxt — resolves wikilinks, shows
  backlinks, finds broken links — in deliberate contrast to Obsidian/Quartz where
  these are app-embedded.
  Packages: `@braindb/core` 0.0.17, `@braindb/remark-wiki-link` 2.1.0,
  `@braindb/astro` 0.1.1 (wikilinks preconfigured, zero setup).
- ⚠ **Risk**: pre-1.0, ~60 stars, single maintainer, last push May 2025
  (~14 months stale). Adopting across instances carries **fork-or-vendor risk**.
  Open decision: vendor/fork BrainDB vs reimplement wikilink+backlink resolution
  directly on the Content Layer (custom loader + remark plugin).

### 3. Graph rendering at our scale (2,906 nodes / 4,678 edges) (high confidence)

- Peer-reviewed 2025 benchmark (Visual Computing for Industry, Biomedicine & Art;
  481 datasets; [doi:10.1186/s42492-025-00193-y](https://pmc.ncbi.nlm.nih.gov/articles/PMC12061801/)):
  **SVG is insufficient** (~2k nodes at 30fps); Canvas or WebGL required.
  30fps ceilings at edge:node ratio 1 — D3-WebGL ~7k, D3-Canvas ~5k,
  ECharts-Canvas ~3k, D3-SVG ~2k, G6-Canvas ~1k. Corroborated by yWorks
  (SVG ~2k / Canvas ~5k / WebGL 10k+). Our graph sits right at the Canvas
  ceiling → **WebGL it is**.
- **sigma.js** (v3 stable, v4 beta): WebGL, built on **Graphology** (which also
  supplies layouts, metrics, community detection), framework-agnostic, homepage
  demo renders 9k nodes interactively. Clean fit for an Astro island.
- **cosmos.gl**: GPU force-directed layout *and* rendering entirely in WebGL
  shaders; 1M+ elements claimed (simulation qualified at "hundreds of
  thousands" — still 60–300× our scale). OpenJS Foundation incubation since
  May 2025; v3.3 July 2026. Neutral governance, very actively maintained.
- **vasturiano family** (force-graph / 3d-force-graph / react-force-graph):
  actively maintained (all updated 2025–2026), 2D canvas + 3D WebGL + VR/AR.
  Medium confidence at our exact scale (official demo ~4k elements).
- **Decoupling pattern (key!)**: BrainDB documents/links → **Graphology
  MultiGraph JSON** → any renderer. Graph data model independent of renderer —
  and our graphify `graph.json` (NetworkX node-link) converts trivially.

### 4. Reuse vs build: astro-digital-garden (high confidence, 3-0)

- [astro-digital-garden](https://github.com/stereobooster/astro-digital-garden)
  (stereobooster, active, pushed June 2026): **46 Starlight-based recipes**
  covering near-complete Quartz/Obsidian-Publish parity — wikilinks, backlinks,
  content-graph visualization (BrainDB→Graphology→sigma 3.0.1), hover link
  previews, ToC, static search, tags, SEO/SMO meta, social-image autogeneration,
  dark/light mode. **It is a copy-paste recipe catalog, not an installable
  theme** — its own stated "ultimate goal" (a theme) is unrealized.
- Starlight maintainers **declined** to add Obsidian-Publish features to core
  (Aug 2025) — these will always live in plugin/recipe land.
- Adjacent tools surfaced (fetched, not fully verified):
  - `astro-loader-obsidian` 0.10.0 — Obsidian vault as native Astro 5 content
    collection (peer dep astro ^5.12.5)
  - `astro-theme-spaceship` — Obsidian-vault→website theme, Astro+Tailwind
  - `starlight-obsidian` plugin — vault→Starlight with sidebar generation

### 5. UI layer (fetched; below the verification cut — treat as strong leads)

- **shadcn/ui officially supports Astro** (`npx shadcn init -t astro`), with
  Tailwind v4 + React 19 support production-ready.
- **Starwind UI** v2.0.1 (June 2026) — shadcn-style components **native to
  Astro** (copy-in via `npx starwind add`, no React islands needed).
- **astro-pagefind** — builds a Pagefind static-search index during
  `astro build`, serves prebuilt index in dev. Static, zero-backend search.
- Multi-brand precedent: DatoCMS "MultiLaunch" pattern — **monorepo with one
  app per brand + shared UI package** as the alternative to an installable
  theme package.

## Coverage gaps (claims did not survive verification — research directly when building)

1. **Open standards** (.well-known metadata, JSON-LD/schema.org for notes,
   RSS/OPML, Webmentions/IndieWeb) — no verified claims; we already have
   EIP-4824 `.well-known/` as our own standard, which no competitor has.
2. **Multi-instance packaging** — npm Astro integration vs Starlight
   plugin/theme vs template repo + sync tooling: undecided, prototype-and-see.
3. **UI performance at ~3k pages** (Pagefind, popover previews at scale).

## Recommended architecture for org-os-kms

```
┌─────────────────────────────────────────────────────────────┐
│  @org-os/knowledge-commons  (Astro integration package)      │
├─────────────────────────────────────────────────────────────┤
│  CONTENT PLANE (Content Layer API, Astro 6)                  │
│   • glob() loader     → vault/knowledge Markdown (wikilinks) │
│   • custom loader     → data/*.yaml registries               │
│   • custom loader     → graphify-out/graph.json              │
├─────────────────────────────────────────────────────────────┤
│  GRAPH PLANE                                                 │
│   • Graphology MultiGraph = canonical in-site graph model    │
│   • graphify NetworkX node-link → Graphology converter       │
│   • wikilink graph (BrainDB-style) merged w/ semantic graph  │
├─────────────────────────────────────────────────────────────┤
│  RENDER PLANE                                                │
│   • sigma.js WebGL island: global graph + per-page local     │
│     graph (community colors, source_file deep links)         │
│   • Starwind/shadcn UI, Tailwind v4, dark mode               │
│   • Pagefind command-palette search, hover previews, ToC,    │
│     backlinks panel                                          │
├─────────────────────────────────────────────────────────────┤
│  INTEROP PLANE                                               │
│   • .well-known/ EIP-4824 registries (already generated)     │
│   • JSON-LD, sitemap, RSS — federation-ready                 │
├─────────────────────────────────────────────────────────────┤
│  INSTANCES: org-os · refi-bcn · refi-dao · regen-coord · …   │
│   each: astro.config + branding tokens + content dirs        │
└─────────────────────────────────────────────────────────────┘
```

Differentiators vs Quartz: (a) semantic graph from graphify (communities,
provenance, freshness via `built_at_commit`) rather than link-derived only;
(b) live org registries (projects, ideas, funding) as first-class content;
(c) federation metadata built in; (d) per-instance theming from one package.

## Open decisions

1. BrainDB: vendor/fork vs reimplement on Content Layer. (Lean: reimplement —
   it's a remark plugin + resolver over collections we already control.)
2. Renderer: sigma.js (stable, Graphology-native) vs cosmos.gl (faster, GPU
   layout, OpenJS governance). (Lean: sigma.js for v1 — Graphology synergy;
   cosmos.gl if layout perf disappoints.)
3. Packaging: Astro integration npm package vs monorepo shared-app. (Prototype
   as `packages/knowledge-commons/` in-repo first, publish later.)
4. Server Islands need SSR adapter — decide static-only v1 vs Node adapter.
