---
id: 2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its
detached: false
pane: 'w1G:p1'
workspace: w1G
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its
task: null
handoff: handoff-2026-10-10-build-design-a-from-docs-research-2026-1
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-11T00:12:32-03:00'
updated: '2026-10-11T00:40:37-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Label each crew agent in herdr with its role and assignment, and close four small code items

Goal. The operator wants to see the whole crew together in herdr. A researcher found that herdr's sidebar Agent panel already lists the agents of every workspace, and that crew can label each row with `herdr pane report-metadata` and `herdr workspace report-metadata`. Build the labels, so an operator looking at herdr can tell which agent is which role on which assignment without opening the crew board. The operator decided: labels only. The other half of the researcher's design (release removing the worktree with git so a released agent's pane stays open) is NOT to be built; release stays exactly as it is.

Part A, the labels. Read the note first: `git show crew/2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor:docs/research/2026-10-10-herdr-one-crew-workspace.md` (the Recommendation, design A, step 2 and its checks, and what it says about report-metadata tokens and the `[ui.sidebar.agents]` row in the operator's config.toml). Then:
1. After the pane exists at seat, crew reports role and assignment as metadata on the pane and on the workspace. A failure of either call never fails the seat and never changes the record's status: catch it, and say one plain line in the seat output that the label could not be set.
2. Decide from herdr's own help (`herdr pane report-metadata --help`, `herdr workspace report-metadata --help`, read-only) what the tokens are called and what limits they have, and say what you chose. The assignment's first brief line is long; the label must stay readable in a sidebar.
3. Consider the life of the label: status changes (working, reported) and release. Update it where that is one cheap call and say what you did not do.
4. docs/CREW.md gets a short how-to: what the labels show, and the exact lines for the operator's own herdr config.toml that display them, marked as the operator's own edit that crew never makes. Spec section 5 and 5.3 record the calls.
You may run read-only herdr commands (help, list, get). You may NOT run report-metadata or anything else that changes herdr's state against the live session: test with the stub binary as tests/scripts/crew-herdr.test.mjs does, and put the one live check into docs/CREW.md's smoke run for the operator.

Part B, four small items left by tonight's reviews.
1. `scripts/crew.mjs` help text for nudge says "an agent that stopped at a startup dialog"; six causes leave a prompt unsent (PROMPT_NOT_SENT in core.mjs). Make the help line true and short.
2. renderBoard's Syncthing line says "a trail file" and names Syncthing without saying what either is; "trail" is not in the vocabulary of roles/README.md. Reword it, then regenerate the board example in spec section 8 from the new output (it must stay character-for-character what renderBoard prints, with an invented home directory).
3. tests/scripts/crew-shipped-roles.test.mjs cannot fail for DECISIONS.md: it collects every backticked file name in the whole "Before you begin" section, so prose mentioning the file satisfies it after the bullet is deleted. Read only the bullet lines. Show it failing when a bullet is removed.
4. The dead end after a timed-out worktree step (finding F-1 in the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before.md, read only): the first release prints "run release again" if the worktree appears, marks the record worktree_removed true, and a second release then finds no match; the same output says the branch "was never created" two lines above "may still have been creating it". Make the advice work and the output not contradict itself. HEARTBEAT.md lists this as the first open item: take it off that list, and leave F-2 to F-4 there.
Also one sentence: CHANGELOG.md's note listing the "not on main" notices misses docs/agent-plans/QUEUE.md.

Where to look. You start from feat/crew at f287105, which has everything merged and pushed. scripts/crew/herdr.mjs, scripts/crew/core.mjs (seat, release, renderBoard), scripts/crew.mjs; tests/scripts/crew-herdr.test.mjs, crew-seat.test.mjs, crew-board.test.mjs, crew-shipped-roles.test.mjs; spec sections 5, 5.3, 8; docs/CREW.md; skills/crew/SKILL.md; CHANGELOG.md (the crew section above [Unreleased]). Nobody else is changing these files.

Done means. Each item has a test that fails on f287105 and passes after, or a stated reason it cannot; core.mjs stays pure; old files in memory/crew/ still read; no dependency change. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"`, `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` and `npm run version:check` pass. The CHANGELOG's crew section says what an operator now sees. Logical commits, part A and part B apart; nothing pushed or merged. Report with commands and counts, what you did per item, the onboarding files you read, and what stays unverified against a live herdr. Then hand off to reviewer naming your branch with --branch.

## Handoff

Handoff handoff-2026-10-10-build-design-a-from-docs-research-2026-1 names branch crew/2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor. You were not seated on a copy of it: your branch starts from feat/crew.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-11T00:23:24-03:00

## Result

Both parts are done and committed on `crew/2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its`, two commits over f287105, nothing pushed or merged. Part A is 7488b3e, part B is 02a33e3 (which also carries the clone manifest and module manifest lines for the new test file; they belong to A, sorry).

## Commands and counts

- `npm ci --ignore-scripts`: completed.
- `node --test "tests/scripts/crew-*.test.mjs"`: tests 163, pass 163, fail 0 (151 at f287105; +12 new).
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: tests 25, pass 25, fail 0. It first failed 2 because the new test file `crew-label.test.mjs` was in neither `tests/clone-manifest.txt` nor `modules/org-os-crew/module.yaml`; both now list it (`npm run clone:manifest` for the first).
- `npm run version:check`: all version sources agree.
- prettier on CHANGELOG.md / HEARTBEAT.md: 21 and 20 differing lines before and after, no worse.

## Part A: the labels

What I chose, from `herdr pane|workspace report-metadata --help`, `herdr api schema --json` and the reference at the v0.9.1 tag (the installed `--help` is only a flag list):
- Source `crew`. Tokens `role` (role id), `assignment` (first non-empty line of the brief, whitespace collapsed, cut to 32 characters with `…`, the board's own width), `status`.
- Pane gets all three; the workspace gets `role` and `assignment` only, since a workspace `status` would go stale and the pane's is the one that moves.
- Limits: the schema gives at most 16 tokens, names `[A-Za-z0-9_-]{1,32}`, `ttl_ms` at most 24 h. The reference (not observed) adds: values trimmed and cut at 80, a token call patches only the names it gives, no ttl means it stays until replaced or the pane closes. I cut at 32, not 80, so a row stays one line. No `--ttl-ms`, no `--seq`.
- Item 1: `seat` labels after the seat succeeded (a failed seating is never labelled). A refusal of either call is caught, never changes status, and prints one line: "The label for <agent> could not be set in herdr (<reason>). The agent is seated and the assignment is unchanged; only herdr's sidebar lacks the label." The adapter uses the 10 s read timeout, so a hung herdr costs at most that.
- Item 3, the label's life: `report` moves the pane's `status` to `reported`, one call, resending the whole set; a refusal prints the same line and the report stays written. NOT done: `release` sets nothing (it closes the workspace and the label goes with it; when release falls back to git the pane may stay with a stale `working`, I judged one more call not worth a second failure path); no label on failed seatings; no re-label after a herdr restart; no `agent.view.set` filter (no CLI).
- Item 4: docs/CREW.md has a section "See the crew in herdr's sidebar" with the exact `[ui.sidebar.agents]` and `[ui.sidebar.spaces]` rows (shape read from herdr's configuration reference at v0.9.1), marked as the operator's own edit; and a "Label check" in the smoke run. Spec 5 step 8, 5.3 item 13 and the unverified list record the calls. SKILL.md and CHANGELOG say what an operator sees.
- Tests (`tests/scripts/crew-label.test.mjs`, 6): on f287105 5 fail, the sixth ("a failed seat is never labelled") passes on both and is a regression guard. Adapter test uses a stub binary that logs argv.

## Part B

1. nudge help: `scripts/crew.mjs`, the lead's commands in the assignment file (core.mjs) and the SKILL table now say "to an agent that has not received it". Test in crew-cli.test.mjs fails on f287105.
2. renderBoard: "Your file-sync tool (Syncthing) kept these when two machines changed the same assignment file in memory/crew/ at once. They are not read as records; merge them by hand and delete them." Spec section 8 example regenerated; a new test compares the spec's block with renderBoard output character for character (it was green before the rewording, went red with it, green after the spec edit).
3. crew-shipped-roles: reads only bullet lines; a second test removes the `DECISIONS.md` bullet from the real section and asserts the list loses it while prose still names it. It cannot fail on f287105's code by nature (it is a test of a test); shown instead by deleting the bullet in roles/README.md: "the shared list lost DECISIONS.md" fails, and I restored the file with `git checkout`.
4. F-1: a first release of a failed seating whose worktree step timed out (`failed_step: worktree`, `error_code: herdr_timeout`) and whose worktree is not there yet now leaves `worktree_removed: false`, so the same `release <id>` finds it; with the worktree there it removes it, with none it says "There is still no worktree at …" and closes. The first output says the branch "does not exist now; herdr may still create it, and crew never deletes a branch" instead of "was never created", and no longer prints an empty "was left at" list. Two tests in crew-board.test.mjs fail on f287105 (the second release answered "No open assignment matches"). HEARTBEAT.md: F-1 item removed, F-2 to F-4 kept; I also removed the renderBoard "small plain-language gap" item, which B2 closes, and MEMORY.md's Active Context no longer names F-1.
5. CHANGELOG note now lists `docs/agent-plans/QUEUE.md` (item 8).

## Why the problems existed

F-1: release treated "no worktree on disk" as "removed" whatever the record said, so the record closed itself before herdr could finish, and the test checked the advice's wording, not that the advice worked (reviewer's own point). The nudge help and Syncthing line were written when one cause and one tool were in mind.

## Onboarding files read

MASTERPLAN.md, SOUL.md, MEMORY.md and DECISIONS.md (newest entry and the top of the file; searched for crew/herdr), at the root of my worktree; roles/README.md "Before you begin" present. Absent: nothing.

## Unverified against a live herdr

- That the installed 0.9.1 accepts the three tokens and shows them through `$role`, `$assignment`, `$status` rows; the config row shape and the value cap come from the reference at the v0.9.1 tag, not from the binary (`herdr config check` is in the docs for the operator).
- That a herdr restart drops or keeps the tokens, and that an update with the same source does patch rather than replace (I resend the whole set so either works).
- What the pane looks like when release falls back to git removal (stale `working`).
- The timed-out worktree flow itself: only the fake adapter; herdr's real behaviour after a cut-off `worktree create` is as before (spec 5.3 item 12).
- The one live check is in docs/CREW.md's smoke run, step 5.

## Neighbouring things I did not fix

- The board still says "trail says working, no live agent" under Needs release, and SKILL.md line 81 still says "trail files"; `trail` is not in the vocabulary of roles/README.md.
- `a.labelNote` is a transient field on the object seat() and report() return; fine for now, but a ctx-level notice channel would be cleaner.

## What I would do differently

Run `npm run clone:manifest` and the manifest test before the first commit: a new test file is part of the module's shipped set, and I found out only at the final check.

Lenses: Fail loudly, in words (the one-line label notice, the F-1 output); Validation must be able to fail (B3's mutation test, the spec-example test); A guard for every bug (F-1 tests); Idempotent scripts (second release closes cleanly; label updates resend the full set).
