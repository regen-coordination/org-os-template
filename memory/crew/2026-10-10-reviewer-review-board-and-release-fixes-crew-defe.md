---
id: 2026-10-10-reviewer-review-board-and-release-fixes-crew-defe
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2
detached: true
pane: 'wS:p1'
workspace: wS
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-reviewer-review-board-and-release-fixes-crew-defe
task: null
handoff: handoff-2026-10-10-review-the-engineer-s-fix-board-shows-tr
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:11:01-03:00'
updated: '2026-10-10T21:13:22-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review board and release fixes (crew defects 1 to 3)

Goal. Give the operator a pass or fail verdict on the branch you are seated on, so they can merge it into feat/crew. It claims to fix three defects in crew; the base is feat/crew, so the change is `git diff feat/crew...HEAD`.

The claims.
1. Board rows, in the table and in --json, carry the assignment's trail status in a STATUS column after STATE; STATE still comes only from herdr.
2. A released or abandoned assignment whose worktree was left behind (worktree_removed: false and the worktree still on disk) is listed on the board ("Worktrees left behind", `leftBehind` in --json) and can be released again: the removal is retried with the same safety rules (never forced, lists what is left), the recorded outcome is kept, commits in a detached copy are not rescued twice. A closed assignment whose worktree is gone is still refused.
3. Releasing an assignment whose seating failed prints only what is true: the branch is called kept only if it resolves, the worktree removed only if one existed.

Where to look. The engineer's report, with its own stated gaps, is the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2.md (read only). Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md sections 5.2, 8, 10. Code: release, board, renderBoard in scripts/crew/core.mjs; the release case in scripts/crew.mjs. Tests: tests/scripts/crew-board.test.mjs, crew-flow.test.mjs.

Look especially for. Whether each new test really fails on the old code (check out the old core.mjs into a scratch copy or reason from the diff, and say which you did). The engineer says the CLI sentences for release are not tested: read them and judge each branch of the printing against the three claims. Trail files written before this change (no worktree_removed field, or a failed record with pane: null). A second release with --outcome abandoned on an assignment recorded as released. Whether docs/CREW.md and skills/crew/SKILL.md now say what the code does. Whether anything outside the engineer's functions was touched.

Done means. A verdict, pass or fail, with the exact commands run (including `npm ci --ignore-scripts` then `node --test "tests/scripts/crew-*.test.mjs"` with counts), expected versus actual for each finding, file and line, and how serious each is: must fix before merge, or can follow. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:12:19-03:00

# Review: board STATUS column, left-behind worktrees, truthful release

**Verdict: FAIL — one must-fix before merge** (commit loss on a retried release). The three claims otherwise hold; two smaller findings can follow.

## Commands run
- `git diff feat/crew...HEAD` (2 commits; 5 files: docs/CREW.md, scripts/crew.mjs, scripts/crew/core.mjs, skills/crew/SKILL.md, tests/scripts/crew-board.test.mjs). Nothing outside the engineer's functions was touched.
- `npm ci --ignore-scripts` -> ok.
- `node --test "tests/scripts/crew-*.test.mjs"` -> tests 90, pass 90, fail 0.
- Fail-first check, done by running (not only by reading): copied HEAD into a scratch dir, replaced scripts/crew/core.mjs and scripts/crew.mjs with feat/crew's, ran `node --test tests/scripts/crew-board.test.mjs` -> tests 22, pass 16, fail 6 (the updated renderBoard test + the 5 new tests). The engineer's claim is accurate. Caveat: "a closed assignment whose worktree was removed is refused" fails on old code only because `leftBehind` is undefined; its refusal half already passed before, so it is a regression guard, not proof of new behaviour.
- Clean-room probe with real git in a scratch repo (see finding 1).

## Claims
1. STATUS column / `status` in --json: PASS. STATE still `live.state` only. Old trail files: `status` is the existing field, so no migration. Table column shift for position-parsers is noted by the engineer.
2. Left-behind listing and retried release: PASS on the stated cases (never forced, `left` listed, outcome kept, rescue not repeated, closed+gone refused, trail without `worktree_removed` is not listed because the test is `=== false`; failed record with `pane: null` still goes through `needsRelease`/release and works). But see finding 1.
3. Truthful release: PASS for the ordinary and failed-before-worktree non-detached cases; see finding 3 for the detached case.

## Findings

### 1. MUST FIX — retried release can delete commits (scripts/crew/core.mjs:327, `if (a.detached && !rescued)`)
- Input: a detached assignment, first release rescued commits to `crew/<id>` and left the worktree because it was dirty. The operator "deals with the changes" the natural way: commits them in that worktree. Then `release <id>` again.
- Expected: the new commit is saved (or the removal refused) before the worktree goes.
- Actual: `rescued` is already set from `a.rescued_branch`, so `rescueDetached` is skipped; the worktree is now clean, so it is removed. The new commit is reachable from no branch and is lost.
- Evidence (real git, scratch repo): `rescueDetached` -> `crew/a` at 30832ae; after a further commit in the worktree, HEAD is 2f1f5fa and `git branch --contains 2f1f5fa` prints nothing. The test "does not try to save its commits a second time" asserts exactly the skip, so it cannot catch this.
- Fix: on retry, still call `rescueDetached` (it already returns null when a branch contains HEAD) and handle the name already existing (e.g. `crew/<id>-2`, or refuse and list). Keep the recorded `rescued_branch` when it returns null. Add a test where HEAD moves between the two releases.

### 2. CAN FOLLOW — a retry silently ignores `--outcome` (scripts/crew.mjs release case; core.mjs `status = closed ? a.status : ...`)
- Input: `release <id> --outcome abandoned` on an assignment recorded `released` (or the reverse).
- Expected: refused or told the outcome stays; Actual: prints "<id> is released." with no mention that the flag was ignored. Truthful, but surprising. Docs say outcome is "kept" but not that the flag is ignored. The CLI defaults `outcome` to `done`, so core cannot tell an explicit flag; fix by passing `values.outcome` through as undefined.

### 3. CAN FOLLOW — failed seating of a detached assignment still says it "worked on a detached copy" (scripts/crew.mjs, detached branch)
- Input: `seat ... --on feature` fails at createWorktree, then `release <id>`. `feature` resolves.
- Expected: say there was no worktree and nothing ran; Actual: "It worked on a detached copy of feature; that branch is untouched." The first line is not true when `worktreeExisted` is false. Claim 3 is about printing only what is true. The CLI printing is untested, as the engineer says; the three sentences each need a test via a fake adapter.

### 4. CAN FOLLOW — fallback swallows the ambiguity error (core.mjs ~305, `catch (err)`)
- Input: two open assignments with the same agent name plus exactly one left-behind closed one with that name; `release <name>`.
- Expected: "More than one open assignment..."; Actual: the catch takes the closed one and releases it. Only fall back when the error is the no-match case. Not reproduced by running; from reading.

### 5. NOTE — a closed record's old pane id is still checked for "working" (core.mjs ~312)
- A retry on a closed assignment reports "<agent> is still working" if herdr has since reused that pane id for another agent. Not verified that herdr reuses ids; the check is unnecessary for closed records.

## Docs
docs/CREW.md and skills/crew/SKILL.md match the code for STATUS values, the left-behind section and the retry. "left behind because it had changes in it" is slightly narrower than the code (a removal error or failed rescue also leaves it). Neither says `--outcome` is ignored on a retry (finding 2).

## Not run
No live herdr: board/release CLI output was read, not executed (the CLI tests only exercise refusals).
