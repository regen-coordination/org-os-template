---
id: 2026-10-10-engineer-seat-waits-for-the-new-pane-s-shell-befo
role: engineer
agent: engineer-2
kind: claude
branch: crew/2026-10-10-engineer-seat-waits-for-the-new-pane-s-shell-befo
detached: false
pane: 'wV:p1'
workspace: wV
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-seat-waits-for-the-new-pane-s-shell-befo
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T21:13:29-03:00'
updated: '2026-10-10T21:16:04-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Seat waits for the new pane's shell before starting the agent

Goal. Tonight a seat failed at the start step with herdr's error "agent target pane wP:p1 is not an available shell": herdr was asked to start the agent before the freshly created pane had reached its shell prompt. Seating again a moment later worked. seat should retry the agent start for a few seconds on that error instead of failing, so the operator does not have to release a failed record and seat again. (Operator's item 11.)

Already known. You start from crew/2026-10-10-engineer-crew-command-edges-plain-errors-honest-p, an unmerged branch that already changed seat, nudge and herdr.mjs (herdr calls now have a timeout and createHerdr takes {bin, timeoutMs}; a stub-binary test exists in tests/scripts/crew-herdr.test.mjs). Read its diff against feat/crew before you start. The failed record is /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-engineer-board-and-release-tell-the-truth-about-e.md (read only): it holds only the message, not herdr's error code, so the code is not known. Do not call the real herdr to find out; match in a way that works without knowing the code and say in your report what you matched on. Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md sections 5, 5.3 and 10. Code: the start step in seat, scripts/crew/core.mjs; startAgent in scripts/crew/herdr.mjs.

Constraints. Retry only this error: agent_not_ready keeps its meaning (the agent is there, stopped at a dialog; seated, not prompted), and any other start error fails the seating at once as now. The wait is bounded (a few seconds in total) and, when it runs out, seating fails as today with herdr's text plus a sentence saying how long it waited. core.mjs stays pure: no real sleeping in a unit test, so make the wait injectable or put the retry in the adapter and test it with the stub binary; you choose and say why. Also record herdr's error code beside the message in a failed record (the message alone was not enough tonight), keeping old records readable. Do not touch release, board or renderBoard in core.mjs or the release and board cases in crew.mjs: another unmerged branch owns those. A new test file must be added to modules/org-os-crew/module.yaml and tests/clone-manifest.txt, as the manifest test on your base now requires; prefer the existing test files.

Done means. A test that fails on your base and passes after for: start succeeds on a later attempt; the wait runs out; a different error is not retried; agent_not_ready is not retried. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs` pass. Spec section 5.3 and docs/CREW.md gain the sentence that records this herdr behaviour. Logical commits on your branch; nothing pushed or merged. Report with commands and counts and what you would do differently, then hand off to reviewer naming your branch with --branch: the reviewer will review your branch and the one under it together.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T21:15:09-03:00

# Report: seat waits for the new pane's shell

Branch: crew/2026-10-10-engineer-seat-waits-for-the-new-pane-s-shell-befo (two commits on top of crew/2026-10-10-engineer-crew-command-edges-plain-errors-honest-p; nothing pushed or merged).

## What changed
- `scripts/crew/herdr.mjs`: `startAgent` retries when herdr says the pane "is not an available shell", every 0.5 s for up to 8 s (`startWaitMs`, `startRetryMs` options on `createHerdr`). When the time runs out it throws the same code and herdr's text plus "(crew waited N seconds for the pane to reach its shell, then gave up)". Any other error, and `agent_not_ready` whatever its text, is thrown at once. The sleep is `Atomics.wait`, so core.mjs stays pure and the retry is tested with the stub binary.
- `scripts/crew/core.mjs`: a failed record also gets `error_code` beside `error` (only when herdr gave a code; old records without it read as before).
- Spec section 5.3 item 7 and docs/CREW.md describe the behaviour.

## What I matched on
The message text, case-insensitively: `/not an available shell/i`, on any code except `agent_not_ready`. The code was not known and I did not call the real herdr.

## Proof
`node --test "tests/scripts/crew-*.test.mjs" tests/scripts/module-manifests.test.mjs` -> tests 102, pass 102, fail 0.
Before the change, the new tests failed on the base (retry test, wait-runs-out test, error_code assertion). New tests in crew-herdr.test.mjs: start succeeds on a later attempt; wait runs out with herdr text and wait length; other error not retried; agent_not_ready not retried. crew-seat.test.mjs asserts `error_code` on a failed start. No new test file, so no manifest change.

## Why it happened
`seat` asked herdr to start the agent immediately after `worktree create` returned; the pane exists before its shell is ready, and nothing waited or retried.

## Notes
- The wait (8 s) is a guess; the real shell-ready time is unmeasured. Worth one live seating to confirm it is enough.
- Instance-facing migration note: none needed (new optional record field).
- `Atomics.wait` blocks the process; fine for a CLI, would not be in a server.

## Would do differently
Ask herdr for a readiness signal (or poll `pane get`) instead of retrying on an error message, once the error code is known.
