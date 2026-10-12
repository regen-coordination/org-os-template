---
id: 2026-10-10-engineer-fix-review-findings-on-release-retry-a-r
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r
detached: false
pane: 'wT:p1'
workspace: wT
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:13:23-03:00'
updated: '2026-10-10T21:16:03-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Fix review findings on release retry: a retried release must not lose commits

Goal. The branch you start from (crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2, the fix for crew defects 1 to 3) failed review with one must-fix and four smaller findings, all in release in scripts/crew/core.mjs and the release case in scripts/crew.mjs. Fix them test-first on your branch, which is stacked on that one, so the operator can merge the pair.

The findings. Read them in full, with the reviewer's evidence, in the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-board-and-release-fixes-crew-defe.md (read only). In short:
1. MUST FIX. A detached assignment whose first release saved its commits to crew/<id> and left the worktree because it was dirty: if the operator then commits in that worktree and releases again, rescueDetached is skipped (rescued_branch is already recorded), the clean worktree is removed and the new commit is on no branch. A retry must still save commits that are on no branch, or refuse to remove. Handle the rescue branch name already existing. Keep the recorded rescued_branch when nothing new needs saving. Read rescueDetached in scripts/crew/git.mjs first; if the fix needs a change there, make it and cover it in tests/scripts/crew-git.test.mjs. The existing test "does not try to save its commits a second time" asserts the unsafe behaviour and must change.
2. A retried release silently ignores --outcome. Lead's decision: when an outcome is given explicitly and differs from the recorded one, refuse with one plain sentence saying the assignment is already <recorded> and that a retry only finishes removing the worktree; with no --outcome, proceed as now. This needs the CLI to pass the flag through as given rather than defaulting it; a first release with no flag still means done.
3. Releasing a failed seating of a detached (--on) assignment prints "It worked on a detached copy of <branch>" although no worktree ever existed. Print only what is true. The reviewer also notes the release sentences have no test: move the wording somewhere a test with fake adapters can reach it (for example a pure function in core.mjs that returns the lines, like renderBoard) and test each sentence.
4. The fallback to closed assignments catches every error from findActive, so "more than one open assignment has an agent named X" is swallowed and a closed one is released instead. Fall back only when nothing open matched.
5. A retry on a closed assignment still refuses with "<agent> is still working" if its old pane id now belongs to some other live agent. A closed assignment has no agent; do not make that check for it.

Boundaries for merging cleanly. Another branch (not yet merged) has changed seat, nudge, assignmentBody, the seat and report cases and USAGE in scripts/crew.mjs, herdr.mjs, trail.mjs, and modules/org-os-crew/module.yaml, where every crew test file is now listed by name. So: do not edit those functions, and put your tests in the existing files (tests/scripts/crew-board.test.mjs, crew-flow.test.mjs, crew-git.test.mjs, crew-cli.test.mjs), not in a new test file. Update docs/CREW.md and skills/crew/SKILL.md only where your change makes a sentence untrue (the reviewer notes "left behind because it had changes in it" is narrower than the code).

Done means. Each finding has a test that failed before and passes after (finding 1 with a test where HEAD moves between the two releases); `npm ci --ignore-scripts` then `node --test "tests/scripts/crew-*.test.mjs"` passes in full; logical commits on your branch; nothing pushed or merged. Report with the command and counts, what you did for each finding, and anything you disagree with or left. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:15:12-03:00

# Report: review findings on release retry

Branch: crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r (stacked on crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e-2). Nothing pushed or merged.

## Proof
`npm ci --ignore-scripts` then `node --test "tests/scripts/crew-*.test.mjs"` -> tests 98, pass 98, fail 0 (was 90).
Fail-first: with HEAD's core.mjs and git.mjs put back, crew-board + crew-git give 36 tests, 7 fail (one per finding below, two for finding 1, plus the git adapter test).

## Findings
1. Commit loss (must fix). Release on a detached assignment now always asks rescueDetached, retry or not. It returns null when HEAD is on a branch, and then the recorded rescued_branch is kept. In git.mjs a taken branch name gets a numeric suffix (crew/<id>-2, -3), so an earlier rescue branch is never moved. If the save throws, the worktree is left and the earlier rescued_branch stays recorded. The test that asserted the skip is replaced by "keeps the recorded branch when nothing new needs saving"; new tests move HEAD between releases (core, fake adapter) and the same in real git (crew-git). The fake adapter now behaves like the real one (suffix, branch exists afterwards).
2. --outcome on a retry. CLI passes values.outcome as given. A closed assignment with an explicit, different outcome is refused: "<id> is already <status>; a retry only finishes removing the worktree." Same or no outcome proceeds. A first release with no flag is still done.
3. Truthful wording. New pure releaseLines(r) in core.mjs, used by the CLI; each sentence is tested. A detached assignment with no worktree no longer says "worked on a detached copy"; it only says there was no worktree to remove.
4. Fallback. Closed assignments are consulted only when no open one matches id or agent, so "More than one open assignment..." is no longer swallowed.
5. Closed retry. The "is still working" pane check is skipped for closed assignments.

Docs: docs/CREW.md and skills/crew/SKILL.md updated (left-behind causes, retry refuses a different --outcome, rescue suffix).

## Why it happened
The retry path was built to avoid rescuing twice, and "already rescued" was used as "nothing to rescue", which is true only while HEAD does not move. The CLI defaulted --outcome, so core could not tell a flag from no flag.

## Not covered / left
- The CLI's `outcome: values.outcome` line is not run by a test: the CLI tests only exercise refusals outside herdr. Core's refusal and default behaviour are tested.
- rescued_branch records only the latest rescue branch; earlier ones stay in git, and are ancestors of the newest.
- Did not touch seat, nudge, assignmentBody, USAGE, herdr.mjs, trail.mjs or module.yaml. No migration note: no instance-facing data changed.

## Differently
I would have made release take outcome as optional from the start, rather than defaulting in the CLI.
