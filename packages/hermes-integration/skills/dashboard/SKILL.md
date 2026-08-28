---
name: dashboard
description: Render the org-os organizational dashboard — projects, tasks, instances, plans, recent context, federation. Same content as Claude Code's /initialize.
version: "0.1.0"
platforms: [darwin, linux]
metadata:
  hermes:
    tags: [org-os, dashboard, observability]
    category: integrations
    config:
      - name: ORG_OS_ROOT
        description: "Path to the operator's org-os repo. Required."
        required: true
---

# /dashboard — render org-os state

When the operator invokes `/dashboard`, call the `org_os_page` tool with `page_id="dashboard"` and embed the output verbatim in your response.

After showing the dashboard, briefly highlight (in 2-3 sentences max):

1. Anything **critical** or **urgent** in the Tasks section
2. Any **funding deadlines** within 7 days
3. Any **instance drift** or sync issues from the Federation section

Then ask the operator what they'd like to work on. Useful follow-ups:

- `/initialize` — same dashboard with proposed work suggestions
- `org_os_page("projects")` — full project table
- `org_os_page("decisions")` — decisions log
- `org_os_page("this-week")` — meetings, events, deadlines

If `org_os_page` returns an `ERROR:` message, check that `ORG_OS_ROOT` is set in the operator's environment and points at a valid org-os repo with `package.json` at its root.
