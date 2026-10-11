# Crew — role-based agents in herdr

The crew lets you seat agents in **roles** and watch them work. A role is a file in `roles/`. An
agent is a live session in a [herdr](https://herdr.dev) pane, working in its own git worktree on
its own branch. What each agent was asked and what it reported is kept in `memory/crew/`.

There is no server and no database. If herdr restarts, nothing is stuck.

**You need:** herdr 0.9.1 or later, and a terminal inside it. Every command refuses outside
herdr. Run everything from the checkout you normally work in; that checkout's `roles/` and
`memory/crew/` are the ones in force.

Worktrees are created under `~/.org-os/worktrees/`, outside the repository. To put them
elsewhere, set `ORG_OS_WORKTREES` to an absolute path in your shell profile, so that every pane
sees the same value.

## Seat an agent

```bash
npm run crew -- seat engineer "Fix the cursor race in the kms ingest. Repro: tests/…; done when that test passes."
```

This creates a branch `crew/<date>-engineer-<slug>` from `main`, a worktree for it under
`~/.org-os/worktrees/`, a new herdr workspace, and an agent named `engineer` in it. The agent is
told to read its role, its assignment, and the "Before you begin" section of `roles/README.md`
(by default `MASTERPLAN.md`, `SOUL.md` and `MEMORY.md` in its worktree), then starts. Crew checks
none of this; the agent reports what it read and what was absent.

- `--base <ref>` starts the branch somewhere other than `main`.
- `--on <branch>` seats the agent on a detached copy of an existing branch and creates no branch.
  Use it for review.
- `--task <id>` records a task id from `data/tasks.yaml` on the assignment.

Or ask your session: "seat an engineer on the cursor race". The `crew` skill writes the brief
and runs the command.

**If the agent stops at a dialog on start** (Claude asks whether to trust a new folder), the
command says it has not been prompted. Answer the dialog in the agent's pane, then:

```bash
npm run crew -- nudge engineer
```

**A new pane that has not reached its shell yet** makes herdr refuse to start the agent
("is not an available shell"). Seat waits for it, for up to 8 seconds, and only then fails; a
failed record keeps herdr's `error` text and its `error_code`.

**If a seating step times out** (herdr did not answer within 60 seconds), the command says the
worktree or agent may exist anyway. Look at `npm run crew`: the assignment is under "Needs
release", and `release` closes it. A timed-out call is never retried.

**If herdr did not confirm the first prompt** (it timed out or failed after being sent), the
command says it "may or may not have arrived". Look at the agent's pane: crew never resends,
and `nudge` refuses. The one exception is a herdr that is not on PATH: nothing can have been
sent then, so the agent counts as not prompted and `nudge` works once herdr is back. If the agent has not started, type into its pane what the command printed
(the role file and assignment file paths).

A brief that starts with a dash is read as an option; put `--` before it, after any flags:
`npm run crew -- seat engineer --task t1 -- "-5 degrees is too cold"`.

## See what is happening

```bash
npm run crew
```

```
AGENT     ROLE      STATE    STATUS    ASSIGNMENT               BRANCH                                AGE
reviewer  reviewer  blocked  working   Review the cursor fix    crew/2026-10-10-engineer-fix-the-c…   3m
engineer  engineer  idle     reported  Fix the cursor race in…  crew/2026-10-10-engineer-fix-the-c…   18m

Open handoffs: 1
  engineer → researcher: "Confirm what the cursor contract promises"
```

- `STATE` is what herdr sees live. `blocked` means the agent is waiting for you: a permission
  prompt or a question.
- `STATUS` is what the assignment's trail file says: `seating`, `working` or `reported`. An
  agent that is `idle` and `reported` has finished and is waiting for you to release it.
- **Open handoffs** are requests one agent wrote for another role. Seat the role with
  `--handoff <id>`, or decline with `handoff-close <id> --reason "…"`.
- **Needs release** lists assignments whose agent is gone or whose seating failed.
- A `STATUS` of `working (first prompt not sent)` or `working (first prompt unconfirmed)` marks
  an agent that may never have been told what to do. See the two cases under "Seat an agent".
- **Sync conflict copies** lists copies Syncthing kept when two machines changed a trail file at
  once. They are not read as records and are never deleted; merge each by hand, then delete it.
  **Could not read** lists trail files that could not be parsed.
- **Worktrees left behind** lists released or abandoned assignments whose worktree release kept
  because it had changes in it, or because it could not be removed or its commits could not be
  saved. Run `release` on one again after you have dealt with what the command listed.

## Let a lead coordinate

```bash
npm run crew -- seat lead "Goal: … Constraints: … Done when: …"
```

The lead may seat other roles and take handoffs. Every other role can only ask, in writing. At
most four crew agents are seated at once; change `max_agents` in `roles/circles.yaml`.

## Release

```bash
npm run crew -- release engineer
```

The assignment is closed and **its branch is kept**: review and merge it yourself. Release is
refused while the agent is still working. Use `--outcome abandoned` for work you are dropping.

The worktree is removed only when nothing in it would be lost. Modified, untracked and
git-ignored files all count (a `.env`, a draft in an ignored folder); installed dependencies do
not. Otherwise the command lists what is there and leaves the worktree. When you have dealt with
it, run `release` on the same assignment again: it retries the removal, never forces it, and
keeps the outcome (`released` or `abandoned`) it already recorded. Giving `--outcome` on a retry
that differs from the recorded one is refused; the same one, or none, is accepted.

An agent seated with `--on` works on a detached copy and has no branch of its own. If it made
commits, release saves them as a branch `crew/<assignment-id>` and tells you. A retry saves
commits made since (for example ones you committed in the worktree) under `crew/<assignment-id>-2`
and so on; an earlier rescue branch is never moved. If a retry cannot save the new commits, it
says that, names the branch an earlier release made, and leaves the worktree.

If herdr does not answer within 60 seconds when release asks it to remove the worktree, the
worktree is left, because herdr may still be removing it. Run `release` again a little later.

Commit `memory/crew/` with the rest of your session's memory.

## Roles

Edit a file in `roles/` to change a role; add a file to add one. `roles/README.md` explains the
fields, what every seat reads first ("Before you begin", which you edit to change the list), the
boundaries every role shares, and the charter.

## Smoke run

Run this once after installing or changing crew. It needs a real herdr and uses a little model
usage. Use a throwaway brief.

1. `npm run crew` → `No crew agents are seated.`
2. `npm run crew -- seat engineer "Smoke run. Create SMOKE.md containing the word ok, commit it, then report."`
   → prints the agent, assignment, branch and worktree. A new workspace appears in herdr.
3. If it says the agent has not been prompted, answer the dialog in its pane and run
   `npm run crew -- nudge engineer`.
4. `npm run crew` while it works → one row, state `working`, then `idle` or `done`.
5. When it reports: the assignment file in `memory/crew/` ends with a `## Report` section and
   its status is `reported`.
6. `npm run crew -- release engineer` → says the branch is kept and the worktree was removed.
   Releasing an assignment whose seating failed says instead that there was no branch or
   worktree.
7. `git branch --list 'crew/*'` shows the branch; `git worktree list` no longer shows the
   worktree; `npm run crew` → `No crew agents are seated.`
8. Clean up the throwaway: delete the smoke branch and the smoke file in `memory/crew/`.
