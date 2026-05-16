---
name: initialize
description: Initialize Organizational OS workspace session — sync git, generate dashboard, display workspace state. Use at the start of every session to see current status.
version: "1.0.0"
license: MIT
tier: core
triggers:
  - /initialize
  - initialize workspace
  - show dashboard
  - workspace status
  - session start
platforms:
  - hermes
  - opencode
  - claude-code
  - cursor
inputs:
  - Git repository state
  - Workspace YAML data files
  - Optional Notion API (falls back to YAML only)
outputs:
  - ASCII dashboard with workspace state
  - Session context for agent
metadata:
  audience: operators
  workflow: session-lifecycle
  parent_skill: org-os-init
---

# Initialize — Org-OS Session Dashboard

**For Hermes/OpenCode agents working in organizational OS workspaces.**

This skill triggers the initialization sequence that displays the workspace dashboard. Run this at the start of every session to sync the latest state and see what's happening across the organization.

## Trigger

The user invoked `/initialize` (or said "initialize workspace", "show dashboard", etc.).

## Execution Protocol

### Step 1: Git Sync

Sync the repository to ensure we're working with the latest state:

```bash
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ "$TOPLEVEL" != "$(pwd)" ]; then
  echo "sync: embedded repo — skipping"
elif ! git fetch --quiet 2>/dev/null; then
  echo "sync: no remote or offline — local state only"
elif ! git rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then
  echo "sync: no upstream tracking branch — local state only"
else
  BEHIND=$(git rev-list --count HEAD..@{u} 2>/dev/null)
  AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null)
  DIRTY=$(git status --porcelain 2>/dev/null | head -1)
  if [ "$BEHIND" = "0" ] && [ "$AHEAD" = "0" ] && [ -z "$DIRTY" ]; then
    echo "sync: up to date with origin"
  elif [ "$BEHIND" = "0" ]; then
    echo "sync: up to date (ahead $AHEAD, $([ -n "$DIRTY" ] && echo "uncommitted changes" || echo "clean"))"
  elif [ -z "$DIRTY" ]; then
    git pull --rebase --quiet && echo "sync: rebased $BEHIND commit(s) from origin"
  else
    echo "sync: ⚠ $BEHIND new commit(s) on origin but working tree is dirty — commit or /close first, then re-run /initialize"
  fi
fi
```

The sync is **non-blocking by design**: it never errors out, only reports state. If the branch is behind AND the working tree is dirty, the operator gets a clear instruction (commit or `/close` first) instead of a silent skip — this matters when collaborators unfamiliar with git rely on `/initialize` and `/close` as their only git interface.

**Vault-safe rule:** never `git stash`, `git clean`, or `git reset --hard` to clear a dirty tree before pulling. If a vault-style workspace has accumulated uncommitted notes that block sync, run `npm run vault:snapshot -- "before pull"` (where available), then commit, then re-run.

### Step 2: Generate Dashboard

Run the initialization script to generate the dashboard:

```bash
# Use absolute path and cd to workspace first for Hermes compatibility
cd "$(pwd)" && node scripts/initialize.mjs --format=markdown
```

**Critical for Hermes:** The `--format=markdown` flag outputs a pre-rendered ASCII dashboard. **Print this output verbatim.** Do not reformat, re-render, or wrap in markdown code blocks. The script handles all visual formatting.

### Step 3: Display Dashboard

Print the script output **exactly as received**. The dashboard includes:

- **Identity** — Organization name, mission, chain info
- **Status** — Last memory, schema age, peer count, runtime
- **Tasks** — Critical, urgent, and upcoming from HEARTBEAT.md
- **Projects** — Active projects with stages and leads
- **Funding** — Upcoming deadlines and active applications
- **Events** — This week and upcoming
- **Meetings** — Recent and upcoming
- **Members** — Active contributors
- **Recent Memory** — Last 3 memory entries
- **Apps** — Available workspace applications

### Step 4: Set Session Context

After displaying the dashboard, note for yourself:

1. **What is the organization?** (from Identity section)
2. **What's the highest priority task?** (from Critical/Urgent sections)
3. **What projects are active?** (from Projects section)
4. **Any funding deadlines approaching?** (from Funding section)
5. **What was worked on last?** (from Recent Memory section)

This context informs your responses for the rest of the session.

## Error Handling

If `scripts/initialize.mjs` fails or produces no output:

1. Fall back to reading key files directly:
   - `HEARTBEAT.md` — Active tasks
   - `federation.yaml` — Identity and network
   - `data/projects.yaml` — Project registry
   - `data/funding-opportunities.yaml` — Funding tracker
   - `memory/*.md` — Recent memory files

2. Produce a minimal status summary with what you can gather.

3. **Never show an error to the operator** — always produce something useful.

## Platform-Specific Notes

### Hermes

- Uses `terminal()` tool with `cd` before commands (workdir param may not work reliably)
- `--format=markdown` output is pre-rendered and should be printed verbatim
- If output is empty, the model may have failed to execute — retry once

### OpenCode

- Similar to Hermes: use `cd <workspace> && node ...` pattern
- Full terminal access available

### Claude Code / Cursor

- Can run `npm run initialize` or the node command directly
- May have better path resolution

## Example Output

```
╔══════════════════════════════════════════════════════════════════╗
║  🌱 ReFi DAO — Regenerative Finance Coordination                ║
║  Gnosis Chain • Mission: Accelerate regenerative finance...     ║
╚══════════════════════════════════════════════════════════════════╝

─── Status ─────────────────────────────────────────────────────────
  Last memory: 2026-04-24 (1d ago)    Schema: 2h ago
  Peers: 7                            Runtime: hermes
  Skills: 14

─── Tasks ───────────────────────────────────────────────────────────
  🔴 Critical (1)
    • Submit MetaGov proposal (due: 2026-04-26, 2 days)

  🟡 Urgent (2)
    • Review ReFi BCN quarterly report
    • Update Gardens plugin integration

  🟢 Upcoming (3)
    • Plan Summer Gathering event series
    • Review funding pipeline
    • Sync with hub on framework updates

─── Projects ────────────────────────────────────────────────────────
  Active (4)
    Capital Flow App        ●●●●○○   Lead: @alice
    Knowledge Exchange      ●●●○○○   Lead: @bob
    Agent Coordination      ●●●●●○   Lead: @charlie

─── Funding ─────────────────────────────────────────────────────────
  Upcoming Deadlines (2)
    • Arbitrum Grant    due in 5 days    $50k    applying
    • Gitcoin GG21      due in 12 days   —       planning

  Active (1)
    • Gnosis Builder    applied          $25k    awaiting decision

─── This Week ───────────────────────────────────────────────────────
  Wed 04/30  Community Call
  Thu 05/01  Core Team Sync

─── Recent Memory ───────────────────────────────────────────────────
  2026-04-24  Finalized Q1 retrospective, identified 3 process...
  2026-04-23  Met with ReFi BCN team on hub coordination...
  2026-04-22  Submitted initial Arbitrum grant draft...

```

## Post-Initialization

After showing the dashboard, **wait for the operator to pick what to work on**, then transition into planning/execution mode. See `org-os-init` skill for full session lifecycle (PLAN → EXECUTE → CLOSE).

## Quick Commands Reference

| To... | Run |
|-------|-----|
| Initialize | `/initialize` |
| Close session | `/close` |
| Show dashboard | `/initialize` |
| Regenerate schemas | `npm run generate:schemas` |
| Validate data | `npm run validate:schemas` |

---

**Part of the Organizational OS framework.** See `org-os-init` skill for complete session lifecycle documentation.
