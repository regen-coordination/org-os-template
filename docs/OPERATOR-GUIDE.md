# Operator guide

## Overview

You do not need to be a developer to run an org-os instance, but most of what works today works through an AI agent or a terminal. This guide lists what you can do at each level of technical comfort. Start at Level 0 and move up only if you want to.

Honest scope: every instance today is run by its maintainer. The levels below describe what exists in the repository; they do not mean a newcomer can start at Level 0 or 1 without someone having set the instance up first. Every command mentioned here is listed in [`COMMANDS.md`](COMMANDS.md).

## Access Levels

### Level 0: Chat With an Agent

Talk to an AI agent that has the instance open (Claude Code, OpenCode or Cursor; see [`TOOL-SETUP.md`](TOOL-SETUP.md)). The agent reads the instance's files and answers in plain language.

- Ask questions: "What are our active projects?"
- Submit ideas: "I have an idea for..."
- Get status: "What's the latest from the last meeting?"
- Open and close a session: `/initialize` renders the dashboard; `/close` writes the session to memory, commits and pushes

The agent can also write on your behalf (record an idea, update a project status); you can read what it changed with git. A Telegram or web-chat front end is not built into this repository. The Hermes integration (`packages/hermes-integration`) exposes the same pages inside a Hermes agent session, and putting that session behind a chat app is up to whoever hosts it (not verified here).

### Level 1: Local Views (Browser)

There is no hosted web dashboard, ideation board or content aggregator in this repository: the packages meant to provide the last two (`packages/ideation-board`, `packages/aggregator`) do not exist. What you can open in a browser today runs on your own machine:

- **Static dashboard** — `npm run generate:dashboard` writes `packages/dashboard/dashboard.html`: projects, funding deadlines, `HEARTBEAT.md` tasks, recent memory, skills. Read-only.
- **Admin app** — `npm run admin -- -- --repo ../my-instance`, run from the framework checkout (an instance does not carry the app), serves a local editor for the `data/*.yaml` registries at `http://localhost:4680` (bound to 127.0.0.1, no login). It edits as well as reads: each save is a git commit on the current branch (`admin(<registry>): ...`). See [Admin app](ADMIN-APP.md).
- **Terminal pages** — `npm run page <id>` prints a page as markdown (`dashboard`, `projects`, `tasks`, `instances`, `decisions`, `this-week`, `plans`). The `plans` page reads the framework's queue path and prints "QUEUE.md not found" in a generated instance; see [Host integration](HOST-INTEGRATION.md).

### Level 2: Guided Setup (Basic Computer Literacy)

Bootstrap a new org **with an AI agent doing the terminal work for you**. There is no web form
today — the honest version of this level is: you talk, the agent runs the one recommended path
(`npm run clone:framework`), and you review what it produced. The copy-paste recipe your agent
follows is [`ADOPT-WITH-AN-AGENT.md`](ADOPT-WITH-AN-AGENT.md); it covers:

1. Org name, type, mission (a small config file the agent writes from your answers)
2. Package and skill selection
3. Generating the instance and verifying it (`doctor assess` — no blockers except the expected missing remote)
4. Filling in members, projects, channels and sources afterward via the `bootstrap-interviewer` skill (BOOTSTRAP.md Phase 1)

You receive a ready-to-use org-os instance with pre-configured packages, plus a health report
you can read without being a developer.

### Level 3: Terminal (Developers)

Full agent interaction via terminal. Run skills, edit data, process content.

```bash
# Validate identity and schemas, then the file structure
npm run validate:schemas
npm run validate:structure

# Regenerate all JSON from YAML sources
npm run generate:schemas

# Session dashboard as markdown
npm run initialize:markdown

# Assess an instance, read-only: run from the framework checkout, pointing at the instance
# (an instance does not carry the doctor; inside one the command exits 2)
npm run doctor -- --dir ../my-instance

# Pin tracked files before anything risky (tracked files only; protect untracked notes first)
npm run vault:snapshot -- "before <reason>"
```

### Level 4: Direct Editing (Advanced Developers)

Edit YAML files, write scripts, create agent skills, manage federation connections.

- Edit `data/*.yaml` files directly for bulk data changes
- Create new agent skills in `skills/` (repo root)
- Write custom generation scripts in `packages/*/scripts/`
- Configure federation in `federation.yaml`

## Common Tasks by Level

| Task | L0 Chat | L1 Local views | L2 Setup | L3 CLI | L4 Edit |
|------|---------|----------------|----------|--------|---------|
| Submit an idea | Yes | Admin app (`ideas` registry) | — | Yes | Yes |
| Check project status | Yes | Yes | — | Yes | Yes |
| View org dashboard | Yes | Yes | — | Yes | Yes |
| Bootstrap a new org | — | — | Yes | Yes | Yes |
| Process meeting notes | Yes | — | — | Yes | Yes |
| Run data generation | — | — | — | Yes | Yes |
| Create a new agent skill | — | — | — | — | Yes |
| Edit federation config | — | — | — | — | Yes |
| Write custom scripts | — | — | — | — | Yes |

## Getting Help

- **Ask the agent** (Level 0) — it can explain the instance and its commands
- **Open an issue on GitHub** — report bugs or request features at https://github.com/regen-coordination/org-os-template/issues
