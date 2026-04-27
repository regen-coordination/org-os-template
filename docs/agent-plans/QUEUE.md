# Plan Queue — org-os (framework)

> Last updated: 2026-04-27 (skills-section spec + plan added)

## Active

_(none)_

## Queued

1. **skills-section** — Dashboard Skills section + `/skills` command + generated `SKILLS.md` + `.well-known/skills.json` so operators can verify skills are loaded across workspace, user, and plugin sources. Spec: [`2026-04-27-skills-section-design.md`](../superpowers/specs/2026-04-27-skills-section-design.md) · 21-task plan: [`2026-04-27-skills-section.md`](../superpowers/plans/2026-04-27-skills-section.md) · workstream: operator-interfaces · TDD-driven, low-risk
2. **multica-integration** — Wire Multica (github.com/multica-ai/multica) as primary agent runtime; self-hosted server, slash commands, write-only HEARTBEAT bridge. Spec: [`2026-04-25-multica-integration-design.md`](../superpowers/specs/2026-04-25-multica-integration-design.md) · 25-task plan: [`2026-04-25-multica-integration.md`](../superpowers/plans/2026-04-25-multica-integration.md) · pilot for `package-integration` Phase 3 · workstream: package-integration · execution deferred 2026-04-25
2. [tui-dashboard](tui-dashboard.md) — TUI dashboard (Ink) + agent-rendered pages, shared data layer · spec + 28-task implementation plan ([`tui-dashboard-implementation.md`](tui-dashboard-implementation.md)) ready · candidate packages `packages/tui-data/`, `packages/tui/` · workstream: operator-interfaces
3. [future-instance-specs](future-instance-specs.md) — Write specs for regen-coordination-os and regen-toolkit  ·  workstream: framework-evolution
4. [federation-protocol](federation-protocol.md) — End-to-end federation exchange testing and docs  ·  workstream: federation-protocol
5. [package-integration](package-integration.md) — Audit packages/, define lifecycle (`docs/PACKAGE-LIFECYCLE.md`), resolve consumption mechanism  ·  workstream: package-integration  ·  est. 3 sessions  ·  parent of multica-integration
6. [system-reliability](system-reliability.md) — Audit reliability infra, decide trigger layering (pre-commit / CI / scheduled), implement enforcement  ·  workstream: reliability  ·  est. 3 sessions
7. [instance-bootstrap](instance-bootstrap.md) — Framework cloning + wizard with package/skill selection + knowledge bootstrap (one source). Engine for `non-tech-onboarding` web wrapper  ·  workstream: instance-bootstrap  ·  est. 4 sessions

## Scoping

- **commands-consolidation** — Document and consolidate `.claude/commands/`: inventory across instances, decide canonical set, build a `/commands` listing surface (dashboard section + `COMMANDS.md` + slash command), mirror the skills-section pattern · workstream: operator-interfaces · follow-up to `skills-section`
- [non-tech-onboarding](non-tech-onboarding.md) — Web wizard bootstrap + GitHub Actions backend  ·  workstream: non-tech-onboarding  ·  depends on `instance-bootstrap`
- [framework-dashboard-template](framework-dashboard-template.md) — Reusable dashboard package template  ·  workstream: v2-stabilization  ·  becomes thin renderer over `tui-data` after `tui-dashboard` lands
- [obsidian-interface](obsidian-interface.md) — Obsidian as primary operator interface (candidate package `packages/obsidian-interface/`)  ·  workstream: operator-interfaces
- [obsidian-canvas-interface](obsidian-canvas-interface.md) — Obsidian Canvas as system overview + operational interface (candidate package `packages/obsidian-canvas/`)  ·  workstream: operator-interfaces  ·  depends on `obsidian-interface`

## Completed

- ~~[v2-phase1-framework](v2-phase1-framework.md)~~ — Framework standards, docs, skills, data model, session lifecycle
- ~~[versioning-system](versioning-system.md)~~ — Reconciled versioning + migrations + changelog + policy · workstream: v2-stabilization · completed 2026-04-24
