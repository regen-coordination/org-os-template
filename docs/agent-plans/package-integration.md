---
id: package-integration
title: "Package Integration — Audit, Lifecycle, Consumption Mechanism"
status: frozen
priority: 3
scope: framework
depends_on: []
created: 2026-04-25
started: null
completed: null
estimated_sessions: 3
tags: [packages, framework, lifecycle]
workstream: package-integration
---

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 9. Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Goal

Treat packages as a first-class framework concern, mirroring how skills are already handled. Audit what exists in `packages/`, define the lifecycle (promotion + retirement), and decide how instances consume packages from the framework. End state: a clear, documented pipeline so any new package follows the same path skills do today, and any instance knows exactly how to turn a framework package on.

## Context

- `packages-matrix.yaml` exists as a framework-only registry but has no governing doc. Many entries show `instances_using: []` — unclear if dormant, planned, or abandoned.
- `docs/SKILL-PROMOTION.md` defines the skill pipeline. There is no equivalent for packages.
- `federation.yaml` already has a `packages:` toggle block, but the activation mechanism is undefined — flipping a flag does not currently materialize the package in an instance.
- `dashboard` is the highest-confidence package promotion candidate (used by both production instances) and has its own scoping plan (`framework-dashboard-template`). This plan should produce the rails it rides on.

## Open Questions

1. **Consumption mechanism** — toggle-driven activation, published npm, vendored copies, or mixed? (Resolving this is the load-bearing decision of phase 3.)
2. **Versioning** — do packages version independently, or pinned to framework releases?
3. **Ownership transfer** — when an instance-originated package gets promoted, who owns subsequent edits — framework or originating instance?
4. **Retirement criteria** — when do framework packages with `instances_using: []` get retired vs. kept as dormant scaffolding?
5. **Boundary with skills** — some candidates (e.g. governance) overlap with skill candidates (DAO modules). Which layer wins, or do they coexist?

## Rough Tasks

### Phase 1 — Inventory audit

- [ ] Walk every package in `packages-matrix.yaml`; classify each as `active`, `dormant`, `planned`, or `retired`
- [ ] Verify `instances_using` against actual instance manifests (cross-check with `data/instances.yaml` and per-instance federation configs)
- [ ] Retire / move dormant packages out of `packages/` if abandoned
- [ ] Add `lifecycle_status` field to `packages-matrix.yaml` schema; populate
- [ ] Write audit report to `memory/reports/packages-audit-YYYY-MM-DD.md`

### Phase 2 — Lifecycle doc

- [ ] Write `docs/PACKAGE-LIFECYCLE.md` mirroring `SKILL-PROMOTION.md` in structure but broader: covers promotion, integration, retirement
- [ ] Define promotion criteria (≥2 instances, parity with skill criteria)
- [ ] Define retirement criteria (zero instances using, N months dormant)
- [ ] Cross-link from `docs/DATA-MODEL.md` (Framework-only registries section)
- [ ] Update `dashboard.yaml` description for the Package Promotion Candidates custom section to reference the new doc

### Phase 3 — Integration mechanism

- [ ] Resolve open question 1 (decide A/B/C/D consumption mechanism with rationale)
- [ ] Implement the chosen mechanism — extend `scripts/sync:upstream` or add a dedicated `scripts/sync:packages.mjs`
- [ ] Update `federation.yaml` `packages:` block schema if the chosen mechanism needs more than booleans (e.g. version pins)
- [ ] Test with `dashboard` package as the first promotion-and-integration end-to-end test
- [ ] Document the mechanism in `docs/PACKAGE-LIFECYCLE.md` and `docs/FEDERATION.md`

## Side Effects

- `data/projects.yaml` — add `package-integration` workstream row
- `docs/agent-plans/QUEUE.md` — add to scoping section
- `data/packages-matrix.yaml` — schema gains `lifecycle_status` field (phase 1)
- `docs/PACKAGE-LIFECYCLE.md` — new file (phase 2)

## Verification

- [ ] Every package in `packages-matrix.yaml` has a non-null `lifecycle_status`
- [ ] `docs/PACKAGE-LIFECYCLE.md` exists and is referenced from `DATA-MODEL.md`
- [ ] `dashboard` package successfully promoted using the new mechanism
- [ ] At least one instance demonstrably consumes a framework package via the chosen mechanism

## Splitting Criteria

If this plan exceeds 3 sessions during execution, split into three plans (`package-audit`, `package-lifecycle-doc`, `package-integration-mechanism`) and re-queue under the same workstream.
