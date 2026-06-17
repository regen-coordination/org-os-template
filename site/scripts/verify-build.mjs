// verify-build.mjs — integrity checks on the static build. Runs after `astro build`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const REQUIRED = [
  "index.html",
  "modules/index.html",
  "federation/index.html",
  "docs/index.html",
  "docs/architecture/index.html",
  "docs/federation/index.html",
  "get-started/index.html",
  "about/index.html",
  "llms.txt",
  "federation.json",
  ".well-known/members.json",   // surfaced EIP-4824 schema (copied by the aggregate step)
];
let failed = false;
for (const p of REQUIRED) {
  const full = join(DIST, p);
  if (!existsSync(full)) { console.error(`MISSING: ${full}`); failed = true; }
  else console.log(`OK:      ${full}`);
}

// federation.json shape check
try {
  const fed = JSON.parse(readFileSync(join(DIST, "federation.json"), "utf8"));
  if (fed.root?.id !== "org-os") { console.error("federation.json: root.id !== org-os"); failed = true; }
  if (!Array.isArray(fed.nodes) || fed.nodes.length === 0) { console.error("federation.json: no nodes"); failed = true; }
  else console.log(`federation.json: ${fed.nodes.length} nodes OK`);
} catch (e) { console.error(`federation.json: unreadable — ${e.message}`); failed = true; }

// Internal link check: docs index links resolve to built pages.
const docsIndex = readFileSync(join(DIST, "docs/index.html"), "utf8");
for (const m of docsIndex.matchAll(/href="(\/docs\/[a-z0-9-]+)"/g)) {
  const target = join(DIST, m[1].replace(/^\//, ""), "index.html");
  if (!existsSync(target)) { console.error(`BROKEN LINK: ${m[1]} → ${target}`); failed = true; }
}
console.log("link check: done");
process.exit(failed ? 1 : 0);
