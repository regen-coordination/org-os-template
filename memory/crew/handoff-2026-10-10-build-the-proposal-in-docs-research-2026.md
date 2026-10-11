---
id: handoff-2026-10-10-build-the-proposal-in-docs-research-2026
from: 2026-10-10-researcher-what-herdr-does-when-an-agent-is-started
to_role: engineer
branch: crew/2026-10-10-researcher-what-herdr-does-when-an-agent-is-started
status: declined
created: '2026-10-10T23:29:04-03:00'
updated: '2026-10-10T23:31:25-03:00'
taken_by: null
reason: >-
  Taken, by another route: the work is seated as assignment
  2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with-wha (see the board
  for the exact id) on a new branch from feat/crew. seat --handoff would have
  put the engineer on a detached copy of the research branch, which lacks
  tonight's merged code; that gap is part C of the engineer's brief.
---
## Brief

Build the proposal in docs/research/2026-10-10-herdr-agent-start-readiness.md (section 'Proposal for org-os') in scripts/crew/herdr.mjs with tests: (1) retry agent start only on code agent_pane_busy AND pane process-info showing a bare shell not yet foreground / no agent on that pane, keep message regex as fallback; (2) replace the 8s guess with a pane process-info shell-foreground check; (3) after timeout/herdr_timeout/transport failure on start, look with agent get <pane_id> before retrying; (4) treat empty_agent_prompt, agent_not_found, agent_target_ambiguous, agent_blocked, agent_not_ready as proof nothing was sent in promptAgent; (5) after a failed worktree create, name leftovers (branch, checkout, workspace) before retrying. Update spec section 5.3 item 7 to record the code. Source facts are in the note; do not run herdr state-changing commands except in the operator-approved experiments listed there.
