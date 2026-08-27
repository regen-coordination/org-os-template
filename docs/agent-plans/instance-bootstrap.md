---
id: instance-bootstrap
title: "Instance Bootstrap Pipeline — Clone, Wizard, Knowledge"
status: frozen
priority: 5
scope: framework
depends_on: []
created: 2026-04-25
started: null
completed: null
estimated_sessions: 4
tags: [bootstrap, onboarding, wizard, instances]
workstream: instance-bootstrap
---

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 + §6. CORRECTION: Open Question 1 is answered and shipped — scripts/clone-framework.mjs (npm run clone:framework, 4/4 tests, produced bread-coop-os). Remaining bounded question: diff-review of the 983-line variant preserved in archive/v3.5-execution. Convergence: [v0.5 release masterplan](../superpowers/plans/2026-08-28-v0.5-release-masterplan.md).

## Goal

Define and implement the end-to-end pipeline for creating a new org-os instance: cloning the framework, running the wizard (identity + package/skill selection), and bootstrapping initial knowledge with one source ingested as proof-of-pipeline. This plan is the engine; `non-tech-onboarding` becomes the web UI wrapper that calls it.

End state: from "I want to spin up a new org-os instance" to "the dashboard renders my org's identity, my selected skills/packages are present, and one real source has been ingested" — all in a single, documented flow.

## Scope Boundary

- **In scope:** framework cloning mechanism, wizard (extending `bootstrap-interviewer` with package/skill selection), one source ingested end-to-end as a demonstration
- **Out of scope:** full multi-source ingestion (delegated to existing `knowledge-curator` skill); web UI (handled by `non-tech-onboarding` which depends on this plan)

## Context

- `bootstrap-interviewer` skill covers identity / members / projects / channels — but **not** package/skill selection. Current implicit model: every new instance inherits all canonical skills and packages.
- `BOOTSTRAP.md` describes 3 phases (interview → source ingestion → ongoing) as prose, not mechanism. There is **no script today that clones the framework into a new instance directory**.
- `npm run setup` is interactive but operates on an already-cloned repo. `clone:repos` clones source repos for ingestion, not the framework itself.
- `non-tech-onboarding` plan exists in scoping for a web wizard. Per scoping decision (2026-04-25): this plan becomes the engine; `non-tech-onboarding` becomes the web wrapper. Dependency added downstream.
- `federation.yaml` has a `packages:` toggle block already — candidate storage for selection persistence.

## Open Questions

1. **Cloning mechanism** — GitHub template ("Use this template" button), `npm create org-os@latest`, in-repo `scripts/clone-framework.mjs`, or mixed paths? Different mechanisms suit different operator profiles (non-tech via GitHub UI vs. tech via CLI).
2. **Selection mechanism** — interactive prompts during the wizard, declarative `instance.config.yaml` consumed by scripts, or both?
3. **Boundary with `bootstrap-interviewer`** — extend the existing skill with the new selection step, or split into two skills (`identity-interviewer` + `selection-interviewer`)?
4. **Selection storage** — where do package/skill choices persist? Extend `federation.yaml` `packages:` block (and add a `skills:` block), or introduce a new `instance.manifest.yaml`?
5. **Cloning order** — clone first then wizard, or wizard collects answers then clone-and-populate in one shot? Affects whether the wizard runs in framework context or new-instance context.
6. **Proof-of-pipeline source** — which source type for the demonstration? Notion db, GitHub repo, or website? Each has different infrastructure costs and integration paths.
7. **Dependency on `package-integration`** — phase 2 selection touches package activation, which the parallel `package-integration` plan is also defining. Sequence dependency or share the consumption-mechanism decision?

## Rough Tasks

### Phase 1 — Cloning mechanism

- [ ] Resolve open question 1 (pick mechanism with rationale)
- [ ] Implement cloning entry point — script, npm scaffolder, or template repo config (per chosen mechanism)
- [ ] Strip framework-only artifacts from the new instance: `data/instances.yaml`, `data/skills-matrix.yaml`, `data/packages-matrix.yaml`, `docs/SKILL-PROMOTION.md`, `docs/PACKAGE-LIFECYCLE.md` (when it exists)
- [ ] Reset framework-specific markdown (e.g. `MEMORY.md` Key Decisions section, `memory/`, `HEARTBEAT.md` task list)
- [ ] Verify a fresh clone passes `npm run validate:structure` immediately

### Phase 2 — Wizard with selection

- [ ] Resolve open questions 3 + 4 (skill boundary, selection storage)
- [ ] Extend `bootstrap-interviewer` (or fork into a second skill) to ask:
  - Which canonical skills to include (default: all; opt-out per skill with rationale captured)
  - Which canonical packages to activate (default: minimal set; opt-in per package)
- [ ] Persist selections to chosen storage location
- [ ] Materialize selections: enabled skills/packages present in new instance, disabled ones absent or stubbed (depending on `package-integration` consumption mechanism)
- [ ] Update `BOOTSTRAP.md` to reflect new wizard flow
- [ ] Coordinate with `package-integration` plan on shared decisions

### Phase 3 — Knowledge bootstrap (proof-of-pipeline)

- [ ] Pick the demonstration source (open question 6)
- [ ] Implement one end-to-end ingestion path: source → wizard step asks for credentials/URL → script runs → data lands in correct registry → dashboard renders the new content
- [ ] Document the pattern for extending to additional source types
- [ ] Cross-link from `BOOTSTRAP.md` Phase 2 (existing prose) to the new concrete mechanism

## Side Effects

- `data/projects.yaml` — add `instance-bootstrap` workstream row
- `docs/agent-plans/QUEUE.md` — add to scoping section
- `docs/agent-plans/non-tech-onboarding.md` — add `depends_on: [instance-bootstrap]`; narrow scope to "web UI + GHA glue over the engine"
- `skills/bootstrap-interviewer/SKILL.md` — extended with selection step (phase 2)
- `BOOTSTRAP.md` — rewritten to point at new mechanism (phase 2/3)
- New: cloning script or template-repo configuration (phase 1)
- Potentially new: `instance.manifest.yaml` schema (if open question 4 lands there)

## Verification

- [ ] A fresh instance can be created from scratch via the chosen mechanism in < 10 minutes
- [ ] Wizard collects identity + selections; new instance contains exactly the selected skills/packages, nothing more
- [ ] One real source ingested end-to-end; new instance dashboard renders the ingested content
- [ ] Fresh instance passes `npm run validate:structure` and `npm run validate:schemas` immediately after wizard completion
- [ ] `non-tech-onboarding` web wizard (when it lands) calls the same engine and produces an equivalent instance

## Splitting Criteria

If execution exceeds 3 sessions, split into `instance-cloning`, `instance-wizard`, `instance-knowledge-bootstrap` under the same workstream.

## Coordination Notes

- **`package-integration` plan** — overlaps on phase 2 (how selected packages get materialized). Either sequence (resolve `package-integration` mechanism first) or merge that decision into phase 2 of this plan.
- **`non-tech-onboarding` plan** — downstream dependency. Update its frontmatter when this plan lands in `queued` or `active` status.
- **`bootstrap-interviewer` skill** — direct extension point in phase 2.
