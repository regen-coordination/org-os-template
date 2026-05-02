# Autopoiesis Research — Phase 2: Framework-Level Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close one cross-aspect loop end-to-end as a framework-level capability — implemented as artifacts in `org-os` itself (template + skills + scripts + docs) on a branch — exercised here as proof-of-pilot, with a migration note ready for the Phase 3 cascade.

**Architecture:** The pilot identifies the *closing edge* of the recommended loop (the artifact that's missing today), implements it as a framework-level addition, exercises the closed loop on a clean test bed inside this repo, and produces a postmortem.

**Tech Stack:** Node.js (scripts), Markdown (docs/skills), YAML (registries/schemas), git for versioning. TDD where the artifact is testable code.

**Spec:** `docs/superpowers/specs/2026-05-02-org-os-autopoiesis-design.md`
**Predecessor:** `2026-05-02-autopoiesis-phase1-conceptual.md` (must complete + Phase 1 gate must pass before this plan starts)

---

## Replan trigger (read first)

This plan is written assuming the **default pilot loop**: Genesis → Metabolism → Cognition → Identity. The spec marks this as the default, with final selection at the Phase 1 gate.

**If the operator selects a different loop at the Phase 1 gate**, halt this plan and replan via `superpowers:writing-plans` using `SYNTHESIS.md` as the new input. Do not attempt to retrofit this plan.

**If the default loop is confirmed but `SYNTHESIS.md` identifies a closing-edge gap that contradicts the artifacts named below**, prefer `SYNTHESIS.md`'s gap analysis. Adjust Tasks 3–6 inline before executing them — do not blindly follow this plan against the synthesis.

---

## Task 1: Setup — branch + pilot working directory

**Files:**
- Create: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md` (initial scaffold)

- [ ] **Step 1: Verify Phase 1 gate passed**

```bash
git log --oneline -20 | grep "Phase 1 complete"
test -f "docs/superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md"
```

Both must succeed. If not, halt and complete Phase 1 first.

- [ ] **Step 2: Create a working branch**

```bash
git checkout -b autopoiesis-phase2-pilot
```

The pilot's framework artifacts land here. After Phase 2 gate, the branch merges to `release/v3.5-design` (or whichever release branch is current).

- [ ] **Step 3: Vault-safety snapshot**

If working in the parent vault context (the hub), run:

```bash
npm run vault:snapshot -- "before autopoiesis Phase 2 pilot"
```

If working only in the org-os submodule (no parent vault content at risk), skip. Check `pwd` — if path contains `lf-zettelkasten-os/03 Libraries/org-os`, the parent vault is at risk; snapshot.

- [ ] **Step 4: Scaffold PILOT-framework.md**

Create `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`:

```markdown
# Autopoiesis Phase 2 Pilot — Framework Postmortem

> Branch: `autopoiesis-phase2-pilot`
> Spec: [`2026-05-02-org-os-autopoiesis-design.md`](../../specs/2026-05-02-org-os-autopoiesis-design.md)
> Synthesis: [`SYNTHESIS.md`](SYNTHESIS.md)
> Status: in progress.

## Pilot loop

(filled in Task 2)

## Closing edge identified

(filled in Task 2)

## Artifacts implemented

(filled in Tasks 3–6)

## Exercise — what we ran, what happened

(filled in Task 7)

## What worked

(filled in Task 8)

## What broke / had to be invented

(filled in Task 8)

## Migration note for downstream instances

(filled in Task 9)
```

- [ ] **Step 5: Commit setup**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: scaffold autopoiesis Phase 2 postmortem

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Read synthesis → identify the closing edge → fill PILOT-framework.md sections

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Read SYNTHESIS.md fully**

Look for:
- Recommended pilot loop (one of the cross-aspect loops named)
- The "where it breaks" entry for that loop — this names the closing edge
- The aspect notes for each aspect in the loop, to confirm

- [ ] **Step 2: Identify artifacts to build**

The closing edge will be one of three shapes:

| Shape | Artifact | Examples |
|-------|----------|----------|
| Missing script | New `scripts/<name>.mjs` | A loop trigger, a sync hook, a stamp generator |
| Missing skill | New `skills/<name>/SKILL.md` + supporting refs | A pattern-extractor skill, an identity-stamper skill |
| Missing schema/registry | New `data/<name>.yaml` + generator updates | A patterns registry, a lineage registry |

Often closure requires more than one (e.g., "skill that triggers, registry that stores"). Identify the minimal set.

- [ ] **Step 3: Fill PILOT-framework.md "Pilot loop" + "Closing edge identified" sections**

Edit the postmortem doc:

```markdown
## Pilot loop

<Loop name from SYNTHESIS.md, with arrow chain>

## Closing edge identified

<Which edge of the loop is missing today, traced through aspect notes>

**Artifacts to implement:**
- <Artifact 1: type + path + responsibility>
- <Artifact 2: ...>
```

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: identify closing edge for Phase 2 pilot loop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Tasks 3–6: Implement the closing edge (artifact-by-artifact)

> **Branch behavior:** Each artifact gets its own task, its own commit, and its own test (where the artifact is code) — TDD discipline applies. The exact number of artifacts depends on the closing edge identified in Task 2; this plan reserves Tasks 3–6 for up to four artifacts. If only one or two artifacts are needed, leave the surplus tasks unused. If more than four are needed, the closing edge is too large for one pilot — split it and replan.

For **each** artifact identified in Task 2, follow this template:

### Task 3 / 4 / 5 / 6 template

**Files:**
- Create or Modify: `<exact path from Task 2>`
- Test (if code): `tests/<exact path>.test.mjs` or equivalent

- [ ] **Step 1: Write the failing test (code artifacts only)**

If the artifact is a script or function, write a test that exercises the new behavior. Concrete shape:

```javascript
// tests/<artifact>.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { <fn> } from '../<path>';

test('<artifact> — closes the <edge> edge of the <loop> loop', () => {
  const input = { /* minimal synthetic input matching aspect note */ };
  const result = <fn>(input);
  assert.deepEqual(result.<key>, <expected>);
});
```

If the artifact is a Markdown skill or schema, skip steps 1–4 and go directly to step 5 (write the artifact) + step 6 (verification).

- [ ] **Step 2: Run the test — confirm FAIL**

```bash
node --test tests/<artifact>.test.mjs
```

Expected: FAIL (function not yet defined or wrong return value).

- [ ] **Step 3: Implement the artifact**

Write the minimal code to make the test pass. Reference the aspect notes for the correct mechanism shape. No placeholder logic — actual implementation per the synthesis recommendation.

- [ ] **Step 4: Run the test — confirm PASS**

```bash
node --test tests/<artifact>.test.mjs
```

Expected: PASS.

- [ ] **Step 5: For non-code artifacts (skill / schema / doc), write the artifact directly**

Apply the relevant standard:
- Skills: follow `docs/SKILL-SPECIFICATION.md`. Include frontmatter (name, description, etc.) and the canonical SKILL.md sections.
- Schemas: follow `docs/DATA-MODEL.md`. Add to relevant generator if needed (`scripts/generate-schemas.mjs`).
- Docs: follow the existing voice in `docs/`.

- [ ] **Step 6: Verify the artifact passes existing validators**

```bash
npm run validate:structure
npm run validate:schemas
```

Both must succeed. If a new validator is needed (e.g., the artifact introduces a new registry shape), add it to the validation script before continuing.

- [ ] **Step 7: Update PILOT-framework.md "Artifacts implemented" section**

Append a line for this artifact:

```markdown
- `<path>` — <one-line responsibility>. <test file or "no test (markdown")>.
```

- [ ] **Step 8: Commit**

```bash
git add <artifact-path> <test-path-if-any> "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: <artifact name> — <one-line what it does>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Exercise the closed loop end-to-end

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Define the test bed**

The pilot is exercised in `org-os` itself, on the `autopoiesis-phase2-pilot` branch. The test bed is:
- The framework as it now stands with the new artifacts merged on this branch.
- A minimal input that exercises the loop start-to-end (e.g., for the default Genesis → Metabolism → Cognition → Identity loop: a stub seed → ingest a stub source → trigger pattern extraction → check identity stamp).

Document the test bed in PILOT-framework.md "Exercise — what we ran, what happened":

```markdown
## Exercise — what we ran, what happened

**Test bed:** `autopoiesis-phase2-pilot` branch in `org-os`. <inputs>

**Steps run:**
1. <command 1>
2. <command 2>
3. <command 3>

**Outputs observed:**
- <observation 1>
- <observation 2>
```

- [ ] **Step 2: Run the loop**

Execute each step listed in the test bed. Capture stdout/stderr, file diffs, registry changes.

- [ ] **Step 3: Record outputs**

Append concrete observations to PILOT-framework.md. Include:
- File paths that were created/modified
- Registry rows that were added
- Errors encountered (verbatim)
- Anything surprising (unexpected behavior, output format mismatch)

- [ ] **Step 4: Confirm the loop closed**

The loop is closed if the output of the final aspect feeds back to or persists in the system in a way the next iteration could read. Specifically:
- For Genesis → Metabolism → Cognition → Identity: did the pattern extracted in Cognition end up referenced in Identity (via lineage, via skill-matrix candidate, via memory entry)?
- Document the closure evidence concretely.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: exercise closed loop end-to-end + record outputs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Postmortem — what worked, what broke, what was invented

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: Write "What worked"**

In PILOT-framework.md:

```markdown
## What worked

- <concrete claim>: <evidence from Task 7 outputs>
- <concrete claim>: <evidence>
```

Each entry must point to a specific output. No abstract praise.

- [ ] **Step 2: Write "What broke / had to be invented"**

```markdown
## What broke / had to be invented

- **<concrete failure mode>:** <what we tried, why it failed, what we changed>. Concrete file paths.
- **<invention>:** <what wasn't in the spec but emerged as needed>. Note whether this should land in `DECISIONS.md` (Phase 3).
```

- [ ] **Step 3: Identify decisions for Phase 3**

Scan the postmortem for any architectural decision implied. Note them at the bottom in a "Decisions for Phase 3 DECISIONS.md" subsection. These get rolled into Phase 3.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: postmortem — what worked, what broke, decisions for Phase 3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Migration note for downstream instances

**Files:**
- Modify: `docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md`

- [ ] **Step 1: List downstream instances and their state**

From `data/instances.yaml` and `repos.manifest.json`, identify each downstream instance (current list per HEARTBEAT: refi-bcn-os, refi-dao-os, refi-med-os, dao-os, openclaw, regen-coordination-os).

- [ ] **Step 2: Write the migration note section**

In PILOT-framework.md:

```markdown
## Migration note for downstream instances

When `sync:upstream` runs against a downstream instance, the following
will appear:

**New files:**
- <path>: <purpose>

**Modified files:**
- <path>: <what changed>

**Required follow-up per instance:**
- <step>: <what an operator must do after sync>

**Optional follow-up per instance:**
- <step>: <improvement available but not required>

**Per-instance notes:**

| Instance | Special considerations |
|----------|------------------------|
| refi-bcn-os | <e.g., already has a custom <X>; merge carefully> |
| refi-dao-os | <...> |
| refi-med-os | <fresh instance — full benefit on first sync> |
| dao-os | <...> |
| openclaw | <...> |
| regen-coordination-os | <listed in repos.manifest.json but not cloned locally — defer until cloned> |
```

Fill each cell from actual knowledge of each instance (or "no special considerations" if none).

- [ ] **Step 3: Update PILOT-framework.md status to "complete"**

Change the status line at the top of the file from `in progress` to `complete, awaiting Phase 2 gate`.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/research/2026-05-02-autopoiesis/PILOT-framework.md"
git commit -m "pilot: migration note + Phase 2 complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Phase 2 gate — present pilot to operator

**Files:** none (review-only task)

- [ ] **Step 1: Vault-safety audit**

If a snapshot was taken at Task 1 step 3:

```bash
npm run vault:audit
```

Confirm no unintended deletions in the parent vault.

- [ ] **Step 2: Present Phase 2 close summary**

To the operator, in one message:

- Path to PILOT-framework.md
- One-line summary of artifacts implemented
- One-line summary of what worked
- One-line summary of what broke / was invented
- Branch name (`autopoiesis-phase2-pilot`)
- A direct ask: "Approve the pilot for Phase 3 cascade, or request changes?"

- [ ] **Step 3: Wait for operator response**

If operator requests changes: revise pilot artifacts and/or postmortem, re-commit, re-present.

If operator approves: proceed to Phase 3 (separate plan: `2026-05-02-autopoiesis-phase3-decisions.md`).

- [ ] **Step 4: Update QUEUE.md**

Mark Phase 2 complete in `docs/agent-plans/QUEUE.md`. Commit:

```bash
git add "docs/agent-plans/QUEUE.md"
git commit -m "queue: autopoiesis Phase 2 complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

The Phase 2 branch (`autopoiesis-phase2-pilot`) merges to the release branch as part of Phase 3 cascade — not here. Phase 3 controls the cascade timing because cascade discipline is one of its decisions.

---

## Self-review checklist

- [x] Spec coverage: Phase 2 (pilot target, why framework-level, default loop, pilot output, vault-safety, Phase 2 gate) all have tasks. Replan trigger spelled out.
- [x] Placeholder scan: artifact paths and content depend on Phase 1 synthesis output — that dependency is explicit in Task 2 and the replan trigger, not hidden as TBDs. Tasks 3–6 use a template because the number/shape of artifacts is synthesis-determined.
- [x] Type consistency: PILOT-framework.md sections referenced consistently across tasks.
- [x] Vault safety: snapshot + audit included; vault-safe rules referenced where parent vault is at risk.

## Notes

- The Tasks 3–6 template repeats the same shape because that shape applies uniformly to each artifact. The repetition is intentional: each artifact-task is self-contained.
- If the closing edge needs only one artifact, Tasks 4, 5, 6 are skipped (and that's fine — they're capacity, not requirements).
- The pilot does NOT cascade to instances. That happens in Phase 3 deliberately, so Phase 3 can decide cascade timing.
