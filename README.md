# org-os — shared operating system for a federation of regenerative organizations

> Framework + standards + orchestration hub.

**Type:** Framework + orchestration hub · **Version:** 0.5.0 (pre-beta) · **Status:** active

---

## What this is

`org-os` is the canonical template + standards + orchestration hub for a federation of org-os instances. Downstream instances fork or sync from this repo. The framework itself is also an org-os instance (self-hosting since 2026-04-24).

## Quick navigation

- **Operators:** `BOOTSTRAP.md` → guided onboarding for a new instance
- **Agents:** `AGENTS.md` → workspace startup protocol + memory model
- **Contributors:** `docs/FILE-STRUCTURE.md`, `docs/DATA-MODEL.md`, `docs/SKILL-PROMOTION.md`, `docs/PACKAGE-LIFECYCLE.md`
- **Operators of downstream instances:** `docs/OPERATOR-GUIDE.md`
- **Reliability + safety:** `docs/RELIABILITY.md`, `docs/VAULT-SAFETY.md`

## Who are you?

### You're an **operator** spinning up a new org

```bash
# Recommended: use the cloning engine (lands P10 of v3.5)
node scripts/clone-framework.mjs --target ../my-new-org --config config.yaml

# Or: interactive guided interview
npm run setup
```

See `BOOTSTRAP.md` for the full first-run sequence.

### You're a **contributor** to the framework

```bash
git clone <this-repo> && cd <repo>
npm install
npm run install:hooks    # pre-commit + advisory hooks
npm run selftest         # full reliability check
```

### You're an **agent** opening a session

Read `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, then run `/initialize`. See `AGENTS.md` for the deterministic startup sequence.

### You're a **visitor** evaluating org-os

Start with `SOUL.md` (mission + values), `IDENTITY.md` (what we are), and the [docs/](docs/) directory.

---

## Active downstream instances



- **refi-bcn-os** (LocalNode) — unknown

- **refi-dao-os** (DAO) — unknown

- **dao-os** (Project) — unknown

- **openclaw** (AgentRuntime) — unknown

- **regen-coordination-os** (Hub) — unknown

- **refi-med-os** (LocalNode) — unknown



See `data/instances.yaml` for the authoritative registry. `npm run analyze:instances` for current drift state.

## Skills and packages

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


- **Skills:** 34 total — see `SKILLS.md` and `data/skills-matrix.yaml`
- **Packages:** 16 total — see `data/packages-matrix.yaml` + `docs/PACKAGE-LIFECYCLE.md`

## Documentation


- [AGENT MODES](docs/AGENT-MODES.md) — 

- [AGENTIC ARCHITECTURE](docs/AGENTIC-ARCHITECTURE.md) — 

- [ARCHITECTURE](docs/ARCHITECTURE.md) — 

- [AUTORESEARCH](docs/AUTORESEARCH.md) — 

- [CHAT INTERFACE](docs/CHAT-INTERFACE.md) — 

- [COMMANDS](docs/COMMANDS.md) — 

- [DATA MODEL](docs/DATA-MODEL.md) — 

- [ECOSYSTEM](docs/ECOSYSTEM.md) — 

- [EIP4824 GUIDE](docs/EIP4824-GUIDE.md) — 

- [FEDERATION](docs/FEDERATION.md) — 

- [FILE STRUCTURE](docs/FILE-STRUCTURE.md) — 

- [HOST INTEGRATION](docs/HOST-INTEGRATION.md) — 


## Requirements

- Node ≥22
- npm ≥10.9.2
- git

## License

MIT
