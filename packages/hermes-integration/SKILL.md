---
name: org_os_pages
description: Inspect org-os organizational state — dashboards, projects, instances, plans, decisions — without leaving the agent. Pages render to plain text via `npm run page <id>` in the operator's org-os repo.
version: "0.1.0"
platforms: [darwin, linux]
metadata:
  hermes:
    tags: [org-os, dashboard, observability, integrations]
    category: integrations
    config:
      - name: ORG_OS_ROOT
        description: "Path to the operator's org-os repo. Required."
        required: true
---

# org_os_pages — view org-os state from hermes

This skill registers the `org_os_page` tool, which calls `npm run page <id>` in the operator's org-os workspace and returns the rendered text. Hermes can use this tool whenever the operator asks about organizational state — projects, tasks, instances, plans, decisions, federation health, and so on.

## Usage

In a hermes conversation, ask:

- "Show me the org-os dashboard" → `org_os_page("dashboard")`
- "What's on this week?" → `org_os_page("this-week")`
- "Drill into v2-stabilization" → `org_os_page("project/v2-stabilization")`
- "Are any instances drifting?" → `org_os_page("health")`
- "What decisions did we make recently?" → `org_os_page("decisions")`

The tool's output is markdown-clean — embed it inline in your response.

## Page ids

The full list lives in `packages/tui-data/src/builtin-pages.mjs` of the org-os repo. Common ids:

- **Section**: `dashboard`, `projects`, `tasks`, `plans`, `instances`, `federation`, `members`, `ideas`, `funding`, `calendar`, `memory`, `decisions`, `skills`, `packages`
- **Entity**: `project/<id>`, `instance/<id>`, `plan/<id>`, `idea/<id>`, `member/<id>`, `skill/<id>`, `package/<id>`, `decision/<slug>`
- **Cross-cut**: `health`, `this-week`, `promotions`, `attention`

## Setup

Set `ORG_OS_ROOT` in the operator's shell to point at the org-os repo:

```bash
export ORG_OS_ROOT=~/code/org-os
```

If `ORG_OS_ROOT` is not set or doesn't point at a directory containing `package.json`, the tool returns an actionable error rather than crashing.

## When to use this skill

Trigger when the operator asks anything about:

- Project status, workstream stages, owners, dates
- Open tasks, urgent or critical items
- Plan pipeline (scoping/queued/active/completed)
- Federation health: instances, drift, last-sync
- Recent decisions and their rationale
- Funding deadlines or calendar events this week
- Skills or packages eligible for promotion
- "What needs my attention?" — use `attention` page

Don't use for general code exploration — this is org-state observability, not file search.
