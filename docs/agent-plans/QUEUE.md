# Plan Queue — org-os (framework)

> Last updated: 2026-04-25

## Active

_(none)_

## Queued

1. [tui-dashboard](tui-dashboard.md) — TUI dashboard (Ink) + agent-rendered pages, shared data layer · spec + 28-task implementation plan ([`tui-dashboard-implementation.md`](tui-dashboard-implementation.md)) ready · candidate packages `packages/tui-data/`, `packages/tui/` · workstream: operator-interfaces
2. [future-instance-specs](future-instance-specs.md) — Write specs for regen-coordination-os and regen-toolkit  ·  workstream: framework-evolution
3. [federation-protocol](federation-protocol.md) — End-to-end federation exchange testing and docs  ·  workstream: federation-protocol
4. [package-integration](package-integration.md) — Audit packages/, define lifecycle (`docs/PACKAGE-LIFECYCLE.md`), resolve consumption mechanism  ·  workstream: package-integration  ·  est. 3 sessions
5. [system-reliability](system-reliability.md) — Audit reliability infra, decide trigger layering (pre-commit / CI / scheduled), implement enforcement  ·  workstream: reliability  ·  est. 3 sessions
6. [instance-bootstrap](instance-bootstrap.md) — Framework cloning + wizard with package/skill selection + knowledge bootstrap (one source). Engine for `non-tech-onboarding` web wrapper  ·  workstream: instance-bootstrap  ·  est. 4 sessions

## Scoping

- [non-tech-onboarding](non-tech-onboarding.md) — Web wizard bootstrap + GitHub Actions backend  ·  workstream: non-tech-onboarding  ·  depends on `instance-bootstrap`
- [framework-dashboard-template](framework-dashboard-template.md) — Reusable dashboard package template  ·  workstream: v2-stabilization  ·  becomes thin renderer over `tui-data` after `tui-dashboard` lands
- [obsidian-interface](obsidian-interface.md) — Obsidian as primary operator interface (candidate package `packages/obsidian-interface/`)  ·  workstream: operator-interfaces
- [obsidian-canvas-interface](obsidian-canvas-interface.md) — Obsidian Canvas as system overview + operational interface (candidate package `packages/obsidian-canvas/`)  ·  workstream: operator-interfaces  ·  depends on `obsidian-interface`

## Completed

- ~~[v2-phase1-framework](v2-phase1-framework.md)~~ — Framework standards, docs, skills, data model, session lifecycle
- ~~[versioning-system](versioning-system.md)~~ — Reconciled versioning + migrations + changelog + policy · workstream: v2-stabilization · completed 2026-04-24
