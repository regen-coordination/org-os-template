# Agent Plans Pipeline

Specific implementation plans, pipelined through:

```
scoping → queued → active → completed (or cancelled)
```

`QUEUE.md` is the human-readable index. Each plan is a standalone markdown file with YAML frontmatter.

## Plan Frontmatter

```yaml
---
id: <kebab-case-id>              # matches filename, e.g., federation-protocol
title: "Short Human Title"
status: scoping | queued | active | completed | cancelled
priority: 0-n | null             # 0 = highest
scope: framework | instance:<id>
depends_on: [<plan-id>, ...]     # other plan IDs
created: YYYY-MM-DD
started: YYYY-MM-DD | null
completed: YYYY-MM-DD | null
estimated_sessions: <number>|"<range>"|null
tags: [<tag>, ...]
workstream: <workstream-id>      # maps to data/projects.yaml
---
```

### `workstream` field

Every plan belongs to exactly one long-lived **workstream** declared in `data/projects.yaml`. This links specific execution (the plan) to the strategic umbrella (the workstream). One workstream can have many plans; a plan has exactly one workstream.

Current workstreams (see `data/projects.yaml` for authoritative list):

- `v2-stabilization`
- `federation-protocol`
- `non-tech-onboarding`
- `instance-orchestration`
- `skill-promotion`
- `opal-rollout`
- `framework-evolution`

## Lifecycle

1. **scoping** — open questions, no fixed shape yet. May not have `estimated_sessions` or `priority`.
2. **queued** — scoped, waiting for an available session. Must have `priority` and `estimated_sessions`.
3. **active** — currently being executed. Only one active plan per agent at a time.
4. **completed** — merged, docs written, `completed` date set. Retains frontmatter for history.
5. **cancelled** — abandoned; set `status: cancelled` and add a one-line reason in the body.

Moving between states: update `status` in frontmatter, update `QUEUE.md`. No git tags, no branch per plan.
