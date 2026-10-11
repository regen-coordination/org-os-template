---
id: 2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with
detached: false
pane: 'w14:p1'
workspace: w14
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:31:19-03:00'
updated: '2026-10-10T23:54:56-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Replace crew's guesses about herdr with what herdr's source says, and close four review findings

Goal. Crew's herdr adapter was written from observation: it retries an agent start for a guessed 8 seconds on a message text, and treats almost every prompt failure as "may have arrived". A researcher has now read herdr 0.9.1's source and found the real codes and a real readiness signal. Build its proposal, and in the same branch close the four findings the last review left, so crew stops guessing where it can know. This is the last engineering round of this cycle.

Part A, the research proposal. The note is on an unmerged branch; read it with `git show crew/2026-10-10-researcher-what-herdr-does-when-an-agent-is-started:docs/research/2026-10-10-herdr-agent-start-readiness.md` (section "Proposal for org-os", and the source facts above it). In short:
1. Retry an agent start only on code agent_pane_busy, and only while `herdr pane process-info` shows a bare shell on that pane that is not yet in the foreground and no agent there; keep the message match as a fallback for an unknown code. The same code also means "pane already hosts an agent", which must not be retried.
2. Replace the 8 second guess with that process-info check, still bounded in total time.
3. After a start is cut off (herdr_timeout or a transport failure), look with a read-only herdr call whether the agent is there before deciding anything; never start twice. agent_name_taken on a second start means the first one took.
4. In promptAgent, these codes prove nothing was sent: empty_agent_prompt, agent_not_found, agent_target_ambiguous, agent_blocked, agent_not_ready, and the missing binary. They leave prompted false. agent_prompt_failed, timeout and agent_prompt_stalled stay 'unconfirmed'. This widens the lead's earlier rule (only herdr_missing) now that the source is known.
5. After a failed or timed-out worktree create, name what may be left (branch, checkout directory, herdr workspace) in the failed record and the message.
The researcher could not run anything that changes herdr's state, and neither may you: read-only herdr commands only (help, list, get, process-info). Where the note marks something as unverified or needing an operator experiment, build conservatively and carry the experiment into docs/CREW.md's manual smoke run so the operator can settle it.

Part B, the review findings. Full text with file and line in the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-the-follow-up-and-onboarding-stac.md (read only).
F1. release times out on removing a worktree, herdr then finishes: the record keeps worktree_removed false, the board drops it, and release says "no match" although the message told the operator to run release again. A closed record with worktree_removed false whose worktree is gone should be set true and reported as already removed.
F2. A timed-out worktree step leaves workspace null, so release goes to git removal while herdr may still be creating, and a herdr workspace may stay open that crew never learned the id of. Say so honestly; part A item 5 overlaps, do them as one.
F3. The first prompt does not say the reading-list files are at the root of the agent's own worktree (the README path it gives is the main checkout's), nor what to do when the section is missing in an older instance. Add: found at the root of your own worktree; if the section is missing, say so in your report and begin. Keep the prompt one line.
F4. A timeout in workspaceCheckout during release is reported as "when asked to remove the worktree". Say what was actually asked.

Part C, one gap the lead met tonight. `seat <role> --handoff <id> --base <ref>` on a handoff that names a branch seats the agent on a detached copy of that branch and ignores --base, because only --on overrides the handoff's branch. That is right for a reviewer and wrong for an engineer asked to build on something. Make an explicit --base win: a new branch from that base, with the handoff still taken and its branch named in the assignment file. Refuse --base together with --on.

Where to look. You start from feat/crew at a46e3b4, which has everything merged so far. scripts/crew/herdr.mjs, scripts/crew/core.mjs (seat, nudge, release, firstPrompt), tests/scripts/crew-herdr.test.mjs (stub binary), crew-seat.test.mjs, crew-board.test.mjs, crew-flow.test.mjs; spec sections 5, 5.3, 7 and 10; docs/CREW.md; skills/crew/SKILL.md. Before you begin, read the "Before you begin" section of roles/README.md and what it lists, in your own worktree.

Done means. Each item has a test that fails on a46e3b4 and passes after, or a stated reason it cannot; core.mjs stays pure; old trail files keep working; no dependency change. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` pass. Spec 5.3 records the code and the signal with the herdr version; spec 10, docs/CREW.md and the skill match the code. Logical commits, parts A, B and C apart; nothing pushed or merged. Report with commands and counts, what you did per item, which onboarding files you read, what stays unverified against a live herdr, and anything in the note you found wrong. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:41:19-03:00

## Report

Branch: `crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with` (from feat/crew a46e3b4), three commits, parts A, B and C apart. Nothing pushed or merged.

### Proof
- `npm ci --ignore-scripts` — completed.
- `node --test "tests/scripts/crew-*.test.mjs"` — tests 151, pass 151, fail 0.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` — tests 25, pass 25, fail 0.
- New tests fail on a46e3b4 (I ran it: `git archive a46e3b4` into a scratch directory, this branch's `tests/scripts/crew-*.test.mjs` and `tests/helpers/crew-fixtures.mjs` copied over): 115 tests loaded, 98 pass, 17 fail, and `crew-seat.test.mjs` does not load at all (it imports the new `typeYourself`), so its new tests (prompt codes, leftovers, F3 wording) count as failing there too. The 17 are the new herdr, board and flow tests.
- Against live herdr 0.9.1 I ran only read-only calls: `pane process-info` (own pane and a missing pane), `agent list`, `agent get` (own pane and a missing name). Nothing that changes state.

### Per item
**A1/A2 start retry** (`scripts/crew/herdr.mjs`). Retry only on `agent_pane_busy` (a code not in herdr's known start codes with the old message is a fallback). On each refusal crew reads `agent list` and `pane process-info`: an agent on the pane, or the kind's name in the foreground, stops at once with a plain reason (cause two); a shell that is not yet the foreground group is waited for; a bare shell that is the foreground and still refused is tried once more and then reported; a pane that cannot be inspected fails at once. The 8 second guess is gone: a 30 second ceiling (herdr's default start timeout) and the failure names what was still running.
**A3 cut-off start.** After `herdr_timeout`, `timeout`, `agent_start_transport_failed` or an unparsed `herdr_error`, crew looks (list, then process-info, 10 s limit) and returns as started if an agent is on that pane; otherwise throws the cut-off error saying it looked. No second start is sent after a cut-off. `agent_name_taken` counts as "the first took" only when the named agent is in that pane.
**A4 prompt codes** (`core.mjs`, `PROMPT_NOT_SENT`). `empty_agent_prompt`, `agent_not_found`, `agent_target_ambiguous`, `agent_blocked`, `agent_not_ready`, `herdr_missing` leave `prompted: false` in seat and nudge; nudge then says nothing was sent, quotes herdr and may be run again. Everything else stays `unconfirmed`.
**A5 + F2 (one change).** A failed or timed-out worktree step records `may_remain` (branch, checkout directory, a herdr workspace labelled with the agent name; no branch for `--on`, no workspace when git failed first) and the message names them, says crew never learned the workspace id and that it is closed in herdr by hand; a timeout also says wait before releasing. Release of such a record repeats the workspace line and, after a timeout, that herdr may still have been creating when release ran. Release itself is unchanged: it cannot close that workspace.
**F1.** `release <id>` now finds a closed record with `worktree_removed: false` whose worktree is gone, sets it true, says "already removed". Ambiguity between several such records asks for the assignment id.
**F3.** One-line prompt now says the files are "at the root of your own worktree (if that section is missing, say so in your report and begin)". The same sentence is used by the "type this yourself" text. I also found `scripts/crew.mjs` printed a third, older copy of that text with no reading list at all; it now calls `typeYourself` from core.
**F4.** A timeout while looking up the workspace says "asked which worktree its workspace is open on, so nothing was removed"; a timeout of the removal says "asked to remove the worktree".
**C.** `--base` explicit now wins over a handoff's branch (new branch from that base, handoff taken, a `## Handoff` section in the assignment file names its branch); `--base` with `--on` is refused before anything is written. Without `--base`, behaviour is unchanged (detached copy). `crew.mjs` passes `base: null` when not given; core's default is null, "main" is applied only when neither is given.

### Docs
Spec 5 (step 4), 5.1, 5.2, 5.3 (items 7-12 and an "unverified" list), 10; docs/CREW.md (seat options, busy pane, cut-off, leftovers, prompt exceptions, release, a smoke-run "Experiments that settle what is still unverified" list); skills/crew/SKILL.md. Core stays pure (no I/O added; the read-only look is in the adapter).

### Migration note
Instance-facing, additive: new `may_remain` field on failed records, nudge accepted in more cases, `seat --handoff --base` semantics (previously ignored). Trail files written before this change read unchanged. An instance takes it by taking `scripts/crew.mjs`, `scripts/crew/*`, the docs and the skill; no data migration and no dependency change.

### Onboarding files read (from my worktree)
MASTERPLAN.md, SOUL.md, MEMORY.md, all present and read in full. Also read: roles/engineer.md, the assignment, roles/README.md, the research note and the reviewer's report.

### Stays unverified against a live herdr (carried into docs/CREW.md smoke run)
1. Why herdr's own 2 s retry did not cover the first failure; whether 30 s is enough on this operator's shell rc.
2. That a killed `agent start` leaves the agent and a second start gives `agent_name_taken`.
3. That the installed 0.9.1 binary is the `v0.9.1` tag.
4. What a killed `git worktree add` leaves.
5. The code of `agent get <pane>` for a pane with no agent (not needed: crew lists).
Also not observed: a real `agent_pane_busy` response; all the new start tests use a stub shaped from the note, the source, and the real `process-info` and `agent list` output.

### Wrong or different in the note
- Proposal 2 said poll process-info until the shell is the foreground, then start once. The brief said retry only on the code with a check; I did the brief's: no extra calls on a seat that works the first time. The note's "foreground process in the agent's kind is the tell" does not hold by `name`: live, a running claude has `name` "2.1.296" and `argv0` "claude", so crew matches `argv0`/`argv[0]` too.
- The note does not give where the fields sit: `result.process_info.{…}`, found by running it.
- herdr's own retry condition in the note (pgid equals shell_pid and a shell name) is the "ready" condition, not "not yet foreground". The brief's reading ("not yet in the foreground") is what I implemented for waiting; the ready case gets one extra try. Which of the two the failure first seen was in is unknown (experiment 1).
- The note's `agent get <pane_id>` is not used; list is verified and sufficient.

### What went wrong / what I would do differently
My first draft of the name-taken test put an agent in the list from the first call, so crew correctly refused to retry; the test, not the code, was wrong. And two cut-off tests were flaky at 300 ms because a slow `sh` start was killed before it counted; raised to 1.5 s. I would have written the stub-shape helpers from real output first (I did, for process-info and list, only after reading the design). Design: crew still cannot close a herdr workspace it never got the id of; the proper fix is a herdr call that lists workspaces by checkout path, which I did not use because it is unverified. Not fixed, not asked: a failed record's board line does not show `may_remain`.
