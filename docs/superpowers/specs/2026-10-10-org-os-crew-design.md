# org-os Crew — Roles and Agents Through herdr — Design Spec

**Date:** 2026-10-10
**Status:** Design approved in conversation, awaiting review of this document; pre-implementation
**Owner:** roles, the crew launcher, the assignment trail
**Companion to:** [interfaces spec](2026-08-29-org-os-interfaces-design.md) (new interfaces are clients, never servers) · [modularization spec](2026-08-02-org-os-v5-modularization-design.md) (module manifests)

## 1. Purpose

org-os has been built by a team of agents organized as a cooperative: a lead plus Strategy,
Research, Engineering and Commons circles. That team has lived in a local Paperclip instance,
outside the repository. Paperclip proved heavier than the job and unreliable in ways that all
trace to state held by its server:

- an interrupted run leaves a lease the API cannot release, and the issue then refuses wake-ups;
- runs authenticate with a stored copy of the operator's Claude token, which goes stale while the
  connection still reports `connected`;
- issues with the same title are deduplicated, so a stuck issue cannot simply be recreated;
- every agent shares one checkout, so concurrent branch work collides.

This spec moves the team into org-os itself. Roles become files in the framework. Agents are
live sessions in [herdr](https://herdr.dev) panes, started by one script. The record of who did
what is plain files committed like memory. There is no server and no database.

**Who it is for:** an operator who sits at herdr, seats a few agents, and watches and steers them.

**Success means:**

1. The operator can seat a role on a piece of work with one command or one sentence.
2. Each agent works in its own git worktree and branch and cannot collide with another.
3. The lead can split a goal and seat other roles; other roles can ask for help in writing.
4. One command shows every agent, its role, its work and its live state.
5. If herdr restarts or a pane is closed, nothing is stuck: the trail says what was in flight and
   one command closes it out.

## 2. Scope

**Version 1 is attended operation only.** The operator is present. Unattended runs, schedules
and bots are the next sub-project and get their own spec.

In scope:

- Role and circle definitions as files.
- A launcher that seats, releases and lists agents through the herdr CLI.
- An assignment trail and written handoffs.
- A board in the terminal.
- A skill that lets any session do the above in plain language.

Out of scope for version 1:

- Unattended runs, schedules, wake-ups, bots.
- A web board; cost or token accounting; budgets.
- A herdr plugin; herdr's remote machines.
- Generating Claude Code subagent files (`.claude/agents/`) from roles.
- Agents prompting each other directly.
- Any change to venture-commune (section 11).

## 3. Vocabulary

These terms are defined once in `roles/README.md` (the framework has no `CONTEXT.md`).

| Term | Meaning |
|------|---------|
| **Role** | A file describing a seat: its mandate, boundaries and defaults. Not a process. |
| **Circle** | A group of roles. Five exist: lead, strategy, research, engineering, commons. |
| **Agent** | A live session seated in a role, in a herdr pane. |
| **Assignment** | One piece of work given to one role, with its branch and its outcome. |
| **Handoff** | A written request from one agent that another role take something on. |
| **Main checkout** | The repository's primary working tree, the first entry of `git worktree list`. |
| **Operator** | The human at herdr. |

"Crew" is the working name of the subsystem (script, module, trail folder). It may be renamed
before release without changing the design.

## 4. Files

```
roles/
  README.md             # vocabulary + the boundaries every role shares
  circles.yaml          # the five circles: id, name, purpose
  lead.md
  engineer.md
  reviewer.md
  researcher.md
  commons-steward.md
scripts/
  crew.mjs              # command entry point
  crew/
    core.mjs            # pure logic: roles, guardrails, trail, board join
    herdr.mjs           # the only file that calls the herdr CLI
skills/crew/SKILL.md
memory/crew/            # the trail: one file per assignment or handoff
modules/org-os-crew/module.yaml
tests/scripts/crew-*.test.mjs
```

### 4.1 Role file

```markdown
---
id: engineer
circle: engineering
kind: claude
model: sonnet
may_seat: false
skills: [superpowers-test-driven-development, superpowers-systematic-debugging]
---
# Engineer

## Mandate
What this seat is for, in a paragraph.

## Boundaries
What it must not do beyond the shared boundaries.

## Done means
What it must leave behind before reporting.
```

Frontmatter fields, all required unless noted:

| Field | Meaning |
|-------|---------|
| `id` | Lowercase, matches the file name and herdr's agent-name rule `[a-z][a-z0-9_-]{0,31}`. |
| `circle` | An id from `roles/circles.yaml`. |
| `kind` | A herdr agent kind (`claude`, `codex`, `opencode`, …). |
| `model` | Optional. Passed to the agent as its native model argument when the kind supports one. |
| `may_seat` | Whether an agent in this role may seat other roles. `true` only for `lead` in the shipped set. |
| `skills` | Optional. Names of skills the role is expected to use; advisory, read by the agent. |

The frontmatter is read by the launcher. The body is read by the agent. The body is handed over
as a file path in the first prompt, never through a flag specific to one agent kind, so a role
works unchanged across kinds.

### 4.2 Shared boundaries

`roles/README.md` states once what every role obeys, and each role file refers to it:

- Work only inside your own worktree. The two exceptions are in section 6.
- Never push, merge, open pull requests or post to any outside service.
- Never run stash, clean or hard-reset operations (the framework's workspace-safety rules).
- Report before stopping: append your report to your assignment file.

### 4.3 Shipped roles

| Role | Circle | Kind / model | May seat | Purpose |
|------|--------|--------------|----------|---------|
| `lead` | lead | claude / opus | yes | Takes a goal from the operator, splits it, seats roles, picks up handoffs. |
| `engineer` | engineering | claude / sonnet | no | Implements a brief test-first on its branch. |
| `reviewer` | engineering | claude / sonnet | no | Reviews another assignment's branch; changes nothing. |
| `researcher` | research | claude / sonnet | no | Answers a question from primary sources; writes findings to a file. |
| `commons-steward` | commons | claude / sonnet | no | Tends docs, knowledge and decisions records for consistency. |

The strategy circle ships with no role in version 1; the circle exists so a role can be added as
a file. Initial text for the five roles is carried over from the cooperative charter and the
matching Paperclip agents' instructions (section 11).

### 4.4 Instance overrides

A role is resolved from the instance's `roles/` directory. Because the framework's roles arrive
in an instance as ordinary files, an instance overrides a role by editing its copy and adds a
role by adding a file. There is no second lookup path and no merge of two files.

## 5. Seating an agent

```
npm run crew -- seat <role> "<brief>" [--task <task-id>] [--base <ref>] [--handoff <file>] [--on <branch>]
```

Steps, in order:

1. **Resolve the role** and validate its frontmatter.
2. **Check the guardrails** (5.1). On failure, print one plain sentence and exit non-zero; write
   nothing.
3. **Write the assignment file** with status `seating` (section 6), before anything is created,
   so a later failure still leaves a record.
4. **Create the worktree** on a new branch `crew/<assignment-id>` from `--base` (default `main`),
   at `~/.org-os/worktrees/<repo-name>/<assignment-id>`. With `--on <branch>`, open a worktree of
   that existing branch instead and create no branch (used for review).
5. **Start the agent** in the worktree's herdr pane with the role's kind and model. Its name is
   the role id, or `<id>-2`, `<id>-3` if that name is live.
6. **Prompt it once**: it is seated as this role; read the role file and the assignment file
   (both given as absolute paths); then begin. The launcher does not wait for the turn.
7. **Set the assignment to `working`** and print the agent name, branch and worktree path.

Worktrees sit outside the repository on purpose. Instances often live inside a synced vault, and
a worktree inside it would be copied to every device.

### 5.1 Guardrails

All enforced in `core.mjs`, not in the skill.

| Guardrail | Rule |
|-----------|------|
| Inside herdr | Refuse unless `HERDR_ENV=1`. |
| Concurrency cap | Refuse when the number of live seated agents equals the cap. Default 4, set by `max_agents` in `roles/circles.yaml`. |
| Who may seat | A caller whose pane hosts no seated agent is the operator and may always seat. A caller whose pane hosts a seated agent may seat only if that agent's role has `may_seat: true`. The caller is identified from `HERDR_PANE_ID` joined to the trail. |
| Base exists | Refuse if `--base` or `--on` does not resolve to a commit. |
| Operator's tree untouched | The launcher never checks out, resets or cleans the main checkout. |

The who-may-seat rule guards against drift. It is not a security boundary: an agent that sets out
to bypass it can.

### 5.2 Releasing

```
npm run crew -- release <agent-name | assignment-id> [--outcome done|abandoned]
```

- Sets the assignment to `released` (or `abandoned`) with a timestamp.
- Leaves the branch in place. The branch is the deliverable; merging belongs to the operator.
- Removes the worktree only when it has no uncommitted or untracked changes. Otherwise it lists
  them and leaves the worktree. It never forces removal.
- Closes only the herdr workspace the launcher created for that assignment, and only when the
  worktree was removed.

### 5.3 To verify during planning

Two herdr behaviours are assumed and must be confirmed against the installed CLI before the plan
relies on them:

1. `herdr worktree create --path <outside the repo> --branch <new> --base <ref>` creates the
   worktree and returns a pane at a shell prompt.
2. `herdr worktree open --branch <existing>` does the same for an existing branch.

If either does not hold, `herdr.mjs` creates the worktree with `git worktree add` and then opens
it with herdr. Nothing outside `herdr.mjs` changes.

## 6. The trail

One file per assignment in the **main checkout** at `memory/crew/<assignment-id>.md`, where
`<assignment-id>` is `<YYYY-MM-DD>-<role>-<slug>` with a numeric suffix on collision. The trail
is kept out of the worktrees so that it is one record rather than fragments on many branches.

```markdown
---
id: 2026-10-10-engineer-kms-cursor-race
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-10-engineer-kms-cursor-race
worktree: /Users/…/.org-os/worktrees/org-os/2026-10-10-engineer-kms-cursor-race
task: null
handoff: null
seated_by: operator        # or an assignment id
status: working
created: 2026-10-10T20:31:00-03:00
updated: 2026-10-10T20:31:40-03:00
---
## Brief
…

## Report
(appended by the agent)
```

**Statuses:** `seating → working → reported → released`, plus `failed` (seating did not complete)
and `abandoned`.

**Who writes what:**

- The launcher writes the file and every status except `reported`.
- The agent appends its `## Report` and sets `reported` by running
  `npm run crew -- report` from its worktree, which reads the report from standard input and
  writes it to the right file. Agents do not edit trail files by hand.
- The operator commits `memory/crew/` at session close, like the rest of memory. Agents never
  commit the trail.

The two things an agent may do outside its worktree are therefore both commands, not free
writes: `crew report` and `crew handoff`.

## 7. Handoffs

```
npm run crew -- handoff <role> "<brief>" [--branch <branch>]
```

Run by any seated agent. It writes `memory/crew/handoff-<YYYY-MM-DD>-<slug>.md`:

```markdown
---
id: handoff-2026-10-10-review-kms-cursor
from: 2026-10-10-engineer-kms-cursor-race
to_role: reviewer
branch: crew/2026-10-10-engineer-kms-cursor-race
status: open
created: 2026-10-10T21:02:00-03:00
taken_by: null
---
## Brief
…
```

- **Any agent may write a handoff. Only the lead or the operator acts on one**, with
  `crew seat <role> --handoff <file>`. That links the new assignment to the handoff, sets the
  handoff to `taken`, and uses the handoff's brief when none is given.
- **Review is an ordinary handoff.** The engineer hands off to `reviewer` naming its branch; the
  reviewer is seated with `--on <branch>` and its role forbids changes.
- **Agents do not prompt each other.** The file is the message, so every exchange is on the trail.
- A handoff can be declined: `crew handoff-close <file> --reason "<text>"` sets it to `declined`.

## 8. The board

```
npm run crew            # same as: npm run crew -- board
```

```
AGENT       ROLE       STATE     ASSIGNMENT                     BRANCH                AGE
lead        lead       idle      split the kms cursor work      crew/…-lead-kms       42m
engineer    engineer   working   fix the kms cursor race        crew/…-engineer-kms   18m
reviewer    reviewer   blocked   review engineer's branch       crew/…-engineer-kms    3m

Open handoffs: 1   engineer → researcher: "confirm cursor semantics"
Needs release: 1   2026-10-09-researcher-ibge-terms (trail says working, no live agent)
```

- **Live state** (`idle`, `working`, `blocked`, `done`, `unknown`) comes from `herdr agent list`
  at the moment of the call. **Everything else** comes from the trail. Neither is copied into the
  other.
- **Disagreement is displayed.** An assignment in `seating` or `working` with no live agent is
  listed under "Needs release". A live agent with no assignment is not shown as crew; it is the
  operator's own pane.
- **`blocked` rows are listed first**, since they mean an agent is waiting on the operator.
- `--json` prints the same data for scripts and for the skill.

## 9. The skill

`skills/crew/SKILL.md` is how a session uses all of the above in plain language. It covers:

- choosing a role from `roles/` for a piece of work;
- writing a brief: the goal, what is already ruled out, the files worth reading, what done means;
- the commands (`seat`, `release`, `report`, `handoff`, `handoff-close`, `board`) and when each applies;
- what to do when a command refuses: report the refusal, never work around it.

The skill carries judgment; the script carries the rules. The `lead` role lists this skill, which
is what makes a seated lead the agent that seats others. No separate dispatcher role exists.

## 10. Failures

| Situation | Behaviour |
|-----------|-----------|
| A seating step fails | The assignment becomes `failed`, recording the step and herdr's error text, and names anything already created (branch, worktree). No automatic retry or cleanup. |
| The first prompt times out or stalls | herdr states this does not prove non-delivery. The launcher never resends. The assignment stays `working`; the board shows the agent's real state. |
| herdr restarts, or a pane is closed | The trail is intact. The board lists the assignment under "Needs release". `crew release` closes it. |
| An agent meets a permission or question dialog | It shows as `blocked`. Only the operator answers it. |
| `crew report` or `crew handoff` is run outside a crew worktree | Refused: the caller cannot be matched to an assignment. |
| A trail file is malformed | The board lists it by file name under a "Could not read" line and continues. |

## 11. Paperclip and venture-commune

- **Nothing under `~/.paperclip` is deleted.** Its agents are paused and the server is no longer
  started.
- **Starting text is carried over.** The cooperative charter and the instructions of the five
  roles kept are read from Paperclip, read-only, and edited into the role files.
- **The framework already removes its Paperclip surfaces in 0.6.0** (`packages/paperclip-agents-app`,
  `PAPERCLIP_DEPLOYMENT_GUIDE.md`, the three `paperclip*` npm scripts) under the interfaces spec.
  This spec adds nothing to that removal and targets the same release.
- **venture-commune is not changed here.** Its recorded decision is that Paperclip is its
  workforce and its engine drives Paperclip's REST API. Whether it moves to crew is a separate
  decision, queued as an item in the instance that owns it.

## 12. Packaging

- `modules/org-os-crew/module.yaml` owns, by identity mapping: `roles/`, `scripts/crew.mjs`,
  `scripts/crew/`, `skills/crew/`, `tests/scripts/crew-*.test.mjs`.
- `package.json` gains one script: `"crew": "node scripts/crew.mjs"`.
- `docs/COMMANDS.md` and `docs/MODULES.md` each gain an entry.
- `DECISIONS.md` gains one entry: agents run through herdr from role files; Paperclip is dropped
  for the framework's own team.
- `docs/agent-plans/QUEUE.md` gains the implementation plan and, queued behind it, the
  unattended-operation sub-project.
- Instances receive the module by the deliberate port path (the instance doctor's overlay), not
  by upstream sync.

## 13. Testing

- **`core.mjs` is pure** and takes the herdr adapter and the filesystem root as arguments. It is
  unit-tested with `node --test` and a fake adapter. Cases:
  - role resolution and frontmatter validation (missing field, unknown circle, unknown kind);
  - each guardrail refusing and allowing;
  - agent naming when a seat is already taken;
  - assignment id collision;
  - status transitions, including `failed` at each seating step;
  - handoff written, taken, declined; a second attempt to take a taken handoff refused;
  - the board join: live with trail, trail without live (needs release), live without trail
    (ignored), malformed trail file.
- **Shipped role files are validated by a test**, as module manifests are.
- **`herdr.mjs` is not unit-tested.** It is covered by one documented manual smoke run in a named
  herdr test session: seat an engineer on a throwaway branch, check the board, report, release,
  confirm the worktree is gone and the branch remains.

## 14. Later, in order

1. **Unattended operation and bots**: a queue of assignments not yet seated, wake-ups, and what
   happens to `blocked` when no one is present.
2. **A herdr plugin** as a thin skin over these commands (seat from a menu, board as an overlay).
3. **Generated `.claude/agents/` files** for operators without herdr.
