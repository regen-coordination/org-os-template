---
id: 2026-10-10-reviewer-review-the-command-edges-stack-crew-defe
role: reviewer
agent: reviewer-2
kind: claude
branch: crew/2026-10-10-engineer-seat-waits-for-the-new-pane-s-shell-befo
detached: true
pane: 'wX:p1'
workspace: wX
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-reviewer-review-the-command-edges-stack-crew-defe
task: null
handoff: handoff-2026-10-10-review-branch-crew-2026-10-10-engineer-s
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:16:09-03:00'
updated: '2026-10-10T21:21:52-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the command-edges stack (crew defects 4 to 11) and its merge with the release stack

Goal. Give the operator a pass or fail verdict on the branch you are seated on, so they can merge it into feat/crew. It is two engineers' work stacked: crew defects 4 to 10 (first four commits) and defect 11 (last two). Neither has been reviewed. The whole change is `git diff feat/crew...HEAD`.

The claims, by the operator's item numbers.
4. `report --file <missing file>` prints one plain sentence and exits 1, not a raw file-system error.
5. A first prompt that was attempted but not confirmed by herdr is recorded as prompted: 'unconfirmed', kept apart from never sent (false); nudge refuses it, because spec section 10 says never resend; the seat command says honestly that the prompt may or may not have arrived and what to type in the pane. A failed nudge also becomes unconfirmed. Old trail files with true or false still work.
6. A brief beginning with a dash works after `--`, and USAGE and the error say so, for seat and handoff.
7. herdr calls time out (default 60 s) with HerdrError code herdr_timeout; a prompt timeout lands in the unconfirmed path, a start timeout fails the seating.
8. A trail file whose name contains .sync-conflict- is not read as a record; it is listed under "Could not read" and never deleted.
9. modules/org-os-crew/module.yaml lists each crew test file and the fixtures helper by name, and the manifest test fails when a crew test on disk is not listed.
10. An assignment file for a role with may_seat: true also lists board, seat (with --base guidance), nudge, release and handoff-close by the main checkout's absolute script path; other roles do not get them.
11. startAgent retries for up to 8 s while herdr says the pane "is not an available shell" (matched on the message text, since the error code is not known), not on agent_not_ready or any other error; a failed record also keeps herdr's error code.

Where to look (trail files are read only). The engineers' reports, with their own stated gaps: Report sections of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-engineer-crew-command-edges-plain-errors-honest-p.md and /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-engineer-seat-waits-for-the-new-pane-s-shell-befo.md. Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md sections 5, 5.3, 6, 7, 10, 12, 13. Code: seat, nudge, assignmentBody in scripts/crew/core.mjs; scripts/crew.mjs; scripts/crew/herdr.mjs; scripts/crew/trail.mjs.

Look especially for. Whether the new tests fail on the old code (say whether you ran this or read it). Item 5: every path by which `prompted` gets each of its three values, and anything else in the repository that reads `prompted` as a boolean. Item 7 and 11 together: the worst-case time a seat can now block, and whether a start that timed out might have started the agent anyway (the same doubt herdr states about prompts). Item 11: whether retrying a start can ever start an agent twice. Item 8: a conflict copy of a handoff file; a name that merely resembles the pattern. Item 10: read the commands as a lead that knows nothing else; are they enough and correct (run the ones that are safe, such as --help). Item 9: what happens to a new instance (tests/clone-manifest.txt, tests/clone-genesis.test.mjs). You cannot call the real herdr for seat; say what was therefore not run.

Also check the merge. The other stack, crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r (release, board, renderBoard; under separate review), merges with this one without textual conflicts by `git merge-tree`. In a scratch clone or scratch directory outside your worktree's tracked files (do not commit to any branch in this repository), merge the two and run `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` on the result. Report the counts and anything that only breaks when the two are together.

Done means. A verdict, pass or fail, with the exact commands run and their counts, expected versus actual for each finding with file and line, and for each finding whether it must be fixed before merge or can follow. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:20:36-03:00

# Review: command-edges stack (defects 4-11) + merge with the release stack

## Verdict: PASS. Nothing must be fixed before merge. Four findings can follow.

Reviewed commit 43e5581 (`git diff feat/crew...HEAD`, merge-base = feat/crew 16673ad). I changed nothing in the branch; scratch copies live in the session scratchpad.

## Commands and counts (clean room: `npm ci --ignore-scripts`, then)
- `node --test "tests/scripts/crew-*.test.mjs"` on HEAD -> tests 98, pass 98, fail 0.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` on HEAD -> tests 25, pass 25, fail 0.
- Merge (scratch clone, detached 43e5581, then `git merge origin/crew/2026-10-10-engineer-fix-review-findings-on-release-retry-a-r`, tip 7a7233e): auto-merged docs/CREW.md, scripts/crew.mjs, scripts/crew/core.mjs, no conflicts. Same two commands on the result -> crew tests 111/111 pass; manifests + clone-genesis 25/25 pass. Nothing breaks only when the two are together. Semantic read of the merged core.mjs: `prompted` is touched only by seat/nudge/crew.mjs; board/renderBoard (other stack) do not read it.

## Do the new tests fail on the old code? RAN, not read
Archived feat/crew into scratch, overlaid HEAD's crew-cli, crew-herdr, crew-seat, crew-trail, module-manifests tests and the fixtures helper, ran them: tests 54, pass 39, fail 15. Failures cover items 4, 5 (seat and nudge), 6, 7 (3 tests), 8, 9, 10, 11 (4 tests). One of them ("a herdr that answers in time is unaffected") fails only because old createHerdr takes no `bin`, so it proves little.
Item 9 and the new-instance check (A passing check must be able to fail): in a scratch copy, deleting crew-herdr.test.mjs from tests/clone-manifest.txt fails "the clone's path set matches tests/clone-manifest.txt exactly"; deleting it from module.yaml fails "org-os-crew owns the roles...". Both directions are guarded. Caveat: the scratch copy was an archive, not a git repo, so the other clone-genesis tests failed in both runs for that reason and say nothing.

## Per item
- 4 report --file: `node scripts/crew.mjs report --file /nope/x.md` -> one sentence "The report file /nope/x.md could not be read: it does not exist. ...", exit 1. A directory -> "it is a directory, not a file", exit 1. As claimed.
- 5 prompted. Paths to each value:
  - false: initial record (core.mjs:175); `agent_not_ready` at start (core.mjs:208-213); any start failure leaves it false with status failed.
  - true: prompt confirmed in seat (215); nudge confirmed (256).
  - 'unconfirmed': any exception from promptAgent in seat (216-219) or in nudge (250-253).
  Readers: only core.mjs:242/245 (nudge) and crew.mjs:120/126 (seat output). Nothing else in the repo reads it (grep over code, docs, skills, instance files). Old true/false files work (tested; I also read the code path). See finding 2.
- 6 dash brief: `seat engineer -5 degrees` and `handoff engineer --branch=b -x` print the parser's message plus "put -- before it (flags such as --task go before the --)" and USAGE showing both forms, exit 2. As claimed.
- 7 timeout: with a stub binary sleeping 20 s and timeoutMs 1000, createHerdr threw code herdr_timeout after 1004 ms (so the child is killed and the pipe does not hold the call). Worst-case time a seat can block: listAgents 60 + worktree create/open 60 + start up to 68 (see below) + prompt 60 = about 248 s, with no output while waiting. Start: a retry is only decided after a call returns, and the loop gives up once waited+0.5 s > 8 s, so the last call can begin at ~7.9 s and itself run 60 s: ~68 s. A timed-out call is not retried.
- 8 sync-conflict: ran readTrail on a probe directory with a valid record copied under several names. `a.sync-conflict-20260101-120000-ABC.md` and `handoff-a.sync-conflict-...md` -> not records, listed in `unreadable`. `sync-conflict-notes.md`, `b.sync-conflict.md`, `plain.md` -> still read as records. Ids come from slugify, which strips dots, so a real record cannot contain `.sync-conflict-`. Never deleted (readTrail only reads). A name like `c.md.sync-conflict-2026-ABC` does not end in .md and is skipped silently, as every non-.md file was before.
- 9 manifest: module.yaml lists the 9 crew tests and the helper; the test compares against disk (checked as above). tests/clone-manifest.txt gained crew-herdr.test.mjs, so a new instance gets the file and clone-genesis stays green.
- 10 lead commands: generated by assignmentBody for may_seat roles only (only lead has may_seat). The listed flags match USAGE exactly (seat --task/--base/--on/--handoff, release --outcome done|abandoned, handoff-close --reason, nudge, board); `--help` runs. The test for other roles checks seat, release, nudge, handoff-close, board, --base are absent. Read as a lead that knows nothing else: enough, with one gap (finding 4).
- 11 start retry: matched on `/not an available shell/i`, code `agent_not_ready` excluded, tested both ways. Can a retry start an agent twice? Only if herdr reports "not an available shell" for a start that in fact started the agent. I cannot show that herdr never does; a timeout (the realistic doubt) is not retried. `error_code` is recorded on failed records only when herdr gave one; old records read as before.

## Findings (none blocks merge)
1. A timed-out `agent start` does not say the agent may be running. Expected (brief, item 7+11): the same doubt herdr states about prompts. Actual: herdr.mjs timeout text is "herdr did not answer within 60 seconds (agent start), so crew stopped waiting for it", and core.mjs:223-224 records `failed` and says "nothing was cleaned up", nothing about a live agent. The record has the pane, so the board lists it under "Needs release" and `release` closes it (and refuses while the agent is `working`), so recovery exists; the message just does not point to it. Same for a timed-out worktree create (pane null, worktree may exist). Follow-up: add a sentence to the herdr_timeout message for start/worktree calls. Can follow.
2. A prompt that was provably not sent is recorded 'unconfirmed'. core.mjs:216-219 and 250-253 catch every error, including `herdr_missing` (ENOENT, nothing sent) and any plain refusal. Result: `herdr` vanishes between start and prompt -> nudge refused forever with "may already have arrived", which is untrue. Conservative and consistent with spec section 10, so can follow; narrow to herdr_timeout/unknown errors.
3. Spec section 10 not updated (docs/superpowers/specs/...design.md:376-384). The row "The first prompt times out" says only "stays working" and the agent_not_ready row says `prompted: false`; neither mentions 'unconfirmed', herdr_timeout, or error_code. Section 5.3 item 7 was updated. Can follow.
4. The lead's assignment commands show `seat <role> "<brief>"` and `handoff` with no mention of `--`, so a lead whose brief starts with a dash gets the error and USAGE but not the hint in its file. Minor, can follow.

## Notes
- Interaction with the release stack (not a break): every herdr call now has a 60 s timeout, including `removeWorktree` in release; a timeout there falls into the existing catch and then git removal, while herdr may still be finishing. Worth one thought when that stack is reviewed.
- The 8 s shell wait is unmeasured; engineers say so too. The board does not show 'unconfirmed' or unprompted agents, and a conflict copy shows under "Could not read" (engineer stated both).

## Not run
- `seat`, `nudge` against the real herdr (herdr exists at ~/.local/bin but seating would create panes and start agents outside my worktree): so the real error text and code for "not an available shell", whether 8 s is enough, what a timed-out `agent start` leaves behind, and whether herdr refuses a second start of the same name were not observed. All seat/nudge behaviour was read and checked through the engineers' fakes and my stub-binary timeout probe.
- clone-genesis's git-dependent tests were run only on the real worktree (pass), not on the mutated scratch copies.

## Would do differently
I should have probed the real `herdr agent start --help` read-only for a documented error table before reading the retry as unverifiable.
