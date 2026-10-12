---
id: 2026-10-11-reviewer-review-titles-and-role-as-identity-the-c-3
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title
detached: true
pane: 'w1Y:p1'
workspace: w1Y
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-reviewer-review-titles-and-role-as-identity-the-c-3
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-11T01:31:40-03:00'
updated: '2026-10-11T01:51:39-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review titles and role-as-identity: the change to how every crew agent is started

Goal. Give a pass or fail verdict on the branch you are seated on: four commits on fa61f54, `git diff fa61f54...HEAD` (feat/crew has since moved to ded5c91 with a small unrelated fix; the branch merges into it without conflict). On a pass the lead merges it tonight while the operator is asleep, and the next seats are the operator's two new owner agents. This branch changes the arguments every claude agent is started with, so a defect on the ordinary path means no agent can be seated and nobody is awake to fix it. Weigh findings by that, and be plain about what is proved and what is only believed.

The claims are in the engineer's Report section: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title.md (read only). Its brief is the Brief section of the same file. In short: `seat --title` (24 characters at most) names the label, the board row, a second agent in a role, and the Claude session (`--name "<role>: <title>"`); a claude agent gets its role, the shared boundaries and the charter as an appended system prompt from a composed file kept beside the worktrees and removed on release; the first prompt addresses the seat by its role; reports are headed with the role.

Check, in this order.
1. The start arguments, which are the risk. For a claude role the agent is now started with `--model … [--effort …] --name "<role>: <title>" --append-system-prompt-file <path>` after `--` in `herdr agent start`. Two of these are new and one contains a space and a colon. (a) Read how scripts/crew/herdr.mjs passes them (execFile argument array, no shell?) and what herdr does with agent arguments: `herdr agent start --help`, `herdr --skill`, and herdr's source at tag v0.9.1 for how `-- <args>` are encoded into the pane's shell (the engineer found an error `invalid_agent_argument` "agent arguments cannot be encoded safely for the target shell" in the binary: find the rule that triggers it, and say whether a value with a space, a colon, an apostrophe as in "the steward's pass", or a non-ASCII character triggers it). (b) The path: `<worktree root>/<repo>/.identity/<id>.md`. On this machine the worktree root has no spaces; say what happens when it has. (c) You may NOT run `herdr agent start` or start an interactive session. You may run, once or twice, non-interactive `claude -p --model haiku …` from a scratch directory outside the repository to confirm a flag behaves as claimed with a title containing a space, colon and apostrophe. Say what you ran.
   State at the end of this item, plainly: what could make the first seat after the merge fail at the start step, how likely you judge it, and what the operator or lead would see.
2. Failure handling on that path. If the identity file cannot be written, or herdr refuses the arguments: the record says why, at which step; nothing is left half-made; release closes it; and a seat that fails this way does not leave an identity file behind. Trace it with the fake adapters.
3. The identity text. Compose it for each of the seven real roles (the function is pure) and read two in full, one of them roles/website.md or roles/platform.md: is anything missing, duplicated, or contradictory between the role body, the shared boundaries and the charter? Does it name the right files by absolute path? Is there anything in it that should not be in a system prompt (this machine's paths are expected; secrets are not)? The engineer left the "Before you begin" list out of the system prompt and in the first prompt: say whether that is right.
4. Titles and names. The 24-character rule, the derived title, the name for a second agent in a role (`<role>-<slug>`, herdr's name rule `[a-z][a-z0-9_-]{0,31}`), and that `release`, `nudge`, `report` and the board work for both name forms and for records written before this change (no `title`). Try titles with only punctuation, with accents, and one that slugs to something already taken.
5. Old records and old reports still read, render, release. The spec's board example is still exactly what renderBoard prints.
6. The reversal of spec section 4.1 is recorded with its reasons, and docs/CREW.md, the skill, the usage text and the lead's commands in the assignment file show `--title`.
7. A cloned instance: `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` all pass, the new files are in the manifest, and no shipped test reads a file an instance lacks.
8. Nothing that should not be pushed. Name the onboarding files you read.

Done means. A verdict, pass or fail, with the commands run and counts (`npm ci --ignore-scripts`; `node --test "tests/scripts/crew-*.test.mjs"`; the manifest and clone tests; `npm run version:check`; `npm run clone:manifest -- --check`), whether you ran the new tests against fa61f54, expected versus actual for each finding with file and line, and whether each must be fixed before merge or can follow. Say plainly whether you would let this code seat the next agent with nobody awake. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-11T01:51:10-03:00

## Verdict: PASS

Branch under review: detached copy of `crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title`, four commits on fa61f54 (HEAD fbbcb37). No finding must be fixed before merge. Three can follow. I changed nothing in the branch (`git status --short` empty at the end).

Would I let this code seat the next agent with nobody awake? **Yes.** The one thing not proved is a real `herdr agent start` with these arguments; I was forbidden to run it. Everything I could read or run says it will work, and when it does not it fails loudly, recorded, and `release` closes it. Details at item 1.

## Commands run and counts

```
npm ci --ignore-scripts                                                        ok
node --test "tests/scripts/crew-*.test.mjs"                                    tests 201, pass 201, fail 0
node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs   tests 25, pass 25, fail 0
npm run version:check                                                          ✓ All version sources agree.
npm run clone:manifest -- --check                                              ✓ clone manifest current (255 paths)
git merge-tree --write-tree HEAD ded5c91                                       clean (tree 74003da)
```

- **New tests against fa61f54** (clean room: `git archive fa61f54` into a scratch directory, the branch's new test files and fixtures copied over, plus its `identity.mjs` so the fixtures load): tests 190, pass 162, **fail 28**. The 28 are the title, name, label, board, report-heading, start-argument and usage tests; the brief's items A1–A4, B6–B8 each fail there. So the new tests can fail. The engineer's own note holds: `crew-cli-seat` "seat prints its notes" fails on old code only because `--title` is unknown, not because the notes were wrong.
- **Merged tree** (branch + ded5c91, extracted from `git archive` of the merge-tree result): the crew tests all pass; 4 failures in that run are `clone-genesis` and `module-manifests` cases that need a `.git` directory, which `git archive` does not have. That is my method, not a defect; the same two files pass 25/25 in the real worktree above. I mention it so nobody reads "4 fail" out of context.

## 1. The start arguments

**(a) How they are passed.** `scripts/crew/herdr.mjs:191` builds `['agent','start',name,'--kind',kind,'--pane',pane,'--',...args]` and `runHerdr` calls `execFileSync(bin, args)`: an argument array, **no shell on crew's side**. A title with a space or colon stays one argument.

**What herdr does** (herdr v0.9.1 source, `src/app/agents.rs` lines 154–160 and 200, `src/platform/macos.rs` `shell_quote`, `src/platform/mod.rs` `interactive_unix_shell_command`):
- The only rule that returns `invalid_agent_argument` is: **any argument containing any control character** (`char::is_control`: U+0000–001F, U+007F, U+0080–009F), or no command could be built. Nothing else.
- Each argument is then quoted for the pane's shell: left bare if it is only `[A-Za-z0-9@%_+=:,./-]`, otherwise wrapped in single quotes with `'` written as `'\''`. For PowerShell it uses `''`.
- So: **a space, a colon, an apostrophe ("the steward's pass") and non-ASCII ("Ação") do not trigger it**; they are quoted. A newline, tab, ESC or DEL does.

**(b) The path.** `<worktree root>/<repo>/.identity/<id>.md` goes through the same quoting. A worktree root with spaces is single-quoted by herdr and reaches `claude` as one argument. I tested exactly that shape in item (c).

**(c) What I ran.** One non-interactive call from a scratch directory outside the repository, the file path containing a space:

```
claude -p --model haiku --name "reviewer: the steward's pass ação" \
  --append-system-prompt-file ".identity/a b.md" "Which seat are you? Answer in six words."
→ The test seat of the crew.        (exit 0)
```

The file said "You are the test seat of the crew". So the flag exists in claude 2.1.296, a space in the path works, and a name with space, colon, apostrophe and accents is accepted. (This does not test herdr's own quoting; item (a) does, from source.)

**What could make the first seat after the merge fail at the start step, and how likely:**
1. A control character in the title or in the first line of the brief (finding F2): needs an ESC, DEL or U+0085 pasted into a command line. Very unlikely.
2. `claude` on the pane's PATH is not the 2.1.296 I tested and has lost `--append-system-prompt-file` or `--name`: the same binary that herdr starts; unlikely tonight.
3. The identity directory cannot be created or written: fails at step `identity`, before anything exists (item 2). Unlikely: `~/.org-os/worktrees/org-os-crew/` already exists and is the operator's own.
4. Something about the interactive start that `-p` does not show (the 7,000-character prompt, `--name` in the TUI, herdr's agent detection with extra arguments): **unverified, believed fine.** `claude -p` and the TUI read the same flag; herdr detects by the foreground process, and I did not read its detection code.

What the operator or lead would see: `Seating failed at the start step: <herdr's message>. It is recorded in memory/crew/<id>.md; …`, the assignment on the board under "Needs release", and a worktree left (pre-existing behaviour). `release <id>` closes it and removes the identity file. Nobody is left with a half-started agent that crew does not know about. If the flag were wrong, every claude seat would fail this way and the fix is to revert the merge; I would have the lead seat one low-stakes claude agent first and look at it with `herdr agent get` before relying on the new owner agents.

## 2. Failure handling (traced with the fake adapters, real roles/)

| Case | Result |
| --- | --- |
| herdr refuses start (`invalid_agent_argument`) | `Seating failed at the start step: … cannot be encoded safely …`; record `failed`, `failed_step: start`, `error_code: invalid_agent_argument`. **The identity file is still on disk** until `release`; `release` → `released`, file gone. |
| identity write throws (EACCES) | `Seating failed at the identity step: … no worktree or agent was made`; record `failed`, `failed_step: identity`; **0 herdr calls, no worktree**; `release` closes it with "never created". |
| `createWorktree` fails after the file is written | `failed_step: worktree`; file present until `release`, then gone. |

Expected (brief): "a seat that fails this way does not leave an identity file behind." Actual: true for an identity-write failure (a partial file would be removed by `release` too); for a refusal at start or worktree the file stays until `release`, and the message says "nothing was cleaned up", which is true of the worktree and the file. `release` is the step that closes a failed seat anyway, so nothing leaks past it. **F1, can follow.**

Release also removes the identity file when the worktree is left behind (dirty), and a removal that fails is one line, not an error (tested by the branch).

## 3. The identity text

Composed for all seven roles (commons-steward 7,386, engineer 7,651, lead 7,266, platform 9,540, researcher 7,426, reviewer 7,105, website 9,626 characters; `missing: []` for each). Read in full: `website` and `reviewer`.

- **Complete, no duplicates.** Seat lines, the role body, then exactly the three README sections once. The role bodies say "the shared boundaries in `roles/README.md` apply" and they are right below: not a contradiction.
- **Absolute paths** named: the assignment file, the role file (main checkout's), and the README it quotes from.
- **Nothing that should not be there.** I grepped all seven for token, secret, key, password and `/Users/`: only the line "Never put secrets…" from the boundaries. The paths are this machine's, as expected.
- **"Before you begin" in the first prompt only: right.** It is an action done once at the start, it names files in the agent's own worktree (the system prompt cannot know that path), and the first prompt, which carries it, is what the nudge re-sends. After a compaction the agent has already read them. One small loose end: the shared boundary "Name the onboarding files you read from 'Before you begin'" points at a section the system prompt does not contain; the role file path in the seat lines lets a resumed agent find it. Fine.
- **One oddity (F3, cosmetic):** the first line reads "You are the website of the org-os crew" (also "the platform"): the heading "Website" is used as a noun for the seat and reads as if the agent were the site. `scripts/crew/core.mjs:176` (`seatName`). The wording belongs to the commons-steward, as the brief says; it does not affect behaviour.

## 4. Titles and names (fake adapters, real roles/)

- 24 accepted, 25 refused with "The title … is 25 characters and the limit is 24" and nothing written. A whitespace-only title is treated as absent and derived from the brief.
- A title of only punctuation ("!!! ???"): accepted, kept as the title and the `--name`; the agent name falls back to `engineer-2` (slug empty). A first word that is 25+ characters is cut hard.
- Accents: "Ação café" → `engineer-acao-cafe`, `--name "engineer: Ação café"`.
- A slug already taken: second "Fix the thing" → `engineer-fix-the-thing`, third → `engineer-2`. A role id near the limit leaves `32 − len − 1` characters of slug; the role-id rule is at most 28.
- `release` by the slug name and by `engineer-2`, and by an old record's name (`engineer-old`, no `title`), all worked; `nudge` on a named agent answered correctly ("already been given its first prompt"); the board rendered the old record from its brief; `report` from `engineer-f` wrote `## Report — engineer (engineer-f) — <time>` after the existing sections and labelled the pane with the title.

## 5. Old records, old reports, the spec's board example

An old record without `title` renders on the board, can be released, and reports label it from a title cut from its brief (probe above and the branch's `crew-board` and `crew-label` tests). The spec's board example is tested character for character by `crew-board.test.mjs` and passes (and fails on fa61f54). No reader of the `## Report` heading exists in `scripts/` or `skills/` (grep), so the new heading breaks nothing.

## 6. Reversal of spec 4.1, docs

Spec 4.1 carries a dated "Changed 2026-10-11" paragraph with three reasons; steps 5 and 6, 5.3 items 13 and 14, section 6 and the report heading are updated. `docs/CREW.md` (seat section, names, sidebar table, smoke check), `skills/crew/SKILL.md` (table row, "Give every seat a `--title`"), the usage text, the lead's commands in `assignmentBody` and the CHANGELOG all show `--title`. The skill's example `engineer-cursor-race-in-kms` is 27 characters, within herdr's 32.

## 7. A cloned instance

`module-manifests` and `clone-genesis` pass 25/25. `scripts/crew/identity.mjs`, `crew-identity.test.mjs` and `crew-cli-seat.test.mjs` are in `modules/org-os-crew/module.yaml` and `tests/clone-manifest.txt`. The tests that read a spec, the skill or `roles/` skip when the file is absent (`crew-board`, `crew-cli`, `crew-shipped-roles` use `skip:`); `crew-cli-seat` copies only `scripts/crew.mjs` and `scripts/crew/`, which an instance has.

## 8. Nothing that should not be pushed

`git diff fa61f54...HEAD --name-only`: scripts, tests, docs, skills, modules, CHANGELOG only. No `.env`, tokens, emails or home-directory paths in added lines (grep). Commits are by the branch's git user, none pushed.

## Findings

| # | Where | Expected | Actual | Fix |
| --- | --- | --- | --- | --- |
| F1 | `core.mjs:~434` (the `cleaned` text) and the catch block | "a seat that fails does not leave an identity file behind" | At step `start` or `worktree` the file stays until `release`, and the error says "nothing was cleaned up". Reproduce: fake `startAgent` failing with `invalid_agent_argument`, then list `<worktreeRoot>/identity/`. | Can follow: remove the file in the catch, or say in the message that `release` removes it. |
| F2 | `core.mjs` `oneLine` / `checkTitle` / `deriveTitle`, `NAME_ARGS` | A title or brief with a control character is refused or cleaned at `seat`, before a worktree is made | `\s` collapses tab and newline but not ESC, DEL or U+0085; herdr then refuses at start (`invalid_agent_argument`) after the worktree exists. Input: `--title $'a\x1bb'` or a brief whose first line holds ESC. | Can follow: strip `\p{Cc}` in `oneLine`. Not on the ordinary path. |
| F3 | `core.mjs:176` `seatName` | "You are the reviewer of the org-os crew" | "You are the website of the org-os crew" for `website`, `platform` | Can follow, with the role wording (commons-steward). |

## What is proved and what is believed

**Proved (I ran or read it):** herdr's quoting and refusal rule from its v0.9.1 source; the flags exist and work with the title and path shapes above in one `claude -p` call; crew passes arguments as an array; the failure paths, names, old records and release; the tests green and red where they should be; the merge is clean; the clone and manifest checks.

**Believed, not seen:** an interactive claude start through herdr with these arguments reaches "ready" as before; `--name` shows where the help says; herdr's detection of claude is not disturbed by extra arguments; a 24-character title fits one sidebar row (the engineer says the same in CREW.md).

## Onboarding files

Read: `MASTERPLAN.md` (first 60 lines), `SOUL.md` (first 40), `MEMORY.md` (first 45), `DECISIONS.md` (newest three entries and the lines matching "crew", "identity", "system prompt"). All four were present. I did not read all of `MASTERPLAN.md` and `SOUL.md`; the lines I read did not touch the crew's start path.

## What I would do differently

I started with the engineer's report and the diff and only then went to herdr's source for the quoting rule. Starting from the rule would have shown at once which inputs matter, and I would have spent the one live `claude -p` call on the shape of the whole argument list first.
