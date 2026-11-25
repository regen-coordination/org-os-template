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
- Open and close a session: `/initialize` renders the dashboard; `/close` writes the session to memory, commits and pushes. Since 0.7 it asks of each memory entry whether it is for members (it goes in `memory/`, in git) or for the Council (it goes to the running Hub; see [Council memory](#council-memory))

The agent can also write on your behalf (record an idea, update a project status); you can read what it changed with git. A Telegram or web-chat front end is not built into this repository. The Hermes integration (`packages/hermes-integration`) exposes the same pages inside a Hermes agent session, and putting that session behind a chat app is up to whoever hosts it (not verified here).

### Level 1: Browser

There is no ideation board or content aggregator in this repository: the packages meant to provide them (`packages/ideation-board`, `packages/aggregator`) do not exist. What you can open in a browser is the static dashboard, the Hub on your own machine, and a hosted Hub if your org runs one (see [The Hub day to day](#the-hub-day-to-day)):

- **Static dashboard** — `npm run generate:dashboard` writes `packages/dashboard/dashboard.html`: projects, funding deadlines, `HEARTBEAT.md` tasks, recent memory, skills. Read-only.
- **The Hub (admin app)** — `npm run admin -- --repo ../my-instance`, run from the framework checkout (an instance does not carry the app), or `npm run open` for the launcher. It serves the instance's registries, boards, outside systems and workspace (pages, collections, tasks, comments) at `http://localhost:4680` (bound to 127.0.0.1). It edits as well as reads. Locally you act as the member whose `handles.git` or `email` holds your `git config user.email`; Sign-in with Ethereum is offered only when `data/systems.yaml` holds a Hats tree. A save is staged in your change; when the rules in `data/governance.yaml` let you decide alone, **Apply** makes one git commit on the current branch, and otherwise **Propose** opens a proposal that members approve, object to or vote on before it is ratified. With no written rules the maintainer decides alone. `governance.yaml`, `visibility.yaml`, `finances.yaml`, `IDENTITY.md` and `federation.yaml` have no field editor; since 0.7 the source editor (`/files/<path>`) edits each one whole, staged into your change like any other edit. See [Admin app](ADMIN-APP.md).
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

# Regenerate .well-known/ from the YAML sources: public records only (data/visibility.yaml),
# and nothing until identity.daoURI is set in federation.yaml
npm run generate:schemas

# Session dashboard as markdown
npm run initialize:markdown

# Assess an instance, read-only: run from the framework checkout, pointing at the instance
# (an instance does not carry the doctor; inside one the command exits 2)
npm run doctor -- --dir ../my-instance

# Check the registries against their schemas, and the git history against the org's rules:
# framework checkout only (they need packages/admin), pointed at the instance
npm run validate:data -- ../my-instance
npm run validate:governance -- ../my-instance

# Pin the working tree before anything risky (tracked and untracked files; not gitignored ones)
npm run vault:snapshot -- "before <reason>"
```

### Level 4: Direct Editing (Advanced Developers)

Edit YAML files, write scripts, create agent skills, manage federation connections.

- Edit `data/*.yaml` files directly for bulk data changes. Once `data/governance.yaml` has rules, a commit to a file they govern by someone they do not let decide alone needs an `Org-Proposal` trailer naming a ratified proposal; `validate:governance` reports one without it, as a warning locally and in the pre-commit hook, as an error in CI or with `--strict`. Nothing stops the commit.
- Edit `data/governance.yaml` (roles and rules) and `data/visibility.yaml` (what is public) by hand, or whole in the Hub's source editor; the governance check refuses a text that would lock the org out
- Create new agent skills in `skills/` (repo root)
- Write custom generation scripts in `packages/*/scripts/`
- Configure federation in `federation.yaml`

## The Hub day to day

**On your own machine.** Start it when you want it (`npm run admin -- --repo ../my-instance`, or `npm run open`) and stop it with Ctrl-C. A save is staged in your change; Apply commits it on the branch you are on, and Propose turns it into a proposal on a local branch. It never pushes on its own: Share pushes the trunk when you ask, and Sync fetches what others shared. The private store (what is stricter than members) is `<instance>/.org-os/private/`, which `.gitignore` must name.

**Hosted, for members.** A hosted Hub (see [Setup: Host a Hub](SETUP.md#host-a-hub)) is read-only for the instance by default: members sign in, read what their Roles allow, comment, and get notifications, but nothing they do there is committed. The Hub takes the instance's new commits from its remote every 15 minutes, fast-forward only; a history that diverged stops that until the Hub restarts, and the Sources page and Home's "Needs you" say so. The commits themselves are made where the org works: an operator's own Hub, or an agent session. Roles change when a steward loads a new Roles document (`npm --prefix packages/admin run -s house:roles -- load`), and take effect at once.

### Council memory

Memory that only some may read (a person's situation, pay, contact details, money owed, anything Steward-only) is never written to `memory/`, `MEMORY.md`, `HEARTBEAT.md` or a plan. It goes to the running Hub, at the hat or Role it is for, and becomes a record of the private collection `council-memory`:

```bash
npm run memory -- add --level role:steward --date 2026-11-25 --title "<title>" --file <a file outside the repository>
npm run memory -- list --date 2026-11-25    # the day's org memory headings, and the Council entries the Hub shows you
```

`--level members` appends to `memory/<date>.md` instead and commits nothing (the session's close commits it). With no Hub running, a Council entry is refused, and nothing is written anywhere else. `/close` asks "members or Council?" of each entry; when unsure, it is Council. Source: `scripts/memory.mjs` and `.claude/commands/close.md`.

### Backups

Git does not hold the private store, so it is backed up on its own, encrypted:

- **On your own machine**, with a key file you keep away from the machine: `npm run house:backup:key -- <key file>` once, then `ORG_OS_BACKUP_KEY_FILE=<key file>`. The running Hub then takes a backup every 24 hours and keeps 14; `npm run house:backup` takes one now, `npm run house:backup -- --verify <file>` checks one, and `npm run house:restore -- <file>` restores one with the Hub stopped. A lost key is a lost backup.
- **Hosted**, the Hub holds only a maintainer's public key (`ORG_OS_BACKUP_PUBLIC_KEY_FILE`) and seals a backup to it every 6 hours. Opening one needs the private key, named for that one run only. Copying the sealed files off the machine is set up per deployment.
- **Before an upgrade that moves the store's schema** (0.7: schema 3; 0.7.5: schema 4), take a backup first: an older org-os refuses the newer store.

See `packages/admin/README.md`, "The private store's backup".

## Common Tasks by Level

| Task | L0 Chat | L1 Local views | L2 Setup | L3 CLI | L4 Edit |
|------|---------|----------------|----------|--------|---------|
| Submit an idea | Yes | Admin app (`ideas` registry) | — | Yes | Yes |
| Check project status | Yes | Yes | — | Yes | Yes |
| View org dashboard | Yes | Yes | — | Yes | Yes |
| Bootstrap a new org | — | — | Yes | Yes | Yes |
| Process meeting notes | Yes | — | — | Yes | Yes |
| Propose, approve or ratify a change under the rules | — | The Hub (on your own machine) | — | — | — |
| Write a page, or comment on a page or a record | — | The Hub | — | — | Yes (pages are files in `pages/`) |
| Run data generation | — | — | — | Yes | Yes |
| Create a new agent skill | — | — | — | — | Yes |
| Edit federation config | — | — | — | — | Yes |
| Write custom scripts | — | — | — | — | Yes |

## Getting Help

- **Ask the agent** (Level 0) — it can explain the instance and its commands
- **Open an issue on GitHub** — report bugs or request features at https://github.com/regen-coordination/org-os-template/issues
