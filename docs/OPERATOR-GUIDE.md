# OPERATOR-GUIDE.md — Non-Tech Operator Manual

Version: 2.0.0

## Overview

You don't need to be a developer to use org-os. This guide explains what you can do at every level of technical comfort. Start at Level 0 and move up only if you want to.

## Access Levels

### Level 0: Chat Interface (Anyone)

Interact with the org agent via Telegram or web chat. No setup needed.

- Ask questions: "What are our active projects?"
- Submit ideas: "I have an idea for..."
- Get status: "What's the latest from the last meeting?"
- Request actions: "Schedule a governance vote on..."

The agent reads from the org's data files and responds conversationally. It can also write data on your behalf (e.g., recording a new idea or updating a project status).

### Level 1: Web Dashboard (Anyone, Browser Only)

Open these URLs in your browser (no login required for public data):

- **Dashboard** — Org overview: identity, projects, governance, finances, federation
- **Ideation Board** — Submit and vote on ideas, track them through the lifecycle
- **Aggregator** — Browse curated content from all org sources (blogs, podcasts, social)

All data is read-only in the browser. To make changes, use the chat interface (Level 0) or higher levels.

### Level 2: Guided Setup (Basic Computer Literacy)

Bootstrap a new org via web form or chat flow:

1. Org name, type, mission
2. Core members and roles
3. Active projects
4. Communication channels
5. Existing data sources

The system generates all workspace files automatically. You receive a ready-to-use org-os instance with pre-configured packages.

### Level 3: Claude Code CLI (Developers)

Full agent interaction via terminal. Run skills, edit data, process content.

```bash
# Validate all data files
npm run validate:schemas

# Regenerate all JSON from YAML sources
npm run generate:schemas

# Start a local dev server for a web app
cd packages/ideation-board && npm run dev

# Process new knowledge artifacts
cd packages/knowledge-exchange && node scripts/process-knowledge.js
```

### Level 4: Direct Editing (Advanced Developers)

Edit YAML files, write scripts, create agent skills, manage federation connections.

- Edit `data/*.yaml` files directly for bulk data changes
- Create new agent skills in `agents/skills/`
- Write custom generation scripts in `packages/*/scripts/`
- Configure federation in `federation.yaml`

## Common Tasks by Level

| Task | L0 Chat | L1 Browser | L2 Setup | L3 CLI | L4 Edit |
|------|---------|------------|----------|--------|---------|
| Submit an idea | Yes | Yes | — | Yes | Yes |
| Check project status | Yes | Yes | — | Yes | Yes |
| Browse aggregated content | Yes | Yes | — | Yes | Yes |
| View org dashboard | Yes | Yes | — | Yes | Yes |
| Bootstrap a new org | — | — | Yes | Yes | Yes |
| Process meeting notes | Yes | — | — | Yes | Yes |
| Run data generation | — | — | — | Yes | Yes |
| Create a new agent skill | — | — | — | — | Yes |
| Edit federation config | — | — | — | — | Yes |
| Write custom scripts | — | — | — | — | Yes |

## Getting Help

- **Chat with the org agent** (Level 0) — Ask anything about the org or how to use the system
- **Open an issue on GitHub** (Level 1+) — Report bugs or request features
- **Ask in the community Telegram** (Level 0+) — Get help from other operators and contributors
