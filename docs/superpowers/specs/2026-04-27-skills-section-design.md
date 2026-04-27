---
title: Skills Section + /skills + SKILLS.md
date: 2026-04-27
author: org-os
status: design
workstream: operator-interfaces
related:
  - docs/agent-plans/QUEUE.md
  - skills/org-os-init/SKILL.md
  - dashboard.yaml
  - data/skills-matrix.yaml
---

# Skills Section + `/skills` + `SKILLS.md`

## Problem

Operators have no reliable way to confirm that the right skills are loaded and usable in a given workspace. Today:

- `scripts/initialize.mjs` already parses `skills/*/SKILL.md` frontmatter into a `skills[]` array, **but no dashboard section renders it**.
- The Federation footer prints `Skills: N active`, where `N` comes from `federation.yaml agent.skills`, which is **stale** (lists 6, actual is 21). HEARTBEAT.md flags this drift as an open task.
- Skills available to the agent at runtime span three sources — workspace `skills/`, user `~/.claude/skills/`, and plugin caches like `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/` — none of which are surfaced or reconciled.
- `data/skills-matrix.yaml` is a hand-curated cross-instance promotion registry; it is not a discovery mechanism for the local runtime.

The result: operators trust a count that is wrong, and have no fast way to answer "is `superpowers-brainstorming` actually active here?" or "did we lose `meeting-processor` after the last sync?"

## Goal

Give operators **certainty** that the right skills are loaded and usable, in three modes scaled to context:

1. **At-a-glance**: a compact dashboard section showing skill counts grouped by category, with anomaly indicators.
2. **In-terminal**: a `/skills` slash command for inline summaries and per-skill detail.
3. **Durable artifact**: a generated `SKILLS.md` page (and machine-readable `.well-known/skills.json`) that lists every skill across all sources.

A single discovery walker feeds all three. No drift between the dashboard, the page, and the federation manifest.

## Architecture

```
                           ┌──────────────────────────────┐
   workspace skills/       │  scripts/lib/discover-       │
   ~/.claude/skills/  ───▶ │  skills.mjs                  │ ──┬─▶ .well-known/skills.json (machine)
   ~/.claude/plugins/cache │  parses SKILL.md frontmatter │   ├─▶ SKILLS.md               (human page)
                           │  resolves group + anomalies  │   └─▶ initialize.mjs JSON     (dashboard)
                           └──────────────────────────────┘
```

Principles:

- **One walker, three outputs.** Dashboard, `SKILLS.md`, and `skills.json` share discovery logic. No duplication.
- **Read-only over plugin caches.** We never write into `~/.claude/plugins/`.
- **Anomaly detection is structural**, not advisory: malformed frontmatter, duplicate skill names across sources, and `federation.yaml`/disk drift are flagged in every output.
- **Operator override.** `dashboard.yaml` controls display (mode, group order, featured groups, page path). Frontmatter on workspace skills is the systematic source of truth.

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Discovery walker | `scripts/lib/discover-skills.mjs` | Scans the three sources, parses frontmatter, applies grouping rules, returns a normalized array of skills + an anomalies array |
| Generator script | `scripts/generate-skills.mjs` | Calls walker → writes `.well-known/skills.json` + `SKILLS.md`. Wired into `npm run generate:skills`; also chained from `npm run generate:schemas` |
| Dashboard integration | `scripts/initialize.mjs` | Imports walker. Replaces today's `loadStatus().skills` (sourced from stale `federation.yaml`) with real discovery. Exposes `state.skills` as `{ groups, totals, anomalies }` |
| Slash command | `.claude/commands/skills.md` | `/skills` prints the compact dashboard section inline; `/skills full` prints full grouped listing; `/skills <name>` prints frontmatter + first paragraph; `/skills regenerate` runs `npm run generate:skills` |
| Dashboard renderer spec | `skills/org-os-init/SKILL.md` | New `Skills` section spec — group bullets, counts, descriptions, anomaly line, footer pointing at `SKILLS.md` and `/skills` |
| Config schema | `dashboard.yaml` | New `skills:` section with `mode`, `groups`, `featured_groups`, `show_anomalies`, `page` keys |
| Frontmatter additions | `skills/<canonical>/SKILL.md` | Add `category:` and `tier:` to canonical workspace skills (table below) |
| Reconciliation tool | `scripts/reconcile-federation-skills.mjs` (`npm run reconcile:federation-skills`) | Operator-invoked: rewrites `federation.yaml agent.skills` from discovery output. Not auto — operator commits the change |

## Data Model

Each discovered skill normalizes to:

```yaml
id: superpowers-brainstorming
source: plugin              # workspace | user | plugin
source_detail: "superpowers@5.0.7"   # plugin name + version, or absolute path for workspace/user
group: superpowers          # frontmatter category override OR prefix-derived OR "uncategorized"
name: superpowers-brainstorming
description: "..."
tier: core                  # core | extended | experimental (frontmatter; missing → "extended")
version: "5.0.7"            # frontmatter; optional
status: ok                  # ok | malformed | duplicate
path: /abs/path/SKILL.md
```

Grouping rule:

1. If frontmatter has `category:`, use it. (This is the only knob for workspace/user skills.)
2. Else, if `source == plugin`, group inherits the plugin name (e.g. every skill under `superpowers/<version>/skills/` → `group: superpowers`). The plugin source is already known from the discovery path, so no name-prefix matching is required.
3. Else `group: uncategorized`. Workspace/user skills without `category:` show up here, which is a useful prompt to add the field.

Source resolution:

- **workspace** — files matching `<repo>/skills/*/SKILL.md`.
- **user** — files matching `~/.claude/skills/*/SKILL.md`.
- **plugin** — files matching `~/.claude/plugins/cache/<plugin>/<version>/skills/*/SKILL.md`. The plugin name and version come from the path.

Duplicates: if the same skill `id` appears in multiple sources, all instances are emitted with `status: duplicate` and listed as an anomaly. The compact view counts the canonical (workspace > user > plugin) and notes the duplicate.

## Dashboard Section (compact, group-level)

The new section replaces the stale `Skills: N active` line in the Federation footer.

```
─── Skills ───────────────────────────────────────────────────────────────

  ●  org-os         5  core lifecycle (init, heartbeat, schema-gen, ...)
  ●  superpowers   12  engineering process (brainstorming, plans, TDD, ...)
  ●  research       2  feynman first-principles, idea-scout
  ●  operations     4  meetings, funding, capital, bootstrap
  ●  paperclip      4  agent control + plugin authoring (user)

  27 active across 3 sources · ⚠ federation.yaml lists 6, actual 21
  Full list: SKILLS.md  ·  Detail: /skills <name>
```

~8 lines. Each group line:

- Status indicator (`●` ok, `⚠` if any skill in this group is malformed/duplicate)
- Group name (left-aligned)
- Skill count in this group
- One-line description: human-curated for known groups in `dashboard.yaml`; for unknown groups, lists 2-3 skill names truncated.

The "anomalies" line shows count and one-line summary; details live in `SKILLS.md`.

## `dashboard.yaml` Schema Additions

```yaml
sections:
  skills:
    show: true
    mode: compact                              # compact | full
    featured_groups: [org-os, superpowers, research, operations]
    groups: [org-os, superpowers, research, operations, guidelines, paperclip]
    show_anomalies: true
    page: SKILLS.md
    descriptions:                              # optional one-liners per group
      org-os: "core lifecycle (init, heartbeat, schema-gen, ...)"
      superpowers: "engineering process (brainstorming, plans, TDD, ...)"
      research: "feynman first-principles, idea-scout"
      operations: "meetings, funding, capital, bootstrap"
      guidelines: "behavioural guidance for coding agents"
      paperclip: "agent control + plugin authoring"
```

Behaviour:

- `mode: compact` → render only `featured_groups`, group-level summary.
- `mode: full` → render every group from `groups`, listing each skill name + description under its header.
- `featured_groups` unset → show all groups.
- `groups` unset → derive order from discovery (sorted by count, descending).
- `show_anomalies: false` → suppress the anomaly line in the dashboard (still recorded in `SKILLS.md`).

## `SKILLS.md` Page (generated)

Top of file:

```markdown
# Skills — workspace + user + plugins

Generated 2026-04-27 by `npm run generate:skills`. Do not edit by hand.

**Totals:** 27 active across 3 sources — workspace: 21 · user: 4 · plugin: 17.

## Anomalies

- ⚠ `federation.yaml agent.skills` lists 6 entries; 21 workspace skills present.
   Run `npm run reconcile:federation-skills` to update.
- (no malformed SKILL.md files)
- (no duplicate skill IDs)
```

For each group, in `dashboard.yaml.groups` order:

```markdown
## org-os (5)

### org-os-init  ·  workspace  ·  tier: core
> Organizational OS session lifecycle — initialization dashboard, session
> planning, work execution, and session close.

[skills/org-os-init/SKILL.md](skills/org-os-init/SKILL.md)

### heartbeat-monitor  ·  workspace  ·  tier: core
> Proactive organizational health monitoring and task tracking.

[skills/heartbeat-monitor/SKILL.md](skills/heartbeat-monitor/SKILL.md)
```

Each entry: name · source · tier on a header line; first paragraph of frontmatter `description` as a blockquote; relative link to the SKILL.md file (clickable in Obsidian and on GitHub).

## `.well-known/skills.json` (machine-readable)

```json
{
  "@context": "https://orgos.network/skills/v1",
  "generated": "2026-04-27T15:30:00Z",
  "totals": {
    "workspace": 21,
    "user": 4,
    "plugin": 17,
    "groups": 6
  },
  "anomalies": [
    {
      "type": "federation_drift",
      "expected": 6,
      "actual": 21,
      "remediation": "npm run reconcile:federation-skills"
    }
  ],
  "skills": [
    {
      "id": "org-os-init",
      "source": "workspace",
      "source_detail": "skills/org-os-init",
      "group": "org-os",
      "tier": "core",
      "version": "2.2.0",
      "status": "ok",
      "description": "Organizational OS session lifecycle...",
      "path": "skills/org-os-init/SKILL.md"
    }
  ]
}
```

Federation peers can fetch this to compare skill sets across instances — converts the manual `data/skills-matrix.yaml` reconciliation into a machine-checkable artifact going forward.

## Slash Command — `.claude/commands/skills.md`

```
/skills                  → print compact dashboard section inline (same renderer)
/skills full             → print full grouped listing (same data as SKILLS.md, terminal-friendly)
/skills <name>           → print frontmatter + first paragraph + path for that skill
/skills regenerate       → run `npm run generate:skills` and confirm
```

The command file follows the existing `/initialize`, `/close` pattern: a markdown file in `.claude/commands/skills.md` whose body instructs the agent to run discovery (or call the regenerate script) and render the requested view.

## Frontmatter Additions to Canonical Workspace Skills

Add `tier:` and `category:` to the skills that anchor the compact view. One-line edits.

| skill | category | tier |
|---|---|---|
| `org-os-init` | org-os | core (already set) |
| `initialize` | org-os | core |
| `heartbeat-monitor` | org-os | core |
| `schema-generator` | org-os | core |
| `bootstrap-interviewer` | org-os | core |
| `expert-feynman` | research | core |
| `idea-scout` | research | core |
| `knowledge-curator` | research | extended |
| `meeting-processor` | operations | core |
| `funding-scout` | operations | core |
| `capital-flow` | operations | core |
| `karpathy-guidelines` | guidelines | core |
| `workspace-improver` | operations | extended |

Plugin `superpowers-*` skills are grouped via prefix rule — no edits to plugin files.

## Drift / Anomaly Handling

Anomalies are emitted by the discovery walker into a structured array. They appear:

- **Dashboard** — single `⚠` line summarizing count and worst type.
- **`SKILLS.md`** — dedicated `## Anomalies` section, listed.
- **`.well-known/skills.json`** — `anomalies` array, machine-checkable.

The existing HEARTBEAT.md task "Reconcile `federation.yaml` `agent.skills` with actual `skills/` directory" gets a one-shot remediation: `npm run reconcile:federation-skills`, which rewrites the `agent.skills` block from the discovery output. The script writes a diff to stdout and waits for operator confirmation before saving — never auto-commits.

CI extension: `npm run validate:structure` is extended to fail when `anomalies.length > 0`. This catches drift at PR time.

## Testing

- **Unit (discovery walker):** fixture trees for workspace, user, plugin, malformed frontmatter, duplicate IDs, missing-prefix-and-no-category. Each fixture asserts the normalized output.
- **Snapshot (`SKILLS.md` and `skills.json`):** golden output for a known fixture tree; regenerate with `npm run generate:skills -- --fixture` and diff against `tests/fixtures/skills-golden/`.
- **Integration:** run `node scripts/initialize.mjs` against the real workspace; assert `state.skills.totals.workspace` ≥ count of `skills/*/SKILL.md` entries.
- **CI gate:** `npm run validate:structure` fails on any anomaly.
- **Smoke:** the rendered dashboard for the hub workspace produces the example output in this spec.

## Migration

1. Land discovery walker + generator + tests.
2. Run `npm run generate:skills`; commit `SKILLS.md` and `.well-known/skills.json`.
3. Land dashboard integration; verify `/initialize` renders the new section.
4. Add `tier:` and `category:` to canonical workspace skills (one PR, mechanical).
5. Land `dashboard.yaml` schema addition with conservative defaults (`mode: compact`).
6. Land `/skills` slash command.
7. Run `npm run reconcile:federation-skills` once; commit `federation.yaml`.
8. Land CI gate (`validate:structure` rejects anomalies).
9. Document in `docs/AGENTIC-ARCHITECTURE.md` ("How skills are discovered").
10. Roll out to instances via the standard sync flow; each instance gets a fresh `SKILLS.md` on next `/initialize`.

## Out of Scope

- **Slash commands listing.** A separate follow-up brainstorm (`/commands` consolidation) is queued. This spec deliberately does not cover commands.
- **Skill versioning / deprecation policy.** The frontmatter `version:` field is read; a lifecycle policy belongs in a separate doc.
- **Cross-instance promotion automation.** `data/skills-matrix.yaml` stays manual for now. This spec makes the per-instance source-of-truth machine-readable, which is a pre-requisite for future automation.
- **Runtime skill enable/disable controls.** This spec describes discovery and display, not loading. Loading is governed by the agent runtime (Claude Code, Hermes, etc.).

## Open Questions Resolved

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Workspace + user + plugin (Q1, C) | Matches "actually usable in this session" |
| Density | Compact, group-level (Q2, A → refined) | Fits the dashboard; full detail in `SKILLS.md` and `/skills` |
| Selection | Frontmatter `tier`/`category` + dashboard.yaml override (Q3, C) | Systematic + per-instance flexibility |
| Grouping | Prefix-based with frontmatter override on workspace (Q4, C) | Plugin skills don't need editing; workspace skills get clean semantics |
| Page + command | Both: `SKILLS.md` + `/skills` (Q5, C) | Durable artifact + instant terminal access |
| Page location | Repo root + `.well-known/skills.json` | Consistent with framework's structured-data convention |
