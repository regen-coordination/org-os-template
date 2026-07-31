# Graphify KMS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Graphify as a core knowledge-graph module of org-os: session-bookend graph updates, dashboard stats, a knowledge-gaps registry feeding the curator, and a query-first agent protocol — all as thin read-only consumers of `graphify-out/graph.json`.

**Architecture:** The upstream `graphify` CLI stays canonical and builds/updates `graphify-out/graph.json` at `/close`. org-os adds two read-only Node scripts (`graph-status.mjs` for the dashboard, `graph-gaps.mjs` for the gap registry), a new `data/knowledge-gaps.yaml` registry, a core skill, and doc/command wiring. Every touchpoint degrades to a one-line hint when the CLI or graph is absent.

**Tech Stack:** Node ≥22 ES modules, `js-yaml`, upstream `graphifyy` CLI (uv tool), existing `validate:*` script idiom (no test framework — `--test` fixture modes wired into `npm run check`).

**Spec:** `docs/superpowers/specs/2026-07-22-graphify-kms-integration-design.md`

**Key data format facts (verified against the live build):**
- `graphify-out/graph.json` is NetworkX node-link JSON: top-level keys `directed, multigraph, graph, nodes, links, hyperedges, built_at_commit`. Edges are under **`links`**, NOT `edges`.
- Node: `{id, label, file_type, source_file, source_location, _origin, community, norm_label, ...}`
- Link: `{source, target, relation, confidence: "EXTRACTED"|"INFERRED"|"AMBIGUOUS", confidence_score, source_file, weight, ...}`
- `graphify-out/cost.json`: `{runs: [{date: ISO8601, input_tokens, output_tokens, files}], total_input_tokens, total_output_tokens}` — latest run's `date` is the graph build timestamp.
- Registries use `schema_version: "2.0"` + a top-level list key + commented example (see `data/ideas.yaml`).
- Dashboard sections in `scripts/initialize.mjs` `renderMarkdown()` gate on `config.<name>?.show !== false`; config loads from `dashboard.yaml`.

---

### Task 1: Fix validate-structure v3.0 federation drift (unblocks all commits)

The pre-commit hook runs `validate:structure`, which fails on every commit because it expects a `federation:` section that the v3.0 flat manifest (top-level `network`, `hub`, `peers`, `upstream`) no longer has. Nothing else can land until this is fixed.

**Files:**
- Modify: `scripts/validate-structure.mjs` (the check that prints `federation.yaml has federation section`)

- [ ] **Step 1: Locate the failing check**

Run: `grep -n "federation section" scripts/validate-structure.mjs`
Expected: one check line asserting `fed.federation` (or similar) exists.

- [ ] **Step 2: Replace with v3.0-or-legacy check**

Replace the single check with (adapt to the file's existing `check(...)` helper signature — keep the same reporting style as neighboring checks):

```js
// v3.0 flat manifest: network/hub/peers/upstream at top level.
// Legacy v2: grouped under a `federation:` key. Accept either.
const hasV3 = fed && ("peers" in fed || "upstream" in fed || "network" in fed);
const hasLegacy = fed && typeof fed.federation === "object" && fed.federation !== null;
check(
  "federation.yaml has federation config (v3.0 flat or legacy section)",
  hasV3 || hasLegacy
);
```

- [ ] **Step 3: Verify the validator passes**

Run: `npm run validate:structure`
Expected: `0 failed` (the `.well-known/dao.json` failure was already fixed in commit `1cbac3a`; if it reappears run `npm run generate:schemas`).

- [ ] **Step 4: Commit (hook now passes — no `--no-verify`)**

```bash
git add scripts/validate-structure.mjs
git commit -m "fix: accept v3.0 flat federation manifest in validate:structure"
```

---

### Task 2: Test fixtures + .gitignore rules

**Files:**
- Create: `scripts/test/graph-fixtures/graph.json`
- Create: `scripts/test/graph-fixtures/cost.json`
- Create: `scripts/test/graph-fixtures/corrupt-graph.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the miniature graph fixture**

`scripts/test/graph-fixtures/graph.json` — 12 nodes: community 0 is a well-connected code cluster; community 1 is a low-cohesion 5-node doc community (only 1 internal link among 5 nodes); `orphan_a`/`orphan_b` are degree-≤1 stragglers from one file; one AMBIGUOUS link.

```json
{
  "directed": false,
  "multigraph": false,
  "graph": { "hyperedges": [] },
  "built_at_commit": "fixturecommit000",
  "nodes": [
    { "id": "core_a", "label": "CoreA", "file_type": "code", "source_file": "src/core.ts", "community": 0 },
    { "id": "core_b", "label": "CoreB", "file_type": "code", "source_file": "src/core.ts", "community": 0 },
    { "id": "core_c", "label": "CoreC", "file_type": "code", "source_file": "src/core.ts", "community": 0 },
    { "id": "core_d", "label": "CoreD", "file_type": "code", "source_file": "src/core.ts", "community": 0 },
    { "id": "doc_a", "label": "DocA", "file_type": "document", "source_file": "docs/a.md", "community": 1 },
    { "id": "doc_b", "label": "DocB", "file_type": "document", "source_file": "docs/b.md", "community": 1 },
    { "id": "doc_c", "label": "DocC", "file_type": "document", "source_file": "docs/c.md", "community": 1 },
    { "id": "doc_d", "label": "DocD", "file_type": "document", "source_file": "docs/d.md", "community": 1 },
    { "id": "doc_e", "label": "DocE", "file_type": "document", "source_file": "docs/e.md", "community": 1 },
    { "id": "orphan_a", "label": "OrphanA", "file_type": "document", "source_file": "docs/orphans.md", "community": 2 },
    { "id": "orphan_b", "label": "OrphanB", "file_type": "document", "source_file": "docs/orphans.md", "community": 2 },
    { "id": "bridge", "label": "Bridge", "file_type": "concept", "source_file": "docs/a.md", "community": 1 }
  ],
  "links": [
    { "source": "core_a", "target": "core_b", "relation": "calls", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "src/core.ts", "weight": 1.0 },
    { "source": "core_a", "target": "core_c", "relation": "calls", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "src/core.ts", "weight": 1.0 },
    { "source": "core_b", "target": "core_c", "relation": "calls", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "src/core.ts", "weight": 1.0 },
    { "source": "core_c", "target": "core_d", "relation": "calls", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "src/core.ts", "weight": 1.0 },
    { "source": "doc_a", "target": "doc_b", "relation": "references", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "docs/a.md", "weight": 1.0 },
    { "source": "doc_c", "target": "core_a", "relation": "conceptually_related_to", "confidence": "AMBIGUOUS", "confidence_score": 0.2, "source_file": "docs/c.md", "weight": 1.0 },
    { "source": "doc_d", "target": "bridge", "relation": "references", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "docs/d.md", "weight": 1.0 },
    { "source": "orphan_a", "target": "orphan_b", "relation": "references", "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": "docs/orphans.md", "weight": 1.0 }
  ],
  "hyperedges": []
}
```

Community cohesion math for the fixture: community 1 has 5 members (`doc_a..doc_e` — `bridge` also in 1, so 6 members) — internal links: doc_a–doc_b, doc_d–bridge = 2 of 15 possible = 0.133… Keep threshold at 0.15 so community 1 flags as weak. Community 0: 4 nodes, 4 internal links of 6 possible = 0.67 — healthy. `doc_e` has degree 0 → orphan; `orphan_a`/`orphan_b` each degree 1 in a 2-node islet → orphans.

- [ ] **Step 2: Write cost + corrupt fixtures**

`scripts/test/graph-fixtures/cost.json`:

```json
{
  "runs": [
    { "date": "2026-07-22T19:44:00+00:00", "input_tokens": 1000, "output_tokens": 0, "files": 12 }
  ],
  "total_input_tokens": 1000,
  "total_output_tokens": 0
}
```

`scripts/test/graph-fixtures/corrupt-graph.json`:

```
{ this is not valid json
```

- [ ] **Step 3: Update .gitignore**

Append to `.gitignore`:

```gitignore
# Graphify — commit data (graph.json, cache/, manifest.json, GRAPH_REPORT.md, cost.json),
# ignore renderings and machine-local files
graphify-out/graph.html
graphify-out/.graphify_python
graphify-out/.graphify_root
```

- [ ] **Step 4: Commit**

```bash
git add scripts/test/graph-fixtures/ .gitignore
git commit -m "test: add graph fixtures for graphify integration scripts; gitignore graphify renderings"
```

---

### Task 3: `scripts/graph-status.mjs`

**Files:**
- Create: `scripts/graph-status.mjs`
- Modify: `package.json` (scripts block)

Contract: reads `graphify-out/graph.json` + `graphify-out/cost.json` + git → JSON to stdout (or `--format=markdown` block). `--test` runs fixture assertions. Missing/corrupt graph → hint object/line, **exit 0** (`--test` is the only mode that can exit 1).

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// graph-status.mjs — read-only Graphify graph stats for the /initialize dashboard.
// Usage:
//   node scripts/graph-status.mjs                  # JSON to stdout
//   node scripts/graph-status.mjs --format=markdown
//   node scripts/graph-status.mjs --test           # fixture assertions (exit 1 on failure)
// Never blocks: missing or corrupt graph yields {available:false, hint} and exit 0.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export function readGraphStatus(dir = path.join(rootDir, "graphify-out"), opts = {}) {
  const graphPath = path.join(dir, "graph.json");
  const costPath = path.join(dir, "cost.json");

  if (!fs.existsSync(graphPath)) {
    return { available: false, hint: "graph: not built — run /graphify . (see docs/integrations/graphify.md)" };
  }

  let g;
  try {
    g = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    if (!Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error("missing nodes/links");
  } catch {
    return { available: false, hint: "graph: invalid graph.json — re-run /graphify ." };
  }

  const communities = new Set(g.nodes.map((n) => n.community).filter((c) => c !== undefined));
  const ambiguous = g.links.filter((l) => l.confidence === "AMBIGUOUS").length;

  // Staleness: commits since the last run's timestamp (spec: git rev-list --count --since)
  let staleness = null;
  try {
    const cost = JSON.parse(fs.readFileSync(costPath, "utf8"));
    const lastRun = cost.runs?.[cost.runs.length - 1]?.date;
    if (lastRun && !opts.noGit) {
      const n = execSync(`git rev-list --count --since="${lastRun}" HEAD`, {
        cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      staleness = { commitsBehind: parseInt(n, 10) || 0, lastBuilt: lastRun };
    }
  } catch { /* cost.json or git unavailable — staleness stays null */ }

  return {
    available: true,
    nodes: g.nodes.length,
    edges: g.links.length,
    communities: communities.size,
    ambiguousEdges: ambiguous,
    builtAtCommit: g.built_at_commit || null,
    staleness,
  };
}

export function renderStatusMarkdown(s) {
  if (!s.available) return `  ${s.hint}`;
  const lines = [
    `  ${s.nodes.toLocaleString("en-US")} nodes · ${s.edges.toLocaleString("en-US")} edges · ${s.communities} communities · ${s.ambiguousEdges} ambiguous edges`,
  ];
  if (s.staleness && s.staleness.commitsBehind > 0) {
    lines.push(`  ⚠ graph is ${s.staleness.commitsBehind} commit(s) behind — /close will update it`);
  } else if (s.staleness) {
    lines.push(`  graph is current (built ${s.staleness.lastBuilt.split("T")[0]})`);
  }
  return lines.join("\n");
}

function runTests() {
  const fx = path.join(__dirname, "test", "graph-fixtures");
  let failures = 0;
  const assert = (cond, msg) => {
    if (!cond) { console.error(`  ✗ ${msg}`); failures++; } else { console.log(`  ✓ ${msg}`); }
  };

  const s = readGraphStatus(fx, { noGit: true });
  assert(s.available === true, "fixture graph loads");
  assert(s.nodes === 12, `node count is 12 (got ${s.nodes})`);
  assert(s.edges === 8, `edge count is 8 (got ${s.edges})`);
  assert(s.communities === 3, `community count is 3 (got ${s.communities})`);
  assert(s.ambiguousEdges === 1, `ambiguous edge count is 1 (got ${s.ambiguousEdges})`);
  assert(s.builtAtCommit === "fixturecommit000", "built_at_commit read");

  const missing = readGraphStatus(path.join(fx, "does-not-exist"));
  assert(missing.available === false && missing.hint.includes("not built"), "missing graph degrades with hint");

  // Corrupt: point at a dir where graph.json is the corrupt fixture
  const corruptDir = fs.mkdtempSync(path.join(fx, "tmp-"));
  fs.copyFileSync(path.join(fx, "corrupt-graph.json"), path.join(corruptDir, "graph.json"));
  const corrupt = readGraphStatus(corruptDir);
  fs.rmSync(corruptDir, { recursive: true, force: true });
  assert(corrupt.available === false && corrupt.hint.includes("invalid"), "corrupt graph degrades with hint");

  console.log(failures === 0 ? "graph-status: all tests passed" : `graph-status: ${failures} test(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

const args = process.argv.slice(2);
if (args.includes("--test")) {
  runTests();
} else {
  const status = readGraphStatus();
  if (args.includes("--format=markdown")) console.log(renderStatusMarkdown(status));
  else console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}
```

- [ ] **Step 2: Run the fixture tests — expect all pass**

Run: `node scripts/graph-status.mjs --test`
Expected: 8 `✓` lines, `graph-status: all tests passed`, exit 0.

- [ ] **Step 3: Live smoke against the real graph**

Run: `node scripts/graph-status.mjs --format=markdown`
Expected: a line like `2,906 nodes · 4,678 edges · 184 communities · N ambiguous edges` plus a staleness line. (Numbers must match the current real graph — nonzero, no crash.)

- [ ] **Step 4: Add npm alias**

In `package.json` scripts block, after `"validate:structure"`:

```json
    "graph:status": "node scripts/graph-status.mjs --format=markdown",
```

- [ ] **Step 5: Commit**

```bash
git add scripts/graph-status.mjs package.json
git commit -m "feat: add graph-status script — dashboard stats over graphify-out/graph.json"
```

---

### Task 4: `scripts/graph-gaps.mjs` + `data/knowledge-gaps.yaml` registry

**Files:**
- Create: `scripts/graph-gaps.mjs`
- Create: `data/knowledge-gaps.yaml`
- Modify: `package.json`

Contract: detects three gap kinds — `orphan` (degree ≤ 1 nodes, grouped by `source_file`), `ambiguous-edge` (one per AMBIGUOUS link), `weak-community` (cohesion < 0.15 with ≥ 5 members). Stable IDs = `sha256(kind + "|" + sorted node_ids).slice(0,12)`. Merges into the registry preserving `dismissed`/`curated` statuses; only new IDs append as `open`. `--check` prints without writing. `--test` runs fixture assertions.

- [ ] **Step 1: Create the empty registry scaffold**

`data/knowledge-gaps.yaml`:

```yaml
schema_version: "2.0"

# Knowledge Gaps Registry (#14)
# Generated by scripts/graph-gaps.mjs from graphify-out/graph.json — do not hand-edit
# entries except `status`. Lifecycle: open → curated | dismissed
# Managed by: skills/knowledge-graph · Consumed by: skills/knowledge-curator

gaps: []
  # Example:
  # - id: "a1b2c3d4e5f6"
  #   kind: "orphan"           # orphan | ambiguous-edge | weak-community
  #   node_ids: ["docs_x_concept"]
  #   summary: "docs/x.md: 3 weakly-connected node(s)"
  #   status: "open"           # open | curated | dismissed
  #   detected: "2026-07-22"
```

- [ ] **Step 2: Write the script**

```js
#!/usr/bin/env node
// graph-gaps.mjs — extract knowledge gaps from graphify-out/graph.json into
// data/knowledge-gaps.yaml for the knowledge-curator skill.
// Usage:
//   node scripts/graph-gaps.mjs            # detect + merge + write registry
//   node scripts/graph-gaps.mjs --check    # detect + print, no write
//   node scripts/graph-gaps.mjs --test     # fixture assertions (exit 1 on failure)
// Never blocks: missing/corrupt graph prints a hint and exits 0.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const COHESION_THRESHOLD = 0.15;
const MIN_COMMUNITY_SIZE = 5;

function gapId(kind, nodeIds) {
  return crypto.createHash("sha256")
    .update(kind + "|" + [...nodeIds].sort().join(","))
    .digest("hex").slice(0, 12);
}

export function detectGaps(g) {
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]));
  const degree = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const l of g.links) {
    // Tolerate dangling endpoints (extraction artifacts) — skip, never crash (spec: Known issues)
    if (!nodeById.has(l.source) || !nodeById.has(l.target)) continue;
    degree.set(l.source, degree.get(l.source) + 1);
    degree.set(l.target, degree.get(l.target) + 1);
  }

  const gaps = [];

  // 1. Orphans: degree <= 1, grouped by source_file (one gap per file)
  const orphansByFile = new Map();
  for (const n of g.nodes) {
    if ((degree.get(n.id) ?? 0) <= 1) {
      const f = n.source_file || "(unknown)";
      if (!orphansByFile.has(f)) orphansByFile.set(f, []);
      orphansByFile.get(f).push(n.id);
    }
  }
  for (const [file, ids] of orphansByFile) {
    gaps.push({
      id: gapId("orphan", ids),
      kind: "orphan",
      node_ids: ids.sort(),
      summary: `${file}: ${ids.length} weakly-connected node(s)`,
    });
  }

  // 2. Ambiguous edges: one gap per AMBIGUOUS link with resolvable endpoints
  for (const l of g.links) {
    if (l.confidence !== "AMBIGUOUS") continue;
    if (!nodeById.has(l.source) || !nodeById.has(l.target)) continue;
    const ids = [l.source, l.target];
    gaps.push({
      id: gapId("ambiguous-edge", ids),
      kind: "ambiguous-edge",
      node_ids: ids.sort(),
      summary: `${l.source} —${l.relation}→ ${l.target} is AMBIGUOUS (score ${l.confidence_score ?? "n/a"})`,
    });
  }

  // 3. Weak communities: internal cohesion < threshold, size >= MIN_COMMUNITY_SIZE
  const members = new Map();
  for (const n of g.nodes) {
    if (n.community === undefined) continue;
    if (!members.has(n.community)) members.set(n.community, []);
    members.get(n.community).push(n.id);
  }
  const internal = new Map();
  for (const l of g.links) {
    const cs = nodeById.get(l.source)?.community;
    const ct = nodeById.get(l.target)?.community;
    if (cs !== undefined && cs === ct) internal.set(cs, (internal.get(cs) || 0) + 1);
  }
  for (const [cid, ids] of members) {
    const n = ids.length;
    if (n < MIN_COMMUNITY_SIZE) continue;
    const possible = (n * (n - 1)) / 2;
    const cohesion = possible > 0 ? (internal.get(cid) || 0) / possible : 0;
    if (cohesion < COHESION_THRESHOLD) {
      gaps.push({
        id: gapId("weak-community", ids),
        kind: "weak-community",
        node_ids: ids.sort(),
        summary: `community ${cid}: ${n} nodes, cohesion ${cohesion.toFixed(3)} < ${COHESION_THRESHOLD}`,
      });
    }
  }

  // Rank: weak communities first (structural), then orphan groups by size desc, then ambiguous
  const kindOrder = { "weak-community": 0, orphan: 1, "ambiguous-edge": 2 };
  gaps.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.node_ids.length - a.node_ids.length);
  // Dedupe by id: distinct AMBIGUOUS links between the same node pair collapse to
  // one gap, preserving the unique-key invariant mergeGaps and the curator rely on.
  // Map keeps insertion order, so the sort above is preserved.
  const byId = new Map();
  for (const gap of gaps) if (!byId.has(gap.id)) byId.set(gap.id, gap);
  return [...byId.values()];
}

export function mergeGaps(existing, detected, today) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const merged = [];
  for (const d of detected) {
    const prior = byId.get(d.id);
    if (prior) {
      merged.push({ ...d, status: prior.status, detected: prior.detected }); // preserve status + first-seen
    } else {
      merged.push({ ...d, status: "open", detected: today });
    }
  }
  // Preserve dismissed/curated entries whose gap no longer detects (history), drop stale `open` ones
  const detectedIds = new Set(detected.map((d) => d.id));
  for (const e of existing) {
    if (!detectedIds.has(e.id) && e.status !== "open") merged.push(e);
  }
  return merged;
}

export function run({ graphDir, registryPath, write, today }) {
  const graphPath = path.join(graphDir, "graph.json");
  if (!fs.existsSync(graphPath)) {
    console.log("graph: not built — no gaps to detect (see docs/integrations/graphify.md)");
    return { ok: false };
  }
  let g;
  try {
    g = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    if (!Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error("bad shape");
  } catch {
    console.log("graph: invalid graph.json — re-run /graphify .");
    return { ok: false };
  }

  const detected = detectGaps(g);
  let registry = { schema_version: "2.0", gaps: [] };
  if (fs.existsSync(registryPath)) {
    try {
      const loaded = yaml.load(fs.readFileSync(registryPath, "utf8"));
      if (loaded && Array.isArray(loaded.gaps)) registry = loaded;
    } catch {
      console.log("gaps: existing registry is invalid YAML — starting fresh");
    }
  }
  const merged = mergeGaps(registry.gaps, detected, today);
  const open = merged.filter((x) => x.status === "open").length;

  if (write) {
    const header =
      `schema_version: "${registry.schema_version || "2.0"}"\n\n` +
      "# Knowledge Gaps Registry (#14)\n" +
      "# Generated by scripts/graph-gaps.mjs from graphify-out/graph.json — do not hand-edit\n" +
      "# entries except `status`. Lifecycle: open → curated | dismissed\n" +
      "# Managed by: skills/knowledge-graph · Consumed by: skills/knowledge-curator\n\n";
    fs.writeFileSync(registryPath, header + yaml.dump({ gaps: merged }, { lineWidth: 120 }));
  }
  console.log(`gaps: ${detected.length} detected, ${open} open, ${merged.length - open} curated/dismissed${write ? " — registry written" : " (check mode, not written)"}`);
  return { ok: true, detected, merged };
}

function runTests() {
  const fx = path.join(__dirname, "test", "graph-fixtures");
  const g = JSON.parse(fs.readFileSync(path.join(fx, "graph.json"), "utf8"));
  let failures = 0;
  const assert = (cond, msg) => {
    if (!cond) { console.error(`  ✗ ${msg}`); failures++; } else { console.log(`  ✓ ${msg}`); }
  };

  const gaps = detectGaps(g);
  const kinds = (k) => gaps.filter((x) => x.kind === k);
  // Orphans (degree<=1): doc_c(1)? no — doc_c has 1 link → degree 1 → orphan. Recount from fixture:
  // degrees: core_a=3 core_b=2 core_c=3 core_d=1 doc_a=1 doc_b=1 doc_c=1 doc_d=1 doc_e=0 orphan_a=1 orphan_b=1 bridge=1
  // orphan files: src/core.ts [core_d], docs/a.md [doc_a, bridge], docs/b.md [doc_b], docs/c.md [doc_c],
  //               docs/d.md [doc_d], docs/e.md [doc_e], docs/orphans.md [orphan_a, orphan_b] = 7 orphan groups
  assert(kinds("orphan").length === 7, `7 orphan groups (got ${kinds("orphan").length})`);
  assert(kinds("ambiguous-edge").length === 1, `1 ambiguous-edge gap (got ${kinds("ambiguous-edge").length})`);
  assert(kinds("weak-community").length === 1, `1 weak community (got ${kinds("weak-community").length})`);
  assert(gaps[0].kind === "weak-community", "weak-community ranked first");

  // Stable IDs: same input → same id
  const gaps2 = detectGaps(g);
  assert(gaps[0].id === gaps2[0].id, "gap IDs are deterministic");

  // Merge preserves dismissals and drops stale open entries
  const existing = [
    { ...gaps[0], status: "dismissed", detected: "2026-01-01" },
    { id: "deadbeef0000", kind: "orphan", node_ids: ["gone"], summary: "stale", status: "open", detected: "2026-01-01" },
    { id: "deadbeef1111", kind: "orphan", node_ids: ["kept"], summary: "curated history", status: "curated", detected: "2026-01-01" },
  ];
  const merged = mergeGaps(existing, gaps, "2026-07-22");
  const mergedFirst = merged.find((x) => x.id === gaps[0].id);
  assert(mergedFirst.status === "dismissed" && mergedFirst.detected === "2026-01-01", "dismissed status + first-seen date preserved");
  assert(!merged.some((x) => x.id === "deadbeef0000"), "stale open entry dropped");
  assert(merged.some((x) => x.id === "deadbeef1111"), "curated history preserved");
  assert(merged.filter((x) => x.id !== "deadbeef1111").every((x) => x.status === "dismissed" || x.status === "open"), "new gaps default to open");

  // Degradation: missing + corrupt exit ok:false without throwing
  const r1 = run({ graphDir: path.join(fx, "nope"), registryPath: "/dev/null", write: false, today: "2026-07-22" });
  assert(r1.ok === false, "missing graph degrades");
  const tmp = fs.mkdtempSync(path.join(fx, "tmp-"));
  fs.copyFileSync(path.join(fx, "corrupt-graph.json"), path.join(tmp, "graph.json"));
  const r2 = run({ graphDir: tmp, registryPath: "/dev/null", write: false, today: "2026-07-22" });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r2.ok === false, "corrupt graph degrades");

  console.log(failures === 0 ? "graph-gaps: all tests passed" : `graph-gaps: ${failures} test(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

// Entrypoint guard: only run the CLI when invoked directly, never on import
// (this file exports detectGaps/mergeGaps/run — importing it must have no side effects).
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--test")) {
    runTests();
  } else {
    run({
      graphDir: path.join(rootDir, "graphify-out"),
      registryPath: path.join(rootDir, "data", "knowledge-gaps.yaml"),
      write: !args.includes("--check"),
      today: new Date().toISOString().split("T")[0],
    });
    process.exit(0);
  }
}
```

- [ ] **Step 3: Run fixture tests — expect all pass**

Run: `node scripts/graph-gaps.mjs --test`
Expected: 12 `✓` lines, `graph-gaps: all tests passed`, exit 0. If the orphan-group count differs, recount degrees from the fixture (table in the test comment) — fix the fixture or the expectation, not the detector, unless the detector is actually wrong.

- [ ] **Step 4: Live check against the real graph (no write)**

Run: `node scripts/graph-gaps.mjs --check`
Expected: `gaps: N detected, N open ...` with N in the hundreds (the real graph has ~942 weakly-connected nodes grouping into fewer file-level entries). No crash on dangling endpoints.

- [ ] **Step 5: Add npm aliases**

In `package.json` scripts, after `"graph:status"`:

```json
    "graph:gaps": "node scripts/graph-gaps.mjs",
    "graph:update": "graphify . --update || echo 'graph: CLI not installed — see docs/integrations/graphify.md'",
```

- [ ] **Step 6: Commit**

```bash
git add scripts/graph-gaps.mjs data/knowledge-gaps.yaml package.json
git commit -m "feat: add graph-gaps script + knowledge-gaps registry (#14)"
```

---

### Task 5: Wire `--test` modes into `npm run check` + structure validation

**Files:**
- Modify: `package.json` (check script)
- Modify: `scripts/validate-structure.mjs`

- [ ] **Step 1: Extend check script**

```json
    "check": "tsc --noEmit && npx prettier . --check && node scripts/graph-status.mjs --test && node scripts/graph-gaps.mjs --test",
```

- [ ] **Step 2: Teach validate-structure about the new surface**

In `scripts/validate-structure.mjs`, where optional directories are checked (the `ideas/` optional-warning pattern), add `graphify-out/` as an optional directory and `data/knowledge-gaps.yaml` as an optional data file, using the same reporting helpers as neighbors:

```js
// Graphify module (optional — present only after first /graphify build)
checkOptional("graphify-out/ present (knowledge graph)", fs.existsSync(path.join(root, "graphify-out")));
checkOptional("data/knowledge-gaps.yaml present", fs.existsSync(path.join(root, "data", "knowledge-gaps.yaml")));
```

(If the script has no `checkOptional` helper, use whatever produces the `⚠ ... (optional)` line for `ideas/` — match it exactly.)

- [ ] **Step 3: Run both**

Run: `npm run check` → expected: prettier may flag pre-existing files (ignore pre-existing failures; new scripts must pass — run `npx prettier scripts/graph-status.mjs scripts/graph-gaps.mjs --write` if needed).
Run: `npm run validate:structure` → expected: `0 failed`, new optional lines visible.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/validate-structure.mjs
git commit -m "test: wire graph script tests into npm run check; validate graphify-out structure"
```

---

### Task 6: Dashboard "Knowledge Graph" section

**Files:**
- Modify: `scripts/initialize.mjs` (`renderMarkdown()`, around line 1353+; add section after Pipelines)
- Modify: `dashboard.yaml`

- [ ] **Step 1: Add config toggle**

In `dashboard.yaml`, after the `pipelines:` block:

```yaml
  knowledge_graph:
    show: true
```

- [ ] **Step 2: Add the section to renderMarkdown**

In `scripts/initialize.mjs`, import at top with the other local imports:

```js
import { readGraphStatus, renderStatusMarkdown } from "./graph-status.mjs";
```

In `renderMarkdown(state)`, after the Pipelines section block (find `config.pipelines?.show`), insert — matching the surrounding section style (`renderSectionHeader` or the `───` rule the file uses; copy a neighboring section's header call exactly):

```js
  // ── Knowledge Graph ──────────────────────────────────────────────────
  if (config.knowledge_graph?.show !== false) {
    const gs = readGraphStatus();
    if (gs.available) {
      out += sectionRule("Knowledge Graph");   // ← use this file's actual section-header helper
      out += renderStatusMarkdown(gs) + "\n\n";
      const gapsPath = path.join(rootDir, "data", "knowledge-gaps.yaml");
      const gapsDoc = readYamlSafe(gapsPath); // existing helper in this file
      const openGaps = gapsDoc?.gaps?.filter((x) => x.status === "open")?.length || 0;
      if (openGaps > 0) out += `  ${openGaps} open knowledge gap(s) — data/knowledge-gaps.yaml\n\n`;
    }
    // graph absent → section self-hides (spec: degradation)
  }
```

Note for the implementer: `sectionRule` is a placeholder name — open `initialize.mjs`, find how e.g. the Pipelines section emits its `─── Pipelines ───...` header line, and use that exact mechanism. Same for `readYamlSafe` (exists, used at line ~924) and `rootDir`.

- [ ] **Step 3: Verify rendering**

Run: `node scripts/initialize.mjs --format=markdown | grep -A4 "Knowledge Graph"`
Expected: section shows with real stats (`2,906 nodes · ...`). Then temporarily rename `graphify-out/graph.json` → rerun → section absent, no error → rename back.

- [ ] **Step 4: Commit**

```bash
git add scripts/initialize.mjs dashboard.yaml
git commit -m "feat: add Knowledge Graph section to /initialize dashboard"
```

---

### Task 7: `/close` bookend

**Files:**
- Modify: `.claude/commands/close.md`
- Modify: `.opencode/commands/close.md`
- Modify: `.opencode/command/close.md` (byte-identical legacy mirror — keep in sync)

- [ ] **Step 1: Add the graph-update step to close.md**

In `.claude/commands/close.md`, insert a new step between "Update MEMORY.md" and the commit step (renumber subsequent steps):

```markdown
## N. Update Knowledge Graph (if available)

If the `graphify` CLI is installed and `graphify-out/graph.json` exists, refresh the graph so it travels in the same commit as the session's changes:

```bash
command -v graphify >/dev/null 2>&1 && graphify . --update || echo "graph: CLI not installed — see docs/integrations/graphify.md"
npm run graph:gaps 2>/dev/null || true
```

This is incremental (seconds for code-only changes). If the update fails, report the error but continue the close — the graph retries next session. Never block the close on graph tooling.
```

- [ ] **Step 2: Mirror to both .opencode copies**

Apply the identical edit to `.opencode/commands/close.md` and `.opencode/command/close.md` (they are duplicates today; keep them byte-identical).

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/close.md .opencode/commands/close.md .opencode/command/close.md
git commit -m "feat: add graph update bookend to /close"
```

---

### Task 8: Query-first agent protocol

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/AGENTIC-ARCHITECTURE.md`

- [ ] **Step 1: Add the rule to AGENTS.md**

In the exploration/research guidance section of `AGENTS.md` (near the subagent-delegation patterns), add:

```markdown
### Query the knowledge graph first

If `graphify-out/graph.json` exists, answer questions about the organization's
code, docs, and structure from the graph before grep-based exploration:

```bash
graphify query "How does the funding pipeline connect to the curator?"
```

The graph carries file:line citations and an EXTRACTED/INFERRED/AMBIGUOUS audit
trail. Fall back to normal exploration when the graph is absent, stale, or the
question is outside its corpus. See `skills/knowledge-graph/SKILL.md`.
```

- [ ] **Step 2: Add to docs/AGENTIC-ARCHITECTURE.md**

In the skills/architecture section where the knowledge stack is described, add a short subsection:

```markdown
## Knowledge Graph (Graphify)

`graphify-out/graph.json` is a canonical data file (like `data/*.yaml`) built by
the upstream `graphify` CLI at session close. Three read-only consumers:
`scripts/graph-status.mjs` (dashboard), `scripts/graph-gaps.mjs`
(`data/knowledge-gaps.yaml` → knowledge-curator), and `graphify query` (agents).
org-os never writes into the graph. Full design:
`docs/superpowers/specs/2026-07-22-graphify-kms-integration-design.md`;
integration doc: `docs/integrations/graphify.md`.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/AGENTIC-ARCHITECTURE.md
git commit -m "docs: add query-first knowledge-graph protocol for agents"
```

---

### Task 9: `skills/knowledge-graph/SKILL.md`

**Files:**
- Create: `skills/knowledge-graph/SKILL.md`

- [ ] **Step 1: Check the frontmatter convention**

Run: `head -15 skills/knowledge-curator/SKILL.md`
Match its frontmatter keys exactly (name/description/dependencies/etc.).

- [ ] **Step 2: Write the skill**

`skills/knowledge-graph/SKILL.md` (adapt frontmatter to the convention found in Step 1):

```markdown
---
name: knowledge-graph
description: Build, update, and query the org's Graphify knowledge graph; maintain the knowledge-gaps registry for the curator. Use when answering questions about the org's code/docs structure, at session close (graph update), or when triaging knowledge gaps.
dependencies: [knowledge-curator]
---

# Knowledge Graph Skill

The org's corpus (code + docs + data) is mapped into `graphify-out/graph.json`
by the upstream [Graphify](https://graphify.com/) CLI. This skill owns the
org-os side: when to build/update/query, and the gap-triage workflow.

## Prerequisites

`uv tool install graphifyy && graphify install` (operator does this once —
never auto-install). Everything below degrades to a one-line hint without it.

## When to use

| Situation | Action |
|---|---|
| Question about org structure/code/docs | `graphify query "<question>"` — answer from the graph, cite `source_location` |
| Session close | `graphify . --update` then `npm run graph:gaps` (bookend in `/close`) |
| First-time setup | `/graphify .` (full build; semantic extraction runs via subagents) |
| Dashboard stats | `npm run graph:status` |
| Gap triage | Work `data/knowledge-gaps.yaml` `open` entries (below) |

## Gap triage workflow

1. `npm run graph:gaps` refreshes `data/knowledge-gaps.yaml` (statuses preserved).
2. For each `open` gap, decide:
   - **curated** — knowledge-curator wrote/linked a `knowledge/` page covering it; set `status: curated`.
   - **dismissed** — extraction artifact or intentionally unlinked (e.g. scaffolding); set `status: dismissed`. Dismissals persist across re-runs.
   - Leave **open** if it needs work later.
3. Weak communities and large orphan groups first — they indicate missing
   structure, not missing pages.

## Degradation rules

- CLI absent → print `graph: CLI not installed — see docs/integrations/graphify.md`, continue.
- `graph.json` absent → skip graph steps silently (dashboard section self-hides).
- Corrupt graph → `graph: invalid graph.json — re-run /graphify .`, continue.
- Never block a session, commit, or close on graph tooling.

## Boundaries

- Read-only over `graph.json` — org-os never writes into the graph.
- No auto-install of the CLI (operator decision).
- Graph→knowledge-page generation and lint cross-checks are queued follow-ups
  (see `docs/agent-plans/QUEUE.md`), not part of this skill yet.
```

- [ ] **Step 3: Verify structure validation still passes (skill dir has SKILL.md)**

Run: `npm run validate:structure`
Expected: skill count increments (12 skills), `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add skills/knowledge-graph/
git commit -m "feat: add knowledge-graph core skill"
```

---

### Task 10: Integration doc, data-model entry, follow-up queue

**Files:**
- Create: `docs/integrations/graphify.md`
- Modify: `docs/DATA-MODEL.md`
- Modify: `docs/agent-plans/QUEUE.md`

- [ ] **Step 1: Write the integration doc (koi.md/opal.md format)**

`docs/integrations/graphify.md`:

```markdown
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
```

- [ ] **Step 2: Add registry #14 to docs/DATA-MODEL.md**

Find the registry table/listing in `docs/DATA-MODEL.md` (13 registries) and append entry 14, matching the existing entry format:

```markdown
### 14. Knowledge Gaps (`data/knowledge-gaps.yaml`)

Machine-generated registry of knowledge-graph gaps (orphaned nodes, ambiguous
edges, weak communities) produced by `scripts/graph-gaps.mjs` from
`graphify-out/graph.json`. Only the `status` field is hand-edited
(`open → curated | dismissed`). Consumed by the knowledge-curator skill.
Schema: `{id, kind: orphan|ambiguous-edge|weak-community, node_ids[], summary, status, detected}`.
```

Also update any "13 registries" count references to 14 (`grep -rn "13 registries" docs/ *.md`).

- [ ] **Step 3: Queue phase 3+5 follow-ups**

In `docs/agent-plans/QUEUE.md`, add to the queued list (matching existing entry format):

```markdown
- **graphify-knowledge-pages** — `compile:knowledge` gains a graph source: community summaries → `knowledge/` page stubs via `graphify export --wiki`. Needs content-authority design (generated stubs must not drown curated pages). Depends on: graphify integration (shipped).
- **graphify-knowledge-lint** — `lint:knowledge` cross-checks `knowledge/INDEX.md` against graph reality (orphaned pages, undocumented god nodes). Depends on: graphify-knowledge-pages.
- **validate-structure-v3-audit** — audit remaining validate:structure checks against the v3.0 manifest format (the `federation section` drift fixed in this plan may not be the only one).
```

- [ ] **Step 4: Commit**

```bash
git add docs/integrations/graphify.md docs/DATA-MODEL.md docs/agent-plans/QUEUE.md
git commit -m "docs: graphify integration doc, registry #14, queued follow-ups"
```

---

### Task 11: Live acceptance run

**Files:** none created — verification only, then one registry write.

- [ ] **Step 1: Full test sweep**

Run: `node scripts/graph-status.mjs --test && node scripts/graph-gaps.mjs --test && npm run validate:structure`
Expected: all pass.

- [ ] **Step 2: Populate the real gap registry**

Run: `npm run graph:gaps`
Expected: `gaps: N detected, N open ... — registry written`. Then `head -40 data/knowledge-gaps.yaml` — entries look sane (real file paths, weak communities ranked first).

- [ ] **Step 3: Dashboard end-to-end**

Run: `node scripts/initialize.mjs --format=markdown | grep -B1 -A5 "Knowledge Graph"`
Expected: section renders with stats + open-gap count.

- [ ] **Step 4: Degradation end-to-end (spec success criterion)**

```bash
mv graphify-out /tmp/graphify-out-stash
node scripts/initialize.mjs --format=markdown | grep -c "Knowledge Graph" || echo "section hidden ✓"
node scripts/graph-gaps.mjs   # expect hint line, exit 0
mv /tmp/graphify-out-stash graphify-out
```

Expected: section hidden, hint line, exit 0, graph restored.

- [ ] **Step 5: Commit the populated registry + graph data**

```bash
git add data/knowledge-gaps.yaml graphify-out/
git commit -m "feat: populate knowledge-gaps registry from live graph; commit graph data per spec"
```

Note: this commit intentionally includes `graphify-out/` data files (graph.json ~3 MB, cache/ ~1.3 MB) per the spec's commit policy. `graph.html` must NOT appear in `git status` (Task 2 ignored it) — if it does, fix `.gitignore` before committing.

- [ ] **Step 6: Verify success criteria from the spec**

- [ ] `/initialize` renders Knowledge Graph section — done in Step 3
- [ ] gap registry populated, curator-consumable — done in Step 2
- [ ] clean-clone-without-CLI degradation — done in Step 4
- [ ] `/close` <30s incremental update — verify at next real session close (report timing)
- [ ] `sync:upstream` propagation — verify on next instance sync (out of band)

---

## Self-review notes (already applied)

- Spec coverage: decisions table → Tasks 2 (commit policy), 3 (dashboard), 4 (gaps), 6 (dashboard render), 7 (bookend), 8 (query-first), 9 (skill), 10 (docs/queue); error-handling table → Tasks 3/4 degradation paths + Task 11 Step 4; testing section → Tasks 2/3/4/5/11; known-issues (dangling endpoints) → Task 4 detector skips them.
- The validator drift fix (Task 1) is scope-adjacent but blocks every commit in this plan; queued a broader audit in Task 10 Step 3 rather than expanding scope here.
- Type consistency: `readGraphStatus`/`renderStatusMarkdown` exported in Task 3 and imported with those exact names in Task 6; gap object shape `{id, kind, node_ids, summary, status, detected}` identical in Task 4 script, registry example, and DATA-MODEL entry.
```
