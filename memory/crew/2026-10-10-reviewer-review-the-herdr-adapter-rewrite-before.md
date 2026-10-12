---
id: 2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with
detached: true
pane: 'w19:p1'
workspace: w19
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before
task: null
handoff: handoff-2026-10-10-review-branch-crew-2026-10-10-engineer-r
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:41:53-03:00'
updated: '2026-10-10T23:46:46-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the herdr adapter rewrite before it becomes the code that seats every agent

Goal. Give a pass or fail verdict on the branch you are seated on: three commits on feat/crew (a46e3b4), `git diff feat/crew...HEAD`, about 800 lines. On a pass the lead merges it into feat/crew and pushes. The main checkout's scripts are the ones the crew itself runs, so the moment this merges, every seat, nudge and release goes through it. A defect on the ordinary path (a start that works first time) would stop the crew from seating anyone, including the engineer who would fix it. Weigh findings by that.

The claims, in the engineer's words, are in the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with.md (read only): part A (start retry on code agent_pane_busy with a look at `agent list` and `pane process-info`; a cut-off start looks before deciding and never starts twice; six codes that prove a prompt was not sent; leftovers named after a failed worktree step), part B (review findings F1 to F4), part C (`seat --handoff --base`). The source facts they rest on: `git show crew/2026-10-10-researcher-what-herdr-does-when-an-agent-is-started:docs/research/2026-10-10-herdr-agent-start-readiness.md`. The engineer lists where it departed from that note; judge each departure.

Check, in this order.
1. The ordinary path. Trace seat from createWorktree to the first prompt for a start that succeeds at once, and for agent_not_ready. Exactly which herdr calls are made, with which arguments, compared with a46e3b4? Any new call, changed argument or changed parsing on that path is a finding even if harmless. Run the stub-binary tests and say what the stub proves and does not prove about the real herdr.
2. Read-only reality. You may run read-only herdr commands (`herdr agent list`, `herdr pane process-info`, `herdr pane list`, `herdr agent get`, any `--help`) and compare their real JSON with what scripts/crew/herdr.mjs parses and what the test stubs return. Field names, nesting, null cases. Do not run any herdr command that creates, starts, prompts, moves, closes or removes anything.
3. The refusal paths: can any path start an agent twice, retry after a cut-off, or loop longer than its stated ceiling? What is the worst-case time seat can now block, and is anything printed while it waits?
4. Prompt codes: for each of the six "not sent" codes, would a wrong classification cause a resend to an agent that did receive the prompt? Spec section 10 says never resend.
5. Parts B and C: each of F1 to F4 closed as the previous reviewer described; `--base` with `--handoff` (new branch, handoff taken, its branch named in the assignment file), `--base` with `--on` refused before anything is written, and no change when `--base` is not given, including the default base "main".
6. Old trail files and records written by a46e3b4 still read and release.
7. Docs: spec 5.3 and 10, docs/CREW.md and the skill say what the code does; the "unverified" list is honest. Anything that should not be pushed: secrets, personal data, this machine's paths in committed files.
Before you begin, read the "Before you begin" section your first prompt points at, and name in your report what you read.

Done means. A verdict, pass or fail, with the exact commands run (`npm ci --ignore-scripts`; `node --test "tests/scripts/crew-*.test.mjs"`; `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`) and counts, whether you ran the new tests against a46e3b4, expected versus actual for each finding with file and line, and for each whether it must be fixed before merge or can follow. Say plainly whether you would let this code seat the next agent. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:46:23-03:00

## Report

**Verdict: PASS.** I would let this code seat the next agent. One finding (F-1) is a real defect on a failure path and should be fixed soon, but it is not on the ordinary path and does not need to block the merge. The rest are minor.

Branch under review: detached HEAD e89dd8b (three commits over feat/crew a46e3b4, 11 files, +814/-100). I changed nothing.

### What I read
roles/reviewer.md, my assignment, roles/README.md ("Before you begin" and shared boundaries). From my own worktree: MASTERPLAN.md, SOUL.md, MEMORY.md, all present and read. Also the engineer's report and the researcher's note (`git show crew/2026-10-10-researcher-...:docs/research/2026-10-10-herdr-agent-start-readiness.md`). Absent: nothing.

### Commands run and counts
- `npm ci --ignore-scripts`: completed.
- `node --test "tests/scripts/crew-*.test.mjs"`: tests 151, pass 151, fail 0.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: tests 25, pass 25, fail 0.
- New tests against a46e3b4: `git archive a46e3b4` into a scratch dir, this branch's `tests/scripts/crew-*.test.mjs` and `tests/helpers/crew-fixtures.mjs` copied over: 115 loaded, 98 pass, 17 fail; `crew-seat.test.mjs` does not load (`typeYourself` not exported), so its new tests also fail there. This matches the engineer's claim. A passing check can fail: yes, the same tests go red on the old code.
- Ordinary path, clean room: a stub binary logging argv, driven through `createHerdr` from a46e3b4 and from this branch, calling createWorktree, startAgent, promptAgent. Both print exactly: `worktree create --cwd /r --branch crew/x --base main --path /w --label eng --no-focus`, `agent start eng --kind claude --pane w9:p1 -- --model sonnet`, `agent prompt eng hello`. Identical. For `agent start` answering `agent_not_ready` (stub): one call on both, same code and message thrown; no extra look. core.mjs treats it as before (seated, not prompted).
- Read-only herdr 0.9.1: `agent list`, `pane list`, `pane process-info` (own pane and five bare-shell panes).

### 1. Ordinary path
No new call, argument or parsing on a start that works first time, or on `agent_not_ready`. In core, `createWorktree` receives `base: ref` where `ref = on || base || 'main'`, which equals the old value whenever `on` is null. Extra calls appear only after a failure (look = `agent list`, `pane process-info`).
What the stubs prove: the argument shapes and the control flow. What they do not: any real `agent_pane_busy` answer (never observed; the engineer says so too), timing of a real shell, or that herdr's source matches the installed binary.

### 2. Read-only reality
Real `agent list`: `result.agents[]` with `pane_id`, `name` (only on named agents; 11 of 51 here), `agent`, `agent_status`, `workspace_id`; matches `listAgents` and `agentOnPane`. Real `process-info`: `result.process_info.{shell_pid, foreground_process_group_id, foreground_processes[{name, argv0, argv, pid}]}`. A bare zsh pane is `[["zsh","zsh",<pid == shell_pid == pgid>]]`, exactly what `paneState` calls bare. A running claude pane shows `name` "2.1.296", `argv0` "claude", so matching argv0 is right. Field names, nesting and the bare-shell case agree with the parser and the stubs. Null case: an empty `foreground_processes` is read as "starting", fail-safe. Not observable read-only: the shape for a pane that is mid-start.

### 3. Refusal paths
- Starts twice? I found no path. Retries follow only `agent_pane_busy` (refused, so not accepted) or the one extra try on a bare shell. After `herdr_timeout`, `timeout`, `agent_start_transport_failed` or `herdr_error` crew only looks. `agent_name_taken` is never retried.
- Loops: bounded by the 30 s ceiling (checked after each look) plus a single extra try on a bare shell. Worst case for the start step is about 30 s + one hung retry (60 s) + two looks (10 s each), about 110 s; a hung call at the start costs 60 s + 20 s. Whole seat worst case about 230 s (worktree 60, start 110, prompt 60), versus about 190 s before. Nothing is printed while it waits (F-3).

### 4. Prompt codes
`empty_agent_prompt`, `agent_not_found`, `agent_target_ambiguous`, `agent_blocked`, `agent_not_ready`, `herdr_missing`. Crew calls `agent prompt` without `--wait` (`herdr.mjs` promptAgent), which is why none of these can arrive after delivery per the note's source reading. A resend after a wrong classification would need herdr to return one of them after queueing input; the note's source says it does not (v0.9.1 tag, not verified to equal the binary). `agent_prompt_failed`, `timeout`, `agent_prompt_stalled`, `herdr_timeout` and anything unknown stay unconfirmed, and nudge refuses them. I accept the widening; it rests on source, not observation, and the docs say so.

### 5. Parts B and C
- F1: a closed record with `worktree_removed: false` and a missing worktree is set true and reported as already removed (test passes; fails on a46e3b4). Closed for the operator who runs `release <id>`. The board still shows nothing for such a record (F-4).
- F2/A5: `may_remain` is recorded and printed. Gap: see F-1.
- F3: the prompt is one line and says the files are at the root of the agent's own worktree and what to do if the section is missing. `scripts/crew.mjs` now uses `typeYourself`, the older third copy is gone; `node --check` ok.
- F4: a lookup timeout says "asked which worktree its workspace is open on, so nothing was removed"; a removal timeout still says "asked to remove the worktree".
- C: `--base` with a handoff branch gives a new branch from that base, the handoff taken, a `## Handoff` section names its branch; `--base` with `--on` throws before anything is written; without `--base` a handoff branch still seats a detached copy; the default base is still "main" (`ref = on || base || 'main'`). Tests at tests/scripts/crew-flow.test.mjs:121-175.

### 6. Old trail files
Records written by a46e3b4 have no `may_remain`; `releaseLines` guards it with `Array.isArray`. `worktree_removed` is strictly compared with false, so records without the field are unaffected. The existing "prompted true or false before this change" test passes. I did not hand-write an a46e3b4 trail file beyond what the suite does.

### 7. Docs and what should not be pushed
Spec 5.3 items 7-12, spec 10, docs/CREW.md and the skill describe what the code does, and the "unverified" list is honest (two items in the engineer's list I would add: nothing real was observed for `agent_pane_busy`, and herdr's own 2 s retry is not accounted for). One inexact statement: "up to 30 seconds" is the ceiling on waiting, not on the step (F-3). Grep of the diff for `/Users/`, the operator's name, `.cache`, `.org-os`, tokens and keys: no hits. No secrets or machine paths in committed files.

## Findings

**F-1. Advice after a timed-out worktree step is a dead end, and the record forgets a worktree that may still appear. Fix soon; need not block the merge.**
- File: scripts/crew/core.mjs:565 (message), :531 (record write), :551 (wording).
- Input: `seat` where `createWorktree` answers `herdr_timeout`; then `release <id>` on the failed record.
- Expected: the output says to run release again if the worktree appears, and a second release can do that.
- Actual (reproduced, scratch test): the first release prints "...If the worktree or branch crew/... appears now, run release again.", marks the record `released` with `worktree_removed: true`; the second `release 2026-10-10-reviewer-x` answers `No open assignment matches "2026-10-10-reviewer-x"`. A worktree that herdr then finishes is on disk, in no open record, and not on the board. The same output also says "Its branch ... was never created, so there is no branch to keep" two lines above "may still have been creating it", which contradicts it.
- Command: the repro is a four-line variant of crew-board.test.mjs:468.
- Suggested fix: after a worktree-step timeout leave the record `worktree_removed: false` (so `unfinishedRemoval` finds it later), or change the advice to name `git worktree list` and the herdr workspace list, and drop the "never created" sentence when `may_remain` names the branch.

**F-2. A failed look replaces the real error on `agent_name_taken`. Minor; can follow.**
- File: scripts/crew/herdr.mjs:198-201.
- Input: second start answers `agent_name_taken` while `agent list` hangs or is unreadable.
- Expected: `agent_name_taken` is reported (as the cut-off branch does with `catch { throw err }`). Actual: the look's own `herdr_timeout`/`herdr_output` is thrown, and seat's message then says "herdr did not answer, so the agent may exist anyway" for a start that herdr refused. Not exercised by a test.

**F-3. Seat is silent while it waits, and the documented bound understates it. Minor; can follow.**
- File: scripts/crew/herdr.mjs:238 (ceiling), docs/CREW.md "A new pane that has not reached its shell yet".
- Expected: the operator sees something during a wait that grew from 8 to 30 s, and the docs give the real bound. Actual: nothing printed until the seat ends; the step can take about 110 s in the worst case, as in section 3.

**F-4. Small gaps the engineer partly named. Can follow.**
- A closed record whose worktree is gone and `worktree_removed: false` is not on the board (`leftBehind` needs the directory); only the operator who remembers to run `release <id>` closes it (core.mjs:422-428).
- The ambiguity message "still has a worktree" (core.mjs:458) now also covers records whose worktree is gone.
- A failed record's board line does not show `may_remain` (engineer's note).
- `--base ""` is now taken as an explicit base and quietly becomes `main`; before, it was refused as unresolvable (core.mjs:187, :204).

### What I could not run, and why
Anything that creates, starts, prompts, moves, closes or removes in herdr (brief). So I did not observe a real `agent_pane_busy`, a real cut-off start, or a real prompt refusal; those paths were judged by reading and by stubs only. I did not run `scripts/crew.mjs seat` end to end (needs a live herdr and would seat an agent).

### What went wrong in my own review
I read the engineer's report before the code, and checked the docs last; the F-1 dead end was found only because I reproduced the release flow rather than trusting the test, which asserts the message and not that the advice works. A passing test there examined the wording, not the follow-up.
