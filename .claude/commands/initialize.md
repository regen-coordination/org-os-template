---
description: Open org-os session — sync, gather state, render dashboard, plan work
---

You are opening a new org-os session. Follow these steps exactly.

## Step 1: Sync

Pull latest changes (skip silently if offline or no remote):

```bash
git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"
```

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
