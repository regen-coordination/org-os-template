# QUILT Visualization of org-os — Design

**Date:** 2026-07-19
**Status:** Approved — Phase A shipped; **Phase B shipped 2026-07-19** (`npm run generate:quilt`)
**Artifact:** `docs/QUILT.md`

## Goal

Visualize the whole org-os system — modules, integrations, federation, workstreams —
as [QUILT-protocol](https://wibandwob.com/quiltprotocol/) ASCII quilts, shaded by live
status. One glance should answer: what is load-bearing, what is moving, what is forming,
what sleeps, what needs attention.

## Decisions (approved in session)

1. **A→B phasing.** Phase A: hand-crafted quilts, composed from live registry data.
   Phase B: `scripts/generate-quilt.mjs` re-weaves the same quilts deterministically
   from `data/*.yaml`.
2. **Multi-quilt (option C), core-four scope (option A).** One master 3×3 quilt +
   four subsystem quilts: Federation, Packages, Skills, Projects. Integrations,
   data/schemas, and automation appear as master panels only (status too uniform to
   earn their own quilts).

## Status grammar (unified across all quilts)

| Shade | Meaning | Mapped from |
|-------|---------|-------------|
| `█` | live — load-bearing, production | `production` instances · `active`+`canonical` packages · `canonical` skills |
| `▓` | moving — actively developed | `beta` instances · `evaluating` packages/skills · `Develop` projects |
| `▒` | forming — discovery, bootstrap | `alpha` instances · `candidate` skills · `Discovery` projects |
| `░` | latent — planned, dormant, queued | `dormant`/`planned` packages · queued plans |
| `☓` | attention — drift, fork-ahead, missing | `drift:` flags in instances.yaml · fork-ahead warnings |

Stitches (interpanel symbols): `→` flow · `↔` sync · `⊕` promotion (instance→framework) ·
`≡` correspondence · `∴` therefore · `»` points-to-next · `◉` hub · `∅` never · `?` open.

QUILT conventions honored: 28-char-wide panels (26 inner), single space between
columns, no blank line between rows, box-drawing borders, a `#hashtag` patchnote
(≤15 keyword-dense words) under every quilt, fenced code blocks only.

## Revision 2026-07-19b — organic containment (approved, supersedes grid layout)

Operator asked for smaller containers and a more organic/containerized whole. The five
uniform 3×3 grids were replaced by **one organism** with four containment tiers:

| Tier | Border | Meaning |
|------|--------|---------|
| organism | `╔═╗ ║` | the whole system — one outer membrane (`ORG-OS`) |
| organ | `┏━┓ ┃` | a subsystem: CORE, DATA≡SCHEMAS, INTERFACES, INTEGRATIONS, AUTOMATION, FEDERATION, PACKAGES, SKILLS, PROJECTS |
| patch | `╭─╮ │` | one living thing (instance, package, project…) — **width/height sized to its content: a thing earns its pixels** |
| pod | `(…)` | small or dormant things, one breath each, wrapped in labeled clusters |

Geometry: organism inner width 84; organs pack side by side when narrow (CORE+DATA,
INTERFACES+INTEGRATIONS) via the same greedy packer that packs patches inside organs —
containment is recursive, one `pack()` at every level. Ragged bottoms are kept (organic,
not squared off). Stitch lines between organs narrate flow (`∴`, `↔`, `⊕`, `»`).
Status grammar unchanged. Registered `org-os-federation-map` ("the torch") added to
PACKAGES. Phase B generator inherits this composer (patch/pack/pods/organ/organism
functions, prototyped at `/tmp/quilt-organism.mjs`).

## Quilt inventory (superseded by 2026-07-19b — kept for lineage)

| Quilt | Grid | Center panel | Panel unit |
|-------|------|--------------|------------|
| Master — the loom | 3×3 | FEDERATION ◉ | one module of the system |
| Federation — the web | 3×3 | ORG-OS ◉ HUB | one instance (7) + sync ledger |
| Packages — the travelers | 3×3 | MATRIX ×22 (counts) | one package cluster |
| Skills — the garden | 3×3 | PIPELINE ⊕ | one skill domain |
| Projects — the field | 3×4 | — | one project (11) + plans queue |

## Data sources

`data/instances.yaml` (maturity, drift, last_sync, packages), `data/packages-matrix.yaml`
(lifecycle_status, promotion_status, owner), `data/skills-matrix.yaml` (promotion_status),
`data/projects.yaml` (stage), `federation.yaml` (peers, skills count), `HEARTBEAT.md`
(open-task count, backlog items).

## Phase B — generator (shipped 2026-07-19)

Shipped exactly as outlined, via TDD (plan: `docs/superpowers/plans/2026-07-19-generate-quilt.md`):

- **`scripts/lib/quilt-compose.mjs`** — pure geometry: `patch`/`pack`/`pods`/`organ`/`organism`/`stitch`, code-point width, throw-on-overflow (content AND title). Tests: `tests/quilt-compose.test.mjs` (9).
- **`scripts/lib/quilt-view.mjs`** — data→spec mappers: `instancePatch`/`syncLedger` (federation), `packageTiers`/`projectTiers` (tiering + `PKG_DETAIL`/`PROJECT_DETAIL` overrides), `skillCounts`/`GARDEN_GROUPS`. Warn-on-unknown so new registry rows never crash. Tests: `tests/quilt-view.test.mjs` (10).
- **`scripts/generate-quilt.mjs`** — CLI (`--root`, `--stdout`), reads the 4 registries + HEARTBEAT/memory/.well-known/scripts/federation.yaml, weaves the organism, rewrites `docs/QUILT.md` with a fresh `Woven <date>` stamp. `wrapSeparated` wraps the sync-ledger to fit the federation organ. Tests: `tests/generate-quilt.test.mjs` (4, spawn-based).
- **`npm run generate:quilt`** wired in `package.json`. 46/46 suite green.
- Prose taglines/organ layout stay hand-authored in the generator + view constants — the creative residue Phase A earned; only shades, counts, dates, drift flags are data-interpolated.

**Resolved open question:** the federation node art is fully **data-driven** — instances become patches (or a substrate pod for `federation_role: agent-runtime`), no 8th-instance limit; only the master CORE/interfaces/integrations/automation prose is template-fixed.

**Deferred:** candidate hook to run after `analyze:instances` (left manual for now — regenerate on `data/` change per HEARTBEAT routine).

## Out of scope

- Color/HTML rendering (a Canvas/Obsidian view could come via the
  `obsidian-canvas-interface` scoping plan, not here).
- Emojiquilt/metaquilt variants.
- Per-instance quilts inside instance repos (possible later: each instance weaves its
  own quilt via the same generator, federated hub-side).
