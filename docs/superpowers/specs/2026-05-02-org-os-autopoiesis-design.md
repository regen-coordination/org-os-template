---
title: org-os as a Two-Level Autopoietic System — Research Scoping
date: 2026-05-02
author: org-os
status: Phases 1–2 implemented (v0.5); Phase 3 frozen (portfolio memo row 5)
workstream: framework-evolution
related:
  - docs/agent-plans/QUEUE.md
  - docs/agent-plans/instance-bootstrap.md
  - docs/agent-plans/obsidian-interface.md
  - docs/agent-plans/federation-protocol.md
  - docs/agent-plans/system-reliability.md
  - docs/agent-plans/package-integration.md
  - docs/agent-plans/non-tech-onboarding.md
  - skills/expert-feynman/SKILL.md
  - SOUL.md
  - MASTERPLAN.md
---

# org-os as a Two-Level Autopoietic System — Research Scoping

## Problem

Several queued plans (`instance-bootstrap`, `obsidian-interface`, `federation-protocol`, `system-reliability`, `package-integration`, `non-tech-onboarding`) each address a slice of the same underlying question: **what makes an org-os instance a coherent, self-producing, self-maintaining system?** The plans address this implicitly, plan-by-plan, with no shared theoretical frame. As a result:

- Architectural decisions land in individual plans rather than a shared spine — drift between plans is likely.
- "Replication" and "overlay onto host artifacts" are treated as engineering tasks but never decomposed into mechanisms — the words are doing more work than the design.
- The framework's own evolution loop (instance learning → framework patterns → instance upgrades) is gestured at but not measured.

This research produces a coherent **theory of org-os as a two-level autopoietic system** (instance + framework), validated by one framework-level pilot, that resolves architectural decisions for the queued plans and seeds new ones where gaps surface.

## Scope

**In scope.**
- A 9-aspect × 2-level conceptual matrix (instance-primary, framework-secondary).
- One framework-level pilot that closes a cross-aspect loop end-to-end at the template/framework layer.
- Decision rollup: updates to existing plans, new plans queued where gaps surface, `DECISIONS.md` entries.

**Out of scope.**
- Implementation of any **net-new plan** queued in Phase 3 — those are handed off to the writing-plans skill. (Phase 2 *does* produce framework-level pilot artifacts inside `org-os`; that's not "implementation of a net-new plan," it's the pilot itself.)
- Maturana–Varela orthodoxy. Autopoiesis here is a working frame, not a literal claim.
- Deep formalism, philosophy paper.
- Cross-network protocol changes beyond what existing federation-protocol plan covers.

**Side effects on workspace.**
- New: `docs/superpowers/research/2026-05-02-autopoiesis/` directory with research notes.
- Updated: `docs/agent-plans/QUEUE.md`, possibly individual plan files (Phase 3).
- Possibly new `DECISIONS.md` entries.
- No `data/` changes from this research itself — those would land in the engineering plans it informs.

**Estimated effort.** 4–8 sessions across phases. Pause-able between phases. Vault-safety rules apply (`docs/VAULT-SAFETY.md`) when the pilot is exercised in the hub workspace.

## Theoretical Frame

### Unit of analysis: two levels, instance-primary

An **instance** (e.g., refi-bcn-os, refi-dao-os, refi-med-os, lf-zettelkasten-os hub) is treated as the autopoietic system. The **framework** (org-os itself) is treated as a secondary lens — captured per aspect in one paragraph, not deeply researched in this round. A follow-up pass on framework-as-autopoietic-system is queued in Phase 3 if Phase 1+2 surface enough material.

Resonance with prior art: Beer's Viable System Model (recursively viable systems — each subsystem viable in itself; framework-of-instances is the recursive case); Maturana & Varela on autopoiesis (self-production, operational closure, boundary, structural coupling, cognition); von Neumann self-replication (a constructor that reads a description of itself); Christopher Alexander's pattern languages (patterns generate, they don't dictate); Nix-style declarative reproducibility (the seed is a description); Friston's active inference (the system acts to reduce surprise — relevant to Volition).

### The 9 aspects

| # | Aspect | Instance-level question | Framework-level (light) |
|---|--------|------------------------|------------------------|
| 1 | **Genesis** | What's the minimal seed that yields a viable instance? What is "viable"? | Framework "gives birth" — fork mechanism, lineage tracking |
| 2 | **Identity & Continuity** | What persists across forks, restarts, sync upgrades? Where does "self" live? | Framework identity: what makes org-os *org-os* across versions? |
| 3 | **Membrane** | What's *in* the instance, what's not? Where's the cell wall? | Where does framework end and instance begin? |
| 4 | **Structural coupling** | How does an instance cohabit with host artifacts (existing repo, existing vault, existing tools)? Graft semantics? | Framework's coupling = relationship to standards (EIP-4824) and ecosystem |
| 5 | **Metabolism** | What flows through: sources → memory → synthesis → output? | Framework metabolism = pattern flow from instances |
| 6 | **Self-maintenance** | How does an instance stay coherent against drift, entropy, dead links? | Framework self-maintenance = its own validation, version discipline |
| 7 | **Cognition / Evolution** | How does an instance learn — promote skills, extract patterns from its own memory? | Cross-instance pattern flow; mostly framework-level — note, don't dive |
| 8 | **Federation / Multicellularity** | How does an instance behave as one cell among peers? | This *is* the framework view — note, don't dive |
| 9 | **Volition / Decision** | What does an instance decide vs. defer to operator? Boundary of agency? | Framework volition = governance of the framework itself — note, don't dive |

### Discipline: Feynman-style mechanism over name

For each aspect, "autopoietic" or "regenerative" or "federated" are *names*, not mechanisms. The cell template (below) forces the mechanism out: how does it actually work, step by step, traced through real files and scripts? What invariants must hold? What breaks?

### Cross-aspect loops to surface

Synthesis (end of Phase 1) names cross-aspect loops. Likely candidates:

- **Genesis → Metabolism → Cognition → Identity** — "instance grows into itself" loop. The pilot's primary candidate.
- **Coupling → Membrane → Self-maintenance** — "host integration" loop (where overlay-onto-X claims live).
- **Metabolism → Cognition → Federation** — "instance learning ↔ peer learning" loop (framework-touching).

Phase 2 closes one loop at the framework level. The synthesis decides which.

## Phase 1 — Conceptual research

### Cell template

Every aspect note follows the same shape:

1. **Mechanism (step by step):** how does this aspect work *today* in org-os? Trace through actual files, scripts, registries, loops. If it doesn't exist today, say so explicitly.
2. **Prior art:** ≤5 references that actually inform this aspect (only what's load-bearing — biology, VSM, Nix, von Neumann, Alexander, Friston, etc.).
3. **Invariants / failure modes:** for process-aspects (Genesis, Metabolism, Cognition, Federation, Volition), what closes the loop and what breaks it. For invariant-aspects (Identity, Membrane, Coupling, Self-maintenance), what must hold for the instance to remain itself; how does it fail?
4. **Open questions:** what we don't know yet.
5. **Existing-plan touchpoints:** which queued plans this aspect informs, contradicts, or expands. Concrete plan IDs.
6. **Framework-level note (one paragraph):** the secondary lens — captured, not expanded.

Length target: 2–4 pages per cell.

### Execution

- **Pass A — aspect notes (parallel):** dispatch 9 subagents (Explore-type, read-only). Each receives the cell template, the relevant aspect, and pointers to load-bearing files. Each writes one note. One dispatch.
- **Pass B — synthesis (single-thread):** I read all 9 notes and write `SYNTHESIS.md`. Output: cross-aspect loops surfaced, ranked by leverage; recommended Phase 2 pilot loop.

### Output

```
docs/superpowers/research/2026-05-02-autopoiesis/
├── 00-index.md         # navigation, status, cell summary
├── 01-genesis.md
├── 02-identity.md
├── 03-membrane.md
├── 04-coupling.md
├── 05-metabolism.md
├── 06-self-maintenance.md
├── 07-cognition.md
├── 08-federation.md
├── 09-volition.md
└── SYNTHESIS.md        # Phase 1 close
```

### Phase 1 gate

Operator reviews `SYNTHESIS.md`. Approves pilot loop selection (or overrides). No Phase 2 work starts before this gate.

**Phase 1 estimated effort:** 1–2 sessions.

## Phase 2 — Framework-level pilot

### Pilot target

Close one cross-aspect loop end-to-end **as a framework-level capability** — implemented in `org-os` itself (template + skills + scripts + docs), on a branch in this repo. The pilot is exercised here (org-os as both the framework being modified and the test bed for the modification) before any propagation. After Phase 2 lands, Phase 3 cascades the capability to each downstream instance via `sync:upstream`.

### Why framework-level

- **Highest leverage:** framework changes propagate to all instances via existing sync mechanism.
- **No instance-specific risk:** doesn't put a particular instance's data or identity at stake.
- **Tests framework's own evolution loop:** even though framework-level autopoiesis isn't deeply researched in Phase 1, this pilot exercises it.
- **Repeatable:** the artifact is a template upgrade, not a bespoke instance configuration.

### Default pilot loop

**Genesis → Metabolism → Cognition → Identity** (instance "grows into itself"). Highest-leverage because Genesis is the gateway aspect and the loop touches four others. Final selection in Phase 1's synthesis.

### Pilot output

- New / updated framework artifacts (scripts, skills, configs, docs) implementing the loop closure.
- `PILOT-framework.md` — postmortem: what's the minimal seed that worked, what got metabolized into what, what survived as identity, what broke, what had to be invented.
- A migration note for downstream instances (what they'll see when they next `sync:upstream`).

### Vault-safety

The pilot exercises within `org-os` (this repo). When pilot work touches the hub workspace (`lf-zettelkasten-os/`), apply `docs/VAULT-SAFETY.md` rules: snapshot before, audit after, no `git stash`/`clean`/`reset --hard` on the parent vault.

### Phase 2 gate

Operator reviews `PILOT-framework.md` and the framework artifacts. Approves before Phase 3 cascades to instances.

**Phase 2 estimated effort:** 2–4 sessions.

## Phase 3 — Decisions integration & cascade

### Goal

Turn theory + pilot into changes the engineering plans can act on, and propagate the framework-level capability to each downstream instance.

### Outputs

- **`DECISIONS.md` entries** for architectural decisions surfaced. Examples (placeholders — actual decisions emerge in Phase 1+2):
  - "Identity = SOUL + IDENTITY + lineage stamp; cryptographic identity deferred."
  - "Membrane = `data/*.yaml` + `memory/` + `skills/` + `federation.yaml`; everything else is host or workspace."
  - "Genesis seed = N files + wizard answers; everything else is generated or inherited."
- **Plan updates** — PR-style edits to each touched plan (`instance-bootstrap`, `obsidian-interface`, `federation-protocol`, `system-reliability`, `package-integration`, `non-tech-onboarding`). Each plan gets a "Findings from autopoiesis research" section pointing at the relevant aspect note(s) and decision(s).
- **New plans queued** for gaps no existing plan covers. Likely candidates (final list emerges from Phase 1+2):
  - `instance-coupling-pattern` — generalizing host-graft beyond Obsidian.
  - `identity-lineage-tracking` — provenance across forks and syncs.
  - `framework-as-autopoietic-system` — the deferred bigger pass on framework-level autopoiesis.
- **Cascade to instances** — for each downstream instance (refi-bcn-os, refi-dao-os, refi-med-os, dao-os, openclaw, regen-coordination-os), document what `sync:upstream` will deliver and any per-instance follow-up the operator needs to do.

### Hand-off

For any net-new plan queued, transition to the `superpowers:writing-plans` skill (per brainstorming flow rules). This research scoping ends with Phase 3 complete and new plans handed off, not with implementation.

**Phase 3 estimated effort:** 1 session.

## Artifacts & file plan

```
docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md         # this spec
docs/superpowers/research/2026-05-02-autopoiesis/
├── 00-index.md
├── 01-genesis.md
├── 02-identity.md
├── 03-membrane.md
├── 04-coupling.md
├── 05-metabolism.md
├── 06-self-maintenance.md
├── 07-cognition.md
├── 08-federation.md
├── 09-volition.md
├── SYNTHESIS.md                                                       # Phase 1 close
├── PILOT-framework.md                                                 # Phase 2 close
└── DECISIONS.md                                                       # Phase 3 rollup
docs/agent-plans/QUEUE.md                                              # Phase 3: new plans queued
docs/agent-plans/<existing-plans>.md                                   # Phase 3: findings sections
docs/agent-plans/<new-plans>.md                                        # Phase 3: net-new plans (via writing-plans)
```

## Verification

- **Phase 1:** all 9 aspect notes exist and pass the cell-template shape check (mechanism, prior art, invariants/failure modes, open questions, plan touchpoints, framework note). `SYNTHESIS.md` names ≥2 cross-aspect loops with leverage ranking and recommends one for pilot.
- **Phase 2:** framework artifacts implementing the chosen loop are merged or staged on a branch. `PILOT-framework.md` documents what worked, what broke, what was invented. The pilot can be exercised end-to-end on a fresh clone or sync.
- **Phase 3:** every existing plan touched has a "Findings from autopoiesis research" section. Net-new plans are queued in `QUEUE.md` and have spec docs (via writing-plans). Cascade plan to each downstream instance is documented. Operator has approved the integration before any further implementation work begins.

## Open questions

1. **Pilot loop final selection.** Default is Genesis → Metabolism → Cognition → Identity, but Phase 1's synthesis may surface a more urgent gap. Decided at Phase 1 gate.
2. **Subagent dispatch shape.** 9 parallel subagents in one dispatch — viable, but dispatch limits and result-merge cost may push toward batches of 3–4. Resolved at Phase 1 entry.
3. **Cascade discipline.** Whether instances pick up framework changes automatically via `sync:upstream` or need per-instance migration notes depends on what the pilot changes. Resolved during Phase 3 planning.
4. **Framework-as-autopoietic-system follow-up.** Whether to queue a dedicated plan for the deferred deeper pass, or absorb the framework-level material into Phase 3's `DECISIONS.md` and call it sufficient for now. Resolved at Phase 3 gate.

## Splitting criteria

If Phase 1 alone exceeds 3 sessions, split aspect notes into two batches (process-aspects first, invariant-aspects second) and gate operator review between batches.

If the pilot in Phase 2 exceeds 4 sessions or produces breaking changes for any instance, halt and convert it into a standalone implementation plan (via writing-plans) before continuing.

## Status

Spec written 2026-05-02. Awaiting operator review. Phase 1 work begins after operator approves this spec.
