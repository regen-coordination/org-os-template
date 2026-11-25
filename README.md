# org-os — shared operating system for a federation of regenerative organizations

> Framework + standards + orchestration hub.

**Type:** Framework + orchestration hub · **Version:** 0.7.5 · **Status:** active

**Site:** <https://regen-coordination.github.io/org-os-template/>

---

## What org-os is

org-os is the operating system for organizations run by humans and AI agents together — a
git-native workspace where an org's knowledge, data, and operations live as files any agent can
read, act on, and federate.

Clone the framework and configure your org, and it has a brain: identity and values agents
actually follow, structured data registries, session memory, 36 operational
skills, machine-readable schemas, and a federation protocol connecting you to a network of peer
orgs (single-operator dogfood; external pilot is the open milestone). The config-driven cloning
engine that does this is shipped and tested — it produced a real instance, bread-coop-os. No
SaaS, no lock-in — markdown, YAML, and git.

To open, create or adopt an instance from a page on your own machine, run `npm run open` (see [docs/OPENING.md](docs/OPENING.md)).

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
  decision record. Greppable, versioned, agent-readable. Memory only the Council may read goes to
  the running Hub instead of git (`npm run memory`).
- **Run the Hub.** `packages/admin` is a web app for an instance: its records, the rules that
  decide changes, proposals, boards, outside systems, and the workspace (pages, collections,
  tasks, comments). A change to the instance's files is a git commit. Run it on your own machine
  (`npm run admin -- --repo <instance>`, or from the launcher, `npm run open`), or host it for
  members from one container image ([`deploy/hub/`](deploy/hub/RAILWAY.md)). A hosted Hub writes
  nothing to its instance until writes are turned on; it reads the instance and follows its remote.
  See [`docs/ADMIN-APP.md`](docs/ADMIN-APP.md).
- **Sign members in.** By an emailed link; with a Bluesky or Certified account (identity only,
  since 0.7.5; on a hosted Hub it is off until the operator sets its key); or with a wallet when the
  org names a Hats tree. A person's Roles decide what they read.
- **Keep what is private out of git.** `data/visibility.yaml` says what is public. Anything
  stricter than members lives in the Hub's private store, outside the repository, with sealed
  backups. Since 0.7.2 its optional `files:` section says which Roles read which `data/**` files
  whole.
- **Publish machine-readable org data.** EIP-4824/DAOstar `.well-known/` descriptors generated
  from your registries — extended with meetings, projects, finances, ideas and federation. Only
  what `data/visibility.yaml` makes public, and only once `identity.daoURI` is set.
- **Federate.** Declare peers, upstream and downstream in `federation.yaml`; keep instances
  current with `npm run doctor -- sync` and see their drift with `npm run analyze:instances`.
  Since 0.7.4 an instance can ask to join a hub's network from the Federation page of a Hub on a
  member's own machine (those routes are off on a hosted Hub), and each side publishes its half of the link as a record in its own atproto account. That has been tested
  against a mocked atproto server, not yet run on live accounts, and the network's record type is
  a placeholder that a live account refuses. Knowledge exchange between peers, skill sharing and
  trust enforcement are not built ([`docs/FEDERATION.md`](docs/FEDERATION.md#not-built)).
- **Keep a knowledge commons.** `packages/org-os-kms` keeps the org's knowledge as typed
  objects, publishes the public ones (as JSON, readable pages and, opt-in, atproto records), and
  draws the federation map. The Hub's knowledge pages (`/c/knowledge`) work on a member's own
  machine; the hosted image does not carry kms. See [`docs/KMS.md`](docs/KMS.md).
- **Work from a browser or a chat.** The Cloudflare OS module puts the dashboard and an
  org-literate agent in a workspace, so members who will never touch git can still read the org
  and submit to it.

## Run it yourself

### You're an **operator** spinning up a new org

```bash
# The one recommended path
node scripts/clone-framework.mjs --target ../my-new-org --config config.yaml

# Then check what you got, from this repo
npm run doctor -- --dir ../my-new-org
```

A fresh instance should report **no blockers except `git-remote-absent`** — expected until you
create a repository for it. Anything else is a bug, and `tests/clone-framework-health.test.mjs`
fails the build if it reappears. That guard exists because until 2026-08-28 this path produced an
instance with 7 blockers seconds after creation, the worst being that it published *the
framework's* identity as its own.

Driving this with an AI agent (Claude Code, Cursor, a ChatGPT connector) is the normal case —
[`docs/ADOPT-WITH-AN-AGENT.md`](docs/ADOPT-WITH-AN-AGENT.md) is the copy-paste recipe, and
`BOOTSTRAP.md` has the config template plus the full first-run sequence.

The in-place alternative (`npm run setup`) converts a fork you have already made. It is an
interactive **TTY-only** wizard — agents and CI shells cannot drive it — asking nine prompts:
org type · name · description · base URL · packages · agent runtime · network · emoji · Notion.
A 2026-08-21 clean-room test found the newcomer path through it broken in 7 Blocker-level ways —
including leaving the fork's own identity and data in place while both validation commands
reported a full pass. Some of those causes are fixed by the cloning-engine work above; the wizard
itself has not been re-tested end to end, so prefer the clone. Evidence:
`memory/reports/clean-room-bootstrap-2026-08-21.md`.

### You're a **contributor** to the framework

```bash
git clone <this-repo> && cd <repo>
npm install
npm run install:hooks    # pre-commit + advisory hooks
npm run selftest         # full reliability check
```

One admin test, the *no-names* guard (`packages/admin/app/src/test/no-names.test.ts`), keeps real
people's names out of fixtures and screens. The repository is public, so the names it looks for are
never committed: list them in `.org-os/names.local` at the repository root, one per line (`#` starts
a comment, blank lines are skipped; matched as whole words, any case). The file is git-ignored.
Without it the guard is skipped and says so.

### You're an **agent** opening a session

Read `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, then run `/initialize`. `AGENTS.md` has the
deterministic startup sequence.

### You're a **visitor** evaluating org-os

Start with `SOUL.md` (mission and values), `IDENTITY.md` (what we are), then
[`docs/MODULES.md`](docs/MODULES.md) for what actually ships today.

---

## Active downstream instances



- **refi-bcn-os** (LocalNode) — production

- **refi-dao-os** (DAO) — production

- **dao-os** (Project) — beta

- **regen-coordination-os** (Hub) — beta

- **refi-med-os** (LocalNode) — alpha

- **regen-toolkit** (Project) — beta



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


- **Skills:** 36 total — see `SKILLS.md` and `data/skills-matrix.yaml`
- **Packages:** 27 total — see `data/packages-matrix.yaml` + `docs/PACKAGE-LIFECYCLE.md`
- **Modules:** see [`docs/MODULES.md`](docs/MODULES.md) and `modules/`

## Documentation


- [Architecture](docs/ARCHITECTURE.md) — How an instance is put together

- [Modules](docs/MODULES.md) — The module catalog — what ships, what's planned

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
