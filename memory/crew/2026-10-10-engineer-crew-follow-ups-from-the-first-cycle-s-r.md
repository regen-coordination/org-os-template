---
id: 2026-10-10-engineer-crew-follow-ups-from-the-first-cycle-s-r
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-10-engineer-crew-follow-ups-from-the-first-cycle-s-r
detached: false
pane: 'wY:p1'
workspace: wY
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-crew-follow-ups-from-the-first-cycle-s-r
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:18:57-03:00'
updated: '2026-10-10T23:23:05-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Crew follow-ups from the first cycle's reviews: seven small truth-telling fixes

Goal. The first crew cycle merged eleven fixes into feat/crew (now at the merge commit 03d8bb8). Its two reviews left seven findings marked "can follow". Each is a place where crew says something untrue or hides something from the operator. Fix them test-first on your branch so the operator can merge one more branch and close the cycle. Nobody else is working on crew now, so you may touch any crew file.

The findings. The reviewers' evidence, with files and lines, is in the Report sections of these trail files (read only): /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-the-release-and-board-stack-crew.md (finding A) and /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-the-command-edges-stack-crew-defe.md (findings 1 to 4 and the notes).
1. Release wording. When a retried release of a detached assignment fails to save new commits, releaseLines prints both "Commits … were saved as branch X" (from the earlier release) and "could not be saved". Say only what is true of this run: for example that earlier commits are on X and the new ones could not be saved.
2. Timeouts that may have half-happened. A timed-out `agent start` or `worktree create/open` fails the seating with "nothing was cleaned up" and no word that the agent or worktree may exist anyway. Add the honest sentence and point to the board and `release`. A timed-out call is still never retried.
3. Unconfirmed is too wide. Every failure of the first prompt is recorded as prompted: 'unconfirmed', including when herdr is missing from PATH (code herdr_missing), where nothing can have been sent and nudge would be safe. Lead's decision: only herdr_missing counts as provably not sent and leaves prompted false; every other error stays unconfirmed, because herdr's refusals are not known well enough to trust. Same rule in nudge.
4. Release and herdr timeouts. herdr's removeWorktree now has the 60 s timeout; on a timeout release falls through to removing the worktree with git while herdr may still be doing it. On herdr_timeout do not fall through: leave the worktree, list the reason, and let the operator release again (the retry path exists).
5. The board hides two things. A sync-conflict copy is shown under "Could not read", which is the wrong wording: give conflict copies their own line saying what they are and that the operator must merge them by hand (keep them out of `unreadable` or keep both, your call, but --json must let a script tell them apart). And a seated agent whose first prompt is unsent (false) or unconfirmed looks like any other row: show it, in the table and in --json.
6. The lead's command list in the assignment file does not say that a brief beginning with a dash goes after `--`. Add it, for seat and handoff.
7. Spec section 10 (docs/superpowers/specs/2026-10-10-org-os-crew-design.md) still describes the old behaviour. Update its rows for 'unconfirmed', herdr_timeout, error_code, the start retry and whatever you change here; also section 8 for the board lines, and docs/CREW.md and skills/crew/SKILL.md wherever a sentence becomes untrue.

Constraints. core.mjs stays pure (adapters and the trail only). Old trail files must keep working. A new test file must be listed in modules/org-os-crew/module.yaml and tests/clone-manifest.txt; prefer the existing test files. No dependency changes. If you judge one of these not worth a change after reading the code, leave it and say why.

Done means. Each finding has a test that fails on 03d8bb8 and passes after, or a stated reason it cannot; `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` pass; logical commits on your branch; nothing pushed or merged. Report with commands and counts, what you did per finding, and what you left. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:22:26-03:00

# Engineer report: crew follow-ups from the first cycle

Branch: `crew/2026-10-10-engineer-crew-follow-ups-from-the-first-cycle-s-r` (3 commits on 03d8bb8; nothing pushed or merged).

## Proof
- `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"` -> tests 120, pass 120, fail 0 (was 111 on 03d8bb8 + 9 new, two existing trail tests updated).
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` -> tests 25, pass 25, fail 0.
- Fail-first: I wrote the tests before the code and ran them on 03d8bb8: 10 failed, 60 passed of the three files touched (board, seat, trail). One new test ("a failure that is not a timeout does not claim anything may exist") passes on the old code by design: it guards the new sentence from leaking to other errors.
- No new test file: nothing to add to module.yaml or clone-manifest.txt. No dependency change.

## Per finding
1. Release wording (core.mjs release/releaseLines). `release` now returns `rescueFailed`. When the save failed on a retry, the line reads "Commits saved by an earlier release are on branch X." and the `left` list carries "could not be saved ...". Test fails on old code (printed "were saved as branch").
2. Timeouts (core.mjs seat). A `herdr_timeout` at the worktree or start step appends: the worktree/agent "may exist anyway. Look at the board; if this assignment is under "Needs release", run release <id>". Not retried (test asserts one call). Other errors do not get the sentence.
3. Unconfirmed (core.mjs seat and nudge). Only `herdr_missing` leaves `prompted: false` (seat) and, in nudge, throws "nothing was sent ... run nudge again" without writing 'unconfirmed'. Everything else stays 'unconfirmed'.
4. Release and herdr timeouts. `herdr_timeout` from workspaceCheckout or removeWorktree no longer falls to git: worktree left, reason listed, record is closed with worktree_removed false, so the board's "left behind" line and a second `release` work (test finishes it).
5. Board. `readTrail` now returns `conflicts` apart from `unreadable` (decision: separate, not both), board --json carries `conflicts`, renderBoard prints "Sync conflict copies: N" with a merge-by-hand sentence. Rows carry `prompted` (true/false/'unconfirmed'); the STATUS cell reads `working (first prompt not sent)` / `(first prompt unconfirmed)`. A `reported` row and an old record with no `prompted` field are not flagged.
6. Dash brief. Every assignment file now has the `--` line for handoff; the lead's also for seat. Also added to the crew skill.
7. Docs. Spec sections 5.2, 8 and 10 (rows for unconfirmed/herdr_missing, herdr_timeout, error_code, start retry, release timeout, conflicts), docs/CREW.md, skills/crew/SKILL.md.

## Why the problems existed
Each came from a catch-all: `catch {}` around the prompt, around herdr removal, and a release line that printed the recorded rescue branch as if this run had made it. The first cycle chose conservative behaviour and did not say what that conservatism meant to the operator.

## Left / notes
- Migration: no data migration. Instance-facing: `--json` board output gains `conflicts` and a row `prompted` field, and `unreadable` no longer contains conflict copies; a script that read conflicts from `unreadable` must read `conflicts`. Old trail files work unchanged.
- After a herdr_timeout during removal, if herdr did finish, the directory is gone and the record keeps `worktree_removed: false`; the board hides it (leftBehind needs the directory) and `release` says no match. Harmless, not changed.
- Not run against a real herdr (fakes and the existing stub-binary tests only). Whether herdr's own refusals could prove non-delivery is still unknown, hence the narrow rule.
- Real-herdr checkout behaviour of a timed-out `worktree create` (does it leave a branch crew/<id>?) is unverified; the new sentence says "may exist", not what it is.
- Docs `npm run generate:schemas` produced no changes.

## Would do differently
Put the "what does the operator see" sentence in the test names of the first cycle's catch blocks at the time, rather than discovering them in review.
