---
name: knowledge-graph
version: 1.0.0
description: Build, update, and query the org's Graphify knowledge graph; maintain the knowledge-gaps registry for the curator
author: organizational-os
category: knowledge
metadata:
  openclaw:
    requires:
      env: []
      bins: []
      config: []
---

# Knowledge Graph Skill

The org's corpus (code + docs + data) is mapped into `graphify-out/graph.json`
by the upstream [Graphify](https://graphify.com/) CLI. This skill owns the
org-os side: when to build/update/query, and the gap-triage workflow.

## Prerequisites

`uv tool install graphifyy && graphify install` (operator does this once —
never auto-install). Everything below degrades to a one-line hint without it.

## When to use

| Situation | Action |
|---|---|
| Question about org structure/code/docs | `graphify query "<question>"` — answer from the graph, cite `source_location` |
| Session close | `graphify . --update` then `npm run graph:gaps` (bookend in `/close`) |
| Manual graph refresh (non-Claude operator) | `npm run graph:update` (guarded; hints if CLI absent) |
| First-time setup | `/graphify .` (full build; semantic extraction runs via subagents) |
| Dashboard stats | `npm run graph:status` |
| Gap triage | Work `data/knowledge-gaps.yaml` `open` entries (below) |

## Gap triage workflow

1. `npm run graph:gaps` refreshes `data/knowledge-gaps.yaml` (statuses preserved).
2. For each `open` gap, decide:
   - **curated** — knowledge-curator wrote/linked a `knowledge/` page covering it; set `status: curated`.
   - **dismissed** — extraction artifact or intentionally unlinked (e.g. scaffolding); set `status: dismissed`. Dismissals persist across re-runs.
   - Leave **open** if it needs work later.
3. Weak communities and large orphan groups first — they indicate missing
   structure, not missing pages.

## Degradation rules

- CLI absent → print `graph: CLI not installed — see docs/integrations/graphify.md`, continue.
- `graph.json` absent → skip graph steps silently (dashboard section self-hides).
- Corrupt graph → `graph: invalid graph.json — re-run /graphify .`, continue.
- Never block a session, commit, or close on graph tooling.

## Boundaries

- Read-only over `graph.json` — org-os never writes into the graph.
- No auto-install of the CLI (operator decision).
- Graph→knowledge-page generation and lint cross-checks are queued follow-ups
  (see `docs/agent-plans/QUEUE.md`), not part of this skill yet.
