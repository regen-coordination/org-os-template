# Overview

org-os is a way to run an organization as a git repository: its identity, data, decisions and memory are plain files (markdown and YAML) that people and AI agents both read and edit. One repository is one **instance**. Instances can declare each other as peers and share what they publish; git is the transport.

This page is a map. It says what an instance contains, what you run against it, and which page documents each part.

**Framework repository versus a new instance.** This page maps the framework repository, which is itself an instance. A new instance made with `npm run clone:framework` starts from a subset: it gets blank identity, memory and data files, its own `federation.yaml`, and none of `modules/`, `integrations/`, `site/`, `VERSION.md`, `CHANGELOG.md` or the framework's `docs/agent-plans/`. Differences are called out below.

**Honest scope.** Every instance today is operated by the maintainer. The config-driven cloning engine (`npm run clone:framework`) works; the "fork the repo and answer an interview in place" path (`npm run setup`) does not work for a newcomer. See [Setup](SETUP.md) for the path that does.

## What an instance contains

```
MASTERPLAN.md  SOUL.md  IDENTITY.md  USER.md  AGENTS.md  TOOLS.md   identity: who the agent is working for
MEMORY.md  DECISIONS.md  HEARTBEAT.md  memory/                      memory: what happened, what was decided
data/*.yaml                                                          registries: the structured facts
.well-known/*.json  schemas/                                         generated machine-readable descriptors
federation.yaml                                                      who this instance is and who it talks to
skills/<name>/SKILL.md                                               what agents can do
dashboard.yaml                                                       what /initialize shows
docs/  knowledge/  packages/  scripts/  templates/               everything else (modules/ exists only in the framework repo)
```

### Identity files (repository root)

An agent reads these at the start of a session. `AGENTS.md` lists the ten-step startup sequence: `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, the latest `memory/YYYY-MM-DD.md`, `HEARTBEAT.md`, `TOOLS.md`, `federation.yaml`, then a parity check (`npm run validate:schemas`).

| File | Holds |
|---|---|
| `MASTERPLAN.md` | Strategy and mandate. The file an operator edits to steer agents. |
| `SOUL.md` | Mission, values, voice, boundaries. |
| `IDENTITY.md` | Org name, type, governance and on-chain identifiers (EIP-4824 `daoURI`). |
| `USER.md` | The operator: name, preferences, autonomy level. |
| `AGENTS.md` | The agent operating manual: startup sequence, safety rules, autonomy. |
| `TOOLS.md` | Local environment notes: endpoints, channels, database ids. Never credentials. |

`CLAUDE.md` is a short pointer for Claude Code. Documented in [File structure](FILE-STRUCTURE.md) and [Agentic architecture](AGENTIC-ARCHITECTURE.md).

### Memory

- `MEMORY.md` is the index of long-term memory.
- `DECISIONS.md` is the authoritative record of what was decided and why.
- `HEARTBEAT.md` is the live list of active tasks and health checks.
- `memory/YYYY-MM-DD.md` are daily logs, appended to and never overwritten. A new instance starts with an empty `memory/` (a `.gitkeep`); the framework's own logs and its `memory/reports/` stay in the framework repository.

Plans: the framework repository keeps them in `docs/agent-plans/` (queue: `docs/agent-plans/QUEUE.md`). A new instance gets `docs/plans/` (queue: `docs/plans/QUEUE.md`) and `docs/superpowers/{specs,plans,research}/`, empty. Documented in [File structure](FILE-STRUCTURE.md) and [Plans](PLANS.md).

### Data registries: `data/`

YAML files are the source of truth for structured facts: members, projects, finances, governance, meetings, ideas, funding opportunities, relationships, sources, events, channels, assets and more. Each file has a top-level key matching its name and an `id` on every entry. The framework repository's own `data/` has 18 files. A new instance does not get `instances.yaml`, `skills-matrix.yaml` or `packages-matrix.yaml` (framework-only), starts with `members`, `projects`, `ideas`, `relationships`, `ecosystems` and `governance` reset to empty scaffolds, and has the framework's `data/federation/frontier` cache removed. After editing:

```bash
npm run generate:schemas && npm run validate:schemas
```

Documented in [Data model](DATA-MODEL.md).

### Generated descriptors: `.well-known/` and `schemas/`

`npm run generate:schemas` writes JSON from the registries into `.well-known/` (members, projects, finances, meetings, ideas, knowledge, proposals, activities, contracts, skills, and `dao.json` once `daoURI` is set in `IDENTITY.md`). A new instance ships only the `.json.template` files and generates the rest. They follow EIP-4824 and are never edited by hand. `schemas/` holds the JSON-LD and JSON Schema definitions the generators and validators use. Documented in [EIP-4824 guide](EIP4824-GUIDE.md) and [Data model](DATA-MODEL.md).

### Federation: `federation.yaml`

Declares the instance's identity and network, its `peers`, its `upstream` and `downstream` instances, and a trust level per peer (`full`, `read` or `none`). It is opt-in: an instance with no peers is a complete instance. Documented in [Federation](FEDERATION.md).

### Skills: `skills/`

Each skill is a directory with a `SKILL.md` (the cross-vendor Agent Skills format). This repository has 36 of them (a new instance gets the set it selected), plus `skills/commands/` with the session commands (`close`, `commit`, `handoff`, `skills`, `sync`). `SKILLS.md` is generated by `npm run generate:skills`. Documented in [Skill specification](SKILL-SPECIFICATION.md) and [Commands](COMMANDS.md).

### The rest

| Path | What it is | Documented in |
|---|---|---|
| `packages/`, `modules/` | Optional code and the module wrappers that turn it on (`modules/` is framework-only; a new instance gets only the packages it enabled) | [Modules](MODULES.md), [Packages](PACKAGES.md) |
| `scripts/` | The tooling behind every `npm run` command | [Commands](COMMANDS.md) |
| `docs/` | Documentation and plans (a new instance gets the operator and protocol docs, not the framework's history) | this site |
| `knowledge/` | Knowledge index (`knowledge/INDEX.md`; a new instance gets an empty one) | [File structure](FILE-STRUCTURE.md) |
| `dashboard.yaml` | Which sections `/initialize` shows, and in what order | [File structure](FILE-STRUCTURE.md) |
| `templates/` | What the cloning engine renders a new instance from | [Setup](SETUP.md) |

## What you run

```bash
npm run initialize:markdown # the dashboard: git state, projects, tasks, instance health
npm run initialize          # the same state as JSON (what agents read)
npm run generate:schemas    # registries -> .well-known/
npm run validate:schemas    # schema and identity checks
npm run validate:structure  # file and folder structure
npm run doctor              # read-only assessment of an instance
npm run vault:snapshot -- "reason"   # permanent snapshot ref before any risky git operation
```

In an agent host, `/initialize` opens a session and `/close` ends it (memory written, heartbeat updated, commit). Hosts and slash commands are covered in [Commands](COMMANDS.md) and [Host integration](HOST-INTEGRATION.md).

## Where to go next

- Start an instance: [Setup](SETUP.md), or [Adopt with an agent](ADOPT-WITH-AN-AGENT.md).
- Run one day to day: [Operator guide](OPERATOR-GUIDE.md).
- Connect it to other instances: [Federation](FEDERATION.md).
- Guard against losing files: [Vault safety](VAULT-SAFETY.md).
- Understand the design: [Architecture](ARCHITECTURE.md).
