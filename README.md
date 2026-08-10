# org-os — shared operating system for a federation of regenerative organizations

> Framework + standards + orchestration hub.

**Type:** Framework + orchestration hub · **Version:** 0.5.0 · **Status:** active

---

## What org-os is

org-os is the operating system for organizations run by humans and AI agents together — a
git-native workspace where an org's knowledge, data, and operations live as files any agent can
read, act on, and federate.

Fork a repo, answer six questions, and your organization has a brain: identity and values
agents actually follow, structured data registries, session memory, 40
operational skills, machine-readable schemas, and a federation protocol connecting you to a
network of peer orgs. No SaaS, no lock-in — markdown, YAML, and git.

## How it's organized

Three nouns. Everything else is detail.

| | What it is | Where it lives |
|---|---|---|
| **Instances** | A git repo *is* the organization — identity files, data registries, memory, decisions. The framework is itself an instance, self-hosting since 2026-04-24 | `data/` · `memory/` · this repo |
| **Modules** | Versioned units of organizational capability — a skill, a script, a schema, an integration — tracked per instance with install and drift state | [`docs/MODULES.md`](docs/MODULES.md) · `modules/` |
| **Federation** | Instances declare peers, trust levels, and upstream lineage, and publish machine-readable schemas the others can read | `federation.yaml` · `.well-known/` |

Cutting across all three: **the agent runtime**. The same files work in Claude Code, Cursor,
OpenCode, and OpenClaw, because org-os rides the AGENTS.md and Agent Skills conventions instead
of inventing its own.

## What you can do

- **Run a session.** `/initialize` renders a dashboard from live data — projects, tasks,
  calendar, funding deadlines, federation status. `/close` writes memory and commits.
- **Keep organizational memory.** Daily logs, an indexed long-term memory, and an append-only
  decision record. Greppable, versioned, agent-readable.
- **Publish machine-readable org data.** EIP-4824/DAOstar `.well-known/` descriptors generated
  from your registries — extended with meetings, projects, finances, and skills.
- **Federate.** Publish schemas, subscribe to peers, share skills, keep sovereignty. Drift
  analysis and pull-based migrations mean the framework never breaks downstream.
- **Work from a browser or a chat.** The Cloudflare OS module puts the dashboard and an
  org-literate agent in a workspace, so members who will never touch git can still read the org
  and submit to it.

## Run it yourself

### You're an **operator** spinning up a new org

```bash
# Recommended: the cloning engine
node scripts/clone-framework.mjs --target ../my-new-org --config config.yaml

# Or: interactive guided interview
npm run setup
```

See `BOOTSTRAP.md` for the full first-run sequence, and `docs/SETUP-PATHS.md` for choosing
between them.

### You're a **contributor** to the framework

```bash
git clone <this-repo> && cd <repo>
npm install
npm run install:hooks    # pre-commit + advisory hooks
npm run selftest         # full reliability check
```

### You're an **agent** opening a session

Read `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, then run `/initialize`. `AGENTS.md` has the
deterministic startup sequence.

### You're a **visitor** evaluating org-os

Start with `SOUL.md` (mission and values), `IDENTITY.md` (what we are), then
[`docs/MODULES.md`](docs/MODULES.md) for what actually ships today.

---

## Active downstream instances



- **refi-bcn-os** (LocalNode) — unknown

- **refi-dao-os** (DAO) — unknown

- **dao-os** (Project) — unknown

- **openclaw** (AgentRuntime) — unknown

- **regen-coordination-os** (Hub) — unknown

- **refi-med-os** (LocalNode) — unknown

- **bread-coop-os** (Cooperative) — unknown



See `data/instances.yaml` for the authoritative registry; `npm run analyze:instances` for
current drift state.

## Common operations

| Command | Purpose |
|---|---|
| `npm run initialize` | Open a session (sync + dashboard + plan) |
| `/initialize` (Claude Code / Zed / OpenCode) | Same as above, via slash command |
| `/close` | Wrap up: write memory, commit, push |
| `npm run validate:structure` | Check instance against canonical spec |
| `npm run validate:schemas` | Validate EIP-4824 + identity schemas |
| `npm run analyze:instances` | Cross-instance drift report (framework only) |
| `npm run selftest` | Run full reliability suite |
| `npm run vault:snapshot -- "<reason>"` | Capture working tree to refs/snapshots/ before any risky git op |
| `npm run vault:audit` | Verify no content lost since last snapshot |
| `npm run check:divergence` | Compare instance scripts against framework canonical |
| `/skills` | List skills across workspace + user + plugin sources |


- **Skills:** 40 total — see `SKILLS.md` and `data/skills-matrix.yaml`
- **Packages:** 23 total — see `data/packages-matrix.yaml` + `docs/PACKAGE-LIFECYCLE.md`
- **Modules:** see [`docs/MODULES.md`](docs/MODULES.md) and `modules/`

## Documentation


- [Architecture](docs/ARCHITECTURE.md) — How an instance is put together

- [Modules](docs/MODULES.md) — The v0.5 catalog — what ships, what's planned

- [Federation](docs/FEDERATION.md) — Peers, trust levels, lineage, drift

- [Data Model](docs/DATA-MODEL.md) — The registries and their cross-references

- [EIP-4824 Guide](docs/EIP4824-GUIDE.md) — Machine-readable org schemas, generated from your data

- [Agentic Architecture](docs/AGENTIC-ARCHITECTURE.md) — How agents read, act on, and improve the workspace

- [Operator Guide](docs/OPERATOR-GUIDE.md) — Running a downstream instance day to day

- [Commands](docs/COMMANDS.md) — Session lifecycle and the slash-command set

- [File Structure](docs/FILE-STRUCTURE.md) — Canonical paths, and what validate:structure enforces

- [Skill Promotion](docs/SKILL-PROMOTION.md) — How instance-proven patterns become canonical

- [rad-org-os](docs/RAD-ORG-OS.md) — The sovereign distribution — org-os on Radicle

- [Vault Safety](docs/VAULT-SAFETY.md) — Snapshots, audits, and the destructive-op bans


## Requirements

- Node ≥22
- npm ≥10.9.2
- git

## License

MIT
