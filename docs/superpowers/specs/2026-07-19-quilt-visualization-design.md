# QUILT Visualization of org-os — Design

**Date:** 2026-07-19
**Status:** Approved (Phase A shipped; Phase B queued)
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

## Quilt inventory

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

## Phase B — generator outline (next: writing-plans)

- `scripts/generate-quilt.mjs` — pure Node, no deps, mirrors other `scripts/*.mjs`.
- Composer core proven in Phase A (panel/row/quilt/stitch functions with width
  invariants — throwaway at `/tmp/quilt-compose.mjs`, to be rebuilt with TDD).
- Panel **templates** per quilt; only status shades, counts, dates, and drift flags are
  interpolated from `data/*.yaml`. Prose taglines stay hand-authored in the template —
  that's the creative residue Phase A earned.
- Output: rewrite `docs/QUILT.md` with a fresh `Woven <date>` stamp.
- npm script `generate:quilt`; candidate hook: run after `analyze:instances`.
- Self-check: every fenced line ≤86 chars; panel column alignment asserted.
- Open question for planning: should the master FEDERATION panel's node art be
  data-driven (nodes appear/disappear) or template-fixed with shade substitution only?
  Lean: template-fixed until an 8th instance forces the issue.

## Out of scope

- Color/HTML rendering (a Canvas/Obsidian view could come via the
  `obsidian-canvas-interface` scoping plan, not here).
- Emojiquilt/metaquilt variants.
- Per-instance quilts inside instance repos (possible later: each instance weaves its
  own quilt via the same generator, federated hub-side).
