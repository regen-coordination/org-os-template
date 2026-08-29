---
description: "Open org-os session — sync, gather state, render dashboard, plan work"
agent: build
---
<!-- GENERATED from .claude/commands/initialize.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


You are opening a new org-os session. Follow these steps exactly.

## Step 1: Sync

Pull latest changes (skip silently if offline or no remote):

```bash
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
if [ "$TOPLEVEL" = "$(pwd)" ]; then
  git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"
else
  echo "sync: embedded repo — skipping pull"
fi
```

## Step 2b: Buzz channel read-back (optional, fail-open)

If the workspace has the Buzz lane configured (`npm run buzz:doctor` exits 0), run
`npm run buzz:read` and include its output block in the session context under
"Since last session". If the doctor is not green, skip silently — one line at most.

## Step 2: Render Dashboard

Run the initialize script with `--format=markdown` and **print its output verbatim** — the script renders the full ASCII dashboard. Do not reformat, re-render, or wrap in extra markdown:

```bash
node scripts/initialize.mjs --format=markdown
```

If the script fails (missing deps, node not found):

1. Try `npm install`, then retry once.
2. If still failing, fall back to reading these files directly and produce a minimal status summary: `IDENTITY.md`, `HEARTBEAT.md`, `federation.yaml`, `data/projects.yaml`, `data/tasks.yaml`, recent files in `memory/`, and `docs/agent-plans/QUEUE.md`.
3. Never block — always produce something useful.

## Step 3: Note Session Context

Silently note for the rest of the session:

- Organization (from header / `federation.yaml`)
- Highest-priority task (Critical / Urgent in the dashboard)
- Active projects and active plans (from Plans / Pipelines section)
- Funding deadlines within 30 days
- What was worked on last (Recent Context)

## Step 4: Wait for the Operator

End by displaying the **Session Prompt** with 3 contextual suggestions (already produced by the script), then wait for the operator to pick what to work on. Transition to **Phase 2: PLAN** — load context, analyze, present a tight 5–7 step work plan, then execute.

For the full session lifecycle (PLAN → EXECUTE → CLOSE), see `skills/org-os-init/SKILL.md`. For platform-specific handling (Hermes, OpenCode), see `skills/initialize/SKILL.md`.

$ARGUMENTS
