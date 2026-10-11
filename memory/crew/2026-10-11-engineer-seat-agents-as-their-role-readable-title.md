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
status: working
prompted: true
created: '2026-10-11T00:42:19-03:00'
updated: '2026-10-11T00:42:25-03:00'
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
