// aggregate-federation.mjs — CLI: reads ../data/instances.yaml, writes src/data/federation.json
// (name, type and link of each instance, and the counts; nothing else from the registry),
// copies ../.well-known into public/.well-known. Resolves the org-os root from this script's location.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { missingInstalls, installMessage } from "./installs.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));   // org-os/site/scripts
const siteRoot = resolve(scriptDir, "..");                   // org-os/site
const orgOsRoot = resolve(siteRoot, "..");                   // org-os

// Everything below needs the three installs. Check them first and say which is
// missing; the imports that need them are dynamic so this runs before they can fail.
const missing = missingInstalls(orgOsRoot);
if (missing.length > 0) {
  console.error(installMessage(missing, orgOsRoot));
  process.exit(1);
}
const { aggregate, quietMap } = await import("./federation-aggregate.mjs");
const { buildMap } = await import("../../packages/org-os-kms/src/map.mjs");

const registryPath = join(orgOsRoot, "data", "instances.yaml");
if (!existsSync(registryPath)) {
  console.error(`MISSING registry: ${registryPath}`);
  process.exit(1);
}
const registryYaml = readFileSync(registryPath, "utf8");
const fed = aggregate({ registryYaml, now: new Date().toISOString() });

const outDir = join(siteRoot, "src", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "federation.json"), JSON.stringify(fed, null, 2));
console.log(`federation.json: ${fed.registered} registered, ${fed.operational} operational`);

// quietMap: a node whose checkout was not here at build carries no status.
const map = quietMap(buildMap({ dir: orgOsRoot, surface: "web", now: new Date().toISOString() }));
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
