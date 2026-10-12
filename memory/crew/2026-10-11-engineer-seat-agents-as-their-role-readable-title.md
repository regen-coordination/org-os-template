---
id: 2026-10-11-engineer-seat-agents-as-their-role-readable-title
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title
detached: false
pane: 'w1S:p1'
workspace: w1S
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-11T00:42:19-03:00'
updated: '2026-10-11T01:51:40-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Seat agents as their role: readable titles in herdr, and the role as the agent's identity

Goal. Two instructions from the operator: "label them properly" and "make agents fully embody their role". Today a seated agent shows in herdr as `engineer` or `engineer-2` with a label cut from the first 32 characters of its brief, and it is a generic session told once to read its role file. A reviewer built the labels from tonight's real briefs and found two agents in one role look identical and the text does not fit herdr's sidebar (default width 26). And a role read once at the start fades as a session grows. Make each agent recognisable at a glance, and make the role something the agent is for the whole session.

Part A, titles (the lead's decisions; say so in your report if the code shows one is wrong).
1. `seat` takes an optional `--title "<short title>"`: what this agent is working on, in a few words, at most 24 characters after trimming (refuse a longer one in a plain sentence that says the limit). It is stored on the assignment record as `title`. Without it, the title is derived from the brief's first line, cut at a word boundary to fit.
2. The herdr label's `assignment` token carries the title, not the 32-character cut. The board shows the title in its ASSIGNMENT column when the record has one, the brief's first line otherwise (old records have none and must still render).
3. Names. The first agent in a role keeps the role id as its name. A further agent in the same role is named from its title, `<role>-<slug of the title>` cut to herdr's name rule (`[a-z][a-z0-9_-]{0,31}`), and only falls back to `<role>-2` when that name is taken or empty. `release`, `nudge` and the board must go on working with either form.
4. For a claude agent, also pass Claude Code's `--name "<role>: <title>"` so the session itself carries it (`claude --help`: `-n, --name <name>`). Not for kinds whose flag you have not verified.
5. docs/CREW.md's config.toml rows and its "See the crew in herdr's sidebar" section match: with a 24-character title, say what an operator sees at the default sidebar width. The lead's commands in the assignment file, the usage text and the skill show `--title`, and the skill's "Writing a brief" says to give one.

Part B, the role as identity.
6. For a claude agent, the role reaches the session as an appended system prompt, not only as a file to read: Claude Code has `--append-system-prompt <prompt>` and `--append-system-prompt-file` (read `claude --help` for the exact form and say which you used and why; arguments travel through `herdr agent start … -- <args>`, so a file is safer than a long quoted string). What it carries: the role file's body (Mandate, Before you begin, Boundaries, Done means), the "Shared boundaries", "What always needs the operator" and "The cooperative charter" sections of roles/README.md, and two lines saying which seat this is: role, agent name, assignment id and the assignment file's path. Compose it in core (pure) and have the adapter or the launcher put it where the agent can be started with it. Where the composed file lives is yours to decide, with these constraints: not inside the agent's worktree (an untracked file there blocks release from removing it), not as a top-level `.md` in memory/crew/ (readTrail would read it as a record), removed on release, and no failure to write it may leave a half-seated agent without a record of why.
7. Other kinds keep today's behaviour, and the first prompt still names the role file, the assignment file and the reading list for every kind: the system prompt is in addition, so a session that is resumed or compacted can re-read its role. The first prompt addresses the seat by its role ("You are the reviewer of the org-os crew …"), using the role file's own heading.
8. A report is headed with who made it: the role and the agent name beside the timestamp. Old reports without it still read.
9. This reverses a decision in the design spec: section 4.1 says the role body is handed over as a file path "never through a flag specific to one agent kind, so a role works unchanged across kinds". Record the change there and why (per-kind arguments already exist for model and effort; the role file is unchanged and still works for every kind; a kind without a verified flag gets the file path as before). Update spec section 5 step 5 and 6, docs/CREW.md and the skill.
10. You may verify the Claude Code flags for real, once each, with a non-interactive call on a small model, for example `claude -p --model haiku --append-system-prompt-file <a scratch file saying "You are the test seat"> "Which seat are you? Answer in five words."`, run from a scratch directory outside the repository. Two or three such calls at most; say what you ran and what came back. Do not start interactive sessions and do not call herdr commands that change state.

Part C, small things from the last review. A test at the command-line level that `seat` prints its notes (effort note first, label note after) and `report` prints its label note: today only the array is tested (finding N-1, Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-11-reviewer-re-review-the-combined-labels-and-roles.md).

Not yours. The words of the role files themselves (voice, how a seat speaks and signs) are the commons-steward's next assignment; do not edit roles/*.md except where a field or section name must change for the code. Do not change the cap, release's worktree rules, or the label's `role` and `status` tokens.

Where to look. You start from feat/crew at fa61f54; nobody else is changing crew. scripts/crew/core.mjs (seat, firstPrompt, typeYourself, assignmentBody, report, board, renderBoard, freeName, setLabel), scripts/crew/herdr.mjs (startAgent, labelPane, labelWorkspace), scripts/crew/roles.mjs, scripts/crew.mjs; tests/scripts/crew-seat.test.mjs, crew-label.test.mjs, crew-board.test.mjs, crew-cli.test.mjs, crew-herdr.test.mjs; spec sections 4.1, 5, 5.3, 8; docs/CREW.md; skills/crew/SKILL.md; CHANGELOG.md's crew section. The spec's board example in section 8 is tested character for character against renderBoard: regenerate it if the board changes. A new test file must be listed in modules/org-os-crew/module.yaml and tests/clone-manifest.txt, and a test that reads a file an instance does not receive must skip there (`node --test tests/clone-genesis.test.mjs` shows it).

Done means. Each numbered item has a test that fails on fa61f54 and passes after, or a stated reason it cannot. core.mjs stays pure; old files in memory/crew/ still read, release and render; no dependency change. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"`, `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`, `npm run version:check` and `npm run clone:manifest -- --check` pass. The exact start arguments for a claude role with model, effort, title and identity are shown in your report, as the stub binary received them. Logical commits, parts apart; nothing pushed or merged. Report with commands and counts, what you did per item, the onboarding files you read, the result of the live flag checks, and what stays unverified. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-11T01:05:28-03:00

Branch `crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title`, from feat/crew at fa61f54. Four commits, parts apart, nothing pushed or merged:

- `bb8ea43` Part A — titles
- `b399891` Part B — identity (code and tests)
- `d147158` Part B — docs, and the reversal of spec 4.1
- `fbbcb37` Part C — command-line tests

## What proves it

```
node --test "tests/scripts/crew-*.test.mjs"                                 tests 201, pass 201, fail 0 (172 on fa61f54)
node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs   tests 25, pass 25, fail 0
npm run version:check            ✓ All version sources agree.
npm run clone:manifest -- --check   ✓ clone manifest current (255 paths)
```

The mutation check for Part C: with `scripts/crew.mjs` printing the seat notes in reverse, the new
command-line test fails; restored, it passes.

## The exact start arguments (the stub `herdr` received them, `tests/scripts/crew-cli-seat.test.mjs`)

For a `claude` role `thinker` with `model: claude-opus-5-5`, `effort: high`, seated with `--title "Cursor contract"`:

```
agent start thinker --kind claude --pane w1:p1 -- \
  --model claude-opus-5-5 --effort high \
  --name "thinker: Cursor contract" \
  --append-system-prompt-file <worktree root>/<repo>/.identity/<assignment-id>.md
```

## Per item

**A1 `--title`.** `seat` takes `--title`, trimmed, whitespace collapsed; more than 24 characters is
refused before anything is written ("The title "…" is 25 characters and the limit is 24. Say what the
agent works on in fewer words."). Without it: the brief's first line cut at a word boundary, and a
first word longer than the limit is cut hard with `…`. Stored as `title` on the record. Tests:
crew-seat (24 accepted, 25 refused and nothing written, trimmed, derived, hard cut, from a handoff
brief).
**A2 label and board.** The label's `assignment` token is the title; for a record with no title,
`report` cuts one from its brief. The board row carries `title` (null for old records) and
ASSIGNMENT shows it, else the brief's first line. Tests: crew-label, crew-board (old record
renders). The spec's section 8 example is regenerated with a titled row, a titled row on a second
engineer and an old record, and is still tested character for character.
**A3 names.** First agent keeps the role id; a further one is `<role>-<slug of title>` cut to 32
characters with a trailing dash dropped; `<role>-2` only when taken or the slug is empty. `release`,
`nudge` and the board match the record's `agent` field, so both forms work (test in crew-seat).
**A4 `--name`.** `--name "<role>: <title>"` for `claude` only (NAME_ARGS, a table like the model and
effort ones).
**A5 docs.** CREW.md (seat section, names, sidebar table, smoke label check), the spec (5 step 5
and 8, 5.3 item 13, board example), the skill (table row and "Writing a brief" says to give a
title), the lead's commands in the assignment file (`seat <role> "<brief>" --title …`), the usage
text. At the default width: the binary has `sidebar_width = 26`, so a 24-character title is one
whole row with two columns spare. That it renders on one row is from the width and the rule, not
seen in a live sidebar; CREW.md says so.
**B6 identity.** `composeIdentity` (core.mjs): two lines saying which seat (role, agent name,
assignment id, assignment file path, role file path), the role file's body, then the three
README sections by their `##` headings. Written by the new `scripts/crew/identity.mjs` (adapter,
wired in `scripts/crew.mjs` as `ctx.identity`) to `<worktree root>/<repo>/.identity/<id>.md`:
outside the worktree, not in memory/crew/, so readTrail never sees it (tested). Removed by
`release`, also on a retry; a removal that fails is one line and does not undo the release. A
failure to write it fails the seat at step `identity` before the worktree is made: the record says
why, nothing exists to clean up, `release` closes it (tested). Real roles compose to about 7,500
characters each with no missing section. I used `--append-system-prompt-file`, not the inline
form, because arguments travel through `herdr agent start … -- <args>` and 7,500 characters is too
long to quote.
**B7 other kinds.** Unchanged: no file, no argument (tested with a `codex` role); the first prompt
still names the role file, the assignment file and the reading list for every kind; it begins
"You are the <role file's heading> of the org-os crew" (heading lower-cased only when it is a
capitalised word: "commons steward").
**B8 reports.** `## Report — <role> — <time>`, or `## Report — <role> (<agent>) — <time>` when the
name differs. An old report without it is read and a new one appended after it (tested).
**B9 spec.** Section 4.1 records the reversal with its reasons, section 5 steps 5 and 6, 5.3 item
14 (the flag checks), section 6 (report heading), section 10 (identity failure row). CREW.md,
the skill and the CHANGELOG say it.
**B10 live flag checks.** Two calls, `claude -p --model haiku`, run from a scratch directory
outside the repository (a third was not needed; my first attempt used `timeout`, which this
machine lacks, and made no call):
1. `--append-system-prompt-file seat.txt "Which seat are you? Answer in five words."` → `I am the test seat.`
2. the same with `--name "engineer: Fix a thing"` added → `I am the test seat.`
So the file form exists (it is not on its own line in `claude --help`, which only names
`--append-system-prompt[-file]` under `--bare`) and its text reaches the model, and `--name` is
accepted. I also read herdr 0.9.1's binary strings, read-only: it has the error
`invalid_agent_argument` "agent arguments cannot be encoded safely for the target shell", so an
argument with spaces is encoded or refused, not split.
**C.** `tests/scripts/crew-cli-seat.test.mjs`: the real `scripts/crew.mjs` and adapters from a
throwaway checkout with its own git repository, against a stand-in `herdr` that makes real git
worktrees. `seat` prints the effort note first and the label note after; `report` prints its label
note; start arguments as above; release removes the identity file. This test passes on fa61f54's
code too: it covers behaviour that had no command-line test, so it cannot fail on the old code.
The mutation above shows it can fail.

## Which tests fail on fa61f54

Items A1–A4, B6–B8 each have one that fails there (new arguments, names, labels, record fields,
prompt, heading). Items A5 (CREW.md rows, CHANGELOG) and B9 (spec prose) are documents: the board
example and the skill's `--title` line are tested; the rest cannot be, and I read them against the
code. B10 is a procedure, not code.

## Why the problem existed

The first design handed the role over as a path "never through a flag specific to one kind" and
named agents only by role id plus a number, with the label cut mechanically from the brief. Per-kind
arguments already existed for model and effort, so that portability rule was already spent, and a
brief's first 32 characters is not a name.

## Design notes (where the code showed a decision wrong or open)

- The brief lists "Before you begin" inside the role body's sections; the shipped role files do
  not have one, it lives in `roles/README.md`. I carry the three README sections the brief names
  and not "Before you begin": the first prompt still sends the agent there. Say if you want it in
  the system prompt too (the lead's decision).
- `readTrail` only reads top-level `.md` files, so a subdirectory of memory/crew/ would also have
  been safe, but the operator commits memory/crew/ and these are per-session files: that is why they
  sit beside the worktrees.
- A `--title` that is whitespace only is treated as absent, not refused.
- A resumed session (`claude --resume`) needs the flags again; crew does not restart agents.

## Onboarding files read

MASTERPLAN.md, SOUL.md, MEMORY.md, DECISIONS.md (newest entry and the matches for "crew"/"herdr"): all present.

## Still unverified

- Where `--name` shows in an interactive session (the help says prompt box, /resume picker and
  terminal title); no interactive session was run, by instruction.
- That herdr 0.9.1 starts claude and detects it as before with the extra arguments (the stub
  receives them; the real `agent start` was not run).
- A 24-character title on one row in a live sidebar, and what a `$role` row shows for a pane with no
  value (already listed in CREW.md).
- That `--append-system-prompt-file` content, 7,500 characters, behaves in an interactive session
  as in `-p`.

## What I would do differently

Check how the CLI-level seat test would be built before writing the unit tests: the stand-in herdr
that makes real worktrees would have caught the same things sooner than the fake adapter did.

Hand-off to `reviewer` follows, naming this branch.
