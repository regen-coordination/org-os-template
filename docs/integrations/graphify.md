# Graphify

Graphify is an external command-line tool that turns a repository's code and documents into a queryable knowledge graph. org-os does not vendor it. The repository's side is small and real: a skill, two read-only scripts, a session-close step, and the committed output in `graphify-out/`.

**Status:** active. The graph is committed, the dashboard reads it, and `/close` refreshes it when the CLI is installed. The committed graph is a snapshot of the last build (2026-07-22 per `cost.json`); `npm run graph:status` shows how far behind it is.

## What must be installed outside the repository

The CLI is installed per operator and never automatically:

```bash
uv tool install graphifyy   # the PyPI package is graphifyy; the command is graphify
graphify install            # registers the /graphify skill for Claude Code
```

Both commands are the upstream tool's instructions and were not run here. The CLI also has an optional SQL extra (`graphifyy[sql]`, upstream behaviour not verified here). Without the CLI, everything below degrades to a one-line hint and never blocks a session, commit or close.

## Commands

| Command | What it does |
|---|---|
| `/graphify .` (in Claude Code) | First full build. Semantic extraction of documents uses the host agent's subagents. |
| `graphify . --update` | Incremental refresh. `/close` runs it (step 7 of `.claude/commands/close.md`) when the CLI is installed and `graphify-out/graph.json` exists, followed by `npm run graph:gaps`. |
| `graphify query "<question>"` | Ask the graph. `AGENTS.md` tells agents to try this before grep-style exploration when the graph exists, citing `source_location`. |
| `npm run graph:update` | Guarded wrapper for `graphify . --update`; prints a hint if the CLI is absent. |
| `npm run graph:status` | Read-only summary (`scripts/graph-status.mjs`): node, edge and community counts, ambiguous edges, and how many commits the graph is behind. |
| `npm run graph:gaps` | `scripts/graph-gaps.mjs` reads the graph and rewrites `data/knowledge-gaps.yaml`, keeping the statuses you set. `--check` prints without writing; `--test` runs its fixture assertions. |

`graph:gaps` writes to `data/knowledge-gaps.yaml`. It proposes gaps from weak communities (cohesion below 0.15, at least 5 members) and orphan groups. Triage is by status: `open`, `curated` or `dismissed`; dismissals persist across runs. The workflow is in `skills/knowledge-graph/SKILL.md`.

## What it writes and where

org-os never writes into the graph; it builds it with the CLI and reads it.

| Path | Committed |
|---|---|
| `graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`, `cost.json`, `.graphify_labels.json`, `cache/` | yes |
| `graphify-out/graph.html`, `.graphify_python`, `.graphify_root` | no, gitignored (machine-local) |

`/initialize` shows a graph section from `graph-status.mjs` and hides it if there is no graph. `node scripts/graph-gaps.mjs --test` passes on the fixtures in `scripts/test/graph-fixtures/`.

## Current state of this repository's graph

`graphify-out/graph.json` holds 2,906 nodes and 4,678 links. `cost.json` records one build run, on 355 files, with 789,296 input tokens. Semantic extraction of documents costs tokens; incremental updates re-extract only what changed. Edges carry an EXTRACTED, INFERRED or AMBIGUOUS confidence label (the status script reports the ambiguous ones).

## Limits

- The upstream tool is said to need its optional SQL extra for `.sql` files to contribute AST nodes. Taken from a design note, not verified.
- Semantic extraction can leave dangling edges; `graph-gaps.mjs` skips them.
- A committed graph goes stale between `/close` runs; `graph:status` reports how far behind it is.

## Not built

- Generating `knowledge/` page stubs from the graph, and a lint cross-check against the graph. These are queued follow-ups (`docs/agent-plans/QUEUE.md`), not part of the skill. The existing `compile:knowledge` script does not read the graph.
- Per-instance graphs as federation objects, a multi-repo merge at the hub, and a KOI bridge for graphs. Planned only.

## Not verified against the code

The upstream project's name, addresses and install instructions come from the tool itself, not this repository; the CLI was not run.
