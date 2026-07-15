#!/usr/bin/env node
/**
 * diff-canvas.mjs — structural-vs-additive diff classifier for JSONCanvas
 *
 * Usage:
 *   node diff-canvas.mjs <ours.canvas> <theirs.canvas>
 *
 * Outputs a JSON report with:
 *   - signals: node/edge/group change counts + bulk_translation detection
 *   - classification: "additive" | "disjoint-edit" | "positional-edit" |
 *                     "structural" | "conflicting-spatial" | "no-change"
 *   - recommended_action: human-readable next step
 *
 * Classification rules:
 *   - bulk_translation OR groups_renamed OR groups_resized → STRUCTURAL (STOP)
 *   - nodes moved (no bulk_translation) → POSITIONAL-EDIT (surface to user)
 *   - only additions/removals/text-changes/edge-changes → ADDITIVE (safe to merge)
 *   - no signals → NO-CHANGE
 *
 * Thresholds:
 *   MOVE_THRESHOLD = 200px   (below this = noise, not a "move")
 *   SIZE_DELTA_PCT = 0.20    (group resize ≥ 20% counts as structural)
 *   BULK_PCT = 0.50          (≥50% of common nodes shifted similarly = bulk translation)
 *   VECTOR_BUCKET = 50px     (granularity for clustering translation vectors)
 *
 * Exits 0 always (classification is the signal, not the exit code).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: diff-canvas.mjs <ours.canvas> <theirs.canvas>");
  process.exit(2);
}

const [oursPath, theirsPath] = args.map((p) => resolve(p));
for (const p of [oursPath, theirsPath]) {
  if (!existsSync(p)) {
    console.error(`Canvas not found: ${p}`);
    process.exit(2);
  }
}

const MOVE_THRESHOLD = 200;
const SIZE_DELTA_PCT = 0.20;
const BULK_PCT = 0.50;
const VECTOR_BUCKET = 50;

const ours = JSON.parse(readFileSync(oursPath, "utf8"));
const theirs = JSON.parse(readFileSync(theirsPath, "utf8"));

const oursById = new Map((ours.nodes || []).map((n) => [n.id, n]));
const theirsById = new Map((theirs.nodes || []).map((n) => [n.id, n]));
const allNodeIds = new Set([...oursById.keys(), ...theirsById.keys()]);

const nodes_added = [];
const nodes_removed = [];
const nodes_moved = [];
const nodes_text_changed = [];
const groups_renamed = [];
const groups_resized = [];
const translations = [];

for (const id of allNodeIds) {
  const o = oursById.get(id);
  const t = theirsById.get(id);
  if (!o) {
    nodes_added.push(id);
    continue;
  }
  if (!t) {
    nodes_removed.push(id);
    continue;
  }

  const dx = t.x - o.x;
  const dy = t.y - o.y;
  const dist = Math.hypot(dx, dy);
  if (dist > MOVE_THRESHOLD) {
    nodes_moved.push({ id, dx, dy, dist: Math.round(dist) });
    translations.push({ dx, dy });
  }

  if (o.type === "group" && t.type === "group") {
    if ((o.label || "") !== (t.label || "")) {
      groups_renamed.push({ id, from: o.label || "", to: t.label || "" });
    }
    const wDelta = Math.abs(t.width - o.width) / Math.max(o.width, 1);
    const hDelta = Math.abs(t.height - o.height) / Math.max(o.height, 1);
    if (wDelta > SIZE_DELTA_PCT || hDelta > SIZE_DELTA_PCT) {
      groups_resized.push({
        id,
        label: o.label || "",
        w_delta_pct: +(wDelta * 100).toFixed(1),
        h_delta_pct: +(hDelta * 100).toFixed(1),
      });
    }
  }

  if (o.type === "text" && t.type === "text" && (o.text || "") !== (t.text || "")) {
    nodes_text_changed.push(id);
  }
}

let bulk_translation = null;
const commonNodes = [...allNodeIds].filter((id) => oursById.has(id) && theirsById.has(id)).length;
if (translations.length > 0 && commonNodes > 0) {
  const buckets = new Map();
  for (const { dx, dy } of translations) {
    const kx = Math.round(dx / VECTOR_BUCKET);
    const ky = Math.round(dy / VECTOR_BUCKET);
    const key = `${kx}_${ky}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const [dominantKey, dominantCount] = sorted[0];
  if (dominantCount / commonNodes >= BULK_PCT) {
    const [kx, ky] = dominantKey.split("_").map(Number);
    bulk_translation = {
      dx_approx: kx * VECTOR_BUCKET,
      dy_approx: ky * VECTOR_BUCKET,
      affected_nodes: dominantCount,
      total_common_nodes: commonNodes,
      pct: +((dominantCount / commonNodes) * 100).toFixed(1),
    };
  }
}

const oursEdgesById = new Map((ours.edges || []).map((e) => [e.id, e]));
const theirsEdgesById = new Map((theirs.edges || []).map((e) => [e.id, e]));
const allEdgeIds = new Set([...oursEdgesById.keys(), ...theirsEdgesById.keys()]);
const edges_added = [];
const edges_removed = [];
const edges_rewired = [];
for (const id of allEdgeIds) {
  const o = oursEdgesById.get(id);
  const t = theirsEdgesById.get(id);
  if (!o) {
    edges_added.push(id);
    continue;
  }
  if (!t) {
    edges_removed.push(id);
    continue;
  }
  if (
    o.fromNode !== t.fromNode ||
    o.toNode !== t.toNode ||
    o.fromSide !== t.fromSide ||
    o.toSide !== t.toSide
  ) {
    edges_rewired.push(id);
  }
}

let classification;
let recommended_action;
const isStructural =
  !!bulk_translation || groups_renamed.length > 0 || groups_resized.length > 0;
const hasMoves = nodes_moved.length > 0 && !bulk_translation;
const hasAdditive =
  nodes_added.length > 0 ||
  nodes_removed.length > 0 ||
  nodes_text_changed.length > 0 ||
  edges_added.length > 0 ||
  edges_removed.length > 0 ||
  edges_rewired.length > 0;

if (isStructural) {
  classification = "structural";
  recommended_action =
    "STOP — do NOT programmatically merge. Surface the structural signals to the user with the verbatim escalation prompt from SKILL.md Phase F.";
} else if (hasMoves) {
  classification = "positional-edit";
  recommended_action =
    "Some nodes moved >200px without bulk pattern. Surface moves to user before merge; small individual moves may be safe but confirm.";
} else if (hasAdditive) {
  classification = "additive";
  recommended_action =
    "Safe to auto-merge by ID union. Run validate-canvas.mjs on the merged output.";
} else {
  classification = "no-change";
  recommended_action = "No structural diff. Safe to take either side.";
}

console.log(
  JSON.stringify(
    {
      ours: oursPath,
      theirs: theirsPath,
      classification,
      recommended_action,
      signals: {
        nodes_added: nodes_added.length,
        nodes_removed: nodes_removed.length,
        nodes_moved: nodes_moved.length,
        nodes_text_changed: nodes_text_changed.length,
        edges_added: edges_added.length,
        edges_removed: edges_removed.length,
        edges_rewired: edges_rewired.length,
        groups_renamed: groups_renamed.length,
        groups_resized: groups_resized.length,
        bulk_translation,
      },
      detail: {
        nodes_added: nodes_added.slice(0, 20),
        nodes_removed: nodes_removed.slice(0, 20),
        nodes_moved: nodes_moved.slice(0, 20),
        groups_renamed,
        groups_resized,
      },
    },
    null,
    2,
  ),
);
