// aggregate-federation.mjs — CLI: reads ../data/instances.yaml, writes src/data/federation.json,
// copies ../.well-known into public/.well-known. Resolves the org-os root from this script's location.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate } from "./federation-aggregate.mjs";
import { buildMap } from "../../packages/org-os-kms/src/map.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));   // org-os/site/scripts
const siteRoot = resolve(scriptDir, "..");                   // org-os/site
const orgOsRoot = resolve(siteRoot, "..");                   // org-os

const registryPath = join(orgOsRoot, "data", "instances.yaml");
if (!existsSync(registryPath)) {
  console.error(`MISSING registry: ${registryPath}`);
  process.exit(1);
}
const registryYaml = readFileSync(registryPath, "utf8");
const fed = aggregate({ registryYaml, baseDir: orgOsRoot, now: new Date().toISOString() });

const outDir = join(siteRoot, "src", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "federation.json"), JSON.stringify(fed, null, 2));
console.log(`federation.json: ${fed.nodes.length} nodes, ${fed.edges.length} edges (${fed.nodes.filter((n) => n.available).length} enriched)`);

const map = buildMap({ dir: orgOsRoot, surface: "web", now: new Date().toISOString() });
const mapJson = JSON.stringify(map, null, 2);
writeFileSync(join(outDir, "map.json"), mapJson);
mkdirSync(join(siteRoot, "public"), { recursive: true });
writeFileSync(join(siteRoot, "public", "map.json"), mapJson);   // fetched at runtime by <federation-map src="/map.json">
console.log(`map.json: ${map.nodes.length} nodes, ${map.edges.length} edges`);

// Surface org-os's own .well-known into the static output.
const wkSrc = join(orgOsRoot, ".well-known");
const wkDst = join(siteRoot, "public", ".well-known");
if (existsSync(wkSrc)) {
  mkdirSync(wkDst, { recursive: true });
  for (const f of readdirSync(wkSrc)) if (f.endsWith(".json")) copyFileSync(join(wkSrc, f), join(wkDst, f));
  console.log(`.well-known: copied`);
}
