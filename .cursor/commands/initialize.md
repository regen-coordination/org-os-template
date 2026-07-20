---
description: "Open org-os session — sync, gather state, render dashboard, plan work"
---
<!-- GENERATED from .claude/commands/initialize.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


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

## Radicle-canonical variant

Everything above is the **github-canonical (default)** path — unchanged. If `federation.yaml` has `platforms.canonical: radicle`, branch instead:

- **Step 1 (sync):** `rad sync` (via the driver's `syncUpstream()`) instead of `git pull --rebase --quiet`; same non-blocking behavior — if the node isn't running, that's the normal (soft) offline state, continue with local state exactly as the github path does for "no remote".
- **Step 2 (dashboard):** unchanged — `node scripts/initialize.mjs` still renders from local files; it doesn't need network access either way.
- **Step 3 (session context):** in addition to the existing notes, silently note the peers panel via `driver.listPeers(rid)` (the identity doc's delegates) instead of a GitHub collaborators list. For drift, `driver.getDrift(rid)` supplies the canonical branch *name* (`canonicalRef`, e.g. `rad/main`); the actual ahead/behind is a local `git rev-list` against that branch in your checkout (same computation as `scripts/sync-upstream.mjs`), not a live count from `getDrift` — it has no working copy, so its counts are always 0.
