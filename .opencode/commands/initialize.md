---
description: Open org-os session — sync, render dashboard, plan work
---

Load the **org-os-init** skill (and the `initialize` skill for platform-specific handling) for the full session lifecycle instructions.

First, sync the workspace:

```
!`git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"`
```

Then render the dashboard. The script outputs a fully-rendered ASCII dashboard — **print it verbatim**, do not reformat:

```
!`node scripts/initialize.mjs --format=markdown`
```

You are now in **Phase 1: OPEN**. The dashboard above is the org's current state — banner, projects, tasks, calendar, plans/pipelines, federation, and a session prompt with 3 contextual suggestions.

After the operator picks what to work on, transition to **Phase 2: PLAN** — load context, analyze, present a tight 5–7 step work plan, then execute.
