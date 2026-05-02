# Autopoiesis Research — Phase 1: Conceptual Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 9 aspect notes + a synthesis doc for the two-level autopoietic frame, applying Feynman-disciplined cell template (mechanism step-by-step, prior art, invariants/failure modes, plan touchpoints).

**Architecture:** Dispatch parallel subagents (one per aspect, read-only) to research each cell against actual files in the codebase; one synthesis pass at the end identifies cross-aspect loops and recommends the Phase 2 pilot loop.

**Tech Stack:** Markdown notes; subagent dispatch via Agent tool (Explore-type); git for versioning; vault-safe rules apply if any work touches the parent vault.

**Spec:** `docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md`

---

## Cell-research subagent prompt template (referenced by Tasks 2–10)

Each aspect note is produced by an Explore-type subagent dispatched with this base prompt + an aspect-specific block. The base prompt:

```
You are researching one aspect of org-os as an autopoietic system. The full
research spec is at:
  docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md

Your output: ONE markdown research note saved at:
  docs/superpowers/research/2026-05-02-autopoiesis/<NN-aspect>.md

Length target: 2-4 pages.

REQUIRED SHAPE — every section must be present:

1. Mechanism (step by step) — how does this aspect work TODAY in org-os?
   Trace through actual files, scripts, registries, loops. If the
   mechanism doesn't exist today, say so explicitly and describe the
   gap. Do NOT speculate about hypothetical mechanisms — describe what
   IS in the codebase. Reference exact files and line numbers.

2. Prior art — at most 5 references that ACTUALLY inform this aspect.
   Only what's load-bearing (biology, Beer's VSM, Maturana-Varela,
   von Neumann, Christopher Alexander pattern languages, Nix-style
   declarative reproducibility, Friston's active inference, etc.).
   No padding citations.

3. Invariants / failure modes —
   For PROCESS aspects (Genesis, Metabolism, Cognition, Federation,
   Volition): what closes the loop? What breaks it?
   For INVARIANT aspects (Identity, Membrane, Coupling, Self-maintenance):
   what must hold for the instance to remain itself? What violations
   break the invariant?

4. Open questions — what we don't know yet. Specific, answerable
   questions, not vague gestures.

5. Existing-plan touchpoints — concrete plan IDs from
   docs/agent-plans/QUEUE.md that this aspect informs, contradicts,
   or expands. If none, say "none."

6. Framework-level note (one paragraph) — how this aspect manifests
   when the FRAMEWORK (org-os itself, not an instance) is the unit of
   analysis. One paragraph maximum. Capture, do not expand.

Discipline (Feynman):
- Names are not mechanisms. "Autopoietic" / "regenerative" /
  "federated" describe nothing on their own. Force the mechanism out
  step by step.
- If you find yourself writing jargon, stop and explain in plain
  language.
- Prefer concrete file references over abstractions.
- If the codebase has a gap (the mechanism is gestured at but not
  implemented), that gap IS the finding — name it explicitly.

Read-only: do not modify any files outside the output note path.
```

Each aspect-specific block is provided in its own task below.

---

## Task 1: Setup — research directory + index file

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/00-index.md`

- [ ] **Step 1: Create the research directory**

```bash
mkdir -p "docs/superpowers/research/2026-05-02-autopoiesis"
```

Run from the repo root. Verify the directory exists.

- [ ] **Step 2: Write the index file**

Create `docs/superpowers/research/2026-05-02-autopoiesis/00-index.md`:

```markdown
# Autopoiesis Research — Index

> Research scoping spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)
> Phase 1 plan: [`2026-05-02-autopoiesis-phase1-conceptual.md`](../../plans/2026-05-02-autopoiesis-phase1-conceptual.md)

## Status

Phase 1 — Conceptual matrix · in progress.

## Cell notes (instance-primary, framework-secondary)

| # | Aspect | File | Status |
|---|--------|------|--------|
| 1 | Genesis | [01-genesis.md](01-genesis.md) | pending |
| 2 | Identity & Continuity | [02-identity.md](02-identity.md) | pending |
| 3 | Membrane | [03-membrane.md](03-membrane.md) | pending |
| 4 | Structural coupling | [04-coupling.md](04-coupling.md) | pending |
| 5 | Metabolism | [05-metabolism.md](05-metabolism.md) | pending |
| 6 | Self-maintenance | [06-self-maintenance.md](06-self-maintenance.md) | pending |
| 7 | Cognition / Evolution | [07-cognition.md](07-cognition.md) | pending |
| 8 | Federation / Multicellularity | [08-federation.md](08-federation.md) | pending |
| 9 | Volition / Decision | [09-volition.md](09-volition.md) | pending |

## Synthesis

[SYNTHESIS.md](SYNTHESIS.md) — pending (written after all 9 cell notes complete).

## Phase 2 / 3 outputs (later)

- `PILOT-framework.md` — Phase 2 close
- `DECISIONS.md` — Phase 3 rollup
```

- [ ] **Step 3: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: scaffold autopoiesis Phase 1 index

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Aspect note — Genesis

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/01-genesis.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

Use the base prompt above + this aspect block:

```
ASPECT: 1 — Genesis
INSTANCE-LEVEL QUESTION: What's the minimal seed that yields a viable
instance? What is "viable"?

LOAD-BEARING POINTERS — start by reading these:
- BOOTSTRAP.md
- skills/bootstrap-interviewer/SKILL.md
- skills/org-os-init/SKILL.md
- scripts/setup.mjs
- scripts/initialize.mjs
- scripts/clone-repos.mjs (if it exists)
- docs/agent-plans/instance-bootstrap.md (queued plan covering this)
- docs/FILE-STRUCTURE.md
- federation.yaml (canonical seed structure example)
- data/instances.yaml (existing instance manifest)

FRAMEWORK-LEVEL NOTE focus: how does the framework "give birth"
to an instance today? Fork mechanism, lineage tracking. One
paragraph.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/01-genesis.md
```

- [ ] **Step 2: Verify the note exists and has all 6 sections**

```bash
test -f "docs/superpowers/research/2026-05-02-autopoiesis/01-genesis.md" && \
  grep -E "^## (Mechanism|Prior art|Invariants|Open questions|Existing-plan touchpoints|Framework-level note)" \
  "docs/superpowers/research/2026-05-02-autopoiesis/01-genesis.md" | wc -l
```

Expected: `6` (six section headings present). If <6, dispatch a second subagent with the missing-section names called out.

- [ ] **Step 3: Update index status**

Edit `docs/superpowers/research/2026-05-02-autopoiesis/00-index.md`: change Genesis row's `Status` column from `pending` to `done`.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/01-genesis.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 1 — Genesis

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Aspect note — Identity & Continuity

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

Use the base prompt + this aspect block:

```
ASPECT: 2 — Identity & Continuity
INSTANCE-LEVEL QUESTION: What persists across forks, restarts, sync
upgrades? Where does "self" live?

LOAD-BEARING POINTERS — start by reading these:
- SOUL.md
- IDENTITY.md
- MEMORY.md
- memory/ (recent entries)
- federation.yaml (identity block, if present)
- data/instances.yaml
- scripts/version-update.mjs (if it exists) — versioning discipline
- CHANGELOG.md
- docs/superpowers/specs/2026-04-25-org-os-3-5-release-design.md
  (recent identity-touching design)

This is an INVARIANT aspect — frame "what must hold" rather than
"what triggers what."

FRAMEWORK-LEVEL NOTE focus: what makes org-os *org-os* across
versions, across forks? What's the invariant of framework identity?
One paragraph.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md
```

- [ ] **Step 2: Verify**

```bash
test -f "docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md" && \
  grep -E "^## (Mechanism|Prior art|Invariants|Open questions|Existing-plan touchpoints|Framework-level note)" \
  "docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md" | wc -l
```

Expected: `6`.

- [ ] **Step 3: Update index status to `done` for Identity row.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 2 — Identity & Continuity

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Aspect note — Membrane

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/03-membrane.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 3 — Membrane
INSTANCE-LEVEL QUESTION: What's *in* the instance, what's not?
Where's the cell wall?

LOAD-BEARING POINTERS:
- docs/FILE-STRUCTURE.md (the canonical directory spec)
- docs/DATA-MODEL.md (registries)
- federation.yaml (declares peers, members, packages)
- data/instances.yaml
- data/members.yaml
- data/skills-matrix.yaml
- skills/ (the canonical skills directory)
- packages/ (the canonical packages directory)
- scripts/validate-structure.mjs
- .well-known/ (machine-readable surface)
- .gitignore (what's deliberately excluded)

This is an INVARIANT aspect. Frame: what's in-membrane, what's
outside (host workspace, external services), what's the boundary
file? Schemas as cell wall. Validation as immune system.

FRAMEWORK-LEVEL NOTE focus: where does framework end and instance
begin? What's framework-only (e.g., data/instances.yaml,
data/skills-matrix.yaml) and what's instance-canonical?

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/03-membrane.md
```

- [ ] **Step 2: Verify shape (6 sections).**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/03-membrane.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 3 — Membrane

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Aspect note — Structural coupling

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/04-coupling.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 4 — Structural coupling
INSTANCE-LEVEL QUESTION: How does an instance cohabit with host
artifacts (existing repo, existing vault, existing tools)? Graft
semantics? What survives, what's overwritten, what does the host
learn back?

LOAD-BEARING POINTERS:
- docs/agent-plans/obsidian-interface.md (canonical host-graft case
  scoping)
- docs/agent-plans/obsidian-canvas-interface.md
- docs/agent-plans/multica-integration.md (or .superpowers spec
  2026-04-25-multica-integration-design.md)
- packages/ (existing package candidates that interface with hosts)
- federation.yaml (declares external peers — a coupling surface)
- data/integrations.yaml (if exists)
- the parent vault structure, if visible
  (lf-zettelkasten-os — Obsidian vault hosting org-os as submodule
  is itself a coupling case)

This is an INVARIANT aspect (boundary semantics). Frame: what
hosts has org-os been grafted onto? What's the graft surface in
each case? What's bidirectional vs. one-way?

This is where the user's "overlay onto existing projects / KBs"
claim lands. Generalize beyond the specific Obsidian case.

FRAMEWORK-LEVEL NOTE focus: framework's coupling = its relationship
to standards (EIP-4824, DAOIP-5) and ecosystem.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/04-coupling.md
```

- [ ] **Step 2: Verify shape.**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/04-coupling.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 4 — Structural coupling

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Aspect note — Metabolism

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/05-metabolism.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 5 — Metabolism
INSTANCE-LEVEL QUESTION: What flows through: sources → memory →
synthesis → output (decisions, publications, schemas)? What does
the system "eat," "digest," "excrete"?

LOAD-BEARING POINTERS:
- skills/knowledge-curator/SKILL.md (if it exists)
- skills/meeting-processor/SKILL.md (if it exists)
- skills/idea-scout/SKILL.md (if it exists)
- memory/ directory layout + a few recent entries
- data/sources.yaml (if exists)
- data/decisions.yaml or DECISIONS.md
- HEARTBEAT.md (active metabolism layer)
- scripts/generate-schemas.mjs (output side — schemas excreted
  from data)
- repos.manifest.json (clone-repos input — sources)

This is a PROCESS aspect. Trace the loop step by step:
sources discovered → ingested into a registry → processed in
memory → synthesized into pattern/decision/output → emitted
(schemas, publications, meeting notes, plan docs).

Look for breaks in the loop — places where "sources" becomes
"memory" but never reaches "output," or vice versa.

FRAMEWORK-LEVEL NOTE focus: framework metabolism = pattern flow
from instances back to framework (skill promotion, package
promotion). Where does that flow live in the codebase?

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/05-metabolism.md
```

- [ ] **Step 2: Verify shape.**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/05-metabolism.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 5 — Metabolism

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Aspect note — Self-maintenance

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/06-self-maintenance.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 6 — Self-maintenance
INSTANCE-LEVEL QUESTION: How does an instance stay coherent
against drift, entropy, dead links?

LOAD-BEARING POINTERS:
- scripts/validate-structure.mjs
- scripts/validate-schemas.mjs (or generate-schemas with validation)
- scripts/analyze-instances.mjs (if exists) — drift detection
- docs/agent-plans/system-reliability.md (queued plan covering this)
- memory/reports/ (if exists) — drift reports
- .github/workflows/ (CI as immune system)
- package.json scripts section (the maintenance vocabulary)
- skills/workspace-improver/SKILL.md (if exists)

This is an INVARIANT aspect (resistance to entropy). Frame:
what invariants does the instance check on itself? Validation
scripts, drift detection, schema regeneration. What's automated
vs. manual? What's the recovery mechanism when an invariant
breaks?

FRAMEWORK-LEVEL NOTE focus: framework's own self-maintenance —
its validation, version discipline, migration discipline.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/06-self-maintenance.md
```

- [ ] **Step 2: Verify shape.**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/06-self-maintenance.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 6 — Self-maintenance

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Aspect note — Cognition / Evolution

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/07-cognition.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 7 — Cognition / Evolution
INSTANCE-LEVEL QUESTION: How does an instance learn — promote
skills, extract patterns from its own memory, modify its own
configuration?

LOAD-BEARING POINTERS:
- docs/SKILL-PROMOTION.md (if exists)
- data/skills-matrix.yaml (promotion candidates)
- skills/ (the canonical skills, evidence of cognition output)
- skills/skill-promoter/SKILL.md (if exists)
- skills/autoresearch/SKILL.md (if exists)
- skills/workspace-improver/SKILL.md (if exists)
- memory/ (the substrate cognition operates on)
- docs/AGENTIC-ARCHITECTURE.md
- DECISIONS.md (if exists)

This is a PROCESS aspect — trace: pattern noticed in memory →
candidate skill formed → skill promotion → new behavior. Where
does this loop close today? Where does it break?

FRAMEWORK-LEVEL NOTE focus: cross-instance pattern flow. How does
the framework learn from instances? Skill promotion is
framework-level — note it, don't dive deep.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/07-cognition.md
```

- [ ] **Step 2: Verify shape.**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/07-cognition.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 7 — Cognition / Evolution

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Aspect note — Federation / Multicellularity

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/08-federation.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 8 — Federation / Multicellularity
INSTANCE-LEVEL QUESTION: How does an instance behave as one cell
among peers? Trust, knowledge routing, skill sharing, standards.

LOAD-BEARING POINTERS:
- federation.yaml
- docs/FEDERATION.md
- docs/agent-plans/federation-protocol.md (queued plan)
- .well-known/ (machine-readable federation surface)
- data/instances.yaml (population view)
- repos.manifest.json (federation peers as repos)
- scripts/sync-upstream.mjs (if exists) — the sync mechanism

This is a PROCESS aspect (peer-to-peer exchange). Trace:
peer discovery → trust establishment → knowledge exchange →
local integration. Where does the loop close? Where does it
not exist yet?

FRAMEWORK-LEVEL NOTE focus: federation IS the framework view —
the population of instances. Note, don't dive — Phase 3 may
queue a deeper pass on framework-as-autopoietic-system.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/08-federation.md
```

- [ ] **Step 2: Verify shape.**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/08-federation.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 8 — Federation / Multicellularity

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Aspect note — Volition / Decision

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/09-volition.md`

- [ ] **Step 1: Dispatch subagent (Explore-type)**

```
ASPECT: 9 — Volition / Decision
INSTANCE-LEVEL QUESTION: What does an instance decide vs. defer
to operator? Boundary of agency? Draft-and-present discipline,
HEARTBEAT autonomy boundaries, draft vs. send.

LOAD-BEARING POINTERS:
- HEARTBEAT.md (active task layer — the system's "to-do")
- AGENTS.md (agent protocol — what agents can and can't do)
- MASTERPLAN.md (autonomous vs. requires-approval boundaries)
- skills/draft-and-present/SKILL.md (if exists)
- DECISIONS.md (record of decisions made)
- skills/orchestrator/SKILL.md (if exists)
- .claude/commands/initialize.md, .claude/commands/close.md
  (decisions baked into session lifecycle)

This is a PROCESS aspect (decision flow). Trace: input arrives →
agent classifies (autonomous / draft / escalate) → action or
proposal → operator review → execution. Reference Friston's
active inference if it illuminates.

FRAMEWORK-LEVEL NOTE focus: framework volition = governance of
the framework itself. Who decides what gets promoted, retired,
breaking-changed? Note, don't dive.

OUTPUT PATH: docs/superpowers/research/2026-05-02-autopoiesis/09-volition.md
```

- [ ] **Step 2: Verify shape.**

- [ ] **Step 3: Update index status.**

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/09-volition.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis aspect 9 — Volition / Decision

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Synthesis — read all 9 notes, identify cross-aspect loops, recommend pilot

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md`

- [ ] **Step 1: Read all 9 aspect notes**

Read in order:
```
01-genesis.md, 02-identity.md, 03-membrane.md, 04-coupling.md,
05-metabolism.md, 06-self-maintenance.md, 07-cognition.md,
08-federation.md, 09-volition.md
```

While reading, hold these synthesis questions:
- Which aspects share open questions?
- Which aspects' invariants depend on other aspects' mechanisms?
- Which loops cross multiple aspects (genesis touches identity, etc.)?
- Where are the load-bearing gaps the engineering plans don't yet cover?

- [ ] **Step 2: Write SYNTHESIS.md**

The synthesis doc must contain these sections:

```markdown
# Autopoiesis Research — Synthesis (Phase 1 close)

## Cross-aspect loops

Each loop named, traced, ranked by leverage. Minimum 3, maximum 6.
Each loop entry:
- **Loop name** — one line
- **Aspects involved** — list
- **Mechanism (step by step)** — how this loop runs (or would run)
  in org-os today
- **Where it breaks** — concrete gap
- **Leverage estimate** — how much fixing this unlocks for queued
  plans (high/medium/low + rationale)

## Recommended Phase 2 pilot loop

ONE loop selected with rationale. Default candidate per spec:
Genesis → Metabolism → Cognition → Identity. State whether the
default holds or a different loop has surfaced as higher leverage.

## Cross-aspect findings

Patterns the synthesis surfaced that aren't loops:
- Aspects whose mechanisms depend on each other
- Aspects with shared open questions
- Aspects with the same plan touchpoints

## Plan touchpoints rolled up

For each existing queued plan (instance-bootstrap, obsidian-interface,
federation-protocol, system-reliability, package-integration,
non-tech-onboarding, multica-integration, skills-section, tui-dashboard),
list which aspect notes touched it. This is the input to Phase 3 plan
updates.

## Net-new gaps

Gaps surfaced that no existing plan covers. Candidates for Phase 3
new-plan queue.

## Framework-level rollup

One paragraph synthesizing the 9 framework-level notes. Identifies
material for the deferred framework-as-autopoietic-system follow-up
plan.

## Status

Phase 1 complete. Awaiting operator review at Phase 1 gate. Phase 2
work begins after operator approves the recommended pilot loop.
```

- [ ] **Step 3: Verify SYNTHESIS.md has all required sections**

```bash
grep -E "^## (Cross-aspect loops|Recommended Phase 2 pilot loop|Cross-aspect findings|Plan touchpoints rolled up|Net-new gaps|Framework-level rollup|Status)" \
  "docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md" | wc -l
```

Expected: `7`.

- [ ] **Step 4: Update index status**

In `00-index.md`: change Phase 1 status line to `Phase 1 — Conceptual matrix · awaiting operator review.` and change SYNTHESIS row to `done`.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md" \
        "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md"
git commit -m "research: autopoiesis Phase 1 synthesis — cross-aspect loops + pilot recommendation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Phase 1 gate — present synthesis to operator

**Files:** none (review-only task)

- [ ] **Step 1: Present a Phase 1 close summary**

To the operator, in one message:

- Path to SYNTHESIS.md
- One-line summary of each cross-aspect loop named
- The recommended pilot loop and rationale
- The list of net-new gaps surfaced
- A direct ask: "Approve the recommended pilot loop, override with a different loop, or request changes to the synthesis?"

- [ ] **Step 2: Wait for operator response**

If operator requests changes: revise SYNTHESIS.md, re-commit, re-present.

If operator overrides pilot loop: amend SYNTHESIS.md's "Recommended Phase 2 pilot loop" section to reflect the override + rationale, re-commit.

If operator approves: proceed. The Phase 2 plan (`2026-05-02-autopoiesis-phase2-pilot.md`) becomes ready for execution. If the approved pilot loop differs from the default in that plan, the Phase 2 plan must be replanned via writing-plans before Phase 2 starts.

- [ ] **Step 3: Update QUEUE.md**

Mark Phase 1 complete in `docs/agent-plans/QUEUE.md` (find the autopoiesis row and update its status). Commit:

```bash
git add "docs/agent-plans/QUEUE.md"
git commit -m "queue: autopoiesis Phase 1 complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist

- [x] Spec coverage: every Phase 1 element in the spec (cell template, 9 aspect notes, synthesis, gate) has a task.
- [x] Placeholder scan: no TBDs, TODOs, "implement later," "similar to Task N." Each task has a self-contained subagent prompt block.
- [x] Type consistency: file paths and naming consistent across tasks (`docs/superpowers/research/2026-05-02-autopoiesis/0X-aspect.md` form throughout).
- [x] Verification commands provided for each aspect note (6-section grep check).

## Notes on parallelism

Tasks 2–10 (the 9 aspect notes) have no inter-task dependencies — each subagent reads the codebase independently. They can be dispatched in parallel via `superpowers:dispatching-parallel-agents` if executing inline, or with subagent-driven-development one-at-a-time if the executor prefers serial review.

If parallel: dispatch all 9 in a single message; review all 9 outputs; then run Task 11.

If serial: one subagent at a time, commit after each, then Task 11.

Either is acceptable. The plan as written assumes serial for safety; in practice parallel will run faster and is the default for this kind of independent research.
