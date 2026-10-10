# Autoresearch

org-os has one thing behind this idea: the `workspace-improver` skill (`skills/workspace-improver/SKILL.md`, tier `core`). It is a written procedure that an agent follows when the operator asks for it. There is no script, no npm command and no scheduled workflow that runs it, and no `memory/` file records a session run with it. The pattern is modelled on [karpathy/autoresearch](https://github.com/karpathy/autoresearch): a human-written direction file, one editable surface, a fixed way of measuring, and keep-or-revert.

Status: pattern plus one skill, used manually. In `data/skills-matrix.yaml` it is `canonical` in the framework and listed as used by one instance (`refi-dao-os`).

## How an operator runs it

Open a session in the instance with an agent runtime and say one of the skill's trigger phrases: "improve workspace", "autoresearch", "autonomous improvement" or "find and fix gaps". The agent loads the skill and follows it. Nothing starts it on its own: `federation.yaml` has `proactive: false`, and the two scheduled workflows in `.github/workflows/` (a weekly drift report and a daily schema regeneration) do not run the skill.

What you steer it with is `MASTERPLAN.md`. The skill reads its activations (§3) and research directions (§4), plus `HEARTBEAT.md` and the last three days of `memory/`. What the agent may change is bounded by the skill and by `MASTERPLAN.md` §6, so write what it must not touch there.

## The loop the skill describes

One improvement per cycle, in this order:

1. Read `MASTERPLAN.md`, `HEARTBEAT.md` and recent `memory/`.
2. Pick one improvement, by priority: an unchecked MASTERPLAN activation; data gaps in `data/*.yaml` (TBD or null values, `last_updated` older than seven days); knowledge gaps (`npm run compile:knowledge`, `npm run lint:knowledge`, coverage in `data/knowledge-manifest.yaml`, unprocessed entries in `data/sources.yaml`); schema health (`npm run validate:schemas`); pending `HEARTBEAT.md` tasks.
3. Record baseline numbers.
4. Make one scoped change.
5. Run `npm run generate:schemas` and `npm run validate:schemas`, record the numbers again.
6. Keep the change if the numbers held or improved, revert it if they regressed, and keep but flag for human review if unclear.
7. Log it in `memory/YYYY-MM-DD.md` and update `HEARTBEAT.md`.

The log entry is a block headed `## Autoresearch Session [HH:MM]` with the improvement, direction, before, action, after, result (kept or reverted) and notes.

## What the agent may and may not change

May change: `data/*.yaml`, `knowledge/`, `memory/`, `skills/` (new definitions, marked draft), `.well-known/` (regenerated) and `HEARTBEAT.md`. Must not change without a human: `SOUL.md`, `IDENTITY.md`, `federation.yaml`, `MASTERPLAN.md`, `package.json`, `USER.md`. The skill also lists `ideas/` as writable; the framework has no `ideas/` directory (ideas live in `data/ideas.yaml`).

## What is not built

- Automated metric collection. The metrics the skill names (HEARTBEAT unchecked count, knowledge coverage, data freshness, idea pipeline, data completeness) are measured by the agent reading files, not by a script. Only schema validation is a real command.
- Scheduling. A session happens when someone starts one.
- A track record. The framework's `MASTERPLAN.md` still lists "Autoresearch metrics: define and refine evaluation criteria for autonomous workspace improvement" as an open research direction (§4).
- A framework-wide `knowledge/` to improve: in the framework repository it holds only `INDEX.md`, and `data/sources.yaml` is empty. The knowledge steps matter in instances that have populated them.

Related: [AGENTIC-ARCHITECTURE.md](AGENTIC-ARCHITECTURE.md) for the wider agent operating model.
