# Crew — role-based agents in herdr

The crew lets you seat agents in **roles** and watch them work. A role is a file in `roles/`. An
agent is a live session in a [herdr](https://herdr.dev) pane, working in its own git worktree on
its own branch. What each agent was asked and what it reported is kept in `memory/crew/`.

There is no server and no database. If herdr restarts, nothing is stuck.

**You need:** herdr 0.9.1 or later, and a terminal inside it. Every command refuses outside
herdr. Run everything from the checkout you normally work in; that checkout's `roles/` and
`memory/crew/` are the ones in force.

## Seat an agent

```bash
npm run crew -- seat engineer "Fix the cursor race in the kms ingest. Repro: tests/…; done when that test passes."
```

This creates a branch `crew/<date>-engineer-<slug>` from `main`, a worktree for it under
`~/.org-os/worktrees/`, a new herdr workspace, and an agent named `engineer` in it. The agent is
told to read its role and its assignment, and starts.

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

## See what is happening

```bash
npm run crew
```

```
AGENT     ROLE      STATE    ASSIGNMENT               BRANCH                                AGE
reviewer  reviewer  blocked  Review the cursor fix    crew/2026-10-10-engineer-fix-the-c…   3m
engineer  engineer  working  Fix the cursor race in…  crew/2026-10-10-engineer-fix-the-c…   18m

Open handoffs: 1
  engineer → researcher: "Confirm what the cursor contract promises"
```

- `blocked` means the agent is waiting for you: a permission prompt or a question.
- **Open handoffs** are requests one agent wrote for another role. Seat the role with
  `--handoff <id>`, or decline with `handoff-close <id> --reason "…"`.
- **Needs release** lists assignments whose agent is gone or whose seating failed.

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

The assignment is closed and **its branch is kept**: review and merge it yourself. The worktree
is removed only if it has no uncommitted changes; otherwise the command lists them and leaves it.
Release is refused while the agent is still working. Use `--outcome abandoned` for work you are
dropping.

Commit `memory/crew/` with the rest of your session's memory.

## Roles

Edit a file in `roles/` to change a role; add a file to add one. `roles/README.md` explains the
fields, the boundaries every role shares, and the charter.

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
7. `git branch --list 'crew/*'` shows the branch; `git worktree list` no longer shows the
   worktree; `npm run crew` → `No crew agents are seated.`
8. Clean up the throwaway: delete the smoke branch and the smoke file in `memory/crew/`.
