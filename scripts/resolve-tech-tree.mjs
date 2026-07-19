#!/usr/bin/env node
// resolve-tech-tree.mjs — CLI: resolves data/tech-tree.yaml → resolved graph JSON.
// Default output feeds the site build; --out=<path> for other consumers
// (future: canvas exporter, dashboard). "moved" is diffed against the previous output.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistries, resolveTree } from "./lib/tech-tree.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg ? resolve(outArg.slice("--out=".length)) : join(root, "site", "src", "data", "tech-tree.resolved.json");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const registries = parseRegistries({
  packagesYaml: read("data", "packages-matrix.yaml"),
  skillsYaml: read("data", "skills-matrix.yaml"),
  ideasYaml: read("data", "ideas.yaml"),
});
const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
const graph = resolveTree({ treeYaml: read("data", "tech-tree.yaml"), registries, previous });
graph.meta.generated = new Date().toISOString();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(graph, null, 2));

const frontierCount = graph.frontier.clusters.reduce((a, c) => a + c.items.length, 0);
console.log(
  `tech-tree: ${graph.stats.total} nodes · ${graph.stats.byStatus["in-dev"] ?? 0} in-dev · ` +
    `${frontierCount} frontier · ${graph.stats.moved.length} moved → ${outPath}`,
);
