---
id: framework-dashboard-template
title: "Reusable Dashboard Package Template"
status: scoping
priority: null
scope: framework
depends_on: []
created: 2026-04-06
started: null
completed: null
estimated_sessions: null
tags: [v2, packages, dashboard]
workstream: v2-stabilization
---

## Goal

Build the organizational health dashboard as a reusable package template in the framework. Instances customize identity and data sources.

## Open Questions

- Should instances build their own dashboard from scratch or fork the framework template?
- How much customization per instance? (just identity/colors, or full component overrides?)
- Deployment target: GitHub Pages, Vercel, or both?

## Rough Tasks

- [ ] Build `packages/dashboard/` in org-os framework:
  - React 19 + Vite 6 + Tailwind 3.4
  - 8 sections: Identity, Metrics, Projects, Governance, Finances, Heartbeat, Federation, Activity
  - `scripts/generate-dashboard-data.mjs` reads `data/*.yaml` → `dashboard.json`
  - CSS-only visualizations (progress bars, status badges)
- [ ] Make identity/theming configurable via `dashboard.config.json` or similar
- [ ] Test with both refi-dao-os and refi-bcn-os data
- [ ] Document in `packages/dashboard/README.md`
