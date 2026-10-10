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
`memory/crew/`. Vocabulary and the shared boundaries: `roles/README.md`. Operator guide:
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
- **Open handoffs** are requests waiting for the lead or the operator.

## Releasing

Release when the agent has reported and the operator has what they need. The branch is always
kept; merging is the operator's. The worktree is removed only when it has no uncommitted changes.
If it is left behind, the command lists what is in it: show that list to the operator and stop.
Do not remove the worktree yourself.

## As the lead

You are seated to coordinate, not to implement. Take the operator's goal, name the piece whose
resolution unlocks the others, and seat one role per piece with a brief each. Watch the board.
When an agent reports, read its assignment file. When a handoff appears, seat the role it asks
for or decline it with a reason. The cap on seated agents is deliberate: when it is reached, wait
for a report rather than asking for more.
