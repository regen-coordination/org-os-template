# Patterns

Seven working conventions, plus two notes, that org-os instances share. Each one below says where it is written down in this repository and what, if anything, enforces it. Most are conventions that agents follow because `AGENTS.md` tells them to; very few are checked by a script. A pattern that has no home in the repository is not listed.

Honest scope: every instance today is run by the maintainer. "Pattern" here means a convention written into the framework's files and used in the maintainer's instances, not a practice tested across independent organisations.

## 1. Agents coordinate by sharing context, not by commanding

Six principles in `AGENTS.md` §4 (and in the instance copy, `templates/AGENTS.instance.md`): alignment without control, emergence over planning, autopoiesis (sense, respond, adapt, learn), cross-agent communication patterns, role clarity with healthy overlap, and conflict as a design signal. The communication patterns are five message shapes: discovery broadcast, capability inquiry, resource sharing, joint sensemaking, tension signalling.

Nothing enforces this. It is guidance read at session start. The mechanisms that make it concrete are `federation.yaml` (declared peers), `skills/` (capabilities other nodes can read) and `MEMORY.md` and `memory/` (shared context).

## 2. A fixed startup sequence

`AGENTS.md` §1 lists ten steps an agent runs, in order, at the start of every session:

1. `MASTERPLAN.md`
2. `SOUL.md`
3. `IDENTITY.md`
4. `USER.md`
5. `MEMORY.md`
6. the latest `memory/YYYY-MM-DD.md`
7. `HEARTBEAT.md`
8. `TOOLS.md`
9. `federation.yaml`
10. a parity check, `npm run validate:schemas`

The order runs from mandate and values, through memory and current tasks, to environment, then validates the data. `npm run initialize` (and the `/initialize` command) reads these files for you and renders a dashboard. On a first session `BOOTSTRAP.md` is read instead. An earlier version of this page listed nine steps starting from a `MASTERPROMPT.md`; the framework has no such file, and `MASTERPLAN.md` took its place.

## 3. Model tiers for delegated work

`AGENTS.md` §3 gives a table of cheap models for file work and extraction, mid-tier models for synthesis and review, and a stronger model for final approval, plus three delegation shapes: a data-processing swarm (several agents on slices, one aggregates), a review pipeline (draft, quality check, final approval) and parallel research. The steps for any delegation are define, spawn, monitor, integrate, validate.

This is guidance only. No script routes tasks to models, and the model names in the table are from an earlier period and will go stale; read the tiers, not the names.

## 4. Workfronts in HEARTBEAT.md

`AGENTS.md` §5 asks an instance to keep its current priorities in `HEARTBEAT.md`, grouped by workfront: a status (in progress, blocked, planning), an owner, deliverables with dates, blockers. The framework's own `HEARTBEAT.md` groups its tasks under headings of its own (Active Tasks, System Health, Reminders, Recently Completed) rather than a literal "Workfront" template, so the template in `AGENTS.md` is a suggestion that instances adapt. The `heartbeat-monitor` skill reads the file.

## 5. Two-tier safety boundary

`AGENTS.md` §6 splits agent actions in two (`MASTERPLAN.md` §6 carries a separate, framework-development version of the same split). Autonomous, no approval: reading any file, writing `memory/`, `MEMORY.md` and `HEARTBEAT.md`, meeting notes and project pages, running `npm run generate:schemas`, answering in the active session, maintaining `federation.yaml` peer references. Needs operator approval: messages to outside parties, on-chain actions, publishing, changes to `IDENTITY.md`, `SOUL.md` or `AGENTS.md`, any financial action, adding or removing federation peers, changes to the safety policy itself. The rule of thumb in the file is "when in doubt, draft and present, don't execute".

An instance may add a second layer (a council or team approval for treasury, partnerships and governance), documented in `IDENTITY.md`. The boundary is a policy for agents, not a permission system; the mechanical guard in this area is the vault safety tooling (`npm run vault:snapshot` for tracked files only, `npm run vault:audit`; see [VAULT-SAFETY.md](VAULT-SAFETY.md)).

## 6. Success metrics in MASTERPLAN.md

`MASTERPLAN.md` §5 is a "Success Metrics" table of measures and targets, so an agent has a stated definition of success. An instance writes its own. An earlier version of this page also described a "next actions" block with session, week and month horizons; that block is not part of `MASTERPLAN.md` or the instance template, and has been dropped.

## 7. Memory as an append-only daily log

Sessions append to `memory/YYYY-MM-DD.md` and never overwrite an existing file; `MEMORY.md` stays a curated index of decisions (`AGENTS.md` §2). Git history is the audit trail. The `/close` command (`skills/commands/close/SKILL.md`) writes the day's memory, updates `HEARTBEAT.md`, and commits the session with a `session: …` message. An earlier version of this page claimed a script commits every 30 minutes; no such script or scheduled workflow exists in the repository, even though `AGENTS.md` §2 ("Auto-Sync Behavior") still describes a 30-minute `.memory-sync.sh` cron and a session-end trap. Commits happen at `/close` or when the operator commits.

## Federation through shared files

Instances stay aligned by declaring each other in `federation.yaml`, not through a shared service. See [FEDERATION.md](FEDERATION.md) for the manifest and [SKILL-PROMOTION.md](SKILL-PROMOTION.md) for how a skill that works in one instance is promoted into the framework. In the framework's own `federation.yaml`, `knowledge-commons` is `enabled: false`, and no workflow pushes skills to nodes automatically: promotion is a deliberate act by the maintainer.

## Starting a new instance

The supported route is `npm run clone:framework`; see [SETUP.md](SETUP.md) and [ADOPT-WITH-AN-AGENT.md](ADOPT-WITH-AN-AGENT.md). Forking the repository and running `npm run setup` to answer an interview in place is not a working path for a newcomer: a clean-room test on 2026-08-21 found it broken in seven blocker-level ways. After cloning, fill in `SOUL.md` and `IDENTITY.md` first, start with one workfront, and record what you learn in `memory/`.
