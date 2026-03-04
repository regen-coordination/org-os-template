# Organizational OS Workspace — Agent Guide

_Operating instructions for AI agents (OpenClaw, Cursor, or custom runtimes) working in this organizational workspace._

---

## Session Startup Sequence

At the start of every session, read these files in order:

1. **`SOUL.md`** — organizational values, mission, voice (grounds your operating context)
2. **`IDENTITY.md`** — org name, type, chain addresses, network membership
3. **`USER.md`** — primary operator profile and preferences
4. **`MEMORY.md`** — long-term memory index: key decisions, active context
5. **`memory/YYYY-MM-DD.md`** — most recent daily memory log (today's if exists, else latest)
6. **`HEARTBEAT.md`** — active tasks and monitoring items (check urgency)
7. **`TOOLS.md`** — environment-specific configuration (endpoints, addresses)
8. **`skills/`** — discover and load available skills

If this is the first session ever: run `BOOTSTRAP.md` instead.

---

## Memory System

### Reading Memory
- Long-term: `MEMORY.md` (curated index of key decisions and context)
- Recent: `memory/YYYY-MM-DD.md` (last 3-7 days for full context)
- Structured data: `data/*.yaml` (ground truth for members, projects, finances)

### Writing Memory
- Write daily session notes to `memory/YYYY-MM-DD.md` (append, never overwrite)
- Update `HEARTBEAT.md` when tasks are completed or created
- Update `MEMORY.md` when key decisions are made
- Write operational content to `packages/operations/` directories

---

## Safety Policy

### Autonomous Actions (no approval needed)
- Read any workspace file
- Write to `memory/`, `MEMORY.md`, `HEARTBEAT.md`
- Write meeting notes to `packages/operations/meetings/`
- Update project pages in `packages/operations/projects/`
- Generate EIP-4824 schemas (run schema-generator skill)
- Respond in active session channels

### Requires Operator Approval
- Sending messages to external parties not in the active session
- Executing or proposing on-chain transactions
- Publishing to external platforms (newsletters, social media, governance portals)
- Modifying `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `SOUL.md`
- Any financial action (treasury moves, grant applications, payouts)
- Adding/removing federation peers

When in doubt: draft and present, don't execute.

---

## Communication Style

Apply the voice from `SOUL.md`:
- Plain and direct — no jargon without definition
- No performative helpfulness ("Great question! I'd be happy to!")
- Concise when the task is simple; thorough when the task requires it
- Match the language of the operator (see `USER.md`)

In group channels:
- Be conservative about unsolicited messages
- Never send half-baked replies to messaging surfaces
- Confirm scope before acting on behalf of the organization

---

## Skills

Skills are in `skills/` directory. Each skill has a `SKILL.md` with instructions.

Available skills (check `skills/` for current list):
- `meeting-processor` — Process transcripts into structured meeting notes
- `funding-scout` — Identify and track funding opportunities
- `knowledge-curator` — Aggregate and organize channel knowledge
- `capital-flow` — Treasury monitoring and transaction queuing
- `schema-generator` — Regenerate EIP-4824 schemas from data
- `heartbeat-monitor` — Proactive task and health monitoring

Skills can be added to `skills/` at any time. Check `federation.yaml` for skills shared by hub.

---

## Operational Packages

Human-structured content lives in:
- `packages/operations/meetings/` — Meeting notes and templates
- `packages/operations/projects/` — Project documentation (IDEA framework)
- `packages/operations/finances/` — Financial records
- `packages/coordination/` — Coordination tools and templates

EIP-4824 schemas in `.well-known/` are generated from `data/*.yaml` and package content.

---

## Federation

This workspace is part of a federation network (see `federation.yaml`). Key implications:
- Peer nodes share skills — check hub for updates
- Meeting summaries may be published to knowledge commons (per `federation.yaml` config)
- Hub syncs are automated via GitHub Actions

---

## Integration Points

**Upstream**: [organizational-os-framework](https://github.com/luizfernandosg/organizational-os-framework) — standards and schemas

**Integrations** (see `federation.yaml` integrations block):
- **Agent runtimes**: openclaw-source (primary), regen_eliza-refi_dao (alternative)
- **Knowledge infra**: koi-net, koi-net-integration — real-time federation sync
- **Publishing**: quartz-refi-template — documentation sites
- **Grants**: grants-os — grants platform

**Related repos**: [dao-os](https://github.com/luizfernandosg/dao-os) (DAO extension), [regen-coordination-hub](https://github.com/regen-coordination/regen-coordination-hub) (federation hub), [ECOSYSTEM-MAP.md](https://github.com/luizfernandosg/Zettelkasten/blob/main/03%20Libraries/ECOSYSTEM-MAP.md) (full cross-repo map)

---

## For First-Time Setup

1. Run `npm run setup` — interactive configuration wizard
2. Fill in `SOUL.md`, `IDENTITY.md`, `USER.md` with your organization's info
3. Configure `federation.yaml` with network and agent settings
4. Run `BOOTSTRAP.md` ritual for agent initialization

---

## Quick Commands

```bash
npm run setup              # Interactive setup wizard
npm run generate:schemas   # Regenerate EIP-4824 schemas
npm run validate:schemas   # Validate schema compliance
```

---

_This file is the agent's operating manual. Update it as the workspace evolves._
