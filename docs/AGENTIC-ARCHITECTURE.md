# AGENTIC-ARCHITECTURE.md — Agent Operating Model

Version: 2.0.0

## Overview

org-os is an agent-native operating system. Every workspace is designed to be operated by AI agents working alongside human operators. This document specifies how agents interact with the workspace, how they bootstrap into a new organization, and how they autonomously improve the workspace over time.

## Agent File Set

Every org-os instance contains these files that agents read on startup. Together they form the agent's complete understanding of the organization.

### Startup Sequence (9 Steps)

```
1. MASTERPLAN.md    → Strategic vision, activations, research directions
2. SOUL.md          → Mission, values, voice, boundaries
3. IDENTITY.md      → Org identity, governance, chain addresses
4. USER.md          → Operator profile, preferences, autonomy level
5. MEMORY.md        → Key decisions index (long-term)
6. memory/*.md      → Recent daily logs (last 3-7 days)
7. HEARTBEAT.md     → Active tasks, urgency, health checks
8. TOOLS.md         → Endpoints, APIs, Notion IDs, credential refs
9. federation.yaml  → Network peers, agent config, knowledge commons
```

After reading all files, the agent validates schemas (`npm run validate:schemas`) and is ready to operate.

### File Roles

| File | Written by | Read by | Update frequency |
|------|-----------|---------|------------------|
| MASTERPLAN.md | Human | Agent | Weekly/monthly |
| SOUL.md | Human | Agent | Rarely |
| IDENTITY.md | Human | Agent | Rarely |
| USER.md | Human | Agent | Rarely |
| MEMORY.md | Both | Agent | Per session |
| memory/*.md | Agent | Agent | Daily |
| HEARTBEAT.md | Both | Agent | Per session |
| TOOLS.md | Human | Agent | When config changes |
| CLAUDE.md | Human | Agent | Rarely |
| federation.yaml | Human | Agent | When network changes |

**Key principle:** Human-controlled files (SOUL, IDENTITY, MASTERPLAN) set direction. Agent-controlled files (memory/, HEARTBEAT updates) track execution. MEMORY.md is shared — agents log, humans curate.

## MASTERPLAN.md — The Agent's Compass

MASTERPLAN.md is the most important human-authored file. Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch), it serves as the `program.md` that guides autonomous agent behavior.

### Structure

```markdown
# MASTERPLAN.md — [Org Name]

## Identity
Who this agent is, what org it serves, its mandate.

## Activations
What the agent should focus on RIGHT NOW.
- [ ] Process Q1 meeting backlog
- [ ] Fill gaps in carbon-markets knowledge domain
- [ ] Prepare Q2 assembly materials

## Research Directions
Longer-term knowledge gaps to fill, processes to improve.
- Investigate conviction voting mechanisms for our context
- Map regional funding landscape for Southern Europe

## Success Metrics
How to evaluate whether improvements worked.
- Schema validation passes: `npm run validate:schemas`
- HEARTBEAT pending count decreasing
- Knowledge coverage increasing per domain

## Boundaries
What NOT to change autonomously.
- Do not modify SOUL.md, IDENTITY.md, federation.yaml
- Do not send external messages without approval
- Do not commit financial transactions
- Draft-and-present for anything public-facing

## Workfronts
Active workstreams with priorities and context.

## Safety Policy
Autonomous vs. requires-approval actions.
```

## Bootstrapping — 3 Phases

### Phase 1: Guided Interview (BOOTSTRAP.md)

The `bootstrap-interviewer` skill runs an interactive setup:

1. "What is your organization's name, type, and mission?"
2. "Who are the core members and their roles?"
3. "What are your active projects?"
4. "What governance model do you use?"
5. "What communication channels do you use?"
6. "Do you have existing data sources (Notion, Google Drive, GitHub repos)?"

The interview auto-generates:
- `SOUL.md` — from mission, values answers
- `IDENTITY.md` — from name, type, governance answers
- `data/members.yaml` — from team answers
- `data/projects.yaml` — from projects answers
- `data/channels.yaml` — from channels answers
- `federation.yaml` — from network/integration answers

This phase works via both **CLI** (Claude Code terminal) and **web form** (for non-tech operators). See `docs/OPERATOR-GUIDE.md`.

### Phase 2: Source Ingestion

After initial setup, point the agent at existing knowledge sources:

- **GitHub repos** → Crawl, index, populate `data/sources.yaml` and `repos.manifest.json`
- **Website/blog** → Extract org info, articles into `knowledge/`
- **Podcast** → Process episodes into `knowledge/podcast/`
- **Notion** → Map databases, configure sync in `TOOLS.md`
- **Documents** → Process into `knowledge/` or `docs/`

The `knowledge-curator` skill handles ingestion. Each source is registered in `data/sources.yaml` with its sync method and status.

### Phase 3: Ongoing Learning

Continuous improvement through daily operations:
- **Meeting processing** → Builds operational memory, extracts action items
- **Heartbeat monitoring** → Learns priorities, tracks task completion
- **Knowledge curation** → Expands knowledge commons from new content
- **Idea scouting** → Surfaces ecosystem gaps from knowledge analysis
- **Feedback loop** → Agent behavior improves based on operator corrections

## Skills Architecture

Skills define what agents can do. They follow a three-tier model:

### Core Skills (from framework)
Provided by org-os and available to all instances:

| Skill | Purpose |
|-------|---------|
| `meeting-processor` | Process transcripts, extract decisions and action items |
| `funding-scout` | Identify funding opportunities, track applications |
| `knowledge-curator` | Aggregate knowledge from sources into knowledge/ |
| `capital-flow` | Orchestrate capital movements, queue transactions |
| `schema-generator` | Generate EIP-4824 schemas from data/*.yaml |
| `heartbeat-monitor` | Proactive health checks, task prioritization |
| `bootstrap-interviewer` | Guided interview for new org setup (v2) |
| `idea-scout` | Scan knowledge for ecosystem gaps, surface ideas (v2) |
| `workspace-improver` | Autonomous improvement loop — autoresearch (v2) |

### Custom Skills (instance-specific)
Created by instances for their unique needs. Examples:
- `cooperative-ops` (refi-bcn-os) — Barcelona cooperative operations
- `governance-facilitator` (refi-dao-os) — Steward council facilitation

### Shared Skills (promoted from instances)
When a custom skill proves valuable, it can be promoted:
1. Instance creates custom skill in `skills/`
2. Skill proves value over multiple sessions
3. Instance proposes to framework (PR or federation declaration)
4. Framework reviews, generalizes, adds to core
5. Other instances inherit via `npm run sync:upstream`

### Skill Format (SKILL.md)

```yaml
---
name: meeting-processor
version: 1.0.0
description: Process meeting transcripts into structured records
triggers:
  - "process meeting"
  - "meeting transcript"
inputs:
  - transcript (text or file path)
  - date (ISO 8601)
  - participants (list)
outputs:
  - data/meetings.yaml entry
  - memory/YYYY-MM-DD.md log
  - action items in HEARTBEAT.md
dependencies:
  - schema-generator
---

# Meeting Processor

## When to Use
[description of when this skill activates]

## Procedure
[step-by-step instructions for the agent]

## Output Format
[expected outputs and where they go]

## Examples
[concrete examples]
```

See `docs/SKILL-SPECIFICATION.md` for the complete spec.

## Autoresearch Pattern — Autonomous Improvement

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch), org-os agents don't just operate within the workspace — they improve it.

### The Loop

```
1. Read MASTERPLAN.md → understand current directions
2. Identify improvement → knowledge gap, stale data, missing skill
3. Make scoped change → process a source, fill a gap, draft a skill
4. Evaluate → schemas pass? HEARTBEAT count down? coverage up?
5. Log results → memory/YYYY-MM-DD.md with before/after metrics
6. Keep or revert → based on evaluation
7. Repeat
```

### Mapping to autoresearch

```
MASTERPLAN.md          = program.md     (human-written directions)
data/*.yaml + skills/  = train.py       (the editable surface)
HEARTBEAT.md metrics   = val_bpb        (evaluation criteria)
memory/YYYY-MM-DD.md   = experiment log (what was tried, results)
```

### Boundaries

Agents may modify:
- `data/*.yaml` — Fill gaps, update stale records
- `knowledge/` — Process new content, improve pages
- `memory/` — Log everything
- `skills/` — Draft new skill definitions
- `ideas/` — Surface new ideas from knowledge analysis
- `.well-known/` — Regenerate schemas

Agents must NOT modify without human approval:
- `SOUL.md` — Organization identity
- `IDENTITY.md` — Governance infrastructure
- `federation.yaml` — Network relationships
- `MASTERPLAN.md` — Strategic direction
- `package.json` — Dependencies and scripts

### Evaluation Metrics

| Metric | How to measure | Target |
|--------|---------------|--------|
| Schema validation | `npm run validate:schemas` | Pass |
| HEARTBEAT pending | Count unchecked items | Decreasing |
| Knowledge coverage | domain coverage in knowledge-manifest.yaml | Increasing |
| Data freshness | last_updated dates in registries | Within 7 days |
| Idea pipeline | ideas.yaml entries in active states | Growing |

## Agent Modes

Agent modes are personas that shape how the agent operates. They're defined in `.claude/agents/` and activated via slash commands or context.

### Standard Modes (provided by framework)

| Mode | Focus | Use when |
|------|-------|----------|
| `default` | General operations | Normal day-to-day work |
| `governance-facilitator` | Governance processes | Elections, proposals, decisions |
| `content-processor` | Content ingestion | Processing blog, podcast, docs |
| `ideation-curator` | Idea pipeline | Managing ideas, scouting gaps |

### Custom Modes (instance-specific)
Instances can add modes for their context:
- `cooperative-ops` — Cooperative management workflows
- `aggregator-indexer` — Content aggregation and indexing
- `network-facilitator` — Cross-org coordination (for hub nodes)

### Mode Definition

```yaml
# .claude/agents/governance-facilitator.md
---
name: governance-facilitator
description: Facilitate governance processes
activation: "When discussing elections, proposals, or governance decisions"
---

# Governance Facilitator Mode

## Focus
Guide governance processes: elections, proposals, council decisions.

## Behavior
- Reference data/governance.yaml for current state
- Follow established governance timeline
- Draft-and-present all public communications
- Track decisions in MEMORY.md

## Tools
- Meeting processor for governance meetings
- Schema generator for governance schema updates
```

## Safety Policy

### Autonomous Actions (no approval needed)
- Read any workspace file
- Update memory/ daily logs
- Update HEARTBEAT.md task status
- Generate and validate schemas
- Process content into knowledge/
- Surface ideas from knowledge analysis
- Draft documents for review

### Requires Human Approval
- Send external messages (Telegram, email, GitHub)
- Execute on-chain transactions
- Publish content publicly
- Modify identity files (SOUL, IDENTITY, federation.yaml)
- Commit financial decisions
- Change network relationships
- Create or delete repositories

### Escalation Protocol
When uncertain about autonomy level:
1. Check MASTERPLAN.md boundaries section
2. If not covered, default to draft-and-present
3. Log the question in memory/ for human review
4. Ask the operator if available

## Integration Points

### Agent Runtimes
org-os workspaces are compatible with multiple agent runtimes:
- **Claude Code** — Primary CLI agent (`.claude/` config)
- **Cursor** — IDE agent (`.cursor/` config)
- **OpenClaw** — Autonomous agent platform
- **OpenCode** — Open-source agent runtime

Each runtime reads the same workspace files. Platform-specific config goes in their respective directories. See `docs/TOOL-SETUP.md`.

### External Tools via MCP
Agents can access external systems via MCP (Model Context Protocol) servers:
- **Notion** — Read/write Notion databases
- **GitHub** — PR management, issue tracking
- **Telegram** — Community messaging (read-only recommended)

---

_Part of org-os v2.0.0 — see [SKILL-SPECIFICATION.md](SKILL-SPECIFICATION.md) for skill authoring guide._
