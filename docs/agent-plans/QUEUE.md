# Plan Queue — org-os (framework)

> Last updated: 2026-04-25

## Active

_(none)_

## Queued (v3.6 priority order)

1. [obsidian-interface](obsidian-interface.md) — operator UX layer (was P1 candidate; promote to active for v3.6) · workstream: operator-interfaces
2. [obsidian-canvas-interface](obsidian-canvas-interface.md) — depends on obsidian-interface · workstream: operator-interfaces
3. [non-tech-onboarding](non-tech-onboarding.md) — web wrapper over the v3.5 cloning engine · workstream: non-tech-onboarding

## Scoping (deferred to v3.7+)

- [tui-dashboard](tui-dashboard.md) — Ink-based TUI (impl plan ready) · workstream: operator-interfaces
- [framework-dashboard-template](framework-dashboard-template.md) — becomes thin renderer over tui-data · workstream: v2-stabilization
- [federation-protocol](federation-protocol.md) — end-to-end federation test · workstream: federation-protocol
- [future-instance-specs](future-instance-specs.md) — for new instance types if any surface · workstream: framework-evolution

## Completed

- ~~[v2-phase1-framework](v2-phase1-framework.md)~~ — Framework standards, docs, skills, data model, session lifecycle
- ~~[versioning-system](versioning-system.md)~~ — Reconciled versioning + migrations + changelog + policy · workstream: v2-stabilization · completed 2026-04-24
- ~~[instance-bootstrap](instance-bootstrap.md)~~ — Framework cloning + wizard with package/skill selection · workstream: instance-bootstrap · completed 2026-04-25 (absorbed into v3.5)
- ~~[package-integration](package-integration.md)~~ — Audit packages/, define lifecycle, resolve consumption mechanism · workstream: package-integration · completed 2026-04-25 (absorbed into v3.5)
- ~~[system-reliability](system-reliability.md)~~ — Audit reliability infra, implement enforcement · workstream: reliability · completed 2026-04-25 (absorbed into v3.5)
- ~~v3-5-release-implementation~~ — Full v3.5.0 release execution · completed 2026-04-25
- ~~One-pager templates~~ — README.framework.md, README.instance.md, GETTING-STARTED.md, render engine · completed 2026-04-25 (absorbed into v3.5)
- ~~bread-coop-os bootstrap~~ — New instance bootstrapped via cloning engine · completed 2026-04-25 (instance is live)
