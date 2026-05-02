# Autopoiesis Research — Synthesis (Phase 1 close)

> Research scoping spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)
> Cell notes: [`01-genesis.md`](01-genesis.md), [`02-identity.md`](02-identity.md), [`03-membrane.md`](03-membrane.md), [`04-coupling.md`](04-coupling.md), [`05-metabolism.md`](05-metabolism.md), [`06-self-maintenance.md`](06-self-maintenance.md), [`07-cognition.md`](07-cognition.md), [`08-federation.md`](08-federation.md), [`09-volition.md`](09-volition.md)

This synthesis names the cross-aspect loops, ranks them by leverage, recommends one for the Phase 2 pilot, and rolls up plan touchpoints + net-new gaps for Phase 3.

---

## Cross-aspect loops

A loop is a chain of aspects where each step's output is the next step's input, closing back on the first. Four loops surface across the 9 cell notes; each is named by the question it tries to answer.

### Loop A — Birth coherence ("instance becomes itself")

**Aspects:** Genesis → Identity → Membrane → Self-maintenance.

**Mechanism (would-be):** Operator triggers Genesis → scaffold drops a canonical-shape file tree + stamps identity (Name, Node ID, version triplet, lineage to framework version, optional `forked_from`) → membrane validators confirm structural shape + intra-instance referential integrity → self-maintenance keeps the membrane intact across edits/syncs/clones.

**Where it breaks today:**
- Genesis is 13 manual steps; no `scripts/scaffold-instance.mjs` ([01-genesis.md](01-genesis.md) §Mechanism). `refi-med-os` birth on 2026-04-29 is the canonical evidence.
- Identity has no `genesis_commit` / `framework_version_at_birth` field; lineage is recoverable from git log only ([02-identity.md](02-identity.md) §Open questions Q5).
- Membrane has no JSON Schema validation on `data/*.yaml`, no within-instance referential integrity check (matrix ↔ disk, members.id uniqueness, projects.lead ∈ members) ([03-membrane.md](03-membrane.md) §Invariants I7-I8; [06-self-maintenance.md](06-self-maintenance.md) §Open questions Q9).
- Self-maintenance has the phantom `validate-identity.mjs` (referenced as `validate:schemas`, file missing) — the only validator that would have run here is broken ([06-self-maintenance.md](06-self-maintenance.md) §Mechanism F3).

**Leverage:** HIGH. Closes the `instance-bootstrap` plan's load-bearing gap and gives every future instance a proper birth-stamp.

---

### Loop B — Host integration ("graft holds")

**Aspects:** Coupling → Membrane → Self-maintenance → Volition.

**Mechanism (would-be):** Instance grafts onto a host (vault, agent runtime, software repo, KB) → membrane defines what the instance owns vs. what the host owns → self-maintenance detects graft drift (host file changed under us; our coupling surface no longer applies) → volition prevents the agent from touching host content outside the declared graft surface.

**Where it breaks today:**
- Vault-safety is the only codified graft contract; no equivalent codification for agent-host or multica or generic-project couplings ([04-coupling.md](04-coupling.md) §Invariants I1).
- No `npm run coupling:list` — instance has no self-awareness of its own graft surface ([04-coupling.md](04-coupling.md) §Open questions Q5).
- Generic project-overlay (drop org-os into any repo) has no spec or implementation ([04-coupling.md](04-coupling.md) §Open questions Q6).
- Volition's classifier is implicit (LLM pattern-match) — vault-safety rules had to be added as explicit veto layer because the natural classification was wrong ([09-volition.md](09-volition.md) §Mechanism step 3 + §Failure modes).

**Leverage:** MEDIUM. Highly relevant to user's original "overlay onto existing projects/KBs" claim and to `obsidian-interface` / `multica-integration` plans, but the closing edges are several smaller artifacts (graft contracts per host class) rather than one decisive piece.

---

### Loop C — Population learning ("framework learns from instances; instances inherit") ★ recommended

**Aspects:** Metabolism → Cognition → Federation → (back to instance via Self-maintenance + Identity).

**Mechanism (would-be):** Instance metabolizes sources → memory and decisions accumulate → framework's cognition layer reads instance memories AND `skills/` directories → recurring patterns get promoted to canonical → propagation script pushes canonical changes back to instances → instance self-maintenance picks them up + stamps the new framework version into its identity record.

**Where it breaks today:**
- Cognition reads `skills/` directories (via `analyze-instances.mjs`) but does NOT read `memory/` or `DECISIONS.md` — recurring decision-shapes are invisible to discovery ([07-cognition.md](07-cognition.md) §Failure modes "Pattern recurs in memory but the noticing scope is files-on-disk only").
- The propagation script is **`scripts/sync-upstream.mjs` — referenced from 6+ places** (`package.json:20`, `validate-structure.mjs:226`, `docs/SKILL-PROMOTION.md` step 5, `docs/AGENTIC-ARCHITECTURE.md`, `docs/FEDERATION.md:135`, `docs/agent-plans/package-integration.md:57`) — **and the file does not exist**. Cited as the load-bearing gap in [02-identity.md](02-identity.md), [06-self-maintenance.md](06-self-maintenance.md), [07-cognition.md](07-cognition.md), [08-federation.md](08-federation.md). This is the single most-referenced absence in the whole research.
- No back-channel from instance to framework: `instances_using[]` is hand-maintained; no agent telemetry; no demotion automation despite `SKILL-PROMOTION.md` defining it ([07-cognition.md](07-cognition.md) §Failure modes "No back-channel from instance to framework").
- Federation has no auto-symmetry; `refi-med-os` is in framework's `downstream[]` and `data/instances.yaml` but absent from peers' `peers[]` lists ([08-federation.md](08-federation.md) §Failure modes "Symmetry broken").
- Identity has no lineage stamp: when an instance does sync, it loses the record of "I was on framework v3.0 yesterday, v3.5 today" ([02-identity.md](02-identity.md) §Open questions Q5).

**Leverage:** HIGHEST. Closes the most-referenced gap. Closing this single loop unblocks: skill promotion (Cognition complete), federation propagation (Federation complete), package promotion (parallel to skills), version-aware sync, lineage tracking. It also concretely addresses 5 HEARTBEAT items.

---

### Loop D — Self-direction ("the system decides what kind of system to be")

**Aspects:** Cognition → Volition → Identity.

**Mechanism (would-be):** New pattern surfaces (Cognition) → system decides whether to adopt, with what scope (Volition) → adoption changes what the system *is* (Identity, governance fields, network role).

**Where it breaks today:**
- Volition's classifier is implicit; SOUL-level vetoes vs. Safety-Policy-level approvals live in different files with different escalation semantics, separation is real but unwritten ([09-volition.md](09-volition.md) §Open questions Q6).
- Policy versioning doesn't pin model behavior — same boundary text reads differently to different model versions ([09-volition.md](09-volition.md) §Failure modes "Classification is implicit, so it drifts with the model").
- Identity has no governance fields populated; `IDENTITY.md` shows `N/A (solo phase)` for everything on-chain; trajectory triggers (solo→OSS→DAO) defined but not mechanized.

**Leverage:** LOW for now. Becomes important once federation has scale (10+ instances) or governance transitions activate. Out of scope for the Phase 2 pilot; track as deferred.

---

## Recommended Phase 2 pilot loop

**Loop C — Population learning, closing the cascade edge.**

This overrides the spec's default (Loop A: Genesis → Metabolism → Cognition → Identity) for two reasons drawn from the research:

1. **The most acute, most-referenced gap across all 9 cells is the missing propagation/cascade layer.** `sync-upstream.mjs` is named in 6+ documents as if it existed. Implementing it (plus its sibling `validate-identity.mjs`) closes the loop that all other plans assume is closed.

2. **Genesis (Loop A's gateway) has its own queued plan (`instance-bootstrap`).** A Phase 2 pilot that targets Genesis would compete with that plan rather than complement it. Loop C complements `instance-bootstrap`, `federation-protocol`, `package-integration`, `system-reliability`, and `versioning-system` simultaneously.

**Closing edge for the pilot:** the cascade artifacts.

- **Artifact 1:** `scripts/sync-upstream.mjs` — the propagation script. Reads `federation.yaml.customizations[].maintain_on_sync`, performs `git fetch + merge` against the framework, preserves protected paths, runs `npm run migrate` if `framework_version` advanced, runs `npm run validate:structure` on completion, writes a sync receipt to `memory/YYYY-MM-DD.md`.

- **Artifact 2:** `scripts/validate-identity.mjs` — the second phantom. The validator the framework's `validate:schemas` script promises. At minimum: validate the version triplet (already partially done by `validate-structure §8`), validate `IDENTITY.md` agrees with `federation.yaml.identity`, validate `data/instances.yaml.<row>.id` ↔ `federation.yaml.identity.name` if framework hub.

- **Artifact 3:** lineage stamp in `federation.yaml.metadata` — add `genesis_commit` (set at scaffold time, immutable thereafter) and `last_sync_commit` (updated by `sync-upstream.mjs`). One field-pair, one validator update.

These three artifacts form one coherent piece of work. They are framework-level (live in `org-os/`), benefit every downstream instance via existing sync rails (once those rails exist), and resolve the most-cited gaps in the research.

**Out of scope for this pilot** (deferred to follow-up plans):
- Memory-pattern reader (cognition-on-memory) — sketch-only in synthesis.
- Knowledge-promotion registry parallel to skills-matrix.
- Within-instance referential integrity (Loop A territory; belongs to `system-reliability` plan).
- Coupling enumeration / Loop B closures (separate pilot).

---

## Cross-aspect findings

Patterns the synthesis surfaced that aren't loops:

**1. Two phantom scripts referenced everywhere.** `validate-identity.mjs` (mentioned 4+ times) and `sync-upstream.mjs` (mentioned 6+ times) are the most cited absences. Multiple plans assume both exist. Implementing them is high-leverage prerequisite work for several queued plans.

**2. Detection ≫ Propagation.** Across Cognition, Federation, Self-maintenance, the same shape: there's a script that *detects* (`analyze-instances.mjs`, `validate-structure.mjs`, drift report writer), but the corrective loop is manual. Closing detection→propagation links is an org-os-wide pattern.

**3. The system has no self-awareness of its own grafts.** Coupling enumerates 5 live host couplings — but no `coupling:list` command, no on-disk record of "what hosts is this instance grafted onto." A self-aware autopoietic system should know its own graft surface.

**4. Memory is invisible to cognition.** Pattern extraction reads `skills/` directories but not `memory/` or `DECISIONS.md`. Recurring decision-shapes are not promotable today.

**5. Three sources of truth for federation membership.** `federation.yaml.downstream[]` (6 entries), `data/instances.yaml` (7 rows), `repos.manifest.json` (9 repos). Already drifted. Should be co-derived.

**6. Schema-on-read membrane is unusually permeable.** Malformed YAML in `data/*.yaml` passes `validate:structure` (file exists) and silently drops rows in `generate:schemas` (lossy projection). External `.well-known/*.json` lies about internal `data/`.

**7. Volition is implicit + LLM-version-dependent.** The classifier is "LLM reads natural-language bullets and decides." Vault-safety rules exist as explicit vetoes precisely because the natural classification was wrong. This is a fundamental architectural choice (constitution-like) that works for solo-maintainer phase but doesn't pin behavior across model versions.

**8. The framework treats itself as an instance** (per `BOOTSTRAP.md:5`, `MEMORY.md` "self-hosting inauguration 2026-04-24"). Many invariants apply both ways. This is the recursion that makes the two-level frame work.

---

## Plan touchpoints rolled up

For each existing plan in `docs/agent-plans/QUEUE.md`, the aspect notes that touched it:

| Plan | Touched by aspects | Most relevant findings |
|------|---------------------|------------------------|
| `instance-bootstrap` (queued) | 01, 02, 03, 06 | Loop A's blocker. `scaffold-instance.mjs` missing; lineage stamp; intra-instance referential integrity. |
| `non-tech-onboarding` (scoping) | 01, 09 | Genesis UX layer; volition becomes UX (greyed buttons for requires-approval). |
| `obsidian-interface` (scoping) | 03, 04 | Coupling case #1 + membrane Q3 (read-only vs. read-write). |
| `obsidian-canvas-interface` (scoping) | 04 | Coupling Q1 (regenerate vs. preserve layout); Q5 (live vs. snapshot). |
| `multica-integration` (queued, deferred) | 04, 09 | Coupling case #3 (only fully-specified host-graft); slash commands as volition entry points. |
| `federation-protocol` (queued) | 02, 03, 05, 08, 09 | Heaviest plan touchpoint. Symmetry, .well-known/ staleness, trust model, peer-to-peer sync. The plan whose execution depends most on Loop C. |
| `package-integration` (queued) | 03, 04, 07, 08 | Phase 3 (consumption mechanism) IS the membrane question for packages. Cognition mirror at package level. |
| `system-reliability` (queued) | 02, 03, 05, 06, 07, 09 | Second-heaviest touchpoint. Phantom scripts, no pre-commit, drift SLA, post-action diff review for volition failures. |
| `skills-section` (queued) | 03, 07 | Surfaces matrix-disk drift; cognition's promotion registry; useful operator-side complement to Loop C. |
| `tui-dashboard` (queued) | 05 | Different output organ for same metabolic substrate. |
| `framework-dashboard-template` (scoping) | 05 | Same. |
| `versioning-system` (completed) | 02, 06 | Already delivered version-triplet invariant (the only mechanically-enforced identity check). Sets precedent for `validate-identity.mjs`. |
| `v2-phase1-framework` (completed) | (foundation) | Substrate everything builds on. |
| `commands-consolidation` (scoping) | 09 | Slash commands as volition API. |

Phase 3 will append a "Findings from autopoiesis research" section to each touched plan with concrete decisions.

---

## Net-new gaps

Gaps surfaced that no existing plan covers. Candidates for Phase 3 new-plan queue:

1. **`cascade-mechanism` (would absorb Phase 2 pilot output)** — implement `sync-upstream.mjs` + `validate-identity.mjs` + lineage stamps. The Phase 2 pilot itself, formalized as a plan if the pilot reveals scope larger than expected. Likely coalesces with `system-reliability` Phase 3 rather than standing alone.

2. **`memory-pattern-reader` (cognition-on-memory)** — extend cognition to read `memory/YYYY-MM-DD.md` and `DECISIONS.md` for recurring decision-shapes, not just `skills/` directories. New plan, scoping, depends on `cascade-mechanism` landing first.

3. **`knowledge-promotion-registry`** — the analog to `skills-matrix.yaml` for knowledge patterns. `docs/KNOWLEDGE-INITIATION.md` describes prose pattern; no registry exists. New plan, scoping.

4. **`coupling-enumeration`** — a `npm run coupling:list` and an on-disk `coupling.yaml` recording what hosts the instance is grafted onto, with declared graft surfaces per host class. Generalizes vault-safety rules to all host classes. New plan, scoping. Addresses user's "overlay onto existing projects" claim at the framework level.

5. **`instance-coupling-pattern`** — generic project-overlay specification (drop org-os into any software project). Distinct from #4 because this is the *generic case*, not enumeration of known cases. New plan, scoping.

6. **`identity-lineage-tracking`** — the deeper identity work beyond the Phase 2 lineage stamp: fork vs. clone semantics, rename ritual, DID/`did:web` story, `genesis_commit` propagation. New plan, scoping; depends on Phase 2 landing the basic stamp first.

7. **`framework-as-autopoietic-system`** — the deferred follow-up explicitly named in the spec. After Phase 2 + 3 land, do a deeper pass treating the framework itself as the autopoietic unit. Lower priority; scoping after Phase 3.

8. **`within-instance-referential-integrity`** — could be absorbed into `system-reliability` rather than standing alone. Validates `data/skills-matrix.yaml` ↔ `skills/`, `members.id` uniqueness, `projects.lead` ∈ `members`, etc.

9. **`volition-classifier`** — explicit classification mechanism (skill-declared metadata, hook layer that intercepts tool calls, manifest of forbidden shapes). Defers because Loop D is low-leverage today. Consider for v3.x or when the framework moves toward OSS/DAO governance.

---

## Framework-level rollup

Across the 9 framework-level paragraphs, three patterns dominate:

**1. The framework is structurally coupled to standards (EIP-4824, DAOIP-5) and ecosystems (npm, GitHub, Docker, agent runtimes), not to file systems.** Each per-aspect framework-level note converges on this: the framework's "outside" is the standards bodies and the runtime ecosystem; the framework couples to them by reference, not by overlay.

**2. The framework's own identity is the canonical file structure + data model.** Strip the content from any instance and the empty shape is still recognizably org-os. The shape is the DNA; content is the cell. This is the strongest invariant in the whole research and the strongest thing the framework can claim.

**3. The framework is a partially autopoietic cell — it metabolizes skill-level outputs from its instances, but most other outputs flow downstream-only.** Skill promotion has detection automation; package promotion mirrors skill promotion (per `package-integration` plan); knowledge promotion has only prose patterns and operator judgment; decision promotion has nothing. The framework's metabolism is real for one substrate (skills) and gestured for others.

This is enough material to seed a `framework-as-autopoietic-system` follow-up plan when Phase 2+3 land — but not enough to justify pulling that follow-up into Phase 2's pilot.

---

## Status

**Phase 1 — Conceptual matrix · complete (2026-05-02). Awaiting operator review at Phase 1 gate.**

After operator approves (or overrides) the recommended pilot loop, Phase 2 begins per `docs/superpowers/plans/2026-05-02-autopoiesis-phase2-pilot.md`. If the operator picks Loop C as recommended, the Phase 2 default-loop assumption changes from `Genesis → Metabolism → Cognition → Identity` to `Metabolism → Cognition → Federation`; Phase 2 plan must be replanned via `superpowers:writing-plans` because its closing-edge artifacts differ. If the operator confirms the original spec default (Loop A), the existing Phase 2 plan applies as written.
