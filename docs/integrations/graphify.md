# Graphify Integration

**Package:** upstream CLI (`uv tool install graphifyy`) — no vendored package
**Source:** [Graphify](https://graphify.com/) · [GitHub](https://github.com/Graphify-Labs/graphify)
**Status:** 🟢 **Active — phase B (knowledge substrate)**
**Type:** Repo-local knowledge graph (AST + LLM extraction, community detection)

---

## What is Graphify?

Graphify turns the org's corpus (code, docs, YAML, PDFs) into a queryable
knowledge graph with explicit file:line citations and an honest audit trail
(EXTRACTED / INFERRED / AMBIGUOUS). No vector store, no API key required —
code is parsed deterministically (tree-sitter AST); docs are extracted by the
host agent or Gemini if a key is set.

## Architecture

```
  upstream graphify CLI ──builds──▶ graphify-out/graph.json  (committed, canonical)
                                          │
              ┌───────────────────────────┼───────────────────────┐
         read-only                   read-only                read-only
              ▼                           ▼                       ▼
     scripts/graph-status.mjs    scripts/graph-gaps.mjs    graphify query
     (/initialize dashboard)     (data/knowledge-gaps.yaml  (agents, query-first
                                  → knowledge-curator)       protocol in AGENTS.md)
```

Core invariant: org-os never writes into the graph — it builds it (at `/close`
via `graphify . --update`) and reads it. `graph.json` is a canonical data file
like `data/*.yaml`.

## Install (per operator/instance — never auto-installed)

```bash
uv tool install graphifyy   # CLI (PyPI package is graphifyy, command is graphify)
graphify install            # registers the /graphify skill for Claude Code
# optional, for SQL extraction:
uv tool install --with 'graphifyy[sql]' graphifyy --force
```

First build: run `/graphify .` in a Claude Code session (semantic extraction
uses subagents). Subsequent sessions: `/close` runs `graphify . --update`
automatically.

## What's committed

`graphify-out/`: `graph.json`, `cache/` (makes clone rebuilds near-free),
`manifest.json`, `GRAPH_REPORT.md`, `cost.json` — committed.
`graph.html`, `.graphify_python`, `.graphify_root` — gitignored (machine-local).

## Phase roadmap

- **A — query layer** ✅ query-first protocol (AGENTS.md)
- **B — knowledge substrate** ✅ dashboard section, knowledge-gaps registry, `/close` bookend
- **B follow-ups** ⏳ graph→`knowledge/` page stubs (`compile:knowledge`), `lint:knowledge` cross-check — queued in `docs/agent-plans/QUEUE.md`
- **C — federation** ⏳ per-instance `graph.json` as federation object; multi-repo merge at the hub; KOI RID bridge — deferred until KOI is past skeleton

## Known limitations

- 11 `.sql` files need the optional `graphifyy[sql]` extra to contribute AST nodes.
- Semantic extraction of docs costs LLM tokens (~789k input for the initial 355-file build; incremental updates only re-extract changed docs).
- Cross-chunk semantic references can produce dangling edges; `graph-gaps.mjs` skips them.
