---
id: 2026-10-11-reviewer-review-titles-and-role-as-identity-the-c
role: reviewer
agent: reviewer
kind: claude
branch: crew/2026-10-11-engineer-seat-agents-as-their-role-readable-title
detached: true
pane: 'w1W:p1'
workspace: w1W
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-reviewer-review-titles-and-role-as-identity-the-c
task: null
handoff: handoff-2026-10-11-review-branch-crew-2026-10-11-engineer-s
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: abandoned
prompted: true
created: '2026-10-11T01:06:29-03:00'
updated: '2026-10-11T01:30:35-03:00'
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
