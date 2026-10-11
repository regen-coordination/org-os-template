---
id: 2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2
role: engineer
agent: engineer-2
kind: claude
branch: crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2
detached: false
pane: 'wR:p1'
workspace: wR
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:08:37-03:00'
updated: '2026-10-10T21:11:01-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Board and release tell the truth about every assignment

Goal. Three known minor defects in crew make the operator misread or lose an assignment. Fix each one test-first (a test that fails on the old code), so the next operator does not meet them. You own the functions release, board and renderBoard in scripts/crew/core.mjs and the `release` and `board` cases in scripts/crew.mjs. Another engineer is working at the same time on seat, nudge, assignmentBody, the report/seat cases and USAGE in scripts/crew.mjs, scripts/crew/herdr.mjs, scripts/crew/trail.mjs and modules/org-os-crew/module.yaml: do not edit those, so the two branches merge cleanly. If you need a change there, say so in your report.

The defects.
1. The board does not show the trail status, so an agent that has reported looks the same as an idle one. Each row, in the table and in --json, should carry the assignment's trail status (seating, working, reported). Spec section 8 rule still holds: live state comes from herdr, the status from the trail, neither copied into the other; so it is a second column, not a change to STATE.
2. A released or abandoned assignment whose worktree was left behind (release found changes in it, recorded worktree_removed: false) cannot be released again, because findActive only looks at open statuses, and it is not listed on the board. The operator has no way to see it or finish it. Done means: the board lists such assignments (while the worktree still exists on disk, per ctx.git.worktreeExists) in words that say what they are, in the table and in --json; and running release on one again retries the worktree removal with the same safety rules (never forced, lists what is left) without changing its recorded outcome (an abandoned one stays abandoned). An assignment that is closed and whose worktree is gone stays refused as today.
3. Releasing an assignment whose seating failed prints "Its branch … is kept" and "The worktree was removed" although, when seating failed at the worktree step, neither ever existed. release should return what is actually true (whether the branch resolves, via ctx.git.resolves; whether a worktree existed and was removed) and the CLI should print only that, in plain sentences.

Already known. Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md, sections 5.2, 8 and 10. Code: scripts/crew/core.mjs (release at about line 282, board at 349, renderBoard at 388), scripts/crew.mjs (release case at about line 120). Tests with fake adapters to extend: tests/scripts/crew-board.test.mjs, crew-flow.test.mjs, crew-cli.test.mjs. Operator-facing text that describes the board and releasing: docs/CREW.md and skills/crew/SKILL.md; update the sentences your change makes untrue, nothing more. The fields worktree_removed and rescued_branch are already written by release; prefer reading existing fields over adding new ones, and keep old trail files (which lack any field you add) working.

Done means. Each of the three has a test that failed before your change and passes after; `node --test "tests/scripts/crew-*.test.mjs"` passes in full (run `npm ci --ignore-scripts` first); the work is committed on your branch in logical commits; nothing is pushed or merged. Report with the test command and its pass/fail counts, why each defect existed, and anything you chose not to do. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:10:22-03:00

Branch: crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2 (2 commits, not pushed)

Proof: `node --test "tests/scripts/crew-*.test.mjs"` -> tests 90, pass 90, fail 0.
Against the old core.mjs the board tests give 6 failures (the 5 new tests + the updated renderBoard test), all passing after.

## What changed (scripts/crew/core.mjs, scripts/crew.mjs release case, docs/CREW.md, skills/crew/SKILL.md)
1. Trail status: board rows (table and --json) carry `status` from the trail; the table has a STATUS column after STATE. STATE is still herdr only. Old trail files work (the field is the existing `status`).
2. Left-behind worktrees: board gains `leftBehind` (--json) and a "Worktrees left behind" section: closed (released/abandoned), `worktree_removed: false`, and the worktree still exists per ctx.git.worktreeExists. `release` on one retries the removal with the same rules (never forced, lists what is left), keeps the recorded outcome, and does not re-run rescueDetached when `rescued_branch` is already recorded. A closed assignment with its worktree gone is still refused as before.
3. Truthful release: release returns `worktreeExisted` and `branchKept` (ctx.git.resolves). The CLI prints "Its branch X is kept." only when it resolves, otherwise says it was never created; "The worktree was removed." only when one existed, otherwise "There was no worktree at <path> to remove."

## Why the defects existed
1. The board row was built from live herdr data only; the trail status was never copied in (deliberately, per spec section 8), and no second column was added.
2. findActive only searched open statuses (plus failed for release), and the board only looked at open/failed records, so a closed record with worktree_removed: false was invisible and unreachable.
3. release set removed = true when the worktree did not exist and the CLI printed fixed sentences for branch and worktree regardless of what existed.

## Chose not to do / notes
- Migration note: none needed for instance data. Only the board's --json output gains `status` and `leftBehind`, and the table gains a STATUS column; anything parsing the table by column position will shift.
- A retry ignores `--outcome` (the CLI defaults it to done, so an explicit conflicting value cannot be told apart). Not changed; the CLI USAGE text is in the other engineer's files.
- The CLI printing itself is not covered by a test (cli tests only exercise refusals); the returned values it prints from are tested.
- Two closed assignments sharing an agent name that both have leftover worktrees give an error asking for the id.

One line on what I'd do differently: have release return a structured result for the CLI to print (done here via two fields), and give crew-cli.test.mjs a fake-adapter path so the sentences are tested too.

Hand-off: reviewer, branch above.
