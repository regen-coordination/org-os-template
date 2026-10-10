# Architecture

org-os is a set of plain files in a git repository, plus scripts that read and write them. There is no server, no database and no daemon in the core. An agent host (Claude Code, OpenCode and others) reads the files, runs `npm run` scripts, and commits. Everything else on this page follows from that choice.

This page describes how the framework repository is put together and why. For a map of what an instance contains, see [Overview](OVERVIEW.md); for how an agent behaves inside it, see [Agentic architecture](AGENTIC-ARCHITECTURE.md).

**Honest scope.** Every instance today is operated by the maintainer. Federation between instances is a manifest plus scripts that read it, not a running network (see [Federation](FEDERATION.md)). The "fork the repository and answer an interview" setup (`npm run setup`) does not work for a newcomer; the clone (`npm run clone:framework`) is the supported route (see [Setup](SETUP.md)).

## The layers

```
 agent host:  Claude Code (.claude/)   OpenCode (.opencode/)   Cursor (.cursor/commands/)
              Hermes (skills/commands/)   Berd (.agents/)
                   |  reads files, runs npm scripts, commits
 ------------------+---------------------------------------------------------------
  1 identity   MASTERPLAN  SOUL  IDENTITY  USER  AGENTS  TOOLS
    + memory   MEMORY  DECISIONS  HEARTBEAT  memory/YYYY-MM-DD.md
  2 registries data/*.yaml --npm run generate:schemas--> .well-known/*.json
                                                         (checked by validate:schemas)
  3 skills     skills/<name>/SKILL.md          commands: .claude/commands/*.md
                                                 --npm run sync:commands--> other hosts
  4 federation federation.yaml (+ data/instances.yaml in the framework repository)
                 read by analyze:instances, sync:upstream, check:divergence
  5 knowledge  knowledge/   data/sources.yaml   graphify-out/   packages/org-os-kms
  6 optional   packages/ (22 directories)   modules/ (5)   site/   scripts/ (the tooling)
 ------------------+---------------------------------------------------------------
                   git (history, branches, the vault safety guard)
```

The layers are directories and conventions, not processes. A layer exists if its files exist and a script or an agent reads them. Each is described below with the check that backs it.

### 1. Identity and memory

Six files at the root say who the agent works for: `MASTERPLAN.md` (strategy and mandate), `SOUL.md` (mission, values, voice), `IDENTITY.md` (name, type, chain identifiers), `USER.md` (the operator), `AGENTS.md` (operating manual) and `TOOLS.md` (local environment notes, never credentials). Four more record what happened: `MEMORY.md` (index), `DECISIONS.md` (what was decided and why), `HEARTBEAT.md` (live tasks) and `memory/YYYY-MM-DD.md` (daily logs, appended, never overwritten).

`AGENTS.md` numbers a ten-step startup sequence: nine files in order (`MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, the latest daily log, `HEARTBEAT.md`, `TOOLS.md`, `federation.yaml`) and then a parity check, `npm run validate:schemas`. `npm run initialize` gathers the same state for the session dashboard (`scripts/initialize.mjs`; the sections shown are set by `dashboard.yaml`). Why files: an agent with no memory of last week can read what happened, and a human can edit any of it with a text editor and see the change in git.

### 2. Registries and generated descriptors

`data/*.yaml` is the source of truth for structured facts. The framework repository has 18 registry files in `data/`: members, projects, finances, governance, meetings, ideas, funding opportunities, relationships, sources, events, channels, assets, ecosystems, knowledge gaps, knowledge manifest, and three that exist only in the framework (`instances`, `skills-matrix`, `packages-matrix`). A `data/federation/` directory holds a cache.

`npm run generate:schemas` (`scripts/generate-all-schemas.mjs`) reads them, with `federation.yaml`, and writes the EIP-4824 descriptors into `.well-known/`: `dao.json`, `members.json`, `projects.json`, `meetings.json`, `finances.json`, `proposals.json`, `activities.json`, `contracts.json`, `ideas.json` and `knowledge.json`. `skills.json` comes from `npm run generate:skills`. The `.json.template` files beside them are what a new instance starts from. `schemas/` holds the JSON-LD and JSON Schema definitions (eight files). A workflow (`.github/workflows/generate-schemas.yml`) regenerates the schemas on pushes that touch `data/` and daily.

Why generated, not hand-written: one place to edit, and a published descriptor that cannot drift from the registry it came from. See [Data model](DATA-MODEL.md) and [EIP-4824 guide](EIP4824-GUIDE.md).

### 3. Skills and host commands

A skill is a directory `skills/<name>/` with a `SKILL.md`: frontmatter plus instructions an agent follows. This repository has 36. They are not code the framework runs; a host loads the file when its description matches the task. See [Skill specification](SKILL-SPECIFICATION.md) and, for the path from one instance's skill to the framework's, [Skill promotion](SKILL-PROMOTION.md).

Slash commands (`/initialize`, `/close`, `/commit`, `/handoff`, `/skills`, `/sync`) are authored once in `.claude/commands/`. `npm run sync:commands` regenerates `.opencode/commands/`, `.cursor/commands/` and `skills/commands/` (the form Hermes reads) from them. See [Commands](COMMANDS.md) and [Host integration](HOST-INTEGRATION.md).

### 4. Federation

`federation.yaml` declares the instance's identity, its `peers`, `upstream` and `downstream`, the agent configuration and the `packages` it enables. What reads it: `npm run validate:structure` and `validate:schemas` (shape and lineage), `npm run initialize`, `npm run analyze:instances` (a drift report into `memory/reports/`, run weekly by `.github/workflows/drift.yml`), `npm run check:divergence` (compares scripts between the framework and instances), `npm run sync:upstream` and `npm run sync:packages`.

Two design choices are visible in the code. First, an instance is a clone with its own history, not a fork that tracks the framework's: `clone-framework.mjs` writes `metadata.genesis_commit`, and `sync-upstream.mjs` is pull-based (fetch, rebase, run migrations, validate, record `last_sync_commit`) and refuses to run on a dirty working tree. Second, nothing pushes to a peer: there is no skill broadcast or knowledge exchange between instances, and the trust levels in `federation.yaml` are recorded, not enforced. Details and the list of what is not built are in [Federation](FEDERATION.md); the health check and file-level sync are in [Instance doctor](INSTANCE-DOCTOR.md).

### 5. Knowledge

`knowledge/` holds the knowledge index (`knowledge/INDEX.md`); `data/sources.yaml` and `repos.manifest.json` register what feeds it; `npm run knowledge` compiles and lints it (`compile-knowledge.mjs`, `lint-knowledge.mjs`). `graphify-out/graph.json`, when present, is a graph built by the external `graphify` CLI and read by `scripts/graph-status.mjs` and `scripts/graph-gaps.mjs` (see [Graphify](integrations/graphify.md)). The map of an instance's federated neighbours is in [Federation map](FEDERATION-MAP.md). `packages/org-os-kms` is the optional knowledge-management system built on `packages/toolkit-framework`. See [KMS](KMS.md), [KMS planes](KMS-PLANES.md) and [KMS publishing](KMS-PUBLISHING.md); its extension packs are in [KMS extension packs](KMS-EXTENSION-PACKS.md) and [Territory pack](TERRITORY-PACK.md).

### 6. Optional code: packages, modules, site

`packages/` holds 22 directories of optional code (the [admin app](ADMIN-APP.md); the KMS; the [federation map](FEDERATION-MAP.md); the instance doctor; `regen-agents`, four specialist agents in TypeScript; integrations for OpenCode, Hermes, Buzz, Paper, Cloudflare and others). `federation.yaml`'s `packages:` map says which an instance enables, and `npm run sync:packages` copies them in. `modules/` has five `module.yaml` manifests (`org-os-berd`, `org-os-buzz`, `org-os-cloudflare-os`, `org-os-instance-doctor`, `org-os-paper`); `scripts/modules.mjs` reads them and writes `data/modules.yaml` and `.well-known/modules.json` in an instance. See [Packages](PACKAGES.md) and [Modules](MODULES.md). The core does not depend on any of them: an instance with none still has layers 1 to 4.

## Design principles the code bears out

1. **Files are the interface.** Agents and humans use the same files. No layer needs a running service, so any host that can read files and run a shell works.
2. **One source of truth, generated outputs.** Registries in `data/*.yaml` are edited; `.well-known/` is generated and validated (`npm run generate:schemas && npm run validate:schemas`).
3. **Draft and present.** `AGENTS.md` section 6 lists what an agent does without asking (read, write memory and heartbeat, generate schemas) and what needs the operator (external messages, on-chain actions, publishing, identity files, financial actions, changes to federation peers).
4. **Git is the safety net, and it is guarded.** `.claude/settings.json` denies stash, clean and hard reset and runs `scripts/guards/deny-destructive-git.mjs` before every Bash call. `npm run vault:snapshot` and `npm run vault:audit` protect untracked work. `scripts/operator-setup.sh` installs `scripts/hooks/pre-commit`, which blocks commits to `main`. See [Vault safety](VAULT-SAFETY.md).
5. **Local autonomy.** An instance is complete without peers. Federation is opt-in and pull-based.
6. **Optional means optional.** Packages and modules are enabled per instance, and the validators do not require them.

## What earlier versions of this page described

Earlier versions drew a "knowledge commons" layer at the centre of the system, with automatic capture and a weekly hub sync, a council coordinator agent, a Monday and Friday sync schedule, a network of nine pilot nodes, and an integration layer for Telegram, Discord, Gardens, Hats, Safe and Celo. Status today:

- **Not built:** the knowledge-commons centre (`federation.yaml` has `knowledge-commons.enabled: false`), the council agent, any scheduled sync between instances (the only schedules are the weekly drift report and the daily schema regeneration above), and integrations for Telegram, Discord, Gardens, Hats, Safe and Celo.
- **Exists as optional code:** `packages/regen-agents` has four specialist agents (agriculture, commons governance, impact measurement, bioregional intelligence) and a coordinating "super-agent", in TypeScript, with adapters to the meeting-processor, knowledge-curator and funding-scout skills. It has no tests, and no script in the framework calls it; `data/packages-matrix.yaml` records two instances as using it, which this repository cannot confirm. See [Packages](PACKAGES.md).
- **Dormant or draft:** `packages/koi-bridge` (a skeleton, its README says "Needs Testing"), `packages/koi-opal-bridge` and `packages/egregore-core` (an OpenCode adapter) are listed as dormant in `data/packages-matrix.yaml` with no instance using them, and have no tests. Nothing in `scripts/` calls them. See [KOI](integrations/koi.md) and [Egregore](integrations/egregore.md).
- **Runtimes:** `federation.yaml` names `openclaw` and `regen-eliza` under `integrations.agent_runtimes`; the repository holds no configuration for either.

## Key files

- Identity and rules: `federation.yaml`, `SOUL.md`, `AGENTS.md`, `MASTERPLAN.md`
- Tooling: `scripts/` (see [Commands](COMMANDS.md))
- Skills: `skills/*/SKILL.md`; `SKILLS.md` is generated by `npm run generate:skills`
