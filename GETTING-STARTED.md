# Getting started with org-os

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


- **Recent context** — last few session notes
- **Plans** — what's queued for development
- **Federation** — your network and peers

Don't try to do everything you see. Just orient.

## 3. Find your role (10 min)





You're operating a **project** (or framework). The patterns that matter most:

- **Skills as the unit of capability** — extract reusable patterns into
  `skills/<name>/SKILL.md`. Promote them when validated in ≥2 contexts.
- **Plans as the unit of work** — every non-trivial change gets a plan in
  `docs/agent-plans/`. Follow the `scoping → queued → active → completed`
  lifecycle.
- **Memory as the connective tissue** — `memory/YYYY-MM-DD.md` per session.
  Past you is your most important collaborator.


You're operating a **hub** (network coordinator). The patterns that matter most:

- **Cross-instance state** — `data/instances.yaml` tracks every node's
  maturity, version, last sync, drift.
- **Promotion candidates** — `skills-matrix.yaml` and `packages-matrix.yaml`
  surface what's ready to graduate.
- **Drift management** — `npm run analyze:instances` weekly; nudge instances
  that exceed the SLA.


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
2. Writes session notes to `memory/2026-04-25.md`
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
