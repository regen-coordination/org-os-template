# PLANS.md — Plan Management Convention

Version: 2.0.0

## Overview

Every org-os instance uses a `docs/agent-plans/` directory to manage development and operational plans. Plans follow a pipeline lifecycle, enabling scoping, sequencing, and parallel execution across sessions.

## Directory Structure

```
docs/agent-plans/
├── QUEUE.md              # Pipeline index — single view of all plans by status
└── [plan-slug].md        # Individual plan files with YAML frontmatter
```

## Plan Lifecycle

```
scoping → queued → active → completed
                          → cancelled
```

| Status | Meaning |
|--------|---------|
| `scoping` | Being defined. Tasks/scope not yet finalized. May have open questions. |
| `queued` | Fully scoped, ready to execute. Waiting for capacity or dependencies. |
| `active` | Currently being worked on. Only 1-3 plans should be active at a time. |
| `completed` | All tasks done. Kept for reference. |
| `cancelled` | Abandoned. Add a `reason` field explaining why. |

## Plan File Format

Each plan is a markdown file with YAML frontmatter:

```yaml
---
id: v2-instance-alignment
title: "Align Instance to org-os v2.0.0"
status: queued              # scoping | queued | active | completed | cancelled
priority: 1                 # execution order within queue (1 = next)
scope: refi-dao-os          # which repo (or "framework" / "all")
depends_on: []              # plan IDs that must complete first
created: 2026-04-06
started: null               # set when status → active
completed: null             # set when status → completed
estimated_sessions: 2-3     # rough estimate of agent sessions needed
tags: [alignment, v2]       # for filtering/grouping
---

## Goal

One paragraph explaining what this plan achieves and why it matters.

## Current State

Brief assessment of where things stand before execution.

## Tasks

### Phase/Section Name

- [ ] Task description
- [ ] Task description with sub-items:
  - Detail A
  - Detail B

## Verification

- [ ] How to confirm the plan is complete
```

## QUEUE.md Format

`QUEUE.md` is the pipeline view — the single place to see all plans at a glance:

```markdown
# Plan Queue

> Last updated: 2026-04-06

## Active
1. [v2-instance-alignment](v2-instance-alignment.md) — Align to org-os v2.0.0 standards

## Queued
2. [knowledge-processing](knowledge-processing.md) — Process blog & podcast into knowledge/
3. [dashboard-build](dashboard-build.md) — Build organizational health dashboard

## Scoping
- [notion-integration](notion-integration.md) — Bidirectional Notion ↔ YAML sync
- [quartz-frontend](quartz-frontend.md) — Public knowledge site via Quartz

## Completed
- ~~[v2-framework-standards](v2-framework-standards.md)~~ — Phase 1 framework docs and data model
```

### Rules for QUEUE.md
- Numbered items in Active/Queued indicate execution order
- Queued items are ordered by priority (dependencies respected)
- Only 1-3 plans should be active simultaneously
- Update QUEUE.md whenever a plan changes status
- Completed plans move to the bottom; keep last 10 for reference

## How Agents Use Plans

### On session start (`/initialize`)
1. Agent reads `docs/agent-plans/QUEUE.md` to see what's active
2. Agent reads the active plan(s) to understand current tasks
3. Agent includes plan status in the session dashboard

### During execution
1. Agent checks off tasks as completed
2. Agent updates plan frontmatter if status changes
3. Agent does NOT start queued plans without operator approval

### On session close (`/close`)
1. Agent updates task checkboxes in active plan(s)
2. Agent updates QUEUE.md if any plan changed status
3. Agent notes progress in memory/YYYY-MM-DD.md

### Creating new plans
1. Start with `status: scoping` — rough idea, open questions allowed
2. Refine tasks and scope until ready
3. Move to `status: queued` with a priority number
4. Operator (or agent with approval) moves to `status: active` when ready

## Conventions

- **Plan IDs** are kebab-case slugs matching the filename (without `.md`)
- **One plan per file** — don't combine unrelated work
- **Break large plans** into phases if they'll span 5+ sessions
- **Cross-repo plans** use `scope: all` and are tracked in the framework repo's QUEUE.md
- **Instance-specific plans** live in the instance repo's `docs/agent-plans/`
- **Framework plans** (affecting the template/standard) live in org-os `docs/agent-plans/`

## Relationship to Other Files

| File | Role |
|------|------|
| `MASTERPLAN.md` | Strategic direction — what the org should focus on long-term |
| `HEARTBEAT.md` | Operational pulse — today's urgent tasks and blockers |
| `docs/agent-plans/QUEUE.md` | Development pipeline — scoped work packages with sequencing |
| `docs/agent-plans/*.md` | Individual plans with frontmatter, tasks, and verification |
| `memory/*.md` | Session logs — what was done, decided, learned |

MASTERPLAN.md says "where we're going." Plans say "how we get there, in what order."

---

## Phase 0 — Skills Curation (Pre-Plan)

Any non-trivial initiative that introduces **new domains** (frontend, design system, ML, data pipeline, etc.) runs a **Phase 0 skills curation** before the implementation plan is written.

```
brainstorming  →  design spec
                      ↓
              SKILLS-CURATOR  ← Phase 0 (this skill)
                      ↓
              writing-plans  →  implementation plan
                      ↓
              executing-plans → builds the thing
                      ↓
              retrospective  →  promote/improve/drop verdicts on chosen skills
```

**Skill:** [`skills/skills-curator/`](../skills/skills-curator/SKILL.md) — produces `docs/plans/YYYY-MM-DD-skills-curation.md` with installed / deferred / dropped skill candidates plus a promotion contract for the v1 retrospective.

**When to skip:** routine work in an already-equipped project, or when the skill stack is locked by an existing convention.

This is what makes "promote winning skills back to org-os" measurable rather than aspirational — every install has a verdict at v1.

---

_Part of org-os v2.0.0 — see [FILE-STRUCTURE.md](FILE-STRUCTURE.md) for the canonical directory spec._
