# HEARTBEAT.md — Active Monitoring

_Living checklist of active tasks and system health. Agents consult on every session. Update regularly — mark done, add new, remove stale._

---

## Active Tasks

### Technical
- [ ] Execute `multica-integration` plan (25 tasks, spec + plan ready, execution deferred 2026-04-25 — recommend fresh worktree)
- [ ] Complete `federation-protocol` end-to-end sync test (queued plan)
- [ ] Write `future-instance-specs` for regen-coordination-os and regen-toolkit (queued plan)
- [ ] Activate `package-integration` plan phase 1 — inventory audit of `packages/` (queued plan; multica-integration is its pilot)
- [ ] Activate `system-reliability` plan phase 1 — inventory existing reliability infra (queued plan)
- [ ] Activate `instance-bootstrap` plan phase 1 — resolve cloning mechanism open question (queued plan)
- [ ] Finalize `non-tech-onboarding` scoping — narrowed to web UI + GHA glue over `instance-bootstrap` engine (scoping plan)
- [ ] Finalize `framework-dashboard-template` scoping — reusable dashboard package (scoping plan)
- [ ] Finalize `obsidian-interface` scoping — Obsidian as primary operator interface (scoping plan)
- [ ] Finalize `obsidian-canvas-interface` scoping — Canvas as system overview + interface (scoping plan, depends on `obsidian-interface`)
- [ ] Run `npm run generate:schemas` after any `data/` edit

### Orchestration (multi-instance)
- [ ] Weekly: run `npm run analyze:instances` and review drift report
- [ ] Review skill-promotion candidates (see `data/skills-matrix.yaml` where `promotion_status: candidate`)
  - `research` — present in refi-bcn-os and refi-dao-os; promote to framework
  - `safe-treasury`, `hats-governance`, `gardens-governance`, `karma-reputation`, `eip4824-identity` — DAO modules in dao-os; evaluate for framework
- [ ] Resolve `regen-coordination-os` locally — listed in `repos.manifest.json` but not cloned
- [ ] Reconcile `federation.yaml` `agent.skills` with actual `skills/` directory (was listing 6; actual is 10)

### Funding
- N/A (solo phase — no treasury, no active funding applications)

### Governance
- N/A (solo phase — solo-maintainer decision model)

### Operations
- N/A (solo phase — no formal meetings)

---

## System Health

### Agent Runtime
- [x] Verify `/initialize` renders real content (no stub placeholders) — verified 2026-04-25
- [x] Verify `scripts/initialize.mjs` emits valid JSON with populated registries — verified 2026-04-25

### Data Integrity
- [ ] `data/members.yaml` is up to date
- [ ] `data/projects.yaml` reflects current workstreams
- [ ] `data/instances.yaml` reflects current instance state (update after any framework change affecting instances)
- [ ] `.well-known/*.json` matches current `data/`

### Federation
- [ ] `federation.yaml` `downstream` lists all 5 known instances
- [ ] Instance sync review performed in last 7 days (`memory/reports/instances-drift-*.md`)

### Release
- [ ] Push `v3.0.0` tag to origin when publishing publicly (currently local only)
- [ ] Edit `CHANGELOG.md` `[Unreleased]` stub before the next `npm run version:update`
- [ ] Apply `v2-to-v3` migration to each downstream instance on their next sync session

---

## Reminders

- [ ] After any `data/` change → `npm run generate:schemas && npm run validate:schemas`
- [ ] After any `federation.yaml` change → `npm run validate:structure`
- [ ] Log key decisions to `DECISIONS.md` (authoritative decisions log)
- [ ] Write detailed session notes to `memory/YYYY-MM-DD.md`

---

## Recently Completed

_(Move completed items here with date — keep for 30 days then remove)_

- [2026-04-25] Three new workstreams scoped and queued — `package-integration`, `reliability`, `instance-bootstrap` (see `memory/2026-04-25.md` and DECISIONS entries)
- [2026-04-25] Verified `/initialize` renders real content (no stubs) and `scripts/initialize.mjs` emits valid JSON
- [2026-04-24] Versioning system — policy, CHANGELOG, migrations, version-consistency validator, v3.0.0 bump (see `docs/agent-plans/versioning-system.md`)
- [2026-04-24] Self-hosting inauguration — stubs filled, instance registry introduced, all 5 instances mapped
- [2026-04-06] v2.0.0 Phase 1 framework — docs, skills, data model, session lifecycle (see `docs/agent-plans/v2-phase1-framework.md`)

---

_Last updated: 2026-04-25_
