# {{ org.name }}{{ #if org.tagline }} — {{ org.tagline }}{{ /if }}

> {{ org.short_description }}

{{ org.emoji }} **{{ org.type }}** · framework + orchestration hub for the {{ federation.network }} network.

---

## What this is

org-os is a complete operating system for organizations — DAOs, cooperatives,
nonprofits, networks, projects. It structures all organizational knowledge in a
machine-readable, federated way; provides an agent runtime for autonomous
operations; and serves human workflows.

This repo is **both** the framework template (the canonical source every instance
forks from) **and** the orchestration hub (tracks all downstream instances, their
drift, and skill/package promotion candidates).

## Quick navigation

- 🚀 [Get started](GETTING-STARTED.md) — create your first instance in 30 minutes
- 🎯 [What this is](#what-this-is)
- 👥 [Who are you?](#who-are-you)
- 🔧 [Common operations](#common-operations)
- 🌐 [Federation](#federation)
- 📋 [Active downstream instances](#active-downstream-instances)
- 📚 [Skills + packages catalog](#skills-and-packages)

## Who are you?

### You're an **operator** spinning up a new org

You want to create your own instance. Two paths:

```bash
# CLI path (what Luiz uses):
git clone https://github.com/regen-coordination/org-os
cd org-os
node scripts/clone-framework.mjs --target ../my-org --type cooperative --interactive
```

Or click **Use this template** on GitHub if you prefer the browser flow.

Then read [GETTING-STARTED.md](GETTING-STARTED.md) in your new instance.

### You're a **contributor** to the framework

- Read [`SOUL.md`](SOUL.md), [`IDENTITY.md`](IDENTITY.md), [`MASTERPLAN.md`](MASTERPLAN.md)
- Check [`HEARTBEAT.md`](HEARTBEAT.md) for what's active
- Browse [`docs/agent-plans/`](docs/agent-plans/) for the work pipeline
- Plans you can pick up: anything in `scoping` status

### You're an **agent** opening a session

Run `/initialize`. The dashboard renders org state, plans, instances, drift, and
suggests next actions. Detailed protocol in [`AGENTS.md`](AGENTS.md).

### You're a **visitor** evaluating org-os

Read [`SOUL.md`](SOUL.md) for the philosophy and [`docs/`](docs/) for the architecture.
The case studies are the production instances listed below.

## Common operations

| Command | What it does |
|---|---|
| `/initialize` | Open a session: dashboard + recent context |
| `/close` | Wrap up session: write memory, commit, push |
| `npm run sync:upstream` | Pull framework updates (skills, packages, schemas) |
| `npm run sync:packages` | Re-materialize packages from framework |
| `npm run generate:schemas` | Regenerate `.well-known/*.json` from `data/*.yaml` |
| `npm run validate:schemas` | Verify schemas pass |
| `npm run validate:structure` | Verify file structure is canonical |
| `npm run selftest` | Run all reliability checks |
{{ #if isFramework }}
| `node scripts/clone-framework.mjs --target ../<name> --type <type>` | Create a new instance |
| `npm run analyze:instances` | Cross-instance drift report (framework only) |
{{ /if }}

## Federation

- **Network:** {{ federation.network }}{{ #if federation.role }} (role: {{ federation.role }}){{ /if }}
- **Upstream:** {{ federation.upstream }} (framework version pinned: {{ federation.framework_version }})
{{ #if federation.peers }}
- **Peers:**
{{ #each federation.peers }}
  - {{ . }}
{{ /each }}
{{ /if }}
{{ #if federation.downstream }}
- **Downstream instances:**
{{ #each federation.downstream }}
  - {{ . }}
{{ /each }}
{{ /if }}

## Active downstream instances

{{ #each instances }}
- **{{ name }}** ({{ id }}) — {{ type }}, {{ maturity }} · framework v{{ framework_version }} · last sync {{ last_sync }}
{{ /each }}

## Skills and packages

**Canonical skills ({{ skills.canonical_count }}):** {{ skills.canonical_list }}

**Skill promotion candidates ({{ skills.candidate_count }}):** see `docs/SKILL-PROMOTION.md`

**Canonical packages ({{ packages.canonical_count }}):** {{ packages.canonical_list }}

**Package promotion candidates ({{ packages.candidate_count }}):** see `docs/PACKAGE-LIFECYCLE.md`

## Documentation

- [`docs/FILE-STRUCTURE.md`](docs/FILE-STRUCTURE.md) — canonical directory spec
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — 13 registries, schemas
- [`docs/AGENTIC-ARCHITECTURE.md`](docs/AGENTIC-ARCHITECTURE.md) — agent files, bootstrapping, skills
- [`docs/SKILL-SPECIFICATION.md`](docs/SKILL-SPECIFICATION.md) — how to write and share skills
- [`docs/PACKAGE-LIFECYCLE.md`](docs/PACKAGE-LIFECYCLE.md) — package promotion + retirement
- [`docs/RELIABILITY.md`](docs/RELIABILITY.md) — failure modes, trigger layers, recovery
- [`docs/FEDERATION.md`](docs/FEDERATION.md) — federation protocol spec
- [`docs/VERSIONING.md`](docs/VERSIONING.md) — versioning + migrations
- [`docs/SKILL-PROMOTION.md`](docs/SKILL-PROMOTION.md) — sister to PACKAGE-LIFECYCLE for skills

## Requirements

- Node.js 22+
- npm 10+
- Git

## License

{{ license }} — see [LICENSE](LICENSE).

---

_Built by the Regen Coordination community. v{{ framework_version }}._
