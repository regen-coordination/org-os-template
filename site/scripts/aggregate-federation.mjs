// aggregate-federation.mjs — CLI: reads ../data/instances.yaml, writes src/data/federation.json
// (name, type and link of each listed instance, and the counts; nothing else from the registry,
// and nothing of an entry marked listed: false), and public/map.json (the map, under the same rule,
// with no address that map-addresses.mjs refuses). Resolves the org-os root from this script's location.
//
// It does not copy ../.well-known into the site (operator decision 3, 2026-11-07): those files are the
// hand-written 0.5 ones, and the generator cannot rewrite them for a site served under a sub-path (it builds
// every address from the daoURI's origin). The site publishes them again once the generator can make them true.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
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
const { aggregate, quietMap, parseRegistry, registryView, isListed } = await import("./federation-aggregate.mjs");
const { publicMap } = await import("./map-addresses.mjs");
const { buildMap } = await import("../../packages/org-os-kms/src/map.mjs");

const registryPath = join(orgOsRoot, "data", "instances.yaml");
if (!existsSync(registryPath)) {
  console.error(`MISSING registry: ${registryPath}`);
  process.exit(1);
}
const registryYaml = readFileSync(registryPath, "utf8");
let fed;
try {
  fed = aggregate({ registryYaml, now: new Date().toISOString() });
} catch (error) {
  // A registry the site will not publish from, said in its own sentence (a mistyped `listed`).
  console.error(`REGISTRY: ${error.message}`);
  process.exit(1);
}

const outDir = join(siteRoot, "src", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "federation.json"), JSON.stringify(fed, null, 2));
const leftOut = registryView(parseRegistry(registryYaml)).unlisted.length;
console.log(`federation.json: ${fed.registered} registered, ${fed.operational} operational; ${leftOut} entr${leftOut === 1 ? "y" : "ies"} marked listed: false left out`);

// quietMap: a node whose checkout was not here at build carries no status.
// publicMap: no entry marked listed: false, nothing reached only through one, no refused address.
const unlistedIds = parseRegistry(registryYaml).filter((raw) => !isListed(raw)).map((raw) => raw.id);
const map = publicMap(quietMap(buildMap({ dir: orgOsRoot, surface: "web", now: new Date().toISOString() })), unlistedIds);
const mapJson = JSON.stringify(map, null, 2);
writeFileSync(join(outDir, "map.json"), mapJson);
mkdirSync(join(siteRoot, "public"), { recursive: true });
writeFileSync(join(siteRoot, "public", "map.json"), mapJson);   // fetched at runtime by <federation-map src="/map.json">
console.log(`map.json: ${map.nodes.length} nodes, ${map.edges.length} edges`);

// An earlier build copied ../.well-known here; public/ is copied into dist/ as it stands, so remove it.
rmSync(join(siteRoot, "public", ".well-known"), { recursive: true, force: true });
