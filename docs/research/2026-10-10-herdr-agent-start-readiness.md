# What herdr does when an agent is started before its pane is ready

Date: 2026-10-10. Author: researcher seat. Status: findings plus a proposal; nothing built.

## Question

Crew starts an agent in a pane herdr has just created. Once that failed with herdr's message
"agent target pane wP:p1 is not an available shell". Crew now retries `herdr agent start` for up
to 8 seconds, matching on that message because the error code was never recorded, and the 8
seconds is a guess (`scripts/crew/herdr.mjs`, spec section 5.3 item 7). Five questions were left
open. This note answers them from herdr's own sources.

## What was read, and how far it can be trusted

| Source | What | Version |
| --- | --- | --- |
| The installed binary, `~/.local/bin/herdr` | `herdr --version`, `--help`, `herdr --skill`, `herdr api schema --json`, `herdr pane process-info`, `strings` on the binary | **0.9.1** (the version crew was written against) |
| herdr's public source, `github.com/herdrdev/herdr`, tag `v0.9.1` | `src/app/agents.rs`, `src/app/api/agents.rs`, `src/cli/agent.rs`, `src/terminal/state.rs`, `src/pty/actor.rs`, `src/platform/mod.rs`, `src/app/api/worktrees/deferred.rs`, `src/worktree.rs`, `tests/cli/agent_transport.rs` | 0.9.1 tag. That the installed binary was built from this tag is **not verified**; the strings `agent_pane_busy`, `agent_name_taken`, `agent_blocked`, `agent_prompt_failed`, `agent_prompt_stalled`, `linked_worktree_source` and `dirty_worktree_requires_force` do occur in the installed binary |
| herdr's published docs, listed by `https://herdr.dev/llms.txt` | `agent-automation.mdx`, `cli-reference.mdx`, `socket-api.mdx`, `troubleshooting.mdx` | The index points at tag **v0.9.3**, two patch releases newer than the binary |

Where docs and source agree, both are cited. Where only the v0.9.3 docs say something, it is marked.

Not done, by the brief: no herdr command that changes state was run. The only live commands were
`--version`, `--help`, `--skill`, `api schema`, and read-only `pane process-info`. One caveat on
the help text: the leaf `--help` of `agent start`, `agent prompt`, `worktree create`, `pane get`
and `pane list` prints the global usage, not the subcommand's. Syntax was taken from the
docs' CLI reference and `src/cli/agent.rs` instead.

## Findings

### 1. The error code, and the other start errors

**Verified at the source.** "is not an available shell" is code **`agent_pane_busy`**.

- `src/app/agents.rs`, `agent_start_error_body`: `AgentStartError::TargetBusy(target)` maps to
  `code: "agent_pane_busy"`, `message: "agent target pane {target} is not an available shell"`.
- `tests/cli/agent_transport.rs` asserts the same pair on the wire:
  `{"error":{"code":"agent_pane_busy","message":"agent target pane w1:p1 is not an available shell"}}`.

**There is no documented error table.** The socket API page shows one example
(`not_found` / "pane not found") and says nothing more; the schema from `herdr api schema --json`
types `error.code` as a plain `string` with no enum. The list below is read from source, not from a
contract, so it can change between releases.

Errors `agent start` can return (v0.9.1 source):

| Code | When |
| --- | --- |
| `invalid_agent_name` | name does not match `[a-z][a-z0-9_-]{0,31}` |
| `unsupported_agent_kind` | `--kind` not one of herdr's kinds |
| `invalid_agent_argument` | an argument contains a control character, or cannot be encoded for the shell |
| `invalid_agent_timeout` | `--timeout` not greater than 3000 ms and at most 300000 ms |
| `agent_name_taken` | a live agent already has that name; the message lists candidates with `pane_id`, `workspace_id`, `status` |
| `agent_pane_not_found` | pane id does not resolve |
| `agent_pane_busy` | see below |
| `agent_pane_unavailable` | the pane has no live terminal runtime |
| `agent_start_input_failed` | writing the launch command to the pane failed |

Added by the CLI after the request succeeds (`src/cli/agent.rs`, `wait_for_named_agent`):
`agent_not_ready` (agent blocked at a dialog during startup), `agent_start_failed` (the process
exited before it became interactive), `agent_kind_mismatch`, `agent_name_not_found` (the name no
longer owns the terminal), `timeout` ("timed out waiting for agent startup"), and
`agent_start_transport_failed`.

**`agent_pane_busy` has two causes with one message.** `start_agent` returns `TargetBusy` when
(a) the terminal is already an agent terminal or has a managed start in progress
(`is_agent_terminal() || managed_agent_kind().is_some()`), and (b) when `available_shell_name`
finds no bare shell in the foreground: the foreground process group must be the shell's own
(`process_group_id == child_pid`), no other process may be in it, and the process name must be a
known shell (`src/platform/mod.rs`, `available_pane_shell_from_job`). Cause (a) is not a pane
that is still starting; retrying it is waiting for something that will not change. Crew's
message match, and a match on the code alone, cannot tell them apart.

### 2. A readiness signal

**No wait flag exists.** `WorktreeCreateParams` carries `base, branch, cwd, focus, label, path,
trust_repository, workspace_id` and `AgentStartParams` carries `args, kind, name, pane_id,
timeout_ms` (schema from the installed binary). `timeout_ms` bounds the wait for the *agent* to
become ready, after the start request is accepted; it does not wait for the pane's shell.

**herdr already retries this error itself, for 2 seconds.** In `src/cli/agent.rs`, `agent start`
re-sends the request every 100 ms while `agent_pane_busy` is returned, for at most
`PANE_SHELL_READINESS_RETRY_TIMEOUT` = 2 s, and only while all of these hold: the start timeout is
in range, `pane.get` still returns the same `terminal_id`, and `pane.process_info` shows the
shell initializing, meaning the foreground process group id equals `shell_pid` and a foreground
process with that pid has a shell name. If any of them fails, the first busy response is printed
at once. On non-Unix platforms the retry never happens.

Signals available to a caller that wants to wait on state instead of an error:

- `herdr pane process-info --pane <id>` returns `shell_pid`, `foreground_process_group_id` and
  `foreground_processes[]` (name, argv, pid). I ran it on this session's pane and it returned
  exactly those fields. It is the same test herdr applies. It exposes "shell is the foreground"; it
  does not say "the prompt is drawn".
- `herdr pane wait-output <id> --match <text>` or `--regex`: waits on terminal text, for example a
  prompt. It depends on the operator's prompt string.
- `events.subscribe` / `events.wait` with `pane_created`, `pane_output_changed`,
  `pane_agent_detected`, `pane_agent_status_changed`: none is a "shell ready" event.
- `PaneInfo` has `agent_status` and no field for shell readiness; `AgentInfo` has
  `interactive_ready` and `launch_pending`, which describe an agent that already started.

**Not found:** an event or field that says a new pane's shell reached its prompt.

**Unresolved: why crew still failed.** herdr 0.9.1 is documented, in source, to ride out up to 2 s
of shell start-up. Crew's failure means either shell start-up took longer than 2 s, or the
foreground job did not satisfy herdr's test (a shell rc file that runs child processes in the
foreground would not), so herdr did not retry at all. The source cannot say which. The server log
(`~/.config/herdr/herdr-server.log`) records `agent.start` outcomes as `error` but not the code
or message, so it cannot settle it either.

### 3. A start cut off by the caller

**Verified in source: the agent can start anyway.** `agent.start` is one synchronous request. The
server writes the launch command into the pane (`terminal.begin_managed_agent(...)` then
`runtime.try_send_bytes(...)`) and answers `AgentStarted` before any waiting. The waiting for
readiness is done by the CLI process, which polls `agent.get` every 100 ms
(`wait_for_named_agent`). Killing the CLI after the request was accepted leaves the command
running in the pane.

What the server holds meanwhile (`src/terminal/state.rs`, `reconcile_managed_agent_at`): the name
is `Pending` with a deadline of the start timeout (default 30 s). It is cleared at the deadline,
when the process exits, or when the expected agent was seen and then went away. If the agent
becomes ready first, the name stays on the pane.

**A second start is refused**, in this order:

1. same name, while the name is held: `agent_name_taken`, checked before the pane, with the
   holder's `pane_id` and `status` in the message;
2. a different name into that pane while an agent or pending start occupies it:
   `agent_pane_busy`.

Two consequences for crew, both from source:

- `timeout` from `agent start` does **not** prove no agent started. At the CLI's own deadline it
  clears the pending *name* on the server, but the launched process is not killed.
- Because crew's own limit is 60 s and herdr's default is 30 s, herdr's `timeout` normally arrives
  first; a crew-side kill is a rarer case, and what it leaves is as above.

The reliable check after any uncertain start is `herdr agent list` / `agent get <pane_id>` for that
pane, not a second start.

### 4. What `agent prompt` says about delivery

The docs say it plainly (v0.9.3 `agent-automation.mdx`, `cli-reference.mdx`): "A timeout or
`agent_prompt_stalled` does not prove that no input was sent. Inspect the agent before retrying."

Source (v0.9.1, non-Windows, `queue_agent_prompt` in `src/app/api/agents.rs`). These return
**before anything is queued**, so they prove that nothing was sent:

| Code | Condition |
| --- | --- |
| `empty_agent_prompt` | empty text |
| `agent_not_found`, `agent_target_ambiguous` | the target does not resolve |
| `agent_blocked` | the agent is at an approval or question dialog; docs state "without sending input" |
| `agent_not_ready` | no known active named agent, a launch still pending, or the agent is no longer the pane's foreground process |

Not proof of anything:

- `agent_prompt_failed` is raised both before the write is queued (the pty input queue is full, the
  pty actor is closed, the Copilot focus write fails) and after it, from the completion channel
  (`Ok(Err(err))` or a closed actor). The code is the same; only the message differs, and the
  message is free text. The actor writes the text first, then sleeps, then writes Enter, and its
  own comment says a started text write is committed. A failure after the text leaves a **typed
  but unsubmitted** prompt.
- `timeout`: on non-Windows `submit_deadline` is `None`, so a `timeout` from `agent.prompt` can only
  come from the `--wait` phase, after submission. Crew calls `agent prompt` without `--wait`, where
  `timeout` is not expected from herdr at all.
- A crew-side kill (herdr_timeout), a connection error, and a nonzero exit with no JSON: unknown.

So crew's current rule, "only the binary missing proves nothing was sent", is too strict by exactly
the four rows above, and correct about everything else.

### 5. `worktree create` cut off

**Verified in source** (`src/app/api/worktrees/deferred.rs`, `src/worktree.rs`). On the server,
`worktree.create` registers a pending operation keyed by the checkout path, then spawns a thread
that does `create_dir_all(parent)` and runs `git worktree add` (existing branch checked out, else
new branch from `--base`). When git returns, the server opens the workspace and answers. The
caller's connection has no part in that work, so a cut-off caller does not cancel it.

What can exist afterwards:

| Stage reached | Left behind |
| --- | --- |
| parent directory created, git not finished or failed | an empty parent directory; git's own state on failure (not examined) |
| git succeeded | the **branch** and the **checkout directory** |
| workspace opened | the herdr **workspace** and its pane; and, when the source repo had none open, a workspace for the repo too (spec 5.3 item 4) |
| failure after git: `worktree_open_failed` ("created worktree but failed to open workspace" / "…record workspace membership") | branch and checkout, **no** workspace |

There is no rollback in the create path: no code removes the checkout or branch on a later
failure. A repeat of the same create while the first is running returns
`worktree_operation_in_progress`; after it finished, an existing branch is checked out rather than
recreated, so git itself rejects it if that branch is already checked out elsewhere
(`worktree_create_failed`, git's stderr as the message). `worktree remove` never deletes the branch
(docs, socket API page).

## What is contested

Nothing here is contested in the sense of rival sources; the open points are gaps. herdr publishes
no error contract, so every code above is an implementation detail of one release. The docs are at
v0.9.3 and the binary at 0.9.1; they agree on the behaviours quoted, but I did not diff the two
source tags.

## Proposal for org-os

For `scripts/crew/herdr.mjs`, to build and check. All of it is small.

1. **Match on the code, and tell the two causes apart.** Treat a start failure as "pane may still
   be starting" only when `error.code === 'agent_pane_busy'` **and** `herdr pane process-info
   --pane <id>` shows no agent in that pane (a foreground process in the agent's kind is the
   tell) and `herdr agent list` has no entry for that `pane_id`. If the pane already hosts an agent
   or a pending start, stop: this is not readiness. Keep the message regex only as a fallback for
   an older herdr that returns no code.
2. **Replace the 8-second guess with a state check.** Poll `pane process-info` until
   `foreground_process_group_id === shell_pid` and the only foreground process is a shell, which
   is the test herdr applies, then start once. Keep a ceiling, and report which condition was
   still false when it hit. Check: start on a pane whose shell has an rc file that sleeps 5 s in
   the foreground.
3. **After a start that did not return success, look before retrying.** On `timeout`,
   `herdr_timeout` or `agent_start_transport_failed`, run `agent get <pane_id>`; if the named
   agent is there, treat the seat as started. Never send a second start with the same name into a
   pane `agent list` shows occupied. `agent_name_taken` and `agent_pane_busy` on a retry then mean
   "the first one landed".
4. **Prompt delivery.** Treat `empty_agent_prompt`, `agent_not_found`, `agent_target_ambiguous`,
   `agent_blocked` and `agent_not_ready` as "nothing was sent", in addition to the missing
   binary. Treat everything else as unknown and have the report say "may have been typed", with the
   `agent read` tail, as herdr's docs advise. Do not re-send blindly.
5. **Worktree create.** After any failure or timeout, `herdr worktree list` and `git worktree
   list` / `git branch --list` for that branch before retrying; do not repeat the create until the
   leftovers are named in the report.

## What stays unresolved, and the experiment that settles each

All experiments change herdr state, so they need the operator.

1. **Why 0.9.1's own 2 s retry did not cover the observed failure.** Create a new workspace the way
   crew does and call `herdr agent start probe --kind claude --pane <new pane>` in a loop of one
   attempt per 100 ms, logging the full JSON error and `pane process-info` each time, then close the
   probe workspace. Answers: how long the pane is busy, and whether herdr's "shell initializing"
   test was true during it.
2. **Whether a killed `agent start` leaves the agent.** Run `herdr agent start` against an
   otherwise idle pane under `timeout 1`, then `agent get <pane>` and a second start with the same
   name. Source says the agent starts and the second start returns `agent_name_taken`; it has not
   been observed.
3. **Whether the installed 0.9.1 binary equals the `v0.9.1` tag.** Only the operator can confirm; a
   build or checksum comparison would settle it.
4. **What git leaves on a killed `git worktree add`.** Source starts the command and does not
   handle its death; the on-disk leftovers were not examined.
5. **Whether any herdr release adds a code or field for "shell ready".** None in 0.9.1 or the v0.9.3
   docs; worth asking upstream (an outside post, so the operator's call).

## Handoff

The proposal needs building and is within one file plus its tests; hand it to the engineer role
with this note as the brief.
