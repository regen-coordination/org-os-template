---
description: Open org-os session — sync, gather state, render dashboard, plan work
---

You are opening a new org-os session. Follow these steps exactly:

## Step 1: Sync

Run this command to pull latest changes:

```bash
git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"
```

## Step 2: Gather State

Run the data gatherer script to collect all organizational state:

```bash
node scripts/initialize.mjs
```

If the script fails (missing dependencies, node not found), try `npm install` first, then retry. If it still fails, read the key files manually: `IDENTITY.md`, `HEARTBEAT.md`, `federation.yaml`, `data/projects.yaml`, `data/members.yaml`, `data/finances.yaml`, `data/meetings.yaml`, `data/events.yaml`, `data/funding-opportunities.yaml`, `data/ideas.yaml`, and recent files in `memory/`.

## Step 3: Read the Skill

Read `skills/org-os-init/SKILL.md` for the full visual language and dashboard layout specification.

## Step 4: Read the Plan Queue

Read `docs/agent-plans/QUEUE.md` to know what plans are active, queued, and in scoping.

## Step 5: Render Dashboard

You are now in **Phase 1: OPEN**. Using the JSON from Step 2 and the visual spec from Step 3, render the full initialization dashboard:

1. **ASCII block-letter banner** with the org name inside a `╭╰` panel
2. **Active Projects** with IDEA stages and leads
3. **Tasks** from HEARTBEAT.md grouped by urgency (⚡ critical, ◆ urgent, ◇ upcoming)
4. **This Week** — events + meetings merged into a calendar strip
5. **Funding** — only if deadlines within 30 days
6. **Recent Context** — last 2-3 memory entries
7. **Plan Queue** — show active and next queued plans from `docs/agent-plans/QUEUE.md`
8. **Apps & Workspaces** — available packages and skills with launch commands
9. **Cheatsheet** — key commands and session workflow
10. **Federation** — upstream, peers, skills count
11. **Session Prompt** — 3 contextual suggestions ranked by urgency, then open prompt

After the operator picks what to work on, transition to **Phase 2: PLAN** — load context, analyze, and present a tight work plan (5-7 steps max). Then execute.

$ARGUMENTS
