# CLAUDE.md — Claude Code Instructions for org-os

This workspace is the **org-os framework** — the template and standards for organizational operating systems.

## Quick Start

**Read `MASTERPLAN.md` first.** It contains your full mandate, activations, and development priorities.

Then follow the startup sequence in `AGENTS.md`:

1. `SOUL.md` — values, mission, voice, boundaries
2. `IDENTITY.md` — org identity, governance infra, federation
3. `USER.md` — operator profile
4. `MEMORY.md` — key decisions, active context
5. `memory/YYYY-MM-DD.md` — latest daily log
6. `HEARTBEAT.md` — active tasks (check urgency!)
7. `TOOLS.md` — endpoints, addresses, channels
8. `federation.yaml` — network peers and integrations

## What This Workspace Is

- Framework template for organizational operating systems
- Standards: EIP-4824 schemas, file structure spec, data model
- 9 core skills in `skills/`
- Documentation in `docs/` (FILE-STRUCTURE, DATA-MODEL, AGENTIC-ARCHITECTURE, etc.)
- Federation protocol for multi-org networks

## Key Rules

- **Source of truth:** `data/*.yaml` for structured data, `MEMORY.md` for decisions
- **After data changes:** Run `npm run generate:schemas && npm run validate:schemas`
- **Memory:** Write daily logs to `memory/YYYY-MM-DD.md` (append, never overwrite)
- **Safety:** Draft-and-present for external actions. Never send without approval.
- **Framework thinking:** Consider all organizations, not just one instance.

## Session Lifecycle

Use `/initialize` to start a session (renders dashboard, loads context) and `/close` to end it (writes memory, commits, pushes). These are defined in `.claude/commands/`.

**Optional: Notion API access.** Copy `.env.example` to `.env` and add your `NOTION_API_KEY` for script-based Notion access. Not needed if using Claude Code/Cursor (MCP handles auth automatically).

## Common Tasks

```bash
npm run initialize         # Gather org state (JSON default, --format=markdown for dashboard)
npm run setup              # Interactive setup wizard
npm run generate:schemas   # Regenerate EIP-4824 schemas
npm run validate:schemas   # Validate schema compliance
npm run validate:structure # Check instance against canonical spec
npm run clone:repos        # Clone linked repositories
npm run sync:upstream      # Sync instances with framework
npm run knowledge          # Compile knowledge base + index + lint
npm run compile:knowledge  # Extract sources → compile pages → update indexes
npm run lint:knowledge     # Health check (structure, links, freshness)
```

## Key Docs

- `docs/FILE-STRUCTURE.md` — Canonical directory specification
- `docs/DATA-MODEL.md` — Complete data model (13 registries)
- `docs/AGENTIC-ARCHITECTURE.md` — Agent files, bootstrapping, skills, autoresearch
- `docs/SKILL-SPECIFICATION.md` — How to write and share skills
- `docs/FEDERATION.md` — Federation protocol spec
- `docs/OPERATOR-GUIDE.md` — Non-tech operator manual
