# Ship & Validate — Critique Remediation Plan

> **STATUS (2026-08-28):** Phases 0–3 + 5 and Tasks 14/16 **executed 2026-08-21** (ledger: `.superpowers/sdd/2026-08-21-ship-and-validate/progress.md` — trunk landed +292, triage round 1, positioning truthed-up, clean-room experiment, portfolio memo). The open remainder — **Task 4** (admin PR #1), **Tasks 10–12** (versioning story, deploy target, Pages), **Task 15** (pilot outreach) — is **absorbed by the [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md)** (WS-A, WS-C, WS-D, and post-release Active-2 respectively), whose operator decisions resolve this plan's gates.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between org-os's built-and-verified work and its shipped, externally-validated reality — land the trunk, deploy the site, true up the positioning claims, shrink the active portfolio, and run the first external-adoption experiment.

**Architecture:** Six phases in strict order: backup (Phase 0), trunk merge (1), branch/PR triage (2), positioning truth-up + hygiene (3), site deploy (4), portfolio kill-list (5), external validation (6). Phases 0–2 are pure git/test mechanics. Phases 3–4 are doc/site edits with drift tests. Phases 5–6 are operator-gated decisions with agent-prepared materials.

**Tech Stack:** git (vault-safe), Node ≥20, npm scripts (`selftest`, `generate:schemas`, `validate:*`), Astro 5 (`site/`), GitHub Actions (Pages deploy), `gh` CLI.

**Spec:** The Pushback critique (Berd session, 2026-08-21). Findings condensed below so the plan is self-contained.

## Findings being addressed

1. **F1 — Dogfooding presented as adoption:** all 7 "federation instances" share one operator; positioning sells this as a live network.
2. **F2 — Uniqueness verified, demand never tested:** no external org has ever attempted adoption; "first external contributor" milestone has no plan.
3. **F3 — Buyer undefined:** adoption requires git+CLI+agent fluency; the non-tech operator ladder is scoping-only.
4. **F4 — Layer-3 schemas have no named consumer** in the copy.
5. **F5 — Shipping gap:** 248 commits off main, month-old PR #1, no live site, sole-copy branch on one laptop.
6. **F6 — Portfolio indiscipline:** 13 active projects, ~10 queued plans, ≥5 operator interfaces in flight, one maintainer.
7. **F7 — Positioning drifts from repo truth:** bootstrap "acceptance-tested end-to-end" vs "cloning mechanism unresolved"; 7 vs 6 instances; 32 vs 33 vs 34 skills; three live version schemes (0.5.0 / v3.0.0 / v3.5.0 / "v5").
8. **F8 — One-liner carries three products;** the demand-validated wedge ("AI chief of staff for the org") is buried.

## Global Constraints

- **Vault safety (hard rules):** never `git stash`, never `git clean`, never `git reset --hard`. Stage explicit paths only — never `git add -A`. Run `npm run vault:snapshot -- "<reason>"` before every merge or history-affecting operation.
- **After any `data/` change:** `npm run generate:schemas && npm run validate:schemas && npm run generate:quilt`.
- **After any `federation.yaml` change:** `npm run validate:structure`.
- **External actions** (merging PR #1, enabling Pages, contacting pilot candidates) are **draft-and-present**: prepare, show the operator, act only on approval.
- **Decisions land in `DECISIONS.md`** (authoritative log), session notes in `memory/2026-08-21.md`.
- All commands run from repo root `03 Libraries/org-os/` unless a `cd` is shown.

---

## Phase 0 — Backup (no decisions, do first)

### Task 1: Push the sole-copy branches

**Files:** none (remote state only).

**Interfaces:**
- Consumes: existing local branches `feat/berd-agents` (no upstream), `autopoiesis-phase2-pilot` (ahead 30 of origin).
- Produces: both branches fully on origin; prerequisite safety for every later task.

- [ ] **Step 1: Snapshot**

```bash
npm run vault:snapshot -- "before ship-and-validate phase 0"
```

Expected: snapshot ref created, script exits 0.

- [ ] **Step 2: Push both branches**

```bash
git push -u origin feat/berd-agents
git push origin autopoiesis-phase2-pilot
```

Expected: both accepted. If the remote rejects `autopoiesis-phase2-pilot` as non-fast-forward, STOP and show the operator — do not force-push.

- [ ] **Step 3: Verify**

```bash
git branch -vv | grep -E 'berd-agents|autopoiesis'
```

Expected: both show `[origin/...]` with no `ahead` marker.

---

## Phase 1 — Land the trunk

### Task 2: Merge `main`'s graphify line into `feat/berd-agents`

**Files:**
- Modify (merge, conflicts likely): `scripts/initialize.mjs`, `.claude/commands/initialize.md`, `.claude/commands/close.md`, `package.json`, `scripts/validate-structure.mjs`, `docs/FILE-STRUCTURE.md`, `docs/AGENTIC-ARCHITECTURE.md`, `.gitignore`, `.well-known/*.json`.

**Interfaces:**
- Consumes: `main` @ `f755c32` (27 commits of graphify/knowledge-graph integration + refi-bcn-os syncs, not in the pilot line).
- Produces: `feat/berd-agents` as a strict superset of `main`, all suites green — the precondition for Task 3's `--ff-only`.

- [ ] **Step 1: Snapshot, then review what's coming in**

```bash
npm run vault:snapshot -- "before merging main into feat/berd-agents"
git log --oneline autopoiesis-phase2-pilot..main
git diff --stat feat/berd-agents...main | tail -5
```

Expected: 27 commits (graph-status/graph-gaps scripts, knowledge-graph skill, registry #14, bcn infra syncs).

- [ ] **Step 2: Merge**

```bash
git merge main --no-edit
```

Conflict resolution rules:
- `.well-known/*.json`: take **either** side, then regenerate in Step 3 — never hand-merge generated JSON.
- `docs/QUILT.md`: same — take either side, regenerate.
- `package.json` `scripts`: union of both sides (both lines only add scripts).
- `.claude/commands/{initialize,close}.md`: keep **both** additions — the pilot line's command-body changes and main's knowledge-graph bookends.
- `scripts/validate-structure.mjs`: keep both the pilot's §8b lineage check and main's v3.0-flat-manifest acceptance (`7b479a3`).
- `docs/FILE-STRUCTURE.md`: keep both the `.agents/` entry and the registry-#14 entry.

- [ ] **Step 3: Regenerate generated artifacts**

```bash
npm run generate:schemas && npm run generate:quilt
```

Expected: exit 0; regenerated files staged as part of the merge.

- [ ] **Step 4: Full verification**

```bash
npm test
npm run selftest
npm run validate:schemas && npm run validate:structure
```

Expected: all suites green. Test count ≥122 (pilot suite) plus main's graph tests. Selftest 6/6. If any graph test assumes `graphify-out/` contents, run `ls graphify-out/` first — fixtures were committed on main (`61f117e`).

- [ ] **Step 5: Commit the merge and push**

```bash
git commit --no-edit   # only if step 2 stopped on conflicts; otherwise merge already committed
git push origin feat/berd-agents
```

Expected: `git rev-list --count feat/berd-agents..main` prints `0`.

### Task 3: Fast-forward `main` and push

**Files:** none new (branch pointer + worktree update).

**Interfaces:**
- Consumes: Task 2's superset guarantee.
- Produces: `origin/main` at the full trunk tip — the base every later phase builds on.

- [ ] **Step 1: Fast-forward main in its worktree**

```bash
cd .claude/worktrees/v05-main
git merge --ff-only feat/berd-agents
```

Expected: `Fast-forward`. If it aborts on untracked-file collision, list the colliding files and show the operator — do not delete anything.

- [ ] **Step 2: Verify and push**

```bash
npm test && npm run selftest
git push origin main
cd ../../..
```

Expected: suites green in the main worktree; push accepted (includes the 22 previously-unpushed local main commits).

- [ ] **Step 3: Confirm convergence**

```bash
git rev-list --count main..feat/berd-agents
git rev-list --count feat/berd-agents..main
```

Expected: `0` and `0`.

---

## Phase 2 — Branch & PR triage

### Task 4: Refresh and land admin-app PR #1

**Files:**
- Modify (in `.worktrees/admin-app`): merge `main` in; `packages/admin/**` tests must stay green.

**Interfaces:**
- Consumes: new `main` from Task 3.
- Produces: PR #1 merged; `packages/admin/` on main — unblocks admin M2 as the single kept operator-interface investment (Task 13).

- [ ] **Step 1: Update the PR branch**

```bash
cd .worktrees/admin-app
git fetch origin
git merge origin/main --no-edit
```

Expected: merge completes (admin work is mostly additive under `packages/admin/`). Resolve conflicts by the same rules as Task 2.

- [ ] **Step 2: Run the admin suite**

```bash
npm test
```

Expected: green (44 admin tests + suite).

- [ ] **Step 3: Push and present**

```bash
git push origin feat/admin-app
gh pr view 1 --web
```

Show the operator the refreshed PR. **Gate: operator approves the merge.**

- [ ] **Step 4: Merge on approval**

```bash
gh pr merge 1 --merge
cd ../..
git -C .claude/worktrees/v05-main pull --ff-only
```

Expected: PR merged; local main updated.

### Task 5: Triage `release/v3.5-execution` (48 stray commits)

**Files:**
- Create: `memory/reports/branch-triage-2026-08-21.md`

**Interfaces:**
- Consumes: `release/v3.5-execution` @ `25197b4`.
- Produces: a salvage/archive verdict per commit, recorded; branch archived as a tag.

- [ ] **Step 1: Enumerate what only this branch has**

```bash
git log --oneline main..release/v3.5-execution
git diff --stat main...release/v3.5-execution
```

- [ ] **Step 2: Classify and write the triage report**

Write `memory/reports/branch-triage-2026-08-21.md` with one line per commit: `<sha> — <subject> — superseded | salvage | unclear`. A commit is *superseded* if its content exists on main in any form (check with `git cherry main release/v3.5-execution` — `-` prefix means already applied).

- [ ] **Step 3: Present to operator; salvage approved commits**

```bash
git cherry-pick <approved shas>   # onto a fresh branch off main: git checkout -b salvage/v3.5-execution main
npm test
```

**Gate: operator picks the salvage list.** If nothing is worth salvaging, skip.

- [ ] **Step 4: Archive the branch (tag, don't delete history)**

```bash
git tag archive/v3.5-execution release/v3.5-execution
git worktree remove .claude/worktrees/v3-5-execution
git branch -D release/v3.5-execution
git commit -m "chore(triage): archive release/v3.5-execution after salvage review" -- memory/reports/branch-triage-2026-08-21.md
```

Expected: tag exists (`git tag -l 'archive/*'`), worktree gone, report committed.

### Task 6: Archive the fully-contained branches

**Files:** none (tags + branch deletion only).

**Interfaces:**
- Consumes: Task 3's converged main.
- Produces: a branch list where everything remaining is live work.

- [ ] **Step 1: Verify containment before touching anything**

```bash
for b in feat/multica-operator v0.5 release/v3.5-design release/v3.5-docs-prep release/v3.5-templates autopoiesis-phase2-pilot agent/ORG-4 feat/knowledge-commons; do
  echo "$b: $(git rev-list --count main..$b) commits not on main"
done
```

Rule: **only** branches printing `0` may be archived. Any branch with unmerged commits gets a line in the Task 5 triage report instead.

- [ ] **Step 2: Tag and delete the contained ones**

```bash
for b in <the branches that printed 0>; do
  git tag "archive/${b//\//-}" "$b" && git branch -D "$b"
done
git worktree remove .claude/worktrees/v3-5-docs-prep    # only if its branch was archived
git worktree remove .claude/worktrees/v3-5-templates    # only if its branch was archived
```

Leave alone: `feat/rad-org-os`, `feature/kms-connector-layer`, `feature/tech-tree` (live unmerged work — they appear in the Task 13 memo instead).

- [ ] **Step 3: Verify**

```bash
git branch --list | wc -l
git worktree list
```

Expected: branch list shrunk to live work + main; no worktree points at a deleted branch.

### Task 7: Record the branch policy

**Files:**
- Modify: `DECISIONS.md` (append), `AGENTS.md` (git conventions section).

**Interfaces:**
- Produces: the rule future sessions follow; referenced by `/close`.

- [ ] **Step 1: Append to DECISIONS.md**

```markdown
## 2026-08-21 — Trunk discipline

**Decision:** `main` is the only branching base. Feature-off-feature branches
require a DECISIONS.md entry stating why. Every session that creates commits
pushes its branch before /close completes. Superseded branches are archived
as `archive/<name>` tags, never left as branches.

**Why:** The 2026 Q2–Q3 stack (multica-operator → v0.5 → v3.5 → pilot →
berd-agents) left main 248 commits stale, the trunk ambiguous, and the sole
copy of the tip on one laptop. Merge cost grew with every session.

**Refs:** this plan (docs/superpowers/plans/2026-08-21-ship-and-validate.md), Pushback critique F5/F6.
```

- [ ] **Step 2: Add the same rule (2 lines) to AGENTS.md git conventions, commit both**

```bash
git add DECISIONS.md AGENTS.md
git commit -m "docs(decisions): trunk discipline — main is the only branching base"
```

---

## Phase 3 — Positioning truth-up + hygiene

### Task 8: Gitignore the generated noise

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Check what main's merge already covered, add the rest**

```bash
git check-ignore -v graphify-out/graph.html site/test-results/ || true
```

For any path not ignored, append to `.gitignore`:

```
graphify-out/*.html
site/test-results/
```

(Keep `graphify-out/graph.json` trackable — main's graph scripts commit graph data per spec.)

- [ ] **Step 2: Verify and commit**

```bash
git status --porcelain | grep -E 'graphify-out|test-results' | wc -l
git add .gitignore && git commit -m "chore: gitignore graphify renderings and site test-results"
```

Expected: `0` untracked noise lines.

### Task 9: True up POSITIONING.md and the site copy (F1, F4, F7, F8)

**Files:**
- Modify: `docs/POSITIONING.md`, `site/src/data/landing.yaml`, `site/src/data/modules.yaml` (only if a changed claim is mirrored there).

**Interfaces:**
- Consumes: live counts (`ls skills/ | wc -l`, `federation.yaml` downstream list).
- Produces: copy whose every claim survives a reader checking the repo.

- [ ] **Step 1: Fix the network claim (F1) — §1 "Long" bullet 3**

Replace:

> **A live network hub** — the framework repo is itself a running org-os instance (self-hosting since 2026-04-24), coordinating a real federation of instances with drift monitoring, pull-based migrations, and a skill-promotion pipeline.

with:

> **A live network hub** — the framework repo is itself a running org-os instance (self-hosting since 2026-04-24), coordinating a federation of 6 downstream instances with drift monitoring, pull-based migrations, and a skill-promotion pipeline. Honest scope: today every instance is operated by the maintainer — a full-depth dogfood of the network shape. The first unaffiliated instance is the open milestone (see DECISIONS.md 2026-08-21).

- [ ] **Step 2: Same correction in §2 table row 4 and §8 numbers box**

§2 row 4: `Running live across 7 instances` → `Running across 6 downstream instances + the hub (single-operator dogfood; external pilot is the open milestone)`.
§8: `7 federation instances` → `6 downstream instances + hub`; `32 skills` → the live count (34 at plan-writing; recount at execution: `ls skills/ | wc -l`).

- [ ] **Step 3: Fix the bootstrap claim (F7) — §5 core table**

Replace the Bootstrap engine row's `interview + cloning engine (8-stage), acceptance-tested end-to-end` with `guided interview (acceptance-tested); cloning mechanism in design — see docs/agent-plans/instance-bootstrap.md`. Also §6: `**"We're starting a new org this month."** → fork, 6 questions, first session in hours` gains ` (interview tested internally; first outside-operator timing run pending — Task 14)`.

- [ ] **Step 4: Name the schema consumers (F4) — §3 concept 4**

Append to the Schemas concept:

> Consumed today by: the site build (aggregates instance `.well-known/` at build time), the federation map data plane, and `npm run analyze:instances` drift reports. The standing invitation of layer 3 is external consumers; none exist yet.

- [ ] **Step 5: Lead with the wedge (F8) — §1 one-liner**

Keep the current one-liner as the "Long" framing, and add above it:

> **Wedge one-liner (landing hero):** An AI chief of staff for your organization — not just for you. Your org's knowledge, data, and operations as files any agent can read, act on, and federate.

- [ ] **Step 6: Propagate to site data and run the drift tests**

Mirror the changed hero/claims into `site/src/data/landing.yaml` (hero + about strings). Then:

```bash
cd site && npm run build && npm test; cd ..
```

Expected: build green; the modules drift test passes (only fails if `docs/MODULES.md` ↔ `modules.yaml` were touched — they weren't).

- [ ] **Step 7: Commit**

```bash
git add docs/POSITIONING.md site/src/data/landing.yaml
git commit -m "docs(positioning): claims match repo truth — instance count, operator concentration, bootstrap status, schema consumers, wedge hero"
```

### Task 10: One versioning story (operator gate)

**Files:**
- Modify: `DECISIONS.md`, `CHANGELOG.md` (`[Unreleased]` stub).

**Interfaces:**
- Consumes: current state — `package.json` 0.5.0, local tags `v3.0.0` + `v3.5.0`, "v5 module engine" naming in queue/tasks.
- Produces: one canonical scheme every surface uses.

- [ ] **Step 1: Present the recommendation**

Recommendation to operator: **v0.x is canonical** (matches package.json and the public "pre-beta by design" story). Retag history: `archive/v3.0.0`, `archive/v3.5.0`; stop using "v5" as a version — rename the workstream to "module engine" in queue/task copy. Alternative (rejected by default): resume v3.x numbering, which contradicts the published 0.5.0 and the honesty-signal story in POSITIONING §9.

**Gate: operator picks.**

- [ ] **Step 2: Execute the chosen scheme (commands for the recommended path)**

```bash
git tag archive/v3.0.0 v3.0.0 && git tag -d v3.0.0
git tag archive/v3.5.0 v3.5.0 && git tag -d v3.5.0
```

Then: append the decision to `DECISIONS.md`; fill `CHANGELOG.md [Unreleased]` with the Phase 1–3 changes (trunk merge, admin M1, positioning truth-up); replace "v5 module engine" → "module engine" in `HEARTBEAT.md` and `docs/agent-plans/QUEUE.md`.

- [ ] **Step 3: Commit**

```bash
git add DECISIONS.md CHANGELOG.md HEARTBEAT.md docs/agent-plans/QUEUE.md
git commit -m "docs(versioning): v0.x canonical; v3.x tags archived; 'v5' naming retired"
```

---

## Phase 4 — Deploy the site (F5)

### Task 11: Lock the three deploy decisions (operator gate)

No files — a decision presented with defaults, so Task 12 can execute without re-asking:

1. **Target repo:** `regen-coordination/org-os-framework` (per the queued plan's recommendation).
2. **URL:** project path `regen-coordination.github.io/org-os-framework/` — requires `base` in `site/astro.config.mjs`; custom domain deferred until one exists.
3. **Canonical site branch:** `main` (true since Task 3 — `site/` now lives on the trunk).

**Gate: operator confirms or overrides. Record the choice in DECISIONS.md.**

### Task 12: Execute the Pages deploy

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `site/astro.config.mjs` (add `site` + `base`)

**Interfaces:**
- Consumes: Task 11's locked decisions; the existing queued plan `docs/agent-plans/github-pages-deploy.md` (follow it where it is more specific).
- Produces: a live public URL — F5's "no live site exists" becomes false.

- [ ] **Step 1: Set Astro base**

In `site/astro.config.mjs` add to the config object (values from Task 11):

```js
site: 'https://regen-coordination.github.io',
base: '/org-os-framework',
```

- [ ] **Step 2: Add the workflow**

`.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy site to Pages
on:
  push:
    branches: [main]
    paths: ['site/**', '.github/workflows/deploy-pages.yml']
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
        working-directory: site
      - uses: actions/upload-pages-artifact@v3
        with: { path: site/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Verify build locally, commit, push**

```bash
cd site && npm run build && cd ..
git add .github/workflows/deploy-pages.yml site/astro.config.mjs
git commit -m "feat(site): GitHub Pages deploy workflow + base path"
git push origin main
```

- [ ] **Step 4: Enable Pages and verify live**

```bash
gh api repos/{owner}/{repo}/pages -X POST -f build_type=workflow || gh api repos/{owner}/{repo}/pages -X PUT -f build_type=workflow
gh run watch
curl -sI https://regen-coordination.github.io/org-os-framework/ | head -1
```

Expected: `HTTP/2 200`. Record the URL in `TOOLS.md` and `DECISIONS.md`.

---

## Phase 5 — Portfolio kill-list (F2, F3, F6)

### Task 13: The keep/freeze list (operator gate, agent-prepared)

**Files:**
- Create: `docs/agent-plans/2026-08-21-portfolio-decision-memo.md`
- Modify (after gate): `docs/agent-plans/QUEUE.md`, `data/projects.yaml`, `DECISIONS.md`.

**Interfaces:**
- Consumes: the full queue + branch survey from Phases 1–2.
- Produces: Active ≤ 3 workstreams; everything else explicitly frozen with a written un-freeze trigger.

- [ ] **Step 1: Write the memo with these defaults**

| Item | Recommendation | Un-freeze trigger |
|---|---|---|
| Downstream propagation (sync-upstream rollout to 6 instances) | **KEEP — Active 1** | — |
| External pilot (Phase 6 of this plan) | **KEEP — Active 2** | — |
| Admin app M2 | **KEEP — Active 3** (sole operator-interface bet; F3) | after 2 weeks of real M1 use |
| Website generator / site upkeep | Maintenance only | external instance wants a site |
| Module engine (`loadRegistry`/`add`/`adopt`) | FREEZE | second module manifest exists |
| autopoiesis Phase 3 | FREEZE (Phase 2's merge landed in Phase 1) | after pilot learnings |
| dfos-integration | FREEZE | a peer org asks for verifiable identity |
| rad-org-os (all 4 tail tasks) | FREEZE | Radicle carries a real second operator |
| multica-integration | FREEZE | runtime decision revisited |
| tui-dashboard, obsidian-interface, obsidian-canvas-interface | FREEZE (three interfaces behind admin app; F6) | admin app proves/fails the pattern |
| graphify-integration scope Q | RESOLVED-BY-MERGE candidate — main's graphify line answered "A: ingest source"; confirm and close |
| skills-section, commands-consolidation | FREEZE | first external operator asks "what can this do?" |
| dfos/metalabel outreach, aggregator-promotion | FREEZE | upstream events |

- [ ] **Step 2: Present. Gate: operator edits/approves the table.**

- [ ] **Step 3: Apply — restructure QUEUE.md (Active = the 3 keeps; new `## Frozen` section with triggers), set `data/projects.yaml` frozen workstreams to `stage: paused`, append the decision to DECISIONS.md**

```bash
npm run generate:schemas && npm run validate:schemas && npm run generate:quilt
git add docs/agent-plans/QUEUE.md docs/agent-plans/2026-08-21-portfolio-decision-memo.md data/projects.yaml DECISIONS.md docs/QUILT.md .well-known/
git commit -m "docs(portfolio): Active=3 (propagation, pilot, admin M2); rest frozen with un-freeze triggers"
```

---

## Phase 6 — External validation (F1, F2, F3)

### Task 14: Clean-room bootstrap test (agent-executable, no gate)

**Files:**
- Create: `memory/reports/clean-room-bootstrap-2026-08-21.md`

**Interfaces:**
- Consumes: `main` after Phase 4; `docs/OPERATOR-GUIDE.md` + `BOOTSTRAP.md` as the only allowed instructions.
- Produces: a timed friction log — the first empirical test of "fork-in-hours" (F2, F7).

- [ ] **Step 1: Clone into a clean room**

```bash
git clone "$(git remote get-url origin)" /tmp/cleanroom-org && cd /tmp/cleanroom-org
```

- [ ] **Step 2: Play a fictional org, docs only**

Run the bootstrap as "Harbor Bakery Co-op" (a non-web3 cooperative — deliberately the persona POSITIONING claims but has never tested): `npm install && npm run setup`, answer the six questions, then attempt `/initialize`. Rules: only `BOOTSTRAP.md`/`docs/OPERATOR-GUIDE.md` may be consulted; every command not found there, every error, every "I had to already know X" is a logged friction item with a timestamp.

- [ ] **Step 3: Write the report**

`memory/reports/clean-room-bootstrap-2026-08-21.md`: total wall-clock time, friction items ranked by severity, verdict on the "first session in hours" claim, and a fix-list. Copy the fix-list into HEARTBEAT.md tasks.

- [ ] **Step 4: Clean up the clean room and commit the report**

```bash
rm -rf /tmp/cleanroom-org
git add memory/reports/clean-room-bootstrap-2026-08-21.md HEARTBEAT.md
git commit -m "test(bootstrap): clean-room fork timing + friction report"
```

### Task 15: Pilot recruitment (operator gate — draft-and-present)

**Files:**
- Create: `docs/agent-plans/external-pilot.md`

**Interfaces:**
- Consumes: Task 14's friction fixes (pilot starts only after the top-severity items are fixed).
- Produces: one named unaffiliated org, an onboarding date, and a support protocol.

- [ ] **Step 1: Draft the pilot brief**

`docs/agent-plans/external-pilot.md` containing: candidate profile (an org whose operator is *not* Luiz — e.g. bread-coop's actual operators, or a ReFi local node run by someone else); the offer (guided bootstrap session + 30 days of async support); the ask (run `/initialize`+`/close` as their real ops, log friction); the measure (Task 16).

- [ ] **Step 2: Draft outreach messages for 2 candidates. Gate: operator names the candidates, edits the drafts, and sends them personally.** Nothing is sent by an agent.

### Task 16: Define the milestone and its metric

**Files:**
- Modify: `DECISIONS.md`, `HEARTBEAT.md`.

- [ ] **Step 1: Append to DECISIONS.md**

```markdown
## 2026-08-21 — External-validation milestone

**Decision:** org-os's next version milestone (v0.6) is gated on one
unaffiliated operator running their org on org-os for 30 consecutive days
with ≤4 support interventions and their instance publishing valid
`.well-known/` schemas. Until then, every positioning claim about the
network is scoped as single-operator dogfooding (POSITIONING §1), and
frozen workstreams (portfolio memo 2026-08-21) stay frozen.

**Why:** All existing validation is internal (F1/F2, Pushback critique
2026-08-21). This is the only experiment that can falsify the value
proposition; it therefore gates further layer-building.
```

- [ ] **Step 2: Add the milestone as the top HEARTBEAT task; commit**

```bash
git add DECISIONS.md HEARTBEAT.md
git commit -m "docs(decisions): v0.6 gated on first external operator (30-day pilot)"
```

---

## Execution order & session sizing

- **Session A (mechanical, ~1 session):** Tasks 1–3. Highest value, zero decisions beyond conflict resolution.
- **Session B (gated on operator availability):** Tasks 4–7.
- **Session C:** Tasks 8–10, then 11–12 (site live by end of session).
- **Session D:** Task 13 (memo pre-written by agent, decided together), Task 14.
- **Ongoing:** Tasks 15–16 open the pilot clock.

Findings coverage: F1→T9/T15 · F2→T14/T15/T16 · F3→T13(admin bet)/T14 · F4→T9.4 · F5→T1–T4/T12 · F6→T6/T7/T13 · F7→T9/T10 · F8→T9.5.
