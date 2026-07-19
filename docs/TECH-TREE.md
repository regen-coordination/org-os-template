# TECH-TREE — The Dialectical Development Graph

> `data/tech-tree.yaml` → `npm run resolve:tech-tree` → `/tech-tree` on the site.
> Spec: `docs/superpowers/specs/2026-07-19-tech-tree-design.md` · Skill: `skills/tech-tree/`

## What it is

A graph of everything org-os is and wants to become — capabilities, modules,
skills, integrations, standards, ideas — each with a live status. It is
**read-write and autopoietic**: editing the tree is the planning act, agents
update it as they ship (the `/close` checklist asks), and its frontier
(ideation/planned nodes) seeds the next plans.

## The dialectic, operationally

| Direction | Mechanism |
|---|---|
| Development → tree | ref-backed statuses flow in from `packages-matrix` / `skills-matrix` / `ideas` at resolve time; `/close` prompts for native-node updates |
| Tree → development | `/initialize` surfaces the pulse line; the resolver's `frontier` block clusters gaps by capability; the `tech-tree` skill's `audit` proposes placements and plan candidates |

## Data model (overlay registry)

- **Nodes** — `id`, `type` (`capability | module | skill | integration | standard | idea`), `label`, optional `summary`, `links`, `driving`.
  - **Ref-backed** (`ref: package:<id> | skill:<id> | idea:<id>`): status comes
    from the source registry. Never declare `status` here — the validator rejects it.
  - **Native** (capability/integration/standard): declare `status` directly, or
    leave a capability to **rollup** (most-advanced child wins; dormant/retired
    excluded; explicit status overrides).
- **Edges** — `part-of` (the hierarchy; acyclic, everything reachable from the
  root), `depends-on`, `enables`, `supersedes`.
- **Statuses** — `live · in-dev · planned · ideation · dormant · retired`.
  Mappings from registry dialects: spec §4.

## Commands

| Command | Does |
|---|---|
| `npm run validate:tech-tree` | integrity errors (exit 1) + coverage/reachability warnings |
| `npm run resolve:tech-tree` | writes `site/src/data/tech-tree.resolved.json` (statuses, stats, frontier, moved-diff) |
| `cd site && npm run dev` | live graph at `/tech-tree` — views: hybrid, constellation, techtree, tree |

## Editing

Always through a session (agent-mediated) — say what changed and let the agent
route it: tree for structure/native status, source registry for ref-backed
status. The `tech-tree` skill documents each operation.

## Consumers

`tech-tree.resolved.json` is the seam. Current: the site page. Designed-for:
`report:frontier` (fast follow — renders the `frontier` block into
`memory/reports/` and proposes QUEUE candidates), Obsidian Canvas exporter,
dashboard embeds.
