#!/usr/bin/env node
// validate-tech-tree.mjs — CLI: checks data/tech-tree.yaml against the source
// registries. Errors exit 1; warnings (coverage drift, reachability) are advisory.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistries, validateTree } from "./lib/tech-tree.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const registries = parseRegistries({
  packagesYaml: read("data", "packages-matrix.yaml"),
  skillsYaml: read("data", "skills-matrix.yaml"),
  ideasYaml: read("data", "ideas.yaml"),
});
const { errors, warnings } = validateTree({ treeYaml: read("data", "tech-tree.yaml"), registries });

for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ tech-tree valid (${warnings.length} warning(s))`);
