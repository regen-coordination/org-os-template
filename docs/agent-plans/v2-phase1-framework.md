---
id: v2-phase1-framework
title: "v2.0.0 Phase 1 — Framework Standards"
status: completed
priority: 0
scope: framework
depends_on: []
created: 2026-04-05
started: 2026-04-05
completed: 2026-04-06
estimated_sessions: 3
tags: [v2, framework, standards]
workstream: v2-stabilization
---

## Goal

Establish the complete org-os v2.0.0 framework — canonical file structure, data model (13 registries), agentic architecture, skill specifications, session lifecycle, and federation protocol. This is the foundation all instances build on.

## Delivered

### Docs (Layer A1, B1, C1, D1, E1)
- [x] `docs/FILE-STRUCTURE.md` — canonical directory spec
- [x] `docs/DATA-MODEL.md` — complete data model (13 registries)
- [x] `docs/AGENTIC-ARCHITECTURE.md` — agent files, bootstrapping, autoresearch
- [x] `docs/SKILL-SPECIFICATION.md` — skill authoring and sharing protocol
- [x] `docs/PACKAGES.md` — package standards and catalog
- [x] `docs/FEDERATION.md` — federation protocol spec
- [x] `docs/AGENT-MODES.md` — agent personas pattern
- [x] `docs/IDEA-HATCHING.md` — knowledge → ideas → projects pipeline
- [x] `docs/AUTORESEARCH.md` — autonomous improvement pattern
- [x] `docs/PLANS.md` — plan management convention

### Skills
- [x] `skills/org-os-init/SKILL.md` — session lifecycle (OPEN → PLAN → EXECUTE → CLOSE)
- [x] `skills/bootstrap-interviewer/SKILL.md` — guided interview for new orgs
- [x] `skills/idea-scout/SKILL.md` — knowledge-to-ideas extraction
- [x] `skills/workspace-improver/SKILL.md` — autoresearch loop

### Session Lifecycle
- [x] `scripts/initialize.mjs` — data gatherer (identity, projects, tasks, events, meetings, members, funding, memory, federation, skills, apps, git)
- [x] `.claude/commands/initialize.md` — /initialize slash command
- [x] `.claude/commands/close.md` — /close slash command
- [x] CLAUDE.md updated with session lifecycle

### Data Model
- [x] 9 new v2 data registry templates (governance, meetings, ideas, events, channels, assets, relationships, sources, knowledge-manifest)
- [x] `schema_version: "2.0"` added to all data files
- [x] `scripts/generate-all-schemas.mjs` updated (ideas, knowledge, events, proposals, activities, contracts)
- [x] 5 new `.well-known/` templates (ideas, knowledge, proposals, activities, contracts)
- [x] All `.well-known/` JSON schemas generated

### Infrastructure
- [x] `scripts/deploy-pages.mjs` — static site deployment
- [x] `scripts/validate-structure.mjs` — canonical structure validation
- [x] Removed MASTERPROMPT.md (replaced by MASTERPLAN.md)
- [x] Absorbed organizational-os content (schemas/, docs/ECOSYSTEM.md, docs/EIP4824-GUIDE.md)
