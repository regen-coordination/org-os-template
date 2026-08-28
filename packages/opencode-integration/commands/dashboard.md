---
description: Render the org-os dashboard (same content as Claude Code's /initialize)
agent: build
---

The operator wants to see the org-os organizational dashboard.

Run the org-os dashboard renderer and present its output verbatim:

!`npm run page --silent -- dashboard`

After showing the dashboard, briefly highlight (in 2-3 sentences max):

1. Anything **critical** or **urgent** in the Tasks section
2. Any **funding deadlines** within 7 days
3. Any **instance drift** or sync issues from the Federation section

Then ask the operator what they'd like to work on. Common drill-downs:

- `/org-projects` — full project table
- `/org-decisions` — decisions log
- `/org-this-week` — meetings, events, deadlines
- `/dashboard <page-id>` — any other page id (e.g. `instances`, `tasks`, `plans`)
