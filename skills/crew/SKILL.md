---
name: crew
version: 0.1.0
description: Seat, coordinate and release role-based agents in herdr panes. Use when the operator asks to seat a role on a piece of work, to see what the crew is doing, to hand work to another role, or to release an agent. Requires running inside herdr.
author: organizational-os
category: coordination
metadata:
  openclaw:
    requires:
      env: [HERDR_ENV]
      bins: [herdr, git, node]
      config: []
---

# Crew

The crew is a set of **roles** (files in `roles/`) that **agents** are seated in. Each agent runs
in its own herdr pane and its own git worktree, on its own branch. Everything is recorded in
`memory/crew/`. Vocabulary, the shared boundaries and the "Before you begin" reading list every seat gets:
`roles/README.md`. Operator guide:
`docs/CREW.md`.

All rules are enforced by `scripts/crew.mjs`. **When a command refuses, tell the operator what it
said. Never work around a refusal**: not by calling herdr or git yourself, not by editing files in
`memory/crew/`.

## Which command

| You want to                                                        | Run                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| See who is seated, open handoffs, what needs attention             | `npm run crew`                                          |
| Seat a role on a piece of work                                     | `npm run crew -- seat <role> "<brief>"`                 |
| Seat a reviewer on an existing branch                              | `npm run crew -- seat reviewer "<brief>" --on <branch>` |
| Take a handoff another agent wrote                                 | `npm run crew -- seat <role> --handoff <id>`            |
| Send the first prompt to an agent that stopped at a startup dialog | `npm run crew -- nudge <agent>`                         |
| Close an assignment                                                | `npm run crew -- release <agent>`                       |
| Decline a handoff                                                  | `npm run crew -- handoff-close <id> --reason "<why>"`   |

A brief that starts with a dash is read as an option: put `--` before it, after any flags
(`seat <role> --task <id> -- "<brief>"`; the same for `handoff`).

If you are a **seated agent**, your assignment file gives you two commands with absolute paths,
`report` and `handoff`. Use those exactly as written. Only the lead role and the operator may
seat, release, or close handoffs.

## Choosing a role

Read the frontmatter and the Mandate of the files in `roles/`. Pick the role whose mandate covers
the work. If none does, say so; do not stretch a role. One piece of work, one role: if the work
needs building and then checking, seat an engineer, and let it hand off to a reviewer.

## Writing a brief

The brief is everything the agent knows about the task. A good one has four parts:

1. **The goal**, and why it matters, in a sentence or two.
2. **What is already known or ruled out**, so the agent does not redo it.
3. **Where to look**: the files, docs or commits worth reading. Point at them; do not paste them.
4. **What done means**: the check that must pass, or the artifact that must exist.

Keep the first line short and specific. It becomes the assignment's name, its branch and its row
on the board.

## Reading the board

- `blocked` means the agent is waiting on a permission prompt or a question. Only the operator
  answers it. Tell the operator which agent, and do not answer for them.
- **Needs release** lists assignments whose agent is gone (herdr restarted, a pane was closed) or
  whose seating failed. Release each one once the operator has looked at its branch.
- `STATUS` is the trail's word for the assignment (`seating`, `working`, `reported`); `STATE` is
  herdr's live view. `reported` with `idle` means the agent is done and awaits release.
- A `STATUS` such as `working (first prompt not sent)` or `(first prompt unconfirmed)` means the
  agent may never have been told what to do. Tell the operator; do not nudge an unconfirmed one
  (the command refuses), and for an unsent one the operator may run `nudge`.
- **Sync conflict copies** are trail files Syncthing duplicated. They are not read as records;
  the operator merges them by hand. **Could not read** is a different thing: files that could not
  be parsed.
- **Worktrees left behind** lists closed assignments whose worktree release could not remove (it
  had changes in it, the removal failed, or its commits could not be saved). The operator deals
  with what was listed; then `release` on the same assignment retries the removal. A retry keeps
  the recorded outcome and refuses a different `--outcome`.
- **Open handoffs** are requests waiting for the lead or the operator.

## Releasing

Release when the agent has reported and the operator has what they need. The branch is always
kept; merging is the operator's. The worktree is removed only when it has no uncommitted changes.
If it is left behind, the command lists what is in it: show that list to the operator and stop.
Do not remove the worktree yourself; once the operator has dealt with it, release again. If the
list says herdr did not answer, nothing was wrong with the worktree: wait and release again.
After a seating that timed out, the worktree or agent may exist anyway: look at the board and
release the assignment under "Needs release". If it timed out creating the worktree, wait a little
first, and tell the operator that a herdr workspace may be left open that crew cannot close: the
failure message and the release output name it.

## As the lead

You are seated to coordinate, not to implement. Take the operator's goal, name the piece whose
resolution unlocks the others, and seat one role per piece with a brief each. Watch the board.
When an agent reports, read its assignment file. When a handoff appears, seat the role it asks
for or decline it with a reason. The cap on seated agents is deliberate: when it is reached, wait
for a report rather than asking for more.
