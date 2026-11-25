# Agentic architecture

An org-os workspace is built to be operated by an AI agent working alongside a human operator. The agent has no special interface: it reads the repository's files, runs `npm run` scripts, and writes files back. This page says which files an agent reads, in what order, what it may change on its own, what skills and personas it has, and what is not built.

For the layers of the whole framework see [Architecture](ARCHITECTURE.md); for a map of an instance's files see [Overview](OVERVIEW.md).

**Honest scope.** Every instance today is operated by the maintainer, so the operating model here is one operator's practice, not a pattern tested across independent organisations. The walkup setup (fork the repository, run `npm run setup`, answer an interview in place) does not work for a newcomer; the clone (`npm run clone:framework`) is the supported route (see [Setup](SETUP.md)).

## The startup sequence

`AGENTS.md` is the authority; it numbers ten steps. At the start of every session the agent reads, in order:

```
1.  MASTERPLAN.md          mandate, activations, operating context
2.  SOUL.md                mission, values, voice
3.  IDENTITY.md            org name, type, chain addresses, network
4.  USER.md                operator profile and preferences
5.  MEMORY.md              long-term memory index
6.  memory/YYYY-MM-DD.md   latest daily log (today's if it exists)
7.  HEARTBEAT.md           active tasks and monitoring items
8.  TOOLS.md               endpoints, channels, local configuration
9.  federation.yaml        network, peers, integrations
10. parity check           npm run validate:schemas
```

On a first-ever session the agent runs `BOOTSTRAP.md` instead. `npm run initialize` (or `/initialize` in a host) reads the same state and renders it as a dashboard; `dashboard.yaml` chooses the sections. `/close` ends a session: it writes `memory/YYYY-MM-DD.md`, updates `HEARTBEAT.md` and commits. `/initialize` is backed by the `initialize` skill and `/close` by the `org-os-init` skill, which covers the full session lifecycle (see [Commands](COMMANDS.md)).

### Who writes what

| File | Agent may edit without approval? | Source |
|---|---|---|
| `memory/YYYY-MM-DD.md` | yes, append only | `AGENTS.md` sections 2 and 6 |
| `MEMORY.md`, `HEARTBEAT.md` | yes | `AGENTS.md` section 6 |
| `packages/operations/` meeting notes and project pages | yes | `AGENTS.md` section 6 |
| `IDENTITY.md`, `SOUL.md`, `AGENTS.md` | no, operator approval | `AGENTS.md` section 6 |
| `federation.yaml` peers and network relationships | no, operator approval to add or remove | `AGENTS.md` section 6 |
| `MASTERPLAN.md`, `USER.md`, `TOOLS.md`, `data/*.yaml` | not named in `AGENTS.md`; by convention operator-owned, edited by an agent when the task calls for it | |

Human-owned files set direction (`MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`); agent-owned files record execution (`memory/`, `HEARTBEAT.md`). `MEMORY.md` is shared: agents log, humans curate. When it is unclear whether something is allowed, `AGENTS.md` says to draft and present rather than execute. (`AGENTS.md` also lists "maintain federation.yaml peer references" as autonomous while requiring approval to add or remove peers; read that as: keep existing entries current, ask before changing who the peers are.)

### The safety policy

From `AGENTS.md` section 6.

- Without approval: read any file; write `memory/`, `MEMORY.md` and `HEARTBEAT.md`; write meeting notes and project pages under `packages/operations/`; run `npm run generate:schemas`; respond in the active session.
- Needs operator approval: messages to external parties, on-chain transactions, publishing to external platforms, edits to identity files, any financial action, adding or removing federation peers, changes to governance boundaries or safety policies.

The policy is enforced by instruction only, with one exception: git. `.claude/settings.json` denies `git stash`, `git clean` and `git reset --hard` and runs a guard script (`scripts/guards/deny-destructive-git.mjs`) before every Bash call in Claude Code. See [Vault safety](VAULT-SAFETY.md). Nothing technical stops an agent from editing `SOUL.md`; the files say it must not.

## MASTERPLAN.md

`MASTERPLAN.md` is the file an operator edits to steer agents. It is inspired by the `program.md` of [karpathy/autoresearch](https://github.com/karpathy/autoresearch). The scaffold a new instance receives has three sections: Mandate, Activations (what to focus on now) and Character. The framework's own `MASTERPLAN.md` has more: identity, architecture, activations, research directions, success metrics, boundaries, active instances, development flow and a three-year vision. No script parses either; agents read them as prose.

## Setting up the files

Cloning (`npm run clone:framework`) scaffolds the files; filling them with the organization's reality is agent-led. The `bootstrap-interviewer` skill walks six topics (identity, team, projects, communication, network, data sources) and writes `SOUL.md`, `IDENTITY.md`, `data/members.yaml`, `data/projects.yaml`, `data/channels.yaml` and the identity section of `federation.yaml`; per `BOOTSTRAP.md` it also fills `TOOLS.md` and `data/sources.yaml`. It runs inside whichever agent host you use; there is no web form. `BOOTSTRAP.md` describes the phases: identity capture, source ingestion (repositories listed in `repos.manifest.json`, documents, Notion) and ongoing learning. See [Setup](SETUP.md) and [Operator guide](OPERATOR-GUIDE.md).

## Skills

Skills define what an agent can do. A skill is `skills/<name>/SKILL.md`: frontmatter and instructions. This repository has 36. The framework-level ones that exist as directories here:

| Skill | Purpose |
|---|---|
| `org-os-init` | Session lifecycle: initialize, plan, execute, close |
| `bootstrap-interviewer` | Guided setup interview for a new instance |
| `meeting-processor` | Transcripts to structured meeting records, decisions and action items |
| `funding-scout` | Find and track funding opportunities |
| `knowledge-curator` | Organize knowledge by domain into `knowledge/` |
| `capital-flow` | Treasury monitoring and transaction queueing |
| `schema-generator` | Regenerate EIP-4824 schemas from the registries |
| `heartbeat-monitor` | Task and health monitoring |
| `idea-scout` | Scan knowledge for ecosystem gaps, surface ideas into `data/ideas.yaml` |
| `workspace-improver` | The autoresearch improvement loop (below) |
| `instance-doctor` | Assess an instance and sync it from the framework (see [Instance doctor](INSTANCE-DOCTOR.md)) |
| `knowledge-graph` | Query the graphify graph before searching files |

The rest are vendored or general-purpose (the `superpowers-*` set, `skill-creator`, `mcp-builder`, `notion-cli`, `web-browsing` and others). `scripts/lib/discover-skills.mjs`, behind `npm run generate:skills`, walks `skills/` and writes `SKILLS.md` and `.well-known/skills.json`. A skill an instance wrote reaches the framework through the process in [Skill promotion](SKILL-PROMOTION.md); the format is in [Skill specification](SKILL-SPECIFICATION.md).

## Agent personas

The framework's own personas are two Berd agent files. `.agents/agents/operator.md` (runs instances day to day: sessions, registries, memory, vault-safe git) and `.agents/agents/upstream.md` (develops the framework itself) are Agent Markdown: frontmatter with `name`, `description` and optional `good_for`, `vibes`; the body is the system prompt. Both carry `managed_by: org-os`.

- `npm run sync:agents` (`scripts/sync-agents.mjs`) mirrors them one way to the user-level `~/.agents/agents/`. It only overwrites files that carry the `managed_by: org-os` marker, skips hand-authored ones (`--adopt` takes one over) and never touches agents listed in `.berd-bundled-agents.json`.
- `npm run sync:skills:berd` (`scripts/sync-skills-berd.mjs`) mirrors five skills (`org-os-init`, `meeting-processor`, `heartbeat-monitor`, `knowledge-curator`, `funding-scout`) into `.agents/skills/`; the list is the materialization entries of `modules/org-os-berd/module.yaml`. Same marker rule; `--check` compares without writing and runs inside `npm run selftest`. `.agents/skills/feynman/` is hand-authored, git-ignored and left alone.
- Whether Berd loads those skills in a live session was not observed; the repository's Berd page records only source-level confirmation. See [Berd](integrations/berd.md).

`.opencode/agents/` held four OpenCode agent files written for one operator's personal vault. They were removed in 0.7.4, and `clone-excludes` keeps the folder out of new instances.

There is no framework-defined "mode" system. An earlier page described named modes (`governance-facilitator`, `content-processor`, `ideation-curator`, and instance-specific `cooperative-ops`, `aggregator-indexer`, `network-facilitator`) defined in `.claude/agents/`. That directory does not exist and no script or skill reads such files; the modes were a pattern that was never implemented. To change how an agent behaves in a context today, write it in `AGENTS.md`, `MASTERPLAN.md` or a skill.

## The autoresearch loop

The `workspace-improver` skill (`skills/workspace-improver/SKILL.md`) lets an agent improve the workspace in scoped steps:

```
1. Read MASTERPLAN.md, HEARTBEAT.md and the last three daily logs
2. Pick one improvement: an unchecked activation, a data gap, a knowledge gap,
   a failing schema check, a pending heartbeat task
3. Record baseline metrics
4. Make one change that fits a session and can be reverted
5. Run npm run generate:schemas && npm run validate:schemas, measure again
6. Keep it if metrics held or improved, revert it if they regressed,
   keep and flag for review if unclear
7. Log before and after in memory/YYYY-MM-DD.md
```

The mapping to autoresearch is by analogy: `MASTERPLAN.md` plays the role of `program.md`, `data/*.yaml` and `skills/` are the editable surface, `HEARTBEAT.md` metrics are the evaluation, `memory/` is the experiment log. The evaluation is whatever the agent measures; the only automatic check is schema validation. The loop runs when the operator asks (the skill's triggers include "improve workspace" and "autoresearch"); no scheduler starts it. See [Autoresearch](AUTORESEARCH.md).

## Knowledge graph

`graphify-out/graph.json`, when it exists, is built by the external `graphify` CLI (`npm run graph:update` runs it if installed). Three things read it and none writes to it: `scripts/graph-status.mjs` (`npm run graph:status`), `scripts/graph-gaps.mjs` (`npm run graph:gaps`, which feeds `data/knowledge-gaps.yaml` to `knowledge-curator`), and `graphify query` for agents. `AGENTS.md` tells agents to query the graph before searching files when it is present. See [Graphify](integrations/graphify.md).

## Agent hosts

The same repository works with several hosts because each reads the same files; only the config differs.

| Host | What is in the repository |
|---|---|
| Claude Code | `.claude/settings.json` (git guard), `.claude/commands/` (the canonical slash commands), `CLAUDE.md` |
| OpenCode | `.opencode/commands/`, `.opencode/opencode.json` (loads `AGENTS.md` and every `skills/*/SKILL.md`), `packages/opencode-integration` |
| Cursor | `.cursor/commands/` only |
| Hermes | `skills/commands/` and `packages/hermes-integration` |
| Berd | `.agents/agents/`, `.agents/skills/` (above) |

`npm run sync:commands` generates the OpenCode, Cursor and Hermes command files from `.claude/commands/`. See [Host integration](HOST-INTEGRATION.md) and [Tool setup](TOOL-SETUP.md). External systems (Notion, GitHub) are reached through environment variables, the host's own MCP configuration or CLI skills; the repository ships no MCP server configuration.

## Not built

- A web form for the setup interview.
- Named agent modes in `.claude/agents/`.
- Unattended agent runs inside the framework. `AGENTS.md` describes memory auto-commit by a `.memory-sync.sh` cron; that script is not in this repository.
- Technical enforcement of the safety policy beyond the git guard.
