# CLAUDE.md — Claude Code Instructions for {{ org.name }}

This workspace is **{{ org.name }}**, an org-os instance: the operating system of one organization. It runs on the org-os framework ({{ framework.url }}) and syncs framework updates from there; the framework itself is developed upstream, not here.
{{#if org.short_description }}
> {{ org.short_description }}
{{/if}}

## Quick Start

**Read `MASTERPLAN.md` first.** It holds this organization's mandate, activations and priorities.

Then follow the startup sequence in `AGENTS.md`:

1. `SOUL.md` — values, mission, voice, boundaries
2. `IDENTITY.md` — who this organization is
3. `USER.md` — operator profile
4. `MEMORY.md` — key decisions, active context
5. `memory/YYYY-MM-DD.md` — latest daily log
6. `HEARTBEAT.md` — active tasks (check urgency)
7. `TOOLS.md` — endpoints, addresses, channels
8. `federation.yaml` — network peers and upstream

A new instance starts mostly empty. If `data/*.yaml` and `SOUL.md` are still placeholders, run the bootstrap sequence in `BOOTSTRAP.md` before anything else.

## Key Rules

- **Scope:** this organization's operations. Framework changes belong upstream, not in this repository.
- **Source of truth:** `data/*.yaml` for structured data; `DECISIONS.md` for what was decided and why (`MEMORY.md` indexes it).
- **After data changes:** run `npm run generate:schemas && npm run validate:schemas`, and commit the regenerated `.well-known/*.json` with the source change.
- **Memory:** write daily logs to `memory/YYYY-MM-DD.md` (append, never overwrite).
- **Plans:** strategic plans live in `docs/plans/` (indexed by `docs/plans/QUEUE.md`); tactical ones in `docs/superpowers/plans/`.
- **Safety:** draft-and-present for external actions (messages, publishing, on-chain). Never send without approval.
- **Workspace safety:** never `git stash`, `git clean` or `git reset --hard` here. See `docs/VAULT-SAFETY.md`.

## Session Lifecycle

Use `/initialize` to start a session (renders the dashboard, loads context) and `/close` to end it (writes memory, commits, and pushes once a git remote is configured — a new instance has none). Both are defined in `.claude/commands/`.

**Optional: API access.** Copy `.env.example` to `.env` and fill in only the keys you use. `.env` is gitignored; never commit it.

## Common Tasks

```bash
npm run initialize         # Gather org state (--format=markdown for the dashboard)
npm run generate:schemas   # Regenerate EIP-4824 schemas from data/*.yaml
npm run validate:schemas   # Validate schema compliance
npm run validate:structure # Check this instance against the canonical spec
npm run selftest           # Run every validator + the test suite
npm run sync:upstream      # Pull framework updates into this instance
npm run knowledge          # Compile knowledge base + index + lint
```

## Key Docs

- `GETTING-STARTED.md` — operator onboarding for this instance
- `AGENTS.md` — agent runtime protocol
- `docs/FILE-STRUCTURE.md` — directory specification
- `docs/DATA-MODEL.md` — the registries in `data/`
- `docs/FEDERATION.md` — how this instance federates with peers
- `docs/OPERATOR-GUIDE.md` — non-technical operator manual
