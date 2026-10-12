---
id: 2026-10-11-reviewer-review-the-herdr-labels-and-four-review
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its
detached: true
pane: 'w1N:p1'
workspace: w1N
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-reviewer-review-the-herdr-labels-and-four-review
task: null
handoff: handoff-2026-10-11-review-the-herdr-label-work-and-four-rev
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-11T00:24:35-03:00'
updated: '2026-10-11T00:30:26-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the herdr labels and four review fixes before they become the code that seats every agent

Goal. Give a pass or fail verdict on the branch you are seated on: two commits on feat/crew (f287105), `git diff feat/crew...HEAD`. On a pass the lead merges it into feat/crew and pushes. The main checkout's scripts are what the crew itself runs, so a defect on the ordinary seat or report path would stop the crew working. Weigh findings by that.

The claims are in the engineer's Report section: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-11-engineer-label-each-crew-agent-in-herdr-with-its.md (read only). Part A: after a successful seat, crew reports role, assignment and status as herdr metadata on the pane, and role and assignment on the workspace; `report` moves the pane's status to reported; a refusal never fails a seat or a report and prints one line. Part B: nudge's help text, the board's sync-conflict wording with the spec's example regenerated, the reading-list test that can now fail, and the dead end after a timed-out worktree step (finding F-1 of an earlier review, Report section of .../memory/crew/2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before.md).

Check, in this order.
1. The ordinary path. For a seat that works first time and for a report: exactly which herdr calls are now made, in which order, with which arguments, compared with f287105? The new calls come after the agent is started and prompted: can any of them delay, reorder or fail the seat, or hold the command for long (the engineer says at most 10 seconds each)? Is the record already `working` before they run?
2. Reality, read only. `herdr pane report-metadata --help`, `herdr workspace report-metadata --help`, `herdr api schema --json`: do the flags, token names and limits the adapter uses exist in the installed 0.9.1? You may NOT run report-metadata or anything else that changes herdr's state. Say what the stub binary proves and what stays unverified.
3. The label a human reads: build the three token values for a few real first lines of tonight's briefs (any Brief section in memory/crew/) and judge whether a sidebar row made of them tells an operator which agent is which. The operator's instruction was "label them properly"; say plainly whether this does.
4. The docs/CREW.md section with the operator's own config.toml rows: is it marked as the operator's edit, and are the rows consistent with herdr's configuration reference as far as you can read it?
5. Part B, each of the four: closed as asked, with a test that can fail. For F-1 reproduce the two-release flow with the fake adapter and confirm the second release finds the record, and that an ordinary failed seating (not a timeout) still closes on the first release.
6. Old files in memory/crew/ still read and release. HEARTBEAT.md's open list is right after the removals.
7. Nothing that should not be pushed. Name the onboarding files you read.

Also, for the lead: this branch conflicts textually with another unmerged branch, crew/2026-10-11-engineer-roles-can-set-an-effort-level-add-the-we, in scripts/crew.mjs and scripts/crew/core.mjs (both add a way for seat to return a line for the operator: `labelNote` here, `notes` there). Do not resolve it. Read both diffs at the conflict and say in three lines what one mechanism should replace the two.

Done means. A verdict, pass or fail, with the commands run and counts (`npm ci --ignore-scripts`; `node --test "tests/scripts/crew-*.test.mjs"`; `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`; `npm run version:check`), whether you ran the new tests against f287105, expected versus actual for each finding with file and line, and whether each must be fixed before merge or can follow. Say plainly whether you would let this code seat the next agent. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-11T00:29:33-03:00

VERDICT: FAIL, on one small blocker. Fix it and this passes. The seat and report code itself is sound, and I would let it seat the next agent once the blocker is fixed. I changed nothing on the branch.

Branch: 7488b3e + 02a33e3 on f287105 (`git diff feat/crew...HEAD`, 16 files).

## Commands run and counts
- `npm ci --ignore-scripts`: ok.
- `node --test "tests/scripts/crew-*.test.mjs"`: 163 tests, 163 pass, 0 fail (10 files).
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: 25 tests, 24 pass, **1 fail**: "the instance's own selftest passes on day one (after generate:schemas)" (see B-1).
- `npm run version:check`: all sources agree at 0.5.0.
- New tests against f287105 (branch's tests/ and helper copied over f287105's code in a scratch copy): 163 run, 9 fail, 154 pass. The nine that fail are exactly the new behaviour: crew-label (seat labels, long line cut, refused label, report label, adapter args), the two release-timeout tests, the Syncthing wording, the nudge help line. So those tests can fail. The spec-example test and the list-bullet test pass on both because the base spec and README were already consistent; they are drift guards.
- The same clone-genesis selftest test passes in that scratch copy of f287105, so B-1 is a regression of this branch. (That copy was `git archive` plus a node_modules symlink; two other clone-genesis tests fail there from my harness, not from the code.)

## Findings

### B-1 MUST FIX before merge. A fresh clone's own selftest fails on day one
- `tests/scripts/crew-board.test.mjs:554`, new test "the board example in spec section 8 is exactly what renderBoard prints".
- Input: it reads `docs/superpowers/specs/2026-10-10-org-os-crew-design.md`. The clone ships the test (module.yaml lists crew-board.test.mjs) but not that spec.
- Expected: `node --test tests/` inside a clone passes. Actual: `ENOENT ... clone-genesis-XXXX/docs/superpowers/specs/2026-10-10-org-os-crew-design.md`, `✗ node --test tests/ FAIL exit 1`, and `tests/clone-genesis.test.mjs:230` fails (`1 !== 0`). Command: `node --test tests/clone-genesis.test.mjs`.
- Lens: downstream first; a passing check must be able to fail (here it fails for the wrong reason in a clone). Fix: skip when the spec file is absent, or ship the spec in the module's files; the test should also say which.
- Does not touch the seat or report path.

### F-1 Fix before merge or with it (docs, 5 minutes). The CREW.md rows are not "herdr's default rows with the label lines added"
- `docs/CREW.md`, section "See the crew in herdr's sidebar". Read from herdr v0.9.1's config-reference.json (raw.githubusercontent.com/herdrdev/herdr/v0.9.1/docs/next/website/src/data/config-reference.json):
  - `ui.sidebar.agents.rows` default is `[["state_icon","machine","workspace","tab"],["agent"]]`. The snippet's agents rows drop `machine` and drop the `agent` row entirely, so an operator who pastes it loses the agent name and machine from the sidebar.
  - `ui.sidebar.spaces.rows` default `[["state_icon","workspace"],["branch","git_status"]]`: the snippet keeps both and adds a row, so that one is accurate.
- Expected: the sentence is true, or the snippet keeps `["agent"]` and `machine`. Marked as the operator's edit: yes, in bold, and crew never touches config.toml. Key names `[ui.sidebar.agents]`, `[ui.sidebar.spaces]`, `rows` and `$name` metadata tokens exist in 0.9.1.
- Not confirmed from the reference: that a `$name` row is hidden on agents without the value (the doc says it is). The operator's current `~/.config/herdr/config.toml` has no sidebar rows, so nothing shows today. `herdr config check` says ok.

### F-2 Can follow. The label as a human reads it
Values I built from every Brief in memory/crew/ (32-character cut, as the code does):
- `engineer | Board and release tell the trut…` appears twice with the same role: two agents indistinguishable.
- `reviewer | Review the commons-steward's co…` / `…la…`: told apart only by the last two letters.
- Four briefs from different roles start `Present yourself to the operato…`; here role tells them apart.
- `engineer | Label each crew agent in herdr …`, `lead | First crew cycle: clear the def…`: readable.
- `$role` repeats the agent name herdr already shows (name = role id), so it adds little. Default sidebar width is 26 and max 36 (`ui.sidebar_width`, `_max_width`): 32 characters is cut again at the default width.
- Plain answer: it tells an operator roughly what each agent is doing when the briefs open with a distinct sentence; it does not reliably tell two same-role agents apart, and it will not fit a default-width sidebar. It answers "label them properly" partly. A brief with a short title line first would fix most of it; that is a convention for briefs, not a code bug.

### F-3 Can follow (minor)
- The live check of the labels is added to the spec's "not verified" list (now six items) but HEARTBEAT.md's open item and CREW.md's section still say "five experiments". `HEARTBEAT.md` Crew open list.

## Per-item results
1. Ordinary path. Compared with f287105, seat makes the same calls in the same order, then after `status: working` is written (`core.mjs:310`) makes `pane report-metadata` and `workspace report-metadata` (two calls). `report` makes one call after the report is written (`core.mjs:410`). Each uses the 10 second look timeout (`herdr.mjs` `look`: min(timeoutMs, 10000)), so at most 20 seconds added to seat and 10 to report. Failure is caught in `setLabel` and printed as one line; record and exit are unchanged (tested for both calls). A failed seating is never labelled. Pass.
2. Reality, read only. `herdr pane report-metadata --help` has `--source <ID>`, `--token <NAME=VALUE>`, positional `<PANE_ID>`; `workspace report-metadata` the same without the pane options. `herdr api schema --json`: tokens max 16, names `^[A-Za-z0-9_-]{1,32}$`, `ttl_ms` 1..86400000, `seq` optional; `source` and the id required. All flags the adapter uses exist in 0.9.1. I ran no report-metadata. The stub-binary test proves only the argument vector. It does not prove herdr accepts them, nor the 80-character value limit, nor that a missing `--ttl-ms` means "until the pane closes": the schema does not say, and those come from the reference, not an observation. The spec says so. Unverified until the smoke run.
3. See F-2.
4. See F-1.
5. Part B. (a) nudge help: closed, test can fail (fails on f287105). (b) Board wording and the spec example: closed; example regenerated, equality test; fails in a clone (B-1). (c) Reading-list test: closed. The test uses only bullet lines, and a second test shows removing the DECISIONS.md bullet is detected while prose still names it. (d) F-1 dead end: reproduced with the fake adapter. First release of a timed-out worktree step leaves `worktree_removed: false` and says the branch does not exist now and may appear; a second release finds the record, removes the worktree if it appeared (`worktree_removed: true`), or says there is still none and closes. A third gives "No open assignment matches". An ordinary failed seating (not timeout) closes on the first release: `mayAppear` requires `failed_step: worktree` and `error_code: herdr_timeout`, and the existing tests for that path still pass.
6. Old files without label fields still read and release (crew-roles/board/flow suites pass; labels live only in herdr). HEARTBEAT.md: F-1 and the Syncthing item removed, F-2..F-4, experiments and proposals remain, and MEMORY.md and CHANGELOG say the same. QUEUE item 8 exists, as the CHANGELOG now cites.
7. Nothing that should not be pushed: no secrets or personal data in the diff; worktree clean. Onboarding files read: roles/reviewer.md, my assignment file, roles/README.md, MASTERPLAN.md, SOUL.md, MEMORY.md, DECISIONS.md (newest three entries, plus the crew entries). All four existed in the worktree.

## For the lead: the conflict with crew/2026-10-11-engineer-roles-can-set-an-effort-level-add-the-we
Both add a side channel for lines `seat` wants printed that are not part of the record (`labelNote`: one string or null, printed by `crew.mjs`; `notes`: an array, printed one per line). Keep the array: `seat` and `report` both return `{...record, notes}`, `setLabel` pushes its one line into it, the effort code pushes its own, and `crew.mjs` prints every note after the worktree line. Resolve in whichever branch merges second; delete `labelNote` and its two print sites, and change the label tests from `a.labelNote` to `a.notes`.

## What I could not check
- That a live herdr accepts and shows these tokens (no state-changing herdr call allowed).
- The sidebar rendering itself.
- Whether a herdr restart keeps the labels (crew does not set them again; documented).

## What went wrong in my own work
I wrote one reference file to /tmp when fetching herdr's config reference and removed it; the scratchpad was the right place.
