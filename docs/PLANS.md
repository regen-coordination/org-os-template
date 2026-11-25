# Plans

## Overview

Plans are markdown files with YAML frontmatter, indexed by a `QUEUE.md`. The convention is
held up by habit and by the session commands, not by a validator: nothing checks plan
frontmatter or the 1–3 active limit.

Where the plans live depends on what you are in:

- **An instance made with `npm run clone:framework`** gets `docs/plans/` (strategic,
  multi-session plans), an empty `docs/plans/QUEUE.md`, and
  `docs/superpowers/{specs,plans,research}/` (tactical, session-scoped). `docs/temp/` is added
  to `.gitignore` for untracked scratch. The clone engine (stage 6e) also rewrites every mention
  of the framework's plan directory in the instance's commands and docs to `docs/plans/`.
- **The framework repository itself** keeps its own plans in the `agent-plans` directory under
  `docs/`, with a `README.md` and a `QUEUE.md` there. That is the history of how the framework
  was built, not a template; a clone does not copy it.

The rest of this page uses the instance paths.

## Directory Structure

```
docs/plans/
├── QUEUE.md              # Pipeline index
└── [plan-slug].md        # One plan per file, with YAML frontmatter
docs/superpowers/
├── specs/                # Designs
├── plans/                # Tactical, session-scoped plans
└── research/
```

## Plan Lifecycle

```
scoping → queued → active → completed
                          → cancelled
```

| Status | Meaning |
|--------|---------|
| `scoping` | Being defined. Tasks and scope not yet final; open questions allowed. |
| `queued` | Fully scoped, waiting for capacity or a dependency. |
| `active` | Being worked on. Convention: 1–3 at a time. |
| `completed` | All tasks done. Kept for reference. |
| `cancelled` | Abandoned. Add a `reason` field. |

The framework's own queue also uses `frozen` (parked until a named trigger fires) and
`superseded` (folded into a newer plan). Those are conventions of that repository; the
dashboard does not know them.

## Plan File Format

```yaml
---
id: v2-instance-alignment
title: "Align Instance to org-os v2.0.0"
status: queued              # scoping | queued | active | completed | cancelled
priority: 1                 # execution order within the queue (1 = next)
scope: framework            # framework | instance:<id>
depends_on: []              # plan ids that must complete first
created: 2026-04-06
started: null               # set when status becomes active
completed: null             # set when status becomes completed
estimated_sessions: 2-3
tags: [alignment, v2]
workstream: instance-orchestration   # a long-lived workstream from data/projects.yaml
---

## Goal
## Current State
## Tasks
- [ ] Task description
## Verification
- [ ] How to confirm the plan is complete
```

`workstream` links a plan to the strategic umbrella declared in `data/projects.yaml`; the
framework's plan README asks for exactly one per plan.

## QUEUE.md Format

The scaffold written into a new instance has four sections, in this order:

```markdown
# Plan Queue — <org name>

## Active
## Queued
## Backlog
## Completed
```

`node scripts/initialize.mjs` (the dashboard) reads this file for its Plans section. It
matches only those four headings (case-insensitive) and only list items of the form
`1. [title](file.md) — description` or `- [title](file.md) — description` (an em dash, en
dash or hyphen after the link). Anything else is ignored, so a section called `Scoping` or
`Cancelled` is not shown. The dashboard also counts the plan files in `docs/plans/` by their
frontmatter `status` into four stages: `backlog`, `queued`, `active`, `completed`. A plan with
`status: scoping` falls in none of them.

Conventions: numbered items in Active and Queued show execution order; update `QUEUE.md`
whenever a plan changes status.

## How Agents Use Plans

- **`/initialize`** runs `node scripts/initialize.mjs --format=markdown`, which renders the
  plan queue into the dashboard; the agent notes the active plans for the session. If the
  script fails, the command falls back to reading the queue file directly.
- **`/close`** tells the agent to update a plan's checkboxes and frontmatter if its status
  changed, and to update `QUEUE.md` to match.
- **Starting a queued plan and creating plans** (convention, not found in the session commands or
  the framework's plan README, and no script enforces it): a new plan starts at `status: scoping`,
  is refined until `queued` with a priority, and the operator (or the agent with approval) moves
  it to `active`; an agent does not start a queued plan without approval. Note that the
  dashboard counts a `scoping` plan in none of its stages.

## Conventions

- Plan ids are kebab-case and match the filename without `.md`.
- One plan per file; break plans that would span 5+ sessions into phases.
- `scope` is `framework` or `instance:<id>` (per the framework's plan README). Instance-specific
  plans live in the instance's `docs/plans/`. Tracking cross-repo plans in the framework's queue
  is a convention carried over from older docs, not verified against the code.

## Relationship to Other Files

| File | Role |
|------|------|
| `MASTERPLAN.md` | Strategic direction: what the org should focus on long-term |
| `HEARTBEAT.md` | Operational pulse: today's urgent tasks and blockers |
| `docs/plans/QUEUE.md` | The pipeline: scoped work packages in order |
| `docs/plans/*.md` | Individual plans with frontmatter, tasks and verification |
| `memory/*.md` | Session logs: what was done, decided, learned |

`MASTERPLAN.md` says where the org is going; plans say how, and in what order.

## Phase 0 — Skills Curation (before the plan)

An initiative that brings in a new domain (frontend, design system, data pipeline) can run a
skills curation before its implementation plan is written. The `skills-curator` skill
(`skills/skills-curator/SKILL.md`) takes a short brief and writes
`docs/plans/YYYY-MM-DD-skills-curation.md`: ranked candidate skills, the chosen install set, a
deferred list, and a promote / improve-then-promote / drop verdict to fill in when the
initiative reaches its first release. Skip it for routine work in an already equipped project.
The skill's text mentions a retrospective skill that creates the retrospective document; no
such skill exists in `skills/`, so the verdicts are filled in by hand. Promoting a winning
skill back to the framework follows [SKILL-PROMOTION.md](SKILL-PROMOTION.md).

See [FILE-STRUCTURE.md](FILE-STRUCTURE.md) for the canonical directory layout.
