# org-os Knowledge Commons (KMS) — Design Spec

**Date:** 2026-07-23
**Status:** frozen (v0.6+; portfolio memo §5)
**Research basis:** [docs/knowledge-commons-astro-stack.md](../../knowledge-commons-astro-stack.md) — 104-agent deep research, 24/25 claims verified
**Related:** [2026-07-22-graphify-kms-integration-design.md](2026-07-22-graphify-kms-integration-design.md)

## 1. What we're building

A modern Astro knowledge-commons platform that fully replaces Obsidian Publish
and Quartz — including the knowledge graph — packaged so any org-os instance can
adopt it. Two npm workspaces in this repo:

- **`packages/knowledge-commons/`** — the product: an Astro **integration**
  (not a theme fork) exposing loaders, the link layer, the graph pipeline,
  layouts/components, and design tokens.
- **`site/`** — the reference commons: one deployment mounting four sources,
  proving multi-source = multi-instance configurability.

### Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| v1 scope | **Notes + graph + registries (read-only)** — the full org commons |
| Hosting | **Fully static v1, islands-ready** — components behind data-props boundaries so any can become a Server Island later (needs SSR adapter then, not now) |
| Reference content | **org-os framework + regen-toolkit (385 notes) + refi-dao-os (272) + refi-bcn-os (2)** |
| Topology | **Package + reference commons** — package is the product; instances deploy standalone later |
| UI chassis | **Custom Astro shell** — no Starlight (its maintainers declined Obsidian-Publish features in core; a docs frame fights a commons) |
| Build strategy | **Approach 2: own thin core, adopt at the edges** (see §3) |
| Aesthetic | **Swiss Technical × organic/transhumanist ASCII**, carmine `#D6281E` on warm paper (see §6) |
| Emphasis | **Content/knowledge first** — reading is the product; the graph is a supporting lens |

## 2. Architecture

```
SOURCES (per instance)          @org-os/knowledge-commons           DEPLOYMENTS
─────────────────────           ─────────────────────────           ───────────
markdown notes      ──▶  CONTENT PLANE: Content Layer loaders  ──▶  site/ (reference
data/*.yaml         ──▶    notesLoader · registryLoader ·           commons, static)
.well-known/*.json  ──▶    graphLoader                              regen-toolkit
graphify-out/       ──▶  LINK PLANE (owned): remark-wikilink ·      refi-dao · refi-bcn
  graph.json               resolver · backlink index                (adopt later, own
                         GRAPH PLANE: networkx→Graphology ·          kms.config each)
                           merge semantic+wikilink+registry ·
                           seeded FA2 layout at build
                         UI PLANE: tokens · layouts · sigma.js
                           island · Pagefind ⌘K
```

Target **Astro 6** (stable Mar 2026; Content Layer is the only content model).
All content becomes typed collections (Zod schemas).

## 3. Build strategy — own thin core, adopt at the edges

**Own** (small surface that must be rock-solid; BrainDB is stale/pre-1.0 so we
reimplement rather than depend or fork):
- remark wikilink plugin, link resolver, backlink index — built directly on
  Content Layer collections (~2 focused modules).

**Adopt** (large, actively maintained):
- **Graphology** — canonical graph model + layouts/metrics/communities
- **sigma.js v3** — WebGL renderer (2,906 nodes needs WebGL: SVG dies ~2k,
  Canvas ~5k per the 2025 VCIBA benchmark). cosmos.gl is the designed upgrade
  path if layout perf disappoints.
- **Pagefind** (via astro-pagefind) — static search, ⌘K palette
- **Tailwind v4** + Starwind-style native-Astro components — no React islands
- astro-digital-garden recipes as implementation references (logic, not code)

## 4. Content & link plane

**Collections:**
- `notes` — one collection, many sources. Entry: `source` (instance id),
  `slug` (`<source>/<path>`), `title`, `description`, `tags`, `updated`
  (frontmatter date, git mtime fallback), frontmatter passthrough. Per-source
  include/exclude globs (regen-toolkit's `working/`, `archive-*/` excluded).
- `registries` — typed per kind (projects, ideas, funding, members, skills)
  from each source's `data/*.yaml`; `.well-known/*.json` copied through
  verbatim (the machine-readable commons).
- `graph` — merged Graphology graph serialized to one compact JSON artifact.

**Wikilinks (v1):** `[[Page]]`, `[[Page|alias]]`, `[[Page#heading]]`.
No transclusion/embeds. Resolution: exact match in same source → unique match
across sources → else ambiguous/missing. Ambiguous → disambiguation popover.
Broken → muted dead-link style, never a build failure. All broken/ambiguous
links land in `link-report.json`, feeding the knowledge-gaps registry.

**Backlinks & provenance:** backlink index at build; every note shows
backlinks + provenance (source badge, repo path, tended date, `built_at_commit`).

## 5. Graph plane

1. Convert graphify NetworkX node-link JSON → Graphology MultiGraph
2. Merge wikilink graph (notes as nodes, resolved links as edges) + optional
   registry references; tag every node/edge with `kind`
   (`semantic|wikilink|registry`) and `source`
3. **Seeded ForceAtlas2 layout in Node at build** → positions baked into the
   JSON artifact; deterministic between builds; client runs zero physics
4. sigma.js island (vanilla) renders: hover/zoom/click/filter only

**Surfaces:**
- `/graph` — full explorer: filter rail (text, source chips, community colors,
  edge-type toggles), click → inspector (excerpt, backlinks, degree, freshness,
  open note), deep-linkable `?node=`
- **Mini-graph in the chrome** — every page, top-right/sidebar-anchor:
  global map glimpse on home/registry/topics; live labeled 1-hop neighborhood
  on notes; always one click → explorer deep-linked
- Payload budget ≤1 MB gzipped, lazy-loaded only where a graph renders

## 6. UI system & IA (v8 final)

**Design language:** Swiss Technical × organic/transhumanist ASCII.
Warm paper `#FDFCFA`, ink `#1A1714`, carmine accent `#D6281E`. Two voices:
**mono = machine** (paths, status, metadata: `⠿ synced @ 43884e7`),
**grotesk = human** (display titles, reading body). Character system:
closed containers with labels set into the border (`❦ COMMONS`, `← BACKLINKS`),
corners carrying live metadata (`● alive · 3h`, `2 of 9`); tree glyphs `├──`;
block-element sparks `▁▃▆`; `❦ ⟡ ∴ ◉ ○ ⚄ ◌` sigils; blinking `_` cursor.
All of it CSS-tokenized (`--kc-accent`, `--kc-paper`, `--kc-ink`, …) so
instances re-skin without forking. Dark mode variant of the same tokens.

**Three-zone layout grammar (note pages):**
- **Left: files sidebar, collapsed by default** — 26px rail (`»`, jump glyphs
  ⌂ ├ ◉, vertical `FILES [` hint) → expands to the vault tree: biomes as top
  branches, ascii glyphs, per-folder counts, current note marked with a red
  spine (siblings visible = trail context), type-to-filter, registry + graph
  entries at bottom. Keyboard `[`; state in localStorage.
- **Center: reading, sovereign** — centered column, 60ch measure, 1.85
  line-height; title block + short red rule; hover-preview wikilinks
  (closed-container popover); trail box at article end.
- **Right: context sidebar** — anchored by `◉ NEIGHBORHOOD` (sticky mini-graph,
  labeled nodes) → `§ CONTENTS` → `← BACKLINKS` → provenance. Keyboard `]`.
  When the left tree opens on narrow viewports, right folds to an icon rail
  (◉ § ←). Mobile: sidebars fold below; graph collapses to a `◉ 12 links` pill.

**Home (the knowledge front door)** — internally developed sections:
- `❦ COMMONS` hero (display type, vitals line, inline search) beside `◉ MAP`
  (global glimpse, community-color legend) in one aligned grid row
- `⟡ TRAILHEADS` — trails rendered as threads `◉──○──○` with title, one-line
  promise, stops/duration, first-stop entry link
- `├ BIOMES` — per-org rows: identity + tagline, clickable topic chips,
  activity sparkline, count, enter →
- `◦ RECENTLY TENDED` — entries with first lines ("the living edge")
- `⚄ DEEP CUT` (resurfaced old-but-linked notes) + `◌ GAPS` (open knowledge
  gaps from `data/knowledge-gaps.yaml` as invitations: "268 open · adopt one →")
- Footer: `⠿ synced @ <commit>` · `.well-known ↗ · rss ↗ · llms.txt ↗`

**Routes:**
```
/                      home (front door)
/<source>/<...slug>    note pages
/topics/<tag>          cross-source topic hubs
/registry/…            projects · ideas · funding · members (read-only)
/graph                 explorer
/.well-known/*         machine endpoints (passthrough) + llms.txt + RSS + sitemap
```

**Discovery loop (designed, not accidental):** trailheads → trail position in
every note ("2 of 9", prev/next) → wander ⚄ (weighted random: prefers
unvisited, well-connected notes) → deep cut → backlinks/neighborhood lateral
hops. Search (⌘K, filterable by source) is the primary instrument; the graph
is the ambient one.

## 7. Multi-instance config & migration

One config file per instance, `kms.config.mjs`:

```js
export default {
  identity: { name: 'org—os/commons', emoji: '◉', accent: '#D6281E' },
  sources: [
    { id: 'org-os',   label: 'Framework',     dir: '.', content: ['docs/**','skills/**'],
      data: 'data/', graph: 'graphify-out/graph.json' },
    { id: 'toolkit',  label: 'Regen Toolkit', dir: '../regen-coordination-os/repos/regen-toolkit',
      content: ['content/**'], exclude: ['**/working/**','**/archive-*/**'],
      trails: 'src/data/journeys.js' },
    { id: 'refi-dao', label: 'ReFi DAO',      dir: '../refi-dao-os', content: ['knowledge/**'] },
    { id: 'refi-bcn', label: 'ReFi BCN',      dir: '../refi-bcn-os', content: ['knowledge/**'] },
  ],
  features: { trails: true, wander: true, deepCut: true,
              gaps: 'data/knowledge-gaps.yaml', registry: true, graph: true },
}
```

- `dir` paths resolve **relative to the repo root where `kms.config.mjs`
  lives** (here: org-os; siblings reachable via `../` in the vault workspace).
- Sources are **local paths in v1**. A remote git loader is the designed v2
  extension — same source schema, different fetcher.
- **Migration:** reference commons ships → regen-toolkit adopts
  (`journeys.js` maps 1:1 to trails; drops Starlight) → refi-dao / refi-bcn
  standalone when wanted. Package versioned; instances pin + update
  (`sync:upstream` philosophy).

## 8. Error handling

Nothing content-shaped ever fails the build:

| Condition | Behavior |
|---|---|
| Broken wikilink | dead-link style + `link-report.json` entry |
| Ambiguous wikilink | disambiguation popover + report entry |
| Malformed frontmatter | page quarantined, warning, build continues |
| Invalid registry YAML | entry skipped + reported |
| Missing graphify output | site builds; graph boxes show "graph not yet grown ⟡" empty state |

Seeded FA2 → deterministic layouts (no map-churn per deploy).
`link-report.json` feeds the knowledge-gaps pipeline.

## 9. Testing

- **Fixture mini-vault** — synthetic multi-source corpus with deliberate
  ambiguous/broken/unicode-slug cases
- **Unit (vitest)** — resolver, converter, merge, backlink index
- **Integration** — full `astro build` on fixture; assert pages, backlinks,
  graph JSON shape
- **E2E smoke (Playwright)** — home renders, ⌘K works, graph island mounts,
  sidebar toggles
- **Budgets** — graph payload ≤1 MB gz; Lighthouse ≥95 on note pages
- **A11y** — full keyboard nav (`[` `]` `⌘K` trail arrows),
  `prefers-reduced-motion` disables ambient drift, graph has a real list-view
  fallback for screen readers

## 10. Out of scope (v1)

- Transclusion/embeds (`![[...]]`)
- Server Islands / live data (design keeps the door open; needs SSR adapter)
- Remote git source loaders (v2; schema already accommodates)
- Webmentions/ActivityPub (research gap — revisit with fresh sources)
- Publishing filters for private vault content (needed before personal-hub adoption)
- Editing/contribution UI (the repo is the editor; GAPS box links to it)

## 11. Open items carried to planning

1. Exact Tailwind v4 token architecture for the ASCII-container primitives
   (`.kbox` label-in-border as a reusable component)
2. Trail data model beyond regen-toolkit's journeys (frontmatter-declared
   trails for other sources)
3. Wander weighting function (degree × recency × unvisited)
4. Whether `llms.txt` generation lives in this package or in generate:schemas

## Mockup lineage

`.superpowers/brainstorm/80375-1784755627/content/` — v1→v8 progression;
`nav-sidebar-v8.html` + `home-v7.html` are the approved surfaces.
(Note: `.superpowers/` is gitignored; the spec text above is the durable record.)
