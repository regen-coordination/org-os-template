# Portfolio Decision Memo — Active = 3, everything else frozen with a trigger

**Date:** 2026-08-21 · **Author:** agent, Task 13 Step 1 (`.superpowers/sdd/2026-08-21-ship-and-validate/task-13-brief.md`)
**Status:** draft — awaiting operator gate (Step 2). This memo does not modify `QUEUE.md`, `data/projects.yaml`, or `DECISIONS.md`. It recommends what Step 3 should do.

## 0. Why this memo exists

org-os has one maintainer. Tonight's session found:

- **13 workstreams** in `data/projects.yaml`, all still `status: Develop` or `Discovery` — the registry has never marked anything paused, so nothing has ever visibly stopped.
- **4 plans in `QUEUE.md` Active** (`cloudflare-os-integration`, `admin-app`, `org-os-website`, `autopoiesis-research`), **15 items Queued**, **5 Scoping**.
- **At least six operator-facing surfaces** in flight before any of them has a second user: admin app, TUI dashboard, the public website, two Obsidian interfaces, Berd personas — and a sixth nobody had been counting, the Cloudflare OS `org-dashboard` gadget (§4 row 0).
- **Three more branches nobody tracked at all** — `feat/rad-org-os` (55 commits), `feature/kms-connector-layer` (19 commits), `feature/tech-tree` (21 commits, an entire spec'd-and-approved feature with no `QUEUE.md` entry, ever) — found only because Task 6's containment check happened to leave their worktrees in place. That is F6 (portfolio indiscipline) made concrete: work was happening that the queue didn't know about.

Cutting Active to 3 doesn't kill anything. It stops pretending 13 things are moving forward at once when one person is doing the moving. Every frozen row below gets a specific, checkable event that reopens it — not "later."

## 1. The floor every trigger sits on

`DECISIONS.md` 2026-08-21 ("External-validation milestone"): **v0.6 is gated on one unaffiliated operator running org-os for 30 consecutive days, ≤4 support interventions, valid `.well-known/` output.** Until that gate passes, "frozen workstreams (portfolio memo 2026-08-21) stay frozen."

That is the floor. Every "un-freeze trigger" in §4 is **additive** to it, not a substitute — a row whose trigger fires before v0.6 passes is not un-frozen, it is *queued to un-freeze the moment v0.6 clears*. Two rows are cheap enough that they don't need to wait for even that (flagged explicitly, §6 and §7): they're bounded diff-review, not scope growth, and doing them costs nothing toward the "stop starting things" goal.

## 2. What actually changes vs. tonight's `QUEUE.md`

Today's Active section has 4 plans. None of the three kept below is a straight continuation of three of them:

| Today's Active | Tonight's verdict |
|---|---|
| `cloudflare-os-integration` | **Moves to frozen** (§4 row 0) — the biggest single change in this memo, see below |
| `admin-app` | Narrows to **Active 3: M2 only** — M1 already shipped, PR #1 (Task 4, this same plan) still needs to land first |
| `org-os-website` | **Moves to maintenance-only** (§4 row 4) |
| `autopoiesis-research` | **Splits**: the sync-upstream *rollout* becomes **Active 1**; Phase 3 (further R&D) freezes (§4 row 5) |

Two of the three new Actives (downstream propagation, external pilot) don't exist as named `QUEUE.md` entries today — Step 3 creates them.

## 3. Active — the 3 kept items

| # | Item | Workstream | Rationale | Status tonight |
|---|---|---|---|---|
| 1 | **Downstream propagation** — run the now-fixed `sync-upstream.mjs` against all 6 real downstream instances | `instance-orchestration` | This is *rollout* of finished, tested tooling (Phase 2's fatal null-handling bug is fixed, 17/17 tests), not more building. The v0.6 gate needs the mechanism proven against real instances before it's asked to carry an external one. | Ready to run tonight — no blockers |
| 2 | **External pilot** — Phase 6 of the ship-and-validate plan (F1/F2 remediation) | new / cross-cutting | The only experiment that can falsify the value proposition (DECISIONS.md 2026-08-21). Everything else in this memo is downstream of whether this succeeds. | Not yet started — later phase of tonight's plan |
| 3 | **Admin app M2** (Map + view engine + ⌘K) | `operator-interfaces` | Sole operator-interface bet (see §4 row 6 for why the other four freeze). M1 is real: 44 tests, comment-preserving YAML writes, e2e-verified. | **Blocked**: PR #1 is still `OPEN` (`state: OPEN`, checked via `gh pr view 1` tonight) — Task 4 of this same plan merges it, gated on operator approval. M2 cannot literally start until that lands. **Un-freeze/start clock for the M1-use trigger begins at merge date, not tonight's date.** |

Trigger for revisiting Active-3 specifically: *2 weeks of real M1 use after PR #1 merges* — carried from the brief's default, unchanged, because it's already a specific observable event once the merge-date ambiguity above is resolved.

## 4. Freeze table — full portfolio, one row per line, every trigger a specific event

All triggers below are **in addition to** the v0.6 floor (§1) unless marked "pre-v0.6 exception."

| # | Item | Workstream(s) | Recommendation | Rationale | Un-freeze trigger |
|---|---|---|---|---|---|
| 0 | **Cloudflare OS integration** (M0–M2 built, `org-dashboard` gadget) | `cloudflare-os-integration` | **FREEZE** — deviates from brief default, which omitted this row entirely even though it's today's #1 Active item | Remaining work is 100% "stand up a paid Cloudflare account and deploy" (QUEUE.md's own words). That's real infrastructure spend to host a *sixth* operator interface nobody has asked to use yet — the exact anti-pattern this memo exists to stop. M0–M2 don't decay by sitting; the code is done and tested. | The external pilot operator (Active-2) asks for a hosted dashboard instead of self-hosting |
| 1 | **Website generator** / site upkeep (extracting the reusable core from `org-os-website`) | `framework-evolution` (public-surfaces) | Maintenance only | The current site build stays on its own track (Phase 4 of tonight's plan handles deploy — that's a shipping action, not a new-scope one, so it isn't gated by this memo). The *generator* — pulling the reusable theme/build core out for reuse by other instances — is new scope with zero current demand. | A named instance (not the hub) asks for its own site off the same core |
| 2 | **Module engine** (`loadRegistry` / `add` / `adopt` beyond the identity-mapping manifest-first shim) | `framework-evolution` | FREEZE | One module exists (`org-os-cloudflare-os`, manifest-first, DECISIONS.md 2026-08-10). One data point can't validate a general engine. | A second module manifest is written (even a stub) |
| 3 | **dfos-integration** (Phases 0–1: `did:dfos` identity, manifest anchoring) | `federation-protocol` | FREEZE | Design-approved, standalone-valuable per its own decision, but it's cryptographic infrastructure for a federation that is currently one operator wearing seven hats. | A peer org (not the maintainer) asks for verifiable identity/anchoring |
| 4 | **DFOS/Metalabel outreach** + **aggregator-package-promotion** | `federation-protocol` / regen-coordination-side | FREEZE | Bundled in the brief default as "upstream events" — too vague per this memo's own bar, sharpened below using facts already on record. | DFOS: Metalabel publishes a public API for the spaces product (DECISIONS.md 2026-08-02 records none exists today — this is the actual blocker, not a vague "event"). Aggregator: the regen-coordination-os aggregator v1 ships (QUEUE.md's own stated ETA, ~6–8 weeks out) |
| 5 | **autopoiesis Phase 3** (Cognition/Federation cascade closure) | `framework-evolution` | FREEZE | Phase 2's loop (the part that had a fatal bug) is fixed and merged — that's Active-1's rollout, not more R&D. Sharpened from the brief's "after pilot learnings" (too vague per this memo's own bar). | The external pilot (Active-2) hits a federation-scale problem Loop C's current implementation doesn't solve |
| 6 | **tui-dashboard**, **obsidian-interface**, **obsidian-canvas-interface**, **skills-section** | `operator-interfaces` | FREEZE | Four more candidate interfaces behind the one being bet on (admin app M2, §3). `skills-section` is scoped, low-risk, and could ship in an afternoon — that's exactly why it's dangerous to allow: "quick" is how a portfolio grows to 13 things. | Admin app M2 ships **and** either (a) two weeks of the operator's own daily use hits a task M2 can't do, or (b) a second operator explicitly names one of these four by name |
| 7 | **commands-consolidation** | `operator-interfaces` | FREEZE | "Largely advanced" per its own QUEUE.md note — the remaining scope (a `/commands` listing surface) is UI, same bucket as row 6. | First external operator asks "what commands does this have?" |
| 8 | **multica-integration** | `package-integration` | FREEZE | Pilot for package-integration Phase 3; no package-consumption mechanism exists yet to pilot against. | Multica ships a stable self-hosted server release (currently the actual blocker — the integration targets a moving upstream) |
| 9 | **package-integration** (audit `packages/`, define lifecycle) | `package-integration` | FREEZE | Real gap (18 `packages/` dirs, no canonical status field — Task 9's finding tonight), but resolving it only matters once something needs to consume a package the framework doesn't already ship inline. | `instance-bootstrap`'s wizard work resumes and needs open question 7 answered (`instance-bootstrap.md`: "phase 2 selection touches package activation... share the consumption-mechanism decision?") |
| 10 | **system-reliability** (trigger layering: pre-commit/CI/scheduled) | `reliability` | FREEZE | No incident has happened yet to prioritize over the 3 Actives. Note for the record: `archive/v3.5-execution` (§5) also built real reliability tooling — a selftest aggregator, pre-commit hook, CI validate + scheduled-drift workflows, 10 commits — that's prior art worth a cheap diff-review whenever this unfreezes, not a reason to start now. | A data-integrity or drift incident actually occurs (not hypothetical — a real `.well-known/` drift, a real broken sync) |
| 11 | **rad-org-os** (Radicle substrate driver, bootstrap path, seed-node runbook, KMS radicle connector) | `rad-org-os` | FREEZE — **deviates from the brief default**, which treated this as 4 not-yet-started tail tasks | It isn't greenfield. `feat/rad-org-os` (unmerged, live worktree) has 55 commits and its own commit messages say "Tiers 1+2 complete (org-os runs fully on Radicle)" and "live-verified zero→live bootstrap." `docs/RAD-ORG-OS.md`'s "Now" section ("No Radicle-specific code has shipped yet") is stale against that branch — a correction for whoever next touches that page, not tonight's job. Freezing the *workstream* still stands: a sovereign-distribution bet is exactly the kind of expansion this memo exists to stop before a second operator exists. | Radicle carries a real second operator (unchanged from brief default — still the right bar) |
| 12 | **feature/kms-connector-layer** (GitHub + KOI connectors, connector contract; component 3 of rad-org-os's design) | `rad-org-os` (partially) | FREEZE — **new row, not in brief default** | 19 unmerged commits, real: `packages/toolkit-framework/src/connector.mjs` + tests, GitHub/KOI connectors, radicle/geo/atproto stubbed. Scoped in the design doc as rad-org-os component 3, but its actual content (GitHub, KOI ingestion) is useful independent of Radicle. | rad-org-os's trigger fires, **or** a workstream needs GitHub/KOI-source knowledge ingestion on its own merits |
| 13 | **feature/tech-tree** (dependency-graph roadmap view: `/tech-tree` page, skill, dashboard pulse line) | `framework-evolution` | FREEZE — **new row, not in brief default; wasn't in `QUEUE.md` at all** | 21 unmerged commits against an approved spec (`docs/superpowers/specs/2026-07-19-tech-tree-design.md`) and a written plan — fully built, never reconciled with the queue. This branch *is* F6's finding: real work happening the portfolio process never saw. Step 3 should give it a `QUEUE.md` line (Scoping, not Active) purely so it stops being invisible — that's a bookkeeping fix, not an un-freeze. | The operator wants a portfolio/roadmap visualization for their own use, or to show a prospective external operator |
| 14 | **graphify-integration scope Q** (HEARTBEAT.md: "answer the scope question A/B/C/D") | `framework-evolution` | **RESOLVED — close, don't freeze** | Confirmed tonight: `graphify export --wiki` / `compile:knowledge` shipped on `main` (merged into `feat/berd-agents` via Task 2), and `graphify-knowledge-pages` (QUEUE.md #9) already says "Depends on: graphify integration (**shipped**)." The open question was answered by what got built — "A: ingest source" — it just was never marked closed. | N/A — recommend deleting HEARTBEAT.md lines 30–31 in Step 3 |
| 15 | `github-pages-deploy` | public-surfaces | Not this memo's call | Phase 4 of tonight's plan handles the live site deploy directly — a shipping action already in motion, independent of the freeze/Active decision. | — |

## 5. The six stale/branch-tangle items (fact: ~148 unique commits, six branches) — position on each

The plan's own ledger (`progress.md`) flagged these six as needing a portfolio position. Investigated tonight; **the real picture is smaller than "6 independent 148-commit reviews."**

| Branch | Commits vs `main` | Position | Why |
|---|---|---|---|
| `archive/v3.5-execution` (tagged, branch deleted) | 44 | **Salvage — the real decision surface** | Contains the 983-line `scripts/clone-framework.mjs` rewrite (26 of the 44 commits) plus reliability tooling (row 10 above) and a templates system. Every commit unique by `git cherry` (0 superseded), but "unique" ≠ "absent from main" — several paths (`clone-framework.mjs`, `templates/render.mjs`) are divergent rewrites of things `main` also built independently. Needs a side-by-side diff, not a blind cherry-pick. See §6 — this is the fact-3/4 evaluation the brief required before recommending on `instance-bootstrap`. |
| `release/v3.5-docs-prep` | 45 (vs `main`) | **No separate decision — fully contained in the tag above** | `git log archive/v3.5-execution..release/v3.5-docs-prep` = **0**. This branch is a subset of `archive/v3.5-execution`, not 45 *additional* commits to review. Safe to tag-and-delete with zero information loss. |
| `release/v3.5-templates` | 7 (vs `main`) | **No separate decision — same reason** | `git log archive/v3.5-execution..release/v3.5-templates` = **0**. Also fully contained in the tag. Safe to tag-and-delete. |
| `feat/knowledge-commons` | 32 | **Evaluate later, genuinely distinct** | Not contained in `archive/v3.5-execution` (56/54 commits diverge each direction) — a real, separate ~114-file knowledge-commons site (search, topic hubs, sigma graph explorer, RSS/llms.txt, Playwright tests). Big and real, but it's a second content/discovery surface competing with the same "which interface" question as §4 row 6. Freeze behind that same decision. |
| `feat/admin-app` | 18 | **Not a freeze decision — already has a task** | PR #1, Task 4 of tonight's plan, operator-gated merge. Covered by §3 row 3. |
| `agent/ORG-4` | 2 | **Evaluate later, low cost** | Philosophy-manifesto session + one Multica integration idea note. No code, no test surface. Cheap to review whenever; not urgent. |

**Net effect:** treat this as one salvage decision (`archive/v3.5-execution`, §6) + one distinct-feature freeze (`feat/knowledge-commons`, folded into §4 row 6's interface question) + two housekeeping deletes (docs-prep, templates) + one already-covered item (admin-app) + one trivial one (ORG-4). Not six parallel 148-commit reviews.

## 6. The cloning engine — evaluated before any `instance-bootstrap` recommendation, as required

`QUEUE.md` #7 lists `instance-bootstrap` as blocked on an "unresolved open question" about the cloning mechanism, and `instance-bootstrap.md`'s own Open Question 1 asks "GitHub template, `npm create org-os@latest`, in-repo script, or mixed?" as if no answer exists.

**That framing is wrong, twice over, confirmed tonight:**

1. **The question is already answered and shipped.** `scripts/clone-framework.mjs` (318 lines, 8-stage) is wired to `npm run clone:framework`, is documented as the recommended path in `README`/`BOOTSTRAP.md`, passes 4/4 tests, and produced a real acceptance instance (`bread-coop-os`) — verified by Task 9 tonight via matching genesis-commit string. This is not a design question sitting open; it's a shipped, working default.
2. **A materially larger version of the same script sits unmerged.** `archive/v3.5-execution`'s `clone-framework.mjs` is 983 lines vs. main's 318 — more than 3x — with its own test suite (`tests/scripts/clone-framework.test.mjs`, `tests/scripts/sync-packages.test.mjs`, `tests/templates/render.test.mjs`). The real open question isn't "which mechanism" — it's "does the archived version's extra ~665 lines contain fixes/features worth merging into the shipped one, or was it superseded by `main`'s independent evolution during the 272-commit gap?"

**Recommendation:** `instance-bootstrap` **FREEZE** for new feature scope (wizard package/skill selection, knowledge-bootstrap proof-of-pipeline — Phases 2–3 of its own plan), consistent with the freeze table. **Exception (pre-v0.6, cheap, do anytime):** a side-by-side diff of `archive/v3.5-execution:scripts/clone-framework.mjs` against `main`'s is bounded, information-only work — not scope growth — and every future clone (including a real pilot's onboarding) benefits from whatever it finds. It doesn't need to wait for the v0.6 floor.

**Un-freeze trigger for the feature scope:** Task 14's clean-room bootstrap report (§8) lands and names a concrete fix the current shipped engine needs — that is the first real evidence of where the engine actually falls short, sharper than continuing to debate open questions in the abstract.

**Correction to make in Step 3:** `QUEUE.md` #7 and `instance-bootstrap.md` Open Question 1 both need their framing fixed regardless of the freeze decision — they currently describe a real, shipped, tested, acceptance-verified engine as an unresolved question. That's the same claim-drift class Task 9 fixed in `POSITIONING.md` tonight, just in a different file.

## 7. Two more cheap, bounded, pre-v0.6 exceptions (not new scope, don't compete for Active)

Neither of these consumes an Active slot or waits on the v0.6 floor — both are finishing pre-existing bugs, not opening new work:

- **`repo-check-health`** (QUEUE.md #12) — `npm run check` fails on a missing `tsconfig.json` and ~22 pre-existing prettier offenders. Pure hygiene, bounded, zero design decisions.
- **`archive/v3.5-execution`'s reliability tooling** (§4 row 10) — worth a look in the same pass as the clone-framework.mjs diff (§6), since both live on the same tag.

## 8. Task 14 (clean-room bootstrap) — landed; here's what it found and what it does to the operator-interface pick

Task 14 has landed: `memory/reports/clean-room-bootstrap-2026-08-21.md` (7 Blocker, 4 Major, 5 Minor). A clean-room persona — a 9-person worker co-op, docs-only — forked org-os and hit a wall before ever producing a working instance: the guided wizard (`npm run setup`) asks nine undocumented prompts instead of the documented six, cannot complete outside a real interactive terminal (B2), and — even hand-completed to let the experiment continue — silently no-ops against the populated fork target, leaving the maintainer's own `IDENTITY.md`, `data/members.yaml`, `data/projects.yaml`, and RPC endpoints in place (B3/B4). The resulting `/initialize` dashboard renders the maintainer's 54-task, 13-project backlog under the bakery's name with zero error (B5); `generate:schemas` republishes that into public `.well-known/` output (B6); and both `validate:schemas` and `validate:structure` report a full, confident pass on it (B7).

**Does this contradict, complicate, or support §3 row 3 (admin app M2 as the sole kept operator interface) and §4 row 6 (tui-dashboard / obsidian-interface / obsidian-canvas-interface / skills-section frozen)? Complicates — it does not contradict, and it does not support either.**

It doesn't contradict the pick: nothing in the report is evidence that a newcomer wants a *different* interface than admin-app. The clean-room persona never got far enough to have an opinion about interfaces at all — B1–B4 stop the experiment before any interface choice is reached. The one interface Task 14 did exercise, the CLI/markdown session dashboard (`node scripts/initialize.mjs`, part of "core framework," not one of the four candidates in row 6), fails for a data reason (B5: it renders someone else's data, correctly and confidently) — not a rendering-surface reason. That specific failure mode is interface-agnostic: admin-app M2, a TUI, or an Obsidian canvas would each render the same leaked `data/*.yaml` just as cleanly, because the bug is upstream of all four candidate renderers, in the bootstrap step that populates (or fails to populate) the data they'd all read from. So there is no admin-app-specific signal here to revisit §3 row 3 or §4 row 6 against, and this memo isn't changing either pick.

Where it *does* bite is the premise underneath the whole operator-interface question, and underneath Active-2 (external pilot) more directly than Active-3 (admin-app M2): row 6's un-freeze trigger ("a second operator explicitly names one of these four by name") assumes a second operator gets far enough to form that opinion. Task 14 is direct evidence that the documented path, run cold, does not reliably get them there — and the persona that ran it, "docs-only, no prior context," is a closer proxy for the v0.6 external-pilot operator (§1's floor) than for anyone weighing in on interface taste. An unaffiliated pilot operator following README/BOOTSTRAP.md today hits B1–B7 before they ever see admin-app, a dashboard, or any interface at all — and if they push through anyway, they get a "passing," silently-wrong instance with nothing in the documented tooling to tell them so. That is a harder blocker on Active-2 clearing the v0.6 gate (§1) than anything in the interface freeze table.

**Recommendation, stated plainly:** keep admin-app M2 as Active-3 exactly as §3 row 3 has it — no reversal. But the clean-room fix-list (now `HEARTBEAT.md`, ordered B3/B4/B5/B6 → B7 → B2 → B1 → M1–M4) is a prerequisite for Active-2 succeeding at all, not a fifth freeze-table row competing with row 6's interfaces. This memo doesn't have the authority to add a fourth Active slot or reorder §3 — that's Step 2's operator call — but Step 2 should weigh it as blocking Active-2, the memo's own "only experiment that can falsify the value proposition" (§3 row 2), not as one more portfolio item to defer behind admin-app.

## 9. Summary of every deviation from the brief's default table

1. **Cloudflare OS integration** (today's #1 Active item) — freeze; the brief's table omitted it entirely (§4 row 0).
2. **`instance-bootstrap`** — reframed from "blocked on unresolved cloning-mechanism question" to "engine shipped and working; the real question is whether a 983-line unmerged rewrite has salvageable fixes" (§6).
3. **`rad-org-os`** — reframed from "4 not-yet-started tail tasks" to "55 unmerged commits, two tail tasks already built (`live-verified zero→live bootstrap`); `docs/RAD-ORG-OS.md` is stale against its own branch" (§4 row 11).
4. **Two new rows not in the brief**: `feature/kms-connector-layer` and `feature/tech-tree` (§4 rows 12–13) — live, substantial, unmerged branches the ledger explicitly asked this memo to assign verdicts to.
5. **Branch-tangle count corrected**: "6 branches, ~148 commits" collapses to one real salvage decision + one distinct-feature freeze + two zero-cost deletes + two already-covered/trivial items (§5) — `release/v3.5-docs-prep` and `release/v3.5-templates` are fully contained in the `archive/v3.5-execution` tag, not independent review surfaces.
6. **Sharpened vague triggers**: "after pilot learnings" (autopoiesis Phase 3) and "upstream events" (DFOS/aggregator outreach) replaced with specific observable events (§4 rows 4–5), per this memo's own stated bar that "revisit later" isn't a trigger.
7. **`graphify-integration` scope Q** — recommended **closed**, not frozen; confirmed resolved by what merged tonight (§4 row 14).
8. **Admin app M2 (Active 3)** — kept, but flagged as blocked on PR #1 (still `OPEN` tonight) landing first; the "2 weeks of M1 use" clock starts at merge date, not today (§3).
9. Full crosswalk to `data/projects.yaml`'s 13 workstream IDs added per row, since the brief's table names plans/branches, not workstream IDs, and Step 3 will need that mapping to touch the registry.
