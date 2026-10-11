---
id: 2026-10-10-researcher-what-herdr-does-when-an-agent-is-started
role: researcher
agent: researcher
kind: claude
branch: crew/2026-10-10-researcher-what-herdr-does-when-an-agent-is-started
detached: false
pane: 'w0:p1'
workspace: w0
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-researcher-what-herdr-does-when-an-agent-is-started
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:24:32-03:00'
updated: '2026-10-10T23:31:19-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

What herdr does when an agent is started before its pane is ready, from herdr's own sources

Goal. Crew starts an agent in a pane herdr has just created. Tonight that failed once with herdr's message "agent target pane wP:p1 is not an available shell", and crew now retries the start for up to 8 seconds, matching on that message text because nobody knows the error code, and guessing the 8 seconds. Three engineers and two reviewers left the same questions unanswered because none of them looked at herdr itself. Answer them from primary sources so the guess can be replaced by something known.

The questions.
1. What error code does herdr return with "is not an available shell", and what other errors can `herdr agent start` return (is there a documented error table)?
2. Does herdr offer a readiness signal that is better than retrying on an error: a wait flag on `worktree create` or `agent start`, a pane state in `pane get` or `pane list`, an event stream?
3. When `herdr agent start` is cut off by the caller (crew kills it after 60 seconds), can the agent have started anyway? Does herdr refuse a second start with the same name, and with what error?
4. When `herdr agent prompt` fails or times out, what does herdr say about delivery? Which of its errors prove that nothing was sent? Crew currently trusts only "herdr binary missing" as proof.
5. When `herdr worktree create` is cut off, what can be left behind (branch, worktree, workspace)?

Sources, in order of trust. The installed herdr itself, read only: `herdr --version`, `herdr --help` and the `--help` of each subcommand, and any documentation or schema it ships beside the binary (find where it is installed from `which herdr`). Then herdr's published documentation (https://herdr.dev) and its source repository if it is public. Crew was written against herdr 0.9.1; say which version you read. What crew assumes today is in docs/superpowers/specs/2026-10-10-org-os-crew-design.md section 5.3 and scripts/crew/herdr.mjs.

Ruled out. Do not create, start, prompt, close or remove any pane, agent, workspace or worktree: no herdr command that changes state, only help text and read-only listing. So a question that can only be settled by an experiment stays open; say exactly what experiment the operator would run to settle it.

Done means. A note at docs/research/2026-10-10-herdr-agent-start-readiness.md committed on your branch: each question, what the source says with the command or link that shows it, marked verified at the source or not found; and a proposal an engineer could build and check (for example: match on code X, or wait on signal Y instead of retrying). Report with the note's path and what stays unresolved. If the proposal needs building, hand off to engineer.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:29:14-03:00

Research note committed on my branch (e21e6df): docs/research/2026-10-10-herdr-agent-start-readiness.md

Read: installed herdr 0.9.1 (help, --skill, api schema, read-only pane process-info), herdr's public source at tag v0.9.1, and the published docs (index points at v0.9.3). No state-changing herdr command was run. The pre-commit hook needed js-yaml, so I ran `npm ci --ignore-scripts` in my worktree (lockfile deps only; no dependency added); hook passed 53/53.

Answers, each verified at source unless stated:
1. "is not an available shell" is code `agent_pane_busy` (src/app/agents.rs; asserted in tests/cli/agent_transport.rs; string present in the installed binary). No documented error table exists; error.code is an untyped string. The note lists the nine start codes read from source. The same code and message cover two causes: a pane that already hosts an agent or pending start, and a shell not at its prompt, so neither a code match nor crew's message match can tell "still starting" from "occupied".
2. No wait flag on worktree create or agent start, and no shell-ready event or field. herdr's own CLI already retries agent_pane_busy for 2 s at 100 ms, only while `pane process-info` shows the shell as foreground leader. `pane process-info` (shell_pid, foreground_process_group_id, foreground_processes) is the best available signal.
3. Yes, the agent can start anyway: agent.start is synchronous and writes the launch command; the CLI does the waiting. The second start returns `agent_name_taken` (same name) or `agent_pane_busy` (other name). A herdr `timeout` does not prove no agent started.
4. Prove nothing sent: empty_agent_prompt, agent_not_found, agent_target_ambiguous, agent_blocked, agent_not_ready. `agent_prompt_failed` is ambiguous (can follow a typed but unsubmitted prompt); `timeout` and `agent_prompt_stalled` are explicitly not proof.
5. worktree create runs git on a server thread and is not cancelled by the caller. Can leave branch, checkout directory, workspace; no rollback in the create path.

Proposal: five changes in scripts/crew/herdr.mjs (code match plus pane check, replace the 8 s guess with a process-info check, look before retrying a cut-off start, widen prompt proof, name leftovers after a failed worktree create). Handed to engineer: handoff-2026-10-10-build-the-proposal-in-docs-research-2026.

Unresolved (need operator-run experiments, listed in the note): why herdr's 2 s retry did not cover tonight's failure; observing a killed agent start; whether the binary equals the v0.9.1 tag; git leftovers on a killed worktree add; whether upstream will add a shell-ready signal.
