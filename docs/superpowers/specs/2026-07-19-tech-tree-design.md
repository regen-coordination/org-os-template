---
id: tech-tree
title: "org-os Tech Tree — dialectical development graph (Design)"
status: implemented on frozen branch (v0.6+; portfolio memo row 13)
type: feature-spec
created: 2026-07-19
last_updated: 2026-07-19
brainstorming_session: 2026-07-19
operator: luizfernandosg
location: data/tech-tree.yaml + scripts/ + site/src/pages/tech-tree.astro + skills/tech-tree/
workstream: framework-evolution
---

# org-os Tech Tree — Dialectical Development Graph

> **Theme:** A sleek, responsive graph of everything org-os is and wants to become — modules, skills, integrations, capabilities, standards, ideas — each with a live status. Not a passive roadmap: editing the tree *is* the planning act, agents keep it honest as they ship, and its frontier generates the next plans. The map and the territory develop each other (dialectic chosen: **B+C** — read-write source of truth + autopoietic loop).

---

## 1. Scope

**In scope:**

- `data/tech-tree.yaml` — a new **overlay registry** holding graph structure (nodes + edges), referencing existing registries by id for status.
- `scripts/resolve-tech-tree.mjs` — resolver: registry refs → concrete statuses → **resolved graph JSON** (the reusable seam for all consumers).
- `scripts/validate-tech-tree.mjs` — drift/integrity validator (`npm run validate:tech-tree`).
- `/tech-tree` page on the existing Astro site (`site/`) — interactive SVG graph, four layout modes, theme-adaptive (blueprint light / observatory dark).
- Feedback mechanics: `/initialize` dashboard line, `/close` checklist item, and a first-class `tech-tree` skill.
- Seeding the initial tree content; `docs/TECH-TREE.md`; tests.

**Out of scope (designed-in, deferred):**

- **Frontier report** (`npm run report:frontier`) — fast follow; the resolver emits the `frontier` block now, the report command renders it later.
- Obsidian Canvas exporter / dashboard embed — future consumers of the resolved JSON.
- In-browser editing (direct manipulation with write-back) — editing stays **agent-mediated** (decision below).
- Instance adoption of the `tech-tree` skill — promotable later via the normal skill-promotion pipeline.

## 2. Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Dialectic | **B+C** — tree is read-write source of truth for structure/ideation; agents update it as they ship; frontier generates plans |
| Data location | **Overlay registry** — `data/tech-tree.yaml` owns structure + native-node status; ref-backed status pulled from existing registries at resolve time (no second source of truth) |
| Editing model | **Agent-mediated** — YAML edited in sessions; rendered graph is a view, not an editor |
| Surface | **Site page + generator seam** — `/tech-tree` primary; resolver output (`tech-tree.resolved.json`) consumable by future Canvas exporter / dashboard |
| Node ontology | capability (spine, native) · module (→ packages-matrix) · skill (→ skills-matrix) · integration (native) · standard (native) · idea (→ ideas.yaml) |
| Status scale | `live · in-dev · planned · ideation · dormant · retired` (unified; mappings §4) |
| Layouts | **All + hybrid** — Hybrid (default), Constellation, Tech Tree columns, Living Tree; switchable, URL-addressable |
| Aesthetic | **A/B per theme** — Blueprint schematic in light theme, Dark observatory in dark theme, via the site's token contract |
| Feedback mechanics | Validator + session surfacing + `tech-tree` skill now; frontier report fast-follow with seam built now |

## 3. Data model — `data/tech-tree.yaml`

```yaml
schema_version: "1.0"
meta:
  root: "org-os"                  # the trunk node id

nodes:
  - id: "cap-federation"          # tree-local id; conventional prefixes: cap- mod- skl- int- std- idea-
    type: "capability"            # capability | module | skill | integration | standard | idea
    label: "Federation"
    summary: "Hub/instance topology, trust levels, drift analysis, promotion."
    status: "live"                # NATIVE nodes only (capability/integration/standard, or ref-less idea)
    rollup: true                  # capability-only, default true: status derived from children
                                  # (most advanced child status wins: live > in-dev > planned > ideation);
                                  # explicit `status` overrides rollup
    links:
      - { label: "spec", href: "docs/FEDERATION.md" }
    driving: ["project:federation-protocol"]   # optional: projects/plans pushing this node

  - id: "mod-kms"
    type: "module"
    label: "org-os-kms"
    ref: "package:org-os-kms"     # REF-BACKED: status resolved from the source registry;
                                  # declaring `status` on a ref-backed node is a validation error

edges:
  - { from: "mod-kms", to: "cap-knowledge", kind: "part-of" }
  - { from: "mod-kms", to: "mod-toolkit-framework", kind: "depends-on" }
  # kinds: part-of | depends-on | enables | supersedes
```

**Rules:**

- Ref-backed nodes (`ref:` present) never declare `status` — truth stays in the source registry. To change their status, edit the source registry (the `tech-tree` skill enforces this routing).
- Native nodes (no `ref`) declare `status` directly using the unified scale.
- `part-of` edges form the tree hierarchy (must be acyclic); `depends-on` / `enables` / `supersedes` are cross-cutting.
- Every node except the root should be reachable from the root via `part-of` (validator warns otherwise).

## 4. Status resolution

Unified scale, ordered by "how real": **`live` → `in-dev` → `planned` → `ideation`**, plus **`dormant`** (built, unused) and **`retired`**.

| Source | Mapping to tree status |
|---|---|
| `package:*` (packages-matrix `lifecycle_status`) | `active→live` · `dormant→dormant` · `planned→planned` · `retired→retired` |
| `skill:*` (skills-matrix `promotion_status`) | `canonical→live` · `evaluating→dormant` · `candidate→in-dev` · `instance-specific→dormant` · `deprecated→retired` |
| `idea:*` (ideas.yaml `status`) | `surfaced/proposed→ideation` · `approved→planned` · `developing→in-dev` · `hatched→live` · `archived→retired` |
| Native node | declared `status` |
| Capability with `rollup: true` | most advanced child status (`live > in-dev > planned > ideation`; `dormant`/`retired` children ignored for rollup); explicit `status` overrides |

## 5. Resolution pipeline

`scripts/resolve-tech-tree.mjs`:

1. Reads `data/tech-tree.yaml` + `data/packages-matrix.yaml` + `data/skills-matrix.yaml` + `data/ideas.yaml`.
2. Resolves every node to a concrete status (mappings §4), computes rollups.
3. Emits **resolved graph JSON**: `{ meta, nodes: [{id, type, label, summary, status, statusSource, links, driving}], edges, stats, frontier }`.
   - `stats` — counts per status/type + nodes whose status changed vs the previous resolved output (for the dashboard line).
   - `frontier` — ideation/planned nodes clustered by nearest capability ancestor, with gap notes (e.g. "capability X has no in-dev child"). **This is the seam for the future frontier report.**
4. Output: `site/src/data/tech-tree.resolved.json` (git-tracked, like `federation.json`), regenerated by `npm run resolve:tech-tree` (root) and automatically during site build.

`scripts/validate-tech-tree.mjs` (`npm run validate:tech-tree`):

- Every `ref` resolves to an existing registry entry.
- Every edge endpoint exists; no `part-of` cycles; no duplicate node ids.
- Ref-backed nodes carry no `status`; native nodes carry a valid one.
- Reachability warning for nodes not connected to the root via `part-of`.
- **Coverage drift warning**: packages/skills/ideas in the registries but absent from the tree (new entries that haven't been placed).
- Wired into the root validation flow alongside `validate:schemas` / `validate:structure`.

Both fail hard with named-node messages; a bad ref can never silently render.

## 6. Rendering — `/tech-tree` on the site

**Architecture:** one Astro page + one client-side island (vanilla TS; dependencies limited to `d3-force` + `d3-zoom`). Renders **SVG** — every visual attribute driven by CSS custom properties, which is what makes dual-personality theming clean. Hydrates from the resolved JSON inlined at build.

**Layout modes** (switcher over the same resolved graph, URL-addressable `?view=`):

1. **`hybrid`** *(default)* — force-directed constellation with a radial status constraint: `live` gravitates toward the core, `ideation` held at the rim. The frontier is literally the edge of the system.
2. **`constellation`** — pure force layout, no status constraint.
3. **`techtree`** — deterministic status columns, left→right (`live → in-dev → planned → ideation`; `dormant`/`retired` in a collapsed tray). No physics.
4. **`tree`** — hierarchical living-tree layout from `part-of` edges, trunk-up; cross-cutting edges drawn as faint arcs.

**Theming:** graph tokens (`--tt-node-<status>`, `--tt-edge`, `--tt-glow`, `--tt-label`, …) defined in both site themes:

- **Light = blueprint schematic** — ink node shapes on warm paper over the blueprint grid, engineering-drawing labels (`FIG`-style), status as colored strokes, no glow.
- **Dark = observatory** — near-black canvas, status glow (SVG filters), faint edges, ideation as hollow dashed outlines.

Same markup, no special-casing — the active theme decides the personality. Final palette values validated with the **dataviz skill** during implementation (contrast in both themes, colorblind-safe status hues).

**Interaction:**

- Pan/zoom (d3-zoom); hover highlights the node's neighborhood (connected edges + nodes, rest dims).
- Click → **detail panel**: summary, status + which registry it came from (`statusSource`), edges in/out, links, `driving` plans.
- Filter chips by type and by status; persistent legend.
- Skill nodes render **clustered** under their capability (expand/collapse) so 32 skills don't smother the graph.
- `prefers-reduced-motion` → precomputed static layout, no simulation drift.

**Responsive:** full-viewport canvas on desktop; on mobile the detail panel becomes a bottom sheet and `techtree` is the recommended view (degrades best to narrow screens); constellation/hybrid remain pannable.

## 7. Dialectical mechanics

**Now:**

1. **Validator** (§5) — the tree cannot drift from the registries unnoticed.
2. **`/initialize`** — dashboard line from resolver `stats`: `Tech tree: 42 nodes · 6 in-dev · 9 frontier · 2 moved since last session`.
3. **`/close`** — checklist item: "Did anything ship, start, or die this session? → update `data/tech-tree.yaml`, run `npm run validate:tech-tree`."
4. **`tech-tree` skill** (`skills/tech-tree/SKILL.md`) — operations:
   - *add* — create node + edges with correct type/ref conventions;
   - *promote* — status transition; for ref-backed nodes it edits the **source registry** (truth stays where it lives), for native nodes the tree itself;
   - *connect* — add/modify edges;
   - *audit* — run validator + coverage report, propose placements for uncovered registry entries;
   - *render* — resolve + open the page.
   - Registered in `federation.yaml` `agent.skills` and `data/skills-matrix.yaml` (`owner: framework`, `promotion_status: evaluating`) — promotable to instances so any org can grow its own tech tree.

**Fast follow (seam built now):** `npm run report:frontier` renders the resolver's `frontier` block into `memory/reports/tech-tree-frontier-YYYY-MM-DD.md`, proposing which frontier nodes are ripe to become plans in `docs/agent-plans/QUEUE.md`. No new data work needed when built.

## 8. Seeding (part of implementation)

- **Capability spine (~8–10 native nodes):** identity, memory, data + schemas, skills-system, session-lifecycle, federation, knowledge/KMS, safety, interfaces.
- **Modules:** every `packages-matrix.yaml` entry via `ref`.
- **Skills:** every `skills-matrix.yaml` entry via `ref` (rendered clustered).
- **Ideas:** every active `ideas.yaml` entry via `ref`.
- **Integrations (native):** Obsidian, Notion, GitHub, Telegram, KOI, OPAL.
- **Standards (native):** EIP-4824 schemas, file-structure spec, federation protocol, skill specification, vault-safety protocol.
- Cross-check against `site/src/data/modules.yaml` (the v0.5 module constellation) so the public roadmap and the tree agree.

## 9. Docs, testing, error handling

- **`docs/TECH-TREE.md`** — the dialectic, the schema, status mappings, how to edit (via the skill), how consumers use the resolved JSON.
- **Tests (`node --test`):** resolver + validator fixture suites — bad ref, cycle, orphan edge, duplicate id, ref-backed-with-status, rollup cases (incl. override), status-mapping table, frontier clustering.
- **Site:** `verify-build.mjs` gains the `/tech-tree` route; visual verification in **both themes** and all four layouts before shipping.
- **Error handling:** resolver/validator throw at build time with named-node messages. The site build fails rather than rendering stale or wrong statuses.

## 10. Success criteria

1. `npm run validate:tech-tree` passes on the seeded tree; deliberately broken fixtures fail with named-node messages.
2. `/tech-tree` renders the seeded graph in all four layout modes, in both themes, on desktop and mobile.
3. Every node's status traceably matches its source registry (spot-check via detail panel `statusSource`).
4. `/initialize` shows the tech-tree line; `/close` includes the update prompt.
5. The `tech-tree` skill can add, promote (routing ref-backed changes to source registries), connect, and audit without manual YAML surgery.
6. Resolved JSON contains the `frontier` block — the frontier report can be built later without touching the resolver.
