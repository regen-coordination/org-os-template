# org-os Crew — Roles and Agents Through herdr — Design Spec

**Date:** 2026-10-10
**Status:** Implemented on the `feat/crew` branch; module status `pilot` (the smoke run in `docs/CREW.md` has not been run end to end against every path)
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
| **Main checkout** | The checkout the operator runs `npm run crew` from: the one whose `scripts/crew.mjs` is executed. Its `roles/` and `memory/crew/` are the ones in force. |
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
    roles.mjs           # pure: circles, role parsing and validation
    trail.mjs           # pure: assignment and handoff files
    core.mjs            # pure: guardrails, seat, release, report, handoff, board
    herdr.mjs           # the only file that calls the herdr CLI
    git.mjs             # the only file that calls git
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
- Report before stopping: append your report to your assignment file, and name the onboarding
  files you read and any that were absent.

`roles/README.md` also holds a section **Before you begin**: the files every seat reads before its
brief, by default `MASTERPLAN.md`, `SOUL.md`, `MEMORY.md` and `DECISIONS.md` at the root of the
agent's own worktree (mandate and priorities, values and boundaries, what is active, and the
decision record). An instance changes
the list by editing that file. A role file may add to it and never shortens it (`lead` adds
`HEARTBEAT.md` and the rest of the `AGENTS.md` startup sequence). A missing file is skipped, not
fatal: crew checks nothing and refuses nothing here, since the script carries rules and the role
files carry judgment.

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
npm run crew -- seat <role> "<brief>" [--task <task-id>] [--base <ref>] [--handoff <id|file>] [--on <branch>]
```

Steps, in order:

1. **Resolve the role** and validate its frontmatter.
2. **Check the guardrails** (5.1). On failure, print one plain sentence and exit non-zero; write
   nothing.
3. **Write the assignment file** with status `seating` (section 6), before anything is created,
   so a later failure still leaves a record.
4. **Create the worktree** on a new branch `crew/<assignment-id>` from `--base` (default `main`),
   at `~/.org-os/worktrees/<repo-name>/<assignment-id>`. With `--on <branch>`, create a
   **detached** worktree at that branch's current commit instead and create no branch (used for
   review). It is detached because git refuses to check one branch out in two worktrees.
   A taken handoff that names a branch also seats a detached copy of it, as `--on` does, unless
   `--base` is given: an explicit `--base` always wins, the agent gets a new branch from that
   base, the handoff is still taken, and its branch is named in the assignment file. `--base`
   together with `--on` is refused.
5. **Start the agent** in the worktree's herdr pane with the role's kind and model. Its name is
   the role id, or `<id>-2`, `<id>-3` if that name is taken by any live agent on the herdr
   server, crew or not.
6. **Prompt it once**: it is seated as this role; read the role file and the assignment file
   (both given as absolute paths), then the "Before you begin" section of `roles/README.md`
   (absolute path in the main checkout) and the files it lists, which are at the root of the
   agent's own worktree, not the main checkout's; if the section is missing, say so in the
   report and begin; then begin. The prompt is one line. `nudge` sends the same prompt, and the
   "type this yourself" text of an unconfirmed prompt carries the same sentence. The launcher does not wait for the turn.
7. **Set the assignment to `working`** and print the agent name, branch and worktree path.
8. **Label the pane and the workspace** (5.3 item 13): role, a short assignment and the status, as
   display-only herdr metadata. A refusal never fails the seat and never changes the record; the
   output says in one line that the label could not be set. `report` moves the pane's `status` to
   `reported` with one more call. `release` sets nothing: it closes the workspace, and the label
   goes with it.

Worktrees sit outside the repository on purpose. Instances often live inside a synced vault, and
a worktree inside it would be copied to every device.

### 5.1 Guardrails

All enforced in `core.mjs`, not in the skill.

| Guardrail | Rule |
|-----------|------|
| Inside herdr | Refuse unless `HERDR_ENV=1`. |
| Concurrency cap | Refuse when the number of live seated agents equals the cap. Only agents with an open assignment count; the operator's other herdr agents do not. The shipped `roles/circles.yaml` sets `max_agents: 6`, so the five shipped roles (the lead among them) take five seats and the sixth allows a second agent in one role, for example a reviewer while an engineer is still seated. Each seated agent is a full model session on the operator's own plan; a small plan lowers `max_agents`. A file with no `max_agents` line falls back to 4 in `scripts/crew/roles.mjs`. |
| Who may seat | A caller whose pane hosts no seated agent is the operator and may always seat. A caller whose pane hosts a seated agent may seat only if that agent's role has `may_seat: true`. The caller is identified from `HERDR_PANE_ID` joined to the trail. |
| Base exists | Refuse if `--base` or `--on` does not resolve to a commit. Refuse `--base` together with `--on`. |
| Operator's tree untouched | The launcher never checks out, resets or cleans the main checkout. |

The who-may-seat rule guards against drift. It is not a security boundary: an agent that sets out
to bypass it can.

### 5.2 Releasing

```
npm run crew -- release <agent-name | assignment-id> [--outcome done|abandoned]
```

- Refuses while the agent's live state is `working`.
- Sets the assignment to `released` (or `abandoned`) with a timestamp.
- Leaves the branch in place. The branch is the deliverable; merging belongs to the operator.
- Removes the worktree only when it has no modified, untracked or git-ignored files (installed
  dependencies aside); git would delete ignored files without asking. Otherwise it lists them
  and leaves the worktree. It never forces removal.
- For a detached assignment (`--on`), commits that are on no branch are first saved as
  `crew/<assignment-id>`, since they would otherwise be lost with the worktree.
- A retry that cannot save new commits says so and names only what is true of this run: commits
  saved by an earlier release stay on their branch, the new ones are listed as not saved, and
  the worktree is left.
- Closes only the herdr workspace the launcher created for that assignment, and only when the
  worktree was removed. The recorded workspace id is used only while herdr still reports it open
  on that worktree; otherwise the worktree is removed with git. If herdr does not answer
  (`herdr_timeout`) while it is asked which worktree the workspace is open on, or asked to
  remove it, git is not used and the worktree is left. The reason names what was asked, and
  `release` again finishes it. After the removal request herdr may still be doing it; after the
  question nothing was removed.
- A failed seating whose worktree step timed out (`failed_step: worktree`, `error_code:
  herdr_timeout`) and whose worktree is not there yet is released with `worktree_removed:
  false`, so the same `release <id>` finds it again: it removes the worktree if herdr made one
  since, or, finding none, says so and sets `worktree_removed: true`. The first release does
  not say the branch "was never created" when `may_remain` names it: it says the branch does
  not exist now and may still appear.
- A closed assignment whose record says `worktree_removed: false` but whose worktree is gone
  (herdr finished after release stopped waiting) is found by `release <id>`: the record is set to
  `worktree_removed: true` and the command says the worktree was already removed. Nothing is
  removed and the recorded outcome is kept.

### 5.3 herdr behaviour, verified 2026-10-10 against herdr 0.9.1

Checked on a throwaway repository; `herdr.mjs` and `git.mjs` are written to these facts.

1. `herdr worktree create --cwd <repo> --branch <new> --base <ref> --path <outside the repo>
   --label <text> --no-focus` creates the branch and worktree, opens a new workspace, and
   returns `result.root_pane.pane_id` and `result.workspace.workspace_id`.
2. `herdr worktree open --branch <existing>` on a branch that is already checked out returns the
   **existing** workspace with `already_open: true`. It cannot give a reviewer its own checkout,
   which is why `--on` uses a detached worktree: `git worktree add --detach <path> <branch>`,
   then `herdr worktree open --cwd <repo> --path <path>`.
3. `herdr worktree remove --workspace <id>` removes the worktree and its workspace and keeps the
   branch. On a dirty worktree it fails with error code `dirty_worktree_requires_force`.
4. When the source repository has no open herdr workspace, `worktree create` also opens one for
   it. The launcher leaves that workspace alone.
5. `herdr agent list` returns every agent on the server; most of the operator's have no `name`.
   Crew agents are matched to assignments by `pane_id`.
6. herdr refuses `worktree create` and `worktree open` when `--cwd` is itself a linked worktree
   (`linked_worktree_source`: "New and open worktree actions start from the repo parent
   workspace"). Found in the first smoke run. The launcher therefore passes herdr the
   repository's primary checkout, while the roles and the trail stay in the main checkout. For a
   submodule the primary checkout is read from `core.worktree`, because the first entry of
   `git worktree list` names its git directory instead.
7. `herdr agent start` into a pane that was created a moment ago can fail with code
   **`agent_pane_busy`** and the message "agent target pane <id> is not an available shell".
   Read from herdr's source (0.9.1, `agent_start_error_body`) and asserted on the wire by its own
   tests; the first smoke run recorded the message and not the code. The one code has **two
   causes**: the pane's shell is not yet in the foreground (waiting helps), or the pane already
   hosts an agent or a pending start (waiting never helps). herdr 0.9.1 retries this itself for
   2 seconds, and only while it sees the shell initializing. herdr publishes no error contract:
   the codes in this section are read from source and may change between releases.
8. `herdr pane process-info --pane <id>` is read-only and returns
   `result.process_info.{shell_pid, foreground_process_group_id, foreground_processes[]}`, each
   process with `name`, `argv0`, `argv` and `pid` (shape observed live on 0.9.1; the process
   `name` of a running claude was its version string, so crew also matches `argv0`). A pane is an
   available shell, in herdr's own test, when the foreground process group is the shell's
   (`foreground_process_group_id == shell_pid`) and nothing else is in it. herdr has no event or
   field that says a shell reached its prompt.
9. `startAgent` therefore retries `agent_pane_busy` only while, on each refusal, `pane
   process-info` and `agent list` show **no agent on that pane** and the shell is **not yet** the
   foreground. It stops at once, with herdr's text and a plain reason, when an agent is listed on
   the pane or the agent's kind is in its foreground (cause two), or when the pane cannot be
   inspected. A bare shell that holds the foreground and is still refused is tried once more (the
   shell may have arrived between the two calls) and then reported. The wait is bounded at 30
   seconds, herdr's own default start timeout, and the failure names what was still running. A
   code that is not in herdr's known start codes and has the old message is treated the same way,
   for a herdr that returns another code. `agent_not_ready` (the agent is there, stopped at a
   dialog) and every other start error are never retried.
10. **A cut-off start may have started the agent.** `agent.start` writes the launch command into
    the pane and answers before any waiting; the waiting is done by the CLI. A crew-side kill
    (`herdr_timeout`), herdr's own `timeout`, or `agent_start_transport_failed` leaves the command
    running, and herdr's `timeout` clears the pending name without killing the process. So after
    any of these `startAgent` looks, read-only (`agent list`, then `pane process-info`), for an
    agent on that pane, and treats the seat as started if one is there. It never sends a second
    start after a cut-off. A second start with the same name returns `agent_name_taken`, which
    `startAgent` takes to mean the first one took only when the named agent is in that pane.
11. **What `agent prompt` proves.** `empty_agent_prompt`, `agent_not_found`,
    `agent_target_ambiguous`, `agent_blocked` and `agent_not_ready` are returned before any input is
    queued (herdr source, `queue_agent_prompt`), so with a missing binary they prove nothing was
    sent and leave `prompted: false`. `agent_prompt_failed` is raised both before and after the
    write with the same code, and a failure after the text leaves a typed but unsubmitted prompt;
    `timeout`, `agent_prompt_stalled`, `herdr_timeout` and anything unknown stay `unconfirmed`.
12. **`worktree create` cut off.** On the server the create is a separate thread that runs `git
    worktree add` and then opens the workspace; a caller that gives up does not cancel it, and no
    code rolls it back. After a failure or timeout it may have left the branch, the checkout
    directory and a herdr workspace (and, when the repository had none open, a workspace for it).
    `worktree remove` never deletes the branch. Crew never receives the id of a workspace opened
    after it stopped waiting, so the failed record names these in `may_remain` and the operator
    closes the workspace in herdr.

13. **Labels.** `herdr pane report-metadata <pane> --source crew --token role=… --token
    assignment=… --token status=…` and `herdr workspace report-metadata <workspace> --source crew
    --token role=… --token assignment=…` (CLI reference at the `v0.9.1` tag; the installed
    binary's `--help` lists the same options, and its schema gives at most 16 tokens, names
    `[A-Za-z0-9_-]{1,32}` and a `ttl_ms` of at most 86 400 000). From the reference, not
    observed: token values are trimmed and cut at 80 characters, a token call patches only the
    names it gives, a token with no `--ttl-ms` stays until replaced or the pane closes, and a
    pane or workspace accepts at most 32 distinct sources. Crew uses the tokens `role`,
    `assignment` and `status`; the assignment is the first non-empty line of the brief, cut to
    32 characters (the board's column), not herdr's 80, so a row stays one line. It sends no
    `--ttl-ms` and no `--seq`. The workspace gets `role` and `assignment` only, since its
    `status` would go stale. Every update sends the whole set. Tokens show only where the
    operator's `[ui.sidebar.agents]` and `[ui.sidebar.spaces]` rows list `$role`, `$assignment`
    and `$status`; that is the operator's own edit of `config.toml` (`docs/CREW.md`), which crew
    never makes.

Not verified against a live herdr, because each needs an experiment that changes herdr's state;
they are in the smoke run of `docs/CREW.md`:

- why herdr's own 2 second retry did not cover the failure first seen (a slow shell, or a
  foreground rc job that fails herdr's test): the 30 second ceiling is a bound, not a measurement;
- that a killed `agent start` leaves the agent running and that a second start then returns
  `agent_name_taken` (source says so; not observed);
- that the installed 0.9.1 binary is built from the `v0.9.1` source tag;
- what git leaves on a killed `git worktree add`;
- which code `agent get <pane>` or `agent list` gives for a pane with no agent (crew uses the
  list and reads no code from it);
- that the installed binary accepts and shows the label tokens as the reference says, that
  `herdr agent get <name>` returns them, and that a herdr restart keeps or drops them (crew does
  not set them again). The smoke run in `docs/CREW.md` has the live check.

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
detached: false
pane: wF:p1
workspace: wF
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
- The agent appends its `## Report` and sets `reported` by running the main checkout's script,
  `node <main checkout>/scripts/crew.mjs report --file <path>` (or with the report on standard
  input). The exact command, with absolute paths, is written into the assignment file under
  `## Commands`. The main checkout's script is used because a fresh worktree has no installed
  dependencies. Agents do not edit trail files by hand.
- The operator commits `memory/crew/` at session close, like the rest of memory. Agents never
  commit the trail.

The two things an agent may do outside its worktree are therefore both commands, not free
writes: `crew report` and `crew handoff`.

## 7. Handoffs

```
node <main checkout>/scripts/crew.mjs handoff <role> "<brief>" [--branch <branch>]
```

Run by any seated agent (`npm run crew -- handoff …` when run from the main checkout). It writes `memory/crew/handoff-<YYYY-MM-DD>-<slug>.md`:

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
  `crew seat <role> --handoff <id|file>`. That links the new assignment to the handoff, sets the
  handoff to `taken`, and uses the handoff's brief when none is given.
- **Review is an ordinary handoff.** The engineer hands off to `reviewer` naming its branch; the
  reviewer is seated with `--on <branch>` and its role forbids changes.
- **Agents do not prompt each other.** The file is the message, so every exchange is on the trail.
- A handoff can be declined: `crew handoff-close <id|file> --reason "<text>"` sets it to `declined`.
- When a handoff names a branch and the seat command gives neither `--on` nor `--base`, the
  receiving agent is seated on a detached copy of that branch. With `--base <ref>` it gets a new
  branch from `<ref>` instead, and the handoff is still taken (section 5, step 4).

## 8. The board

```
npm run crew            # same as: npm run crew -- board
```

Output of `renderBoard` for made-up rows (the home directory in the path is invented). Values
longer than 32 characters (assignment) or 44 (branch) are cut and end in `…`.

```
AGENT     ROLE      STATE    STATUS    ASSIGNMENT                        BRANCH                                        AGE
reviewer  reviewer  blocked  working   Review the cursor fix, and say …  crew/2026-10-10-engineer-fix-the-cursor-rac…  3m
engineer  engineer  idle     reported  Fix the cursor race in the kms …  crew/2026-10-10-engineer-fix-the-cursor-rac…  18m

Open handoffs: 1
  engineer → researcher: "Confirm what the cursor contract promises"

Needs release: 1
  2026-10-09-researcher-ibge-terms (trail says working, no live agent)

Worktrees left behind: 1
  2026-10-09-engineer-ingest-retry (released; its worktree is still at /Users/alex/.org-os/worktrees/org-os/2026-10-09-engineer-ingest-retry)

Sync conflict copies: 1
  2026-10-10-engineer-fix-the-cursor.sync-conflict-20261010-221500-ABCDEFG.md
  Your file-sync tool (Syncthing) kept these when two machines changed the same assignment file in memory/crew/ at once. They are not read as records; merge them by hand and delete them.

Could not read: notes.md
```

- **Live state** (`idle`, `working`, `blocked`, `done`, `unknown`) comes from `herdr agent list`
  at the moment of the call. **Everything else** comes from the trail. Neither is copied into the
  other.
- **Disagreement is displayed.** An assignment in `seating` or `working` with no live agent is
  listed under "Needs release". A live agent with no assignment is not shown as crew; it is the
  operator's own pane.
- **`blocked` rows are listed first**, since they mean an agent is waiting on the operator.
- **A seated agent whose first prompt is unsent or unconfirmed is marked.** Its STATUS cell reads
  `working (first prompt not sent)` or `working (first prompt unconfirmed)`, and its `--json` row
  carries `prompted: false` or `prompted: "unconfirmed"` (`true` for every other row).
- **A sync-conflict copy of a trail file has its own line**, "Sync conflict copies", saying the
  file is not read as a record and the operator merges it by hand. `--json` lists them under
  `conflicts`, apart from `unreadable` ("Could not read": files that could not be parsed).
- `--json` prints the same data for scripts and for the skill.

## 9. The skill

`skills/crew/SKILL.md` is how a session uses all of the above in plain language. It covers:

- choosing a role from `roles/` for a piece of work;
- writing a brief: the goal, what is already ruled out, the files worth reading, what done means;
- the commands (`seat`, `nudge`, `release`, `report`, `handoff`, `handoff-close`, `board`) and when each applies;
- what to do when a command refuses: report the refusal, never work around it.

The skill carries judgment; the script carries the rules. The `lead` role lists this skill, which
is what makes a seated lead the agent that seats others. No separate dispatcher role exists.

## 10. Failures

| Situation | Behaviour |
|-----------|-----------|
| A seating step fails | The assignment becomes `failed`, recording the step, herdr's error text and, when herdr gave one, its `error_code`. A failure at the worktree step also records `may_remain`: the branch, the checkout directory and a herdr workspace labelled with the agent name, which crew never learned the id of. No automatic retry or cleanup. |
| A call times out (`herdr_timeout`, 60 s) during `worktree create/open` or `agent start` | Seating fails as above and says the worktree or agent may exist anyway, pointing to the board ("Needs release") and `release`. A timed-out worktree step may still be running in herdr: the message says to wait before releasing, and release repeats that the herdr workspace may remain. A timed-out call is never retried. |
| `agent start` answers `agent_pane_busy` ("is not an available shell") | Retried only while `pane process-info` and `agent list` show a shell that is not yet in the foreground and no agent on the pane, for at most 30 seconds; then it fails with herdr's text, what was still running and how long it waited. A pane that already has an agent, or one that cannot be inspected, fails at once. Other start errors and `agent_not_ready` are not retried. |
| An `agent start` is cut off (`herdr_timeout`, herdr's `timeout`, a transport failure) | Crew looks, read-only, for an agent on that pane. One there means the seat started; none means the start fails with the cut-off error and says it looked. A second start is never sent. |
| The first prompt fails, times out or stalls | herdr states this does not prove non-delivery. The launcher never resends. The assignment stays `working` with `prompted: 'unconfirmed'`, and `nudge` refuses. Only a code that proves nothing was queued leaves `prompted: false` and lets `nudge` run: `empty_agent_prompt`, `agent_not_found`, `agent_target_ambiguous`, `agent_blocked`, `agent_not_ready` and `herdr_missing`. `agent_prompt_failed`, `timeout`, `agent_prompt_stalled` and `herdr_timeout` stay `unconfirmed`. |
| `release` asks herdr to remove a worktree and herdr times out | The worktree is left, with the reason listed; `release` again finishes it. git does not remove it meanwhile. |
| herdr restarts, or a pane is closed | The trail is intact. The board lists the assignment under "Needs release". `crew release` closes it. |
| An agent meets a permission or question dialog | It shows as `blocked`. Only the operator answers it. |
| The agent stops at a startup dialog (for example, trusting a new folder) | herdr reports `agent_not_ready`. The assignment is `working` with `prompted: false`; the first prompt was not sent. The operator answers the dialog, then runs `crew nudge <agent>` to send it. |
| An agent runs its own worktree's copy of the script | Refused: a script living under the worktree root is not a main checkout. The assignment file names the right command. |
| `crew report` or `crew handoff` is run outside a crew worktree | Refused: the caller cannot be matched to an assignment. |
| A trail file is malformed | The board lists it by file name under a "Could not read" line and continues. |
| A trail file has a sync-conflict copy | The copy is not read as a record. The board lists it under "Sync conflict copies" for the operator to merge by hand; it is never deleted. |

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
- `roles` is declared in `TOP_LEVEL_ALLOW` in `scripts/lib/clone-excludes.mjs`, so new instances
  receive the roles, and `tests/clone-manifest.txt` is regenerated.
- `docs/CREW.md` is the operator guide and holds the manual smoke run. `docs/COMMANDS.md` and
  `docs/MODULES.md` each gain an entry.
- `DECISIONS.md` gains one entry: agents run through herdr from role files; Paperclip is dropped
  for the framework's own team.
- `docs/agent-plans/QUEUE.md` gains the implementation plan and, queued behind it, the
  unattended-operation sub-project.
- Instances receive the module by the deliberate port path (the instance doctor's overlay), not
  by upstream sync.

## 13. Testing

- **`roles.mjs`, `trail.mjs` and `core.mjs` are pure** and take the herdr adapter, the git
  adapter and the filesystem root as arguments. They are
  unit-tested with `node --test` and fake adapters. Cases:
  - role resolution and frontmatter validation (missing field, unknown circle, unknown kind);
  - each guardrail refusing and allowing;
  - agent naming when a seat is already taken;
  - assignment id collision;
  - status transitions, including `failed` at each seating step;
  - handoff written, taken, declined; a second attempt to take a taken handoff refused;
  - the board join: live with trail, trail without live (needs release), live without trail
    (ignored), malformed trail file.
- **Shipped role files are validated by a test**, as module manifests are.
- **`herdr.mjs` and `git.mjs` are not unit-tested.** They are covered by one documented manual smoke run in a named
  herdr test session: seat an engineer on a throwaway branch, check the board, report, release,
  confirm the worktree is gone and the branch remains.

## 14. Later, in order

1. **Unattended operation and bots**: a queue of assignments not yet seated, wake-ups, and what
   happens to `blocked` when no one is present.
2. **A herdr plugin** as a thin skin over these commands (seat from a menu, board as an overlay).
3. **Generated `.claude/agents/` files** for operators without herdr.
