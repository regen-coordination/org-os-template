# Can herdr keep the whole crew in one workspace, and what would crew have to change

Date: 2026-10-10. Author: researcher seat. Status: findings plus one recommendation; nothing built.

## Question

The operator wants every crew agent visible together in herdr and kept open, instead of one
workspace per agent that disappears on release. Crew today runs `herdr worktree create`, which
opens a new workspace per worktree, records its id, and on release asks herdr to remove the
worktree through that workspace, which closes it. Is a single "crew" workspace possible, and what
would it cost crew's safety rules? Five sub-questions were set; each is answered below.

## Short answer

1. **Seeing them together needs no change to how worktrees are made.** herdr's sidebar Agent
   panel already lists the agents of *every* workspace, and crew's agents are in it today.
2. **Keeping them open is a release decision, not a layout one.** herdr's own
   `worktree remove` kills every terminal in the workspace and closes it. Removing the worktree
   with git instead (a path crew already has) leaves the pane open.
3. **One shared crew workspace is possible** (tabs, each with its own cwd, worktrees made by git),
   but it is a larger change with a worse failure mode (one click closes the whole crew), and it
   gives up herdr's worktree removal. Moving panes after creation is the worst of the three.

Recommendation: section "Recommendation". It needs the operator's answer to one question first.

## What was read

| Source | What | Trust |
| --- | --- | --- |
| Installed `herdr` **0.9.1** | `--help` of `herdr`, `workspace`, `tab`, `pane`, `worktree`, `agent`, `api`, `config`; `herdr --skill`; `herdr api schema --json` (the request schemas); read-only `workspace list`, `workspace get`, `tab list`, `pane layout`, `agent list` | Highest. It is the binary crew runs against |
| herdr public source, `github.com/herdrdev/herdr`, tag **v0.9.1**, commit `065ef9d` | `src/app/api/panes.rs` (`handle_pane_move`), `src/workspace.rs`, `src/app/api/worktrees/deferred.rs`, `src/app/api/worktrees.rs`, `src/app/worktrees.rs`, `src/app/ids.rs`, `src/app/agent_view.rs`, `src/ui/sidebar.rs`, `src/persist/restore.rs`, `src/app/actions.rs`; docs in `docs/next/website/src/content/docs/` (`cli-reference`, `configuration`, `socket-api`) | High for behaviour. That the installed binary was built from this exact commit is **not verified**; the schema it prints does contain `PaneMoveParams`, `AgentViewSetParams` and the method `agent.view.set`, so the features exist in it |
| Crew | `docs/superpowers/specs/2026-10-10-org-os-crew-design.md` sections 5, 5.2, 5.3, 8; `scripts/crew/herdr.mjs`; `release` and `board` in `scripts/crew/core.mjs` | Read in full for those parts |

Onboarding files from "Before you begin" (`roles/README.md`): `MASTERPLAN.md`, `SOUL.md`,
`MEMORY.md` were all present and read. The earlier note by this seat
(`2026-10-10-herdr-agent-start-readiness.md`) was read from its branch for method.

Method limit: this seat ran no command that creates, splits, moves, focuses, renames, closes,
starts, prompts or removes anything. Everything about behaviour under those commands is from
source, and is marked **source**; what only a live run can settle is in "Experiments".

## Findings

### 1. Layout: which levels can hold several agents with different directories

**Verified (installed binary + source).**

- herdr has workspace, tab and pane. `workspace create` makes a workspace with one tab and one
  root pane; `tab create --workspace <id> --cwd <path>` adds a tab; `pane split --cwd <path>`
  adds a pane to a tab. `herdr tab create [--workspace ID] [--cwd PATH] [--label TEXT]` and
  `herdr pane split [<pane_id>|--current] --direction right|down [--cwd PATH]` are in the CLI
  reference; `TabCreateParams` and `PaneSplitParams` in the installed schema carry `cwd` and
  `workspace_id` (`PaneSplitParams` also `target_pane_id`).
- The cwd is **per pane**, not per workspace. Every row of `herdr agent list` carries its own
  `cwd`, `foreground_cwd`, `tab_id` and `workspace_id`. The operator's workspaces already hold
  several: `refi-dao-os` has 11 tabs and 11 panes, `lf-work-os` 18 and 18 (`workspace list`,
  read 2026-10-10).
- So yes: a tab (or a pane) can be created in an existing workspace with its cwd set to a git
  worktree anywhere on disk. Nothing in the schema ties a pane's cwd to its workspace.
- **A worktree workspace is a different kind of object.** `worktree create` and `worktree open`
  always produce a *workspace* (their results carry `workspace` and `root_pane`, which
  `herdr.mjs` `opened()` reads). Their `workspace_id` parameter names the *source* repository's
  workspace, not a place to put the new pane. There is no flag to open a worktree as a tab of an
  existing workspace.

### 2. Moving a pane

`herdr pane move <pane_id> --tab <tab> --split right|down | --new-tab [--workspace ID] |
--new-workspace`. **Source, `handle_pane_move`, and CLI reference line 238.**

| What | Result |
| --- | --- |
| Running process and agent | **Kept.** The pane's terminal and runtime move as a unit (`take_pane_for_move` / `insert_moved_pane_into_tab`, `MovedPane`); herdr's own test shows input still reaching the moved terminal |
| Agent name | **Kept.** `agent_name` is stored on the terminal state (`src/terminal/state.rs`), and the docs say it "follows the terminal and continues to resolve after the move" |
| Pane id | **Changes on a cross-workspace move** to a new workspace-qualified id. The result carries `move_result.pane.pane_id` (new) and `previous_pane_id`. herdr keeps the old id as a server-side alias (`public_pane_id_aliases`), and the moved process keeps its launch-time `HERDR_PANE_ID`. `herdr agent list` reports the **new** id |
| The workspace it left | If it was the workspace's only pane and the move is cross-workspace, the workspace is **removed** (`workspaces.remove(source_ws_idx)`, reported as `closed_workspace_id`). A worktree workspace is removed the same way; the checkout on disk is not touched |
| Worktree link | The link (`worktree_space`) belongs to the **workspace**, not the pane. A pane that leaves takes none of it, and the link goes with the closed workspace |

### 3. The worktree link and what replaces crew's check

**Verified (source).**

- `workspace get` reports `worktree.checkout_path` from the workspace's `worktree_space`. That
  field is set only by `worktree create` and `worktree open` (`mark_worktree_membership`,
  `ensure_source_parent_membership`). There is no API that sets it on a workspace made another
  way. A workspace made with `workspace create --cwd <worktree>` has no `worktree` key (compare
  the operator's `refi-dao-os` row in `workspace list`: none).
- `worktree remove --workspace <id>` needs that link and `is_linked_worktree`. On any other
  workspace it fails with `not_linked_worktree` ("workspace is not a Herdr-managed worktree
  checkout"). On a missing id: `workspace_not_found`.
- **What it does when it works:** it first shuts down the terminal runtime of **every pane in
  that workspace** (`shutdown_workspace_terminal_runtimes_for_worktree_remove`), runs
  `git worktree remove` (no force unless asked; dirty gives `dirty_worktree_requires_force`),
  then closes the workspace (`close_removed_linked_worktree_workspace`). It keeps the branch.
  This is why release closes the agent's workspace today: it is herdr's design, not crew's.
- **What replaces crew's check in a shared workspace.** Nothing needs replacing in the code: the
  check `workspaceCheckout(a.workspace) === a.worktree` already falls through to git when the
  workspace has no worktree (null) or no longer exists (`workspace_not_found`, which `release`
  catches; only `herdr_timeout` stops it, `core.mjs` around line 413). Git does what crew
  already trusts it for with `--on` (spec 5.3 item 2). What is **lost** is herdr's
  shutdown-then-remove sequencing: with git, the agent's process is still running in the
  directory when it is deleted (see 5).
- Can crew create the worktree with git alone and start the agent in a pane of a shared
  workspace? **Yes.** `git.addDetached` exists for `--on`; a branch variant is `git worktree add
  -b crew/<id> <path> <base>`. Then `tab create --workspace <crew> --cwd <path>` returns
  `result.tab` and `result.root_pane` and `agent start` proceeds as today. herdr then knows
  only a pane whose cwd is that directory. It does not know it is a worktree.
- What would not come for free: herdr's `worktree create` also takes a per-request
  `trust_repository` flag, creates the parent repository workspace if none is open (spec 5.3
  item 4), and takes the `--path`. A git-made worktree skips the first two; whether that is a
  gain was not checked.

### 4. Seeing them together, with no change to how worktrees are made

**Verified (source and installed schema).**

- **The sidebar Agent panel is already global.** `agent_panel_entries_from`
  (`src/ui/sidebar.rs`) flat-maps `app.workspaces`: every pane of every workspace. The config key
  `ui.agent_panel_scope` is accepted only as a legacy no-op (`_legacy_agent_panel_scope`,
  `src/config/model.rs`; tests assert it is accepted "without warning"). Sorting is
  `ui.agent_panel_sort`; the operator's `config.toml` sets `priority`. Rows can show `workspace`
  and `tab` tokens (default `["state_icon","machine","workspace","tab"]`).
- **Labels crew can set.** `herdr pane report-metadata <pane> --source crew --token role=… --token
  assignment=…` and `herdr workspace report-metadata <ws> --source crew --token …` (CLI
  reference lines 160 and 305). Tokens are display-only, at most 16 per call, names
  `[A-Za-z0-9_-]{1,32}`, with `--ttl-ms` up to 24 h. They show only where the operator's
  `[ui.sidebar.agents]` / `[ui.sidebar.spaces]` rows list `$role` etc. That is an edit to
  the operator's `config.toml`, which crew does not own.
- **A filtered view exists but has no CLI.** `agent.view.set` (socket API; in the installed
  schema) installs a transient filter and sort over the Agent panel, filterable by
  `workspace_id`, `status`, `agent`, or any pane-metadata token. `herdr agent` has no
  subcommand for it (`herdr agent --help`: list, get, read, send-keys, prompt, rename, focus,
  wait, attach, start, explain). It is lost when the server exits. `herdr.mjs` only wraps the
  CLI, so using it would mean crew speaking the socket directly.
- **What this does not give.** The Agent panel shows agents, not worktrees or assignments, and in
  a session with 52 agents (this one, `agent list`) crew's four to six rows are mixed in with the
  operator's own. The `agent.view.set` filter on a `crew` token is the way to separate them.

### 5. Keeping them open

**Source plus herdr's docs; the live behaviour of the agent is not verified.**

- Through herdr's `worktree remove` the pane cannot stay: its runtimes are shut down and its
  workspace closed (finding 3). Nothing to configure.
- Through git, `git worktree remove` deletes the directory under a running shell. herdr has no
  handling for a vanished cwd while the pane is alive that this seat could find. What the source
  does show:
  - A cwd *report* for a pane whose path is not a directory is **ignored**
    (`AppEvent::TerminalCwdReported`: `if !cwd.is_absolute() || !cwd.is_dir() { return }`), so
    herdr keeps the last cwd it had. The pane does not close.
  - On session **restore**, a saved pane cwd that does not exist falls back to `$HOME`, and a
    saved worktree link whose checkout is gone is dropped (`restore.rs`:
    `restored_worktree_space_membership` requires `checkout_path.exists()`).
  - So: the pane and the agent process stay; its cwd is a deleted directory until the next
    herdr restart, after which the pane (if its workspace is restored) starts in `$HOME`.
- **Not found:** what a Claude, Codex or opencode agent does when its cwd is deleted under it.
  It may keep answering and fail on the first file operation; that is the agent's, not herdr's.
  See experiment E3.

## Designs compared

All three are checked against the same three things: release safety (spec 5.2), the board's join
by pane id (spec 8: `herdr agent list` joined to the assignment's recorded `pane` by `pane_id`),
and an operator who closes a pane by hand.

### A. Keep a workspace per agent; add a shared view; stop closing on release

What changes: nothing at seat. Crew writes `pane report-metadata` / `workspace report-metadata`
(`role`, `assignment`) once the pane exists. On release, crew removes the worktree **with git**
instead of `herdr worktree remove`, so the workspace and agent stay.

- **Release safety.** Every rule in 5.2 stays: refuse while working, no removal of a dirty tree,
  branch kept, no force. What goes: the "closes only the workspace the launcher created" rule
  becomes "closes nothing". New exposure: git removes the tree under a live agent (finding 5), so
  a still-running agent can write into a gone directory, or fail. Mitigated because release
  already refuses a working agent, so only an idle one is affected.
- **Board join.** Unchanged: pane id never moves.
- **Operator closes a pane by hand.** Same as today: that agent is gone, the assignment shows
  under "Needs release", release still works (git).
- **Cost.** One conditional in `release` (use git, do not call `removeWorktree`), two
  `report-metadata` calls, a spec edit to 5.2. Plus an operator decision (below).
- **Leftovers.** A released agent stays alive and holds a name (`researcher`, then
  `researcher-2`) and a pane until the operator closes it. The concurrency cap counts only open
  assignments, so it does not block seating.

### B. Panes or tabs of one crew workspace, worktrees made by git

What changes: `seat` makes the worktree with git (branch variant of `addDetached`), finds or
creates the crew workspace, and runs `tab create --workspace <crew> --cwd <path>`.

- **Release safety.** `herdr worktree remove` is unavailable (`not_linked_worktree`), so release
  is git always, as in A. `workspaceCheckout` returns null for the shared workspace, so the
  existing guard keeps working, but the id recorded as `a.workspace` is now the *shared*
  workspace. It must never be passed to `worktree remove`; finding 3 says herdr would refuse
  it (`not_linked_worktree`) because that workspace carries no link, so the guard holds.
- **Board join.** Unchanged: pane ids are the ones herdr gave at creation and never move.
- **Operator closes a pane by hand.** Same as A. But **closing the crew workspace or its last
  tab kills every agent in it at once**, which today needs one click per agent. This is the
  real new cost.
- **Cost.** New: finding the crew workspace across herdr restarts (by label; a user can rename
  it), recreating it when closed, git branch creation, a base and path that herdr's `worktree
  create` handled, and the layout choice (a tab per agent, since many panes in one tab get
  unusably small). Spec 5, 5.2, 5.3 items 1, 3, 4, 6 and 8 change.
- **Gain over A.** One workspace row in the sidebar; agents next to each other as tabs.

### C. Create with `worktree create`, then `pane move` into the crew workspace

- **Release safety.** The move closes the worktree workspace (finding 2), so herdr's remove is
  unavailable afterwards: same as B, and `workspaceCheckout(<old id>)` then fails with
  `workspace_not_found`, which release survives only because of the catch.
- **Board join.** **Breaks.** The assignment records `root_pane.pane_id` at creation; after the
  move `agent list` reports a different id. Crew must read `move_result.pane.pane_id` and
  rewrite the record. A crash between the move and that write leaves a live agent the board
  lists under "Needs release". The caller join in `callerAssignment` also uses the process's
  inherited `HERDR_PANE_ID` (the old id), which herdr only resolves as an alias.
- **Operator closes a pane by hand.** As B, with B's whole-crew risk.
- **Cost.** All of B's, plus a record rewrite and a window of inconsistency. Its only gain over B
  is that herdr made the branch and worktree, which git can do.

| | Seen together | Stays open | Release safety | Board join | Hand-closing blast radius |
| --- | --- | --- | --- | --- | --- |
| A | Agent panel (already) | yes, via git removal | unchanged rules, cwd deleted under idle agent | unchanged | one agent |
| B | one workspace, tabs | yes | unchanged rules, herdr remove lost | unchanged | whole crew if workspace is closed |
| C | as B | as B | as B | **breaks on move** | as B |

## Recommendation

**Build A. Do not build B or C unless the operator says the sidebar Agent panel is not enough.**

Why: the operator's goal ("see them together, keep them open") splits into two needs, and the
two cheapest changes meet them without touching how worktrees are created. The first is already
true in herdr; the second is one branch in `release`. B and C spend most of their cost on a
workspace-level grouping whose only added value over the Agent panel is visual adjacency, and
they add a one-click way to lose the whole crew.

What an engineer would build and check:

1. In `release`, never call `herdr worktree remove`; remove with git (the existing
   `ctx.git.removeWorktree`). Check: after release the assignment is `released`, the worktree is
   gone, `herdr agent list` still shows the agent and `workspace list` still shows its
   workspace, and `release` run twice still reports truthfully.
2. After the pane exists at seat, call `herdr pane report-metadata <pane> --source crew --token
   role=<role> --token assignment=<id>` (and the workspace equivalent). Failure must not fail the
   seat. Check: `herdr agent get <name>` shows the tokens.
3. Document the optional `[ui.sidebar.agents]` row (`["state_icon","workspace","$role"]`) in
   `docs/CREW.md` as the operator's own edit; crew does not write `config.toml`.
4. Spec 5.2 bullet "Closes only the herdr workspace the launcher created …" becomes "Leaves the
   herdr workspace open; closing it is the operator's".

**Decision needed from the operator before step 1:** should a released agent stay alive, with
its working directory deleted? If the operator would rather see the transcript than keep the
agent, an alternative with no release change is to leave panes unreleased longer; the board
already shows who is idle.

## Experiments for the operator (throwaway session only)

Run each in `herdr --session crewtest`, in a scratch git repository. None touches the real
session. `W` is a workspace id, `P` a pane id, read from each command's JSON.

| # | Commands | What each result would mean |
| --- | --- | --- |
| E1 | `herdr --session crewtest workspace create --cwd /tmp/a --label crew --no-focus`, then `tab create --workspace W --cwd /tmp/b --label t2 --no-focus`, then `agent list` | The second row's `cwd` is `/tmp/b` and `workspace_id` is `W`: confirms several directories in one workspace (finding 1) |
| E2 | `git -C <repo> worktree add -b exp <wt>`; `tab create --workspace W --cwd <wt>`; `workspace get W`; `worktree remove --workspace W` | `workspace get` has no `worktree` key and `worktree remove` returns `not_linked_worktree`: confirms git-made worktrees cannot be removed through herdr (finding 3) |
| E3 | In the pane from E2 start a shell (and, separately, an agent via `agent start`), then `git worktree remove <wt>`, then `agent list`, `pane get P`, `pane run P "pwd; ls"` | Pane stays and cwd is stale: confirms finding 5. `pwd` or `ls` erroring shows what an agent will hit. If the pane **closes**, the recommendation fails and A is not buildable |
| E4 | `worktree create --cwd <repo> --branch x --path <wt2>`, then `pane move <root pane> --new-tab --workspace W --no-focus`, then `workspace list`, `agent list`, `worktree remove --workspace <old>` | The old workspace is gone, `agent list` shows a new pane id, remove returns `workspace_not_found`: confirms finding 2 and why C breaks the join |
| E5 | `worktree remove --workspace <a worktree workspace with a running agent>` | The agent process exits and the workspace closes: confirms finding 3's "kills every terminal" |
| E6 | `workspace close W` on a workspace with three tabs | Whether herdr asks first and whether all three agents die: sizes B's blast radius |

## What is contested, and by whom

- **herdr's own docs and the installed skill disagree on aliases.** The v0.9.1 CLI reference
  says herdr "retains the old pane ID as an alias for that terminal"; `herdr --skill` says only
  the moved process's inherited context resolves the old id and not to use it as a target. The
  source shows an alias map that `parse_pane_id` consults for any caller. The safe reading, and
  the one crew should follow, is the skill's: use the new id.
- **Whether visual adjacency matters.** This note judges the Agent panel sufficient on a single
  reading of "see all crew agents together". Only the operator can say it is not.

## Left unresolved

- Whether the operator's UI actually shows the Agent panel at a size that makes the crew's rows
  readable among 52 agents. Not checkable from a pane.
- What the claude, codex and opencode agents do with a deleted cwd (E3).
- Whether workspace ids are reused after a close. Crew's `workspaceCheckout` guard assumes a
  reused id can name something else; the source was not read for id allocation.
- Whether the installed 0.9.1 binary is built from commit `065ef9d`. The schema matches the
  features cited; behaviour under the cited functions is read from source, not observed.
- `agent.view.set` has no CLI, so crew cannot use it without the socket. Not needed for A.
