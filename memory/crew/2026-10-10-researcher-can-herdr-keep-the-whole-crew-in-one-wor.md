---
id: 2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor
role: researcher
agent: researcher
kind: claude
branch: crew/2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor
detached: false
pane: 'w1A:p1'
workspace: w1A
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:43:53-03:00'
updated: '2026-10-11T00:24:34-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Can herdr keep the whole crew in one workspace, and what would crew have to change

Goal. The operator wants to see all crew agents together in one place in herdr and keep them open, instead of one workspace per agent that vanishes on release. Today crew calls `herdr worktree create`, which opens a new workspace for each agent's worktree, records that workspace id on the assignment, and on release asks herdr to remove the worktree through that workspace, which closes it. Find out from herdr's own sources whether a single "crew" workspace (agents as panes or tabs of one workspace) is possible, and what it would cost crew's safety rules. The answer decides whether an engineer builds it.

The questions.
1. Layout. What are workspaces, tabs and panes in herdr 0.9.1, and which of them can hold several agents each with a different working directory? Can a pane or tab be created in an existing workspace with its cwd set to a git worktree elsewhere on disk (`pane split`, `tab create`, `workspace create`: read their flags)?
2. Moving. `herdr pane move` exists. Does a pane keep its pane id, its running agent and its agent name when moved to another workspace or tab? What happens to the workspace it left when that was its only pane, in particular a worktree workspace?
3. The worktree link. `herdr workspace get` reports `worktree.checkout_path` for a workspace made by `worktree create`, and crew's release relies on it (it removes the worktree through herdr only while that workspace still names that checkout). If agents live in a shared workspace, what replaces that check? Can crew create the worktree with git alone and start the agent in a pane of the shared workspace, as it already does for `--on` (see spec section 5.3 item 2)? What does herdr then know about the worktree, and what does `herdr worktree remove` need?
4. Seeing them. Short of one workspace: does herdr have a view that shows all agents at once (a sidebar, an agent list view, a dashboard, workspace metadata or labels crew could set with `report-metadata`) that would give the operator what they want with no change to how worktrees are made?
5. Keeping them open. When an assignment is released and its worktree removed, can its pane stay (an agent whose directory is gone)? What does herdr do with an agent whose cwd no longer exists?

Sources, in order of trust. The installed herdr 0.9.1, read only: `--help` of every relevant subcommand, `herdr --skill`, `herdr api` metadata, and read-only state (`workspace list`, `workspace get`, `tab list`, `pane list`, `pane layout`, `agent list`). herdr's public source at tag v0.9.1 and its published documentation. An earlier note by this seat shows how the source was read: `git show crew/2026-10-10-researcher-what-herdr-does-when-an-agent-is-started:docs/research/2026-10-10-herdr-agent-start-readiness.md`. Crew's side: docs/superpowers/specs/2026-10-10-org-os-crew-design.md sections 5, 5.2, 5.3 and 8; scripts/crew/herdr.mjs; release in scripts/crew/core.mjs.

Ruled out. No herdr command that creates, splits, moves, focuses, renames, closes, starts, prompts or removes anything: the operator and five agents are working in this herdr session. What only an experiment can settle goes into a list of exact commands for the operator to run in a throwaway session (`herdr --session <name>`), with what each result would mean.

Done means. A note at docs/research/2026-10-10-herdr-one-crew-workspace.md committed on your branch: each question with what the source says and the command or link that shows it, marked verified or not found; then two or three designs compared (for example: keep a workspace per agent and add a shared view; panes or tabs of one crew workspace with git-made worktrees; move panes after creation), each with what it does to release safety, to the board's join by pane id, and to an operator who closes a pane by hand; and one recommendation an engineer could build and check. Name the onboarding files you read. Report with the note's path and what stays unresolved; if the recommendation needs building, hand off to engineer.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:48:42-03:00

Note: docs/research/2026-10-10-herdr-one-crew-workspace.md on branch crew/2026-10-10-researcher-can-herdr-keep-the-whole-crew-in-one-wor (commit f28c8c9).

Answer: herdr can hold the crew in one workspace, but the operator does not need that to get what they asked for.

- Seeing them together: herdr's sidebar Agent panel already lists the agents of every workspace (source: agent_panel_entries_from; the old scope setting is a no-op in 0.9.1). Crew can label rows with `pane report-metadata` tokens; showing them needs an edit to the operator's own config.toml.
- Keeping them open: herdr's `worktree remove` shuts down every terminal in the workspace and closes it, so the pane cannot stay that way. Removing the worktree with git (the path release already has as a fallback) leaves workspace and agent open. herdr ignores a cwd report for a deleted directory, so the pane stays; what an agent does with a deleted cwd is not verified.
- One shared workspace (tabs with their own cwd, git-made worktrees) works but loses herdr's worktree removal and lets one click close the whole crew. Creating with `worktree create` then `pane move` is worse: the pane id changes and the board's join by pane id breaks until crew rewrites the record.

Recommendation (design A): keep a workspace per agent, label them with report-metadata, and make release remove the worktree with git so nothing closes. Build and check steps are in the note. Needs the operator's yes first: should a released agent stay alive with its working directory deleted? It also changes spec 5.2's "closes only the workspace the launcher created".

Verified: installed herdr 0.9.1 help, --skill, api schema, read-only list/get state; herdr source at tag v0.9.1 (commit 065ef9d); crew spec 5/5.2/5.3/8, herdr.mjs, release and board in core.mjs. No herdr command that changes state was run.

Unresolved: whether the installed binary is built from that commit (schema matches, behaviour is from source); gone-cwd behaviour of claude/codex/opencode agents; whether workspace ids are reused; whether the Agent panel is readable among 52 agents in the operator's UI. Six throwaway-session experiments (E1-E6) are in the note, E3 decides whether A is buildable.

Contested: herdr's CLI reference says a moved pane's old id stays as an alias; `herdr --skill` says not to use it. Source shows an alias map. The note follows the skill.

Onboarding files from "Before you begin": MASTERPLAN.md, SOUL.md, MEMORY.md, all present and read.

What went wrong: my first commit failed the pre-commit hook because the worktree had no node_modules; I ran `npm ci --ignore-scripts` (declared dependencies from the lockfile, nothing added or upgraded), and the hook then passed. Several of my status updates came late while I was reading source.

Handoff: sent to engineer for design A, gated on the operator's answer above, so it should not start before the lead confirms.
