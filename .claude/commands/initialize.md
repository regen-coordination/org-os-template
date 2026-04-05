---
description: Open org-os session — sync, render dashboard, plan work
---

Load the **org-os-init** skill (`skills/org-os-init/SKILL.md`) for the full session lifecycle instructions.

First, sync the workspace to make sure we have the latest state:

```
git pull --rebase --quiet 2>&1 || echo "sync: no remote or offline — continuing with local state"
```

Here is the current organizational state:

```json
$ARGUMENTS
```

If the JSON above is empty or `$ARGUMENTS` was not substituted, run `node scripts/initialize.mjs` to gather the data yourself.

You are now in **Phase 1: OPEN**. Render the full initialization dashboard following the skill's visual language — ASCII block-letter banner, projects, tasks, calendar, apps & workspaces, cheatsheet, federation. End with 3 contextual suggestions.

After the operator picks what to work on, transition to **Phase 2: PLAN** — load context, analyze, and present a tight work plan. Then execute.
