# FILE-STRUCTURE.md — Canonical org-os Directory Specification

Version: 2.0.0

## Overview

Every org-os instance follows this canonical directory structure. The framework defines the standard; instances customize content. Files marked **required** must exist for an instance to pass `npm run validate:structure`.

## Root Files

### Agentic Files (Required)

| File | Purpose |
|------|---------|
| `MASTERPLAN.md` | Strategic vision, directions, activations for agents. The most important human-authored file — it's how operators steer autonomous agent behavior. |
| `AGENTS.md` | Agent operating manual: 9-step startup sequence, autonomy matrix, safety policy, communication style |
| `SOUL.md` | Organization mission, values, voice, boundaries — defines the org's personality |
| `IDENTITY.md` | Org identity: name, type, governance infrastructure, chain addresses, EIP-4824 daoURI |
| `USER.md` | Primary operator profile: name, role, preferences, autonomy level |
| `MEMORY.md` | Curated long-term decisions index — key decisions that persist across sessions |
| `HEARTBEAT.md` | Active tasks, health checks, urgency markers — the org's pulse |
| `TOOLS.md` | Environment config: API endpoints, Notion workspace IDs, credential references |
| `BOOTSTRAP.md` | First-run onboarding ritual — archive after initial setup |

### Configuration Files (Required)

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Claude Code quickstart — points to MASTERPLAN.md, lists key commands |
| `README.md` | Human-facing repo overview with Getting Started for non-tech users |
| `federation.yaml` | Federation manifest v3.0: identity, peers, agent config, knowledge commons |
| `package.json` | npm scripts for all operational commands |

### Optional Root Files

| File | Purpose |
|------|---------|
| `LICENSE` | Repository license (MIT recommended) |
| `repos.manifest.json` | Linked external repositories to clone into `repos/` |
| `SYSTEM-CANVAS.canvas` | Obsidian canvas visualization of org structure |

## Directories

### `data/` — Ground Truth Registries (Required)

YAML files that represent the single source of truth for all structured organizational data.

| File | Purpose | Required |
|------|---------|----------|
| `members.yaml` | People, roles, participation layers | Yes |
| `projects.yaml` | Initiatives with IDEA lifecycle (Idea→Develop→Execute→Archive) | Yes |
| `finances.yaml` | Budgets, expenses, revenues (multi-currency) | Yes |
| `governance.yaml` | Elections, decisions, governance phases | Yes |
| `meetings.yaml` | Meeting records with decisions and action items | Yes |
| `ideas.yaml` | Community ideas/proposals pipeline with hatching lifecycle | Yes |
| `funding-opportunities.yaml` | Grants, rounds, deadlines | Optional |
| `relationships.yaml` | Inter-org partnerships and collaborations | Optional |
| `sources.yaml` | Content sources for aggregation | Optional |
| `knowledge-manifest.yaml` | Knowledge commons domains and collections | Optional |
| `events.yaml` | Community events, deadlines, milestones | Optional |
| `channels.yaml` | Communication channels and their purposes | Optional |
| `assets.yaml` | Organizational assets inventory (domains, accounts, tools) | Optional |

### `.well-known/` — EIP-4824 Schemas (Required)

Machine-readable JSON schemas generated from `data/*.yaml`. Never edit directly — regenerate with `npm run generate:schemas`.

| File | Source |
|------|--------|
| `dao.json` | IDENTITY.md + federation.yaml |
| `members.json` | data/members.yaml |
| `projects.json` | data/projects.yaml |
| `finances.json` | data/finances.yaml |
| `meetings.json` | data/meetings.yaml |
| `proposals.json` | data/governance.yaml |
| `activities.json` | data/meetings.yaml (activity feed) |
| `contracts.json` | IDENTITY.md (on-chain contracts) |
| `ideas.json` | data/ideas.yaml |
| `knowledge.json` | data/knowledge-manifest.yaml |

### `memory/` — Daily Operational Logs (Required)

Daily markdown files capturing operational context. Append-only within a day.

```
memory/
└── YYYY-MM-DD.md    # One file per active day
```

Convention: session summaries, key decisions, metrics, blockers.

### `knowledge/` — Knowledge Commons (Optional)

Structured knowledge pages organized by domain. Processed from external sources (blog, podcast, docs) by the `knowledge-curator` skill.

```
knowledge/
├── [domain]/           # e.g., carbon-markets, local-governance
│   ├── _index.yaml     # Domain metadata, coverage status
│   └── [topic].md      # Individual knowledge pages
└── exchange-log.yaml   # Cross-org knowledge exchange history
```

### `ideas/` — Community Idea Submissions (Optional)

Individual markdown files for community-submitted ideas. Each maps to an entry in `data/ideas.yaml`.

```
ideas/
└── [idea-slug].md      # Detailed idea description
```

### `skills/` — Agent Skills (Required)

Skills define agent capabilities. Core skills from framework; custom skills are instance-specific.

```
skills/
└── [skill-name]/
    └── SKILL.md        # Skill definition with YAML frontmatter
```

**Core skills** (9, provided by framework):

| Skill | Purpose |
|-------|---------|
| `meeting-processor` | Process transcripts, extract decisions and action items |
| `funding-scout` | Identify regional funding opportunities |
| `knowledge-curator` | Aggregate knowledge from sources |
| `capital-flow` | Orchestrate capital movements |
| `schema-generator` | Generate EIP-4824 schemas from data |
| `heartbeat-monitor` | Proactive organizational health checks |
| `bootstrap-interviewer` | Guided interview for new org setup (v2) |
| `idea-scout` | Scan knowledge for ecosystem gaps (v2) |
| `workspace-improver` | Autonomous improvement loop (v2) |

### `packages/` — Operational Packages (Required)

Modular operational packages with their own package.json.

```
packages/
├── operations/         # Meetings, projects, coordination templates
├── governance/         # Election templates, proposal flows
├── webapps/            # Interactive web tools
├── ideation-board/     # Community ideation kanban (v2)
├── aggregator/         # Content aggregation engine (v2)
├── system-canvas/      # Obsidian canvas generator (v2)
├── knowledge-exchange/ # Cross-org knowledge sync (v2)
└── dashboard/          # Organizational health dashboard (v2)
```

Standard package structure:
```
packages/[name]/
├── package.json
├── SKILL.md            # Agent skill for this package
├── README.md
├── src/                # Source code
├── scripts/            # Data generation scripts
└── public/data/        # Generated JSON for frontends
```

### `scripts/` — Operational Scripts (Required)

| Script | Purpose |
|--------|---------|
| `setup-org-os.mjs` | Interactive setup wizard |
| `generate-all-schemas.mjs` | Generate EIP-4824 schemas |
| `validate-identity.mjs` | Validate schema compliance |
| `validate-structure.mjs` | Check instance against canonical spec (v2) |
| `clone-linked-repos.mjs` | Clone repos from manifest |
| `sync-upstream.mjs` | Sync with framework upstream |
| `sync-notion.mjs` | Bidirectional Notion sync (v2) |

### `repos/` — Linked Repositories (Optional)

Cloned external repos declared in `repos.manifest.json`.

### `docs/` — Instance Documentation (Optional)

Instance-specific documentation, guides, reports.

### `.claude/` — Claude Code Configuration (Optional)

```
.claude/
├── agents/             # Agent modes/personas
├── commands/           # Slash commands
└── settings.json       # MCP servers, permissions
```

## Validation

Run `npm run validate:structure` to check compliance. The validator checks:

1. All required root files exist
2. All required directories exist
3. `data/` contains minimum required YAML files
4. `.well-known/` schemas are present and parseable
5. `skills/` contains at least one SKILL.md
6. `federation.yaml` has required sections (identity, federation, agent)
7. `package.json` has required scripts (generate:schemas, validate:schemas)

## Instance Type Variations

| Feature | Standard Org | Hub Node | Resource Library |
|---------|-------------|----------|-----------------|
| `data/governance.yaml` | Required | Required | Optional |
| `data/nodes.yaml` | N/A | Required | N/A |
| `knowledge/` | Optional | Required | Required |
| `packages/aggregator/` | Optional | Required | Required |
| Federation role | peer/downstream | hub | resource |

---

_Part of org-os v2.0.0 — see [DATA-MODEL.md](DATA-MODEL.md) for the complete data model._
