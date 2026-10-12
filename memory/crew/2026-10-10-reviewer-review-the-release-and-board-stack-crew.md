---
id: 2026-10-10-reviewer-review-the-release-and-board-stack-crew
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r
detached: true
pane: 'wW:p1'
workspace: wW
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-reviewer-review-the-release-and-board-stack-crew
task: null
handoff: handoff-2026-10-10-review-the-fixes-for-the-five-findings-o
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:16:04-03:00'
updated: '2026-10-10T21:18:28-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the release and board stack (crew defects 1 to 3 plus the first review's findings)

Goal. Give the operator a pass or fail verdict on the branch you are seated on, so they can merge it into feat/crew. It is two engineers' work stacked: the fix for crew defects 1 to 3 (first two commits), which failed a first review, and the fixes for that review's five findings (last two commits). The whole change is `git diff feat/crew...HEAD`; judge the whole, with most attention on the last two commits.

Where to look (trail files are read only).
- The first review, with its five findings and evidence: Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-board-and-release-fixes-crew-defe.md
- What the second engineer says it did for each, and what it left untested: Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r.md
- Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md sections 5.2, 8, 10. Code: release, releaseLines, board, renderBoard, findActive in scripts/crew/core.mjs; rescueDetached in scripts/crew/git.mjs; the release case in scripts/crew.mjs.

Check each finding is really closed.
1. Must-fix, commit loss: a detached assignment released once (commits saved, worktree left dirty), then a new commit made in the worktree, then released again. Reproduce with real git in a scratch repository, as the first reviewer did, and show that the new commit is on a branch before the worktree goes. Also: the rescue branch name already taken; the save failing; rescue when nothing new needs saving.
2. A retry with an explicit, different --outcome is refused in one plain sentence; the same or no outcome proceeds; a first release with no flag still means done. The engineer says the CLI line that passes the flag through is not run by any test: read it.
3. releaseLines says only what is true in every combination of detached or not, worktree existed or not, branch resolves or not, removed or left, rescued or not. List any combination that prints something false or contradictory.
4. The ambiguity error for two open assignments with one agent name is no longer swallowed.
5. A retry on a closed assignment does not make the still-working check.
Then look for the failure nobody asked about, in particular anything the last two commits broke in the first two.

Done means. A verdict, pass or fail, with the exact commands run (`npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"` with counts), which new tests you confirmed fail on the old code and how, expected versus actual for each finding with file and line, and for each finding whether it must be fixed before merge or can follow. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:17:57-03:00

# Review: release and board stack (crew defects 1-3 + first review's five findings)

**Verdict: PASS.** All five findings are closed and no commit loss is reproducible. One minor false sentence in `releaseLines` can follow (finding A below). Nothing must be fixed before merge.

## Commands run
- `git diff feat/crew...HEAD` (4 commits, 8 files); read in full, most attention on 96c0756 and 7a7233e.
- `npm ci --ignore-scripts` -> ok.
- `node --test "tests/scripts/crew-*.test.mjs"` -> tests 98, pass 98, fail 0 (engineer's count confirmed).
- Fail-first, by running: scratch copy of HEAD with scripts/crew/core.mjs, git.mjs and crew.mjs from bb7a7f7 (the end of the first engineer's work), plus a stub `releaseLines` so the file loads; `node --test tests/scripts/crew-board.test.mjs tests/scripts/crew-git.test.mjs` -> tests 36, pass 29, fail 7. Failing: both finding-1 core tests (saves a commit made after the first release; does not remove when new commits could not be saved), the rescueDetached real-git test, the outcome-refusal test, the ambiguity test, the closed-retry pane test, and the releaseLines test. One per finding, as claimed.
- Clean room, real git (scratch repo, real `createGit`, fake herdr): detached assignment, commit c1 + dirty file, release 1 -> `crew/<id>` at e7e1f6f, worktree left; commit c2 in the worktree, release 2 -> `crew/<id>-2` at f6de05e, `git branch --contains <c2>` prints `crew/<id>-2`, first branch not moved, recorded `rescued_branch` is `-2`.
- CLI end to end (scratch root with a copy of scripts/, fake `herdr` on PATH returning no agents, a real dirty detached worktree recorded as abandoned, worktree_removed false):
  - `release aaa --outcome done` -> exit 1, "aaa is already abandoned; a retry only finishes removing the worktree."
  - `release aaa --outcome abandoned` and `release aaa` -> proceed, outcome stays abandoned, lists `?? dirty`.
  - `release aaa --outcome bogus` -> "The outcome must be done or abandoned".
  - So the `outcome: values.outcome` line in scripts/crew.mjs:123 works; parseArgs has no default for it. First release with no flag -> "is released" (probe).

## Findings, each checked
1. Commit loss: CLOSED. Reproduced above. Name taken -> suffix (git.mjs rescueDetached loop; earlier branch never moved). Save failing -> core.mjs:~342 catch puts the reason in `left`, removal is skipped, worktree stays (test "does not remove ... could not be saved"). Nothing new -> rescueDetached returns null, `?? rescued` keeps the recorded branch (test "keeps the recorded branch").
2. `--outcome` on retry: CLOSED. Verified through the CLI (above). core.mjs:~323 refuses only when closed and an explicit outcome maps to a different status.
3. releaseLines truthfulness: CLOSED for every combination I could construct, except A below.
4. Ambiguity not swallowed: CLOSED (core.mjs:~308: closed ones are consulted only when no open record matches id or agent; fail-first confirmed).
5. Closed retry skips the working check: CLOSED (core.mjs:~327 `closed ? null : ...`; fail-first confirmed).

## A. CAN FOLLOW - a failed save on a retry prints "saved" and "could not be saved" together (scripts/crew/core.mjs:~342 and releaseLines ~395)
- Input: detached assignment already rescued once to `crew/<id>`; new commit in the worktree; rescueDetached throws on the retry (fake adapter probe).
- Expected: only "could not be saved". Actual (output of the probe):
  ```
  <id> is released.
    It worked on a detached copy of feature; that branch is untouched.
    Commits made in the detached copy were saved as branch crew/<id>.
    The worktree was left at ...:
      Commits made in the detached copy could not be saved to a branch: boom
  ```
- Cause: `rescued` starts as the recorded branch on a retry, and `r.rescued` is printed as "saved". No data is lost (the worktree is left, and the line below says why), so it is a wording defect. Fix: say "earlier commits were saved as ..." or omit the line when the save failed. Test via fake adapter with a throwing rescueDetached on a retry.

## B. NOTE - not defects
- A retry with nothing new prints "Commits ... were saved as branch crew/<id>" from the earlier release. True, but not news; fine.
- `rescued_branch` holds only the newest rescue branch; older ones are ancestors and stay in git. Engineer disclosed it.
- `rescueDetached` suffix loop checks `refs/heads` via show-ref; two concurrent releases of the same id could race on the name. Not realistic, not tested.
- A first-release failure path in CLI printing still untested at process level; core + releaseLines tests cover every sentence.

## Broke anything in the first two commits?
No. Board STATUS column, `leftBehind` and the retry still behave as in the first review (its tests are in the 98). Old trail records without `worktree_removed` are still not listed (`=== false`), unchanged. No instance-facing data changed, so no migration is needed. Docs (docs/CREW.md, skills/crew/SKILL.md) say the retry refuses a different --outcome and the `-2` suffix; both match the code.

## Not run
Live herdr: only a fake `herdr` binary; the real `workspaceCheckout`/`removeWorktree` path was not exercised. The fake herdr does not remove the directory, so my probe could not confirm directory removal after the second release; the earlier tests cover that with the fake adapter.
