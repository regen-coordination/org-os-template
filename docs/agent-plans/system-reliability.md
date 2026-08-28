---
id: system-reliability
title: "System Reliability — Audit, Layering, Implementation"
status: frozen
priority: 4
scope: framework
depends_on: []
created: 2026-04-25
started: null
completed: null
estimated_sessions: 3
tags: [reliability, validation, ci, framework]
workstream: reliability
---

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 10; prior art exists in archive/v3.5-execution (selftest aggregator, CI workflows, pre-commit hook). Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Goal

Make system reliability a first-class framework concern. Treat the four failure modes as axes (data integrity, agent runtime correctness, federation drift, recovery) and the four trigger layers as orthogonal (manual, pre-commit, CI, scheduled). Audit what already runs, decide the layering, implement each layer. End state: every failure mode has at least one enforced trigger; recovery is a documented runbook, not a memory of who fixed what last time.

## Context

- Existing reliability infra is partial and manual: `npm run validate:schemas`, `npm run validate:structure`, `npm run analyze:instances`, plus `scripts/migrations/`. None are enforced — operator must remember to run them.
- The just-completed `versioning-system` plan introduced migrations + changelog discipline. Recovery overlaps with migrations; this plan must define the boundary.
- Federation drift accumulates undetected: `refi-dao-os` last sync 2026-03-06 (~7 weeks); `dao-os` 2026-04-02. No alert threshold defined.
- `/initialize` rendering is currently the closest thing to a smoke test, but it tolerates stubs silently — failure mode 2 (agent runtime correctness) has effectively no enforcement.

## Open Questions

1. **Trigger layering** — exactly which checks live in pre-commit vs CI vs scheduled vs manual? (Resolved by phase 2.)
2. **CI host** — GitHub Actions only, or do downstream instances also run their own pipelines?
3. **Recovery model** — backup cadence, rollback procedure, known-good checkpoint discipline. Overlaps with `versioning-system`; must define the boundary.
4. **Federation SLAs** — what's "too long" for an instance to go without sync? Currently `refi-dao-os` at 7 weeks — is that broken or dormant?
5. **Self-test surface** — does `/initialize` itself become the agent runtime smoke test (any stub render = failure), or is there a separate `npm run selftest` command?

## Rough Tasks

### Phase 1 — Audit

- [ ] Inventory every existing reliability check: `validate:schemas`, `validate:structure`, `analyze:instances`, migration scripts, any pre-commit / CI artifacts
- [ ] Map each check to one of the 4 failure modes
- [ ] Identify uncovered gaps (mode × layer combinations with no enforcement)
- [ ] Cross-check against actual recent failures in `memory/` (what broke, how was it caught, by whom)
- [ ] Write audit report to `memory/reports/reliability-audit-YYYY-MM-DD.md`

### Phase 2 — Layering decision

- [ ] For each check (existing or planned), assign trigger layer: pre-commit, CI, scheduled, or manual
- [ ] Define recovery model: backup cadence, rollback procedure, known-good checkpoint policy
- [ ] Define federation sync SLA (e.g. instances must sync within N days, alert thereafter)
- [ ] Resolve self-test surface question (Q5) — `/initialize` strict mode vs separate `npm run selftest`
- [ ] Write `docs/RELIABILITY.md` documenting the model
- [ ] Cross-link from `docs/DATA-MODEL.md` and `MASTERPLAN.md`

### Phase 3 — Implementation

- [ ] Pre-commit hooks: fast schema/structure validation (husky-style or single shell script)
- [ ] GitHub Actions workflow `.github/workflows/validate.yml`: full validator suite on push/PR
- [ ] Scheduled GitHub Actions workflow: weekly `analyze:instances` + drift report committed to `memory/reports/`
- [ ] Recovery runbook in `docs/RELIABILITY.md`
- [ ] Self-test command per phase 2 decision
- [ ] Deliberate-break test: open a PR with bad data, confirm CI blocks it
- [ ] Propagate the CI workflow pattern into downstream instances (or document why not)

## Side Effects

- `data/projects.yaml` — add `reliability` workstream row
- `docs/agent-plans/QUEUE.md` — add to scoping section
- `docs/RELIABILITY.md` — new file (phase 2)
- `.github/workflows/*.yml` — new CI workflows (phase 3)
- `package.json` — likely new `selftest` script + dev dependency for hooks (phase 3)

## Verification

- [ ] Every failure mode covered by ≥1 trigger layer; layering explicitly documented
- [ ] CI demonstrably blocks a deliberate-break PR
- [ ] Scheduled drift report runs on cadence and writes to `memory/reports/`
- [ ] Recovery runbook tested by simulating data corruption and following the documented procedure
- [ ] Federation SLA monitor produces alerts for instances exceeding the threshold

## Splitting Criteria

If execution exceeds 3 sessions, split into `reliability-audit`, `reliability-layering`, `reliability-implementation` under the same workstream.
