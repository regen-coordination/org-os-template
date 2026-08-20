# Graphify KMS Integration — Design Spec

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan
**Owner:** org-os framework

## Summary

Integrate [Graphify](https://graphify.com/) (PyPI: `graphifyy`; CLI: `graphify`) as a core knowledge-graph module of the org-os KMS, alongside KOI, OPAL, Egregore, and the `knowledge/` directory. Graphify turns the org's code + docs corpus into a queryable knowledge graph (`graphify-out/graph.json`) with community detection and an EXTRACTED/INFERRED/AMBIGUOUS audit trail.

Proof of viability: the org-os repo itself was mapped on 2026-07-22 — 2,906 nodes, 4,678 edges, 184 communities from 355 files (~789k extraction tokens, cached in-repo so rebuilds are near-free).

## Decisions (from scoping)

| Question | Decision |
|---|---|
| Role in KMS | **Staged: query layer → knowledge substrate → federation object**, with the substrate phase as the center of gravity |
| Ownership | **Framework module** — ships in org-os, inherited by all instances via `sync:upstream` |
| Rebuild trigger | **Session bookends** — `/close` runs `graphify . --update`; `/initialize` reads, never builds |
| Substrate touchpoints | All five, ordered: (1) dashboard, (2) gap detection → curator, (4) query-first agent surface — initial build; (3) graph → knowledge pages, (5) lint cross-check — queued follow-ups |
| Commit policy | **Commit data, ignore renderings** — `graph.json`, `cache/`, `manifest.json`, `GRAPH_REPORT.md`, `cost.json` committed; `graph.html`, `.graphify_python`, `.graphify_root` ignored |
| Packaging | **Thin adapter** — org-os skill + two read-only scripts over `graph.json`; upstream CLI/skill stays canonical. No vendored bridge package until phase C demands it |

## Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │  UPSTREAM (canonical, not ours)              │
                 │  graphify CLI  ·  /graphify skill            │
                 └──────────────────┬──────────────────────────┘
                          builds/updates
                                   ▼
   /close ──update──▶   graphify-out/graph.json   ◀── committed, canonical
                        graphify-out/cache/            (like data/*.yaml)
                        graphify-out/GRAPH_REPORT.md
                                   │
             ┌─────────────────────┼──────────────────────┐
        read-only              read-only              read-only
             ▼                     ▼                      ▼
   scripts/graph-status.mjs  scripts/graph-gaps.mjs   graphify query
             │                     │                      │
             ▼                     ▼                      ▼
   /initialize dashboard    data/knowledge-gaps.yaml   agents answer
   ("Knowledge Graph"       → knowledge-curator +      questions from
    section, dashboard.yaml)  HEARTBEAT tasks           the graph first
```

**Core invariant:** org-os never writes into the graph. It builds it (upstream CLI at session close) and reads it (independent read-only consumers). `graph.json` joins `data/*.yaml` as a canonical data file; everything downstream is a pure function of it — the same pattern as `generate:schemas`.

**Lifecycle:** `/close` runs `graphify . --update` (incremental: seconds for code via AST; semantic re-extraction only for changed docs) before the vault-safe commit, so graph and repo state travel in the same commit. `/initialize` only renders `graph-status.mjs` output, with a staleness note if the graph predates HEAD.

**Degradation:** every touchpoint checks for the `graphify` binary and `graph.json`; if either is missing it prints one hint line and continues. No instance is ever blocked by this module.

## Components

### New files

| Component | Purpose |
|---|---|
| `skills/knowledge-graph/SKILL.md` | 10th core skill. When to build/update/query; query-first exploration protocol; degradation rules; gap-queue workflow. SKILL-SPECIFICATION.md frontmatter — dependencies: knowledge-curator; consumes: `graphify-out/graph.json`; manages: `data/knowledge-gaps.yaml` |
| `scripts/graph-status.mjs` | `graph.json` + `cost.json` + git HEAD → `{nodes, edges, communities, gaps, staleness}` JSON; `--format=markdown` block mirroring `initialize.mjs` conventions |
| `scripts/graph-gaps.mjs` | Weakly-connected nodes, AMBIGUOUS edges, low-cohesion communities → ranked `data/knowledge-gaps.yaml`; `--check` mode prints without writing |
| `data/knowledge-gaps.yaml` | Registry #14 (schema_version 2.0): `gaps: [{id, kind: orphan\|ambiguous-edge\|weak-community, node_ids, summary, status: open\|curated\|dismissed}]`. Curator consumes `open` entries; dismissals persist across re-runs |
| `docs/integrations/graphify.md` | Integration doc in koi.md/opal.md format: what it is, architecture, install (`uv tool install graphifyy` + `graphify install`), status, phase roadmap |
| `scripts/test/graph-fixtures/` | Miniature fixture `graph.json` (~20 nodes: orphan cluster, AMBIGUOUS edge, low-cohesion community) for script tests |

### Modified files

| File | Change |
|---|---|
| `.claude/commands/close.md` + `.opencode` mirrors | Bookend step: `command -v graphify && graphify . --update` before commit; then `graph-gaps.mjs` refresh |
| `scripts/initialize.mjs` | Optional "Knowledge Graph" dashboard section rendering `graph-status` output |
| `dashboard.yaml` | `knowledge_graph: true` section toggle |
| `AGENTS.md` + `docs/AGENTIC-ARCHITECTURE.md` | Query-first rule: before grep-exploring the org, run `graphify query "<question>"` if `graph.json` exists |
| `.gitignore` | Ignore `graphify-out/graph.html`, `.graphify_python`, `.graphify_root`; keep data files committed |
| `docs/DATA-MODEL.md` | Document registry #14 (`knowledge-gaps`) |
| `package.json` | `graph:status`, `graph:gaps`, `graph:update` npm aliases for non-Claude operators |
| `docs/agent-plans/QUEUE.md` | Queue phase 3+5 follow-up plans |

### Queued follow-ups (not in this build)

- **Phase 3:** `compile:knowledge` gains a graph source — community summaries → `knowledge/` page stubs via Graphify's `--wiki` export. Needs its own design pass (content-authority policy: generated stubs must not drown curated pages).
- **Phase 5:** `lint:knowledge` cross-checks `knowledge/INDEX.md` against graph reality (orphaned pages, undocumented god nodes). Depends on phase 3 conventions.
- **Phase C (federation):** per-instance `graph.json` as an exchangeable federation object (Graphify multi-repo merge at the hub; bridge into KOI RIDs). Deferred until KOI is past skeleton stage.

## Error handling

Every failure mode resolves to "print one line, continue":

| Condition | Behavior |
|---|---|
| CLI not installed | `/close` skips update with hint referencing `docs/integrations/graphify.md`; dashboard shows install hint; `graph-gaps.mjs` exits 0 with note |
| `graph.json` missing | Dashboard section self-hides; query-first rule falls back to normal exploration; gap registry untouched |
| Graph stale (older than HEAD) | Dashboard shows `⚠ graph is N commits behind` — informational; next `/close` heals. Staleness = commits since the last run's timestamp (latest entry in `graphify-out/cost.json`), counted via `git rev-list --count --since=<ts> HEAD` |
| `--update` fails mid-run | Graphify's shrink-guard + manifest stamping protect `graph.json`; `/close` reports the error but still commits the repo; retry next session |
| Corrupt `graph.json` | Scripts validate on load; report `graph: invalid graph.json — re-run /graphify .`, exit 0 |
| Gap re-detection vs. dismissals | Merge by stable gap ID (hash of kind + sorted node IDs); `dismissed`/`curated` preserved; only new gaps append as `open` |
| Vault safety | `--update` writes only inside `graphify-out/`; `/close` commit path unchanged |

**Non-goal:** no auto-install. The module never runs `uv tool install` itself — installing a third-party toolchain is an operator decision (draft-and-present safety rule).

## Instance propagation

Ships via `sync:upstream` like any framework change. Instances without the CLI see zero behavior change. `docs/integrations/graphify.md` is the single install reference; the dashboard hint makes it discoverable.

## Testing

org-os has no test framework; follow the `validate:*` script idiom:

1. **Fixture-driven script tests** — `graph-status.mjs --test` / `graph-gaps.mjs --test` against `scripts/test/graph-fixtures/graph.json`; assert orphan detection, dismissed-gap preservation, staleness detection. Wired into `npm run check`.
2. **Registry validation** — `knowledge-gaps.yaml` joins `validate:schemas`; `validate:structure` learns `graphify-out/` is a legal top-level directory.
3. **Degradation tests** — same `--test` mode with fixture absent and with corrupt JSON; assert exit 0 + hint line.
4. **Live smoke** — the repo's real 2,906-node graph is the acceptance corpus; both scripts must produce sane output against it before shipping.

## Success criteria

- `/close` updates the graph in <30s for a code-only change; commit contains repo + graph in one snapshot
- `/initialize` renders the Knowledge Graph section with correct stats and staleness
- `data/knowledge-gaps.yaml` populated from the real graph (the 942 weakly-connected nodes surface as ranked entries); knowledge-curator can consume it
- A clean instance clone **without** the CLI runs `/initialize`, `/close`, all `validate:*` with zero errors and exactly one hint line
- `sync:upstream` propagates the module with no manual steps beyond the documented CLI install

## Known issues to carry into implementation

- Current build has 335 dangling-endpoint edges (cross-chunk semantic references) and 135 collapsed duplicate edges — `graph-gaps.mjs` must tolerate dangling endpoints rather than crash, and should exclude them from orphan ranking (they are extraction artifacts, not knowledge gaps).
- 11 `.sql` files contributed nothing (missing `tree_sitter_sql`); 27 JSON data files produced zero AST nodes. Document `pip install 'graphifyy[sql]'` in the integration doc as optional.
