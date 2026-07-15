#!/usr/bin/env node
/**
 * validate-canvas.mjs — JSONCanvas integrity checker
 *
 * Usage:
 *   node validate-canvas.mjs <path-to-canvas>
 *
 * Exits 0 on success (warnings allowed), 1 on any error, 2 on bad invocation.
 *
 * Checks (errors fail the run):
 *   - JSON parses; root has nodes[] and edges[] arrays
 *   - All node ids unique; edge fromNode/toNode resolve to existing node ids
 *   - type:file nodes — target file exists relative to vault root
 *   - type:link nodes — URL syntactically valid
 *   - x/y/width/height are finite numbers; |coord| < 100000
 *   - Edge fromSide/toSide ∈ {top, right, bottom, left} when present
 *   - All edge ids unique
 *
 * Warnings (don't fail):
 *   - Color outside {"1".."6"}
 *   - Unknown node type
 *   - Non-group node fully contained inside another non-group node
 *
 * Vault root = nearest ancestor of the canvas with .obsidian/ or package.json.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, isAbsolute } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: validate-canvas.mjs <path-to-canvas>");
  process.exit(2);
}

const canvasPath = resolve(args[0]);
if (!existsSync(canvasPath)) {
  console.error(`Canvas not found: ${canvasPath}`);
  process.exit(2);
}

function findVaultRoot(start) {
  let cur = start;
  while (cur !== "/" && cur.length > 1) {
    if (existsSync(join(cur, ".obsidian")) || existsSync(join(cur, "package.json"))) {
      return cur;
    }
    cur = dirname(cur);
  }
  return dirname(start);
}
const vaultRoot = findVaultRoot(dirname(canvasPath));

let canvas;
try {
  canvas = JSON.parse(readFileSync(canvasPath, "utf8"));
} catch (e) {
  console.log(JSON.stringify({
    path: canvasPath,
    status: "FAIL",
    errors: [`JSON parse error: ${e.message}`],
    warnings: [],
  }, null, 2));
  process.exit(1);
}

const errors = [];
const warnings = [];

if (!canvas.nodes || !Array.isArray(canvas.nodes)) {
  errors.push("Missing or non-array nodes[]");
}
if (!canvas.edges || !Array.isArray(canvas.edges)) {
  errors.push("Missing or non-array edges[]");
}

const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
const edges = Array.isArray(canvas.edges) ? canvas.edges : [];

const ids = new Set();
for (const n of nodes) {
  if (!n.id) {
    errors.push(`Node missing id: ${JSON.stringify(n).slice(0, 80)}`);
    continue;
  }
  if (ids.has(n.id)) {
    errors.push(`Duplicate node id: ${n.id}`);
  }
  ids.add(n.id);

  for (const k of ["x", "y", "width", "height"]) {
    const v = n[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`Node ${n.id} has invalid ${k}: ${v}`);
    } else if (Math.abs(v) > 100000) {
      errors.push(`Node ${n.id} ${k} out of reasonable bounds: ${v}`);
    }
  }

  if (n.color !== undefined && !/^[1-6]$/.test(String(n.color))) {
    warnings.push(`Node ${n.id} has non-standard color: ${JSON.stringify(n.color)}`);
  }

  switch (n.type) {
    case "file": {
      if (!n.file) {
        errors.push(`File node ${n.id} missing 'file' field`);
        break;
      }
      const target = isAbsolute(n.file) ? n.file : join(vaultRoot, n.file);
      if (!existsSync(target)) {
        errors.push(`File node ${n.id} target missing: ${n.file}`);
      }
      break;
    }
    case "link": {
      if (!n.url) {
        errors.push(`Link node ${n.id} missing 'url' field`);
        break;
      }
      try {
        new URL(n.url);
      } catch {
        errors.push(`Link node ${n.id} invalid URL: ${n.url}`);
      }
      break;
    }
    case "text": {
      if (typeof n.text !== "string") {
        errors.push(`Text node ${n.id} missing or non-string 'text'`);
      }
      break;
    }
    case "group":
      break;
    default:
      warnings.push(`Node ${n.id} has unknown type: ${JSON.stringify(n.type)}`);
  }
}

const edgeIds = new Set();
for (const e of edges) {
  if (!e.id) {
    errors.push(`Edge missing id: ${JSON.stringify(e).slice(0, 80)}`);
    continue;
  }
  if (edgeIds.has(e.id)) {
    errors.push(`Duplicate edge id: ${e.id}`);
  }
  edgeIds.add(e.id);

  if (!ids.has(e.fromNode)) {
    errors.push(`Edge ${e.id} fromNode unresolved: ${e.fromNode}`);
  }
  if (!ids.has(e.toNode)) {
    errors.push(`Edge ${e.id} toNode unresolved: ${e.toNode}`);
  }

  for (const k of ["fromSide", "toSide"]) {
    if (e[k] !== undefined && !["top", "right", "bottom", "left"].includes(e[k])) {
      errors.push(`Edge ${e.id} ${k} invalid: ${e[k]}`);
    }
  }
}

const nonGroup = nodes.filter((n) => n.type !== "group" && n.id);
for (const a of nonGroup) {
  for (const b of nonGroup) {
    if (a.id === b.id) continue;
    if (
      a.x >= b.x &&
      a.y >= b.y &&
      a.x + a.width <= b.x + b.width &&
      a.y + a.height <= b.y + b.height
    ) {
      warnings.push(`Node ${a.id} fully contained inside non-group node ${b.id}`);
    }
  }
}

const status = errors.length === 0 ? "OK" : "FAIL";

console.log(
  JSON.stringify(
    {
      path: canvasPath,
      vault_root: vaultRoot,
      status,
      node_count: nodes.length,
      edge_count: edges.length,
      errors,
      warnings,
    },
    null,
    2,
  ),
);

process.exit(errors.length === 0 ? 0 : 1);
