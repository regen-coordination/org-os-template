# Getting started with {{ org.name }}

Welcome. Here's what you'll do in your first 30 minutes.

This guide is intentionally human and conversational. The reference docs
(`MASTERPLAN.md`, `AGENTS.md`, `docs/`) are the precise source of truth — this
is the on-ramp.

## 1. Meet your org (5 min)

Open these and read them once:

- **[`SOUL.md`](SOUL.md)** — your org's mission, values, and voice. This is
  *who* you are. When something feels off, this is where you check.
- **[`IDENTITY.md`](IDENTITY.md)** — *what* you are on paper: legal type,
  governance infrastructure, addresses, contacts.

You don't need to memorize anything. Just notice the shape.

## 2. Open your first session (5 min)

Run:

```
/initialize
```

The agent renders a dashboard. It shows:

- **Header** — your org's name, branch state, recent activity
- **Projects** — what's active, what stage each is in
- **Tasks** — what's urgent, what's upcoming
{{ #if showCalendar }}
- **This week** — meetings + events
{{ /if }}
{{ #if showFunding }}
- **Funding** — deadlines within 30 days
{{ /if }}
- **Recent context** — last few session notes
- **Plans** — what's queued for development
- **Federation** — your network and peers

Don't try to do everything you see. Just orient.

## 3. Find your role (10 min)

{{ #if isCooperative }}
You're operating a **cooperative**. The patterns that matter most:

- **Member project applications** — `data/member-applications.yaml` (or your
  equivalent) tracks who's proposed what. Use the `meeting-processor` skill to
  process governance discussions into structured records.
- **Governance feedback** — every voting cycle should produce a memory entry
  capturing the rationale. Future cycles benefit from the history.
- **Decision rationale** — log key decisions to `DECISIONS.md`. The `who` and
  `why` matter as much as the `what`.
- **Channels** — Telegram for fast coordination, Discourse for deliberation,
  Discord for archive. Pick one as the source of truth for any given topic.
{{ /if }}
{{ #if isDAO }}
You're operating a **DAO**. The patterns that matter most:

- **Treasury operations** — every capital movement gets queued via
  `capital-flow` skill before execution.
- **Governance proposals** — proposals tracked in `data/proposals.yaml`,
  outcomes mapped to `MEMORY.md`.
- **EIP-4824 schemas** — `npm run generate:schemas` keeps your daoURI fresh
  after any identity change.
- **Hats / Karma / Gardens** — if any of these are wired, they show up in
  `IDENTITY.md`. Update there when roles or reputation change.
{{ /if }}
{{ #if isLocalNode }}
You're operating a **local node** (bioregional). The patterns that matter most:

- **Local context** — your bioregion's specifics live in your knowledge base.
- **Knowledge sharing** — what's local stays local; what generalizes flows
  upstream via `federation.yaml.knowledge_commons`.
- **Peer coordination** — sister local nodes are listed in
  `federation.yaml.peers`. Sync with them via the federation protocol.
{{ /if }}
{{ #if isProject }}
You're operating a **project** (or framework). The patterns that matter most:

- **Skills as the unit of capability** — extract reusable patterns into
  `skills/<name>/SKILL.md`. Promote them when validated in ≥2 contexts.
- **Plans as the unit of work** — every non-trivial change gets a plan in
  `docs/agent-plans/`. Follow the `scoping → queued → active → completed`
  lifecycle.
- **Memory as the connective tissue** — `memory/YYYY-MM-DD.md` per session.
  Past you is your most important collaborator.
{{ /if }}
{{ #if isHub }}
You're operating a **hub** (network coordinator). The patterns that matter most:

- **Cross-instance state** — `data/instances.yaml` tracks every node's
  maturity, version, last sync, drift.
- **Promotion candidates** — `skills-matrix.yaml` and `packages-matrix.yaml`
  surface what's ready to graduate.
- **Drift management** — `npm run analyze:instances` weekly; nudge instances
  that exceed the SLA.
{{ /if }}

## 4. Do your first thing (10 min)

A good first task: **process one piece of input** through the system.

- Has there been a recent meeting? Run the `meeting-processor` skill on its
  notes. The result lands in `data/meetings.yaml` and produces action items
  for `HEARTBEAT.md`.
- Have you made a decision recently? Log it to `DECISIONS.md` with the date,
  the choice, and the rationale.
- Is there a person who should be in the system? Add them to
  `data/members.yaml` and run `npm run generate:schemas`.

If nothing fits, just read `HEARTBEAT.md` and pick the smallest checkbox.

## 5. Close cleanly

When you're done, run:

```
/close
```

This:
1. Summarizes what you accomplished
2. Writes session notes to `memory/{{today}}.md`
3. Updates `HEARTBEAT.md` if anything was completed
4. Commits and pushes (your work is now safe)

Never end a session by closing the terminal. Always `/close`.

## When you get stuck

| Symptom | Try |
|---|---|
| `/initialize` shows nothing useful | Check `data/*.yaml` are populated. Run `npm run validate:structure`. |
| Validators failing | `npm run validate:schemas && npm run validate:structure` — fix what they report. |
| Commands fail | Run `npm install`. Check Node version is 22+. |
| Lost work after a session | `git reflog` — your commits are usually still there. |
| Drift between instance and framework | `npm run sync:upstream`. If breaking, `npm run migrate`. |
| You don't know what to work on | Read `HEARTBEAT.md`, then `MEMORY.md`, then `docs/agent-plans/QUEUE.md`. |
| You broke something on disk | Don't delete. `git status` first. The recovery runbook is in `docs/RELIABILITY.md`. |

## What's next

Once your first session feels comfortable:

- Read [`MASTERPLAN.md`](MASTERPLAN.md) for the long-term mandate
- Browse `skills/` to see what your agent already knows how to do
- Pick a plan from `docs/agent-plans/` and move it forward
- Establish a weekly rhythm: at least one `/initialize` → real work → `/close` per week

Welcome to org-os.
