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
      summary: `${l.source} —${l.relation}→ ${l.target} is AMBIGUOUS (score ${l.confidence_score})`,
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
  return gaps;
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
    const loaded = yaml.load(fs.readFileSync(registryPath, "utf8"));
    if (loaded && Array.isArray(loaded.gaps)) registry = loaded;
  }
  const merged = mergeGaps(registry.gaps, detected, today);
  const open = merged.filter((x) => x.status === "open").length;

  if (write) {
    const header =
      'schema_version: "2.0"\n\n' +
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
