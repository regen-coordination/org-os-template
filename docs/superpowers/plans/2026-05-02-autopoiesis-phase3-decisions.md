# Autopoiesis Research — Phase 3: Decisions Integration & Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn theory (Phase 1) + pilot (Phase 2) into changes the engineering plans can act on, queue any net-new plans, and propagate the framework-level pilot capability to each downstream instance via `sync:upstream` (or document the per-instance follow-up where automatic sync is insufficient).

**Architecture:** Read prior-phase outputs → write `DECISIONS.md` rollup → annotate each touched engineering plan with a findings section → queue net-new plans (handed off to `superpowers:writing-plans`) → document cascade per instance → run cascade.

**Tech Stack:** Markdown (decisions, plan annotations, queue, cascade docs); git; existing `npm run sync:upstream` mechanism for cascade.

**Spec:** `docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md`
**Predecessors:** `2026-05-02-autopoiesis-phase1-conceptual.md` and `2026-05-02-autopoiesis-phase2-pilot.md` must complete + Phase 2 gate must pass before this plan starts.

---

## Task 1: Setup — verify predecessors + scaffold DECISIONS.md

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md`

- [ ] **Step 1: Verify Phase 2 gate passed**

```bash
git log --oneline -30 | grep "autopoiesis Phase 2 complete"
test -f "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
test -f "docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md"
```

All three must succeed. If not, halt and complete Phase 2 first.

- [ ] **Step 2: Scaffold DECISIONS.md**

Create `docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md`:

```markdown
# Autopoiesis Research — Decisions (Phase 3 rollup)

> Synthesis: [`SYNTHESIS.md`](SYNTHESIS.md)
> Pilot postmortem: [`PILOT-framework.md`](PILOT-framework.md)
> Spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)

This document captures architectural decisions surfaced by the
autopoiesis research. Each decision is one row: claim → rationale →
where it lands. Decisions land in one or more places: existing plans
(via the "Findings from autopoiesis research" section), `DECISIONS.md`
at the repo root (the authoritative log), or new plans queued in
`QUEUE.md`.

## Decisions

(filled in Task 2)

## Decisions deferred

(filled in Task 2 — anything that came up but is out of scope for now)
```

- [ ] **Step 3: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md"
git commit -m "phase3: scaffold autopoiesis decisions doc

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Read prior outputs → enumerate decisions → write DECISIONS.md

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md`

- [ ] **Step 1: Read all 9 aspect notes + SYNTHESIS.md + PILOT-framework.md**

While reading, capture every decision claim — explicit or implicit. A decision is anything of the form: "X is/should be Y because Z."

Sources of decisions:
- Aspect notes' "Invariants / failure modes" sections — these usually imply architectural decisions
- SYNTHESIS.md "Cross-aspect findings" — patterns that imply decisions
- PILOT-framework.md "Decisions for Phase 3" subsection (written at Phase 2 Task 8 step 3)
- PILOT-framework.md "What broke / had to be invented" — inventions are decisions

- [ ] **Step 2: Write each decision in DECISIONS.md**

Each decision uses this row format:

```markdown
### Decision: <one-line claim>

**Rationale:** <evidence trail — which aspect notes, which pilot
findings, what would break if we decided otherwise>.

**Lands in:**
- <existing plan ID>: how the plan changes (covered in Tasks 4–9)
- root `DECISIONS.md` entry: yes/no (the authoritative log lives at
  repo root; some decisions are too narrow to land there)
- new plan queued: <name + one-line scope> (covered in Task 10)

**Status:** active / deferred / rejected
```

Write all decisions out. Group by aspect or by loop, whichever is clearer.

- [ ] **Step 3: Write the "Decisions deferred" section**

Things that surfaced but are out of scope right now:

```markdown
## Decisions deferred

- <claim>: <why deferred — usually "needs more data" or "depends on
  decision X which isn't ready">
```

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md"
git commit -m "phase3: enumerate decisions from synthesis + pilot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Update repo-root DECISIONS.md (if it exists, or create)

**Files:**
- Modify or Create: `DECISIONS.md` (repo root)

- [ ] **Step 1: Check for existing root DECISIONS.md**

```bash
test -f "DECISIONS.md" && echo "exists" || echo "missing"
```

If missing, create with:

```markdown
# DECISIONS.md — Authoritative Decisions Log for org-os

This file records architectural decisions for the org-os framework.
Each entry: date, decision, rationale, who decided, where to find more.
Newer entries on top.

---
```

- [ ] **Step 2: Append decisions worth promoting**

For each decision in the research `DECISIONS.md` whose "Lands in: root DECISIONS.md entry" is `yes`, append a row at the top:

```markdown
## 2026-MM-DD — <decision claim>

**Rationale:** <one paragraph>.
**Decided by:** <operator name + agent>.
**More:** [`docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md`](docs/superpowers/research/2026-05-02-autopoiesis/DECISIONS.md), section <anchor>.

---
```

Use today's date (`date +%Y-%m-%d`) for the entry date.

- [ ] **Step 3: Commit**

```bash
git add "DECISIONS.md"
git commit -m "decisions: promote autopoiesis research findings to authoritative log

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Tasks 4–9: Annotate touched engineering plans

> Each task touches one queued plan, appending a "Findings from autopoiesis research" section pointing at the relevant aspect note(s) and decision(s). This is six tasks — one per plan. If a plan didn't surface in the research, skip its task. If a plan surfaced that's not in this list, add a task following the same template.

### Task 4: Annotate `instance-bootstrap.md`

**Files:**
- Modify: `docs/agent-plans/instance-bootstrap.md`

- [ ] **Step 1: Read the plan + identify autopoiesis findings**

Read `docs/agent-plans/instance-bootstrap.md`. Cross-reference against:
- `docs/superpowers/research/2026-05-02-autopoiesis/01-genesis.md` (Genesis aspect)
- `docs/superpowers/research/2026-05-02-autopoiesis/02-identity.md` (Identity aspect — instance-bootstrap touches identity-stamping)
- SYNTHESIS.md plan touchpoints
- DECISIONS.md entries marked as landing in `instance-bootstrap`

- [ ] **Step 2: Append a findings section at the bottom of the plan**

Append:

```markdown
## Findings from autopoiesis research (added 2026-MM-DD)

> Spec: [`2026-05-02-org-os-autopoiesis-design.md`](../superpowers/specs/2026-05-02-org-os-autopoiesis-design.md)
> Synthesis: [`SYNTHESIS.md`](../superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md)

The autopoiesis research surfaced the following implications for this plan:

**Affecting tasks:**
- <task X>: <what changes — link to specific decision>
- <task Y>: <what changes>

**New questions to resolve before execution:**
- <question>: <reference to aspect note>

**Decisions adopted:**
- <decision>: <link to entry>

**Open question status:**
- <existing open question>: now resolved by <decision>
- <existing open question>: still open
```

Replace bracketed placeholders with concrete content from the aspect notes and decisions doc. Use today's date.

- [ ] **Step 3: Commit**

```bash
git add "docs/agent-plans/instance-bootstrap.md"
git commit -m "plans: annotate instance-bootstrap with autopoiesis findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: Annotate `obsidian-interface.md`

Same shape as Task 4. Cross-reference primarily against:
- `04-coupling.md` (this plan IS a host-coupling case — should be heavily touched)
- `03-membrane.md` (where does instance end and host vault begin)

- [ ] **Step 1: Read + cross-reference.**
- [ ] **Step 2: Append findings section** with same template as Task 4.
- [ ] **Step 3: Commit**

```bash
git add "docs/agent-plans/obsidian-interface.md"
git commit -m "plans: annotate obsidian-interface with autopoiesis findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: Annotate `federation-protocol.md`

Cross-reference primarily against:
- `08-federation.md`
- `02-identity.md` (federation requires stable peer identity)

- [ ] **Step 1: Read + cross-reference.**
- [ ] **Step 2: Append findings section.**
- [ ] **Step 3: Commit**

```bash
git add "docs/agent-plans/federation-protocol.md"
git commit -m "plans: annotate federation-protocol with autopoiesis findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: Annotate `system-reliability.md`

Cross-reference primarily against:
- `06-self-maintenance.md`

- [ ] **Step 1: Read + cross-reference.**
- [ ] **Step 2: Append findings section.**
- [ ] **Step 3: Commit**

```bash
git add "docs/agent-plans/system-reliability.md"
git commit -m "plans: annotate system-reliability with autopoiesis findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8: Annotate `package-integration.md`

Cross-reference primarily against:
- `03-membrane.md` (packages are membrane-internal artifacts)
- `07-cognition.md` (package promotion is a cognition output)

- [ ] **Step 1: Read + cross-reference.**
- [ ] **Step 2: Append findings section.**
- [ ] **Step 3: Commit**

```bash
git add "docs/agent-plans/package-integration.md"
git commit -m "plans: annotate package-integration with autopoiesis findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9: Annotate `non-tech-onboarding.md`

Cross-reference primarily against:
- `01-genesis.md` (non-tech onboarding is the UX wrapper of Genesis)
- `09-volition.md` (operator-vs-agent agency at first touch)

- [ ] **Step 1: Read + cross-reference.**
- [ ] **Step 2: Append findings section.**
- [ ] **Step 3: Commit**

```bash
git add "docs/agent-plans/non-tech-onboarding.md"
git commit -m "plans: annotate non-tech-onboarding with autopoiesis findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Queue net-new plans (hand-off to writing-plans)

**Files:**
- Modify: `docs/agent-plans/QUEUE.md`
- Possibly create: `docs/agent-plans/<new-plan>.md` (one per net-new plan, via `superpowers:writing-plans`)

- [ ] **Step 1: List net-new gaps**

From `DECISIONS.md` "Lands in: new plan queued" entries, list every net-new plan candidate. Likely candidates per spec (final list emerges from research):
- `instance-coupling-pattern` — generalizing host-graft beyond Obsidian
- `identity-lineage-tracking` — provenance across forks and syncs
- `framework-as-autopoietic-system` — the deferred framework-level deeper pass

- [ ] **Step 2: For each candidate, decide: full plan now or scoping placeholder?**

| Choice | When to use |
|--------|-------------|
| Full plan via `superpowers:writing-plans` | Spec is clear from research outputs; ready to execute |
| Scoping placeholder (a sketch in `docs/agent-plans/`) | More design needed; queue at `scoping` status |
| Defer entirely | Not actionable yet; note in DECISIONS.md "Decisions deferred" |

- [ ] **Step 3: For each "full plan" candidate**

Invoke `superpowers:writing-plans` to produce the plan document. The new plan goes in `docs/agent-plans/<name>.md` as a scoping/queued plan (per existing convention, with frontmatter and an open-questions section). Each new plan is its own commit.

```bash
git add "docs/agent-plans/<new-plan>.md"
git commit -m "plan: <new-plan> — <one-line scope>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: For each "scoping placeholder" candidate**

Write a stub at `docs/agent-plans/<name>.md` following the existing scoping-plan format (e.g., look at `obsidian-interface.md` as a template — frontmatter + Goal + Why + Open questions + Tasks (preliminary)). Don't pad — a stub with five real open questions is better than a fake-detailed plan.

- [ ] **Step 5: Update `docs/agent-plans/QUEUE.md`**

Add each net-new plan under "Queued" or "Scoping" in QUEUE.md. Reference the spec date so the lineage is visible:

```markdown
- [<name>](<name>.md) — <one-line scope> · workstream: framework-evolution · spawned by autopoiesis research 2026-05-02
```

Commit:

```bash
git add "docs/agent-plans/QUEUE.md"
git commit -m "queue: add net-new plans from autopoiesis research

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Document cascade per instance

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/CASCADE.md`

- [ ] **Step 1: List downstream instances and their state**

From `data/instances.yaml`, `repos.manifest.json`, and `federation.yaml downstream:`, identify each instance and note:
- Path (local path if cloned, repo URL if not)
- Sync status (last `sync:upstream`)
- Special considerations (e.g., refi-med-os is fresh; regen-coordination-os not yet cloned locally)

- [ ] **Step 2: Write CASCADE.md**

Create `docs/superpowers/research/2026-05-02-autopoiesis/CASCADE.md`:

```markdown
# Autopoiesis Phase 3 — Cascade to Instances

> Pilot artifacts: see [`PILOT-framework.md`](PILOT-framework.md)
> Decisions: see [`DECISIONS.md`](DECISIONS.md)

## Cascade strategy

(filled in step 3 below)

## Per-instance plan

| Instance | Path | Sync mechanism | Required follow-up | Optional follow-up |
|----------|------|----------------|-------------------|---------------------|
| refi-bcn-os | <path> | `npm run sync:upstream` | <steps> | <steps> |
| refi-dao-os | ... | ... | ... | ... |
| refi-med-os | ... | ... | ... | ... |
| dao-os | ... | ... | ... | ... |
| openclaw | ... | ... | ... | ... |
| regen-coordination-os | (not cloned) | clone first, then sync | ... | ... |

## Execution log

(filled in Task 12)
```

- [ ] **Step 3: Write the cascade strategy section**

Decide and document:
- Are instance maintainers notified, or does the operator run sync against each? (Probably the latter for now.)
- Cascade order (priority instances first, fresh instances next, dormant last)
- Rollback plan if an instance breaks after sync

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/CASCADE.md"
git commit -m "phase3: document cascade plan per instance

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Execute cascade (or document deferred cascade)

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/CASCADE.md` (execution log)

- [ ] **Step 1: Operator decision — execute now, or defer?**

Cascading touches 6 instances and is itself a non-trivial operation. Present to operator: "Execute cascade now, or defer to a follow-up session?"

- If defer: skip steps 2–3, jump to step 4 (defer log).
- If execute now: continue.

- [ ] **Step 2: Execute cascade per instance**

For each instance in CASCADE.md "Per-instance plan":
1. `cd` into the instance path.
2. Vault-safety snapshot if the instance is a vault (it shouldn't be — instances live under hub's `03 Libraries/` — but the hub itself is a vault).
3. Run `npm run sync:upstream`.
4. Run validators: `npm run validate:structure && npm run validate:schemas`.
5. Capture output in CASCADE.md "Execution log" section.
6. If the instance breaks, halt cascade, document the break, present to operator.

- [ ] **Step 3: Mark each instance as cascaded**

In CASCADE.md "Per-instance plan" table, add a column "Cascaded?" with the date or `deferred`.

- [ ] **Step 4: Defer log (if deferring)**

Add to CASCADE.md:

```markdown
## Deferred cascade

Cascade not run in this session. Reason: <e.g., "operator chose to
review pilot artifacts further before propagating"; "low-priority
instances first">.

Resume by running: <command>.
Owner: <operator>.
Target date: <date or "next session">.
```

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/CASCADE.md"
git commit -m "phase3: cascade $(date +%Y-%m-%d) — <executed | deferred>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Phase 3 gate — present rollup to operator + close research

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/00-index.md` (status)
- Modify: `docs/agent-plans/QUEUE.md` (autopoiesis row → completed)

- [ ] **Step 1: Update 00-index.md status**

Change top status line to:

```markdown
## Status

Phase 3 — Decisions integration & cascade · **complete** (cascade
$(executed|deferred) on $(date)).
```

- [ ] **Step 2: Move the autopoiesis row in QUEUE.md to "Completed"**

Move from "Queued" / "In progress" to the "Completed" section:

```markdown
- ~~autopoiesis-research~~ — Two-level autopoietic frame for org-os.
  Spec + 3 phase plans + 9 aspect notes + synthesis + pilot + decisions
  + cascade. Spec: [`2026-05-02-org-os-autopoiesis-design.md`](...)
  · workstream: framework-evolution · completed YYYY-MM-DD
```

- [ ] **Step 3: Present Phase 3 close summary to operator**

In one message:

- Path to DECISIONS.md, PILOT-framework.md, CASCADE.md
- One-line summary of decisions adopted
- One-line summary of net-new plans queued
- Cascade status (executed or deferred)
- Branch status (autopoiesis-phase2-pilot — merged or pending)
- Direct ask: "Approve research close, or request follow-ups?"

- [ ] **Step 4: Wait for operator response**

If approved:
- Merge `autopoiesis-phase2-pilot` to release branch (or whichever target the operator names).
- Commit final QUEUE + index updates.

If follow-ups requested:
- Capture each follow-up as either a task in this plan (added inline) or a new plan (queue it).

- [ ] **Step 5: Final commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/00-index.md" \
        "docs/agent-plans/QUEUE.md"
git commit -m "research: autopoiesis Phase 3 complete — research closed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist

- [x] Spec coverage: Phase 3 (DECISIONS.md, plan updates, new plans queued, cascade) all have tasks.
- [x] Placeholder scan: bracketed placeholders are explicit content slots filled from real prior-phase outputs (synthesis, pilot postmortem) — not lazy TBDs. The plan structure works for any synthesis output.
- [x] Type consistency: file names and task numbers consistent throughout.
- [x] Cascade discipline: explicit operator decision point in Task 12 (execute now vs. defer); per-instance steps include validation; rollback path noted.

## Notes

- Tasks 4–9 are six near-identical task structures (one per touched plan). Reading them sequentially feels repetitive, but each task is self-contained — an executor working out of order can pick any one without context.
- Net-new plans (Task 10) are queued via this plan but **implemented via separate plans** (each via `superpowers:writing-plans`). This plan doesn't implement them — it queues them and stops.
- The cascade in Task 12 is the only operation in this plan that touches downstream instances. Treat it with care; operator-confirmed before execution.
