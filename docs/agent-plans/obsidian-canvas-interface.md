---
id: obsidian-canvas-interface
title: "Obsidian Canvas as System Overview + Operational Interface"
status: frozen
priority: null
scope: framework
depends_on: [obsidian-interface]
created: 2026-04-24
started: null
completed: null
estimated_sessions: null
tags: [interface, obsidian, canvas, visualization, packages]
workstream: operator-interfaces
---

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 6. Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Goal

Use Obsidian Canvas as both a **system overview** (visual topology of the org and its federation) and an **operational interface** (click a node → open/edit/act on it). One canvas per scope (org-level, federation-level, workstream-level).

## Why

Text-based dashboards (the `/initialize` output) are dense. A canvas makes it obvious:
- How instances federate.
- Which workstreams have which plans.
- Where skills live across the matrix.
- What's drifted vs in-sync.

Operators collaborate better pointing at a shared picture than reading lists.

## Output shape (proposal)

A new framework package: **`packages/obsidian-canvas/`** — contains:
- **Generator scripts** that read `data/*.yaml` and emit `.canvas` JSON files (Obsidian's native canvas format).
- **Canvas templates**:
  - `federation-overview.canvas` — this instance + all federated peers and downstream, with trust/sync arrows.
  - `workstream-map.canvas` — each workstream as a node, with child plans, status-colored.
  - `skills-matrix.canvas` — skills as nodes, instances as lanes, promotion candidates highlighted.
  - `instance-health.canvas` — one per downstream instance, showing drift sources.
- **Round-trip editability** — if an operator moves/edits nodes, changes write back where safe (notes/memory), read-only where not (generated layouts).
- **Auto-regeneration** — a `npm run generate:canvas` command (and a file watcher) that refreshes canvases when underlying YAML changes.

## Open questions (to resolve before moving to queued)

1. **Regenerate vs preserve layout** — Canvas nodes have positions. Regenerating overwrites layout. How do we reconcile auto-generated structure with human-arranged layout? (Stable-layout algorithm? Layout metadata stored separately?)
2. **Depth limit** — federation overview could explode for a 10+ node network. Level-of-detail rules?
3. **Click-to-act** — can a canvas node trigger a slash command or skill? (Obsidian API limitation?) If not, clicking opens the underlying note, and the operator uses the note's actions.
4. **Canvas as agent input** — can the agent *read* a canvas as structured input (e.g., "user drew a line between A and B, treat that as a new relationship")?
5. **Federation: live vs snapshot** — should federation canvas pull live peer state (via federation-protocol) or work from local snapshot only?
6. **Size for print/share** — canvases get exported as images for presentations. Aspect-ratio targets?

## Related plans

- **`obsidian-interface`** (parent / dependency) — this depends on core Obsidian setup being in place.
- **`federation-protocol`** (queued) — live federation canvas needs exchange protocol to pull peer state.
- **`framework-dashboard-template`** (scoping) — overlap: both are "visual overview." Decide positioning during scoping.

## Tasks (preliminary)

- [ ] Answer open questions above
- [ ] Prototype one canvas generator (start with `workstream-map.canvas` — simplest)
- [ ] Decide layout-preservation approach
- [ ] Spec `packages/obsidian-canvas/` structure
- [ ] Build remaining generators (federation, skills, instance-health)
- [ ] Wire `npm run generate:canvas` + watcher
- [ ] Test in this repo's vault with all 5 instances visible

## Out of scope

- Web-based (non-Obsidian) system canvas — separate concern.
- Real-time multi-operator collaboration on a canvas (operators share via git, not live).
- Mermaid/Graphviz alternatives — native Canvas is the target.
