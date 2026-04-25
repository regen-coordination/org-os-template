# {{ org.name }}{{ #if org.tagline }} — {{ org.tagline }}{{ /if }}

> {{ org.short_description }}

{{ org.emoji }} **{{ org.type }}**{{ #if federation.network }} · part of the {{ federation.network }} network{{ /if }}

---

## What this is

The operational hub for **{{ org.name }}** — humans + AI agents working from a
shared source of truth.

It keeps organizational context, decisions, projects, and operations structured
so both humans and AI agents can:

- Find current priorities and deadlines (`HEARTBEAT.md`)
- Understand mission and values (`SOUL.md`)
- Access the knowledge base and meeting history
- Execute workflows with clear source-of-truth rules
- Keep feedback, actions, and evidence traceable

## Quick navigation

- 🚀 [Get started](GETTING-STARTED.md) — your first 30 minutes
- 🎯 [What this is](#what-this-is)
- 👥 [Who are you?](#who-are-you)
- 📋 [Current priorities](HEARTBEAT.md)
- 🔧 [Common operations](#common-operations)
- 🌐 [Federation](#federation)
- 🗅️ [All systems](#systems-map)

## Who are you?

### You're a **human operator**

**First session?** Read these in order:
1. [`SOUL.md`](SOUL.md) — mission, values, voice
2. [`IDENTITY.md`](IDENTITY.md) — who we are on-chain and off
3. [`USER.md`](USER.md) — your operator profile
4. [`HEARTBEAT.md`](HEARTBEAT.md) — what's urgent right now

Then: [`GETTING-STARTED.md`](GETTING-STARTED.md) walks you through your first session.

**Returning session?**
- Check `memory/{{today}}.md` for last session's context
- Run `/initialize` to render the current dashboard
- Scan `HEARTBEAT.md` for changes

### You're an **agent**

Run `/initialize`. Standard org-os session lifecycle.
Full protocol in [`AGENTS.md`](AGENTS.md).

### You're a **contributor or partner**

- [`SOUL.md`](SOUL.md) — what we stand for
- [`IDENTITY.md`](IDENTITY.md) — how we're constituted
- [`docs/`](docs/) — operational documentation
- Reach out via channels listed in [`TOOLS.md`](TOOLS.md)

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

## Identity

- **Name:** {{ org.name }}
- **Type:** {{ org.type }}
{{ #if onchain.daoURI }}
- **daoURI:** {{ onchain.daoURI }}
- **Primary chain:** {{ onchain.chain }}
{{ /if }}
{{ #if treasury.safe }}
- **Treasury (Safe):** {{ treasury.safe }}
{{ /if }}
{{ #if governance.snapshot }}
- **Snapshot:** {{ governance.snapshot }}
{{ /if }}
{{ #if contact.website }}
- **Website:** {{ contact.website }}
{{ /if }}
{{ #if contact.telegram }}
- **Telegram:** {{ contact.telegram }}
{{ /if }}

Full identity details: [`IDENTITY.md`](IDENTITY.md)

## Systems map

- **Source of truth:** `data/*.yaml` for structured data; `MEMORY.md` for decisions
- **After data changes:** Run `npm run generate:schemas` to keep `.well-known/` in sync
- **Memory:** Append to `memory/YYYY-MM-DD.md` (never overwrite)
- **Safety:** Draft-and-present for any external action (comms, publishing, financial)

## How to sync with framework

This instance pins `framework_version: {{ federation.framework_version }}`.
To pull updates from the framework:

```bash
npm run sync:upstream
```

This pulls latest packages, skills, schemas, and framework docs while preserving
your instance-specific files (SOUL, IDENTITY, USER, HEARTBEAT, MEMORY, TOOLS,
data/, federation.yaml).

If a framework version bump introduces breaking changes, run `npm run migrate`
after the sync.

## Documentation

[Auto-generated from docs/ directory listing]

## Requirements

- Node.js 22+
- npm 10+
- Git

## License

{{ license }} — see [LICENSE](LICENSE).

---

_Powered by [org-os](https://github.com/regen-coordination/org-os) v{{ federation.framework_version }}._
